import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Models: the accounts, the plans, the main model and fallback, and in Advanced the chain of every monster (D-153). */

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
      'Not in the list: it’s used as typed. If it isn’t the exact name, pick one from the list.',
    listLabel: (label: string) => `Model list: ${label}`,
    none: 'No model with this name: I’ll use it as written (Other).',
    partial: (shown: number, total: number) => `${shown} of ${total} · type to search`,
    count: (n: number) => (n === 1 ? '1 model' : `${n} models`),
  },
  squad: {
    title: 'Which model they use',
    description: 'The same for all the monsters. Changes save automatically.',
    label: { main: 'Main model', fallback: 'If it doesn’t answer, use' },
    text: {
      main: 'What the monsters use first.',
      fallback: 'Used when the main model doesn’t answer or has run out of requests.',
    },
    accountOf: { main: 'Account of the main model', fallback: 'Account of the fallback model' },
    modelOf: { main: 'Main model', fallback: 'Fallback model' },
    notConnected: (label: string) => `${label} (not connected)`,
    addFallback: 'Add a fallback',
    removeFallback: 'Remove the fallback',
    more: (n: number) =>
      n === 1
        ? 'One more alternative is kept after these.'
        : `${n} more alternatives are kept after these.`,
    inAdvanced: 'Change in Advanced',
    different: 'Different for some monsters',
    automatic: 'Chosen for each request by Monsters, from your Claude plan.',
    noModels: (label: string) => `Couldn’t load the models of ${label}. Try again in a moment.`,
  },
  providers: {
    account: (label: string) => `${label} account`,
    about: {
      openrouter: 'Many models with a single key, some of them free.',
      anthropic: 'Claude models, with your API key.',
      openai: 'GPT models, with your API key.',
      google: 'Gemini models, with a Google AI Studio key.',
      mistral: 'Models from Mistral, a European company.',
      groq: 'Open models, very fast.',
      ollama:
        'Models on your own computer: free and private, but slower and less capable with tools.',
      lmstudio:
        'Models on your own computer: free and private, but slower and less capable with tools.',
    } as Record<string, string>,
    tag: {
      local: 'On your computer',
      payAsYouGoFree: 'Pay as you go, with a free plan',
      payAsYouGo: 'Pay as you go',
      free: 'Free with limits',
    },
    paidTitle: 'Paid.',
    paidText: (label: string, freeTier: boolean) =>
      `Every request from the monsters costs money, billed to your ${label} account. Monsters adds nothing on top and can’t see your costs.${
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
    base: { light: 'Quick', medium: 'Balanced', strong: 'Thorough' },
    autoLine: {
      usually: (name: string) => `Usually ${name}`,
      simple: (name: string) => `quick → ${name}`,
      hard: (name: string) => `thorough → ${name}`,
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
        'For each request, Monsters picks Sonnet or Opus from your Claude plan; Haiku when the base is Quick.',
      automaticLabel: (who: string) => `Automatic model choice for ${who}`,
      teamAuto:
        'Your lead and the monsters that work on the computer start from Thorough, the others from Balanced. Change it with “Choose for each monster”.',
      baseWord: 'Base',
      baseOf: (who: string) => `Base of ${who}`,
      needsExpert: 'Needs the expert model.',
      expertOff: 'Turned off in Monsters’ decisions.',
      needsExpertText: 'Without it, Automatic keeps its base.',
      expertLink: 'Open Monsters’ decisions',
      limitFallback: 'If Opus reaches the plan’s limit, the same request moves to Sonnet.',
      accountOf: (i: number, who: string) => `Account ${i} of ${who}`,
      notConnected: (label: string) => `${label} (not connected)`,
      modelOf: (i: number, who: string) => `Model ${i} of ${who}`,
      tierLight: 'For quick requests',
      tierStrong: 'For thorough requests',
      moveUp: (i: number, who: string) => `Move model ${i} of ${who} up`,
      remove: (i: number, who: string) => `Remove model ${i} of ${who}`,
      addAlternative: 'Add an alternative',
      partial: (saved: number, failed: string[], reason: string) =>
        `Saved for ${saved} ${saved === 1 ? 'monster' : 'monsters'}, but not for ${failed.join(', ')}: ${reason.replace(/[.\s]+$/, '')}. Each monster now shows its own models.`,
    },
    group: {
      different: 'The monsters use different models',
      same: 'Same for everyone',
      each: 'Choose for each monster',
      advancedHint:
        'A model for each monster, alternatives in order, Quick / Balanced / Thorough, Automatic.',
      description:
        'The first one is used: if it doesn’t answer or runs out of requests, the monster moves on to the next. Changes save automatically.',
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
    disconnect: 'Disconnect',
    disconnectQuestion: (label: string) => `Disconnect ${label}?`,
    disconnectConfirm: 'Yes, disconnect',
    freeOnly: 'Free only',
    alsoPaid: 'Also paid',
    keyActive: (name: string | undefined, env: string | undefined) =>
      `Key active${name ? ` (“${name}”)` : ''}${env !== undefined ? ', set outside the app' : ''}.`,
    close: 'Close',
    change: 'Change',
    key: 'Key',
    savedKeyHidden: 'The saved key isn’t shown again.',
    changeKey: 'Change key',
    changeAddress: 'Change address',
    connectedTo: (url: string) => `Connected to ${url}.`,
    connect: 'Connect',
    addKey: 'Add the key',
    what: 'the models',
    stale:
      'Couldn’t refresh the models. What you see may be out of date; what you’re typing is safe.',
    openrouterFirst: 'Many models with a single key, some of them free: the easiest way to start.',
    openrouterNone: 'No OpenRouter key (optional if you already have another model).',
    thinkWith: 'What the monsters think with',
    noModel: 'No model connected',
    noModelText: 'Without a model the monsters can’t think: add one below.',
    addModel: 'Add a model',
    subscriptionsText: 'The monsters use your plan, in the ways OpenAI and Anthropic allow.',
    accounts: 'Accounts',
    moreTitle: 'Other accounts and local models',
    moreText: 'Anthropic, OpenAI, Google, Mistral, Groq, Codex, Ollama, LM Studio.',
    keysOrLocal: 'With a key or on your computer',
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
  squad: {
    title: 'Quale modello usano',
    description: 'Lo stesso per tutti i mostri. Ogni cambio si salva da solo.',
    label: { main: 'Modello principale', fallback: 'Se non risponde, usa' },
    text: {
      main: 'Quello che i mostri usano per primo.',
      fallback: 'Si usa quando il modello principale non risponde o ha finito le richieste.',
    },
    accountOf: {
      main: 'Account del modello principale',
      fallback: 'Account del modello di riserva',
    },
    modelOf: { main: 'Modello principale', fallback: 'Modello di riserva' },
    notConnected: (label) => `${label} (non collegato)`,
    addFallback: 'Aggiungi un modello di riserva',
    removeFallback: 'Togli il modello di riserva',
    more: (n) =>
      n === 1
        ? 'Dopo questi resta un’altra alternativa.'
        : `Dopo questi restano altre ${n} alternative.`,
    inAdvanced: 'Cambia in Avanzate',
    different: 'Diverso per alcuni mostri',
    automatic: 'Lo sceglie Monsters a ogni richiesta, tra quelli del tuo piano Claude.',
    noModels: (label) => `Non riesco a caricare i modelli di ${label}. Riprova tra un attimo.`,
  },
  providers: {
    account: (label) => `account ${label}`,
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
    base: { light: 'Veloce', medium: 'Bilanciato', strong: 'Accurato' },
    autoLine: {
      usually: (name) => `Di solito ${name}`,
      simple: (name) => `veloce → ${name}`,
      hard: (name) => `accurato → ${name}`,
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
        'A ogni richiesta Monsters sceglie Sonnet o Opus del tuo piano Claude; Haiku se la base è Veloce.',
      automaticLabel: (who) => `Scelta automatica del modello per ${who}`,
      teamAuto:
        'Il tuo capo e chi lavora sul computer partono da Accurato, gli altri da Bilanciato. Lo cambi con “Scegli per ogni mostro”.',
      baseWord: 'Base',
      baseOf: (who) => `Base di ${who}`,
      needsExpert: 'Serve il modello esperto.',
      expertOff: 'Spento in Decisioni dei mostri.',
      needsExpertText: 'Senza, Automatica resta sulla sua base.',
      expertLink: 'Apri Decisioni dei mostri',
      limitFallback: 'Se Opus arriva al limite del piano, la stessa richiesta passa a Sonnet.',
      accountOf: (i, who) => `Account ${i} di ${who}`,
      notConnected: (label) => `${label} (non collegato)`,
      modelOf: (i, who) => `Modello ${i} di ${who}`,
      tierLight: 'Per le richieste veloci',
      tierStrong: 'Per le richieste accurate',
      moveUp: (i, who) => `Sposta su il modello ${i} di ${who}`,
      remove: (i, who) => `Togli il modello ${i} di ${who}`,
      addAlternative: 'Aggiungi un’alternativa',
      partial: (saved, failed, reason) =>
        `Salvato per ${saved} ${saved === 1 ? 'mostro' : 'mostri'}, ma non per ${failed.join(', ')}: ${reason.replace(/[.\s]+$/, '')}. Ora ogni mostro mostra i suoi modelli.`,
    },
    group: {
      different: 'I mostri usano modelli diversi',
      same: 'Uguale per tutti',
      each: 'Scegli per ogni mostro',
      advancedHint:
        'Un modello per ogni mostro, alternative in ordine, Veloce / Bilanciato / Accurato, Automatica.',
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
    disconnect: 'Scollega',
    disconnectQuestion: (label) => `Scollego ${label}?`,
    disconnectConfirm: 'Sì, scollega',
    freeOnly: 'Solo gratuiti',
    alsoPaid: 'Anche a pagamento',
    keyActive: (name, env) =>
      `Chiave attiva${name ? ` (“${name}”)` : ''}${env !== undefined ? ', impostata fuori dall’app' : ''}.`,
    close: 'Chiudi',
    change: 'Cambia',
    key: 'Chiave',
    savedKeyHidden: 'La chiave salvata non si mostra più.',
    changeKey: 'Cambia chiave',
    changeAddress: 'Cambia indirizzo',
    connectedTo: (url) => `Collegato a ${url}.`,
    connect: 'Collega',
    addKey: 'Aggiungi la chiave',
    what: 'i modelli',
    stale:
      'Impossibile aggiornare i modelli. Quello che vedi potrebbe essere vecchio; quello che stai scrivendo è al sicuro.',
    openrouterFirst:
      'Tanti modelli con una chiave sola, anche gratis: il modo più semplice per cominciare.',
    openrouterNone: 'Nessuna chiave OpenRouter (facoltativa se hai già un altro modello).',
    thinkWith: 'Con cosa pensano i mostri',
    noModel: 'Nessun modello collegato',
    noModelText: 'Senza un modello i mostri non possono pensare: aggiungine uno qui sotto.',
    addModel: 'Aggiungi un modello',
    subscriptionsText: 'I mostri usano il tuo piano, nei modi che OpenAI e Anthropic permettono.',
    accounts: 'Account',
    moreTitle: 'Altri account e modelli sul computer',
    moreText: 'Anthropic, OpenAI, Google, Mistral, Groq, Codex, Ollama, LM Studio.',
    keysOrLocal: 'Con una chiave o sul tuo computer',
  },
};

export const modelsStrings = defineStrings({ en, it });
