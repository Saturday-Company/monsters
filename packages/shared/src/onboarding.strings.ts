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
  reply: string;
  /** Label and placeholder of each group, by group id. */
  groups?: Record<string, { label?: string; placeholder?: string }>;
  /** Label of each option, by option id (the ones whose label is a name are in the code). */
  options?: Record<string, string>;
}

const en: Record<string, OnboardingQuestionTexts> = {
  nomi: {
    title: 'Nice to meet you! What’s your name? And what should we call your lead?',
    hint: 'Your lead coordinates the other monsters: you’ll usually talk to it.',
    groups: {
      user: { label: 'Your name', placeholder: 'What you’d like to be called' },
      orchestrator: { label: 'Your lead’s name', placeholder: 'Another name' },
    },
    reply: 'Great name! From now on {orchestrator} coordinates your squad, {user}.',
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
    reply: 'Nice! That helps me see which monsters you need.',
  },
  obiettivi: {
    title: 'What do you want to achieve in the next few weeks?',
    options: {
      costanza: 'Publish consistently',
      clienti: 'Find new clients',
      lancio: 'Launch a project',
      ordine: 'Get my ideas in order',
      imparare: 'Learn a topic',
      tempo: 'Free up time',
    },
    freeText: 'A specific goal, if you have one',
    reply: 'Noted. We’ll work on that.',
  },
  deleghe: {
    title: 'Which tasks take up most of your time and you’d like to hand off?',
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
    reply: 'Perfect, we’ll take those.',
  },
  strumenti: {
    title: 'Which tools and accounts do you use?',
    hint: 'For now the monsters use the web and your notes; accounts are coming soon.',
    freeText: 'Other tools',
    reply: 'Noted: when accounts arrive, we’ll start with these.',
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
    freeText: 'For example: before touching my work files',
    reply: 'Promise: on these we always ask first.',
  },
  tono: {
    title: 'What tone do you want in messages? And in which language?',
    groups: { tono: { label: 'Tone' }, lingua: { label: 'Language' } },
    options: {
      amichevole: 'Friendly',
      diretto: 'Direct',
      formale: 'Formal',
      scherzoso: 'Playful',
    },
    freeText: 'Any other style preferences',
    reply: 'Done! Now let’s see what the monsters can do.',
  },
};

const it: typeof en = {
  nomi: {
    title: 'Piacere! Come ti chiami? E come chiamiamo il tuo capo?',
    hint: 'Il tuo capo coordina gli altri mostri: di solito scrivi a lui.',
    groups: {
      user: { label: 'Il tuo nome', placeholder: 'Come vuoi che ti chiamino' },
      orchestrator: { label: 'Il nome del tuo capo', placeholder: 'Un altro nome' },
    },
    reply: 'Bel nome! Da adesso {orchestrator} coordina la tua squadra, {user}.',
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
    reply: 'Bello! Così capisco quali mostri ti servono.',
  },
  obiettivi: {
    title: 'Cosa vuoi ottenere nelle prossime settimane?',
    options: {
      costanza: 'Pubblicare con costanza',
      clienti: 'Trovare nuovi clienti',
      lancio: 'Lanciare un progetto',
      ordine: 'Mettere ordine nelle idee',
      imparare: 'Imparare un argomento',
      tempo: 'Liberare tempo',
    },
    freeText: 'Un obiettivo preciso, se ce l’hai',
    reply: 'Segnato. Lavoriamo su questo.',
  },
  deleghe: {
    title: 'Quali attività ti rubano più tempo e vorresti delegare?',
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
    reply: 'Perfetto, queste le prendiamo noi.',
  },
  strumenti: {
    title: 'Quali strumenti e account usi?',
    hint: 'Per ora i mostri usano il web e le note; gli account arrivano presto.',
    freeText: 'Altri strumenti',
    reply: 'Me lo segno: quando arrivano gli account, partiamo da questi.',
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
    freeText: 'Altro da chiederti sempre',
    reply: 'Promesso: su queste cose chiediamo sempre prima.',
  },
  tono: {
    title: 'Che tono vuoi nei messaggi? E in che lingua?',
    groups: { tono: { label: 'Tono' }, lingua: { label: 'Lingua' } },
    options: {
      amichevole: 'Amichevole',
      diretto: 'Diretto',
      formale: 'Formale',
      scherzoso: 'Scherzoso',
    },
    freeText: 'Qualche preferenza in più sullo stile',
    reply: 'Fatto! Ora vediamo cosa possono fare i mostri.',
  },
};

export const onboardingStrings = () => pick({ en, it });
/** A given language's words, for text that is written in one language whatever the app's. */
export const onboardingStringsOf = (lang: Lang) => pick({ en, it }, lang);
