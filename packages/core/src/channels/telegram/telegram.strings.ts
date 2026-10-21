import { pick, vaultLayout } from '@monsters/shared';

/** The default folder of the new projects (`Monsters Progetti`, `Monsters Projects`: D-154). */
const projectsDir = () => vaultLayout().projectsDir;

/*
 * What the main Telegram bot says (D-153): English first, Italian as a choice. The texts are
 * picked when they are written, in the app's language of that moment. A few take HTML: the
 * values they receive are escaped by the caller.
 *
 * The commands: their names follow the language (`/resume` or `/riprendi`) and are registered
 * with `setMyCommands`; the bot always understands both (see `COMMAND_ALIASES`).
 */

const en = {
  // --- commands and help ---
  commands: [
    { command: 'stop', description: 'Stop all the monsters right now' },
    { command: 'resume', description: 'Start the monsters again' },
    { command: 'new', description: 'New conversation' },
    { command: 'status', description: 'What they’re doing' },
    { command: 'help', description: 'How to use me' },
  ],
  help: [
    'Write to me and I’ll pass the message on to the squad; start with <code>@Name</code> to talk to a specific monster.',
    '',
    '/stop: stop all the monsters right now',
    '/resume: start them again',
    '/new: new conversation (also <code>/new @Name</code>)',
    '/status: what they’re doing',
    '',
    'Answer questions with the buttons, or by replying to the question’s message.',
  ].join('\n'),
  unknownCommand: (name: string, help: string) => `I don’t know /${name}.\n\n${help}`,
  stopReason: '/stop from Telegram',
  stopped: (runs: number, programs: number) =>
    `■ Everything stopped. Work interrupted: ${runs}, programs closed: ${programs}.\nNothing restarts until you type /resume.`,
  notHalted: 'The monsters aren’t stopped.',
  resumeAsk: 'Start the monsters again?',
  resumeYes: 'Yes, resume',
  resumeNo: 'No',
  resumeKeptStopped: 'OK: they stay stopped.',
  resumed: '▶ Back on: the monsters can work again.',
  haltedWrite: 'The monsters are stopped. Type /resume to start them again.',
  newConversation: (withName: string | null) =>
    `New conversation${withName ? ` with ${withName}` : ''}: earlier messages stay in the log, but the monsters no longer see them.`,

  // --- status ---
  statusHalted: '<b>Stopped</b> (kill switch): /resume to start them again.',
  statusRunning: '<b>Running.</b>',
  statusNoWork: 'No work in progress.',
  statusWorkDefault: 'work',
  statusQuestions: (n: number) => `Questions waiting: ${n}.`,
  statusProjects: '<b>Projects</b>',
  statusNoLead: 'no squad lead',
  statusLeadDefault: 'working',
  statusLeadFree: (name: string) => `${name} is free`,
  statusToReport: (n: number) => ` (${n} to report)`,

  // --- pairing and incoming ---
  invalidCode: 'That code isn’t valid.',
  paired: (name: string, help: string) =>
    `Done, ${name}: you can now command the monsters from here.\n\n${help}`,
  forwarded: 'I don’t act on forwarded messages: write to me directly.',
  textOnly: 'For now I only understand text messages.',
  finishSetupHere: 'Finish Monsters’ first-time setup in the browser first, then we can talk here.',
  finishSetup: 'Finish Monsters’ first-time setup in the browser first.',
  answerSent: 'Answer sent.',
  addedToWork: (name: string) => `Added to ${name}’s current work.`,
  noMonsterNamed: 'There’s no monster with that name.',
  docsUseButtons:
    'For this proposal use the Apply or Leave it buttons; to change it, ask the monster.',
  draftUseButtons:
    'For this draft use the Confirm or Discard buttons; to change it, open it in the app (To review).',

  // --- answers to questions ---
  answerNotOpen: 'This question is no longer waiting for an answer.',
  answerNotFound: 'I can’t find this question.',
  answerNotValid: 'That answer doesn’t fit the question.',
  noAnswerNeeded: '■ No answer needed anymore.',
  answerPopup: 'Answer sent',
  cannot: 'I can’t do that',
  answered: (via: string, what: string) => `✅ Answer${via}: ${what}`,
  expiredByStop: '■ Expired: you stopped the monsters.',
  via: {
    telegram: 'from Telegram',
    ui: 'from the app',
    cli: 'from the terminal',
    ssh: 'from the terminal',
    api: 'from another program',
  } as Record<string, string>,

  // --- questions of the monsters ---
  asks: (who: string, question: string) => `❓ ${who} asks: ${question}`,
  asksHtml: (who: string, question: string) => `❓ <b>${who}</b> asks: ${question}`,
  recommended: ' (recommended)',
  chooseOrReply: 'Choose a button, or reply to this message with some text.',
  replyToAnswer: 'Reply to this message with your answer.',
  workGoesOn: 'Meanwhile the work goes on.',
  answerPlaceholder: 'Your answer',

  // --- end of work ---
  notesTouched: 'Notes touched:',
  workFailed: (who: string, error: string) => `⚠️ ${who}’s work failed: ${error}`,
  errorDefault: 'error',
  workStopped: (who: string) => `■ ${who}’s work was stopped.`,
  workDone: (who: string) => `✅ ${who} is done.`,
  signInAgain: (server: string) => `${server} is asking you to sign in again.`,
  raiseCap: (path: string) => `\nTo raise it: ${path}.`,
  capPath: (path: string, _project: boolean) => path,

  // --- drafts (proposals of the monsters) ---
  apply: '✅ Apply',
  confirm: '✅ Confirm',
  openInApp: 'Open in the app',
  leaveIt: 'Leave it',
  discard: 'Discard',
  openPopup: 'Open Monsters: you’ll find it in To review, with all the fields.',
  applyInApp: 'Apply it in the app: you’ll find it in To review, with the whole diff.',
  confirmInApp: 'Confirm it in the app: you’ll find it in To review, in full.',
  get folderOutsideAck(): string {
    return `Confirm it in the app: the folder is outside ${projectsDir()}.`;
  },
  doneApplied: 'Done: applied',
  doneConfirmed: 'Done: confirmed',
  leftIt: 'Left it',
  draftGone: '■ This draft no longer exists.',
  applied: (via: string) => `✅ Applied${via}`,
  confirmed: (via: string) => `✅ Confirmed${via}`,
  superseded: '■ Replaced by a new proposal',
  dismissed: (docs: boolean, via: string) => `■ ${docs ? 'Left alone' : 'Discarded'}${via}`,
  noteDocsHere:
    '<i>Apply writes the file exactly as in the proposal; the whole diff is in the app too (To review).</i>',
  noteDocsApp:
    '<i>It doesn’t come only from you and the diff isn’t fully visible here: read it and apply it in the app (To review).</i>',
  get noteFolderOutside(): string {
    return `<i>The folder is outside ${projectsDir()}: look at it and confirm it in the app (To review).</i>`;
  },
  noteMemory: '<i>Confirm adds them to its memory exactly as they are.</i>',
  noteConfirm:
    '<i>Confirm creates it exactly as it is; to change it, open it in the app (To review).</i>',
  noteTooLong:
    '<i>It’s too long for a message: read it in full and confirm it in the app (To review).</i>',
  sendAnyway: '📤 Send anyway',
  sentAnywayPopup: 'Sent',
  sentAnyway: '📤 Sent anyway.',

  // --- state shown in the settings ---
  crashed: 'Telegram stopped because of an error: restarting by itself.',
  slowDown: 'Telegram asks to slow down: I’ll try again as soon as it lets me.',
  tokenRefused: 'Telegram refused the token: paste a new one.',
  botBusy: 'Another program is using this bot (or it has a webhook): Monsters will try again.',
  notResponding: 'Telegram isn’t responding: trying again by myself.',

  // --- errors of the API ---
  botOfAMonster: (username: string) =>
    `@${username} is already a monster’s bot: create a new bot with BotFather for you.`,
  tokenFromEnv: (variable: string) =>
    `The token comes from the ${variable} variable: remove it from there and restart Monsters.`,
  connectBotFirst: 'Connect the bot with its token first.',
  accountNotConnected: 'This account isn’t one of the connected ones.',

  // --- token check (net.ts) ---
  tokenUnknown: 'Telegram doesn’t recognize this token.',
  telegramError: (code: number) => `Telegram answered with an error (${code}): try again shortly.`,
};

