import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the OWASP-recommended baseline (19 MiB, 2 iterations, 1 lane).
 * `@node-rs/argon2` ships prebuilt binaries for every platform: no compiler needed.
 * Its default algorithm is argon2id.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
