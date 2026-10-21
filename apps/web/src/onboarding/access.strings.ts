import type { OnboardingAccess } from '@monsters/shared';
import { defineStrings } from '../lib/i18n.ts';

/* First start, step 1: how Monsters reaches a model (D-153). */

const en = {
  ways: {
    'claude-agent': {
      title: 'Claude subscription',
      text: 'With Claude Code and your plan, on the computer where Monsters runs.',
      done: 'Claude Code and your subscription',
    },
    chatgpt: {
      title: 'ChatGPT plan',
      text: 'Plus or Pro: sign in with your OpenAI account.',
      done: 'your ChatGPT plan',
    },
    openrouter: {
      title: 'Free models',
      text: 'With an OpenRouter key. Free, with a daily limit on requests.',
      done: 'OpenRouter’s free models',
    },
  } satisfies Record<OnboardingAccess, { title: string; text: string; done: string }>,
  connected: 'Connected',
  checking: 'Checking…',
  oneMoment: 'One moment…',
  verifySave: 'Verify and save',
  verifyContinue: 'Verify and continue',
  offerTitle: (label: string) => `This is a ${label} key: shall I use it for the monsters?`,
  offerText: (label: string) =>
    `It’s paid: you pay ${label} for the costs, depending on how much they work.`,
  offerYes: 'Yes, use it',
  offerNo: 'No',
  openrouter: {
    ready: 'Key verified: the monsters use the free models.',
    openBefore: 'Open ',
    openAfter: ', sign in, press “Create API key” and paste the key here: I’ll check it.',
    keyLabel: 'Your OpenRouter key',
    keyHint: 'It stays on this computer, protected: only Monsters reads it.',
    keyUnknown: 'Paste the whole key: it starts with “sk-or-”.',
    freeTitle: 'Free, with a limit:',
    freeText: (topUp: string) =>
      `50 requests a day, 1,000 after a one-time top-up of about ${topUp}. Some free models may use what you write to improve themselves: don’t give them sensitive data.`,
  },
  claude: {
    readySubscription: (version: string | undefined) =>
      `Claude Code is ready with your subscription${version ? ` (version ${version})` : ''}.`,
    readyOther: 'Claude Code is ready, with the sign-in method you set up yourself.',
    recheck: 'Check again',
    introBefore: 'Monsters uses Claude Code installed',
    introStrong: 'on the computer where Monsters runs',
    introAfter:
      '(if you use it from another computer, that’s the remote one). You sign in to Claude yourself, in the terminal: Monsters never sees your credentials.',
    installing: 'Installing Anthropic’s component, it takes a few minutes…',
    notFound: (name: string, version: string, license: string) =>
      `I can’t find Claude Code on that computer. You can install it yourself, or let Monsters install Anthropic’s official component (${name} ${version}, ${license} license).`,
    install: 'Install and use Claude Code',
    use: 'Use Claude Code',
    apiKeyBefore:
      'Claude Code would use an API key: you’d pay per use, not with the subscription. Run',
    apiKeyAfter: 'and sign in with your plan.',
    lostIt:
      'I can’t find Claude Code on that computer any more: install it and press “Check again”.',
    terminalStrong: 'On the computer where Monsters runs, open a terminal and run',
    terminalMid: ', then sign in with your subscription (',
    terminalAfter: '). I’ll notice by myself, or press “Check again”.',
  },
  chatgpt: {
    connected: (email: string | undefined) =>
      `ChatGPT connected${email ? ` as ${email}` : ''}: the monsters use your plan.`,
    works:
      'Works with the Plus and Pro plans. Sign-in opens in the browser; you pay Monsters nothing.',
    finish: 'Finish signing in in the browser: I’ll notice by myself.',
    reopen: 'Reopen the sign-in page',
    tunnel: 'Is Monsters running on another computer? First open the tunnel from yours:',
    sshTarget: 'user@computer',
  },
  doneModelsOf: (label: string) => `the ${label} models`,
  guide: {
    done: (way: string) => `Done! Now I think with ${way}.`,
    ask: 'Hi! I need a model to think. How do I reach one?',
    hint: 'One is enough. You can add the others whenever you like.',
  },
  waysLabel: 'How I reach a model',
  subsFailed: 'I can’t read the subscriptions. Try again in a moment.',
  looking: 'Checking what’s on that computer…',
  other: {
    verified: (label: string) => `${label} key verified: the monsters will use its models, paid.`,
    text: 'Do you already have an Anthropic, OpenAI, Google or Groq key? Paste it here: I recognise it by its start. They’re paid, with the costs on you.',
    keyLabel: 'Your key',
    unknown: 'I don’t recognise this key: it usually starts with sk-ant-, sk-, AIza or gsk_.',
    noteBefore:
      'Mistral, or a model on your computer with Ollama or LM Studio: finish the first start and add them in',
    noteStrong: 'Settings → Models',
    noteAfter: ', along with each monster’s model. You’ll find Codex there too.',
    otherWays: 'Other ways',
  },
  later: 'I’ll do it later',
  next: 'Continue',
};

