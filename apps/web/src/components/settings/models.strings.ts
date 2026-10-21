import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Models: the services, the keys and the chain of models of every monster (D-153). */

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

const en = {
  picker: {
    freeRouter: 'Free, picked by OpenRouter',
    paidOption: (name: string, freeOnly: boolean) =>
      `${name} · paid${freeOnly ? ', not enabled' : ''}`,
    loading: 'Loading models…',
    modelName: 'Model name',
    choose: 'Choose a model',
    other: 'Other…',
    nameOf: (label: string) => `Name of ${lowerFirst(label)}`,
    exactName: 'The exact model name',
    search: 'Search for a model',
    unknown:
      'Not in the list: it’s used as is, as an id. If it isn’t the exact one, pick from the list.',
    listLabel: (label: string) => `Model list: ${label}`,
    none: 'No model with this name: I’ll use it as written (Other).',
    partial: (shown: number, total: number) => `${shown} of ${total} · type to search`,
    count: (n: number) => (n === 1 ? '1 model' : `${n} models`),
  },
  providers: {
    about: {
      openrouter: 'Many models with a single key, some of them free.',
      anthropic: 'Claude models, with your API key.',
      openai: 'GPT models, with your API key.',
      google: 'Gemini models, with a Google AI Studio key.',
      mistral: 'Mistral’s models, a European company.',
      groq: 'Open models, very fast.',
      ollama: 'Models on your own computer: free and private, but slower and less good with tools.',
      lmstudio:
        'Models on your own computer: free and private, but slower and less good with tools.',
    } as Record<string, string>,
    tag: {
      local: 'On your computer',
      payAsYouGoFree: 'Pay as you go, with a free plan',
      payAsYouGo: 'Pay as you go',
      free: 'Free with limits',
    },
    paidTitle: 'Paid.',
    paidText: (label: string, freeTier: boolean) =>
      `Every request from the monsters costs something and you pay for it, on your ${label} account. Monsters adds nothing and can’t see your costs.${
        freeTier
          ? ' The free plan has tight limits and, on some services, may use what you write to train models.'
          : ''
      }`,
    form: {
      urlInvalid: 'Type the full address, for example http://127.0.0.1:11434.',
      connected: (label: string) => `${label} connected.`,
      openrouterPrefix: 'Paste the full key: it starts with “sk-or-”.',
      saved: 'Key saved. The monsters will use it right away.',
      keyInvalid: 'Paste the full key, with no spaces.',
      verified: (label: string) => `${label} key verified and saved.`,
      addressOf: (label: string) => `${label} address`,
      newKey: 'New key',
      keyOf: (label: string) => `${label} key`,
      localHint: (label: string) =>
        `${label} must be running. The address is usually the one already written.`,
      keyHint: 'I check it before saving it. It stays on this computer and isn’t shown again.',
      checking: 'Checking…',
      connect: 'Connect',
      verifyAndSave: 'Verify and save',
      createKey: (host: string) => `Create the key at ${host}`,
    },
    blocked: {
      enabled: 'OpenRouter paid models on.',
      text: (n: number): string =>
        n > 1
          ? 'are paid models, but OpenRouter now uses only free models. Turn on paid models, or pick a model that ends in “:free”.'
          : 'is a paid model, but OpenRouter now uses only free models. Turn on paid models, or pick a model that ends in “:free”.',
      turningOn: 'Turning on…',
      button: 'Also use paid models',
    },
    base: { light: 'Light', medium: 'Medium', strong: 'Strong' },
    autoLine: {
      usually: (name: string) => `Usually ${name}`,
      simple: (name: string) => `simple → ${name}`,
      hard: (name: string) => `hard → ${name}`,
      withEffort: (name: string, effort: string) => `${name} (${effort.toLowerCase()} effort)`,
    },
    chain: {
      everyone: 'all the monsters',
      saved: (name: string | null) =>
        name === null ? 'Squad models saved.' : `${name}’s models saved.`,
      allMonsters: 'All monsters',
      lead: 'your lead',
      saving: 'Saving…',
      automatic: 'Automatic',
      automaticText:
        'For every request and every task the expert model (TypeSafe) chooses between Sonnet (medium effort) and Opus (high effort) of the Claude plan; Haiku with the Light base.',
      automaticLabel: (who: string) => `Automatic model choice for ${who}`,
      teamAuto:
        'Each monster starts from its own base: your lead and those who work on the computer from Strong, the others from Medium. You change it with “Choose for each monster”.',
      baseWord: 'Base',
      baseOf: (who: string) => `Base of ${who}`,
      withoutExpert:
        'Without the expert model (Squad → Monsters’ decisions) the base stays. If Opus reaches the plan’s limit, the same request moves to Sonnet.',
      serviceOf: (i: number, who: string) => `Service ${i} of ${who}`,
      notConnected: (label: string) => `${label} (not connected)`,
      modelOf: (i: number, who: string) => `Model ${i} of ${who}`,
      tierLight: 'For simple requests',
      tierStrong: 'For hard requests',
      moveUp: (i: number, who: string) => `Move model ${i} of ${who} up`,
      remove: (i: number, who: string) => `Remove model ${i} of ${who}`,
      addAlternative: 'Add an alternative',
    },
    group: {
      different: 'The monsters use different models',
      same: 'Same for everyone',
      each: 'Choose for each monster',
      titleEach: 'Each monster’s model',
      titleAll: 'The monsters’ model',
      description:
        'The first one is the preferred: if it doesn’t answer or has run out of requests, the monster moves to the next. Every change saves itself.',
    },
  },
  tab: {
    paid: {
      enabled: 'OpenRouter paid models on, right away.',
      disabled: 'Free models only again, right away.',
      label: 'Also use paid models',
      on: 'The monsters can use all OpenRouter models. You pay for the paid ones.',
      off: 'Off: only free models (the ones ending in “:free”), at no cost.',
      turningOn: 'Turning on…',
      turnOn: 'Turn on paid models',
    },
    disconnected: (label: string) => `${label} disconnected.`,
    keyRemoved: (label: string) => `${label} key removed.`,
    disconnect: 'Disconnect',
    disconnectQuestion: (label: string) => `Disconnect ${label}?`,
    disconnectConfirm: 'Yes, disconnect',
    freeOnly: 'Free only',
    alsoPaid: 'Also paid',
    keyActive: (name: string | undefined, env: string | undefined) =>
      `Key active${name ? ` (“${name}”)` : ''}${env !== undefined ? `, from the ${env} variable` : ''}.`,
    close: 'Close',
    change: 'Change',
    key: 'Key',
    savedKeyHidden: 'The saved key isn’t shown again.',
    changeKey: 'Change key',
    changeAddress: 'Change address',
    connectedTo: (url: string) => `Connected to ${url}.`,
    connect: 'Connect',
    addKey: 'Add the key',
    failed: 'I can’t read the models right now. Try again in a moment.',
    openrouterFirst: 'Many models with a single key, some of them free: the easiest way to start.',
    openrouterNone: 'No OpenRouter key (optional if you already have another model).',
    thinkWith: 'What the monsters think with',
    noModel: 'No model connected',
    noModelText: 'Without a model the monsters can’t think: connect one below.',
    connectAnother: 'Connect another model',
    subscriptionsText: 'The monsters use your plan, in the ways OpenAI and Anthropic allow.',
    keysOrLocal: 'With a key or on your computer',
    search: 'Web search',
    paidSearch: 'Paid search',
    paidSearchText: 'You turn it on in Connections, along with free search and the Brave key.',
    goToLinks: 'Go to Connections',
  },
};

