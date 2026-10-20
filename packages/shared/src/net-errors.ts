/*
 * Why a request never got an answer, in words the user can act on. The core's networking is
 * Node's, not the browser's: behind a VPN, a corporate proxy or an antivirus that inspects
 * TLS the browser works and the core may not. The real cause sits deep in the error: grammY's
 * `HttpError` keeps node-fetch's error in `error`, undici's `fetch failed` keeps the socket
 * error in `cause`, a connection tried on several addresses ends in an `AggregateError`.
 */

export type NetFailureKind = 'dns' | 'refused' | 'timeout' | 'tls' | 'proxy' | 'unknown';

export interface NetFailure {
  kind: NetFailureKind;
  /** The system or library code that decided the kind (`ENOTFOUND`, `CERT_HAS_EXPIRED`…). */
  code?: string;
}

const DNS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME', 'EAI_NODATA']);
const REFUSED = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_SOCKET',
]);
const TIMEOUT = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const TLS = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const PROXY = new Set(['ERR_PROXY_TUNNEL', 'ERR_PROXY_INVALID_CONFIG', 'UND_ERR_PRX_TLS']);

/** The most telling first: a proxy or a TLS interception explains the socket errors under it. */
const ORDER: NetFailureKind[] = ['proxy', 'tls', 'dns', 'refused', 'timeout'];

function kindOfCode(code: string): NetFailureKind | null {
  if (PROXY.has(code)) return 'proxy';
  if (TLS.has(code)) return 'tls';
  if (DNS.has(code)) return 'dns';
  if (REFUSED.has(code)) return 'refused';
  if (TIMEOUT.has(code)) return 'timeout';
  return null;
}

function kindOfText(name: string, message: string): NetFailureKind | null {
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  // undici's tunnel: "Proxy response (407) !== 200 when HTTP Tunneling".
  if (/\bproxy\b/i.test(message)) return 'proxy';
  if (/certificate|self[- ]signed/i.test(message)) return 'tls';
  // grammY's own timer: "Request to 'getMe' timed out after 15 seconds".
  if (/timed out|timeout/i.test(message)) return 'timeout';
  return null;
}

/** Every error of the chain: `cause`, grammY's `error`, the `errors` of an AggregateError. */
export function errorChain(err: unknown, max = 12): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0 && out.length < max) {
    const e = queue.shift();
    if (e === undefined || e === null || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (typeof e !== 'object') continue;
    const o = e as { cause?: unknown; error?: unknown; errors?: unknown };
    if (o.cause !== undefined) queue.push(o.cause);
    if (o.error instanceof Error) queue.push(o.error);
    if (Array.isArray(o.errors)) queue.push(...(o.errors as unknown[]).slice(0, 4));
  }
  return out;
}

/** What went wrong on the way, from the codes of the chain first, then from the texts. */
export function netFailureOf(err: unknown): NetFailure {
  const found = new Map<NetFailureKind, string | undefined>();
  const chain = errorChain(err);
  for (const e of chain) {
    if (typeof e !== 'object' || e === null) continue;
    const code = (e as { code?: unknown }).code;
    if (typeof code !== 'string') continue;
    const kind = kindOfCode(code);
    if (kind && !found.has(kind)) found.set(kind, code);
  }
  if (found.size === 0) {
    for (const e of chain) {
      if (!(e instanceof Error)) continue;
      const kind = kindOfText(e.name, e.message);
      if (kind && !found.has(kind)) found.set(kind, undefined);
    }
  }
  for (const kind of ORDER) {
    if (!found.has(kind)) continue;
    const code = found.get(kind);
    return code ? { kind, code } : { kind };
  }
  const code = chain
    .map((e) => (typeof e === 'object' && e ? (e as { code?: unknown }).code : undefined))
    .find((c): c is string => typeof c === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(c));
  return code ? { kind: 'unknown', code } : { kind: 'unknown' };
}

/** The cause alone, to follow "Non riesco a raggiungere X:". */
export function netCause(f: NetFailure): string {
  switch (f.kind) {
    case 'dns':
      return 'il nome non si risolve (sei offline, o la rete lo blocca)';
    case 'refused':
      return 'la connessione è stata rifiutata o interrotta';
    case 'timeout':
      return 'nessuna risposta in tempo';
    case 'tls':
      return 'la connessione è intercettata da un programma della rete (VPN, proxy aziendale o antivirus) che Monsters non riconosce';
    case 'proxy':
      return 'il proxy della rete non la lascia passare';
    case 'unknown':
      return f.code ? `errore di rete (${f.code})` : 'errore di rete';
  }
}

/** What to try, for the failures a VPN or a corporate network usually explains. */
export function netHint(f: NetFailure, host: string): string {
  return f.kind === 'unknown'
    ? 'Controlla la connessione e riprova.'
    : `Se sei in VPN o dietro un proxy aziendale, prova senza o chiedi di consentire ${host}.`;
}

/** One short sentence naming the host, plus what to try. */
export function netFailureText(f: NetFailure, host: string): string {
  const sentence = (() => {
    switch (f.kind) {
      case 'dns':
        return `Il computer non trova ${host}: sei offline, o la rete blocca il nome.`;
      case 'refused':
        return `La connessione a ${host} è stata rifiutata o interrotta.`;
      case 'timeout':
        return `${host} non ha risposto in tempo.`;
      case 'tls':
        return `La connessione a ${host} è intercettata da un programma della rete (VPN, proxy aziendale o antivirus) che Monsters non riconosce.`;
      case 'proxy':
        return `Il proxy della rete non lascia passare la connessione a ${host}.`;
      case 'unknown':
        return `Non riesco a raggiungere ${host}${f.code ? ` (${f.code})` : ''}.`;
    }
  })();
  return `${sentence} ${netHint(f, host)}`;
}

/** The whole chain in one line, for the log (redact it there: URLs may carry a token). */
export function errorChainText(err: unknown, max = 600): string {
  const parts = errorChain(err).map((e) => {
    if (!(e instanceof Error)) return String(e);
    const code = (e as { code?: unknown }).code;
    return `${e.name}: ${e.message}${typeof code === 'string' && !e.message.includes(code) ? ` (${code})` : ''}`;
  });
  const text = parts.join(' <- ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
