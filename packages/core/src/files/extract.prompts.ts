import { pick } from '@monsters/shared';

/*
 * The titles the text extracted from an attached file gets (D-153): the model reads them. The
 * Italian family is the one that always was; the English one is its twin. Picked when the file is
 * read, in the app's language at that moment.
 */

const en = {
  /** A sheet of a spreadsheet that has no name of its own. */
  sheet: (n: number) => `Sheet ${n}`,
  slide: (n: number) => `Slide ${n}`,
};

const it: typeof en = {
  sheet: (n) => `Foglio ${n}`,
  slide: (n) => `Diapositiva ${n}`,
};

export const extractPrompts = () => pick({ en, it });
