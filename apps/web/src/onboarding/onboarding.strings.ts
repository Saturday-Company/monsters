import { defineStrings } from '../lib/i18n.ts';
import { toNameIt } from '../lib/utils.strings.ts';

/* First start: the frame, the model chains, the birth, the permissions (D-153). */

const en = {
  stages: ['Model', 'About you', 'What they can do', 'Squad'],
  progress: 'Progress',
  done: ', done',
  todo: ', to do',
  moduleTitle: {
    key: 'Model',
    questions: 'About you',
    permissions: 'What they can do',
    team: 'Squad',
    birth: 'The squad is born',
    other: 'First start',
  },
  loadFailed: 'I can’t load the squad. Reload the page.',
  signOut: 'Sign out',
  retry: 'Try again',
  loading: 'Loading…',
  firstStart: 'First start',
  errors: {
    invalid_key: 'OpenRouter says the key doesn’t work. Check that you copied all of it.',
    verification_failed: 'I can’t verify the key right now. Try again in a moment.',
    invalid_name:
      'That name doesn’t work: use letters only, no duplicates, and not User or System.',
    onboarding_done: 'The squad already exists.',
    answers_incomplete: 'Some answers are still missing.',
  },
  chain: {
    default: 'You can change it or add more whenever you like, in the settings.',
    thenOpenRouter: (first: string) => `I’ll use ${first} first, then OpenRouter if needed.`,
    one: (first: string, other: string) =>
      `I’ll use ${first}. ${other} stays connected too: in the settings you can give it to a monster.`,
    many: (first: string, others: string) =>
      `I’ll use ${first}. ${others} stay connected too: in the settings you can give them to a monster.`,
  },
  guide: {
    lead: (name: string) => `${name} · your lead`,
    first: 'Your first monster',
  },
  progressCount: (label: string, n: number, total: number) => `${label} ${n} of ${total}`,
  question: 'Question',
  birth: {
    on: 'Squad is on',
    switching: (n: number, total: number) => `Switching on ${n}/${total}`,
    title: 'Here’s your squad!',
    subtitle: 'Just born, and ready to work.',
    list: 'The squad’s monsters',
    lead: 'Your lead',
    awake: 'Awake',
    waiting: 'Waiting',
    write: (name: string) => `Message ${name}`,
  },
  permissions: {
    terminal:
      'Run commands and install programs in their own folder, without administrator rights. Commands can read and change the files of your account.',
    notesTitle: 'Your notes',
    notesText: 'Write in your notes: research, drafts, jottings. Every change can be undone.',
    webTitle: 'The web',
    webText: 'Search and read pages online, always citing sources.',
    terminalTitle: 'Terminal',
    saidSaved: 'Perfect! Now I’ll put the squad together.',
    said: 'What can we do without bothering you?',
    hint: 'Computer folders, the browser and other apps you can add whenever you like, in the settings.',
    list: 'The monsters’ permissions',
    back: 'Back',
    working: 'One moment…',
    next: 'Looks good, continue',
  },
};

const it: typeof en = {
  stages: ['Modello', 'Su di te', 'Cosa possono fare', 'Squadra'],
  progress: 'Avanzamento',
  done: ', fatto',
  todo: ', da fare',
  moduleTitle: {
    key: 'Modello',
    questions: 'Su di te',
    permissions: 'Cosa possono fare',
    team: 'Squadra',
    birth: 'Nascita della squadra',
    other: 'Primo avvio',
  },
  loadFailed: 'Non riesco a caricare la squadra: ricarica la pagina.',
  signOut: 'Esci dall’account',
  retry: 'Riprova',
  loading: 'Carico…',
  firstStart: 'Primo avvio',
  errors: {
    invalid_key: 'OpenRouter dice che la chiave non va. Controlla di averla copiata tutta.',
    verification_failed: 'Non riesco a verificare la chiave adesso. Riprova tra poco.',
    invalid_name: 'Questo nome non va: usa solo lettere, niente doppioni, e non User o System.',
    onboarding_done: 'La squadra esiste già.',
    answers_incomplete: 'Manca ancora qualche risposta.',
  },
  chain: {
    default: 'Puoi cambiarlo o aggiungerne altri quando vuoi, nelle impostazioni.',
    thenOpenRouter: (first) => `Userò prima ${first}, poi OpenRouter se serve.`,
    one: (first, other) =>
      `Userò ${first}. Anche ${other} resta collegato: nelle impostazioni lo puoi dare a un mostro.`,
    many: (first, others) =>
      `Userò ${first}. Anche ${others} restano collegati: nelle impostazioni li puoi dare a un mostro.`,
  },
  guide: {
    lead: (name) => `${name} · il tuo capo`,
    first: 'Il tuo primo mostro',
  },
  progressCount: (label, n, total) => `${label} ${n} di ${total}`,
  question: 'Domanda',
  birth: {
    on: 'Squadra accesa',
    switching: (n, total) => `Accensione ${n}/${total}`,
    title: 'Ecco la tua squadra!',
    subtitle: 'Appena nati, e già pronti a lavorare.',
    list: 'I mostri della squadra',
    lead: 'Il tuo capo',
    awake: 'Sveglio',
    waiting: 'In attesa',
    write: (name) => `Scrivi ${toNameIt(name)}`,
  },
  permissions: {
    terminal:
      'Eseguire comandi e installare programmi nella propria cartella, senza permessi di amministratore. I comandi possono leggere e cambiare i file del tuo account.',
    notesTitle: 'Le tue note',
    notesText: 'Scrivere nelle tue note: ricerche, bozze, appunti. Ogni modifica si può annullare.',
    webTitle: 'Il web',
    webText: 'Cercare e leggere pagine online, sempre citando le fonti.',
    terminalTitle: 'Terminale',
    saidSaved: 'Perfetto! Adesso preparo la squadra.',
    said: 'Cosa possiamo fare senza disturbarti?',
    hint: 'Cartelle del computer, browser e altri programmi li aggiungi quando vuoi, nelle impostazioni.',
    list: 'Permessi degli agenti',
    back: 'Indietro',
    working: 'Un attimo…',
    next: 'Va bene, continua',
  },
};

export const onboardingStrings = defineStrings({ en, it });
