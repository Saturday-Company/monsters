import { pick } from '@monsters/shared';

/*
 * The words of the application: menus (app menu, tray, dock), the dialogs and error boxes of
 * index.ts. The role items of the menus keep their custom labels so that they follow the app's
 * language, not the system's. Typed dictionaries (D-153); call `appStrings()` where the text is
 * produced (the menus are rebuilt when the language changes).
 */

const en = {
  menu: {
    open: 'Open Monsters',
    kill: 'Stop everything',
    resume: 'Resume',
    quit: 'Quit Monsters',
    connections: 'Connections…',
    reconnect: 'Reconnect',
    use: 'Use',
    thisComputer: 'This computer',
    about: 'About Monsters',
    hide: 'Hide Monsters',
    hideOthers: 'Hide others',
    unhide: 'Show all',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    view: 'View',
    reload: 'Reload',
    actualSize: 'Actual size',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fullScreen: 'Full screen',
    devTools: 'Developer tools',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    closeWindow: 'Close window',
  },
  coreAction: {
    killFailed: 'I couldn’t stop the monsters',
    resumeFailed: 'I couldn’t resume',
    notConnected: (name: string) => `I’m not connected to ${name} right now.`,
    notRunning: 'Monsters isn’t running on this computer yet: wait a moment and try again.',
    signInFirst: 'Sign in to Monsters in the window first (email and password), then try again.',
    noAnswer:
      'Monsters didn’t respond as it should. Try again from the button in the Monsters window.',
  },
  pickFolder: 'Choose a folder',
  update: {
    failedTitle: 'Update failed',
    fileGone: 'Monsters can’t find its file anymore: download it again from the website.',
    cannotInstall: 'I can’t install the update',
    commandCopied: 'Command copied: paste it into a terminal.',
  },
  startFailed: {
    message: 'Monsters can’t start',
    detail: (home: string, why: string) =>
      `I can’t use Monsters’ data folder (${home}): check that it exists and that you can write to it, then reopen Monsters.\n\nDetails: ${why}`,
    quit: 'Quit',
  },
};

const it: typeof en = {
  menu: {
    open: 'Apri Monsters',
    kill: 'Ferma tutto',
    resume: 'Riprendi',
    quit: 'Esci da Monsters',
    connections: 'Connessioni…',
    reconnect: 'Ricollega',
    use: 'Usa',
    thisComputer: 'Questo computer',
    about: 'Informazioni su Monsters',
    hide: 'Nascondi Monsters',
    hideOthers: 'Nascondi altre',
    unhide: 'Mostra tutte',
    edit: 'Modifica',
    undo: 'Annulla',
    redo: 'Ripeti',
    cut: 'Taglia',
    copy: 'Copia',
    paste: 'Incolla',
    selectAll: 'Seleziona tutto',
    view: 'Vista',
    reload: 'Ricarica',
    actualSize: 'Dimensioni reali',
    zoomIn: 'Ingrandisci',
    zoomOut: 'Riduci',
    fullScreen: 'Schermo intero',
    devTools: 'Strumenti per sviluppatori',
    window: 'Finestra',
    minimize: 'Riduci a icona',
    zoom: 'Zoom',
    closeWindow: 'Chiudi finestra',
  },
  coreAction: {
    killFailed: 'Non sono riuscito a fermare i mostri',
    resumeFailed: 'Non sono riuscito a riprendere',
    notConnected: (name) => `Non sono collegato a ${name} in questo momento.`,
    notRunning: 'Monsters non è ancora acceso su questo computer: aspetta un attimo e riprova.',
    signInFirst: 'Prima accedi a Monsters nella finestra (email e password), poi riprova.',
    noAnswer:
      'Monsters non ha risposto come doveva. Riprova dal pulsante nella finestra di Monsters.',
  },
  pickFolder: 'Scegli una cartella',
  update: {
    failedTitle: 'Aggiornamento non riuscito',
    fileGone: 'Monsters non trova più il suo file: scaricalo di nuovo dal sito.',
    cannotInstall: 'Non posso installare l’aggiornamento',
    commandCopied: 'Comando copiato: incollalo in un terminale.',
  },
  startFailed: {
    message: 'Monsters non riesce a partire',
    detail: (home, why) =>
      `Non riesco a usare la cartella dei dati di Monsters (${home}): controlla che esista e che tu possa scriverci, poi riapri Monsters.\n\nDettagli: ${why}`,
    quit: 'Esci',
  },
};

export const appStrings = () => pick({ en, it });