const it: typeof en = {
  commands: [
    { command: 'stop', description: 'Ferma subito tutti i mostri' },
    { command: 'riprendi', description: 'Fa ripartire i mostri' },
    { command: 'nuova', description: 'Nuova conversazione' },
    { command: 'stato', description: 'Cosa stanno facendo' },
    { command: 'aiuto', description: 'Come si usa' },
  ],
  help: [
    'Scrivimi e passo il messaggio alla squadra; con <code>@Nome</code> all’inizio parli con un mostro preciso.',
    '',
    '/stop: ferma subito tutti i mostri',
    '/riprendi: li fa ripartire',
    '/nuova: nuova conversazione (anche <code>/nuova @Nome</code>)',
    '/stato: cosa stanno facendo',
    '',
    'Alle domande rispondi con i pulsanti, oppure rispondendo al messaggio della domanda.',
  ].join('\n'),
  unknownCommand: (name, help) => `Non conosco /${name}.\n\n${help}`,
  stopReason: '/stop da Telegram',
  stopped: (runs, programs) =>
    `■ Fermato tutto. Lavori interrotti: ${runs}, programmi chiusi: ${programs}.\nNiente riparte finché non scrivi /riprendi.`,
  notHalted: 'I mostri non sono fermi.',
  resumeAsk: 'Faccio ripartire i mostri?',
  resumeYes: 'Sì, riprendi',
  resumeNo: 'No',
  resumeKeptStopped: 'Va bene: restano fermi.',
  resumed: '▶ Ripartiti: i mostri possono lavorare di nuovo.',
  haltedWrite: 'I mostri sono fermi. Scrivi /riprendi per farli ripartire.',
  newConversation: (withName) =>
    `Nuova conversazione${withName ? ` con ${withName}` : ''}: i messaggi di prima restano nel log, ma i mostri non li vedono più.`,

  statusHalted: '<b>Fermi</b> (kill switch): /riprendi per farli ripartire.',
  statusRunning: '<b>Attivi.</b>',
  statusNoWork: 'Nessun lavoro in corso.',
  statusWorkDefault: 'lavoro',
  statusQuestions: (n) => `Domande in attesa: ${n}.`,
  statusProjects: '<b>Progetti</b>',
  statusNoLead: 'senza capo',
  statusLeadDefault: 'al lavoro',
  statusLeadFree: (name) => `${name} è libero`,
  statusToReport: (n) => ` (${n} da riferire)`,

  invalidCode: 'Codice non valido.',
  paired: (name, help) => `Fatto, ${name}: ora puoi comandare i mostri da qui.\n\n${help}`,
  forwarded: 'Non eseguo i messaggi inoltrati: scrivimi direttamente.',
  textOnly: 'Per ora capisco solo i messaggi di testo.',
  finishSetupHere: 'Completa prima il primo avvio di Monsters nel browser: poi ci sentiamo qui.',
  finishSetup: 'Completa prima il primo avvio di Monsters nel browser.',
  answerSent: 'Risposta inviata.',
  addedToWork: (name) => `Aggiunto al lavoro in corso di ${name}.`,
  noMonsterNamed: 'Non c’è nessun mostro con questo nome.',
  docsUseButtons:
    'Per questa proposta usa i pulsanti Applica o Lascia stare; per cambiarla, chiedilo al mostro.',
  draftUseButtons:
    'Per questa bozza usa i pulsanti Conferma o Scarta; per cambiarla, aprila nell’app (Da rivedere).',

  answerNotOpen: 'Questa domanda non aspetta più una risposta.',
  answerNotFound: 'Non trovo questa domanda.',
  answerNotValid: 'Questa risposta non va bene per la domanda.',
  noAnswerNeeded: '■ Non serve più una risposta.',
  answerPopup: 'Risposta inviata',
  cannot: 'Non riesco',
  answered: (via, what) => `✅ Risposta${via}: ${what}`,
  expiredByStop: '■ Scaduta: hai fermato i mostri.',
  via: {
    telegram: 'da Telegram',
    ui: 'dall’interfaccia',
    cli: 'dal terminale',
    ssh: 'dal terminale',
    api: 'da un altro programma',
  },

  asks: (who, question) => `❓ ${who} chiede: ${question}`,
  asksHtml: (who, question) => `❓ <b>${who}</b> chiede: ${question}`,
  recommended: ' (consigliata)',
  chooseOrReply: 'Scegli un pulsante, oppure rispondi a questo messaggio con un testo.',
  replyToAnswer: 'Rispondi a questo messaggio con la tua risposta.',
  workGoesOn: 'Intanto il lavoro va avanti.',
  answerPlaceholder: 'La tua risposta',

  notesTouched: 'Note toccate:',
  workFailed: (who, error) => `⚠️ Il lavoro di ${who} non è andato a buon fine: ${error}`,
  errorDefault: 'errore',
  workStopped: (who) => `■ Il lavoro di ${who} si è fermato.`,
  workDone: (who) => `✅ ${who} ha finito.`,
  signInAgain: (server) => `${server} chiede di nuovo l’accesso.`,
  raiseCap: (path) => `\nPer alzarlo: ${path}.`,
  capPath: (path, project) => (project ? `la ${path}` : path),

  apply: '✅ Applica',
  confirm: '✅ Conferma',
  openInApp: 'Apri nell’app',
  leaveIt: 'Lascia stare',
  discard: 'Scarta',
  openPopup: 'Apri Monsters: la trovi in Da rivedere, con tutti i campi.',
  applyInApp: 'Applicala nell’app: la trovi in Da rivedere, con la differenza intera.',
  confirmInApp: 'Confermala nell’app: la trovi in Da rivedere, tutta intera.',
  get folderOutsideAck(): string {
    return `Confermala nell’app: la cartella è fuori da ${projectsDir()}.`;
  },
  doneApplied: 'Fatto: applicata',
  doneConfirmed: 'Fatto: confermata',
  leftIt: 'Lasciata stare',
  draftGone: '■ Questa bozza non c’è più.',
  applied: (via) => `✅ Applicata${via}`,
  confirmed: (via) => `✅ Confermata${via}`,
  superseded: '■ Sostituita da una proposta nuova',
  dismissed: (_docs, via) => `■ Lasciata stare${via}`,
  noteDocsHere:
    '<i>Applica scrive il file così com’è nella proposta; la differenza intera è anche nell’app (Da rivedere).</i>',
  noteDocsApp:
    '<i>Non viene solo da te e la differenza qui non si vede tutta: leggila e applicala nell’app (Da rivedere).</i>',
  get noteFolderOutside(): string {
    return `<i>La cartella è fuori da ${projectsDir()}: guardala e confermala nell’app (Da rivedere).</i>`;
  },
  noteMemory: '<i>Conferma le aggiunge alla sua memoria così come sono.</i>',
  noteConfirm: '<i>Conferma la crea così com’è; per cambiarla aprila nell’app (Da rivedere).</i>',
  noteTooLong:
    '<i>È troppo lunga per un messaggio: leggila tutta e confermala nell’app (Da rivedere).</i>',
  sendAnyway: '📤 Manda comunque',
  sentAnywayPopup: 'Mandata',
  sentAnyway: '📤 Mandata comunque.',

  crashed: 'Telegram si è fermato per un errore: riparto da solo.',
  slowDown: 'Telegram chiede di rallentare: riprovo appena me lo permette.',
  tokenRefused: 'Telegram ha rifiutato il token: incollane uno nuovo.',
  botBusy: 'Un altro programma sta usando questo bot (o ha un webhook): Monsters riprova.',
  notResponding: 'Telegram non risponde: riprovo da solo.',

  botOfAMonster: (username) =>
    `@${username} è già il bot di un mostro: crea un bot nuovo con BotFather per te.`,
  tokenFromEnv: (variable) =>
    `Il token arriva dalla variabile ${variable}: toglila da lì e riavvia Monsters.`,
  connectBotFirst: 'Collega prima il bot con il suo token.',
  accountNotConnected: 'Questo account non è tra quelli collegati.',

  tokenUnknown: 'Telegram non riconosce questo token.',
  telegramError: (code) => `Telegram ha risposto con un errore (${code}): riprova tra poco.`,
};

export const telegramStrings = () => pick({ en, it });

/**
 * Command names the bots understand whatever the app's language: the English ones, the Italian
 * ones (old messages and habits) and the old aliases. Lower case, as `#onCommand` receives them.
 */
export const COMMAND_ALIASES: Record<string, string> = {
  stop: 'stop',
  ferma: 'stop',
  resume: 'resume',
  riprendi: 'resume',
  new: 'new',
  nuova: 'new',
  status: 'status',
  stato: 'status',
  help: 'help',
  aiuto: 'help',
  start: 'help',
  join: 'join',
};
