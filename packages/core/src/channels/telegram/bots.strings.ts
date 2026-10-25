import { pick } from '@monsters/shared';

/*
 * What the bots dedicated to one monster say, and the errors of their API (D-153): English
 * first, Italian as a choice. Picked when written. The texts with HTML receive escaped values.
 * What the main bot says is in `telegram.strings.ts` (some texts are shared).
 *
 * A `why` (why a reply or a question does not go to a chat) is a verb phrase of the third
 * person, without a subject: "repeats a private note" / "ripete una nota privata".
 */

const en = {
  // --- commands (registered with `setMyCommands`; the bot also understands the Italian names) ---
  commands: [
    { command: 'status', description: 'What I’m doing' },
    { command: 'join', description: 'Ask to be able to talk to me' },
    { command: 'help', description: 'How to use me' },
  ],
  help: (agent: string, at: string) =>
    [
      `I’m ${agent}. In a group I answer when you mention me (<code>${at}</code>), when you reply to one of my messages, or with a command; in private, to every message.`,
      '',
      '/status: what I’m doing',
      '/join: ask to be able to talk to me',
      '/help: this message',
    ].join('\n'),

  // --- state shown in the settings ---
  crashed: 'The bot stopped because of an error: restarting by itself.',
  tokenRefused: 'Telegram refused the bot code: remove the bot and add it again with a new code.',
  tokenInUse:
    'Another app is using this bot code (or it has a webhook): stop it, or create a new bot with BotFather. Monsters will try again.',
  tokenOfAnotherBot: 'This bot code belongs to another bot: remove it and add it again.',
  tokenMissing: 'This bot’s code is missing: remove it and add it again.',

  // --- notices to the user ---
  fullNote: (max: number) =>
    ` That’s a lot: I’m keeping ${max} waiting, and the oldest make room for the new ones.`,
  noName: 'unnamed',
  someone: 'Someone',
  botLeftGroup: (at: string, agent: string, name: string) =>
    `${agent}’s bot ${at} is no longer in the group “${name}”: replies there won’t go out anymore.`,
  botBlocked: (name: string, at: string, agent: string) =>
    `${name} blocked ${agent}’s bot ${at}: replies to that account won’t go out.`,
  botInGroup: (at: string, agent: string, title: string, full: string, place: string) =>
    `${agent}’s bot ${at} is in the group “${title}”. If that’s fine, approve it in Monsters: ${place}.${full}`,
  personAsks: (name: string, agent: string, at: string, full: string, place: string) =>
    `${name} would like to talk to ${agent} on ${at}. If that’s fine, approve it in Monsters: ${place}.${full}`,
  tooManyRequests: (n: number, place: string) =>
    `Too many requests on a dedicated bot in a short time: I won’t notify you about them for a while. You’ll find the latest ${n} from groups and people in Monsters: ${place}; the oldest make room for the new ones.`,
  raiseCap: (name: string, agent: string, at: string, stop: string, path: string) =>
    `⛔ ${name} wrote to ${agent} on ${at}, but it can’t work right now: ${stop}. To raise it: ${path}.`,

  // --- in the chat ---
  group: 'Group',
  goAhead: 'Go ahead.',
  alreadyAllowed: 'You can already write to me.',
  askedOwner: (owner: string) => `I’ve asked ${owner} to approve you.`,
  notReady: 'Monsters isn’t ready yet: try again later.',
  halted: (owner: string) => `The monsters are stopped: ${owner} can start them again.`,
  writingALot: 'You’re writing a lot: try again in a little while.',
  dayLimit: 'I’ve run out of messages I can receive today: try again tomorrow.',
  needsOk: (owner: string) => `${owner}’s OK is needed: I’ve asked them.`,
  finishingOther: 'I’m finishing another job: I’ll answer as soon as I can.',
  failed: (error: string) => `⚠️ I couldn’t do it: ${error}`,
  stoppedBy: (owner: string) => `■ I stopped: ${owner} stopped the monsters.`,
  stopped: '■ I stopped.',
  chooseButton: 'Choose a button, or reply to this message.',
  replyHere: 'Reply to this message.',
  invalidButton: 'This button isn’t valid.',
  ownerOnly: (owner: string) => `Only ${owner} decides this one.`,
  askerOnly: (owner: string) => `Whoever made the request can answer, or ${owner}.`,
  statusHalted: (who: string) => `<b>${who} is stopped</b>: the monsters have been stopped.`,
  statusWorking: (who: string, activity: string | null) =>
    `<b>${who} is working</b>${activity ? `: ${activity}` : ''}`,
  statusWaiting: (who: string) => `<b>${who} is waiting for an answer</b>`,
  statusFree: (who: string) => `<b>${who} is free.</b>`,
  statusToday: (n: number, limit: number) => `Messages today: ${n} of ${limit}.`,

  // --- a reply or a question held back (D-114) ---
  inGroup: (title: string) => `in the group “${title}”`,
  toPerson: (name: string) => `to ${name}`,
  inThatChat: 'in that chat',
  somePerson: 'someone',
  heldInChat: (why: string, owner: string) =>
    `I’m not sending this reply here: it ${why}. ${owner} decides.`,
  heldLog: (who: string, where: string, at: string, why: string) =>
    `${who} wanted to reply ${where} on ${at}, but it ${why}: the reply wasn’t sent.`,
  heldSummary: (where: string) => `reply ${where}`,
  heldTellCanSend: (who: string, where: string, at: string, why: string) =>
    `⛔ ${who} wanted to reply ${where} on ${at}, but it ${why}: I didn’t send it. The reply is in the app, in Activity; if it’s fine, send it from there or with “Send anyway”.`,
  heldTell: (who: string, where: string, at: string, why: string) =>
    `⛔ ${who} wanted to reply ${where} on ${at}, but it ${why}: I didn’t send it. The reply is in the app, in Activity.`,
  heldQuestion: (who: string, where: string, at: string, why: string) =>
    `⛔ ${who} wanted to ask a question ${where} on ${at}, but it ${why}: I didn’t send it there. Answer it yourself from the app.`,
  replyKeyReason: 'contains a key or a secret code',
  sentToGroup: 'to the group',
  sentToChat: 'to the chat',
  sentAnyway: (agent: string, where: string) => `You sent ${agent}’s reply ${where} anyway.`,

  // --- errors of the API ---
  noMonsterNamed: 'There’s no monster with that name.',
  talksOnMainBot: (name: string) =>
    `${name} talks to you through the main bot: pick another monster.`,
  mainBotToken: 'This is the main bot’s code: create a new bot with BotFather for this monster.',
  mainBot: 'This is the main bot: create a new bot with BotFather for this monster.',
  alreadyAMonstersBot: (username: string) => `@${username} is already one of the monsters’ bots.`,
  mainBotTokenHere: (username: string) =>
    `This is the main bot’s code: here I need the one for @${username}.`,
  otherBot: (other: string, username: string) =>
    `This code belongs to @${other}, another bot: I need the one for @${username}. For a different bot, use Remove and Add.`,
  botGone: 'This bot no longer exists.',
  noSuchBot: 'There’s no such bot.',
  tokenChanged: 'bot code changed',
  forMonster: (name: string) => `for ${name}`,
  fullTools: 'full tools for the others too',
  reducedTools: 'reduced tools for the others',
  noSuchGroup: 'There’s no such group.',
  noSuchPerson: 'There’s no such person.',
  user: (id: number) => `User ${id}`,
  youAreOwner: 'That’s you (paired with the main bot): you can always talk to the monsters’ bots.',
  noSuchReply: 'There’s no such reply.',
  alreadySent: 'You’ve already sent this reply.',
  botOrReplyGone: 'The bot or the reply no longer exist.',
  botNotInChat: 'The bot is no longer in that chat.',
};

