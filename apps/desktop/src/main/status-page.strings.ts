import { pick } from '@monsters/shared';

/*
 * The words of the status page (what the window shows while there is no core): typed
 * dictionaries (D-153). Call `statusPageStrings()` where the page is built.
 */

const en = {
  retry: 'Try again',
  details: 'Details',
  actions: {
    local: 'Use this computer',
    connections: 'Connections…',
    'add-connection': 'Add a computer',
    fix: 'Fix the connection',
    'forget-key': 'Forget the old key',
    'open-log': 'Open the log',
  },
  seconds: (s: number) => (s === 1 ? 'one second' : `${s} seconds`),
  starting: {
    title: 'Starting Monsters…',
    body: 'One moment: it’s starting on this computer.',
  },
  restarting: {
    title: 'Monsters stopped unexpectedly',
    restartIn: (time: string, attempt: number, max: number) =>
      `Restarting in ${time} (attempt ${attempt} of ${max}).`,
    interrupted: 'Any work in progress was interrupted: you’ll find it in Activity.',
  },
  failed: {
    title: 'Monsters won’t restart',
    body: 'I tried several times without success. Try again; if that doesn’t help, the log says what happened.',
    detail: (logPath: string) => `The log is at ${logPath}`,
  },
  locked: {
    title: 'Monsters is already running, but not responding',
    body: (home: string) =>
      `Another Monsters is using this computer’s data (${home}) and isn’t responding.`,
    close: 'Close it (if you opened it from a terminal, with Ctrl+C), then press “Try again”.',
  },
  missing: {
    title: 'Part of Monsters is missing',
    devNotFound: (path: string) => `I can’t find ${path}.`,
    devFix: 'From the project folder run pnpm build:core, then try again.',
    body: 'The installation looks incomplete: reinstall Monsters, then open it again.',
    detail: (path: string) => `I can’t find ${path}`,
  },
  tampered: {
    title: 'Monsters won’t start: its files have changed',
    why: 'A file of Monsters’ engine isn’t the installed one. To be safe I’m not starting it: another program may have changed it.',
    fix: 'Reinstall Monsters (your data stays where it is), then open it again.',
    detail: (what: string, logPath: string) => `${what}. The log is at ${logPath}`,
  },
  remoteConnecting: {
    title: (name: string) => `Connecting to ${name}…`,
    body: 'One moment: I’m reaching the Monsters running on that computer.',
  },
  remoteFailed: {
    title: (name: string) => `I can’t connect to ${name}`,
  },
  face: {
    welcomeSection: 'First start',
    welcomeState: 'Waiting',
    welcomeLine: 'Ready for the first start',
    startupSection: 'Startup',
    startingState: 'Starting',
    startingLine: 'Starting up…',
    restartingState: 'Restarting',
    restartingLine: (attempt: number, max: number) => `Attempt ${attempt} / ${max}`,
    stoppedState: 'Stopped',
    failedLine: 'Won’t restart',
    lockedState: 'Busy',
    lockedLine: 'Data already in use',
    missingState: 'Incomplete',
    missingLine: 'A piece is missing',
    tamperedLine: 'Files changed',
    linkSection: 'Connection',
    connectingState: 'Connecting',
    notConnectedState: 'Not connected',
  },
  welcome: {
    title: 'Where do your monsters work?',
    hint: 'You can change this any time in Connections.',
    local: 'On this computer',
    recommended: 'Recommended',
    localHint: 'Everything stays here. Fine for almost everyone.',
    other: 'On another computer of mine',
    otherHint:
      'Monsters is already running on another computer of yours and you want to use it from here.',
  },
};

const it: typeof en = {
  retry: 'Riprova',
  details: 'Dettagli',
  actions: {
    local: 'Usa questo computer',
    connections: 'Connessioni…',
    'add-connection': 'Aggiungi un computer',
    fix: 'Correggi la connessione',
    'forget-key': 'Dimentica la vecchia chiave',
    'open-log': 'Apri il log',
  },
  seconds: (s) => (s === 1 ? 'un secondo' : `${s} secondi`),
  starting: {
    title: 'Accendo Monsters…',
    body: 'Un attimo: sta partendo su questo computer.',
  },
  restarting: {
    title: 'Monsters si è fermato all’improvviso',
    restartIn: (time, attempt, max) => `Lo riavvio tra ${time} (tentativo ${attempt} di ${max}).`,
    interrupted: 'I lavori che erano in corso si sono interrotti: li ritrovi in Attività.',
  },
  failed: {
    title: 'Monsters non riparte',
    body: 'Ho provato più volte senza riuscirci. Riprova; se non basta, nel log c’è cosa è successo.',
    detail: (logPath) => `Il log è in ${logPath}`,
  },
  locked: {
    title: 'Monsters è già acceso, ma non risponde',
    body: (home) =>
      `Un altro Monsters sta usando i dati di questo computer (${home}) e non risponde.`,
    close: 'Chiudilo (se l’hai aperto da un terminale, con Ctrl+C), poi premi «Riprova».',
  },
  missing: {
    title: 'Manca una parte di Monsters',
    devNotFound: (path) => `Non trovo ${path}.`,
    devFix: 'Dalla cartella del progetto lancia pnpm build:core, poi riprova.',
    body: 'L’installazione sembra incompleta: installa di nuovo Monsters, poi riaprilo.',
    detail: (path) => `Non trovo ${path}`,
  },
  tampered: {
    title: 'Monsters non parte: i suoi file sono cambiati',
    why: 'Un file del motore di Monsters non è quello installato. Per sicurezza non lo avvio: potrebbe averlo cambiato un altro programma.',
    fix: 'Installa di nuovo Monsters (i tuoi dati restano dove sono), poi riaprilo.',
    detail: (what, logPath) => `${what}. Il log è in ${logPath}`,
  },
  remoteConnecting: {
    title: (name) => `Mi collego a ${name}…`,
    body: 'Un attimo: raggiungo il Monsters che gira su quel computer.',
  },
  remoteFailed: {
    title: (name) => `Non riesco a collegarmi a ${name}`,
  },
  face: {
    welcomeSection: 'Prima accensione',
    welcomeState: 'In attesa',
    welcomeLine: 'Pronto per la prima accensione',
    startupSection: 'Accensione',
    startingState: 'Accendo',
    startingLine: 'Si accende…',
    restartingState: 'Riavvio',
    restartingLine: (attempt, max) => `Tentativo ${attempt} / ${max}`,
    stoppedState: 'Fermo',
    failedLine: 'Non riparte',
    lockedState: 'Occupato',
    lockedLine: 'Dati già in uso',
    missingState: 'Incompleto',
    missingLine: 'Manca un pezzo',
    tamperedLine: 'File cambiati',
    linkSection: 'Collegamento',
    connectingState: 'Mi collego',
    notConnectedState: 'Non collegato',
  },
  welcome: {
    title: 'Dove lavorano i tuoi mostri?',
    hint: 'Puoi cambiarlo quando vuoi da Connessioni.',
    local: 'Su questo computer',
    recommended: 'Consigliato',
    localHint: 'Tutto resta qui. Va bene quasi sempre.',
    other: 'Su un altro mio computer',
    otherHint: 'Monsters è già acceso su un altro tuo computer e vuoi usarlo da qui.',
  },
};

export const statusPageStrings = () => pick({ en, it });
