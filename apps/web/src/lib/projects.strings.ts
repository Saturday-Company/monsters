import { defineStrings } from './i18n.ts';

/* Projects in the UI: names, plans in words (D-153). */

const en = {
  personalSquad: 'Personal squad',
  nameInvalid: 'Letters, numbers, spaces, apostrophes and hyphens only (40 at most).',
  nameEmpty: 'Give the project a name.',
  nameTaken: (name: string) => `There’s already a project called ${name}.`,
  copyDetail: (source: string) => `with ${source}’s role and rules; its own name, look and memory`,
  newLeadDetail: 'new, with a memory of its own',
};
const it: typeof en = {
  personalSquad: 'Squadra personale',
  nameInvalid: 'Solo lettere, numeri, spazi, apostrofi e trattini (al massimo 40).',
  nameEmpty: 'Dai un nome al progetto.',
  nameTaken: (name) => `C’è già un progetto che si chiama ${name}.`,
  copyDetail: (source) => `con il ruolo e le regole di ${source}; nome, aspetto e memoria suoi`,
  newLeadDetail: 'nuovo, con una memoria sua',
};

export const projectsLibStrings = defineStrings({ en, it });
