import { defineStrings } from '../../lib/i18n.ts';

/* The sign-in, "Can’t find Monsters" and the owner’s password prompt (D-153). */

const en = {
  authScreen: {
    // The line of light under the monster, by phase.
    line: {
      asleep: 'The squad is asleep',
      busy: 'Checking…',
      awake: 'Hi!',
      refused: 'I don’t know you',
    },
    lineSetup: {
      asleep: 'Ready for the first power-on',
      refused: 'Something’s missing',
    },
    // The status at the top of the faceplate.
    status: {
      awake: 'Awake',
      busy: 'Checking',
      missing: 'Something’s missing',
      refused: 'Refused',
      waiting: 'Waiting',
    },
    headerSetup: 'First power-on',
    headerLogin: 'Sign-in',
    titleSetup: 'Create your account',
    titleLogin: 'Sign in',
    introSetup: 'Monsters runs on your computer. The account is only for you, to sign in.',
    introLogin: 'Welcome back! Sign in with the email and password you chose the first time.',
    email: 'Email',
    password: 'Password',
    passwordHint: (n: number) => `At least ${n} characters.`,
    setupCode: 'Setup code',
    demoCode: 'Demo mode: the code is',
    codeBefore: 'You’ll find it where you ran ',
    emailInvalid: 'Enter a valid email address.',
    passwordShort: (n: number) => `The password must be at least ${n} characters long.`,
    codeMissing: 'Enter the setup code (you’ll find it where you ran “monsters start”).',
    emailAndPassword: 'Type your email and password.',
    entering: 'Signing in…',
    wait: 'One moment…',
    create: 'Create account',
    signIn: 'Sign in',
  },
  forgot: {
    button: 'I forgot my password',
    intro: 'The account lives only on the computer where Monsters runs: no email can reset it.',
    appTitle: 'With the app',
    app: 'Open the Monsters app on that computer: you’ll be signed in without a password.',
    terminalTitle: 'With the terminal',
    terminalBefore: 'On that computer run ',
    terminalAfter: ' and choose a new one.',
  },
  owner: {
    title: 'Confirm it’s you',
    owner:
      'Only you can decide this. The app signed in by itself with the terminal token, which a monster with the Terminal can read too: to approve, grant permissions or change Telegram, your password is needed.',
    recent:
      'Giving a monster the Terminal, pairing Telegram or turning on tools for others needs your password from the last few minutes: type it again.',
    password: 'Password',
    cancel: 'Cancel',
    checking: 'Checking…',
    confirm: 'Confirm',
  },
  unreachable: {
    details: 'Details',
    terminalTitle: 'From the terminal',
    terminalBefore: 'On the computer where Monsters runs, type ',
    terminalApp: ' if the app can’t start it by itself',
    terminalAfter: ', then come back here and try again.',
    notConnected: 'Not connected',
    title: 'I can’t find Monsters',
    app: 'Monsters isn’t answering on this computer. Close the app and open it again, then try again.',
    browser:
      'Monsters isn’t answering. Check that it’s running on the computer where you installed it, then try again.',
    retry: 'Try again',
  },
};

const it: typeof en = {
  authScreen: {
    line: {
      asleep: 'La squadra dorme',
      busy: 'Controllo…',
      awake: 'Ciao!',
      refused: 'Non ti riconosco',
    },
    lineSetup: {
      asleep: 'Pronto per la prima accensione',
      refused: 'Manca qualcosa',
    },
    status: {
      awake: 'Sveglio',
      busy: 'Controllo',
      missing: 'Manca qualcosa',
      refused: 'Rifiutato',
      waiting: 'In attesa',
    },
    headerSetup: 'Prima accensione',
    headerLogin: 'Accesso',
    titleSetup: 'Crea il tuo account',
    titleLogin: 'Accedi',
    introSetup: 'Monsters gira sul tuo computer. L’account serve solo a te, per entrare.',
    introLogin: 'Bentornato! Entra con l’email e la password che hai scelto al primo avvio.',
    email: 'Email',
    password: 'Password',
    passwordHint: (n) => `Almeno ${n} caratteri.`,
    setupCode: 'Codice di avvio',
    demoCode: 'Modalità prova: il codice è',
    codeBefore: 'Lo trovi dove hai lanciato ',
    emailInvalid: 'Serve un indirizzo email valido.',
    passwordShort: (n) => `La password deve avere almeno ${n} caratteri.`,
    codeMissing: 'Inserisci il codice di avvio (lo trovi dove hai lanciato “monsters start”).',
    emailAndPassword: 'Scrivi email e password.',
    entering: 'Entro…',
    wait: 'Un attimo…',
    create: 'Crea account',
    signIn: 'Entra',
  },
  forgot: {
    button: 'Ho dimenticato la password',
    intro: 'L’account vive solo sul computer dove gira Monsters: nessuna mail lo può reimpostare.',
    appTitle: 'Con l’app',
    app: 'Apri l’app Monsters su quel computer: lì entri senza password.',
    terminalTitle: 'Con il terminale',
    terminalBefore: 'Su quel computer esegui ',
    terminalAfter: ' e scegline una nuova.',
  },
  owner: {
    title: 'Conferma che sei tu',
    owner:
      'Questa la decidi solo tu. L’app è entrata da sola con il token del terminale, che anche un mostro con il Terminale può leggere: per approvare, dare permessi o cambiare Telegram serve la tua password.',
    recent:
      'Dare il Terminale a un mostro, abbinare Telegram o accendere gli strumenti per gli altri vuole la tua password degli ultimi minuti: scrivila di nuovo.',
    password: 'Password',
    cancel: 'Annulla',
    checking: 'Controllo…',
    confirm: 'Conferma',
  },
  unreachable: {
    details: 'Dettagli',
    terminalTitle: 'Da terminale',
    terminalBefore: 'Sul computer dove gira Monsters scrivi ',
    terminalApp: ' se l’app non riesce ad avviarlo da sola',
    terminalAfter: ', poi torna qui e riprova.',
    notConnected: 'Non collegato',
    title: 'Non trovo Monsters',
    app: 'Monsters non risponde su questo computer. Chiudi l’app e aprila di nuovo, poi riprova.',
    browser:
      'Monsters non risponde. Controlla che sia acceso sul computer dove l’hai installato, poi riprova.',
    retry: 'Riprova',
  },
};

export const authStrings = defineStrings({ en, it });
