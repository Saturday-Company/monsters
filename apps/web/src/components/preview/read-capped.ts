/*
 * A text file read up to a limit (W-38). The body is read in pieces and the download is
 * stopped at the limit, so a huge log costs `max` bytes of memory and network and not its size.
 */

export interface CappedText {
  text: string;
  /** There was more than `max` bytes: the end is not shown. */
  cut: boolean;
}

export async function readCappedText(res: Response, max: number): Promise<CappedText> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    const cut = buf.byteLength > max;
    return { text: new TextDecoder('utf-8').decode(cut ? buf.slice(0, max) : buf), cut };
  }
  // `stream` keeps a character split between two pieces whole, and drops one split by the limit.
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), cut: false };
    const room = max - bytes;
    if (value.byteLength > room) {
      text += decoder.decode(value.subarray(0, room), { stream: true });
      await reader.cancel().catch(() => {});
      return { text, cut: true };
    }
    text += decoder.decode(value, { stream: true });
    bytes += value.byteLength;
  }
}
