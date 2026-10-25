import { pick, type Lang } from '@monsters/shared';

/*
 * `profilo.md` and the sentence about the user in the agents' AGENTS.md, in two families
 * (D-153, wave 3): what the monsters read about the user. A profile on disk keeps the family it
 * was written in: the lines the settings manage are found and rewritten in either (`lines`).
 * The Italian texts are the ones of the evals, never edited.
 */

export interface ProfileTexts {
  /** "da chiedere sempre" kinds, as the last part of "Chiedere sempre prima di". */
  ask: Record<string, string>;
  /** An empty list. */
  none: string;
  /** The "ask first" list when nothing was chosen. */
  nothingToAsk: string;
  /** What the agents may do (permissions of the first start). */
  can: {
    vaultWrite: string;
    vaultRead: string;
    web: string;
    noWeb: string;
    shell: string;
    folders: (list: string) => string;
    readOnly: string;
  };
  /** The whole note; `can` and `style` are already lists/lines or empty. */
  note: (p: {
    user: string;
    orchestrator: string;
    occupation: string;
    /** Only an install that answered the old goals question has them. */
    goals: string | undefined;
    delegate: string;
    /** As `goals`. */
    tools: string | undefined;
    ask: string;
    tone: string;
    language: string;
    style: string | undefined;
    can: string | undefined;
  }) => string;
  /** The managed lines, for the rewrite of an existing note (`team-manager.ts`). */
  lines: {
    title: (user: string) => string;
    titleRe: RegExp;
    name: string;
    coordinator: string;
    tone: string;
    language: string;
    style: string;
    askHeading: string;
    occupationHeading: string;
    delegateHeading: string;
  };
  /** The sentence about the user (`contextSentence`). */
  context: {
    /** Third person of an occupation option that is not a field of work, by its label (lower case). */
    verbs: Record<string, string>;
    worksIn: (fields: string[]) => string;
    and: string;
    inOwnWords: (quoted: string) => string;
    introduces: (user: string, quoted: string) => string;
    entrusted: (user: string) => string;
    wants: (goal: string) => string;
    forWeeks: (quoted: string) => string;
    /** A goal label in the third person ("my ideas" → "their ideas"). */
    goal: (label: string) => string;
  };
}

const it: ProfileTexts = {
  ask: {
    publish: 'pubblicare',
    contact: 'inviare messaggi o mail a terzi',
    spend: 'pagare o comprare',
    delete: 'cancellare',
    goal: 'cambiare un obiettivo',
  },
  none: 'non indicato',
  nothingToAsk: 'niente di particolare',
  can: {
    vaultWrite: 'leggere e scrivere note nel vault',
    vaultRead: 'leggere le note del vault (senza scrivere)',
    web: 'cercare e leggere pagine web',
    noWeb: 'niente web',
    shell: 'usare il terminale e installare programmi nella propria cartella',
    folders: (list) => `lavorare sui file di ${list}`,
    readOnly: ' (solo lettura)',
  },
  note: (p) => `# Profilo di ${p.user}

Quello che ${p.user} ha raccontato al primo avvio. Si può modificare quando vuole: i mostri lo leggono all'inizio di ogni lavoro.

## Chi è
- Nome: ${p.user}
- Coordinatore della squadra: ${p.orchestrator}

## Di cosa si occupa
${p.occupation}

${p.goals ? `## Obiettivi delle prossime settimane\n${p.goals}\n\n` : ''}## Attività da delegare
${p.delegate}

${p.tools ? `## Strumenti e account\n${p.tools}\n\n` : ''}## Chiedere sempre prima di
${p.ask}

## Tono e lingua
- Tono: ${p.tone}
- Lingua: ${p.language}${p.style ? `\n- Stile: ${p.style}` : ''}
${p.can ? `\n## Permessi degli agenti\n${p.can}\n` : ''}`,
  lines: {
    title: (user) => `# Profilo di ${user}`,
    titleRe: /^# Profilo di .*$/m,
    name: '- Nome: ',
    coordinator: '- Coordinatore della squadra: ',
    tone: '- Tono: ',
    language: '- Lingua: ',
    style: '- Stile: ',
    askHeading: '## Chiedere sempre prima di',
    occupationHeading: '## Di cosa si occupa',
    delegateHeading: '## Attività da delegare',
  },
  context: {
    verbs: {
      'gestisco un’attività': 'gestisce un’attività',
      "gestisco un'attività": 'gestisce un’attività',
    },
    worksIn: (fields) => `si occupa di ${fields.join(' e di ')}`,
    and: ' e ',
    inOwnWords: (q) => ` (in parole sue: ${q})`,
    introduces: (user, q) => `${user} si presenta così: ${q}`,
    entrusted: (user) => `${user} ti ha affidato una parte del suo lavoro`,
    wants: (goal) => `; nelle prossime settimane vuole ${goal}`,
    forWeeks: (q) => `; per le prossime settimane: ${q}`,
    goal: (label) => label,
  },
};

