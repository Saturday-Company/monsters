import { pick, type Lang } from './i18n.ts';

/*
 * The words of the first-start questions (D-153). The ids of the questions, groups and options are
 * answers the core stores and read back: they stay as they are (Italian), only the texts move.
 */

export interface OnboardingQuestionTexts {
  title: string;
  hint?: string;
  /** The placeholder of the free text field. */
  freeText?: string;
  /** Label and placeholder of each group, by group id. */
  groups?: Record<string, { label?: string; placeholder?: string }>;
  /** Label of each option, by option id (the ones whose label is a name are in the code). */
  options?: Record<string, string>;
}

const en: Record<string, OnboardingQuestionTexts> = {
  nomi: {
    title: 'What should I call you?',
    hint: 'Your lead coordinates the other monsters, and you’ll usually talk to it. Give it another name if you like.',
    groups: {
      user: { label: 'Your name', placeholder: 'What you’d like to be called' },
      orchestrator: { label: 'Your lead’s name', placeholder: 'Another name' },
    },
  },
  lavoro: {
    title: 'What do you do?',
    hint: 'Pick more than one if you like.',
    options: {
      social: 'Social media and content',
      sviluppo: 'Software development',
      marketing: 'Marketing and sales',
      consulenza: 'Consulting or freelance',
      impresa: 'I run a business',
      studio: 'Study and research',
      scrittura: 'Writing and communication',
    },
    freeText: 'Something else, or a few more words',
  },
  deleghe: {
    title: 'What takes up most of your time and you’d like to hand off?',
    options: {
      ricerche: 'Online research',
      bozze: 'Drafts of posts and emails',
      riassunti: 'Summarizing documents',
      note: 'Organizing notes and ideas',
      piano: 'Planning content',
      numeri: 'Analyzing numbers and data',
      bug: 'Fixing bugs',
      test: 'Writing tests',
      docs: 'Documentation',
      review: 'Reviewing code',
      capire: 'Understanding new code',
    },
    freeText: 'Anything else that weighs on you',
  },
  chiedi: {
    title: 'What should they never do without asking you first?',
    hint: 'For everything else they work on their own and let you know at the end.',
    options: {
      publish: 'Publish',
      contact: 'Send messages or emails',
      spend: 'Pay or buy',
      delete: 'Delete',
      goal: 'Change a goal',
    },
    freeText: 'For example: before touching my work files, or answering a client',
  },
  tono: {
    title: 'What tone do you want in messages? And in which language?',
    groups: { tono: { label: 'Tone' }, lingua: { label: 'Monsters’ writing language' } },
    options: {
      amichevole: 'Friendly',
      diretto: 'Direct',
      formale: 'Formal',
      scherzoso: 'Playful',
    },
    freeText: 'Any other style preferences',
  },
};

const it: typeof en = {
  nomi: {
    title: 'Come ti chiamo?',
    hint: 'Il tuo capo coordina gli altri mostri, e di solito scrivi a lui. Se vuoi, dagli un altro nome.',
    groups: {
      user: { label: 'Il tuo nome', placeholder: 'Come vuoi che ti chiamino' },
      orchestrator: { label: 'Il nome del tuo capo', placeholder: 'Un altro nome' },
    },
  },
  lavoro: {
    title: 'Di cosa ti occupi?',
    hint: 'Scegli anche più di una cosa.',
    options: {
      social: 'Social e contenuti',
      sviluppo: 'Sviluppo software',
      marketing: 'Marketing e vendite',
      consulenza: 'Consulenza o freelance',
      impresa: 'Gestisco un’attività',
      studio: 'Studio e ricerca',
      scrittura: 'Scrittura e comunicazione',
    },
    freeText: 'Altro, o due parole in più',
  },
  deleghe: {
    title: 'Cosa ti ruba più tempo e vorresti delegare?',
    options: {
      ricerche: 'Ricerche online',
      bozze: 'Bozze di post e mail',
      riassunti: 'Riassumere documenti',
      note: 'Organizzare note e idee',
      piano: 'Pianificare i contenuti',
      numeri: 'Analizzare numeri e dati',
      bug: 'Correggere bug',
      test: 'Scrivere test',
      docs: 'Documentazione',
      review: 'Rivedere codice',
      capire: 'Capire codice nuovo',
    },
    freeText: 'Altro che ti pesa',
  },
  chiedi: {
    title: 'Cosa non devono mai fare senza chiederti?',
    hint: 'Per tutto il resto lavorano da soli e ti avvisano alla fine.',
    options: {
      publish: 'Pubblicare',
      contact: 'Inviare messaggi o mail',
      spend: 'Pagare o comprare',
      delete: 'Cancellare',
      goal: 'Cambiare un obiettivo',
    },
    freeText: 'Per esempio: prima di toccare i miei file di lavoro, o di rispondere a un cliente',
  },
  tono: {
    title: 'Che tono vuoi nei messaggi? E in che lingua?',
    groups: { tono: { label: 'Tono' }, lingua: { label: 'Lingua in cui scrivono i mostri' } },
    options: {
      amichevole: 'Amichevole',
      diretto: 'Diretto',
      formale: 'Formale',
      scherzoso: 'Scherzoso',
    },
    freeText: 'Qualche preferenza in più sullo stile',
  },
};

export const onboardingStrings = () => pick({ en, it });
/** A given language's words, for text that is written in one language whatever the app's. */
export const onboardingStringsOf = (lang: Lang) => pick({ en, it }, lang);
