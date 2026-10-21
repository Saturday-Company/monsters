import { pick } from '@monsters/shared';

/*
 * What the instinct says to the person (D-153): the card of the brake and what it means,
 * the lines of Activity, the words of the receipt, the reasons of the checks. The actions
 * are bare verbs ("run “git push”") so they fit "wants to …", "can …", "didn’t …".
 * What the monsters read (reminders, the gate's prompts) is not here.
 */

const en = {
  // --- the card of the brake
  categoryWords: {
    publish: 'publish',
    contact: 'write to third parties',
    spend: 'spend money',
    delete: 'delete for good',
  },
  brakeCard: (agent: string, what: string, asker?: string) =>
    `${agent} wants to ${what}${asker ? ` (${asker})` : ''}. Proceed?`,
  withMeaning: (summary: string, words: string) => `${summary}, meaning ${words}`,
  yesLabel: 'Yes, go ahead',
  yesDescription: 'Only this action',
  noLabel: 'No, don’t do it',
  noDescription: 'The monster goes on without it',
  programEffect: 'do something with another app (it changes something outside Monsters)',
  programRead:
    'read or use your data in another app (mail, documents, calendars): what it finds may end up in the reply to the chat',
  projectWriteMeaning:
    'change files in a project folder after reading third-party text (a project file can start commands at your next test or commit)',
  projectWrite: (target: string) => `write “${target}”`,
  unseen: {
    automation: 'it was an automation: the user wasn’t following it',
    others: 'other people were writing in the Telegram chat',
    closed: 'the app was closed and Telegram isn’t connected',
  },
  // --- the lines of Activity
  hold: (agent: string, summary: string) =>
    `${agent} wants to ${summary}: waiting for your answer.`,
  approved: (agent: string, summary: string) => `You said yes: ${agent} can ${summary}.`,
  noAnswer: (unseen: string | undefined, agent: string, summary: string) =>
    `No answer${unseen ? ` (${unseen})` : ''}: ${agent} didn’t ${summary}.`,
  notYes: (agent: string, summary: string) =>
    `Not a yes: ${agent} won’t ${summary} and reads your reply.`,
  declined: (agent: string, summary: string) => `You said no: ${agent} won’t ${summary}.`,
  marked: (agent: string, summary: string, why: string) =>
    `${agent} was able to ${summary} (${why}).`,
  whyUnchecked: 'not checked',
  whyToCheck: 'to check',
  whyDoubt: 'in doubt: marked',
  whyRules: 'your rules allow it',
  injectionRemoved: (source: string) =>
    `I removed a text from ${source} that gave orders to the monsters.`,
  // --- what an action is (outbound rules)
  longCommand: (cmd: string) => `run a very long command (“${cmd}”)`,
  runCommand: (cmd: string) => `run “${cmd}”`,
  press: (element: string) => `press “${element}” in the browser`,
  pressUnknown: 'press an element in the browser that I can’t name',
  submitForm: (element: string) =>
    `submit a form in the browser${element ? ` (“${element}”)` : ''}`,
  uploadFile: 'upload a file in the browser',
  fillForm: 'fill in a form in the browser',
  browserCode: 'run code in the browser that sends data out',
  useTool: (tool: string, server: string) => `use “${tool}” on ${server}`,
  otherProgram: 'another app',
  openFrom: { plain: 'open', terminal: 'open from the terminal', browser: 'open in the browser' },
  openWith: (tool: string, server: string) => `open with “${tool}” on ${server}`,
  searchWeb: 'search the web',
  addressPrivate: (verb: string, shown: string) =>
    `${verb} an address that contains private data (${shown})`,
  addressBig: (verb: string, shown: string) => `${verb} an address with a lot of data (${shown})`,
  searchKey: (shown: string) =>
    `search the web for a text that contains one of your keys (${shown})`,
  sendKey: (server: string, verb: string, shown: string) =>
    `send ${server} a text that contains one of your keys (${verb}: ${shown})`,
  leakPrivate: (dest: string, how: string) =>
    `send a piece of one of your private notes to ${dest} (${how})`,
  leakNotes: (dest: string, how: string) => `send pieces of your notes to ${dest} (${how})`,
  leakWords: (dest: string, how: string) => `send a few words of your notes to ${dest} (${how})`,
  leakDestSearch: 'a search engine',
  leakMark: 'site never seen in this job',
  runCode: (tool: string, server: string, what: string | undefined) =>
    `run code with “${tool}” on ${server}${what ? ` that ${what}` : ''}`,
  codeWhat: {
    sends: 'sends data out of the computer',
    deletes: 'deletes files',
    starts: 'starts other programs',
    hides: 'hides what it does',
    writes: 'writes files',
  },
  startsMeaning: 'start other programs from code: they can do anything the terminal can',
  writeFile: (tool: string, server: string, path: string | undefined) =>
    path
      ? `write the file ${path} with “${tool}” on ${server}`
      : `write a file with “${tool}” on ${server}`,
  writeFileMeaning:
    'write a file outside the folders you gave it (it can replace one that’s already there)',
  destructiveMeaning: (server: string) =>
    `do something ${server} marks as destructive (it removes or overwrites data)`,
  revokeMeaning: 'revoke (a revoked key or permission doesn’t come back)',
  cancelMeaning: 'cancel (usually there’s no going back, and whoever was waiting sees it)',
  paidMeaning: 'mark a payment as paid (money)',
  archiveMeaning: 'archive (it disappears from the lists; usually it can be restored)',
  giveAccessMeaning: 'give another person access (write to third parties)',
  takeAccessMeaning: 'take away another person’s access',
  changePersonMeaning: 'change what another person can do (publish)',
  changeVisibilityMeaning: 'change who can see or edit (publish)',
  mergeMeaning: 'merge the changes where others see them (publish)',
  aFile: 'a file',
  aPage: 'page',
  afterOutside: 'after reading outside content',
  pageKey: (name: string, after: string) =>
    `create a page (“${name}”) that contains one of your keys, ${after}`,
  pagePrivate: (name: string, after: string) =>
    `put a piece of one of your private notes in a page (“${name}”), ${after}`,
  pageNotes: (name: string, many: boolean) =>
    `put ${many ? 'pieces of your notes' : 'a few words of your notes'} in a page (“${name}”)`,
  pageMark: (after: string) => `page created ${after}: it opens without scripts`,
  // --- the receipt
  refusal: {
    not_in_run: 'it wasn’t among the tools of the job, you didn’t deny it',
    monsters_rule: 'a fixed Monsters rule, not a permission of yours',
  },
  cause: {
    user_declined: 'you said no',
    user_no_answer: 'no answer in time',
    setting_off: 'a setting is off',
    not_linked: 'the service needs to be reconnected',
    site_refused: 'the site refused, not a permission of yours',
    limit: 'a limit of the job',
  },
  // --- the checks
  stuckNotice: (agent: string) => `${agent} seems stuck: it keeps repeating the same steps.`,
  stuckNudge: (agent: string) => `${agent} was going in circles: I asked it to change course.`,
  stuckDemote: (agent: string) => `${agent} was still going in circles: I’m trying the next model.`,
  stuckByModel: 'the model sees it going in circles',
  stuckRepeats: (call: string) => `repeats ${call}`,
  stuckAlternates: (a: string, b: string) => `alternates ${a} and ${b}`,
  routeLead: 'I suggested your lead answer on its own.',
  routeTeam: 'I suggested a squad job to your lead.',
  routeMember: (name: string) => `I suggested handing the request to ${name}.`,
  retried: (agent: string) => `${agent}’s work wasn’t finished: I asked it to complete it.`,
  inDoubt: (agent: string, doubt: string) => `${agent}’s work is in doubt: ${doubt}`.trim(),
  notesSaved: 'Notes saved',
  claimsNotes: 'the report says a note was saved, but the notes log has none',
  perWeek: (noun: string, weeks: number) =>
    `needs one ${noun} for each of the 4 weeks, the report lists ${weeks}`,
  belowCount: (n: number, noun: string, said: number) =>
    `needs ${n} ${noun}, the report declares ${said}`,
  notShown: (text: string) => `not shown: “${text}”`,
  notClear: 'not clear from the report and the notes',
  doubt: 'The check isn’t sure the work is complete',
  quote: (text: string) => `“${text}”`,
  chainReordered: (agent: string, first: string, why: string) =>
    `For ${agent} I now use ${first} first: ${why}.`,
  chainWhy: (model: string, verified: number, checked: number, cost: string | null) =>
    `${model} finished ${verified} checked jobs out of ${checked}${cost ? ` (${cost} $ per job)` : ''}`,
  instinctDown: (use: string, engine: string, code: string, detail: string) =>
    `Instinct (${use}, ${engine}) didn’t answer (${code}): going on without it. ${detail}`,
  finalQuestion: 'The reply ended with a question for you: I asked to send it to you as a card.',
  // --- small labels
  /** The app's place where the instinct's lines are written (quoted to the monsters too). */
  activity: 'Activity',
  shortcutTrial: (member: string) =>
    `On trial: I would have passed the request straight to ${member}.`,
  otherMonsterWork: 'another monster’s work',
  noteAfterThirdParty: (path: string) =>
    path ? `note ${path} written after third-party text` : 'a note written after third-party text',
  statePreviewCut: (chars: number) => `…[${chars} characters]`,
  reasonInstinct: (version: string) => `instinct ${version}`,
};

