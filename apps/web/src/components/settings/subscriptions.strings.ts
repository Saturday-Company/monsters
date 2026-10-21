import { defineStrings } from '../../lib/i18n.ts';

/*
 * Settings → Models → subscriptions (D-153). The ChatGPT texts marked "OpenAI" are the wording
 * its sign-in guidelines ask for: the same in every language.
 */

const openai = {
  welcomeTitle: 'You’re using your ChatGPT plan',
  welcomeBefore: 'Eligible usage in this app uses your ChatGPT plan. Manage usage in your ',
  welcomeLink: 'ChatGPT settings',
  welcomeAfter: '.',
  gotIt: 'Got it',
  continue: 'Continue with ChatGPT',
  manageUsage: 'Manage usage',
  addTitle: 'Use your ChatGPT plan',
  addStatus:
    'Complete eligible AI requests in this app with usage included in your ChatGPT plan or credits balance.',
};

const en = {
  /** The license of an official package, from its id (the core sends `proprietary` or an SPDX id). */
  license: (id: string) => (id === 'proprietary' ? 'proprietary (Anthropic Commercial Terms)' : id),
  ...openai,
  planUsage: 'Plan usage',
  welcomeNote:
    'Monsters that use ChatGPT draw on your plan. You set the limit for Monsters in your ChatGPT settings.',
  chatgpt: {
    tag: 'Your plan',
    connected: (email: string | undefined) =>
      `Connected${email ? ` as ${email}` : ''}. The monsters you choose use your plan.`,
    disconnect: 'Disconnect',
    disconnectQuestion: 'Disconnect ChatGPT?',
    disconnectConfirm: 'Yes, disconnect',
    disconnected: 'ChatGPT disconnected.',
    addNote: 'Works with Plus and Pro. It’s separate from Monsters: you pay us nothing.',
    finish: 'Finish signing in, in your browser.',
    updates: 'This page updates by itself when you’re done.',
    reopen: 'Reopen the sign-in page',
    tunnel: 'Is Monsters running on another computer? First open the tunnel from yours: ',
    sshCommand: (port: number) => `ssh -L ${port}:127.0.0.1:${port} user@computer`,
  },
  claude: {
    terminalTitle: 'Open a terminal and run',
    terminalMid: ', then sign in with your subscription (',
    terminalAfter:
      '). Monsters never sees your credentials: when you’re done, press “Check again”.',
    ready: (version: string | undefined) =>
      `Ready: the monsters you choose work with Claude Code and your subscription${
        version ? ` (version ${version})` : ''
      }.`,
    apiKey:
      'Claude Code would use an API key: you’d pay as you go, not with the subscription. Run claude and sign in with your plan.',
    other: 'Claude Code uses another sign-in method that you set up.',
    notFound: 'I can’t find Claude Code anymore: reinstall it, or disconnect and connect again.',
    installing: 'Installing Anthropic’s component: it takes a few minutes…',
    missingLogin: 'Claude Code sign-in is missing.',
    checkAgain: 'Check again',
    disconnect: 'Disconnect',
    disconnectQuestion: 'Disconnect the Claude subscription?',
    disconnectConfirm: 'Yes, disconnect',
    addInstall: (name: string, version: string, license: string) =>
      `It uses Claude Code with your subscription. I can’t find it on this computer: you can install it yourself, or Monsters installs Anthropic’s official component (${name} ${version}, ${license} license).`,
    add: 'It uses Claude Code on the computer where Monsters runs, with your subscription. You do the sign-in yourself, in the terminal.',
    installingButton: 'Installing…',
    installAndConnect: 'Install and connect',
    connect: 'Connect',
  },
  codex: {
    tag: 'ChatGPT plan',
    installing: 'Installing Codex: it takes a few minutes…',
    ready: 'Ready: it uses your ChatGPT plan.',
    notInstalled: 'Codex isn’t installed yet.',
    disconnect: 'Disconnect',
    disconnectQuestion: 'Disconnect Codex?',
    disconnectConfirm: 'Yes, disconnect',
    needsChatgpt:
      'OpenAI’s agent that writes code and uses the computer, with the same ChatGPT sign-in. Connect ChatGPT first.',
    addInstall: (name: string, version: string, license: string) =>
      `OpenAI’s agent that writes code and uses the computer. Monsters installs the official program (${name} ${version}, ${license} license, about 450 MB) only if you ask.`,
    add: 'OpenAI’s agent that writes code and uses the computer, with your ChatGPT sign-in.',
    installingButton: 'Installing…',
    installAndConnect: 'Install and connect',
    connect: 'Connect',
  },
};

