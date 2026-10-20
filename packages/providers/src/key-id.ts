import { createHash } from 'node:crypto';

/*
 * Fingerprint of an API key (DECISIONS D-019): the first 12 hex digits of a
 * SHA-256 of the key. It tells the requests of two keys apart in the event log
 * (a new key may be another account, with its own daily quota) without
 * revealing anything usable: 48 bits of a hash of a long random secret.
 */

export const KEY_ID_PATTERN = /^[0-9a-f]{12}$/;

export function keyFingerprint(key: string): string {
  return createHash('sha256').update(`monsters:key:${key.trim()}`).digest('hex').slice(0, 12);
}
