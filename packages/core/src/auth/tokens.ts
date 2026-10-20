import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url encoded. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored hashed: a leaked database does not leak usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Crockford base32: easy to read and type. */
const SETUP_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** One-time setup code: 12 symbols (60 bits) shown as `XXXX-XXXX-XXXX`. */
export function generateSetupCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += SETUP_ALPHABET[(bytes[i] ?? 0) & 31];
    if (i === 3 || i === 7) code += '-';
  }
  return code;
}

/** Uppercase, without spaces and dashes, with the usual look-alikes mapped. */
export function normaliseSetupCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
