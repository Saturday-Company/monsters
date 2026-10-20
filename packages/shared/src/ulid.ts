import { z } from 'zod';

/** Crockford base32 alphabet used by ULIDs. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const MAX_TIME = 2 ** 48 - 1;

export const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const UlidSchema = z.string().regex(ULID_REGEX, 'invalid ULID');
export type Ulid = z.infer<typeof UlidSchema>;

function encodeTime(time: number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new RangeError(`ULID time out of range: ${time}`);
  }
  let out = '';
  let t = time;
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = t % 32;
    out = ENCODING.charAt(mod) + out;
    t = (t - mod) / 32;
  }
  return out;
}

function randomDigits(): number[] {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b % 32);
}

/** Increments a base32 digit array in place; returns false on overflow. */
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i] ?? 0;
    if (d < 31) {
      digits[i] = d + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

export type UlidFactory = (time?: number) => Ulid;

/**
 * Creates a monotonic ULID generator: ids generated within the same millisecond
 * (or with a clock that went backwards) still sort strictly after the previous one.
 */
export function monotonicUlidFactory(): UlidFactory {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return (time = Date.now()) => {
    if (time <= lastTime) {
      if (!increment(lastRandom)) {
        lastTime += 1;
        lastRandom = randomDigits();
      }
    } else {
      lastTime = time;
      lastRandom = randomDigits();
    }
    return encodeTime(lastTime) + lastRandom.map((d) => ENCODING.charAt(d)).join('');
  };
}

const defaultFactory = monotonicUlidFactory();

/** Generates a monotonic ULID. */
export function ulid(time?: number): Ulid {
  return defaultFactory(time);
}

/** Extracts the millisecond timestamp encoded in a ULID. */
export function ulidTime(id: Ulid): number {
  let time = 0;
  for (const char of id.slice(0, TIME_LEN)) {
    const value = ENCODING.indexOf(char);
    if (value < 0) throw new TypeError(`invalid ULID: ${id}`);
    time = time * 32 + value;
  }
  return time;
}
