import { pick } from '@monsters/shared';

/*
 * The text a new `MEMORY.md` starts with (D-153, wave 3): the file a monster reads at the start
 * of every job. It follows the app's language at the moment it is created; the files that
 * already exist are never rewritten, and nothing parses this header back. The core writes the
 * same text when it creates the file itself (`team.prompts.ts` in `@monsters/core`): keep them equal.
 */

const en = {
  memoryNote: (name: string) => `# Memory of ${name}

Short index of ${name}’s memory: one line per item, with the link to the detail note.
`,
};

const it: typeof en = {
  memoryNote: (name) => `# Memoria di ${name}

Indice corto della memoria di ${name}: una riga per voce, con il link alla nota di dettaglio.
`,
};

export const scaffoldPrompts = () => pick({ en, it });
