import { describe, expect, it } from 'vitest';
import {
  errorChainText,
  extractTelegramToken,
  netCause,
  netFailureOf,
  netFailureText,
  TELEGRAM_TOKEN_PATTERN,
} from '../src/index.ts';

/** An error with a system code, as Node and undici make them. */
function sys(code: string, message = `connect ${code}`): Error {
  return Object.assign(new Error(message), { code });
}

/** grammY's HttpError: node-fetch's error in `error`, not in `cause`. */
function grammyHttp(inner: unknown): Error {
  return Object.assign(new Error("Network request for 'getMe' failed!"), {
    name: 'HttpError',
    error: inner,
  });
}

describe('why a request got no answer', () => {
  it('reads the code under grammY, undici and AggregateError', () => {
    const fetchErr = Object.assign(
      new Error(
        'request to https://api.telegram.org/bot1:x/getMe failed, reason: getaddrinfo ENOTFOUND',
      ),
      { name: 'FetchError', code: 'ENOTFOUND' },
    );
    expect(netFailureOf(grammyHttp(fetchErr))).toEqual({ kind: 'dns', code: 'ENOTFOUND' });
    // undici: TypeError "fetch failed" with the socket error as cause.
    const undici = new TypeError('fetch failed', { cause: sys('UND_ERR_CONNECT_TIMEOUT') });
    expect(netFailureOf(undici)).toEqual({ kind: 'timeout', code: 'UND_ERR_CONNECT_TIMEOUT' });
    // Happy eyeballs: every address failed.
    const aggregate = new TypeError('fetch failed', {
      cause: Object.assign(new AggregateError([sys('ECONNREFUSED'), sys('ECONNREFUSED')]), {
        code: 'ECONNREFUSED',
      }),
    });
    expect(netFailureOf(aggregate)).toEqual({ kind: 'refused', code: 'ECONNREFUSED' });
    expect(netFailureOf(new Error('x', { cause: sys('EAI_AGAIN') })).kind).toBe('dns');
    expect(netFailureOf(sys('ECONNRESET')).kind).toBe('refused');
  });

  it('knows a certificate of a TLS inspection from the rest', () => {
    for (const code of [
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ]) {
      expect(netFailureOf(new TypeError('fetch failed', { cause: sys(code) }))).toEqual({
        kind: 'tls',
        code,
      });
    }
    // A TLS failure explains the reset under it.
    const both = new Error('x', {
      cause: Object.assign(sys('ECONNRESET'), { cause: sys('CERT_HAS_EXPIRED') }),
    });
    expect(netFailureOf(both).kind).toBe('tls');
  });

  it('timeouts and proxies from their names and texts too', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(netFailureOf(new Error('x', { cause: timeout })).kind).toBe('timeout');
    expect(
      netFailureOf(grammyHttp(new Error("Request to 'getMe' timed out after 15 seconds"))).kind,
    ).toBe('timeout');
    expect(netFailureOf(new TypeError('fetch failed', { cause: sys('ERR_PROXY_TUNNEL') }))).toEqual(
      {
        kind: 'proxy',
        code: 'ERR_PROXY_TUNNEL',
      },
    );
    const undiciTunnel = new TypeError('fetch failed', {
      cause: new Error('Proxy response (407) !== 200 when HTTP Tunneling'),
    });
    expect(netFailureOf(undiciTunnel).kind).toBe('proxy');
  });

  it('unknown, with the code when there is one; a cycle never loops', () => {
    expect(netFailureOf(new Error('boom'))).toEqual({ kind: 'unknown' });
    expect(netFailureOf(sys('EPROTO'))).toEqual({ kind: 'unknown', code: 'EPROTO' });
    const a = new Error('a') as Error & { cause?: unknown };
    a.cause = new Error('b', { cause: a });
    expect(netFailureOf(a)).toEqual({ kind: 'unknown' });
    expect(netFailureOf('just a string')).toEqual({ kind: 'unknown' });
  });

  it('says it in short Italian, with the host and what to try', () => {
    expect(netFailureText({ kind: 'tls' }, 'api.telegram.org')).toBe(
      'La connessione a api.telegram.org è intercettata da un programma della rete (VPN, proxy aziendale o antivirus) che Monsters non riconosce. Se sei in VPN o dietro un proxy aziendale, prova senza o chiedi di consentire api.telegram.org.',
    );
    expect(netFailureText({ kind: 'dns' }, 'api.telegram.org')).toContain(
      'non trova api.telegram.org',
    );
    expect(netFailureText({ kind: 'unknown', code: 'EPROTO' }, 'x.org')).toBe(
      'Non riesco a raggiungere x.org (EPROTO). Controlla la connessione e riprova.',
    );
    expect(netCause({ kind: 'timeout' })).toBe('nessuna risposta in tempo');
  });

  it('the chain in one line for the log', () => {
    const err = grammyHttp(
      Object.assign(new Error('reason: connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        name: 'FetchError',
      }),
    );
    expect(errorChainText(err)).toBe(
      "HttpError: Network request for 'getMe' failed! <- FetchError: reason: connect ECONNREFUSED",
    );
  });
});

describe('the Telegram token in what was pasted', () => {
  const token = '123456789:AAEabcdefghijklmnopqrstuvwxyz0123456';

  it('alone, with spaces around, or inside BotFather’s message', () => {
    expect(extractTelegramToken(token)).toBe(token);
    expect(extractTelegramToken(`  ${token}\n`)).toBe(token);
    const message = `Done! Congratulations on your new bot. You will find it at t.me/x_bot.\n\nUse this token to access the HTTP API:\n${token}\nKeep your token secure and store it safely, it can be used by anyone to control your bot.`;
    expect(extractTelegramToken(message)).toBe(token);
    // A one-line field turns the line breaks into spaces.
    expect(extractTelegramToken(message.replace(/\n/g, ' '))).toBe(token);
    // …or drops them after a colon.
    expect(extractTelegramToken(`Use this token to access the HTTP API:${token} Keep it`)).toBe(
      token,
    );
  });

  it('a token broken by a space or a line break is joined again', () => {
    expect(extractTelegramToken('123456789:AAEabcdefghijklm nopqrstuvwxyz0123456')).toBe(token);
    expect(extractTelegramToken('123456789:AAEabcdefghijklm\nnopqrstuvwxyz0123456')).toBe(token);
  });

  it('nothing token-shaped: null', () => {
    expect(extractTelegramToken('ciao')).toBeNull();
    expect(extractTelegramToken('123:AAE')).toBeNull();
    expect(extractTelegramToken('Use this token: 123456789:short\nKeep it')).toBeNull();
    // Glued to other word characters: not a token boundary.
    expect(extractTelegramToken(`abc${token}`)).toBeNull();
    // Whatever comes out matches the strict pattern.
    expect(TELEGRAM_TOKEN_PATTERN.test(extractTelegramToken(`x ${token} y`)!)).toBe(true);
  });
});
