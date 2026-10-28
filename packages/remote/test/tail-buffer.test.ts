import { describe, expect, it } from 'vitest';
import { TailBuffer } from '../src/errors.ts';

describe('TailBuffer', () => {
  it('keeps a character cut between two chunks of the output whole', () => {
    const bytes = Buffer.from('connessione già chiusa: perché', 'utf8');
    const tail = new TailBuffer();
    // Every chunk ends in the middle of a character where there is one.
    let from = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i]! >= 0xc0) {
        tail.push(bytes.subarray(from, i + 1));
        from = i + 1;
      }
    }
    tail.push(bytes.subarray(from));
    expect(tail.toString()).toBe('connessione già chiusa: perché');
  });

  it('takes strings as they are and keeps only the end', () => {
    const tail = new TailBuffer(5);
    tail.push('abc');
    tail.push(Buffer.from('defgh'));
    expect(tail.toString()).toBe('defgh');
  });
});