const it: typeof en = {
  picker: {
    freeRouter: 'Gratuito, scelto da OpenRouter',
    paidOption: (name, freeOnly) => `${name} · a pagamento${freeOnly ? ', non attivo' : ''}`,
    loading: 'Carico i modelli…',
    modelName: 'Nome del modello',
    choose: 'Scegli un modello',
    other: 'Altro…',
    nameOf: (label) => `Nome del ${lowerFirst(label)}`,
    exactName: 'Il nome esatto del modello',
    search: 'Cerca un modello',
    unknown: 'Non è nell’elenco: si usa così, come id. Se non è quello esatto, scegli dall’elenco.',
    listLabel: (label) => `Elenco dei modelli: ${label}`,
    none: 'Nessun modello con questo nome: lo uso com’è scritto (Altro).',
    partial: (shown, total) => `${shown} di ${total} · scrivi per cercare`,
    count: (n) => (n === 1 ? '1 modello' : `${n} modelli`),
  },
  providers: {
    about: {
      openrouter: 'Tanti modelli con una chiave sola, anche gratis.',
      anthropic: 'I modelli Claude, con la tua chiave API.',
      openai: 'I modelli GPT, con la tua chiave API.',
      google: 'I modelli Gemini, con una chiave di Google AI Studio.',
      mistral: 'I modelli di Mistral, un’azienda europea.',
      groq: 'Modelli aperti, molto veloci.',
      ollama:
        'Modelli sul tuo computer: gratis e privati, ma più lenti e meno bravi con gli strumenti.',
      lmstudio:
        'Modelli sul tuo computer: gratis e privati, ma più lenti e meno bravi con gli strumenti.',
    },
    tag: {
      local: 'Sul tuo computer',
      payAsYouGoFree: 'A consumo, con piano gratuito',
      payAsYouGo: 'A consumo',
      free: 'Gratis con limiti',
    },
    paidTitle: 'A pagamento.',
    paidText: (label, freeTier) =>
      `Ogni richiesta dei mostri costa qualcosa e la paghi tu, sul tuo account di ${label}. Monsters non aggiunge nulla e non vede i tuoi costi.${
        freeTier
          ? ' Il piano gratuito ha limiti stretti e, su alcuni servizi, può usare quello che scrivi per addestrare i modelli.'
          : ''
      }`,
    form: {
      urlInvalid: 'Scrivi l’indirizzo completo, per esempio http://127.0.0.1:11434.',
      connected: (label) => `${label} collegato.`,
      openrouterPrefix: 'Incolla la chiave completa: inizia con “sk-or-”.',
      saved: 'Chiave salvata. I mostri la useranno da subito.',
      keyInvalid: 'Incolla la chiave completa, senza spazi.',
      verified: (label) => `Chiave di ${label} verificata e salvata.`,
      addressOf: (label) => `Indirizzo di ${label}`,
      newKey: 'Nuova chiave',
      keyOf: (label) => `Chiave di ${label}`,
      localHint: (label) =>
        `${label} deve essere acceso. Di solito l’indirizzo è quello già scritto.`,
      keyHint: 'La controllo prima di salvarla. Resta su questo computer e non la mostriamo più.',
      checking: 'Controllo…',
      connect: 'Collega',
      verifyAndSave: 'Verifica e salva',
      createKey: (host) => `Crea la chiave su ${host}`,
    },
    blocked: {
      enabled: 'Modelli a pagamento di OpenRouter attivi.',
      text: (n) =>
        n > 1
          ? 'sono modelli a pagamento, ma OpenRouter ora usa solo i modelli gratuiti. Attiva i modelli a pagamento, oppure scegli un modello che finisce con “:free”.'
          : 'è un modello a pagamento, ma OpenRouter ora usa solo i modelli gratuiti. Attiva i modelli a pagamento, oppure scegli un modello che finisce con “:free”.',
      turningOn: 'Attivo…',
      button: 'Usa anche modelli a pagamento',
    },
    base: { light: 'Leggera', medium: 'Media', strong: 'Forte' },
    autoLine: {
      usually: (name) => `Di solito ${name}`,
      simple: (name) => `semplici → ${name}`,
      hard: (name) => `difficili → ${name}`,
      withEffort: (name, effort) => `${name} (impegno ${effort})`,
    },
    chain: {
      everyone: 'tutti i mostri',
      saved: (name) =>
        name === null ? 'Modelli della squadra salvati.' : `Modelli di ${name} salvati.`,
      allMonsters: 'Tutti i mostri',
      lead: 'il tuo capo',
      saving: 'Salvo…',
      automatic: 'Automatica',
      automaticText:
        'A ogni richiesta e a ogni incarico il modello esperto (TypeSafe) sceglie tra Sonnet (impegno Medio) e Opus (impegno Alto) del piano Claude; Haiku con la base Leggera.',
      automaticLabel: (who) => `Scelta automatica del modello per ${who}`,
      teamAuto:
        'Ogni mostro parte dalla sua base: il tuo capo e chi lavora sul computer da Forte, gli altri da Media. La cambi con “Scegli per ogni mostro”.',
      baseWord: 'Base',
      baseOf: (who) => `Base di ${who}`,
      withoutExpert:
        'Senza il modello esperto (Squadra → Decisioni dei mostri) resta la base. Se Opus arriva al limite del piano, la stessa richiesta passa a Sonnet.',
      serviceOf: (i, who) => `Servizio ${i} di ${who}`,
      notConnected: (label) => `${label} (non collegato)`,
      modelOf: (i, who) => `Modello ${i} di ${who}`,
      tierLight: 'Per le richieste semplici',
      tierStrong: 'Per le richieste difficili',
      moveUp: (i, who) => `Sposta su il modello ${i} di ${who}`,
      remove: (i, who) => `Togli il modello ${i} di ${who}`,
      addAlternative: 'Aggiungi un’alternativa',
    },
    group: {
      different: 'I mostri usano modelli diversi',
      same: 'Uguale per tutti',
      each: 'Scegli per ogni mostro',
      titleEach: 'Il modello di ogni mostro',
      titleAll: 'Il modello dei mostri',
      description:
        'Il primo è quello preferito: se non risponde o ha finito le richieste, il mostro passa al successivo. Ogni cambio si salva da solo.',
    },
  },
  tab: {
    paid: {
      enabled: 'Modelli a pagamento di OpenRouter attivi, da subito.',
      disabled: 'Di nuovo solo modelli gratuiti, da subito.',
      label: 'Usa anche modelli a pagamento',
      on: 'I mostri possono usare tutti i modelli di OpenRouter. Quelli a pagamento li paghi tu.',
      off: 'Spento: solo i modelli gratuiti (quelli che finiscono con “:free”), senza costi.',
      turningOn: 'Attivo…',
      turnOn: 'Attiva i modelli a pagamento',
    },
    disconnected: (label) => `${label} scollegato.`,
    keyRemoved: (label) => `Chiave di ${label} tolta.`,
    disconnect: 'Scollega',
    disconnectQuestion: (label) => `Scollego ${label}?`,
    disconnectConfirm: 'Sì, scollega',
    freeOnly: 'Solo gratuiti',
    alsoPaid: 'Anche a pagamento',
    keyActive: (name, env) =>
      `Chiave attiva${name ? ` (“${name}”)` : ''}${env !== undefined ? `, dalla variabile ${env}` : ''}.`,
    close: 'Chiudi',
    change: 'Cambia',
    key: 'Chiave',
    savedKeyHidden: 'La chiave salvata non si mostra più.',
    changeKey: 'Cambia chiave',
    changeAddress: 'Cambia indirizzo',
    connectedTo: (url) => `Collegato a ${url}.`,
    connect: 'Collega',
    addKey: 'Aggiungi la chiave',
    failed: 'Non riesco a leggere i modelli adesso. Riprova tra poco.',
    openrouterFirst:
      'Tanti modelli con una chiave sola, anche gratis: il modo più semplice per cominciare.',
    openrouterNone: 'Nessuna chiave OpenRouter (facoltativa se hai già un altro modello).',
    thinkWith: 'Con cosa pensano i mostri',
    noModel: 'Nessun modello collegato',
    noModelText: 'Senza un modello i mostri non possono pensare: collegane uno qui sotto.',
    connectAnother: 'Collega un altro modello',
    subscriptionsText: 'I mostri usano il tuo piano, nei modi che OpenAI e Anthropic permettono.',
    keysOrLocal: 'Con una chiave o sul tuo computer',
    search: 'Ricerca sul web',
    paidSearch: 'La ricerca a pagamento',
    paidSearchText:
      'Si accende in Collegamenti, insieme alla ricerca gratuita e alla chiave di Brave.',
    goToLinks: 'Vai a Collegamenti',
  },
};

export const modelsStrings = defineStrings({ en, it });
