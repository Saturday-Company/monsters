import { ToolError } from '@monsters/shared';
import { isPrivateHost } from './address.ts';

/** A desktop browser UA: several sites (and keyless search pages) refuse obvious bots. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

/** Identifying UA for APIs that ask for one (Wikimedia policy). */
export function monstersUserAgent(version = '0.0.0'): string {
  return `Monsters/${version} (https://github.com/Saturday-Company/monsters)`;
}

/** Combines the tool context signal with a timeout. */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function parseHttpUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError('INVALID_INPUT', `not a valid URL: ${raw}`, {
      hint: 'Use an absolute URL starting with https://',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError('INVALID_INPUT', `unsupported protocol ${url.protocol}`, {
      hint: 'Only http and https pages can be fetched.',
    });
  }
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw new ToolError('BLOCKED_BY_POLICY', `${url.hostname} is a local or private address`, {
      hint: 'Only public web pages can be fetched.',
    });
  }
  return url;
}

/** Why a site's refusal is nobody's setting, and what to do instead. */
export const SITE_REFUSED_HINT =
  "Non è un permesso dell'utente né di Monsters: il sito non accetta la lettura automatica e nessuno può attivarla da Monsters. " +
  "Prova un'altra fonte (web_search per un'altra pagina) oppure dillo nel resoconto.";

/** Maps an HTTP failure to a tool error the model can act on. */
export function httpError(status: number, what: string, site?: string): ToolError {
  if (status === 404 || status === 410)
    return new ToolError('NOT_FOUND', `${what}: HTTP ${status}`, {
      hint: 'Check the URL or search for the page again.',
    });
  if (status === 401 || status === 403)
    return new ToolError(
      'SITE_REFUSED',
      site
        ? `il sito ${site} ha rifiutato la lettura (HTTP ${status})`
        : `${what}: il sito ha rifiutato la lettura (HTTP ${status})`,
      { hint: SITE_REFUSED_HINT },
    );
  if (status === 429)
    return new ToolError('RATE_LIMITED', `${what}: HTTP 429`, {
      hint: 'Too many requests to this site: wait or use another source.',
    });
  if (status >= 500)
    return new ToolError('UNAVAILABLE', `${what}: HTTP ${status}`, {
      hint: 'The site is having problems: retry later or try another source.',
    });
  return new ToolError('UNAVAILABLE', `${what}: HTTP ${status}`);
}

/** Turns fetch failures (abort, timeout, network) into tool errors. */
export function fetchFailure(
  err: unknown,
  parent: AbortSignal | undefined,
  what: string,
): ToolError {
  if (err instanceof ToolError) return err;
  if (parent?.aborted) return new ToolError('ABORTED', `${what}: stopped`);
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ToolError('UNAVAILABLE', `${what}: timed out`, {
      hint: 'The site is slow: try again once or use another source.',
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ToolError('UNAVAILABLE', `${what}: ${message}`, {
    hint: 'Network error: check the address or try another source.',
  });
}

/** `charset=` of a Content-Type value, without quotes. */
export function charsetOf(contentType: string): string | undefined {
  const m = /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i.exec(contentType);
  return (m?.[1] ?? m?.[2] ?? m?.[3])?.trim() || undefined;
}

/** `<meta charset>` or `http-equiv` charset in the first 1024 bytes (ASCII-compatible). */
export function sniffMetaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const m =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head) ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w:.-]+)/i.exec(head);
  return m?.[1];
}

/** Reads a response body up to `maxBytes`, decoding with the declared charset. */
export async function readLimited(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; bytes: number }> {
  if (!res.body) return { text: '', truncated: false, bytes: 0 };
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const room = maxBytes - bytes;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      bytes += room;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  const header = charsetOf(res.headers.get('content-type') ?? '');
  // Without a header charset, an HTML page may declare one in its first KB.
  const charset =
    header ??
    (/html/i.test(res.headers.get('content-type') ?? '') ? sniffMetaCharset(all) : undefined);
  let decoder: InstanceType<typeof TextDecoder>;
  try {
    decoder = new TextDecoder(charset ?? 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return { text: decoder.decode(all), truncated, bytes };
}
