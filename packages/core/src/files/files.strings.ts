import { pick } from '@monsters/shared';

/* What a person reads when a file is refused (D-153), in the words of the composer. */

const en = {
  heic: 'HEIC photos can’t be read yet: export it as JPEG and try again.',
  avif: 'AVIF images can’t be read yet: use PNG, JPEG or WebP.',
  html: 'HTML pages can’t be attached: only the monsters create them.',
  svg: 'SVG images can’t be attached: use PNG, JPEG or WebP.',
  other: 'This type of file can’t be attached: images, PDFs, text and Office documents can.',
  tooLarge: 'The file is too large.',
  empty: 'The file is empty.',
};

const it: typeof en = {
  heic: 'Le foto HEIC non si leggono ancora: esportala in JPEG e riprova.',
  avif: 'Le immagini AVIF non si leggono ancora: usa PNG, JPEG o WebP.',
  html: 'Le pagine HTML non si allegano: le creano solo i mostri.',
  svg: 'Le immagini SVG non si allegano: usa PNG, JPEG o WebP.',
  other: 'Questo tipo di file non si può allegare: immagini, PDF, testo e documenti Office sì.',
  tooLarge: 'Il file è troppo grande.',
  empty: 'Il file è vuoto.',
};

export const fileStrings = () => pick({ en, it });
