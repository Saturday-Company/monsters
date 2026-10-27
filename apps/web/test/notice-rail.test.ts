import { describe, expect, it } from 'vitest';
import { noticePlaceFor } from '../src/store/notice-rail.ts';

/* Where the message of the shell is drawn, by the free room the rail has for it. */

describe('noticePlaceFor', () => {
  it('shows the sentence from 240 px, the key from 104, the light from 36', () => {
    expect(noticePlaceFor(460)).toBe('chip');
    expect(noticePlaceFor(240)).toBe('chip');
    expect(noticePlaceFor(239)).toBe('key');
    expect(noticePlaceFor(104)).toBe('key');
    expect(noticePlaceFor(103)).toBe('icon');
    expect(noticePlaceFor(36)).toBe('icon');
  });

  it('falls back to the band when the rail has no room, or is not there', () => {
    expect(noticePlaceFor(35)).toBe('band');
    expect(noticePlaceFor(-80)).toBe('band');
    expect(noticePlaceFor(null)).toBe('band');
  });

  it('gives the chip the room before it is measured (infinite)', () => {
    expect(noticePlaceFor(Number.POSITIVE_INFINITY)).toBe('chip');
  });
});
