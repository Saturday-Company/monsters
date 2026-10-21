import type { FileKind } from '@monsters/shared';
import { defineStrings } from './i18n.ts';

/* Files in the web app: kinds, sources, why a file can't be attached (D-153). */

const en = {
  empty: 'The file is empty.',
  tooBig: 'Too big: 25 MB at most.',
  heic: 'HEIC photos can’t be read yet: export it as JPEG.',
  html: 'HTML pages can’t be attached.',
  notAllowed: 'This type of file can’t be attached: images, PDFs, text and Office documents can.',
  kinds: {
    image: 'Image',
    pdf: 'PDF',
    document: 'Document',
    sheet: 'Sheet',
    text: 'Text',
    html: 'Page',
    other: 'File',
  } satisfies Record<FileKind, string>,
  pasted: 'pasted image',
  fromYou: 'From you',
  aMonster: 'a monster',
  screenshotOf: (who: string) => `Screenshot by ${who}`,
  fromWho: (who: string) => `From ${who}`,
  pageOf: (who: string) => `Page by ${who}`,
};
const it: typeof en = {
  empty: 'Il file è vuoto.',
  tooBig: 'Troppo grande: al massimo 25 MB.',
  heic: 'Le foto HEIC non si leggono ancora: esportala in JPEG.',
  html: 'Le pagine HTML non si allegano.',
  notAllowed: 'Questo tipo di file non si allega: immagini, PDF, testo e documenti Office sì.',
  kinds: {
    image: 'Immagine',
    pdf: 'PDF',
    document: 'Documento',
    sheet: 'Foglio',
    text: 'Testo',
    html: 'Pagina',
    other: 'File',
  },
  pasted: 'immagine incollata',
  fromYou: 'Da te',
  aMonster: 'un mostro',
  screenshotOf: (who) => `Screenshot di ${who}`,
  fromWho: (who) => `Da ${who}`,
  pageOf: (who) => `Pagina di ${who}`,
};

export const filesLibStrings = defineStrings({ en, it });
