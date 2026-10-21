import { pick } from '@monsters/shared';

/*
 * The messages of the HTTP API that a person reads (D-153): the UI shows the
 * `message` of an error as it comes. Error codes (`error`) stay as they are.
 */

const en = {
  // confirmation and password
  confirmRequired: 'This needs your password again: confirm it’s you.',
  ownerRequired:
    'Only you can decide this: from the app with your password, or from your Telegram. The terminal token isn’t enough.',
  secretRequired: 'This tab doesn’t have the session key: sign in again.',
  confirmFromApp: 'You confirm from the app, with your password.',
  wrongPassword: 'The password isn’t right.',
  passwordFromSettings:
    'The password is changed from the settings; from the terminal use "monsters password".',
  samePassword: 'The new password is the same as the current one.',
  wrongCurrentPassword: 'The current password isn’t right.',
  coreRunning:
    'With Monsters running, the password is changed from the settings. From the terminal: stop Monsters, then "monsters password".',
  // the log archive
  archiveTooSoon: (minutes: number) =>
    `One manual archive per hour at most: try again in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}.`,
  stopping: 'Monsters is stopping.',
  archivePostponed: (reason: string) => `Archive postponed, nothing changed: ${reason}.`,
  archiveFailed: (reason: string) =>
    `The archive failed (no events lost: the ones not written to the file stay in the log): ${reason}`,
  // files
  fileTooLarge: 'The file is too large: 25 MB at most.',
  fileNotFound: 'File not found.',
  uploadUnreadable: 'The upload couldn’t be read.',
  fileMissing: 'The file is missing.',
  attachmentGone: 'An attachment is gone: remove it and try again.',
  trashedFromUi: 'Trashed from the interface',
  // drafts, tasks
  unknownDraft: 'Unknown draft.',
  unknownTask: 'No task with this id.',
  // first start
  onboardingPendingProject: 'Finish the first start first: the squad doesn’t exist yet.',
  onboardingPendingTeam:
    'Finish the first start in the interface first: open Monsters in the browser and create your squad.',
  // models
  autoNeedsClaude: 'The automatic choice uses your Claude plan: connect Claude Agent first.',
  providerNotConfigured: (provider: string) => `${provider} isn’t set up: add its key first.`,
  paidModelBlocked: (model: string) =>
    `${model} is paid: turn on “Also use paid models” in Settings → Models, or pick a free model.`,
  // other apps: the sign-in page
  oauthTitleOk: 'Connected',
  oauthTitleFailed: 'Sign-in failed',
  oauthCloseOk: 'You can close this tab and go back to Monsters.',
  oauthCloseFailed: 'Close this tab and try again from Monsters.',
  oauthPasteFull: 'Paste the whole address of the page, starting from “http”.',
  oauthNotReturnPage:
    'That isn’t the address of the return page: copy it from the browser’s address bar after signing in.',
  // the page shown when the UI build is missing
  noUiTitle: 'Monsters: the interface is missing',
  noUiHeading: 'Monsters is running, but the interface is missing',
  noUiBody: (dir: string) => `The core can’t find the web UI build in <code>${dir}</code>.`,
  noUiHow: 'Build it from the project folder, then reload this page:',
};

const it: typeof en = {
  confirmRequired: 'Per questa serve di nuovo la tua password: conferma che sei tu.',
  ownerRequired:
    'Questa la decidi solo tu: dall’app con la tua password, o dal tuo Telegram. Il token del terminale non basta.',
  secretRequired: 'Questa scheda non ha la chiave della sessione: accedi di nuovo.',
  confirmFromApp: 'Si conferma dall’app, con la tua password.',
  wrongPassword: 'La password non è giusta.',
  passwordFromSettings:
    'La password si cambia dalle impostazioni; dal terminale usa "monsters password".',
  samePassword: 'La nuova password è uguale a quella di adesso.',
  wrongCurrentPassword: 'La password attuale non è giusta.',
  coreRunning:
    'Con Monsters acceso la password si cambia dalle impostazioni. Dal terminale: ferma Monsters, poi "monsters password".',
  archiveTooSoon: (minutes) =>
    `Un archivio a mano al massimo ogni ora: riprova tra ${minutes === 1 ? '1 minuto' : `${minutes} minuti`}.`,
  stopping: 'Monsters si sta fermando.',
  archivePostponed: (reason) => `Archivio rimandato, niente è cambiato: ${reason}.`,
  archiveFailed: (reason) =>
    `Archivio non riuscito (nessun evento perso: quelli non scritti nel file restano nel registro): ${reason}`,
  fileTooLarge: 'Il file è troppo grande: al massimo 25 MB.',
  fileNotFound: 'File non trovato.',
  uploadUnreadable: 'Upload non leggibile.',
  fileMissing: 'Manca il file.',
  attachmentGone: 'Un allegato non c’è più: toglilo e riprova.',
  trashedFromUi: 'Cestinata dall’interfaccia',
  unknownDraft: 'Bozza sconosciuta.',
  unknownTask: 'Nessun lavoro con questo id.',
  onboardingPendingProject: 'Completa prima il primo avvio: la squadra non esiste ancora.',
  onboardingPendingTeam:
    'Completa prima il primo avvio nell’interfaccia: apri Monsters nel browser e crea la tua squadra.',
  autoNeedsClaude: 'La scelta automatica usa il piano Claude: collega prima Claude Agent.',
  providerNotConfigured: (provider) => `${provider} non è configurato: aggiungi prima la chiave.`,
  paidModelBlocked: (model) =>
    `${model} è a pagamento: attiva “Usa anche modelli a pagamento” in Impostazioni → Modelli, oppure scegli un modello gratuito.`,
  oauthTitleOk: 'Collegato',
  oauthTitleFailed: 'Accesso non riuscito',
  oauthCloseOk: 'Puoi chiudere questa scheda e tornare a Monsters.',
  oauthCloseFailed: 'Chiudi questa scheda e riprova da Monsters.',
  oauthPasteFull: 'Incolla l’indirizzo intero della pagina, da “http” in poi.',
  oauthNotReturnPage:
    'Non è l’indirizzo della pagina di ritorno: copialo dalla barra del browser dopo l’accesso.',
  noUiTitle: "Monsters: manca l'interfaccia",
  noUiHeading: "Monsters è acceso, ma manca l'interfaccia",
  noUiBody: (dir) => `Il core non trova la build della UI web in <code>${dir}</code>.`,
  noUiHow: 'Lanciala dalla cartella del progetto, poi ricarica questa pagina:',
};

export const serverStrings = () => pick({ en, it });
