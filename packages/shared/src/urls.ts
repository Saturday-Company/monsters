/*
 * Web addresses written in running text (D-073). A model may close a link
 * with a bracket or a quote of another script: "【https://galbani.it/ricetta】"
 * (seen in the eval of 16/10, D-071), «https://…», “https://…”. Those
 * characters never belong to an address as written by people (they would be
 * percent-encoded), so they end it, like a space.
 */

/** Brackets, quotes and full-width punctuation that end an address in a text. */
export const URL_STOP_CHARS =
  '【】〔〕〖〗〘〙〚〛〈〉《》「」『』（）［］｛｝«»‹›“”„‘’‚、。，；：！？';

/** An address in a text: up to a space, an ASCII delimiter or one of `URL_STOP_CHARS`. */
export const URL_IN_TEXT = new RegExp(
  `https?:\\/\\/[^\\s<>"'\`)\\]\\\\|{}${URL_STOP_CHARS}]+`,
  'giu',
);

/** Punctuation that ends a sentence after an address, not the address. */
const TRAILING = new Set([...`.,;:!?*_~${URL_STOP_CHARS}`]);

/**
 * An address without the punctuation a sentence put after it. A loop from the
 * end, not `/[…]+$/`: that regex tries every dot of `https://x/.....a` to the
 * end, the square of the length (D-074: 40,000 dots took 1.2 s).
 */
export function trimUrlEnd(url: string): string {
  let end = url.length;
  while (end > 0) {
    // The stop characters are all in the BMP: one UTF-16 unit each.
    if (!TRAILING.has(url[end - 1]!)) break;
    end--;
  }
  return end === url.length ? url : url.slice(0, end);
}