const it: typeof en = {
  license: (id) => (id === 'proprietary' ? 'proprietaria (Anthropic Commercial Terms)' : id),
  ...openai,
  planUsage: 'Utilizzo del piano',
  welcomeNote:
    'I mostri che usano ChatGPT consumano il tuo piano. Il limite per Monsters lo scegli tu nelle impostazioni di ChatGPT.',
  chatgpt: {
    tag: 'Il tuo piano',
    connected: (email) =>
      `Collegato${email ? ` come ${email}` : ''}. I mostri che scegli usano il tuo piano.`,
    disconnect: 'Scollega',
    disconnectQuestion: 'Scollego ChatGPT?',
    disconnectConfirm: 'Sì, scollega',
    disconnected: 'ChatGPT scollegato.',
    addNote: 'Funziona con Plus e Pro ed è separato da Monsters: a noi non paghi niente.',
    finish: 'Completa l’accesso nel browser.',
    updates: 'Questa pagina si aggiorna da sola quando hai finito.',
    reopen: 'Riapri la pagina di accesso',
    tunnel: 'Monsters gira su un altro computer? Prima apri il tunnel dal tuo: ',
    sshCommand: (port) => `ssh -L ${port}:127.0.0.1:${port} utente@computer`,
  },
  claude: {
    terminalTitle: 'Apri un terminale ed esegui',
    terminalMid: ', poi accedi con il tuo abbonamento (',
    terminalAfter:
      '). Monsters non vede mai le tue credenziali: quando hai finito, premi «Ricontrolla».',
    ready: (version) =>
      `Pronto: i mostri che scegli lavorano con Claude Code e il tuo abbonamento${
        version ? ` (versione ${version})` : ''
      }.`,
    apiKey:
      'Claude Code userebbe una chiave API: pagheresti a consumo, non con l’abbonamento. Esegui claude e accedi con il tuo piano.',
    other: 'Claude Code usa un altro metodo di accesso che hai impostato tu.',
    notFound: 'Non trovo più Claude Code: reinstallalo, oppure scollega e collega di nuovo.',
    installing: 'Installo il componente di Anthropic, ci vuole qualche minuto…',
    missingLogin: 'Manca l’accesso a Claude Code.',
    checkAgain: 'Ricontrolla',
    disconnect: 'Scollega',
    disconnectQuestion: 'Scollego l’abbonamento Claude?',
    disconnectConfirm: 'Sì, scollega',
    addInstall: (name, version, license) =>
      `Usa Claude Code col tuo abbonamento. Non lo trovo su questo computer: puoi installarlo tu, oppure Monsters installa il componente ufficiale di Anthropic (${name} ${version}, licenza ${license}).`,
    add: 'Usa Claude Code sul computer dove gira Monsters, col tuo abbonamento. L’accesso lo fai tu, nel terminale.',
    installingButton: 'Installo…',
    installAndConnect: 'Installa e collega',
    connect: 'Collega',
  },
  codex: {
    tag: 'Piano ChatGPT',
    installing: 'Installo Codex, ci vuole qualche minuto…',
    ready: 'Pronto: usa il tuo piano ChatGPT.',
    notInstalled: 'Codex non è ancora installato.',
    disconnect: 'Scollega',
    disconnectQuestion: 'Scollego Codex?',
    disconnectConfirm: 'Sì, scollega',
    needsChatgpt:
      'L’agente di OpenAI che scrive codice e usa il computer, con lo stesso accesso a ChatGPT. Collega prima ChatGPT.',
    addInstall: (name, version, license) =>
      `L’agente di OpenAI che scrive codice e usa il computer. Monsters installa il programma ufficiale (${name} ${version}, licenza ${license}, circa 450 MB) solo se lo chiedi tu.`,
    add: 'L’agente di OpenAI che scrive codice e usa il computer, con il tuo accesso a ChatGPT.',
    installingButton: 'Installo…',
    installAndConnect: 'Installa e collega',
    connect: 'Collega',
  },
};

export const subscriptionsStrings = defineStrings({ en, it });
