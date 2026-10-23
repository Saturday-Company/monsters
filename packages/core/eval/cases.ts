import type { OnboardingAnswer } from '@monsters/shared';

/*
 * Fixed profile and requests of the behaviour eval (docs/eval). The profile is
 * the one of the Phase 1 demo: the social media manager of a trattoria in
 * Florence, Italian, orchestrator called Bruno, standard team (Rhea, Dione).
 * From the second round the profile also lists the autumn menu, except in the
 * "menu" case, which measures what happens when the facts are missing.
 *
 * The English user (D-153, `--user en`): the same trattoria, profile and requests in English,
 * monsters writing in English. The dishes keep their Italian names, as on a real menu.
 */

export type EvalUser = 'it' | 'en';

const WORK = 'Social media manager della Trattoria da Lapo, una trattoria toscana a Firenze';
const WORK_EN = 'Social media manager at Trattoria da Lapo, a Tuscan trattoria in Florence';

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
  // English names that give away a dish nobody gave.
  'truffle',
  'tripe',
  'florentine steak',
  'tiramis',
  'panna cotta',
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

/** The English user: the same answers, the work in English, monsters writing in English. */
export const PROFILE_ANSWERS_EN: Record<string, OnboardingAnswer> = {
  ...PROFILE_ANSWERS,
  lavoro: { values: { cosa: ['social'] }, text: `${WORK_EN}. The autumn menu: ${MENU}.` },
  tono: { values: { tono: ['amichevole'], lingua: ['en'] } },
};

export const PROFILE_WITHOUT_MENU_EN: Record<string, OnboardingAnswer> = {
  ...PROFILE_ANSWERS_EN,
  lavoro: { values: { cosa: ['social'] }, text: WORK_EN },
};

/** The onboarding answers of a case for a user. */
export function profileFor(c: EvalCase, user: EvalUser): Record<string, OnboardingAnswer> {
  if (user === 'en') {
    return c.menuInProfile === false ? PROFILE_WITHOUT_MENU_EN : PROFILE_ANSWERS_EN;
  }
  return c.menuInProfile === false ? PROFILE_WITHOUT_MENU : PROFILE_ANSWERS;
}

/** The request and the search query of a case in the user's language. */
export function requestFor(c: EvalCase, user: EvalUser): { text: string; searchQuery: string } {
  return user === 'en' ? c.en : { text: c.text, searchQuery: c.searchQuery };
}

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
  /** The same request and query of the English user. */
  en: { text: string; searchQuery: string };
}

export const CASES: EvalCase[] = [
  {
    id: 'post',
    label: '3 post Instagram',
    text: 'Preparami 3 post Instagram sul nuovo menu autunnale del ristorante',
    expect: { research: true, writing: true, question: true },
    searchQuery: 'menu autunnale',
    en: {
      text: 'Prepare 3 Instagram posts about the restaurant’s new autumn menu',
      searchQuery: 'autumn menu',
    },
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
    en: {
      text:
        'Prepare 3 Instagram posts about the restaurant’s new autumn menu: have Rhea search the ' +
        'web for the origins of the dishes, with sources',
      searchQuery: 'origins autumn dishes',
    },
  },
  {
    id: 'menu',
    label: 'post sul menu, piatti non nel profilo',
    text: 'Preparami 3 post Instagram sul nuovo menu autunnale del ristorante',
    menuInProfile: false,
    expect: { research: false, writing: true, question: true },
    searchQuery: 'menu autunnale',
    en: {
      text: 'Prepare 3 Instagram posts about the restaurant’s new autumn menu',
      searchQuery: 'autumn menu',
    },
  },
  {
    id: 'mail',
    label: 'mail ai fornitori',
    text: 'Scrivimi una mail ai fornitori per chiedere prezzi e disponibilità di funghi porcini e castagne per il menu autunnale',
    expect: { research: false, writing: true, question: true },
    searchQuery: 'fornitori porcini',
    en: {
      text:
        'Write me an email to our suppliers asking for prices and availability of porcini ' +
        'mushrooms and chestnuts for the autumn menu',
      searchQuery: 'suppliers porcini',
    },
  },
  {
    // Drawn blocks (D-162): a comparison reads better drawn. The reply should hold a valid ```ui
    // block (`uiBlocksOf`: root present, no errors, every name defined); the table shows it.
    id: 'confronta',
    label: '3 piani a confronto (blocco ui)',
    text: 'Confrontami tre strumenti per programmare i post sui social: Buffer, Later e Metricool, con prezzi e cosa offrono',
    expect: { research: true, writing: false, question: false },
    searchQuery: 'confronto strumenti programmare post',
    en: {
      text: 'Compare three tools to schedule social media posts: Buffer, Later and Metricool, with prices and what they offer',
      searchQuery: 'schedule posts tools comparison',
    },
  },
  {
    id: 'recensioni',
    label: 'recensioni toscane',
    text: 'Cosa dicono le recensioni dei ristoranti toscani sui piatti autunnali?',
    expect: { research: true, writing: false, question: false },
    searchQuery: 'recensioni ristoranti toscani',
    en: {
      text: 'What do reviews of Tuscan restaurants say about their autumn dishes?',
      searchQuery: 'reviews Tuscan restaurants',
    },
  },
];
