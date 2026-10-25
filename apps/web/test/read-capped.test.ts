import { describe, expect, it } from 'vitest';
import { readCappedText } from '../src/components/preview/read-capped.ts';

/* A text file in the preview is read up to its limit and the download stops there (W-38). */

/** A response whose body comes in the given pieces; `state.cancelled` says if the reader let go. */
function streamed(pieces: Uint8Array[]) {
  const state = { cancelled: false, pulled: 0 };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pieces[i++];
      if (next) {
        state.pulled++;
        controller.enqueue(next);
      } else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { res: new Response(body), state };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('readCappedText', () => {
  it('reads a small file whole', async () => {
    const { res } = streamed([bytes('hello '), bytes('world')]);
    expect(await readCappedText(res, 100)).toEqual({ text: 'hello world', cut: false });
  });

  it('a file of exactly the limit is not cut', async () => {
    const { res } = streamed([bytes('abcde'), bytes('fghij')]);
    expect(await readCappedText(res, 10)).toEqual({ text: 'abcdefghij', cut: false });
  });

  it('stops at the limit, says it is cut, and lets the download go', async () => {
    const piece = bytes('x'.repeat(1000));
    const { res, state } = streamed(Array.from({ length: 500 }, () => piece));
    const out = await readCappedText(res, 2500);
    expect(out.cut).toBe(true);
    expect(out.text).toHaveLength(2500);
    expect(state.cancelled).toBe(true);
    // It did not read the half megabyte the file has.
    expect(state.pulled).toBeLessThan(10);
  });

  it('a character split between two pieces stays whole, one split by the limit goes', async () => {
    const euro = bytes('€'); // 3 bytes
    const whole = await readCappedText(streamed([euro.slice(0, 1), euro.slice(1)]).res, 10);
    expect(whole).toEqual({ text: '€', cut: false });
    // The limit falls inside the second euro sign: no replacement character in the text.
    const cut = await readCappedText(streamed([bytes('a€€b')]).res, 5);
    expect(cut).toEqual({ text: 'a€', cut: true });
  });

  it('works for a response without a readable body', async () => {
    const res = new Response(bytes('abcdef'));
    Object.defineProperty(res, 'body', { value: null });
    expect(await readCappedText(res, 4)).toEqual({ text: 'abcd', cut: true });
  });
});