const it: typeof en = {
  ways: {
    'claude-agent': {
      title: 'Abbonamento Claude',
      text: 'Con Claude Code e il tuo piano, sul computer dove gira Monsters.',
      done: 'Claude Code e il tuo abbonamento',
    },
    chatgpt: {
      title: 'Piano ChatGPT',
      text: 'Plus o Pro: accedi con il tuo account di OpenAI.',
      done: 'il tuo piano ChatGPT',
    },
    openrouter: {
      title: 'Modelli gratuiti',
      text: 'Con una chiave di OpenRouter. Gratis, con un limite di richieste al giorno.',
      done: 'i modelli gratuiti di OpenRouter',
    },
  },
  connected: 'Collegato',
  checking: 'Controllo…',
  oneMoment: 'Un attimo…',
  verifySave: 'Verifica e salva',
  verifyContinue: 'Verifica e continua',
  offerTitle: (label) => `Questa è una chiave di ${label}: la uso per i mostri?`,
  offerText: (label) => `È a pagamento: i costi li paghi tu a ${label}, in base a quanto lavorano.`,
  offerYes: 'Sì, usala',
  offerNo: 'No',
  openrouter: {
    ready: 'Chiave verificata: i mostri usano i modelli gratuiti.',
    openBefore: 'Apri ',
    openAfter: ', entra, premi “Create API key” e incolla qui la chiave: la controllo io.',
    keyLabel: 'La tua chiave di OpenRouter',
    keyHint: 'Resta su questo computer, protetta: la legge solo Monsters.',
    keyUnknown: 'Incolla la chiave completa: inizia con “sk-or-”.',
    freeTitle: 'Gratis, con un limite:',
    freeText: (topUp) =>
      `50 richieste al giorno, 1.000 dopo una ricarica una tantum di circa ${topUp}. Alcuni modelli gratuiti possono usare quello che scrivi per migliorarsi: non dargli dati delicati.`,
  },
  claude: {
    readySubscription: (version) =>
      `Claude Code è pronto con il tuo abbonamento${version ? ` (versione ${version})` : ''}.`,
    readyOther: 'Claude Code è pronto, con il metodo di accesso che hai impostato tu.',
    recheck: 'Ricontrolla',
    introBefore: 'Monsters usa Claude Code installato',
    introStrong: 'sul computer dove gira Monsters',
    introAfter:
      '(se lo usi da un altro computer, è quello remoto). L’accesso a Claude lo fai tu, nel terminale: Monsters non vede mai le tue credenziali.',
    installing: 'Installo il componente di Anthropic, ci vuole qualche minuto…',
    notFound: (name, version, license) =>
      `Non trovo Claude Code su quel computer. Puoi installarlo tu, oppure lascio che Monsters installi il componente ufficiale di Anthropic (${name} ${version}, licenza ${license}).`,
    install: 'Installa e usa Claude Code',
    use: 'Usa Claude Code',
    apiKeyBefore:
      'Claude Code userebbe una chiave API: pagheresti a consumo, non con l’abbonamento. Esegui',
    apiKeyAfter: 'e accedi con il tuo piano.',
    lostIt: 'Non trovo più Claude Code su quel computer: installalo e premi «Ricontrolla».',
    terminalStrong: 'Sul computer dove gira Monsters apri un terminale ed esegui',
    terminalMid: ', poi accedi con il tuo abbonamento (',
    terminalAfter: '). Me ne accorgo da solo, oppure premi «Ricontrolla».',
  },
  chatgpt: {
    connected: (email) =>
      `ChatGPT collegato${email ? ` come ${email}` : ''}: i mostri usano il tuo piano.`,
    works:
      'Funziona con i piani Plus e Pro. L’accesso si apre nel browser; a Monsters non paghi niente.',
    finish: 'Completa l’accesso nel browser: me ne accorgo da solo.',
    reopen: 'Riapri la pagina di accesso',
    tunnel: 'Monsters gira su un altro computer? Prima apri il tunnel dal tuo:',
    sshTarget: 'utente@computer',
  },
  doneModelsOf: (label) => `i modelli di ${label}`,
  guide: {
    done: (way) => `Fatto! Adesso penso con ${way}.`,
    ask: 'Ciao! Per pensare mi serve un modello. Come lo raggiungo?',
    hint: 'Ne basta uno. Gli altri li aggiungi quando vuoi.',
  },
  waysLabel: 'Come raggiungo un modello',
  subsFailed: 'Non riesco a leggere gli abbonamenti. Riprova tra poco.',
  looking: 'Guardo cosa c’è su quel computer…',
  other: {
    verified: (label) =>
      `Chiave di ${label} verificata: i mostri useranno i suoi modelli, a pagamento.`,
    text: 'Hai già una chiave di Anthropic, OpenAI, Google o Groq? Incollala qui: la riconosco dall’inizio. Sono a pagamento, con i costi a tuo carico.',
    keyLabel: 'La tua chiave',
    unknown: 'Non riconosco questa chiave: di solito inizia con sk-ant-, sk-, AIza o gsk_.',
    noteBefore:
      'Mistral, o un modello sul tuo computer con Ollama o LM Studio: finisci il primo avvio e li aggiungi in',
    noteStrong: 'Impostazioni → Modelli',
    noteAfter: ', con il modello di ogni mostro. Lì trovi anche Codex.',
    otherWays: 'Altri modi',
  },
  later: 'Lo faccio dopo',
  next: 'Continua',
};

export const accessStrings = defineStrings({ en, it });
