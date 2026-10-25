import { defineStrings } from '../../lib/i18n.ts';
import { toNameIt } from '../../lib/utils.strings.ts';

/* Settings → Apps and Telegram → Apps (MCP): gallery, browser, apps added by address, Claude connections (D-153). */

const en = {
  parts: {
    status: {
      off: 'Off',
      idle: 'Ready',
      starting: 'Starting…',
      running: 'On',
      error: 'Problem',
    },
    whoUses: 'Who uses it',
    whoUsesLabel: 'Monsters that use it',
    noWebTitle: (name: string) => `${name} doesn’t have the web permission`,
    noWebSuffix: ' (no web)',
    cantStart: 'I can’t start it.',
    works: (server: string | undefined, n: number) =>
      `Works${server ? ` (${server})` : ''}: ${n === 1 ? '1 tool' : `${n} tools`}.`,
    unusable: (why: string) => ` · unusable: ${why}`,
    test: 'Test',
    testing: 'Testing…',
    details: 'Details',
  },
  paste: {
    empty: 'Paste the page’s address here.',
    toggle: 'Return page won’t open?',
    label: 'Address of the return page',
    hint: 'After you sign in, the browser goes to a page that doesn’t load: copy its address from the bar at the top and paste it here.',
    checking: 'Checking…',
    finish: 'Finish signing in',
  },
  paused: {
    isNew: 'new',
    descriptionAndArgs: 'description and arguments changed',
    description: 'description changed',
    args: 'arguments changed',
    noDescription: '(no description)',
    summary: (n: number, firstIsNew: boolean) =>
      n === 1
        ? `has ${firstIsNew ? 'a new tool' : 'a tool that changed'}: the monsters won’t use it until you accept it.`
        : `has ${n} new or changed tools: the monsters won’t use them until you accept them.`,
    warning:
      'A changed description is how an app can give the monsters new orders: read it before you accept.',
    disconnect: 'Disconnect',
    removeQuestion: (label: string) => `Remove ${label}?`,
    disconnected: (label: string) => `${label} disconnected.`,
    accept: 'Accept',
    accepted: (n: number): string => (n === 1 ? 'Tool accepted.' : 'Tools accepted.'),
    title: 'Paused tools',
    cardDescription:
      'They changed since you connected them. The other tools of the same apps work as before.',
  },
  claude: {
    state: {
      connected: 'Ready: the monsters that work with Claude use it.',
      needs_login: 'Claude asks you to sign in again.',
      missing: 'I can’t find it in your Claude account.',
      unknown: 'I haven’t checked it yet.',
      error: 'Claude can’t reach it.',
    },
    partState: {
      connected: 'ready',
      needs_login: 'to reconnect',
      missing: 'not in your Claude account',
      unknown: 'to check',
      error: 'problem',
    },
    openConnectors: 'Open Claude’s connectors',
    designLogin: {
      before: 'In a terminal on this computer, type ',
      then: ', then ',
      after: ', and sign in with your Claude account.',
    },
    connectOnClaude: (name: string) =>
      `Connect ${name} to your Claude account, if you haven’t already (Settings → Connectors).`,
    pressConnect: 'Press “Connect”: Monsters checks that Claude can see it.',
    reconnect: (relogin: boolean): string =>
      relogin
        ? 'Reconnect it from Claude’s connectors, then press “Check again”.'
        : 'Connect it from Claude’s connectors, then press “Check again”.',
    orTerminal: 'Or, in a terminal on this computer:',
    designTerminal: { before: 'In a terminal, type ', then: ', then ', after: '.' },
    connectedVia: (name: string) => `${name} connected through Claude.`,
    removed: (name: string) => `${name} disconnected from Monsters.`,
    intro:
      'It connects through your Claude plan, for the monsters that work with Claude. You sign in on Claude: Monsters never sees your password.',
    checking: 'Checking…',
    connect: 'Connect',
    checkAgain: 'Check again',
    disconnect: 'Disconnect',
    disconnectQuestion: (name: string) =>
      `Disconnect ${name} from Monsters? It stays connected to your Claude account.`,
    disconnectConfirm: 'Yes, disconnect',
    through: 'Through Claude Code and your Claude plan.',
    docs: (name: string) => `${name} documentation`,
  },
  secret: {
    empty: 'Paste the new key here.',
    changed: (service: string) => `${service} key changed.`,
    change: 'Change the key',
    which: 'Which value to change',
    newValueOf: (key: string) => `New value for ${key}`,
    newValue: 'New value',
    hint: 'Who uses it and the permissions stay as they are. The old key works until you save.',
    create: 'Create the key',
    saveAndTest: 'Save and test',
  },
  servers: {
    pairsFormat: (sep: string) => `Write one line at a time, like NAME${sep}value.`,
    browser: {
      name: 'Browser',
      description:
        'A browser of their own, separate from yours: they open pages, click and fill in forms. It doesn’t see your passwords or your history.',
      on: 'Browser turned on.',
      off: 'Browser turned off.',
      done: 'Done.',
      showWindow: 'Show the window',
      showWindowHint: 'To watch what they do. Off, the browser works hidden.',
      showWindowLabel: 'Show the browser window',
      profileIn: 'Profile in ',
      downloads: 'The first time, the browser downloads on its own.',
      noWebBefore:
        'Monsters marked “no web” can’t use it: the web is a permission of each monster, in ',
      noWebAfter: '.',
    },
    kind: (http: boolean, tools: number | undefined) =>
      `${http ? 'On the web' : 'On this computer'}${
        tools !== undefined ? ` · ${tools === 1 ? '1 tool' : `${tools} tools`}` : ''
      }`,
    on: 'On',
    turnOn: (label: string) => `Turn on ${label}`,
    turnedOn: 'Turned on.',
    turnedOff: 'Turned off.',
    done: 'Done.',
    remove: 'Remove',
    removeQuestion: 'Remove it?',
    removeConfirm: 'Yes, remove',
    hidden: (names: string) => `${names} (values hidden)`,
    nameIs: (name: string) => `Name: ${name}`,
    removed: 'App removed.',
    add: {
      title: 'New app',
      nameInvalid: 'Lowercase letters, digits and hyphens (24 at most), starting with a letter.',
      nameTaken: 'There’s already an app with this name.',
      commandMissing: 'Type the command.',
      urlInvalid: 'Type the full address, for example https://example.com/mcp.',
      name: 'Name',
      nameHint: 'Short, to recognize it: for example github or calendar.',
      where: 'Where it is',
      local: 'On this computer',
      web: 'On the web',
      command: 'Command',
      commandHint: 'Copy it from the app’s instructions, for example npx -y package-name.',
      address: 'Address',
      addressExample: 'https://example.com/mcp',
      variables: 'Variables (optional)',
      headers: 'Headers (optional)',
      secretsHint: 'One per line. They stay on this computer and aren’t shown again after saving.',
      adding: 'Adding…',
      submit: 'Add',
      added: (name: string) => `App “${name}” added. Press “Test” to see its tools.`,
      button: 'Advanced: add an app by address',
      buttonHint:
        'For an app that isn’t in the list and speaks the “MCP” standard, on this computer or on the web.',
    },
    what: 'your apps',
  },
  gallery: {
    state: {
      soon: 'Soon',
      claude: 'Connect through Claude',
      off: 'Not connected',
      login: 'Not connected',
      signin: 'Sign-in needed',
      waiting: 'Waiting',
      connected: 'Connected',
      error: 'Problem',
    },
    signIn: (name: string) => `Sign in to ${name}`,
    noSignIn: 'No sign-in',
    tenantInvalid: (suffix: string) =>
      `That isn’t a company name: type only the part before ${suffix}.`,
    tenantMissing: (name: string) => `Type your company’s name on ${name}.`,
    tokenMissing: (name: string) => `Paste the key you created on ${name}.`,
    tenantFirst: (name: string) => `Type your company on ${name} first.`,
    connected: (name: string) => `${name} connected.`,
    disconnected: (name: string) => `${name} disconnected.`,
    close: 'Close',
    soonAdd:
      'If you already have the app’s address and key, you can add it under “Advanced: add an app by address”.',
    howToConnect: 'How to connect it',
    yourCompany: 'Your company',
    address: 'Address:',
    moreScope: (name: string) =>
      `${name} needs one more permission for what the monsters asked it to do. The rest already works: press Connect to approve it on its page.`,
    oauthInfo: (name: string) =>
      `${name}’s page opens: sign in and confirm, then come back here. Monsters never sees your password.`,
    noneNeeded: 'No sign-in needed: just connect it.',
    launcher: {
      before: (command: string, needs: string) =>
        `It starts with ${command}, which is part of ${needs}: if you don’t have it, `,
      link: (needs: string) => `install ${needs}`,
      after: '.',
    },
    tokenHint: 'It stays on this computer and isn’t shown again.',
    createToken: 'Create the key',
    finishInBrowser: 'Finish signing in, in your browser.',
    updatesItself: 'This window updates by itself.',
    reopen: 'Reopen the sign-in page',
    connecting: 'Connecting…',
    startOver: 'Start over',
    connect: 'Connect',
    toolsReady: (n: number) => `${n === 1 ? '1 tool' : `${n} tools`} ready for the monsters.`,
    disconnect: 'Disconnect',
    disconnectQuestion: (name: string) => `Disconnect ${name}?`,
    disconnectConfirm: 'Yes, disconnect',
    valueHidden: (names: string) => `${names} (value hidden)`,
    oauthTokens: 'Signed in. Your login stays on this computer.',
    docs: (name: string) => `${name} documentation`,
    title: 'Apps',
    description:
      'Connect the apps you use and the monsters can read and use them. Every use is logged in Activity, and Stop halts them at once.',
    searchLabel: 'Search apps',
    searchPlaceholder: 'Search apps',
    connectCard: 'Connect',
    noMatch: (query: string) => `No app matches “${query}”.`,
    noMatchAdd: 'If you know its address, add it under “Advanced: add an app by address”.',
    showAll: (n: number) => `Show all (${n})`,
  },
};

