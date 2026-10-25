import { pick, formatList } from '@monsters/shared';

/*
 * The texts the hub writes for a person (D-153): notices in Activity, the
 * messages of the keychain, the spending cap, the instinct's lines, the
 * sources shown on a draft that came after third-party text. What the hub
 * hands to the models (tool results, folder refusals, notes of a run) stays
 * where it is until the prompts move (wave 3).
 */

const en = {
  // keychain and keys
  secretsFallback: (reason: string, detail: string | undefined) =>
    `keychain not used (${reason}${detail ? `: ${detail}` : ''}): keys saved in protected files`,
  secretsQuarantined: (names: string) =>
    `the keychain no longer has the key of: ${names}; they were set aside and have to be entered again`,
  secretsUnreadable: (names: string) => `saved keys that can’t be read: ${names}`,
  openRouterRefused: 'OpenRouter doesn’t recognize this key.',
  openRouterUnverified:
    'I can’t verify the key with OpenRouter. Check your connection and try again.',
  // subscriptions and models
  movedToPlan: (names: readonly string[], all: boolean, plan: string) =>
    `Now ${all ? 'all the monsters work' : `${formatList(names)} ${names.length === 1 ? 'works' : 'work'}`} with your ${plan} plan. You can change it in Settings → Models.`,
  noModel: 'This monster has no model yet: connect one in Settings → Models.',
  // the spending cap
  spendStop: (name: string, capped: string, path: string, _inProject: boolean) =>
    `${name} stops: ${capped}. To let it continue, raise the cap (${path}).`,
  // the instinct
  tier: (own: boolean, level: 'simple' | 'medium' | 'hard', name: string, model: string) =>
    `${{ simple: 'Simple', medium: 'Medium', hard: 'Hard' }[level]} ${own ? 'task' : 'request'}: ${name} uses ${model}.`,
  accessLinesSkipped: (name: string, n: number) =>
    `I didn’t add ${n === 1 ? 'a line' : `${n} lines`} about access to ${name}’s memory: Monsters tells it its permissions and connections on every task.`,
  webToolsWait: (name: string) =>
    `For this request, ${name}’s web tools are on hold: it loads them with tools_search if it needs them.`,
  receiptFailed: (message: string) => `receipt not written: ${message}`,
  onlyMainBot: (name: string) => `${name} only speaks from the main bot.`,
  strangerRequest: (name: string) =>
    `request from ${name || 'a person'} on Telegram, not from the user`,
  messageFrom: (name: string) => `message from ${name}`,
  // why a reply to a chat with other people is held ("it …", a verb phrase)
  replyPrivate: 'repeats a private note',
  replyProfile: 'repeats the monster’s memory or your profile',
  replyNotes: 'repeats long pieces of the notes',
  // where a draft's taint comes from
  thirdPartyText: 'third-party text',
  telegramGroup: 'written in a Telegram group',
  projectDocsChanged: 'project folder instructions changed',
  automationAfter: (name: string) => `automation proposed by ${name} after third-party text`,
  projectReport: 'a project’s report',
  recentConversation: 'recent conversation',
  conversationSummary: 'conversation summary',
  profileAfter: 'profile written after third-party text',
  memoryAfter: 'memory written after third-party text',
  memoryOfAfter: (name: string) => `${name}’s memory written after third-party text`,
};

const it: typeof en = {
  secretsFallback: (reason, detail) =>
    `portachiavi non usato (${reason}${detail ? `: ${detail}` : ''}): chiavi salvate in file protetti`,
  secretsQuarantined: (names) =>
    `il portachiavi non ha più la chiave di: ${names}; messe da parte, vanno reinserite`,
  secretsUnreadable: (names) => `chiavi salvate ma non leggibili: ${names}`,
  openRouterRefused: 'OpenRouter non riconosce questa chiave.',
  openRouterUnverified:
    'Non riesco a verificare la chiave con OpenRouter. Controlla la connessione e riprova.',
  movedToPlan: (names, all, plan) =>
    `Ora ${all ? 'tutti i mostri' : names.join(', ')} ${names.length === 1 ? 'lavora' : 'lavorano'} con il tuo piano ${plan}. Lo cambi in Impostazioni → Modelli.`,
  noModel: 'Questo mostro non ha ancora un modello: collegane uno in Impostazioni → Modelli.',
  spendStop: (name, capped, path, inProject) =>
    `${name} si ferma: ${capped}. Per farlo continuare alza il tetto ${inProject ? 'nella' : 'in'} ${path}.`,
  tier: (own, level, name, model) =>
    `${own ? 'Incarico' : 'Richiesta'} ${
      own
        ? { simple: 'semplice', medium: 'medio', hard: 'difficile' }[level]
        : { simple: 'semplice', medium: 'media', hard: 'difficile' }[level]
    }: ${name} usa ${model}.`,
  accessLinesSkipped: (name, n) =>
    `Non ho aggiunto alla memoria di ${name} ${n === 1 ? 'una riga sui suoi accessi' : `${n} righe sui suoi accessi`}: permessi e collegamenti glieli dice Monsters a ogni lavoro.`,
  webToolsWait: (name) =>
    `Per questa richiesta gli strumenti del web di ${name} aspettano: li carica con tools_search se servono.`,
  receiptFailed: (message) => `ricevuta non scritta: ${message}`,
  onlyMainBot: (name) => `${name} parla solo dal bot principale.`,
  strangerRequest: (name) => `richiesta di ${name || 'una persona'} su Telegram, non dell’utente`,
  messageFrom: (name) => `messaggio di ${name}`,
  replyPrivate: 'ripete una nota privata',
  replyProfile: 'ripete la memoria del mostro o il tuo profilo',
  replyNotes: 'ripete pezzi lunghi delle note',
  thirdPartyText: 'testo di terzi',
  telegramGroup: 'scritte in un gruppo di Telegram',
  projectDocsChanged: 'istruzioni della cartella del progetto cambiate',
  automationAfter: (name) => `automazione proposta da ${name} dopo testo di terzi`,
  projectReport: 'rapporto di un progetto',
  recentConversation: 'conversazione recente',
  conversationSummary: 'riassunto della conversazione',
  profileAfter: 'profilo scritto dopo testo di terzi',
  memoryAfter: 'memoria scritta dopo testo di terzi',
  memoryOfAfter: (name) => `memoria di ${name} scritta dopo testo di terzi`,
};

export const hubStrings = () => pick({ en, it });