const en: ProfileTexts = {
  ask: {
    publish: 'publishing',
    contact: 'sending messages or emails to third parties',
    spend: 'paying or buying',
    delete: 'deleting',
    goal: 'changing a goal',
  },
  none: 'not given',
  nothingToAsk: 'nothing in particular',
  can: {
    vaultWrite: 'read and write notes in the vault',
    vaultRead: 'read the notes of the vault (without writing)',
    web: 'search and read web pages',
    noWeb: 'no web',
    shell: 'use the terminal and install programs in their own folder',
    folders: (list) => `work on the files of ${list}`,
    readOnly: ' (read only)',
  },
  note: (p) => `# ${p.user}’s profile

What ${p.user} said at the first start. They can change it whenever they like: the monsters read it at the start of every job.

## Who they are
- Name: ${p.user}
- Squad coordinator: ${p.orchestrator}

## What they do
${p.occupation}

${p.goals ? `## Goals for the next few weeks\n${p.goals}\n\n` : ''}## Tasks to hand off
${p.delegate}

${p.tools ? `## Tools and accounts\n${p.tools}\n\n` : ''}## Always ask before
${p.ask}

## Tone and language
- Tone: ${p.tone}
- Language: ${p.language}${p.style ? `\n- Style: ${p.style}` : ''}
${p.can ? `\n## The agents’ permissions\n${p.can}\n` : ''}`,
  lines: {
    title: (user) => `# ${user}’s profile`,
    titleRe: /^# .*’s profile$/m,
    name: '- Name: ',
    coordinator: '- Squad coordinator: ',
    tone: '- Tone: ',
    language: '- Language: ',
    style: '- Style: ',
    askHeading: '## Always ask before',
    occupationHeading: '## What they do',
    delegateHeading: '## Tasks to hand off',
  },
  context: {
    verbs: { 'i run a business': 'runs a business' },
    worksIn: (fields) => `works in ${fields.join(' and in ')}`,
    and: ' and ',
    inOwnWords: (q) => ` (in their own words: ${q})`,
    introduces: (user, q) => `${user} introduces themselves like this: ${q}`,
    entrusted: (user) => `${user} has entrusted you with part of their work`,
    wants: (goal) => `; in the next few weeks they want to ${goal}`,
    forWeeks: (q) => `; for the next few weeks: ${q}`,
    goal: (label) => label.replace(/\bmy\b/gi, 'their').replace(/\bme\b/gi, 'them'),
  },
};

export const PROFILE_TEXTS: Record<Lang, ProfileTexts> = { it, en };

export function profileTexts(lang?: Lang): ProfileTexts {
  return pick(PROFILE_TEXTS, lang);
}

/**
 * Labels of the options of the goals and tools questions, which the first start no longer asks
 *: an install that answered them before keeps its profile in words. Product names are
 * the same in every language.
 */
const LEGACY_PRODUCTS: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  notion: 'Notion',
  obsidian: 'Obsidian',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  slack: 'Slack',
};

export const LEGACY_LABELS: Record<Lang, Record<string, string>> = {
  it: {
    costanza: 'Pubblicare con costanza',
    clienti: 'Trovare nuovi clienti',
    lancio: 'Lanciare un progetto',
    ordine: 'Mettere ordine nelle idee',
    imparare: 'Imparare un argomento',
    tempo: 'Liberare tempo',
    ...LEGACY_PRODUCTS,
  },
  en: {
    costanza: 'Publish consistently',
    clienti: 'Find new clients',
    lancio: 'Launch a project',
    ordine: 'Get my ideas in order',
    imparare: 'Learn a topic',
    tempo: 'Free up time',
    ...LEGACY_PRODUCTS,
  },
};
