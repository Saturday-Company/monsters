import { defineStrings } from '../../lib/i18n.ts';

/* The Files section and the file chips (D-153). */

const en = {
  filters: { all: 'All', images: 'Images', documents: 'Documents', monsters: 'From the monsters' },
  deleted: (name: string) => `I deleted ${name}.`,
  openLabel: (name: string) => `${name}: open in the preview`,
  download: (name: string) => `Download ${name}`,
  downloadTitle: 'Download',
  deleteArmedLabel: (name: string) => `Press again to delete ${name}`,
  deleteLabel: (name: string) => `Delete ${name}`,
  deleteArmedTitle: 'Press again to delete',
  delete: 'Delete',
  again: 'Again',
  emptyTitle: (filtered: boolean): string => (filtered ? 'No files like that' : 'No files yet'),
  emptyText: (filtered: boolean): string =>
    filtered
      ? 'Try another filter, or search for another name.'
      : 'Attach images and documents from the chat with the paperclip, paste them or drag them in. The monsters’ screenshots and pages end up here too.',
  title: 'Files',
  which: 'Which files',
  searchLabel: 'Search the names and text of the files',
  searchPlaceholder: 'Search files',
  clearSearch: 'Clear the search',
  count: (n: number) => (n === 1 ? '1 file' : `${n} files`),
  loading: 'Loading…',
  list: 'Files',
  chip: {
    uploading: (name: string) => `Uploading ${name}`,
    openTitle: (name: string) => `Open ${name} in the preview`,
    openLabel: (name: string, meta: string) => `${name}, ${meta}: open in the preview`,
    removeLabel: (name: string) => `Remove ${name}`,
    remove: 'Remove',
    imageLabel: (name: string) => `${name}, image: open in the preview`,
    gone: 'File deleted',
  },
};
const it: typeof en = {
  filters: { all: 'Tutti', images: 'Immagini', documents: 'Documenti', monsters: 'Dai mostri' },
  deleted: (name) => `Ho eliminato ${name}.`,
  openLabel: (name) => `${name}: apri nell’anteprima`,
  download: (name) => `Scarica ${name}`,
  downloadTitle: 'Scarica',
  deleteArmedLabel: (name) => `Premi di nuovo per eliminare ${name}`,
  deleteLabel: (name) => `Elimina ${name}`,
  deleteArmedTitle: 'Premi di nuovo per eliminare',
  delete: 'Elimina',
  again: 'Di nuovo',
  emptyTitle: (filtered) => (filtered ? 'Nessun file così' : 'Ancora nessun file'),
  emptyText: (filtered) =>
    filtered
      ? 'Prova un altro filtro, o cerca un altro nome.'
      : 'Allega immagini e documenti dalla chat con la graffetta, incollali o trascinali. Qui finiscono anche gli screenshot e le pagine dei mostri.',
  title: 'File',
  which: 'Quali file',
  searchLabel: 'Cerca nei nomi e nel testo dei file',
  searchPlaceholder: 'Cerca nei file',
  clearSearch: 'Cancella la ricerca',
  count: (n) => (n === 1 ? '1 file' : `${n} file`),
  loading: 'Carico…',
  list: 'File',
  chip: {
    uploading: (name) => `Carico ${name}`,
    openTitle: (name) => `Apri ${name} nell’anteprima`,
    openLabel: (name, meta) => `${name}, ${meta}: apri nell’anteprima`,
    removeLabel: (name) => `Togli ${name}`,
    remove: 'Togli',
    imageLabel: (name) => `${name}, immagine: apri nell’anteprima`,
    gone: 'File eliminato',
  },
};

export const filesStrings = defineStrings({ en, it });
