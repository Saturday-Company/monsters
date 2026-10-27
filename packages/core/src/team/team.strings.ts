import { formatList, formatNumber, pick, type Lang } from '@monsters/shared';

/** A dollar amount in the language in use, as the instinct writes costs ("0.5" / "0,5"). */
const usdText = (usd: number, lang?: 'en' | 'it') =>
  formatNumber(usd, { maximumFractionDigits: 4 }, lang);

/*
 * What the team layer says to the person (D-153): the line under a monster while it works,
 * the errors written in Activity (memory, summaries, resuming a job), the refusals of the
 * dispatcher, the "To review" cards of the memory. What the monsters read is not here.
 */

const en = {
  // --- the speech bubble (one line per tool call)
  webSearch: (query: string) => `searches the web: ${query}`,
  reads: (what: string) => `reads ${what}`,
  searchNotes: (query: string) => `searches the notes: ${query}`,
  aNote: 'a note',
  writes: (what: string) => `writes ${what}`,
  edits: (what: string) => `edits ${what}`,
  looksAtNotes: 'looks at the notes',
  delegatesTo: (who: string) => `delegates to ${who}`,
  asksTeammate: (who: string) => `asks ${who}`,
  anAgent: 'an agent',
  runs: (command: string) => `runs: ${command}`,
  aCommand: 'a command',
  aFile: 'a file',
  looksAt: (what: string) => `looks at ${what}`,
  theFolders: 'the folders',
  moves: (what: string) => `moves ${what}`,
  trashes: (what: string) => `moves ${what} to the trash`,
  asks: (question: string) => `asks: ${question}`,
  createsPage: (title: string) => `creates a page: ${title}`,
  proposesMonster: (name: string) => `proposes a new monster: ${name}`,
  showsYou: (what: string) => `shows you ${what}`,
  somethingToShow: 'something',
  opensInBrowser: (url: string) => `opens ${url} in the browser`,
  uses: (server: string, name: string) => `uses ${server}: ${name}`,
  // --- activity
  atWork: 'at work',
  waitingAnswer: (question: string) => `waiting for an answer: ${question}`,
  backToWork: 'back to work',
  // --- errors in Activity
  agentNotUpdated: (name: string, message: string) => `${name}: AGENTS.md not updated (${message})`,
  retiredModelReplaced: (name: string, from: string, to: string) =>
    `${name}: ${from} is no longer available, ${to} takes its place`,
  retiredModelNotSaved: (name: string, from: string, to: string, message: string) =>
    `${name}: ${from} is no longer available; ${to} is used for now, but its settings could not be saved (${message})`,
  memoryUnreadable: (name: string, message: string) => `${name}’s memory can’t be read: ${message}`,
  memoryNotCreated: (name: string, message: string) =>
    `${name}’s memory wasn’t created: ${message}`,
  memoryNotUpdated: (name: string, message: string) =>
    `${name}’s memory wasn’t updated: ${message}`,
  questionsError: (message: string) => `questions of the job: ${message}`,
  // --- the dispatcher
  noModelHint: (name: string) =>
    `${name} has no model yet: connect one in Settings → Models, or pick another monster.`,
  noModel: (name: string) => `${name} has no model yet.`,
  agentBusy: (name: string) => `${name} is working`,
  /** The reason of "Stop" in one monster's chat (F-1): in the log, and on the giri it skips. */
  stoppedAgent: (name: string) => `You stopped ${name}`,
  busyNewConversation: (names: readonly string[]) =>
    `${formatList(names)} ${names.length === 1 ? 'is' : 'are'} still working: wait for ${names.length === 1 ? 'it' : 'them'} to finish or stop ${names.length === 1 ? 'it' : 'them'}, then start a new conversation.`,
  // --- resuming a job
  resumeMessageFailed: (message: string) => `I couldn’t resume a waiting message: ${message}`,
  senderGone: (from: string) => `whoever sent the job (${from}) is gone`,
  resumeWorkFailed: (message: string) => `I couldn’t resume the stopped job: ${message}`,
  // --- summaries of long conversations
  summaryEmpty: 'empty summary',
  summaryShrunk: 'summary much shorter than the previous one',
  summaryTimeout: (s: number) => `more than ${s} s`,
  compactionFailed: (name: string, why: string, shown: number) =>
    `I couldn’t sum up ${name}’s older messages (${why}): at the next message it sees the last ${shown}`,
  claudeUnavailable: 'Claude Code is not available',
  codexNoSummary: 'summaries are not made on Codex',
  spendCapReached: 'spending cap reached',
  noSummaryModel: 'no model for the summary',
  summaryCut: 'summary cut by the answer limit',
  // --- memory
  memoryExpired: (name: string, lines: string, max: number) =>
    `The oldest draft of ${name}’s memory expired unanswered (${lines}): ${name} already had ${max} to review. The lines are below, if you need them.`,
  oneLine: 'one line',
  nLines: (n: number) => `${n} lines`,
  memoryTitle: (name: string) => `${name}’s memory`,
  memorySummary: (name: string, n: number, source: string) =>
    `${name} wants to remember ${n === 1 ? 'one thing' : `${n} things`} (${source}).`,
  notFromYou: 'not from you',
  proposalUnknown: 'This proposal doesn’t exist.',
  proposalClosed: 'These lines were already added to the memory or set aside.',
  memoryNotSaved: 'I couldn’t write the memory: try again in a moment.',
  memorySkipped: (name: string, n: number) =>
    `I didn’t add to ${name}’s memory ${n === 1 ? 'a line that only mattered for this job' : `${n} lines that only mattered for this job`}.`,
  // --- the limits of a task
  // `plan`: the cap of the requests served by a subscription (Claude Code, Codex), apart from the API's.
  runSteps: (n: number, plan = false) =>
    `this job used all its ${n} model steps${plan ? ' on the plan' : ''}`,
  runTokens: (n: number, plan = false) =>
    `this job used all its ${n} tokens${plan ? ' on the plan' : ''}`,
  runCost: (usd: number) => `this job spent its ${usdText(usd)} $ limit`,
  runTreeCost: (usd: number) =>
    `this job spent its ${usdText(usd)} $ limit (with the work sent to projects)`,
  // --- names used when nobody gave one
  userName: 'User',
  ownerName: 'the user',
  monsterName: 'Monster',
  // --- other
  noSuchMonster: (id: string) => `There’s no monster “${id}” in the squad.`,
  openrouterUnreachable: (message: string) => `OpenRouter can’t be reached: ${message}`,
  invalidKey: 'invalid key',
  openrouterAnswered: (status: number) => `OpenRouter answered ${status}`,
};

