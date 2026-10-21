import { runtimePrompts } from './runtime.prompts.ts';

/*
 * Invisible characters in third-party text (D-070, research 07 \u00A75.2): a page
 * or a tool result can carry instructions the user never sees and the model
 * reads. Removed before the text reaches a model:
 * - Unicode tags (U+E0000-E007F): ASCII written invisibly ("ASCII smuggling");
 * - variation selectors supplement (U+E0100-E01EF): bytes hidden behind an
 *   emoji ("emoji smuggling");
 * - zero-width and joiners (U+200B-200D, U+2060-2064, U+FEFF, U+180E), the soft
 *   hyphen (U+00AD) and the word joiner;
 * - bidi controls (U+200E-200F, U+202A-202E, U+2066-2069, U+061C): text that
 *   reads one way and is another ("Trojan Source").
 * Emoji keep their presentation selector (U+FE0F) and their skin tones; a
 * family emoji becomes its people side by side (the joiner goes): nothing a
 * monster needs to read is lost. Only tags and smuggled selectors are a
 * signal worth an event: zero-width spaces are common in ordinary HTML.
 */

/** Hidden ASCII and smuggled bytes: an attack, not typography. */
// The classes list code points on purpose: selectors are what is being removed.
// eslint-disable-next-line no-misleading-character-class
const HIDDEN_CHAR = /^[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]$/u;
/** Formatting that does not show: removed silently. */
const FORMAT = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Where hidden characters were, in the Italian family: the model reads a mark instead. */
export const HIDDEN_TEXT_MARK = runtimePrompts('it').hiddenTextMark;

/** The mark of the family of the app's language at the moment it is written (D-153). */
export const hiddenTextMark = (): string => runtimePrompts().hiddenTextMark;

export interface InvisibleResult {
  text: string;
  /** Tags and smuggled selectors removed (each run became one mark). */
  hidden: number;
  /** Other invisible characters removed. */
  format: number;
}

export function stripInvisible(text: string): InvisibleResult {
  let hidden = 0;
  let format = 0;
  // A run of hidden characters (with formatting inside it) becomes one mark.
  let out = text.replace(
    // eslint-disable-next-line no-misleading-character-class
    /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}][\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\u200B-\u200D\u2060\uFEFF]*/gu,
    (run) => {
      hidden += [...run].filter((c) => HIDDEN_CHAR.test(c)).length;
      return hiddenTextMark();
    },
  );
  out = out.replace(FORMAT, () => {
    format++;
    return '';
  });
  return { text: out, hidden, format };
}

/** Only the text (for places that do not report what was removed). */
export function withoutInvisible(text: string): string {
  return stripInvisible(text).text;
}
