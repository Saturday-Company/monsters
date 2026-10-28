import { defineStrings } from '../../lib/i18n.ts';
import { toNameIt } from '../../lib/utils.strings.ts';

/* The shell: rail, sidebar, palette, status display, Stop, sheets and errors (D-153). */

const en = {
  loading: 'Loading…',
  skipToChat: 'Skip to the chat',
  skipToContent: 'Skip to the content',
  /** The name of each page, in the rail until the view puts its own title. */
  titles: {
    automations: 'Automations',
    project: 'Project',
    log: 'Activity',
    vault: 'Notes',
    files: 'Files',
    settings: 'Settings',
  },
  palette: {
    groups: { monsters: 'Monsters', notes: 'Notes', messages: 'Messages', commands: 'Commands' },
    dialog: 'Search and commands',
    label: 'Search monsters, notes, messages and commands',
    placeholder: 'Search a monster, a note, a command…',
    esc: 'esc',
    results: 'Results',
    searchingNotes: 'Searching the notes…',
    nothing: (text: string) => `Nothing for “${text}”: no monsters, notes or messages.`,
    hintChoose: '↑↓ choose',
    hintOpen: '↵ open',
    hintClose: 'esc close',
    lead: 'Your lead',
    youTo: (name: string) => `You, to ${name}`,
    commands: {
      newNote: { label: 'New note' },
      automations: {
        label: 'Automations',
        detail: 'The work the squad does on its own, on a schedule',
      },
      newAutomation: { label: 'New automation' },
      notes: { label: 'Notes' },
      files: { label: 'Files', detail: 'Attachments, screenshots and the monsters’ pages' },
      log: { label: 'Activity' },
      review: {
        label: 'To review',
        detail: 'Inbox: open questions, drafts, paused tools and the notes touched',
      },
      news: { label: 'What’s new', detail: 'Inbox: what changed with the updates' },
      dock: { label: 'Right-hand pane', detail: 'Preview, Behind the scenes, Usage' },
      resume: { label: 'Resume the monsters' },
      stop: {
        label: 'Stop all monsters',
        detail: 'Lift the Stop cover: press again to stop',
      },
      settings: { label: 'Settings' },
      models: { label: 'Settings › Models' },
      permissions: { label: 'Settings › Permissions' },
      links: { label: 'Settings › Apps and Telegram', detail: 'Telegram, apps, web search' },
      light: { label: 'Light theme' },
      dark: { label: 'Dark theme' },
      system: { label: 'Same theme as the computer' },
    },
  },
  status: {
    halted: 'Stopped',
    offline: 'Not connected',
    offlineShort: 'Offline',
    reconnecting: 'Reconnecting…',
    reconnectingShort: 'Reconnecting…',
    asks: (name: string) => `${name} asks`,
    questions: (n: number, name: string | null) =>
      `${n} ${n === 1 ? 'question' : 'questions'}${name ? ` · ${name}` : ''}`,
    questionsShort: (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`,
    changingCourseOne: (name: string) => `${name} is changing course`,
    changingCourseMany: (n: number) => `${n} are changing course`,
    working: (n: number) => `${n} at work`,
    alsoWorking: (n: number) => ` · ${n} at work`,
    quiet: 'All quiet',
    quietShort: 'Quiet',
    label: (spoken: string, clock: string, waiting: boolean) =>
      `Squad status: ${spoken}, ${clock}. ${waiting ? 'Open the chat that’s waiting' : 'Open Activity'}`,
    goToQuestion: 'Go to the question',
    openActivity: 'Open Activity',
  },
  halt: {
    stopped: 'Stopped',
    allStopped: 'The monsters are stopped.',
    reason: (reason: string) => `Reason: ${reason}. `,
    pending: (left: string) => `Pending: ${left}. `,
    canWrite: 'You can write: the messages go out when you resume.',
    /** `again`: "the message for Titan"; `n`: how many messages, for the verb. */
    again: (again: string, n: number) =>
      `With “Resume and continue”, ${again} ${n === 1 ? 'is' : 'are'} sent again.`,
    resume: 'Resume',
    resumeAndContinue: 'Resume and continue',
  },
  link: {
    notConnected: 'Not connected',
    silent: 'Monsters isn’t answering on the computer.',
    retrying: 'I’ll keep trying on my own.',
    retryNow: 'Try now',
  },
  close: 'Close',
  kill: {
    stop: 'Stop',
    resume: 'Resume',
    stopAll: 'Stop all monsters',
    resumeTitle: 'Resume: the monsters go back to work',
    armedTitle: 'Press again to stop all monsters',
    idleTitle: (keys: string) => `Stop all monsters (${keys})`,
    again: 'Again',
    armedHint: 'Cover lifted: press again to stop all monsters.',
  },
  toolbar: {
    back: 'Back',
    demo: 'demo',
  },
  sidebar: {
    archived: (n: number) => `Archived projects · ${n}`,
    newProject: 'New project',
    sections: 'Sections',
    sidebar: 'Sidebar',
    noSquad: 'The squad isn’t here yet.',
    projectsWhat: 'your projects',
    waitingOne: 'one job is waiting for an answer',
    waitingMany: (n: number) => `${n} jobs are waiting for an answer`,
    nav: {
      automations: { label: 'Automations' },
      notes: { label: 'Notes' },
      files: { label: 'Files' },
      log: { label: 'Activity' },
      settings: { label: 'Settings' },
    },
  },
  computer: {
    ready: 'ready',
    starting: 'starting…',
    connecting: 'connecting…',
    reconnecting: 'reconnecting…',
    offline: 'unreachable',
    thisComputer: 'This computer',
    anotherComputer: 'Another computer',
    label: (name: string, status: string) => `Computer: ${name}, ${status}. Switch computer`,
    switch: 'Switch computer',
  },
  news: {
    inUse: 'In use',
    using: (version: string) => `You’re using ${version}`,
    none: 'There’s no news to show yet.',
  },
  /** The Inbox: "To review" and the news of the updates, one key in the rail. */
  inbox: {
    label: 'Inbox',
    /** The tooltip: how many things wait, or what the key does. */
    title: (n: number, shown: boolean) =>
      n > 0
        ? `Inbox: ${n} ${n === 1 ? 'thing' : 'things'} to review`
        : shown
          ? 'Hide the Inbox'
          : 'Show the Inbox',
    /** The accessible name: the number of things and the light of the news. */
    named: (n: number, fresh: boolean) =>
      `Inbox${n > 0 ? `, ${n} to review` : ''}${fresh ? ', news you haven’t seen' : ''}`,
    close: 'Close the Inbox',
    closeTitle: 'Close (Esc)',
    tabs: 'Inbox sections',
    review: 'To review',
    news: 'News',
    newNews: 'new',
  },
  /** The messages of the shell when they live in the rail (a chip, or a key with a popover). */
  notices: {
    label: 'Notices',
    count: (n: number) => (n === 1 ? '1 notice' : `${n} notices`),
    more: (n: number) => (n === 1 ? '1 more notice' : `${n} more notices`),
    close: 'Close the list',
  },
  errors: {
    stillBroken:
      'A part of Monsters still won’t load after reloading: check that Monsters is running and up to date on that computer.',
    newVersion: 'There’s a new version of Monsters: reload the page to use it.',
    later: 'Later',
    reload: 'Reload',
    titleAgain: 'This part won’t load',
    titleChunk: 'There’s a new version of Monsters',
    titleBroken: 'Something broke here',
    textAgain:
      'I already reloaded the page, but it still doesn’t work. Check that Monsters is running and up to date on that computer, then try again.',
    textChunk:
      'This part of the page didn’t load: it happens after an update. Reload the page to continue.',
    textBroken:
      'This part of Monsters ran into a problem. Reloading the page is usually enough; meanwhile the monsters keep working.',
    tryAgain: 'Try again',
    reloadPage: 'Reload the page',
  },
};

const it: typeof en = {
  loading: 'Carico…',
  skipToChat: 'Vai alla chat',
  skipToContent: 'Vai al contenuto',
  titles: {
    automations: 'Automazioni',
    project: 'Progetto',
    log: 'Attività',
    vault: 'Note',
    files: 'File',
    settings: 'Impostazioni',
  },
  palette: {
    groups: { monsters: 'Mostri', notes: 'Note', messages: 'Messaggi', commands: 'Comandi' },
    dialog: 'Cerca e comandi',
    label: 'Cerca mostri, note, messaggi e comandi',
    placeholder: 'Cerca un mostro, una nota, un comando…',
    esc: 'esc',
    results: 'Risultati',
    searchingNotes: 'Cerco nelle note…',
    nothing: (text) => `Niente con «${text}»: né mostri, né note, né messaggi.`,
    hintChoose: '↑↓ scegli',
    hintOpen: '↵ apri',
    hintClose: 'esc chiudi',
    lead: 'Il tuo capo',
    youTo: (name) => `Tu, ${toNameIt(name)}`,
    commands: {
      newNote: { label: 'Nuova nota' },
      automations: {
        label: 'Automazioni',
        detail: 'Il lavoro che la squadra fa da sola, a orari fissi',
      },
      newAutomation: { label: 'Nuova automazione' },
      notes: { label: 'Note' },
      files: { label: 'File', detail: 'Allegati, screenshot e pagine dei mostri' },
      log: { label: 'Attività' },
      review: {
        label: 'Da rivedere',
        detail: 'In arrivo: domande aperte, bozze, strumenti fermi e note toccate',
      },
      news: { label: 'Novità', detail: 'In arrivo: cosa è cambiato con gli aggiornamenti' },
      dock: { label: 'Pannello a destra', detail: 'Anteprima, Dietro le quinte, Consumi' },
      resume: { label: 'Riprendi i mostri' },
      stop: {
        label: 'Ferma tutti i mostri',
        detail: 'Alza la copertura di Ferma: premi di nuovo per fermare',
      },
      settings: { label: 'Impostazioni' },
      models: { label: 'Impostazioni › Modelli' },
      permissions: { label: 'Impostazioni › Permessi' },
      links: {
        label: 'Impostazioni › App e Telegram',
        detail: 'Telegram, app, ricerca sul web',
      },
      light: { label: 'Tema chiaro' },
      dark: { label: 'Tema scuro' },
      system: { label: 'Tema come il computer' },
    },
  },
  status: {
    halted: 'Fermi',
    offline: 'Non collegato',
    offlineShort: 'Scollegato',
    reconnecting: 'Mi ricollego…',
    reconnectingShort: 'Ricollego…',
    asks: (name) => `${name} chiede`,
    questions: (n, name) => `${n} ${n === 1 ? 'domanda' : 'domande'}${name ? ` · ${name}` : ''}`,
    questionsShort: (n) => `${n} ${n === 1 ? 'domanda' : 'domande'}`,
    changingCourseOne: (name) => `${name} cambia strada`,
    changingCourseMany: (n) => `${n} cambiano strada`,
    working: (n) => `${n} al lavoro`,
    alsoWorking: (n) => ` · ${n} al lavoro`,
    quiet: 'Tutto tranquillo',
    quietShort: 'Tranquillo',
    label: (spoken, clock, waiting) =>
      `Stato della squadra: ${spoken}, ore ${clock}. ${waiting ? 'Apri la chat che aspetta' : 'Apri Attività'}`,
    goToQuestion: 'Vai alla domanda',
    openActivity: 'Apri Attività',
  },
  halt: {
    stopped: 'Fermi',
    allStopped: 'I mostri sono fermi.',
    reason: (reason) => `Motivo: ${reason}. `,
    pending: (left) => `In sospeso: ${left}. `,
    canWrite: 'Puoi scrivere: i messaggi partono quando riprendi.',
    again: (again, n) => `Con «Riprendi e continua» ${n === 1 ? 'riparte' : 'ripartono'} ${again}.`,
    resume: 'Riprendi',
    resumeAndContinue: 'Riprendi e continua',
  },
  link: {
    notConnected: 'Non collegato',
    silent: 'Monsters sul computer non risponde.',
    retrying: 'Riprovo da solo.',
    retryNow: 'Riprova adesso',
  },
  close: 'Chiudi',
  kill: {
    stop: 'Ferma',
    resume: 'Riprendi',
    stopAll: 'Ferma tutti i mostri',
    resumeTitle: 'Riprendi: i mostri tornano al lavoro',
    armedTitle: 'Premi di nuovo per fermare tutti i mostri',
    idleTitle: (keys) => `Ferma tutti i mostri (${keys})`,
    again: 'Di nuovo',
    armedHint: 'Copertura alzata: premi di nuovo per fermare tutti i mostri.',
  },
  toolbar: {
    back: 'Indietro',
    demo: 'prova',
  },
  sidebar: {
    archived: (n) => `Progetti archiviati · ${n}`,
    newProject: 'Nuovo progetto',
    sections: 'Sezioni',
    sidebar: 'Barra laterale',
    noSquad: 'La squadra non c’è ancora.',
    projectsWhat: 'i tuoi progetti',
    waitingOne: 'un lavoro aspetta una risposta',
    waitingMany: (n) => `${n} lavori aspettano una risposta`,
    nav: {
      automations: { label: 'Automazioni' },
      notes: { label: 'Note' },
      files: { label: 'File' },
      log: { label: 'Attività' },
      settings: { label: 'Impostazioni' },
    },
  },
  computer: {
    ready: 'pronto',
    starting: 'si avvia…',
    connecting: 'mi collego…',
    reconnecting: 'mi ricollego…',
    offline: 'non raggiungibile',
    thisComputer: 'Questo computer',
    anotherComputer: 'Un altro computer',
    label: (name, status) => `Computer: ${name}, ${status}. Cambia computer`,
    switch: 'Cambia computer',
  },
  news: {
    inUse: 'In uso',
    using: (version) => `Stai usando la ${version}`,
    none: 'Non ci sono ancora novità da mostrare.',
  },
  inbox: {
    label: 'In arrivo',
    title: (n, shown) =>
      n > 0
        ? `In arrivo: ${n} ${n === 1 ? 'cosa' : 'cose'} da rivedere`
        : shown
          ? 'Nascondi “In arrivo”'
          : 'Mostra “In arrivo”',
    named: (n, fresh) =>
      `In arrivo${n > 0 ? `, ${n} da rivedere` : ''}${fresh ? ', novità non viste' : ''}`,
    close: 'Chiudi “In arrivo”',
    closeTitle: 'Chiudi (Esc)',
    tabs: 'Sezioni di “In arrivo”',
    review: 'Da rivedere',
    news: 'Novità',
    newNews: 'nuove',
  },
  notices: {
    label: 'Avvisi',
    count: (n) => (n === 1 ? '1 avviso' : `${n} avvisi`),
    more: (n) => (n === 1 ? '1 altro avviso' : `altri ${n} avvisi`),
    close: 'Chiudi l’elenco',
  },
  errors: {
    stillBroken:
      'Una parte di Monsters non si carica nemmeno dopo aver ricaricato: controlla che Monsters sia acceso e aggiornato su quel computer.',
    newVersion: 'C’è una versione nuova di Monsters: ricarica la pagina per usarla.',
    later: 'Più tardi',
    reload: 'Ricarica',
    titleAgain: 'Questa parte non si carica',
    titleChunk: 'C’è una versione nuova di Monsters',
    titleBroken: 'Qualcosa si è rotto qui',
    textAgain:
      'Ho già ricaricato la pagina, ma non va ancora. Controlla che Monsters sia acceso e aggiornato su quel computer, poi riprova.',
    textChunk:
      'Questa parte della pagina non si è caricata: succede dopo un aggiornamento. Ricarica la pagina per continuare.',
    textBroken:
      'Questa parte di Monsters ha avuto un problema. Di solito basta ricaricare la pagina; i mostri intanto continuano il loro lavoro.',
    tryAgain: 'Riprova',
    reloadPage: 'Ricarica la pagina',
  },
};

export const shellStrings = defineStrings({ en, it });
