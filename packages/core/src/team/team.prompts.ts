import { pick } from '@monsters/shared';

/*
 * What the team service writes for the models to read (D-153, wave 3): the text a new
 * `MEMORY.md` starts with. It follows the app's language at the moment the file is created;
 * the files that already exist are never rewritten, and nothing parses the header back. The
 * vault writes the same text when it creates the file itself (`memoryNote` in
 * `@monsters/vault`): keep them equal.
 */

const en = {
  memoryIndex: (name: string) =>
    `# Memory of ${name}\n\nShort index of ${name}’s memory: one line per item, with the link to the detail note.\n`,
};

const it: typeof en = {
  memoryIndex: (name) =>
    `# Memoria di ${name}\n\nIndice corto della memoria di ${name}: una riga per voce, con il link alla nota di dettaglio.\n`,
};

export const teamPrompts = () => pick({ en, it });
