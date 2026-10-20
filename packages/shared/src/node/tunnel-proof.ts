import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Proof that the far end of an SSH tunnel is the remote core (D-044, M3.6). The core
 * draws a random key at every start and writes it in its `server.json` (600); the
 * client reads that file over SSH (authenticated, host key checked), sends a fresh
 * nonce to `/api/health?proof=<nonce>` through the tunnel and checks the HMAC. Only
 * the core that wrote the key can answer: another local user who took the port of the
 * tunnel, or another user of the remote computer who took the core's port while the
 * core was off, cannot.
 */

const LABEL = 'monsters-tunnel-proof/v1\n';
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

/** A new key for the core (base64url, 256 bits). */
export function newTunnelProofKey(): string {
  return randomBytes(32).toString('base64url');
}

/** A new nonce for the client (base64url, 256 bits). */
export function newTunnelProofNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function isTunnelProofNonce(nonce: unknown): nonce is string {
  return typeof nonce === 'string' && NONCE.test(nonce);
}

/** The answer of the core: HMAC-SHA256(key, label + nonce), base64url. */
export function tunnelProof(key: string, nonce: string): string {
  return createHmac('sha256', key).update(LABEL).update(nonce).digest('base64url');
}

/** Constant-time check of an answer, on the client. */
export function checkTunnelProof(key: string, nonce: string, answer: unknown): boolean {
  if (typeof answer !== 'string') return false;
  const expected = Buffer.from(tunnelProof(key, nonce));
  const got = Buffer.from(answer);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