const it: typeof en = {
  webSearch: (query) => `cerca sul web: ${query}`,
  reads: (what) => `legge ${what}`,
  searchNotes: (query) => `cerca nelle note: ${query}`,
  aNote: 'una nota',
  writes: (what) => `scrive ${what}`,
  edits: (what) => `modifica ${what}`,
  looksAtNotes: 'guarda le note',
  delegatesTo: (who) => `delega a ${who}`,
  asksTeammate: (who) => `chiede a ${who}`,
  anAgent: 'un agente',
  runs: (command) => `esegue: ${command}`,
  aCommand: 'un comando',
  aFile: 'un file',
  looksAt: (what) => `guarda ${what}`,
  theFolders: 'le cartelle',
  moves: (what) => `sposta ${what}`,
  trashes: (what) => `butta nel cestino ${what}`,
  asks: (question) => `chiede: ${question}`,
  createsPage: (title) => `crea una pagina: ${title}`,
  proposesMonster: (name) => `propone un nuovo mostro: ${name}`,
  showsYou: (what) => `ti mostra ${what}`,
  somethingToShow: 'qualcosa',
  opensInBrowser: (url) => `apre nel browser ${url}`,
  uses: (server, name) => `usa ${server}: ${name}`,
  atWork: 'al lavoro',
  waitingAnswer: (question) => `aspetta una risposta: ${question}`,
  backToWork: 'riprende il lavoro',
  agentNotUpdated: (name, message) => `${name}: AGENTS.md non aggiornato (${message})`,
  retiredModelReplaced: (name, from, to) =>
    `${name}: ${from} non è più disponibile, al suo posto c’è ${to}`,
  retiredModelNotSaved: (name, from, to, message) =>
    `${name}: ${from} non è più disponibile; per ora si usa ${to}, ma le sue impostazioni non si sono potute salvare (${message})`,
  memoryUnreadable: (name, message) => `memoria di ${name} non leggibile: ${message}`,
  memoryNotCreated: (name, message) => `memoria di ${name} non creata: ${message}`,
  memoryNotUpdated: (name, message) => `memoria di ${name} non aggiornata: ${message}`,
  questionsError: (message) => `domande del lavoro: ${message}`,
  noModelHint: (name) =>
    `${name} non ha ancora un modello: collegane uno in Impostazioni → Modelli, o scegline un altro.`,
  noModel: (name) => `${name} non ha ancora un modello.`,
  agentBusy: (name) => `${name} sta lavorando`,
  stoppedAgent: (name) => `Hai fermato ${name}`,
  busyNewConversation: (names) =>
    `${formatList(names)} ${names.length === 1 ? 'sta' : 'stanno'} ancora lavorando: aspetta che finisca o fermalo, poi inizia una nuova conversazione.`,
  resumeMessageFailed: (message) => `Non ho potuto riprendere un messaggio in attesa: ${message}`,
  senderGone: (from) => `chi aveva mandato il lavoro (${from}) non c’è più`,
  resumeWorkFailed: (message) => `Non ho potuto riprendere il lavoro fermato: ${message}`,
  summaryEmpty: 'riassunto vuoto',
  summaryShrunk: 'riassunto molto più corto del precedente',
  summaryTimeout: (s) => `più di ${s} s`,
  compactionFailed: (name, why, shown) =>
    `Non sono riuscito a riassumere i messaggi più vecchi di ${name} (${why}): al prossimo messaggio vede gli ultimi ${shown}`,
  claudeUnavailable: 'Claude Code non disponibile',
  codexNoSummary: 'su Codex il riassunto non si fa',
  spendCapReached: 'tetto di spesa raggiunto',
  noSummaryModel: 'nessun modello per il riassunto',
  summaryCut: 'riassunto troncato dal limite di risposta',
  memoryExpired: (name, lines, max) =>
    `La bozza più vecchia della memoria di ${name} è scaduta senza risposta (${lines}): ${name} ne aveva già ${max} da rivedere. Le righe sono qui sotto, se ti servono.`,
  oneLine: 'una riga',
  nLines: (n) => `${n} righe`,
  memoryTitle: (name) => `Memoria di ${name}`,
  memorySummary: (name, n, source) =>
    `${name} vuole ricordare ${n === 1 ? 'una cosa' : `${n} cose`} (${source}).`,
  notFromYou: 'non da te',
  proposalUnknown: 'Questa proposta non c’è.',
  proposalClosed: 'Queste righe sono già state aggiunte alla memoria o lasciate stare.',
  memoryNotSaved: 'Non sono riuscito a scrivere la memoria: riprova tra poco.',
  memorySkipped: (name, n) =>
    `Non ho aggiunto alla memoria di ${name} ${n === 1 ? 'una riga che serviva solo a questo lavoro' : `${n} righe che servivano solo a questo lavoro`}.`,
  runSteps: (n, plan = false) =>
    `questo lavoro ha usato tutti i suoi ${n} passi del modello${plan ? ' sul piano' : ''}`,
  runTokens: (n, plan = false) =>
    `questo lavoro ha usato tutti i suoi ${n} token${plan ? ' sul piano' : ''}`,
  runCost: (usd) => `questo lavoro ha speso il suo limite di ${usdText(usd, 'it')} $`,
  runTreeCost: (usd) =>
    `questo lavoro ha speso il suo limite di ${usdText(usd, 'it')} $ (con il lavoro mandato ai progetti)`,
  userName: 'Utente',
  ownerName: 'l’utente',
  monsterName: 'Mostro',
  noSuchMonster: (id) => `Non c’è nessun mostro “${id}” nella squadra.`,
  openrouterUnreachable: (message) => `OpenRouter non raggiungibile: ${message}`,
  invalidKey: 'chiave non valida',
  openrouterAnswered: (status) => `OpenRouter ha risposto ${status}`,
};

export const teamStrings = (lang?: Lang) => pick({ en, it }, lang);
