import { pick, type Lang } from '@monsters/shared';

/*
 * What the squad lead reads when a text it proposed is refused (D-079, D-103; D-153, wave 3): the
 * problem found in a field and what a proposal may not carry. Two families: the one of the app's
 * language at the moment of the check. The Italian one is byte for byte what it was.
 */

const en = {
  /** What a refused text carried, after "contains": the rule's `why`, by id. */
  why: {
    link: 'a link',
    email: 'an email address',
    site: 'a website',
    tool: 'the name of a tool',
    hide: 'something to hide from the user',
    ignore: 'an invitation to ignore the rules',
    prompt: 'the system prompt',
  },
  invisible: (field: string) => `${field}: contains invisible text. Write it in plain text.`,
  contains: (field: string, why: string, found: string, tail: string) =>
    `${field}: contains ${why} (“${found}”). ${tail}`,
  /** What the proposer reads after the problem for a new monster. */
  tail: 'A new monster only has work rules for the user: no addresses, links, tool names or things not to tell them.',
  /** The same for the objective of an automation (D-103). */
  objectiveTail:
    'The objective of a proposed automation says the work in your own words: no addresses, links, tool names or things not to tell the user (the user adds the sites from the app).',
};

const it: typeof en = {
  why: {
    link: 'un link',
    email: 'un indirizzo email',
    site: 'un sito',
    tool: 'il nome di uno strumento',
    hide: 'una cosa da nascondere all’utente',
    ignore: 'un invito a ignorare le regole',
    prompt: 'il prompt di sistema',
  },
  invisible: (field) => `${field}: contiene testo invisibile. Scrivilo in chiaro.`,
  contains: (field, why, found, tail) => `${field}: contiene ${why} («${found}»). ${tail}`,
  tail: 'Un mostro nuovo ha solo regole di lavoro per l’utente: niente indirizzi, link, nomi di strumenti o cose da non dirgli.',
  objectiveTail:
    'L’obiettivo di un’automazione proposta dice il lavoro con parole tue: niente indirizzi, link, nomi di strumenti o cose da non dire all’utente (i siti li aggiunge l’utente dall’app).',
};

/** The texts of the proposal checks in the app's language now (or in `lang`). */
export const proposalTextPrompts = (lang?: Lang) => pick({ en, it }, lang);
