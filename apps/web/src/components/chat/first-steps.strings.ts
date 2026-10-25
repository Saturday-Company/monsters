import { defineStrings } from '../../lib/i18n.ts';

/*
 * After the first answer of the lead: the "Tell me more about you" card (work, hand-offs,
 * what they always ask, tone, writing language: what the first start used to ask in four screens)
 * and one calm row of first jobs to try. The options and their labels come from the core.
 */

const en = {
  card: {
    title: 'Tell me more about you',
    hint: 'Optional, and you can do it later. It helps the monsters work your way.',
    work: 'Your work',
    workText: 'In your own words (if you like)',
    delegate: 'What eats your time',
    ask: 'Also ask me before',
    askFixed: 'Always asked first',
    askGoal: 'Change a goal',
    askText: 'Anything else to ask you first (if you like)',
    askTextPlaceholder: 'For example: before touching my work files, or answering a client',
    tone: 'Tone',
    language: 'Monsters’ writing language',
    save: 'Save',
    saving: 'Saving…',
    open: 'Tell me more',
    notNow: 'Not now',
    saved: 'Saved. Tone, language and your name are also in',
    savedAfter: '.',
    failed: 'I couldn’t save it. Try again in a moment.',
  },
  examples: {
    label: 'More things to try',
    list: ['Summarize my latest notes', 'Draft a reply to…', 'Make a plan for…'],
    tellMore: 'Tell me more about you',
  },
};

const it: typeof en = {
  card: {
    title: 'Dimmi di più su di te',
    hint: 'Facoltativo, e puoi farlo dopo. Aiuta i mostri a lavorare a modo tuo.',
    work: 'Il tuo lavoro',
    workText: 'In parole tue (se vuoi)',
    delegate: 'Cosa ti ruba tempo',
    ask: 'Chiedimi anche prima di',
    askFixed: 'Te lo chiediamo sempre',
    askGoal: 'Cambiare un obiettivo',
    askText: 'Altro da chiederti prima (se vuoi)',
    askTextPlaceholder:
      'Per esempio: prima di toccare i miei file di lavoro, o di rispondere a un cliente',
    tone: 'Tono',
    language: 'Lingua in cui scrivono i mostri',
    save: 'Salva',
    saving: 'Salvo…',
    open: 'Ti racconto',
    notNow: 'Non ora',
    saved: 'Salvato. Tono, lingua e il tuo nome sono anche in',
    savedAfter: '.',
    failed: 'Non sono riuscito a salvare. Riprova tra poco.',
  },
  examples: {
    label: 'Altre cose da provare',
    list: ['Riassumi le mie ultime note', 'Scrivi una risposta a…', 'Fai un piano per…'],
    tellMore: 'Dimmi di più su di te',
  },
};

export const firstStepsStrings = defineStrings({ en, it });