const it: typeof en = {
  parts: {
    status: {
      off: 'Spento',
      idle: 'Pronto',
      starting: 'Si avvia…',
      running: 'Acceso',
      error: 'Problema',
    },
    whoUses: 'Chi lo usa',
    whoUsesLabel: 'Mostri che lo usano',
    noWebTitle: (name) => `${name} non ha il permesso del web`,
    noWebSuffix: ' (senza web)',
    cantStart: 'Non riesco ad avviarlo.',
    works: (server, n) =>
      `Funziona${server ? ` (${server})` : ''}: ${n} ${n === 1 ? 'strumento' : 'strumenti'}.`,
    unusable: (why) => ` · non usabile: ${why}`,
    test: 'Prova',
    testing: 'Provo…',
    details: 'Dettagli',
  },
  paste: {
    empty: 'Incolla qui l’indirizzo della pagina.',
    toggle: 'La pagina di ritorno non si apre?',
    label: 'Indirizzo della pagina di ritorno',
    hint: 'Dopo l’accesso il browser va su una pagina che non si carica: copia il suo indirizzo dalla barra in alto e incollalo qui.',
    checking: 'Controllo…',
    finish: 'Completa l’accesso',
  },
  paused: {
    isNew: 'nuovo',
    descriptionAndArgs: 'descrizione e argomenti cambiati',
    description: 'descrizione cambiata',
    args: 'argomenti cambiati',
    noDescription: '(nessuna descrizione)',
    summary: (n, firstIsNew) =>
      n === 1
        ? `ha ${firstIsNew ? 'uno strumento nuovo' : 'cambiato uno strumento'}: i mostri non lo usano finché non lo accetti.`
        : `ha ${n} strumenti nuovi o cambiati: i mostri non li usano finché non li accetti.`,
    warning:
      'Una descrizione cambiata è il modo in cui un’app può dare ordini nuovi ai mostri: leggila prima di accettare.',
    disconnect: 'Scollega',
    removeQuestion: (label) => `Togliere ${label}?`,
    disconnected: (label) => `${label} scollegato.`,
    accept: 'Accetta',
    accepted: (n) => (n === 1 ? 'Strumento accettato.' : 'Strumenti accettati.'),
    title: 'Strumenti in pausa',
    cardDescription:
      'Sono cambiati da quando li hai collegati. Gli altri strumenti delle stesse app funzionano come prima.',
  },
  claude: {
    state: {
      connected: 'Pronto: lo usano i mostri che lavorano con Claude.',
      needs_login: 'Claude chiede di accedere di nuovo.',
      missing: 'Non lo trovo sul tuo account Claude.',
      unknown: 'Non l’ho ancora controllato.',
      error: 'Claude non riesce a raggiungerlo.',
    },
    partState: {
      connected: 'pronto',
      needs_login: 'da ricollegare',
      missing: 'non è sul tuo account Claude',
      unknown: 'da controllare',
      error: 'problema',
    },
    openConnectors: 'Apri i connettori di Claude',
    designLogin: {
      before: 'In un terminale di questo computer scrivi ',
      then: ', poi ',
      after: ' e accedi con il tuo account Claude.',
    },
    connectOnClaude: (name) =>
      `Collega ${name} al tuo account Claude, se non l’hai già fatto (Impostazioni → Connettori).`,
    pressConnect: 'Premi “Collega”: Monsters controlla che Claude lo veda.',
    reconnect: (relogin) =>
      relogin
        ? 'Ricollegalo dai connettori di Claude, poi premi “Ricontrolla”.'
        : 'Collegalo dai connettori di Claude, poi premi “Ricontrolla”.',
    orTerminal: 'Oppure, in un terminale di questo computer:',
    designTerminal: { before: 'In un terminale scrivi ', then: ', poi ', after: '.' },
    connectedVia: (name) => `${name} collegato tramite Claude.`,
    removed: (name) => `${name} scollegato da Monsters.`,
    intro:
      'Si collega tramite il tuo piano Claude, per i mostri che lavorano con Claude. L’accesso lo fai su Claude: Monsters non vede la tua password.',
    checking: 'Controllo…',
    connect: 'Collega',
    checkAgain: 'Ricontrolla',
    disconnect: 'Scollega',
    disconnectQuestion: (name) =>
      `Scollego ${name} da Monsters? Resta collegato al tuo account Claude.`,
    disconnectConfirm: 'Sì, scollega',
    through: 'Tramite Claude Code e il tuo piano Claude.',
    docs: (name) => `Documentazione di ${name}`,
  },
  secret: {
    empty: 'Incolla qui la chiave nuova.',
    changed: (service) => `Chiave di ${service} cambiata.`,
    change: 'Cambia la chiave',
    which: 'Quale valore cambiare',
    newValueOf: (key) => `Nuovo valore di ${key}`,
    newValue: 'Nuovo valore',
    hint: 'Chi lo usa e i permessi restano come sono. La vecchia chiave vale finché non salvi.',
    create: 'Crea la chiave',
    saveAndTest: 'Salva e prova',
  },
  servers: {
    pairsFormat: (sep) => `Scrivi una riga per volta nella forma NOME${sep}valore.`,
    browser: {
      name: 'Browser',
      description:
        'Un browser tutto loro, separato dal tuo: aprono pagine, cliccano e compilano moduli. Non vede le tue password né la tua cronologia.',
      on: 'Browser acceso.',
      off: 'Browser spento.',
      done: 'Fatto.',
      showWindow: 'Mostra la finestra',
      showWindowHint: 'Per guardare cosa fanno. Spenta, il browser lavora nascosto.',
      showWindowLabel: 'Mostra la finestra del browser',
      profileIn: 'Profilo in ',
      downloads: 'La prima volta il browser si scarica da solo.',
      noWebBefore:
        'I mostri “senza web” non possono usarlo: il web è un permesso di ogni mostro, in ',
      noWebAfter: '.',
    },
    kind: (http, tools) =>
      `${http ? 'Sul web' : 'Sul computer'}${
        tools !== undefined ? ` · ${tools === 1 ? '1 strumento' : `${tools} strumenti`}` : ''
      }`,
    on: 'Acceso',
    turnOn: (label) => `Accendi ${label}`,
    turnedOn: 'Acceso.',
    turnedOff: 'Spento.',
    done: 'Fatto.',
    remove: 'Togli',
    removeQuestion: 'Lo tolgo?',
    removeConfirm: 'Sì, togli',
    hidden: (names) => `${names} (valori nascosti)`,
    nameIs: (name) => `Nome: ${name}`,
    removed: 'App tolta.',
    add: {
      title: 'Nuova app',
      nameInvalid:
        'Lettere minuscole, cifre e trattini (al massimo 24), iniziando con una lettera.',
      nameTaken: 'C’è già un’app con questo nome.',
      commandMissing: 'Scrivi il comando.',
      urlInvalid: 'Scrivi l’indirizzo completo, per esempio https://esempio.it/mcp.',
      name: 'Nome',
      nameHint: 'Breve, per riconoscerlo: per esempio github o calendario.',
      where: 'Dove sta',
      local: 'Sul computer',
      web: 'Sul web',
      command: 'Comando',
      commandHint: 'Quello che trovi nelle sue istruzioni, per esempio npx -y nome-del-pacchetto.',
      address: 'Indirizzo',
      addressExample: 'https://esempio.it/mcp',
      variables: 'Variabili (facoltative)',
      headers: 'Intestazioni (facoltative)',
      secretsHint:
        'Una per riga. Restano su questo computer e dopo il salvataggio non le mostriamo più.',
      adding: 'Aggiungo…',
      submit: 'Aggiungi',
      added: (name) => `App “${name}” aggiunta. Premi “Prova” per vedere i suoi strumenti.`,
      button: 'Avanzate: aggiungi un’app per indirizzo',
      buttonHint:
        'Per un’app che non è in elenco e parla lo standard “MCP”, sul computer o sul web.',
    },
    what: 'le tue app',
  },
  gallery: {
    state: {
      soon: 'Presto',
      claude: 'Collega tramite Claude',
      off: 'Da collegare',
      login: 'Da collegare',
      signin: 'Serve l’accesso',
      waiting: 'In attesa',
      connected: 'Collegato',
      error: 'Problema',
    },
    signIn: (name) => `Accedi ${toNameIt(name)}`,
    noSignIn: 'Senza accesso',
    tenantInvalid: (suffix) =>
      `Non è il nome di un’azienda: scrivi solo la parte prima di ${suffix}.`,
    tenantMissing: (name) => `Scrivi il nome della tua azienda su ${name}.`,
    tokenMissing: (name) => `Incolla qui il codice che hai creato su ${name}.`,
    tenantFirst: (name) => `Scrivi prima la tua azienda su ${name}.`,
    connected: (name) => `${name} collegato.`,
    disconnected: (name) => `${name} scollegato.`,
    close: 'Chiudi',
    soonAdd:
      'Se hai già l’indirizzo e la chiave dell’app, puoi aggiungerla da “Avanzate: aggiungi un’app per indirizzo”.',
    howToConnect: 'Come collegarlo',
    yourCompany: 'La tua azienda',
    address: 'Indirizzo:',
    moreScope: (name) =>
      `${name} chiede un permesso in più per quello che i mostri gli hanno chiesto. Il resto funziona già: con Collega lo confermi sulla sua pagina.`,
    oauthInfo: (name) =>
      `Si apre la pagina di ${name}: accedi e conferma, poi torna qui. Monsters non vede la tua password.`,
    noneNeeded: 'Non serve nessun accesso: basta collegarlo.',
    launcher: {
      before: (command, needs) =>
        `Si avvia con ${command}, che fa parte di ${needs}: se non ce l’hai, `,
      link: (needs) => `installa ${needs}`,
      after: '.',
    },
    tokenHint: 'Resta su questo computer e non lo mostriamo più.',
    createToken: 'Crea la chiave',
    finishInBrowser: 'Completa l’accesso nel browser.',
    updatesItself: 'Questa finestra si aggiorna da sola.',
    reopen: 'Riapri la pagina di accesso',
    connecting: 'Collego…',
    startOver: 'Ricomincia',
    connect: 'Collega',
    toolsReady: (n) =>
      n === 1 ? '1 strumento pronto per i mostri.' : `${n} strumenti pronti per i mostri.`,
    disconnect: 'Scollega',
    disconnectQuestion: (name) => `Scollego ${name}?`,
    disconnectConfirm: 'Sì, scollega',
    valueHidden: (names) => `${names} (valore nascosto)`,
    oauthTokens: 'Accesso fatto. Il tuo accesso resta su questo computer.',
    docs: (name) => `Documentazione di ${name}`,
    title: 'App',
    description:
      'Collega le app che usi e i mostri potranno leggerle e usarle. Ogni uso finisce in Attività e “Ferma” li ferma subito.',
    searchLabel: 'Cerca tra le app',
    searchPlaceholder: 'Cerca tra le app',
    connectCard: 'Collega',
    noMatch: (query) => `Nessuna app corrisponde a “${query}”.`,
    noMatchAdd:
      'Se conosci il suo indirizzo, aggiungila da “Avanzate: aggiungi un’app per indirizzo”.',
    showAll: (n) => `Mostra tutte (${n})`,
  },
};

export const mcpStrings = defineStrings({ en, it });