const it: typeof en = {
  commands: [
    { command: 'stato', description: 'Cosa sto facendo' },
    { command: 'join', description: 'Chiedi di poter parlare con me' },
    { command: 'aiuto', description: 'Come si usa' },
  ],
  help: (agent, at) =>
    [
      `Sono ${agent}. In un gruppo rispondo quando mi nomini (<code>${at}</code>), quando rispondi a un mio messaggio o con un comando; in privato a ogni messaggio.`,
      '',
      '/stato: cosa sto facendo',
      '/join: chiedi di poter parlare con me',
      '/aiuto: questo messaggio',
    ].join('\n'),

  crashed: 'Il bot si è fermato per un errore: riparto da solo.',
  tokenRefused:
    'Telegram ha rifiutato il codice del bot: rimuovi il bot e aggiungilo con un codice nuovo.',
  tokenInUse:
    'Un’altra app usa questo codice del bot (o ha un webhook): fermalo, o crea un bot nuovo con BotFather. Monsters riprova.',
  tokenOfAnotherBot: 'Il codice è di un altro bot: rimuovilo e aggiungilo di nuovo.',
  tokenMissing: 'Manca il codice di questo bot: rimuovilo e aggiungilo di nuovo.',

  fullNote: (max) =>
    ` Sono tante: ne tengo ${max} in attesa, le più vecchie lasciano il posto alle nuove.`,
  noName: 'senza nome',
  someone: 'Una persona',
  botLeftGroup: (at, agent, name) =>
    `Il bot ${at} di ${agent} non è più nel gruppo «${name}»: le risposte lì non partono più.`,
  botBlocked: (name, at, agent) =>
    `${name} ha bloccato il bot ${at} di ${agent}: le risposte a quell’account non partono.`,
  botInGroup: (at, agent, title, full, place) =>
    `Il bot ${at} di ${agent} è nel gruppo «${title}». Se va bene, approvalo in Monsters: ${place}.${full}`,
  personAsks: (name, agent, at, full, place) =>
    `${name} chiede di parlare con ${agent} su ${at}. Se va bene, approvalo in Monsters: ${place}.${full}`,
  tooManyRequests: (n, place) =>
    `Troppe richieste su un bot dedicato in poco tempo: non te le notifico più per un po’. Le ultime ${n} di gruppi e di persone le trovi in Monsters: ${place}; le più vecchie lasciano il posto alle nuove.`,
  raiseCap: (name, agent, at, stop, path) =>
    `⛔ ${name} ha scritto a ${agent} su ${at}, ma è ${stop}. Per alzarlo: ${path}.`,

  group: 'Gruppo',
  goAhead: 'Dimmi pure.',
  alreadyAllowed: 'Puoi già scrivermi.',
  askedOwner: (owner) => `Ho chiesto a ${owner} di approvarti.`,
  notReady: 'Monsters non è ancora pronto: riprova più tardi.',
  halted: (owner) => `I mostri sono fermi: li fa ripartire ${owner}.`,
  writingALot: 'Stai scrivendo molto: riprova tra un po’.',
  dayLimit: 'Per oggi ho finito i messaggi che posso ricevere: riprova domani.',
  needsOk: (owner) => `Serve l’ok di ${owner}: gliel’ho chiesto.`,
  finishingOther: 'Sto finendo un altro lavoro: ti rispondo appena posso.',
  failed: (error) => `⚠️ Non ci sono riuscito: ${error}`,
  stoppedBy: (owner) => `■ Mi sono fermato: ${owner} ha fermato i mostri.`,
  stopped: '■ Mi sono fermato.',
  chooseButton: 'Scegli un pulsante, oppure rispondi a questo messaggio.',
  replyHere: 'Rispondi a questo messaggio.',
  invalidButton: 'Questo pulsante non è valido.',
  ownerOnly: (owner) => `Questa la decide solo ${owner}.`,
  askerOnly: (owner) => `Risponde chi ha fatto la richiesta, o ${owner}.`,
  statusHalted: (who) => `<b>${who} è fermo</b>: i mostri sono stati fermati.`,
  statusWorking: (who, activity) => `<b>${who} è al lavoro</b>${activity ? `: ${activity}` : ''}`,
  statusWaiting: (who) => `<b>${who} aspetta una risposta</b>`,
  statusFree: (who) => `<b>${who} è libero.</b>`,
  statusToday: (n, limit) => `Messaggi di oggi: ${n} su ${limit}.`,

  inGroup: (title) => `nel gruppo «${title}»`,
  toPerson: (name) => `a ${name}`,
  inThatChat: 'in quella chat',
  somePerson: 'una persona',
  heldInChat: (why, owner) => `Questa risposta non la mando qui: ${why}. Decide ${owner}.`,
  heldLog: (who, where, at, why) =>
    `${who} voleva rispondere ${where} su ${at}, ma ${why}: la risposta non è partita.`,
  heldSummary: (where) => `rispondere ${where}`,
  heldTellCanSend: (who, where, at, why) =>
    `⛔ ${who} voleva rispondere ${where} su ${at}, ma ${why}: non l’ho mandata. La risposta è nell’app, in Attività; se va bene, mandala da lì o con «Manda comunque».`,
  heldTell: (who, where, at, why) =>
    `⛔ ${who} voleva rispondere ${where} su ${at}, ma ${why}: non l’ho mandata. La risposta è nell’app, in Attività.`,
  heldQuestion: (who, where, at, why) =>
    `⛔ ${who} voleva fare una domanda ${where} su ${at}, ma ${why}: non l’ho mandata lì. Rispondi tu dall’app.`,
  replyKeyReason: 'contiene una chiave o un codice segreto',
  sentToGroup: 'nel gruppo',
  sentToChat: 'nella chat',
  sentAnyway: (agent, where) => `Hai mandato comunque la risposta di ${agent} ${where}.`,

  noMonsterNamed: 'Non c’è nessun mostro con questo nome.',
  talksOnMainBot: (name) => `${name} parla con te dal bot principale: scegli un altro mostro.`,
  mainBotToken:
    'Questo è il codice del bot principale: crea un bot nuovo con BotFather per questo mostro.',
  mainBot: 'Questo è il bot principale: crea un bot nuovo con BotFather per questo mostro.',
  alreadyAMonstersBot: (username) => `@${username} c’è già tra i bot dei mostri.`,
  mainBotTokenHere: (username) =>
    `Questo è il codice del bot principale: qui serve quello di @${username}.`,
  otherBot: (other, username) =>
    `Questo codice è di @${other}, un altro bot: serve quello di @${username}. Per un bot diverso usa Rimuovi e Aggiungi.`,
  botGone: 'Questo bot non c’è più.',
  noSuchBot: 'Questo bot non c’è.',
  tokenChanged: 'codice del bot cambiato',
  forMonster: (name) => `per ${name}`,
  fullTools: 'strumenti completi anche per gli altri',
  reducedTools: 'strumenti ridotti per gli altri',
  noSuchGroup: 'Questo gruppo non c’è.',
  noSuchPerson: 'Questa persona non c’è.',
  user: (id) => `Utente ${id}`,
  youAreOwner: 'Sei tu (abbinato al bot principale): puoi sempre parlare con i bot dei mostri.',
  noSuchReply: 'Questa risposta non c’è.',
  alreadySent: 'Questa risposta l’hai già mandata.',
  botOrReplyGone: 'Il bot o la risposta non ci sono più.',
  botNotInChat: 'Il bot non è più in quella chat.',
};

export const botsStrings = () => pick({ en, it });