const it: typeof en = {
  categoryWords: {
    publish: 'pubblicare',
    contact: 'scrivere a terzi',
    spend: 'spendere',
    delete: 'cancellare per sempre',
  },
  brakeCard: (agent, what, asker) =>
    `${agent} vuole ${what}${asker ? ` (${asker})` : ''}. Procedo?`,
  withMeaning: (summary, words) => `${summary}, cioè ${words}`,
  yesLabel: 'Sì, procedi',
  yesDescription: 'Solo questa azione',
  noLabel: 'No, non farlo',
  noDescription: 'Il mostro va avanti senza',
  programEffect: 'fare un’azione con un altro programma (cambia qualcosa fuori da Monsters)',
  programRead:
    'leggere o usare i tuoi dati in un altro programma (posta, documenti, calendari): quello che trova può finire nella risposta alla chat',
  projectWriteMeaning:
    'cambiare file nella cartella di un progetto dopo aver letto testo di terzi (un file del progetto può far partire comandi al tuo prossimo test o commit)',
  projectWrite: (target) => `scrivere «${target}»`,
  unseen: {
    automation: 'era un’automazione: l’utente non la stava seguendo',
    others: 'nella chat di Telegram scrivevano altre persone',
    closed: 'l’app era chiusa e Telegram non è collegato',
  },
  hold: (agent, summary) => `${agent} vuole ${summary}: aspetta la tua risposta.`,
  approved: (agent, summary) => `Hai detto sì: ${agent} può ${summary}.`,
  noAnswer: (unseen, agent, summary) =>
    `Nessuna risposta${unseen ? ` (${unseen})` : ''}: ${agent} non ha fatto ${summary}.`,
  notYes: (agent, summary) => `Non era un sì: ${agent} non fa ${summary} e legge la tua risposta.`,
  declined: (agent, summary) => `Hai detto no: ${agent} non farà ${summary}.`,
  marked: (agent, summary, why) => `${agent} ha potuto ${summary} (${why}).`,
  whyUnchecked: 'non controllata',
  whyToCheck: 'da controllare',
  whyDoubt: 'in dubbio: segnata',
  whyRules: 'le tue regole lo permettono',
  injectionRemoved: (source) => `Ho tolto da ${source} un testo che dava ordini ai mostri.`,
  longCommand: (cmd) => `eseguire un comando molto lungo («${cmd}»)`,
  runCommand: (cmd) => `eseguire «${cmd}»`,
  press: (element) => `premere «${element}» nel browser`,
  pressUnknown: 'premere nel browser un elemento che non so nominare',
  submitForm: (element) => `inviare un modulo nel browser${element ? ` («${element}»)` : ''}`,
  uploadFile: 'caricare un file nel browser',
  fillForm: 'compilare un modulo nel browser',
  browserCode: 'eseguire nel browser del codice che manda dati fuori',
  useTool: (tool, server) => `usare «${tool}» di ${server}`,
  otherProgram: 'un altro programma',
  openFrom: {
    plain: 'aprire',
    terminal: 'aprire dal terminale',
    browser: 'aprire nel browser',
  },
  openWith: (tool, server) => `aprire con «${tool}» di ${server}`,
  searchWeb: 'cercare sul web',
  addressPrivate: (verb, shown) => `${verb} un indirizzo che contiene dati privati (${shown})`,
  addressBig: (verb, shown) => `${verb} un indirizzo con molti dati (${shown})`,
  searchKey: (shown) => `cercare sul web un testo che contiene una delle tue chiavi (${shown})`,
  sendKey: (server, verb, shown) =>
    `mandare a ${server} un testo che contiene una delle tue chiavi (${verb}: ${shown})`,
  leakPrivate: (dest, how) => `mandare a ${dest} un pezzo di una tua nota privata (${how})`,
  leakNotes: (dest, how) => `mandare a ${dest} pezzi delle tue note (${how})`,
  leakWords: (dest, how) => `mandare a ${dest} qualche parola delle tue note (${how})`,
  leakDestSearch: 'un motore di ricerca',
  leakMark: 'sito mai visto in questo lavoro',
  runCode: (tool, server, what) =>
    `eseguire con «${tool}» di ${server} del codice${what ? ` che ${what}` : ''}`,
  codeWhat: {
    sends: 'manda dati fuori dal computer',
    deletes: 'cancella file',
    starts: 'avvia altri programmi',
    hides: 'nasconde cosa fa',
    writes: 'scrive file',
  },
  startsMeaning:
    'avviare altri programmi dal codice: possono fare tutto quello che fa il terminale',
  writeFile: (tool, server, path) =>
    path
      ? `scrivere con «${tool}» di ${server} il file ${path}`
      : `scrivere con «${tool}» di ${server} un file`,
  writeFileMeaning:
    'scrivere un file fuori dalle cartelle che gli hai dato (può sostituirne uno che c’è già)',
  destructiveMeaning: (server) =>
    `fare un’azione che ${server} segna come distruttiva (toglie o sovrascrive dati)`,
  revokeMeaning: 'revocare (una chiave o un permesso revocato non torna)',
  cancelMeaning: 'annullare (di solito non si torna indietro, e chi aspettava lo vede)',
  paidMeaning: 'segnare un pagamento come pagato (soldi)',
  archiveMeaning: 'archiviare (sparisce dagli elenchi; di solito si può riprendere)',
  giveAccessMeaning: 'dare accesso a un’altra persona (scrivere a terzi)',
  takeAccessMeaning: 'togliere l’accesso a un’altra persona',
  changePersonMeaning: 'cambiare cosa può fare un’altra persona (pubblicare)',
  changeVisibilityMeaning: 'cambiare chi può vedere o modificare (pubblicare)',
  mergeMeaning: 'unire le modifiche dove le vedono gli altri (pubblicare)',
  aFile: 'un file',
  aPage: 'pagina',
  afterOutside: 'dopo aver letto contenuti esterni',
  pageKey: (name, after) =>
    `creare una pagina («${name}») che contiene una delle tue chiavi, ${after}`,
  pagePrivate: (name, after) =>
    `mettere un pezzo di una tua nota privata in una pagina («${name}»), ${after}`,
  pageNotes: (name, many) =>
    `mettere ${many ? 'pezzi delle tue note' : 'qualche parola delle tue note'} in una pagina («${name}»)`,
  pageMark: (after) => `pagina creata ${after}: si apre senza script`,
  refusal: {
    not_in_run: 'non era tra gli strumenti del lavoro, non l’hai negato tu',
    monsters_rule: 'regola fissa di Monsters, non un tuo permesso',
  },
  cause: {
    user_declined: 'hai detto no',
    user_no_answer: 'nessuna risposta in tempo',
    setting_off: 'un’impostazione è spenta',
    not_linked: 'il servizio va ricollegato',
    site_refused: 'il sito ha rifiutato, non un tuo permesso',
    limit: 'un limite del lavoro',
  },
  stuckNotice: (agent) => `${agent} sembra bloccata: sta ripetendo i passi.`,
  stuckNudge: (agent) => `${agent} girava a vuoto: le ho chiesto di cambiare strada.`,
  stuckDemote: (agent) => `${agent} girava ancora a vuoto: provo con il modello successivo.`,
  stuckByModel: 'il modello lo vede girare a vuoto',
  stuckRepeats: (call) => `ripete ${call}`,
  stuckAlternates: (a, b) => `alterna ${a} e ${b}`,
  routeLead: 'Ho suggerito al tuo capo di rispondere da solo.',
  routeTeam: 'Ho suggerito al tuo capo un lavoro di squadra.',
  routeMember: (name) => `Ho suggerito di affidare la richiesta a ${name}.`,
  retried: (agent) => `Il lavoro di ${agent} non era finito: gli ho chiesto di completarlo.`,
  inDoubt: (agent, doubt) => `Il lavoro di ${agent} è in dubbio: ${doubt}`.trim(),
  notesSaved: 'Note salvate',
  claimsNotes: 'il rapporto dice di aver salvato una nota, ma il registro del vault non ne ha',
  perWeek: (noun, weeks) =>
    `serve un ${noun} per ognuna delle 4 settimane, il rapporto ne elenca ${weeks}`,
  belowCount: (n, noun, said) => `servono ${n} ${noun}, il rapporto ne dichiara ${said}`,
  notShown: (text) => `non risulta: «${text}»`,
  notClear: 'non è chiaro dal rapporto e dalle note',
  doubt: 'Il controllo non è sicuro che il lavoro sia completo',
  quote: (text) => `«${text}»`,
  chainReordered: (agent, first, why) => `Per ${agent} ora uso per primo ${first}: ${why}.`,
  chainWhy: (model, verified, checked, cost) =>
    `${model} ha finito ${verified} lavori controllati su ${checked}${cost ? ` (${cost} $ a lavoro)` : ''}`,
  instinctDown: (use, engine, code, detail) =>
    `Istinto (${use}, ${engine}) senza risposta (${code}): si va avanti senza. ${detail}`,
  finalQuestion: 'La risposta finiva con una domanda per te: ho chiesto di mandartela come scheda.',
  activity: 'Attività',
  shortcutTrial: (member) => `In prova: avrei passato la richiesta direttamente a ${member}.`,
  otherMonsterWork: 'lavoro di un altro mostro',
  noteAfterThirdParty: (path) => `nota ${path || 'del vault'} scritta dopo testo di terzi`,
  statePreviewCut: (chars) => `…[${chars} caratteri]`,
  reasonInstinct: (version) => `istinto ${version}`,
};

export const instinctStrings = () => pick({ en, it });
