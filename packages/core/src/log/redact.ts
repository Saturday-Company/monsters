/**
 * Secret redaction applied to everything before it reaches the event log.
 * Three layers: sensitive keys (whole value replaced), known secret values
 * registered at runtime (exact match) and well-known token patterns.
 */

export const REDACTED = '[REDACTED]';

/**
 * Substrings that make a key name secret once normalised (lowercase, without
 * `-`, `_`, `.` and spaces): `aws_secret_access_key`, `X-Api-Key`, `apiKeys`...
 */
const SECRET_KEY_PARTS = [
  'secret',
  'password',
  'passwd',
  'passphrase',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'privatekey',
  'accesskey',
  'signingkey',
  'encryptionkey',
  'sessionkey',
  'masterkey',
];

/** Whole key names that are secret but too short to match as substrings. */
const SECRET_KEY_EXACT = new Set(['auth', 'pass', 'pwd']);

/**
 * Names containing "token" that are counters, not credentials (`inputTokens`,
 * `maxTokens`, `tokenCount`...).
 */
const TOKEN_COUNTER_KEY =
  /(?:input|output|max|min|total|prompt|completion|cached|cache|reasoning|remaining|used|context|read|write|creation|num)tokens?$|tokens?(?:count|limit|usage|used|budget|total|remaining|details|estimate)$|tokeniz/;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s.]/g, '');
}

/**
 * `strong`: always secret. `token`: secret because of "token" only (numbers
 * under such keys are counts and are kept). `none`: not secret.
 */
function secretKeyKind(key: string): 'strong' | 'token' | 'none' {
  if (key.length > 128) return 'none';
  const k = normaliseKey(key);
  if (SECRET_KEY_EXACT.has(k) || SECRET_KEY_PARTS.some((p) => k.includes(p))) return 'strong';
  if (k.includes('token') && !TOKEN_COUNTER_KEY.test(k)) return 'token';
  return 'none';
}

export function isSecretKey(key: string): boolean {
  return secretKeyKind(key) !== 'none';
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
  /** Cheap pre-check: the pattern only runs on strings matching it. */
  hint?: RegExp;
}

/** Words that appear in every secret key name (see `secretKeyKind`). */
const SECRET_KEY_HINT = /secret|passw|passphrase|pwd|key|auth|cookie|credential|token|pass/i;

/** Authentication schemes kept in clear before a redacted credential. */
const AUTH_SCHEMES = new Set(['bearer', 'basic', 'token', 'digest']);

/**
 * Patterns of well-known credentials. Order matters: specific before generic.
 *
 * Every pattern must run in linear time: a repeated class is never followed by
 * something that can fail after a long scan unless its start is anchored to the
 * beginning of a run (negative lookbehind on the same class), and open-ended
 * spans are bounded. Private key blocks are handled without a regex.
 */
