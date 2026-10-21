import {
  OPENROUTER_BASE_URL,
  OPENROUTER_FREE_LIMITS,
  createOpenRouterProvider,
  type OpenRouterProvider,
  type ProviderRegistry,
} from '@monsters/providers';
import { z } from 'zod';
import type { StateStore } from '../db/state-store.ts';
import { secretStoreFor } from '../secrets/store.ts';
import type { HubSettings } from './settings.ts';
import { teamStrings } from './team.strings.ts';

/*
 * The OpenRouter key (ARCHITECTURE §5.8): the secret `openrouter.key` in
 * `MONSTERS_HOME/secrets/` (keychain or file backend, D-042), or `OPENROUTER_API_KEY`. It is verified with OpenRouter's
 * `/api/v1/key` before being saved and is never returned by the API.
 */

export const OPENROUTER_KEY_FILE = 'openrouter.key';
/** Daily limit of free models once the account bought at least 10 $ of credits. */
export const OPENROUTER_PAID_ACCOUNT_RPD = 1000;

export interface OpenRouterKeyInfo {
  label?: string;
  /** False when the account has credits: 1000 free requests per day instead of 50. */
  isFreeTier?: boolean;
  limit?: number | null;
  usage?: number;
}

/** State key: fingerprint of the OpenRouter key in use and since when (D-019). */
export const OPENROUTER_KEY_SINCE_KEY = 'openrouter_key_since';

interface KeySince {
  keyId: string;
  since: number;
}

/**
 * Notes the fingerprint of the OpenRouter key in use. Returns the time from
 * which the `provider_usage` events without a fingerprint (written before it
 * existed) count for this key: the last change of key. Without a record (first
 * start with fingerprints) the key is taken as unchanged and they all count.
 */
export function noteOpenRouterKey(state: StateStore, keyId: string, now = Date.now()): number {
  const prev = state.get<KeySince>(OPENROUTER_KEY_SINCE_KEY);
  if (prev?.keyId === keyId) return prev.since;
  const since = prev ? now : 0;
  state.set(OPENROUTER_KEY_SINCE_KEY, { keyId, since } satisfies KeySince);
  return since;
}

export function readOpenRouterKey(
  secretsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { key: string; source: 'file' | 'env' } | null {
  const key = secretStoreFor(secretsDir).read(OPENROUTER_KEY_FILE)?.trim();
  if (key) return { key, source: 'file' };
  const fromEnv = env['OPENROUTER_API_KEY']?.trim();
  return fromEnv ? { key: fromEnv, source: 'env' } : null;
}

export function saveOpenRouterKey(secretsDir: string, key: string): void {
  secretStoreFor(secretsDir).write(OPENROUTER_KEY_FILE, `${key.trim()}\n`);
}

const KeyResponseSchema = z.object({
  data: z.object({
    label: z.string().nullable().optional(),
    is_free_tier: z.boolean().optional(),
    limit: z.number().nullable().optional(),
    usage: z.number().optional(),
  }),
});

export type VerifyResult =
  { ok: true; info: OpenRouterKeyInfo } | { ok: false; status: number; message: string };

/** Asks OpenRouter whether the key is valid. Network errors are reported, not thrown. */
export async function verifyOpenRouterKey(
  key: string,
  options: { fetch?: typeof fetch; baseURL?: string; signal?: AbortSignal } = {},
): Promise<VerifyResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(`${options.baseURL ?? OPENROUTER_BASE_URL}/key`, {
      headers: { authorization: `Bearer ${key}` },
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: teamStrings().openrouterUnreachable((err as Error).message),
    };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: teamStrings().invalidKey };
  }
  if (!res.ok)
    return { ok: false, status: res.status, message: teamStrings().openrouterAnswered(res.status) };
  const parsed = KeyResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: true, info: {} };
  const d = parsed.data.data;
  return {
    ok: true,
    info: {
      ...(d.label ? { label: d.label } : {}),
      ...(d.is_free_tier !== undefined ? { isFreeTier: d.is_free_tier } : {}),
      ...(d.limit !== undefined ? { limit: d.limit } : {}),
      ...(d.usage !== undefined ? { usage: d.usage } : {}),
    },
  };
}

/**
 * (Re)registers the OpenRouter provider with a key, then reads in the
 * background OpenRouter's count of today's free requests for its budget
 * (without blocking: until it answers, the budget has what the log restored).
 */
export function configureOpenRouter(
  registry: ProviderRegistry,
  key: string,
  settings: HubSettings['openrouter'],
  info: OpenRouterKeyInfo | null,
  options: { fetch?: typeof fetch } = {},
): OpenRouterProvider {
  if (registry.has('openrouter')) registry.unregister('openrouter');
  const rpd =
    settings.rpd ??
    (info?.isFreeTier === false ? OPENROUTER_PAID_ACCOUNT_RPD : OPENROUTER_FREE_LIMITS.rpd);
  const provider = createOpenRouterProvider({
    apiKey: key,
    freeOnly: settings.freeOnly,
    rpm: settings.rpm ?? OPENROUTER_FREE_LIMITS.rpm,
    rpd,
    // Without an `rpd` chosen by the user, the limit OpenRouter reports wins.
    followAccountRpd: settings.rpd === undefined,
    appName: 'Monsters',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  registry.register(provider);
  void provider.syncDailyQuota();
  return provider;
}
