import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/*
 * Pairing of a Telegram account (ARCHITECTURE §5.8): the UI asks for a code,
 * the user sends `/start <code>` to the bot and their account joins the
 * whitelist. One code at a time, valid once, for a few minutes. Attempts are
 * counted per account: an account that sends 5 wrong codes is locked out of
 * this code, but cannot burn it for the others (a stranger who found the bot
 * must not be able to stop the owner from pairing). Only a crowd of accounts
 * (100 wrong codes in all) burns it: guessing 8 characters out of 31 stays
 * hopeless either way (~1e-10 with 100 tries).
 */

/** No 0/O, 1/I/L: the code is read on one screen and typed on another. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Wrong codes allowed to each account. */
export const PAIRING_MAX_ATTEMPTS = 5;
/** Wrong codes allowed to all accounts together, then the code is gone. */
export const PAIRING_MAX_TOTAL_ATTEMPTS = 100;

const digest = (s: string) => createHash('sha256').update(s).digest();

export type PairingResult = 'ok' | 'wrong_code' | 'expired' | 'no_code' | 'too_many_attempts';

interface ActiveCode {
  value: string;
  expiresAt: number;
  /** Wrong codes left for all accounts together. */
  attemptsLeft: number;
  /** Wrong codes sent by each account. */
  failures: Map<number | string, number>;
}

export class Pairing {
  readonly #ttlMs: number;
  readonly #maxAttempts: number;
  readonly #maxTotal: number;
  readonly #now: () => number;
  #code: ActiveCode | null = null;

  constructor(
    options: {
      ttlMs?: number;
      maxAttempts?: number;
      maxTotalAttempts?: number;
      now?: () => number;
    } = {},
  ) {
    this.#ttlMs = options.ttlMs ?? PAIRING_TTL_MS;
    this.#maxAttempts = options.maxAttempts ?? PAIRING_MAX_ATTEMPTS;
    this.#maxTotal = options.maxTotalAttempts ?? PAIRING_MAX_TOTAL_ATTEMPTS;
    this.#now = options.now ?? Date.now;
  }

  /** A new code; the previous one stops working. */
  create(): { code: string; expiresAt: number; attemptsLeft: number } {
    let value = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) value += ALPHABET[randomInt(ALPHABET.length)];
    this.#code = {
      value,
      expiresAt: this.#now() + this.#ttlMs,
      attemptsLeft: this.#maxTotal,
      failures: new Map(),
    };
    return { code: value, expiresAt: this.#code.expiresAt, attemptsLeft: this.#maxTotal };
  }

  cancel(): void {
    this.#code = null;
  }

  /** The active code without its value, or null. */
  view(): { expiresAt: number; attemptsLeft: number } | null {
    const c = this.#code;
    if (!c) return null;
    if (this.#now() >= c.expiresAt) {
      this.#code = null;
      return null;
    }
    return { expiresAt: c.expiresAt, attemptsLeft: c.attemptsLeft };
  }

  /** Wrong codes sent by `account` for the active code. */
  failures(account: number | string): number {
    return this.#code?.failures.get(account) ?? 0;
  }

  /** Checks a code sent to the bot by `account`. `ok` uses the code up. */
  attempt(given: string, account: number | string = 'anonymous'): PairingResult {
    const c = this.#code;
    if (!c) return 'no_code';
    if (this.#now() >= c.expiresAt) {
      this.#code = null;
      return 'expired';
    }
    const used = c.failures.get(account) ?? 0;
    // Locked out of this code, even with the right one.
    if (used >= this.#maxAttempts) return 'too_many_attempts';
    const normalised = given.trim().toUpperCase().replace(/[\s-]/g, '');
    if (timingSafeEqual(digest(normalised), digest(c.value))) {
      this.#code = null;
      return 'ok';
    }
    c.failures.set(account, used + 1);
    c.attemptsLeft--;
    if (c.attemptsLeft <= 0) {
      this.#code = null;
      return 'too_many_attempts';
    }
    return used + 1 >= this.#maxAttempts ? 'too_many_attempts' : 'wrong_code';
  }
}