const PATTERNS: SecretPattern[] = [
  // Cookie headers: everything up to the end of the line (or a closing quote).
  {
    name: 'cookie-header',
    regex: /(?<![A-Za-z0-9-])((?:set-)?cookie[ \t]*:[ \t]*)[^\r\n"'`]+/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // Authorization headers: "Bearer xyz", "Basic xyz".
  {
    name: 'auth-scheme',
    regex: /(?<![A-Za-z0-9])(Bearer|Basic|Token|Digest)[ \t]+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, scheme) => `${scheme} ${REDACTED}`,
  },
  // Anthropic, OpenAI project and OpenRouter keys, even short ones.
  {
    name: 'sk-prefixed',
    regex: /(?<![A-Za-z0-9_-])sk-(?:ant|proj|or-v1)-[A-Za-z0-9_-]{6,}/g,
    replace: REDACTED,
  },
  { name: 'sk-key', regex: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  {
    name: 'github',
    regex: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    replace: REDACTED,
  },
  { name: 'gitlab', regex: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  { name: 'huggingface', regex: /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{20,}/g, replace: REDACTED },
  { name: 'groq', regex: /(?<![A-Za-z0-9_])gsk_[A-Za-z0-9]{20,}/g, replace: REDACTED },
  {
    name: 'aws-access-key',
    regex: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/g,
    replace: REDACTED,
  },
  { name: 'google-api-key', regex: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g, replace: REDACTED },
  { name: 'slack', regex: /(?<![A-Za-z0-9-])xox[abposr]-[A-Za-z0-9-]{10,}/g, replace: REDACTED },
  {
    name: 'stripe',
    regex: /(?<![A-Za-z0-9_])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
    replace: REDACTED,
  },
  { name: 'telegram-bot', regex: /(?<![0-9])\d{8,10}:AA[A-Za-z0-9_-]{30,}/g, replace: REDACTED },
  {
    name: 'jwt',
    regex: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: REDACTED,
  },
  // Credentials embedded in URLs: scheme://user:pass@host
  {
    name: 'url-credentials',
    regex: /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s:@/]{1,256}:[^\s@/]{1,256}@/gi,
    replace: (_m, scheme) => `${scheme}${REDACTED}@`,
  },
  // key=value / key: value / "key": "value" inside free text (env dumps, query strings, JSON, YAML).
  {
    name: 'inline-assignment',
    regex:
      /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]{1,64})(["']?[ \t]*[:=][ \t]*)("[^"\r\n]{1,4096}"|'[^'\r\n]{1,4096}'|[^\s"'&,;]{4,})/g,
    hint: SECRET_KEY_HINT,
    replace: (match, key, sep, value) => {
      if (!isSecretKey(key)) return match;
      if (value.includes(REDACTED) || AUTH_SCHEMES.has(value.toLowerCase())) return match;
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${key}${sep}${quote}${REDACTED}${quote}`;
    },
  },
];

const PRIVATE_KEY_BEGIN = '-----BEGIN ';
const PRIVATE_KEY_HEADER = /[A-Z0-9 ]{0,40}PRIVATE KEY-----/y;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;

/**
 * Replaces PEM private key blocks in linear time. A block without its END line
 * is redacted up to the end of the string.
 */
function redactPrivateKeys(input: string): string {
  if (!input.includes(PRIVATE_KEY_BEGIN)) return input;
  let out = '';
  let pos = 0;
  for (;;) {
    const begin = input.indexOf(PRIVATE_KEY_BEGIN, pos);
    if (begin < 0) break;
    PRIVATE_KEY_HEADER.lastIndex = begin + PRIVATE_KEY_BEGIN.length;
    if (!PRIVATE_KEY_HEADER.test(input)) {
      out += input.slice(pos, begin + PRIVATE_KEY_BEGIN.length);
      pos = begin + PRIVATE_KEY_BEGIN.length;
      continue;
    }
    PRIVATE_KEY_END.lastIndex = PRIVATE_KEY_HEADER.lastIndex;
    const end = PRIVATE_KEY_END.exec(input);
    out += input.slice(pos, begin) + REDACTED;
    if (!end) return out;
    pos = end.index + end[0].length;
  }
  return out + input.slice(pos);
}

/** Strings longer than this are truncated before redaction (and marked). */
export const MAX_REDACTED_STRING_LENGTH = 256 * 1024;

const MIN_KNOWN_SECRET_LENGTH = 6;
const MAX_DEPTH = 32;

export interface Redactor {
  /** Registers a secret value (e.g. a loaded API key) to be masked wherever it appears. */
  addSecret(value: string): void;
  /** Masks secrets in a string. */
  redactString(value: string): string;
  /** Returns a deep copy of `value` with secrets masked. Never mutates the input. */
  redact<T>(value: T): T;
  /**
   * Masks only the registered secret values, not the patterns: for text an
   * agent may write back to a file (a pattern match would corrupt it).
   */
  redactKnown(value: string): string;
  /** True when `value` contains a registered secret. */
  containsKnown(value: string): boolean;
}

/** Whether the value stored under `key` must be replaced as a whole. */
function hidesValue(key: string, value: unknown): boolean {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return false;
  }
  const kind = secretKeyKind(key);
  if (kind === 'none') return false;
  // `tokens: 1200` is a count, `password: 1234` is not.
  return !(kind === 'token' && typeof value === 'number');
}

export function createRedactor(knownSecrets: Iterable<string> = []): Redactor {
  const secrets = new Set<string>();

  const addSecret = (value: string) => {
    if (typeof value === 'string' && value.length >= MIN_KNOWN_SECRET_LENGTH) secrets.add(value);
  };
  for (const s of knownSecrets) addSecret(s);

  const redactString = (input: string): string => {
    let out = input;
    let suffix = '';
    if (out.length > MAX_REDACTED_STRING_LENGTH) {
      suffix = `…[TRUNCATED ${out.length - MAX_REDACTED_STRING_LENGTH} chars]`;
      out = out.slice(0, MAX_REDACTED_STRING_LENGTH);
    }
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    out = redactPrivateKeys(out);
    for (const p of PATTERNS) {
      if (p.hint && !p.hint.test(out)) continue;
      p.regex.lastIndex = 0;
      out =
        typeof p.replace === 'string'
          ? out.replace(p.regex, p.replace)
          : out.replace(p.regex, p.replace);
    }
    return out + suffix;
  };

  const walk = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') return redactString(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth > MAX_DEPTH) return '[TRUNCATED]';
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        // A [name, value] pair, e.g. a header entry: ['x-api-key', '...'].
        if (value.length === 2 && typeof value[0] === 'string' && hidesValue(value[0], value[1])) {
          return [value[0], REDACTED];
        }
        return value.map((v) => walk(v, depth + 1, seen));
      }
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Error) {
        return { name: value.name, message: redactString(value.message) };
      }
      if (value instanceof Map) {
        return walk(Object.fromEntries(value), depth, seen);
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = hidesValue(k, v) ? REDACTED : walk(v, depth + 1, seen);
      }
      return out;
    } finally {
      seen.delete(value);
    }
  };

  const redactKnown = (input: string): string => {
    let out = input;
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out;
  };

  return {
    addSecret,
    redactString,
    redact: <T>(value: T) => walk(value, 0, new WeakSet()) as T,
    redactKnown,
    containsKnown: (value: string) => [...secrets].some((s) => value.includes(s)),
  };
}
