import {
  errorChainText,
  netFailureOf,
  netFailureText,
  type NetFailureKind,
} from '@monsters/shared';
import { proxyAgentFor } from '@monsters/shared/node';
import { GrammyError, type ApiClientOptions } from 'grammy';

/*
 * What the Telegram code shares about the way out: the client options of every `Api` (the
 * proxy of the environment, network.ts) and why a `getMe` that checks a pasted token failed,
 * in the user's words.
 */

export const TELEGRAM_API_ROOT = 'https://api.telegram.org';

/**
 * Options of a grammY `Api`. grammY gives node-fetch its own keep-alive agent, which the
 * global proxy agent never replaces: with a proxy in the environment, one that goes through it.
 */
export function telegramClient(
  apiRoot: string | undefined,
  timeoutSeconds: number,
): ApiClientOptions {
  const agent = proxyAgentFor(apiRoot ?? TELEGRAM_API_ROOT);
  return {
    ...(apiRoot ? { apiRoot } : {}),
    timeoutSeconds,
    ...(agent ? { baseFetchConfig: { agent, compress: true } } : {}),
  };
}

/** Errors of the Bot API that mean "this token is not a bot". */
export function tokenRefused(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 401 || err.error_code === 404);
}

export interface TokenCheckFailure {
  code: 'invalid_token' | 'verification_failed';
  /** For the user. */
  message: string;
  /** For the log (`channel` event): the kind, and the raw chain (redacted by the log). */
  kind: NetFailureKind | 'refused_token' | 'telegram';
  detail: string;
}

/** Why `getMe` could not confirm a token. */
export function tokenCheckFailure(err: unknown, apiRoot: string | undefined): TokenCheckFailure {
  if (tokenRefused(err)) {
    return {
      code: 'invalid_token',
      message: 'Telegram non riconosce questo token.',
      kind: 'refused_token',
      detail: (err as GrammyError).description,
    };
  }
  if (err instanceof GrammyError) {
    // Telegram answered, with something else (429, 5xx): it is there, try again later.
    return {
      code: 'verification_failed',
      message: `Telegram ha risposto con un errore (${err.error_code}): riprova tra poco.`,
      kind: 'telegram',
      detail: `${err.error_code} ${err.description}`,
    };
  }
  let host = 'api.telegram.org';
  try {
    host = new URL(apiRoot ?? TELEGRAM_API_ROOT).host;
  } catch {
    // the default name
  }
  const failure = netFailureOf(err);
  return {
    code: 'verification_failed',
    message: netFailureText(failure, host),
    kind: failure.kind,
    detail: errorChainText(err),
  };
}
