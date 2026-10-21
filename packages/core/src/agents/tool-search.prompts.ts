import { pick, type Lang } from '@monsters/shared';

/*
 * What `tools_search` says to the model (D-134, D-153): the statuses of the tools it finds, the
 * notes of its answer and its own description. Two families, the one of the app's language
 * when the run is made. The Italian one is byte for byte what it was.
 */

const en = {
  statusReady: 'ready',
  statusNext: 'ready from the next step',
  statusOut: 'not loadable',
  notFound:
    'No tool found: try other words (the verb and the thing, also in Italian), or a pattern on the names like anteiku_task_*.',
  readyNote: (names: string) => `Already ready, call them now: ${names}.`,
  nextNote: (names: string) => `Ready from the next step: ${names}.`,
  outNote: (names: string, max: number) =>
    `Not loadable: ${names} (limit of ${max} tools loaded in this job reached). It is not a no from the user: use the ones already ready, or say so in the report.`,
  description: (servers: string) =>
    `Finds your tools by what they do and loads the ones that wait (${servers}); the ones you already have come back marked "ready". ` +
    'Search with a few words (the action and the thing, e.g. "create task", "list customers") or a name pattern with * (e.g. "anteiku_preventivi_*"; * is the only wildcard, no regex). ' +
    'The tools loaded are callable by name from the next step.',
  // The groups the card and the description name the waiting tools by.
  groups: {
    progetti: 'projects',
    automazioni: 'automations',
    istruzioni: 'instructions',
    pagine: 'pages',
    note: 'notes',
  } as Record<string, string>,
};

const it: typeof en = {
  statusReady: 'pronto',
  statusNext: 'pronto dal prossimo passo',
  statusOut: 'non caricabile',
  notFound:
    'Nessuno strumento trovato: prova con altre parole (il verbo e la cosa, anche in inglese), o con un modello sui nomi come anteiku_task_*.',
  readyNote: (names) => `Già pronti, chiamali ora: ${names}.`,
  nextNote: (names) => `Pronti dal prossimo passo: ${names}.`,
  outNote: (names, max) =>
    `Non caricabili: ${names} (limite di ${max} strumenti caricati in questo lavoro raggiunto). Non è un no dell’utente: usa quelli già pronti, o dillo nel rapporto.`,
  description: (servers) =>
    `Finds your tools by what they do and loads the ones that wait (${servers}); the ones you already have come back marked "pronto". ` +
    'Search with a few words (the action and the thing, e.g. "crea task", "elenca clienti") or a name pattern with * (e.g. "anteiku_preventivi_*"; * is the only wildcard, no regex). ' +
    'The tools loaded are callable by name from the next step.',
  groups: {},
};

export const toolSearchPrompts = (lang?: Lang) => pick({ en, it }, lang);

/** The name of a group of waiting tools in the family's words (an unknown group stays as it is). */
export const toolGroupName = (group: string, lang?: Lang): string =>
  toolSearchPrompts(lang).groups[group] ?? group;
