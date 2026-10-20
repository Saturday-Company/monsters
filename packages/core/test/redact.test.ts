import { describe, expect, it } from 'vitest';
import { createRedactor, isSecretKey, MAX_REDACTED_STRING_LENGTH, REDACTED } from '../src/index.ts';

const r = createRedactor();
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('redaction of the cases found in review', () => {
  it('masks values under secret-looking keys, matched on the normalised name', () => {
    const out = r.redact({
      aws_secret_access_key: AWS_SECRET,
      secretAccessKey: AWS_SECRET,
      apiKeys: ['k1k1k1k1k1k1'],
      apikey_value: 'vvvvvvvvvvvv',
      headers: {
        'X-Api-Key': 'zzzzzzzzzzzz',
        'x-auth-token': 'yyyyyyyyyyyy',
        'X-Goog-Api-Key': 'q',
      },
      dbCredentials: { user: 'u', pass: 'p' },
      privateKeyPem: 'abc',
      auth: 'aaaaaaaaaaaa',
      pass: 'pppppppppppp',
      sessionCookie: 'c',
      // Counters are not credentials.
      inputTokens: 1200,
      outputTokens: 30,
      tokenCount: 5,
      tokens: 77,
      author: 'giulio',
      keyword: 'monsters',
    });
    expect(out).toEqual({
      aws_secret_access_key: REDACTED,
      secretAccessKey: REDACTED,
      apiKeys: REDACTED,
      apikey_value: REDACTED,
      headers: { 'X-Api-Key': REDACTED, 'x-auth-token': REDACTED, 'X-Goog-Api-Key': REDACTED },
      dbCredentials: REDACTED,
      privateKeyPem: REDACTED,
      auth: REDACTED,
      pass: REDACTED,
      sessionCookie: REDACTED,
      inputTokens: 1200,
      outputTokens: 30,
      tokenCount: 5,
      tokens: 77,
      author: 'giulio',
      keyword: 'monsters',
    });
    for (const k of ['AWS_SECRET_ACCESS_KEY', 'x-amz-security-token', 'client-credential']) {
      expect(isSecretKey(k)).toBe(true);
    }
    for (const k of ['maxTokens', 'totalTokens', 'cachedInputTokens', 'tokenizer']) {
      expect(isSecretKey(k)).toBe(false);
    }
  });

  it('masks [name, value] pairs in arrays (header lists)', () => {
    expect(
      r.redact([
        ['x-api-key', 'abcdef1234567890'],
        ['Cookie', 'session=abcdef1234567890'],
        ['Authorization', 'Basic dXNlcjpwYXNz'],
        ['content-type', 'application/json'],
      ]),
    ).toEqual([
      ['x-api-key', REDACTED],
      ['Cookie', REDACTED],
      ['Authorization', REDACTED],
      ['content-type', 'application/json'],
    ]);
  });

  it('masks secrets inside free text', () => {
    const session = 'K1zsAHdMwJfuThTsUaOkp3fmKfsamydNzlV0AjF7rjI';
    const cases: [string, string][] = [
      [`Cookie: monsters_session=${session}`, `Cookie: ${REDACTED}`],
      [`set-cookie: monsters_session=${session}; Path=/; HttpOnly`, `set-cookie: ${REDACTED}`],
      ['password: "frase con spazi dentro"', `password: "${REDACTED}"`],
      ["passphrase = 'altra frase segreta'", `passphrase = '${REDACTED}'`],
      [
        '{"password": "hunter22", "api_key":"xyzxyzxyz"}',
        `{"password": "${REDACTED}", "api_key":"${REDACTED}"}`,
      ],
      [`AWS_SECRET_ACCESS_KEY=${AWS_SECRET}`, `AWS_SECRET_ACCESS_KEY=${REDACTED}`],
      ['GH_TOKEN=abcdef1234567', `GH_TOKEN=${REDACTED}`],
      [`token ${'hf_' + 'A'.repeat(34)}`, `token ${REDACTED}`],
      ['ghp_0123456789abcdefghijABCDEFGHIJ', REDACTED],
      ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', REDACTED],
      ['xoxb-1234567890-abcdefghij', REDACTED],
      ['xoxp-1234567890-abcdefghij', REDACTED],
      ['id AKIAIOSFODNN7EXAMPLE', `id ${REDACTED}`],
      ['sk-ant-api03-xxxxxxxxxx', REDACTED],
      ['sk-proj-abcdef', REDACTED],
      [`use sk-or-v1-${'a1b2c3d4'.repeat(8)} now`, `use ${REDACTED} now`],
      [
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        `jwt ${REDACTED}`,
      ],
      [
        '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY----- ok',
        `${REDACTED} ok`,
      ],
      ['-----BEGIN RSA PRIVATE KEY-----\nabc truncated', REDACTED],
    ];
    for (const [input, expected] of cases) expect(r.redactString(input), input).toBe(expected);
    for (const clean of [
      'nothing secret here, 42 tokens used',
      'max_tokens=4096 temperature=0.2',
      'the author: Giulio',
      'see https://example.com/path?q=1',
    ]) {
      expect(r.redactString(clean)).toBe(clean);
    }
  });
});

describe('redaction performance', () => {
  /** Inputs that made the old patterns backtrack (quadratic or worse). */
  const pathological: Record<string, string> = {
    'BEGIN without END': '-----BEGIN RSA PRIVATE KEY-----'.repeat(32_000),
    'dotted scheme': 'a.'.repeat(500_000),
    'url credentials': `a://${'b:'.repeat(500_000)}`,
    'bearer words': 'Bearer '.repeat(150_000),
    'jwt-like': 'eyJ-'.repeat(250_000),
    assignments: 'a="'.repeat(330_000),
    'secret assignments': 'token="'.repeat(130_000),
    'long key': 'k'.repeat(1_000_000),
  };

  for (const [name, input] of Object.entries(pathological)) {
    it(`redacts 1 MB (${name}) in under 250 ms (catastrophic backtracking took ~5 s)`, () => {
      expect(input.length).toBeGreaterThan(900_000);
      r.redactString(input.slice(0, 1000)); // warm up the regexes
      const t0 = performance.now();
      const out = r.redactString(input);
      expect(performance.now() - t0).toBeLessThan(250);
      // Truncated to MAX_REDACTED_STRING_LENGTH before redaction (masks may lengthen it a bit).
      expect(out.length).toBeLessThan(2 * MAX_REDACTED_STRING_LENGTH);
    });
  }

  it('truncates huge strings with a marker, after redacting what it keeps', () => {
    const input = `key sk-or-v1-${'0'.repeat(32)} ${'x'.repeat(400_000)}`;
    const out = r.redactString(input);
    expect(out.startsWith(`key ${REDACTED} `)).toBe(true);
    expect(out).toMatch(/…\[TRUNCATED \d+ chars\]$/);
  });
});
