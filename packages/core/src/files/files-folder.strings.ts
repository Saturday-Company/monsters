import type { VaultLayoutId } from '@monsters/shared';

/*
 * The two files Monsters writes in its files folder (D-075), in the words of the vault's layout
 * (D-154), never of the app's language: they are on disk and written once. The Italian texts
 * are those of every files folder made before D-154.
 */

const en = {
  /** `.monsters`: the folder is Monsters', never a folder of the user. */
  marker:
    'This folder belongs to Monsters: it holds the attachments, the screenshots and the pages of the monsters.\n',
  /** `.gitignore`: the files stay out of the history of the notes. */
  gitignore:
    '# Monsters: the files attached and made by the monsters stay out of the history of the notes\n*\n',
};

const it: typeof en = {
  marker:
    'Questa cartella è di Monsters: qui ci sono gli allegati, gli screenshot e le pagine dei mostri.\n',
  gitignore:
    '# Monsters: i file allegati e creati dai mostri non entrano nella cronologia delle note\n*\n',
};

const TEXTS: Record<VaultLayoutId, typeof en> = { en, it };

export function filesFolderStrings(layout: VaultLayoutId): typeof en {
  return TEXTS[layout];
}
