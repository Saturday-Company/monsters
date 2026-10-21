import { pick } from '@monsters/shared';

/*
 * The words of the updater (updater.ts): the menu entry, the dialogs, the notification and the
 * errors kept in its state. Typed dictionaries (D-153); call `updaterStrings()` where the text
 * is produced.
 */

const en = {
  menu: {
    check: 'Check for updates',
    checking: 'Checking for updates…',
    downloading: (version: string, percent: number) =>
      `Downloading version ${version} (${percent}%)`,
    restart: (version: string) => `Restart to update (version ${version})`,
    installing: 'Updating…',
    failed: 'Update failed: try again',
  },
  manualCheck: {
    latest: 'Monsters is up to date',
    latestDetail: (version: string) => `You already have the latest version (${version}).`,
    found: (version: string) => `Version ${version} is available`,
    foundDetail:
      'I’m downloading it: when it’s ready I’ll ask whether to restart. You can keep using Monsters meanwhile.',
    error: 'I can’t check for updates',
    errorDetail: (message: string) =>
      `Check that you’re connected to the internet and try again later. Detail: ${message}`,
  },
  notice: {
    title: 'Update ready',
    body: (version: string) =>
      `Monsters ${version} is ready: click here to restart and install it.`,
  },
  ready: {
    message: (version: string) => `Monsters ${version} is ready`,
    later: 'If you prefer, you’ll also find it later in the menu, under “Restart to update”.',
    passwordDetail: (later: string) =>
      'I’ll ask for your computer’s password to install the update (the one you sign in with, ' +
      'for a user who can install programs). Then Monsters restarts: it takes a few seconds. ' +
      `If you cancel, everything stays as it is. ${later}`,
    detail: (later: string) => `To install it, Monsters restarts: it takes a few seconds. ${later}`,
    restartNow: 'Restart now',
    notNow: 'Later',
  },
  debFailure: {
    copyCommand: 'Copy the command',
    openLink: 'Open the link',
    close: 'Close',
    half: 'Monsters is restarting, but the new version’s files are already on disk and the package isn’t configured: until you finish it, it may not start properly.',
    restarting: 'Monsters is restarting with the version that is installed now.',
    continues: (version: string) => `Monsters keeps running version ${version}.`,
    finish: (command: string) =>
      `To finish the installation, open a terminal and type:\n\n${command}\n\n(apt downloads the missing dependencies)`,
    byHand: (command: string, depends: boolean) =>
      `To install it by hand, open a terminal and type:\n\n${command}${
        depends ? '\n\n(apt downloads the missing dependencies by itself)' : ''
      }`,
    tampered: 'It may be a tampered package: don’t install it by hand.',
    again: 'Download it again and install it by hand.',
    link: (url: string) => `\n\nThe package can also be downloaded from:\n${url}`,
    message: (version: string) => `I didn’t install Monsters ${version}`,
  },
  state: {
    installNotStarted: 'The installation didn’t start: try again.',
    noPackage: 'I can’t find the downloaded package: check for updates again',
    currentVersion: 'current',
    appFileGone: (path: string) => `the app file is gone (${path})`,
    folderNotWritable: (dir: string) =>
      `the folder ${dir} isn’t writable: download the new version and replace the file by hand`,
    noBackup: (why: string) => `I can’t keep a copy of the app in its folder (${why})`,
  },
};

const it: typeof en = {
  menu: {
    check: 'Cerca aggiornamenti',
    checking: 'Cerco aggiornamenti…',
    downloading: (version, percent) => `Scarico la versione ${version} (${percent}%)`,
    restart: (version) => `Riavvia per aggiornare (versione ${version})`,
    installing: 'Aggiorno…',
    failed: 'Aggiornamento non riuscito: riprova',
  },
  manualCheck: {
    latest: 'Monsters è aggiornato',
    latestDetail: (version) => `Hai già l’ultima versione (${version}).`,
    found: (version) => `C’è la versione ${version}`,
    foundDetail:
      'La sto scaricando: quando è pronta ti chiedo se riavviare. Intanto puoi continuare a usare Monsters.',
    error: 'Non riesco a cercare gli aggiornamenti',
    errorDetail: (message) =>
      `Controlla di essere collegato a internet e riprova più tardi. Dettaglio: ${message}`,
  },
  notice: {
    title: 'Aggiornamento pronto',
    body: (version) => `Monsters ${version} è pronto: fai clic qui per riavviare e installarlo.`,
  },
  ready: {
    message: (version) => `Monsters ${version} è pronto`,
    later: 'Se preferisci, lo trovi anche più tardi nel menu, alla voce «Riavvia per aggiornare».',
    passwordDetail: (later) =>
      'Ti chiederò la password del computer per installare l’aggiornamento (quella con cui ' +
      'accedi, di un utente che può installare programmi). Poi Monsters si riavvia: ci ' +
      `vogliono pochi secondi. Se annulli, resta tutto com’è. ${later}`,
    detail: (later) => `Per installarlo Monsters si riavvia: ci vogliono pochi secondi. ${later}`,
    restartNow: 'Riavvia ora',
    notNow: 'Più tardi',
  },
  debFailure: {
    copyCommand: 'Copia il comando',
    openLink: 'Apri il link',
    close: 'Chiudi',
    half: 'Monsters si riavvia, ma i file della versione nuova sono già sul disco e il pacchetto non è configurato: finché non lo completi può non partire bene.',
    restarting: 'Monsters si riavvia con la versione che è installata adesso.',
    continues: (version) => `Monsters continua con la versione ${version}.`,
    finish: (command) =>
      `Per completare l’installazione, apri un terminale e scrivi:\n\n${command}\n\n(apt scarica le dipendenze che mancano)`,
    byHand: (command, depends) =>
      `Per installarlo a mano, apri un terminale e scrivi:\n\n${command}${
        depends ? '\n\n(apt scarica da solo le dipendenze che mancano)' : ''
      }`,
    tampered: 'Può essere un pacchetto manomesso: non installarlo a mano.',
    again: 'Scaricalo di nuovo e installalo a mano.',
    link: (url) => `\n\nIl pacchetto si scarica anche da:\n${url}`,
    message: (version) => `Non ho installato Monsters ${version}`,
  },
  state: {
    installNotStarted: 'L’installazione non è partita: riprova.',
    noPackage: 'non trovo il pacchetto scaricato: riprova a cercare gli aggiornamenti',
    currentVersion: 'attuale',
    appFileGone: (path) => `il file dell'app non c'è più (${path})`,
    folderNotWritable: (dir) =>
      `la cartella ${dir} non è scrivibile: scarica la nuova versione e sostituisci il file a mano`,
    noBackup: (why) => `non riesco a tenere una copia dell'app nella sua cartella (${why})`,
  },
};

export const updaterStrings = () => pick({ en, it });
