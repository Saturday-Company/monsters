import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Connections → Telegram: the main bot and the bots dedicated to a monster (D-153). */

const en = {
  status: {
    off: 'Not connected.',
    connecting: 'Connecting to Telegram…',
    online: 'Connected: it’s listening to you.',
    retrying: 'Telegram isn’t answering: I’ll retry on my own.',
    conflict: 'Another app is using this bot: stop it, or create a new one.',
    error: 'Stopped: I need you to step in.',
  },
  botStatus: {
    off: 'Off.',
    connecting: 'Connecting to Telegram…',
    online: 'Connected.',
    retrying: 'Telegram isn’t answering: I’ll retry on my own.',
    conflict: 'Another app is using this bot: stop it, or create a new one.',
    error: 'Stopped: I need you to step in.',
  },
  botConnected: (username: string | undefined) =>
    `Bot ${username ? `@${username} ` : ''}connected.`,
  step1: { before: 'On Telegram open ', mid: ' and type ', after: '.' },
  step2: 'Pick a name: BotFather gives you a code (the token).',
  step3: 'Paste it here: Monsters checks with Telegram that it works.',
  tokenLabel: 'Bot code (token)',
  tokenHint: 'It stays on this computer, protected: only Monsters reads it. It isn’t shown again.',
  checking: 'Checking…',
  connectBot: 'Connect the bot',
  pairing: {
    intro: 'From your phone, send this message to the bot (it works once):',
    open: 'Open in Telegram',
    expires: (left: string) => `Expires in ${left} · waiting for the message…`,
  },
  quiet: { from: 'From', to: 'until' },
  notify: {
    title: 'Telegram notifications',
    questions: 'Pending questions',
    questionsText: 'With buttons to answer.',
    done: 'Work finished',
    doneText: 'When you asked for it from here or from the browser.',
    errors: 'Errors',
    errorsText: 'When a job doesn’t go well.',
    quietNight: 'Quiet at night',
    quietNightText:
      'Notifications wait until morning; a question that blocks the work still arrives, but without sound.',
  },
  paired: (name: string) =>
    `Account connected: ${name}. They can command the monsters from Telegram.`,
  section: {
    descriptionBefore:
      'Talk to the monsters from your phone, answer their questions and stop them with ',
    descriptionAfter: '. The bot is yours: only the accounts you connect here can command it.',
    fromPhone: 'From your phone: ',
    fromEnv: ' The bot code comes from the TELEGRAM_BOT_TOKEN variable.',
    bot: 'Bot',
    connect: 'Connect a bot',
    disconnect: 'Disconnect the bot',
    disconnectQuestion: 'Disconnect the bot?',
    disconnectConfirm: 'Yes, disconnect',
    disconnected: 'Bot disconnected.',
    usersTitle: 'Who can command the monsters',
    usersFooter: 'Other messages to the bot are ignored and end up in Activity.',
    noAccount: 'No account yet',
    noAccountText: 'Connect yours: until you do, the bot ignores every message, yours too.',
    connectedOn: (date: string) => `Connected on ${date}`,
    removed: (name: string) => `${name} can no longer command the monsters.`,
    removeLabel: (name: string) => `Remove ${name}`,
    remove: 'Remove',
    connectAccount: 'Connect an account',
  },
  bots: {
    personalSquad: 'Personal squad',
    riskTerminalAndApps: 'the Terminal and connected apps',
    riskTerminal: 'the Terminal',
    riskApps: 'connected apps',
    reducedTools:
      'no terminal or file changes, other apps only with your OK, in the notes only the project’s area, the monster’s own and Inbox; a reply that repeats notes or keys stays with you',
    riskNote: (name: string, words: string) =>
      `${name} has ${words}, which act on your behalf. People you admit to this bot don’t use them until you turn them back on, under “Tools for others”.`,
    toolsTitle: 'Tools for others',
    toolsOn: (u: string, monster: string) =>
      `People you admit to @${u} now use all of ${monster}’s tools.`,
    toolsOff: (u: string) => `People you admit to @${u} are back to reduced tools.`,
    toolsLabel: (monster: string, u: string) =>
      `All of ${monster}’s tools for people you admit to @${u}`,
    toolsOnState: (monster: string, words: string | null) =>
      `On: people you admit use everything ${monster} can do, with your permissions${words ? `, including ${words}` : ''}.`,
    toolsOffState: (reduced: string) =>
      `Off: anyone who isn’t you works with fewer tools (${reduced}).`,
    toolsConfirm: (monster: string, words: string | null) =>
      `People you admit will be able to use ${words ?? 'all the tools'} of ${monster} as if they were you, and read all the notes except the private ones. Turn it on?`,
    toolsYes: 'Yes, turn on',
    chooseMonster: 'Choose the monster that answers from this bot.',
    limitInvalid: (max: number) =>
      `The limit is a whole number between 1 and ${max}, or leave it empty.`,
    addedTo: (username: string | undefined, monster: string) =>
      `Bot ${username ? `@${username} ` : ''}connected to ${monster}.`,
    form: {
      step1: {
        before: 'On Telegram open ',
        mid: ', type ',
        after: ' and give it a name: it gives you the token.',
      },
      step2: {
        before: 'Still with BotFather: ',
        mid: ', choose the bot, ',
        after:
          '. In groups the bot only receives messages that mention it, replies to its messages and commands.',
      },
      step3:
        'A token is used by one program at a time. If the bot belongs to another program today (for example another assistant already active in the group), create a new bot or stop that program first.',
      step4: {
        before:
          'Add the bot to the group: it shows up below and you approve it. Whoever wants to talk to it types ',
        after: ' in the group (or to the bot in private) and you approve them here.',
      },
      agent: 'The monster that answers',
      agentHint:
        'Only it talks: with @Name it doesn’t reach the other monsters. Your lead stays on the main bot.',
      chooseOption: 'Choose a monster',
      limit: 'Messages per day (optional)',
      limitHint: 'Past this number the bot replies that it’s done for today. Empty: 100 a day.',
      limitPlaceholder: 'e.g. 200',
    },
    toApprove: ' · to approve',
    approved: ' · approved',
    approve: 'Approve',
    approveLabel: (title: string) => `Approve ${title}`,
    reject: 'Reject',
    remove: 'Remove',
    rejectOrRemove: (pending: boolean, title: string) =>
      `${pending ? 'Reject' : 'Remove'} ${title}`,
    youNote: ' · you: your words count as yours, the approvals are yours',
    pendingNote: (cmd: string) => ` · asked with ${cmd}: to approve`,
    idInvalid: 'The Telegram ID is a number, like 123456789.',
    addById: 'Add with the Telegram ID',
    add: 'Add',
    tokenChanged: (u: string) => `@${u} token changed: groups and people stay.`,
    newToken: (u: string) => `New token for @${u}`,
    newTokenHint:
      'It must be the same bot’s (BotFather changed it with /revoke). Approved groups and people stay.',
    saveRestart: 'Save and restart',
    toApproveCount: (n: number) => (n === 1 ? '1 to approve' : `${n} to approve`),
    changeToken: 'Change the token',
    removeBot: 'Remove bot',
    removeQuestion: (u: string) => `Remove @${u}?`,
    removeConfirm: 'Yes, remove',
    removedBot: (u: string) => `@${u} no longer answers: Monsters has deleted the token.`,
    groups: 'Groups',
    noGroups: (u: string) =>
      `No groups yet: add @${u} to the group on Telegram, then approve it here. In groups you haven’t approved the bot doesn’t answer.`,
    groupsOf: (u: string) => `Groups of @${u}`,
    groupApproved: (title: string) => `Group “${title}” approved.`,
    groupRejected: (title: string) => `Group “${title}” rejected.`,
    groupRemoved: (title: string) => `The bot no longer answers in “${title}”.`,
    whoCanTalk: 'Who can talk to it',
    noPeople: 'Connect your account to the main bot above: approvals arrive there.',
    peopleOf: (u: string) => `Who can talk to @${u}`,
    personApproved: (name: string, u: string) => `${name} can talk to @${u}.`,
    personRemoved: (name: string, u: string) => `${name} can no longer talk to @${u}.`,
    othersBefore: 'Others type ',
    othersAfter:
      ' in the group, or to the bot in private: you find them here to approve. Messages from people who aren’t admitted are ignored and end up in Activity.',
    personAdded: 'Person added.',
    today: (today: number, limit: number) => `Messages today: ${today} of ${limit}`,
    title: 'Bots dedicated to a monster',
    description:
      'A bot of its own for a monster, to put in a Telegram group: whoever you admit here talks to it with @name, replying to its messages or with a command. Each bot has its own token.',
    footer:
      'The things you decide (the brake on an action, drafts of monsters, projects and automations, spending over the cap) are never approved in the group: they reach you in private on the main bot and in the app. In the group, only your own words count as yours, and anyone who isn’t you works with fewer tools until you turn them back on for that bot. From the group: ',
    none: 'No dedicated bot',
    noneText:
      'For example a monster for the squad’s group: notes, tasks and projects for everyone.',
    addButton: 'Add a bot for a monster',
  },
};

