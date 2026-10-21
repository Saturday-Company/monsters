import { defineStrings } from '../../lib/i18n.ts';

/* Settings → General (D-153). */

const en = {
  appearance: {
    title: 'Appearance',
    theme: 'Theme',
    themeHint: 'Light, dark or the same as your computer.',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    reduceMotion: 'Reduce motion',
    reduceMotionHint: 'The monsters hold still and animations turn into simple changes of state.',
    sounds: 'Sounds',
    soundsHint:
      'Small clicks for the keys and the lever, and a chime when a monster asks you something.',
    details: 'Show technical details',
    detailsHint: 'Under the monsters’ replies: tools used, time, cost and model.',
  },
  language: {
    label: 'Language',
    hint: 'Used by the app, its messages and Telegram. The monsters write in the language set in their profile.',
    failed: 'I couldn’t change the language. Try again.',
  },
  app: {
    title: 'App',
    footer: 'This applies to the app on this computer, even when it’s showing another computer.',
    openAtLogin: 'Open at login',
    openAtLoginHint:
      'When you sign in to your computer, Monsters starts by itself with no window: its icon stays in the tray and the monsters keep working even if you never open it.',
    refused: 'The system didn’t let me change it. Try again.',
  },
  password: {
    current: 'Current password',
    next: 'New password',
    again: 'Repeat the new password',
    minLength: (n: number) => `At least ${n} characters.`,
    currentMissing: 'Type the password you use now.',
    same: 'It’s the same as your current password.',
    mismatch: 'The two passwords don’t match.',
    changed: 'Password changed.',
    changedOthers: (n: number) =>
      `Password changed. Your other sessions (${n}) will need the new one.`,
    changing: 'Changing…',
    change: 'Change password',
    cancel: 'Cancel',
  },
  account: {
    title: 'Sign-in',
    footer:
      'The password is for signing in from a browser, a phone or another computer. The app on the computer where Monsters runs signs in by itself.',
    yours: 'Your account',
    signedIn: 'You’re signed in.',
    signOut: 'Sign out',
    password: 'Password',
  },
  notes: {
    title: 'Notes',
    footer: 'An ordinary folder of Markdown files: you can open it with Obsidian too.',
    folder: 'Notes folder',
    copyLabel: 'Copy the path of the notes folder',
    copyTitle: 'Copy the path',
    copied: 'Path copied.',
    copyFailed: 'I can’t copy it: select it and copy it by hand.',
  },
  secrets: {
    title: 'Keys',
    where: 'Where the keys are kept',
    keychain: 'Encrypted, with the key in the system keychain.',
    files: (why: string) =>
      `In protected files, readable only by your user account, not in the keychain. ${why}`.trim(),
    why: {
      keychain: '',
      forced: 'Chosen with MONSTERS_SECRETS=file.',
      unavailable: 'The keychain isn’t available on this computer.',
      timeout: 'The keychain didn’t answer in time: maybe it’s locked.',
      error: 'The keychain gave an invalid key.',
      'missing-key':
        'The keychain doesn’t have the key to this folder. The encrypted keys stay where they are and I won’t replace them on my own. Save them again; if the key is truly lost, run this in a terminal: monsters secrets reset.',
    },
    unreadable: (names: string) => `Not readable now: ${names}.`,
    saveAgain: 'Save them again.',
    waitKeychain:
      'They’re encrypted with the keychain: they’ll be back when the keychain responds, or you can save them again.',
    quarantined: (names: string) =>
      `The keychain no longer had the keys for: ${names}. Enter them again.`,
  },
};

const it: typeof en = {
  appearance: {
    title: 'Aspetto',
    theme: 'Tema',
    themeHint: 'Chiaro, scuro o come il resto del computer.',
    light: 'Chiaro',
    dark: 'Scuro',
    system: 'Sistema',
    reduceMotion: 'Riduci movimento',
    reduceMotionHint: 'I mostri restano fermi e le animazioni diventano semplici cambi di stato.',
    sounds: 'Suoni',
    soundsHint:
      'Piccoli clic dei tasti e della leva, e un segnale quando un mostro ti chiede qualcosa.',
    details: 'Mostra i dettagli tecnici',
    detailsHint: 'Sotto le risposte dei mostri: strumenti usati, tempo, costo e modello.',
  },
  language: {
    label: 'Lingua',
    hint: 'Dell’app, dei messaggi e di Telegram. I mostri scrivono nella lingua del loro profilo.',
    failed: 'Non sono riuscito a cambiare la lingua. Riprova.',
  },
  app: {
    title: 'App',
    footer: 'Vale per l’app di questo computer, anche quando mostra un altro computer.',
    openAtLogin: 'Apri all’accesso',
    openAtLoginHint:
      'Quando entri nel computer Monsters si apre da solo, senza finestra: resta l’icona vicino all’orologio e i mostri lavorano anche se non lo apri tu.',
    refused: 'Il sistema non mi ha lasciato cambiarlo. Riprova.',
  },
  password: {
    current: 'Password attuale',
    next: 'Nuova password',
    again: 'Ripeti la nuova password',
    minLength: (n) => `Almeno ${n} caratteri.`,
    currentMissing: 'Scrivi la password che usi adesso.',
    same: 'È uguale a quella di adesso.',
    mismatch: 'Le due password non sono uguali.',
    changed: 'Password cambiata.',
    changedOthers: (n) =>
      `Password cambiata. Gli altri accessi (${n}) dovranno entrare con quella nuova.`,
    changing: 'Cambio…',
    change: 'Cambia password',
    cancel: 'Annulla',
  },
  account: {
    title: 'Accesso',
    footer:
      'La password serve per entrare dal browser, dal telefono o da un altro computer. L’app sul computer dove gira Monsters entra da sola.',
    yours: 'Il tuo account',
    signedIn: 'Hai fatto l’accesso.',
    signOut: 'Esci',
    password: 'Password',
  },
  notes: {
    title: 'Note',
    footer: 'Una cartella normale di file Markdown: la puoi aprire anche con Obsidian.',
    folder: 'Cartella delle note',
    copyLabel: 'Copia il percorso della cartella delle note',
    copyTitle: 'Copia il percorso',
    copied: 'Percorso copiato.',
    copyFailed: 'Non riesco a copiarlo: selezionalo e copialo a mano.',
  },
  secrets: {
    title: 'Chiavi',
    where: 'Dove stanno le chiavi',
    keychain: 'Cifrate, con la chiave nel portachiavi del sistema.',
    files: (why) =>
      `In file protetti, leggibili solo dal tuo utente, non nel portachiavi. ${why}`.trim(),
    why: {
      keychain: '',
      forced: 'Scelto con MONSTERS_SECRETS=file.',
      unavailable: 'Su questo computer il portachiavi non è disponibile.',
      timeout: 'Il portachiavi non ha risposto in tempo: forse è bloccato.',
      error: 'Il portachiavi ha dato una chiave non valida.',
      'missing-key':
        'Il portachiavi non ha la chiave di questa cartella: le chiavi cifrate restano dove sono e non le sostituisco da solo. Salvale di nuovo; se la chiave è persa davvero, da terminale: monsters secrets reset.',
    },
    unreadable: (names) => `Non leggibili adesso: ${names}.`,
    saveAgain: 'Salvale di nuovo.',
    waitKeychain:
      'Sono cifrate col portachiavi: tornano quando il portachiavi risponde, oppure salvale di nuovo.',
    quarantined: (names) =>
      `Il portachiavi non aveva più la chiave di: ${names}. Vanno inserite di nuovo.`,
  },
};

export const generalStrings = defineStrings({ en, it });
