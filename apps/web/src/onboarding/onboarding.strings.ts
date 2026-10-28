import { SETTINGS_TABS, settingsLabel } from '@monsters/shared';
import { defineStrings } from '../lib/i18n.ts';
import { toNameIt } from '../lib/utils.strings.ts';

/* First start: the frame, the model chains, the birth, what they may do (D-153, C1). */

const en = {
  stages: ['Model', 'Your name', 'Squad'],
  progress: 'Progress',
  done: ', done',
  todo: ', to do',
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
    answers_changed: 'Your answers changed while I was thinking. Let me try the squad again.',
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
      'Run commands and install programs in their own folder, without admin rights. Commands can read and change your account’s files.',
    /** On the squad screen: what they may do from the start, and where to change it. */
    note: (where: string) =>
      `They can write in your notes, search the web and run commands on this computer. You can change that in ${where}.`,
  },
};

const it: typeof en = {
  stages: ['Modello', 'Il tuo nome', 'Squadra'],
  progress: 'Avanzamento',
  done: ', fatto',
  todo: ', da fare',
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
    answers_changed: 'Le tue risposte sono cambiate mentre ci pensavo. Riproviamo con la squadra.',
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
      'Eseguire comandi e installare programmi nella propria cartella, senza essere amministratore. I comandi possono leggere e cambiare i file del tuo account.',
    note: (where) =>
      `Possono scrivere nelle tue note, cercare sul web ed eseguire comandi su questo computer. Puoi cambiarlo in ${where}.`,
  },
};

export const onboardingStrings = defineStrings({ en, it });

/** One true sentence about the commands, the same in Settings → Permissions (audit 2.9). */
export function terminalText(): string {
  return onboardingStrings().permissions.terminal;
}

/** "Settings → Permissions": the place to change what the monsters may do. */
export function permissionsPlace(): string {
  // Held together: the sentence may end the line, the place never splits.
  return `${settingsLabel()}\u00a0→\u00a0${SETTINGS_TABS.permessi}`;
}
