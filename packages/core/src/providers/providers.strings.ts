import { pick } from '@monsters/shared';

/*
 * The texts a person reads from the models' side (D-153): setup errors of keys
 * and local servers, the subscriptions' messages and notices, and the services
 * connected through Claude.
 */

const en = {
  // keys and local servers
  unknownProvider: (id: string) => `Unknown provider: ${id}`,
  openRouterUnavailable: 'OpenRouter isn’t available',
  badLocalAddress: (label: string, message: string) => `${label}: invalid address (${message})`,
  noKey: (label: string) => `${label} doesn’t use a key`,
  keyFromEnv: (envVar: string) =>
    `The key comes from the environment variable ${envVar}: remove it from there.`,
  notLocal: (label: string) => `${label} isn’t a local server`,
  badAddress: 'Invalid address: use http://host:port',
  notConfigured: (label: string) => `${label} isn’t set up`,
  genericProvider: 'The provider',
  keyRefused: (label: string) => `${label} doesn’t recognize this key.`,
  creditOut: (label: string) => `${label}: the account is out of credit.`,
  localNotFound: (label: string) => `I can’t find ${label} at that address: is it running?`,
  cantVerify: (label: string) =>
    `I can’t verify with ${label}. Check your connection and try again.`,
  // subscriptions
  portFailed: (message: string) => `I can’t open the port the browser comes back to: ${message}`,
  chatgptConnected: 'ChatGPT connected: the monsters can use your plan.',
  signInCancelled: 'Sign-in cancelled in the browser.',
  chatgptIncomplete: (message: string) => `Signing in to ChatGPT didn’t complete (${message}).`,
  revokeUnconfirmed:
    'I couldn’t confirm the revocation with OpenAI: also disconnect Monsters in ChatGPT’s settings.',
  unknownSubscription: (id: string) => `Unknown subscription: ${id}`,
  codexNeedsChatgpt: 'Codex uses your ChatGPT sign-in: connect ChatGPT first.',
  programMissing: 'I can’t find the program: install it from here or on your computer.',
  installed: (spec: string, who: 'Codex' | 'Claude Agent') => `Installed ${spec} for ${who}.`,
  installFailed: (message: string) => `Installation failed: ${message}`,
  // services through Claude
  designLogin:
    'Sign-in needed for Claude Design: open `claude` in a terminal and type `/design-login`.',
  claudeCantConnect: (status: string) => `Claude can’t connect it (${status}).`,
  notViaClaude: (id: string) => `${id} doesn’t connect through Claude.`,
  claudeNoAnswer: 'Claude Code didn’t answer: try again in a moment.',
  noMonster: (name: string) => `no monster ${name}`,
  viaClaudeChanged: (name: string) => `${name} through Claude: who uses it changed.`,
  viaClaudeAdded: (name: string) =>
    `${name} through Claude: the monsters that work with Claude use it.`,
  viaClaudeRemoved: (name: string) =>
    `${name} no longer reaches the monsters through Claude. It stays connected to your Claude account.`,
};

const it: typeof en = {
  unknownProvider: (id) => `provider ${id} sconosciuto`,
  openRouterUnavailable: 'OpenRouter non disponibile',
  badLocalAddress: (label, message) => `${label}: indirizzo non valido (${message})`,
  noKey: (label) => `${label} non usa una chiave`,
  keyFromEnv: (envVar) => `La chiave arriva dalla variabile d'ambiente ${envVar}: toglila da lì.`,
  notLocal: (label) => `${label} non è un server locale`,
  badAddress: 'Indirizzo non valido: usa http://host:porta',
  notConfigured: (label) => `${label} non è configurato`,
  genericProvider: 'Il provider',
  keyRefused: (label) => `${label} non riconosce questa chiave.`,
  creditOut: (label) => `${label}: credito esaurito sull'account.`,
  localNotFound: (label) => `Non trovo ${label} a quell'indirizzo: è acceso?`,
  cantVerify: (label) =>
    `Non riesco a verificare con ${label}. Controlla la connessione e riprova.`,
  portFailed: (message) => `Non riesco ad aprire la porta del rientro dal browser: ${message}`,
  chatgptConnected: 'ChatGPT collegato: i mostri possono usare il tuo piano.',
  signInCancelled: 'Accesso annullato nel browser.',
  chatgptIncomplete: (message) => `Accesso a ChatGPT non completato (${message}).`,
  revokeUnconfirmed:
    'Non ho potuto confermare la revoca con OpenAI: scollega Monsters anche dalle impostazioni di ChatGPT.',
  unknownSubscription: (id) => `abbonamento ${id} sconosciuto`,
  codexNeedsChatgpt: 'Codex usa il tuo accesso a ChatGPT: collega prima ChatGPT.',
  programMissing: 'Non trovo il programma: installalo da qui o sul tuo computer.',
  installed: (spec, who) => `Installato ${spec} per ${who}.`,
  installFailed: (message) => `Installazione non riuscita: ${message}`,
  designLogin:
    'Serve l’accesso a Claude Design: in un terminale apri `claude` e scrivi `/design-login`.',
  claudeCantConnect: (status) => `Claude non riesce a collegarlo (${status}).`,
  notViaClaude: (id) => `${id} non si collega tramite Claude.`,
  claudeNoAnswer: 'Claude Code non ha risposto: riprova tra poco.',
  noMonster: (name) => `nessun mostro ${name}`,
  viaClaudeChanged: (name) => `${name} tramite Claude: cambiato chi lo usa.`,
  viaClaudeAdded: (name) => `${name} tramite Claude: lo usano i mostri che lavorano con Claude.`,
  viaClaudeRemoved: (name) =>
    `${name} non arriva più ai mostri tramite Claude. Resta collegato al tuo account Claude.`,
};

export const providerStrings = () => pick({ en, it });
