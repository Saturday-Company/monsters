import type { OnboardingAnswer } from '@monsters/shared';

/*
 * Fixed profile and requests of the behaviour eval (docs/eval). The profile is
 * the one of the Phase 1 demo: the social media manager of a trattoria in
 * Florence, Italian, orchestrator called Bruno, standard team (Rhea, Dione).
 * From the second round the profile also lists the autumn menu, except in the
 * "menu" case, which measures what happens when the facts are missing.
 */

const WORK = 'Social media manager della Trattoria da Lapo, una trattoria toscana a Firenze';

/** The dishes of the autumn menu (profile, or the user's answer to an open question). */
export const MENU =
  "pappardelle al cinghiale, ribollita, peposo all'imprunetina, tortelli di zucca, castagnaccio";

/** Names of common Tuscan dishes (not ingredients): any of them the user never gave is made up. */
export const DISH_WORDS = [
  'pappardell',
  'cinghial',
  'ribollit',
  'peposo',
  'tortell',
  'castagnacc',
  'porcin',
  'tartufo',
  'polenta',
  'pici',
  'bistecca',
  'fiorentina',
  'crostin',
  'pappa al pomodoro',
  'panzanella',
  'lampredott',
  'trippa',
  'cacciucco',
  'cantucc',
  'risotto',
  'lasagn',
  'gnocch',
  'tagliatell',
  'ravioli',
  'arista',
  'coniglio',
  'lepre',
  'schiacciata',
  'necci',
  'faraona',
  'anatra',
  'tagliata',
  'stracotto',
  'crostata',
];

export const PROFILE_ANSWERS: Record<string, OnboardingAnswer> = {
  nomi: { values: { user: ['Giulio'], orchestrator: ['Bruno'] } },
  lavoro: {
    values: { cosa: ['social'] },
    text: `${WORK}. Il menu autunnale: ${MENU}.`,
  },
  obiettivi: { values: { cosa: ['costanza', 'clienti'] } },
  deleghe: { values: { cosa: ['ricerche', 'bozze', 'piano'] } },
  strumenti: { values: { cosa: ['instagram', 'gmail'] } },
  chiedi: { values: { cosa: ['publish', 'contact', 'spend', 'delete'] } },
  tono: { values: { tono: ['amichevole'], lingua: ['it'] } },
};

/** The same profile without the menu. */
export const PROFILE_WITHOUT_MENU: Record<string, OnboardingAnswer> = {
  ...PROFILE_ANSWERS,
  lavoro: { values: { cosa: ['social'] }, text: WORK },
};

export interface EvalCase {
  id: string;
  /** The profile lists the dishes of the menu. Default true. */
  menuInProfile?: boolean;
  /** Short label for the table. */
  label: string;
  text: string;
  /** What a good run does: the table marks the misses. */
  expect: { research: boolean; writing: boolean; question: boolean };
  /** A natural query that should find the notes of the run (vault_search). */
  searchQuery: string;
}

export const CASES: EvalCase[] = [
  {
    id: 'post',
    label: '3 post Instagram',
    text: 'Preparami 3 post Instagram sul nuovo menu autunnale del ristorante',
    expect: { research: true, writing: true, question: true },
    searchQuery: 'menu autunnale',
  },
  {
    // The demo's explicit variant: does the orchestrator leave the web to Rhea, are her links real?
    id: 'post-rhea',
    label: '3 post, ricerca chiesta a Rhea',
    text:
      'Preparami 3 post Instagram sul nuovo menu autunnale del ristorante: fai cercare a Rhea sul web ' +
      'le origini dei piatti, con le fonti',
    expect: { research: true, writing: true, question: true },
    searchQuery: 'origini piatti autunnali',
  },
  {
    id: 'menu',
    label: 'post sul menu, piatti non nel profilo',
    text: 'Preparami 3 post Instagram sul nuovo menu autunnale del ristorante',
    menuInProfile: false,
    expect: { research: false, writing: true, question: true },
    searchQuery: 'menu autunnale',
  },
  {
    id: 'mail',
    label: 'mail ai fornitori',
    text: 'Scrivimi una mail ai fornitori per chiedere prezzi e disponibilità di funghi porcini e castagne per il menu autunnale',
    expect: { research: false, writing: true, question: true },
    searchQuery: 'fornitori porcini',
  },
  {
    id: 'recensioni',
    label: 'recensioni toscane',
    text: 'Cosa dicono le recensioni dei ristoranti toscani sui piatti autunnali?',
    expect: { research: true, writing: false, question: false },
    searchQuery: 'recensioni ristoranti toscani',
  },
];
