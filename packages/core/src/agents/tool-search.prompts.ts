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
  // Codex (D-163): its tool list cannot change in a session, so a search loads nothing and the
  // waiting tools are called through `tools_call`.
  statusCall: 'call with tools_call',
  callNote: (names: string) =>
    `Not in your tool list, call them with \`tools_call\` ({"name": "<full name>", "arguments": {…}}): ${names}. The schema of each is above.`,
  callDescription: (servers: string) =>
    `Finds your tools by what they do and tells their parameters (${servers}); it loads nothing: the ones marked "ready" you call by name, the others with \`tools_call\`. ` +
    'Search with a few words (the action and the thing, e.g. "create task", "list customers") or a name pattern with * (e.g. "anteiku_preventivi_*"; * is the only wildcard, no regex). ' +
    'Each tool found comes with its name, what it does, its arguments and its input schema.',
  callToolDescription:
    'Calls a tool of this job that is not in your tool list (the card names them, `tools_search` tells their parameters). ' +
    'Pass the full name as the card writes it, e.g. "mcp__anteiku__anteiku_task_crea" (the name without the mcp__server__ prefix works too), and its arguments as an object: {"name": "<full name>", "arguments": {…}}. ' +
    'It runs that tool as if you had called it by name: same permissions, same checks, same result.',
  callSelf: (name: string) =>
    `${name} cannot be called through tools_call: call it by its own name.`,
  callUnknown: (name: string) => `No tool ${name} in this job.`,
  callUnknownHint:
    'Use tools_search with a few words to find the tool and its exact name, then call it with tools_call. It is not a no from the user.',
  callInstructions:
    'The tools of connected services that are not listed here are reached with `tools_call` (their names are in the Monsters card, `tools_search` tells their parameters).',
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
  statusCall: 'da chiamare con tools_call',
  callNote: (names) =>
    `Non sono nella tua lista di strumenti, chiamali con \`tools_call\` ({"name": "<nome completo>", "arguments": {…}}): ${names}. Lo schema di ognuno è qui sopra.`,
  callDescription: (servers) =>
    `Finds your tools by what they do and tells their parameters (${servers}); it loads nothing: the ones marked "pronto" you call by name, the others with \`tools_call\`. ` +
    'Search with a few words (the action and the thing, e.g. "crea task", "elenca clienti") or a name pattern with * (e.g. "anteiku_preventivi_*"; * is the only wildcard, no regex). ' +
    'Each tool found comes with its name, what it does, its arguments and its input schema.',
  callToolDescription:
    'Calls a tool of this job that is not in your tool list (the card names them, `tools_search` tells their parameters). ' +
    'Pass the full name as the card writes it, e.g. "mcp__anteiku__anteiku_task_crea" (the name without the mcp__server__ prefix works too), and its arguments as an object: {"name": "<full name>", "arguments": {…}}. ' +
    'It runs that tool as if you had called it by name: same permissions, same checks, same result.',
  callSelf: (name) => `${name} non si chiama con tools_call: chiamalo col suo nome.`,
  callUnknown: (name) => `Nessuno strumento ${name} in questo lavoro.`,
  callUnknownHint:
    'Usa tools_search con poche parole per trovare lo strumento e il suo nome esatto, poi chiamalo con tools_call. Non è un no dell’utente.',
  callInstructions:
    'Gli strumenti dei servizi collegati che non sono elencati qui si chiamano con `tools_call` (i nomi sono nella scheda Monsters, `tools_search` dice i loro parametri).',
  groups: {},
};

export const toolSearchPrompts = (lang?: Lang) => pick({ en, it }, lang);

/** The name of a group of waiting tools in the family's words (an unknown group stays as it is). */
export const toolGroupName = (group: string, lang?: Lang): string =>
  toolSearchPrompts(lang).groups[group] ?? group;