const it: typeof en = {
  status: {
    off: 'Non collegato.',
    connecting: 'Mi collego a Telegram…',
    online: 'Collegato: ti ascolta.',
    retrying: 'Telegram non risponde: riprovo da solo.',
    conflict: 'Un altro programma usa questo bot: fermalo, o creane uno nuovo.',
    error: 'Fermo: serve il tuo intervento.',
  },
  botStatus: {
    off: 'Spento.',
    connecting: 'Mi collego a Telegram…',
    online: 'Collegato.',
    retrying: 'Telegram non risponde: riprovo da solo.',
    conflict: 'Un altro programma usa questo bot: fermalo, o creane uno nuovo.',
    error: 'Fermo: serve il tuo intervento.',
  },
  botConnected: (username) => `Bot ${username ? `@${username} ` : ''}collegato.`,
  step1: { before: 'Su Telegram apri ', mid: ' e scrivi ', after: '.' },
  step2: 'Scegli un nome: BotFather ti dà un codice (il token).',
  step3: 'Incollalo qui: Monsters controlla con Telegram che funzioni.',
  tokenLabel: 'Codice del bot (token)',
  tokenHint: 'Resta su questo computer, protetto: lo legge solo Monsters. Non lo mostriamo più.',
  checking: 'Controllo…',
  connectBot: 'Collega il bot',
  pairing: {
    intro: 'Dal telefono, scrivi al bot questo messaggio (vale una volta sola):',
    open: 'Apri in Telegram',
    expires: (left) => `Scade tra ${left} · aspetto il messaggio…`,
  },
  quiet: { from: 'Dalle', to: 'fino alle' },
  notify: {
    title: 'Notifiche su Telegram',
    questions: 'Domande in attesa',
    questionsText: 'Con i pulsanti per rispondere.',
    done: 'Lavoro finito',
    doneText: 'Quando lo hai chiesto da qui o dal browser.',
    errors: 'Errori',
    errorsText: 'Quando un lavoro non va a buon fine.',
    quietNight: 'Silenzioso di notte',
    quietNightText:
      'Le notifiche aspettano il mattino; una domanda che blocca il lavoro arriva lo stesso, ma senza suono.',
  },
  paired: (name) => `Account collegato: ${name}. Può comandare i mostri da Telegram.`,
  section: {
    descriptionBefore: 'Parla con i mostri dal telefono, rispondi alle loro domande e fermali con ',
    descriptionAfter: '. Il bot è tuo: solo gli account che colleghi qui possono comandarlo.',
    fromPhone: 'Dal telefono: ',
    fromEnv: ' Il codice del bot arriva dalla variabile TELEGRAM_BOT_TOKEN.',
    bot: 'Bot',
    connect: 'Collega un bot',
    disconnect: 'Scollega il bot',
    disconnectQuestion: 'Scollego il bot?',
    disconnectConfirm: 'Sì, scollega',
    disconnected: 'Bot scollegato.',
    usersTitle: 'Chi può comandare i mostri',
    usersFooter: 'Gli altri messaggi al bot vengono ignorati e finiscono in Attività.',
    noAccount: 'Nessun account ancora',
    noAccountText:
      'Collega il tuo: finché non lo fai, il bot ignora tutti i messaggi, anche i tuoi.',
    connectedOn: (date) => `Collegato il ${date}`,
    removed: (name) => `${name} non può più comandare i mostri.`,
    removeLabel: (name) => `Togli ${name}`,
    remove: 'Togli',
    connectAccount: 'Collega un account',
  },
  bots: {
    personalSquad: 'Squadra personale',
    riskTerminalAndApps: 'il Terminale e altri programmi collegati',
    riskTerminal: 'il Terminale',
    riskApps: 'altri programmi collegati',
    reducedTools:
      'niente terminale né modifiche ai file, gli altri programmi solo con il tuo ok, nel vault solo l’area del progetto, quella del mostro e Inbox; una risposta che ripete note o chiavi resta a te',
    riskNote: (name, words) =>
      `${name} ha ${words}, che agiscono a nome tuo. Chi ammetti in questo bot non li usa finché non li riaccendi, sotto “Strumenti per gli altri”.`,
    toolsTitle: 'Strumenti per gli altri',
    toolsOn: (u, monster) => `Chi ammetti in @${u} usa tutti gli strumenti di ${monster}.`,
    toolsOff: (u) => `Chi ammetti in @${u} torna agli strumenti ridotti.`,
    toolsLabel: (monster, u) => `Tutti gli strumenti di ${monster} per chi ammetti in @${u}`,
    toolsOnState: (monster, words) =>
      `Acceso: chi ammetti usa tutto quello che ${monster} può fare, con i tuoi permessi${words ? `, anche ${words}` : ''}.`,
    toolsOffState: (reduced) => `Spento: chi non sei tu lavora con meno strumenti (${reduced}).`,
    toolsConfirm: (monster, words) =>
      `Chi ammetti potrà usare ${words ?? 'tutti gli strumenti'} di ${monster} come se fossi tu, e leggere tutto il vault tranne le note private. Accendo?`,
    toolsYes: 'Sì, accendi',
    chooseMonster: 'Scegli il mostro che risponde da questo bot.',
    limitInvalid: (max) => `Il limite è un numero intero tra 1 e ${max}, o niente.`,
    addedTo: (username, monster) => `Bot ${username ? `@${username} ` : ''}collegato a ${monster}.`,
    form: {
      step1: {
        before: 'Su Telegram apri ',
        mid: ', scrivi ',
        after: ' e dagli un nome: ti dà il token.',
      },
      step2: {
        before: 'Sempre a BotFather: ',
        mid: ', scegli il bot, ',
        after:
          '. Nei gruppi il bot riceve solo i messaggi che lo nominano, le risposte ai suoi messaggi e i comandi.',
      },
      step3:
        'Un token lo usa un programma alla volta. Se oggi il bot è di un altro programma (per esempio un altro assistente già attivo nel gruppo), crea un bot nuovo o ferma prima quel programma.',
      step4: {
        before:
          'Aggiungi il bot al gruppo: compare qui sotto e lo approvi. Chi vuole parlargli scrive ',
        after: ' nel gruppo (o al bot in privato) e lo approvi qui.',
      },
      agent: 'Il mostro che risponde',
      agentHint:
        'Parla solo lui: con @Nome non arriva agli altri mostri. Il tuo capo resta sul bot principale.',
      chooseOption: 'Scegli un mostro',
      limit: 'Messaggi al giorno (facoltativo)',
      limitHint:
        'Oltre questo numero il bot risponde che per oggi ha finito. Vuoto: 100 al giorno.',
      limitPlaceholder: 'es. 200',
    },
    toApprove: ' · da approvare',
    approved: ' · approvato',
    approve: 'Approva',
    approveLabel: (title) => `Approva ${title}`,
    reject: 'Rifiuta',
    remove: 'Togli',
    rejectOrRemove: (pending, title) => `${pending ? 'Rifiuta' : 'Togli'} ${title}`,
    youNote: ' · tu: le tue parole contano come tue, le approvazioni sono tue',
    pendingNote: (cmd) => ` · ha chiesto con ${cmd}: da approvare`,
    idInvalid: 'L’ID di Telegram è un numero, come 123456789.',
    addById: 'Aggiungi con l’ID di Telegram',
    add: 'Aggiungi',
    tokenChanged: (u) => `Token di @${u} cambiato: gruppi e persone restano.`,
    newToken: (u) => `Nuovo token di @${u}`,
    newTokenHint:
      'Deve essere dello stesso bot (lo ha cambiato BotFather con /revoke). Gruppi e persone approvati restano.',
    saveRestart: 'Salva e riavvia',
    toApproveCount: (n) => (n === 1 ? '1 da approvare' : `${n} da approvare`),
    changeToken: 'Cambia il token',
    removeBot: 'Rimuovi bot',
    removeQuestion: (u) => `Tolgo @${u}?`,
    removeConfirm: 'Sì, togli',
    removedBot: (u) => `@${u} non risponde più: il token è cancellato da Monsters.`,
    groups: 'Gruppi',
    noGroups: (u) =>
      `Nessun gruppo ancora: aggiungi @${u} al gruppo su Telegram, poi approvalo qui. Nei gruppi non approvati il bot non risponde.`,
    groupsOf: (u) => `Gruppi di @${u}`,
    groupApproved: (title) => `Gruppo «${title}» approvato.`,
    groupRejected: (title) => `Gruppo «${title}» rifiutato.`,
    groupRemoved: (title) => `Il bot non risponde più in «${title}».`,
    whoCanTalk: 'Chi può parlargli',
    noPeople: 'Collega il tuo account al bot principale qui sopra: le approvazioni arrivano lì.',
    peopleOf: (u) => `Chi può parlare con @${u}`,
    personApproved: (name, u) => `${name} può parlare con @${u}.`,
    personRemoved: (name, u) => `${name} non può più parlare con @${u}.`,
    othersBefore: 'Gli altri scrivono ',
    othersAfter:
      ' nel gruppo, o al bot in privato: li trovi qui da approvare. I messaggi di chi non è ammesso vengono ignorati e finiscono in Attività.',
    personAdded: 'Persona aggiunta.',
    today: (today, limit) => `Messaggi di oggi: ${today} su ${limit}`,
    title: 'Bot dedicati a un mostro',
    description:
      'Un bot tutto suo per un mostro, da mettere in un gruppo di Telegram: chi ammetti qui gli parla con @nome, rispondendo ai suoi messaggi o con un comando. Ogni bot ha il suo token.',
    footer:
      'Le cose che decidi tu (il freno su un’azione, le bozze di mostri, progetti e automazioni, la spesa oltre il tetto) non si approvano mai nel gruppo: arrivano a te in privato sul bot principale e nell’app. Nel gruppo, solo le parole tue contano come tue, e chi non sei tu lavora con meno strumenti finché non li riaccendi per quel bot. Dal gruppo: ',
    none: 'Nessun bot dedicato',
    noneText:
      'Ad esempio un mostro per il gruppo della squadra: note, compiti e progetti per tutti.',
    addButton: 'Aggiungi un bot per un mostro',
  },
};

export const telegramStrings = defineStrings({ en, it });
