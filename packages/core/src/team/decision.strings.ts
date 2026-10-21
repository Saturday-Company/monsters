import { pick } from '@monsters/shared';

/*
 * The reasons of the gate's decisions, the errors of the engine and of Jev (D-153): what
 * Activity shows and what the settings answer. The gate's prompts and the word lists that
 * read the questions are not here.
 */

const en = {
  // --- notifications
  notifyOff: 'notifications of this kind are off',
  notifyUserActive: 'the user is using the channel',
  notifyOutsideQuiet: 'outside quiet hours',
  notifyQuietBlocking: 'quiet hours, but the work is waiting for the answer',
  notifyQuietLater: 'quiet hours: it arrives in the morning',
  notifyQuestion: (kind: string) => `Notify now or later? (${kind})`,
  // --- ask or go ahead
  openQuestion: 'open question: the user answers',
  askAlways: (rule: string, inferred: string | undefined) =>
    `always ask: ${rule}${inferred ? ` (inferred kind: ${inferred})` : ''}`,
  proceedRule: (rule: string) => `going ahead: ${rule}`,
  grayNoModel: 'gray area without a model: asking',
  modelNoAnswer: (code: string) => `the model didn’t answer (${code}): asking`,
  grayTrial: 'gray area: asking (instinct on trial)',
  fallback: (reason: string, codes: string) => `${reason} (fallback: ${codes})`,
  classifiedAs: (kind: string) => `the model classifies it as ${kind}`,
  needsUser: 'the model thinks the user is needed',
  belowThreshold: (confidence: string, threshold: number) =>
    `confidence ${confidence} below the threshold ${threshold}`,
  noOptionUnsure: 'no recommended option and the model isn’t sure enough',
  reversibleSure: 'reversible choice, the model is sure',
  jevAbove: (p: string, max: number) => `p ${p} above Jev’s threshold ${max}`,
  noOptionOrder:
    'no recommended option and the model changes its choice with the order of the options',
  reversibleSameOption: 'reversible choice, the model picks the same option in both orders',
  pickedRecommended: 'picked the recommended option',
  pickedOther: 'picked a different option from the recommended one',
  noAnswerWithin: (s: number) => `no answer within ${s} s`,
  noAnswerWithinMs: (ms: number) => `no answer within ${ms} ms`,
  // --- the engine
  noKey: 'To use the expert model you need a TypeSafe key first.',
  noMode: (label: string, mode: string) => `“${label}” doesn’t have the ${mode} mode.`,
  keyFromEnv: (env: string) => `The key comes from ${env}: remove it from there.`,
  // --- Jev
  jevNoKey: 'no TypeSafe key',
  jevTimeout: (ms: number) => `Jev didn’t answer within ${ms} ms`,
  jevNetwork: (name: string) => `Can’t reach Jev (${name})`,
  jevUnreadable: 'Jev’s answer isn’t readable',
  jevInvalid: (message: string) => `Jev’s answer isn’t valid: ${message}`,
  jevKeyRejected: (status: number) => `TypeSafe key rejected (${status})`,
  jevNoCredit: (suffix: string) => `TypeSafe credit is over (402)${suffix}`,
  jevRejected: (status: number, suffix: string) => `request rejected by Jev (${status})${suffix}`,
  jevRateLimit: 'Jev’s request limit (429)',
  jevOverloaded: 'Jev is overloaded (529)',
  jevError: (status: number, suffix: string) => `Jev error (${status})${suffix}`,
  tsNetwork: (name: string) => `Can’t reach TypeSafe (${name})`,
  tsUnknownKey: 'TypeSafe doesn’t recognize this key.',
  tsUnexpected: (status: number) => `unexpected answer from TypeSafe (${status})`,
};

const it: typeof en = {
  notifyOff: 'notifiche di questo tipo spente',
  notifyUserActive: 'l’utente sta usando il canale',
  notifyOutsideQuiet: 'fuori dalle ore di silenzio',
  notifyQuietBlocking: 'ore di silenzio, ma il lavoro aspetta la risposta',
  notifyQuietLater: 'ore di silenzio: arriva al risveglio',
  notifyQuestion: (kind) => `Notifico ora o dopo? (${kind})`,
  openQuestion: 'domanda aperta: risponde l’utente',
  askAlways: (rule, inferred) =>
    `chiedere sempre: ${rule}${inferred ? ` (tipo dedotto: ${inferred})` : ''}`,
  proceedRule: (rule) => `si procede: ${rule}`,
  grayNoModel: 'zona grigia senza modello: si chiede',
  modelNoAnswer: (code) => `il modello non ha risposto (${code}): si chiede`,
  grayTrial: 'zona grigia: si chiede (istinto in prova)',
  fallback: (reason, codes) => `${reason} (ripiego: ${codes})`,
  classifiedAs: (kind) => `il modello la classifica come ${kind}`,
  needsUser: 'il modello ritiene che serva l’utente',
  belowThreshold: (confidence, threshold) =>
    `confidenza ${confidence} sotto la soglia ${threshold}`,
  noOptionUnsure: 'nessuna opzione consigliata e il modello non è abbastanza sicuro',
  reversibleSure: 'scelta reversibile, il modello è sicuro',
  jevAbove: (p, max) => `p ${p} sopra la soglia di Jev ${max}`,
  noOptionOrder:
    'nessuna opzione consigliata e il modello cambia scelta con l’ordine delle opzioni',
  reversibleSameOption:
    'scelta reversibile, il modello sceglie la stessa opzione in entrambi gli ordini',
  pickedRecommended: 'scelta l’opzione consigliata',
  pickedOther: 'scelta diversa dalla consigliata',
  noAnswerWithin: (s) => `nessuna risposta entro ${s} s`,
  noAnswerWithinMs: (ms) => `nessuna risposta entro ${ms} ms`,
  noKey: 'Per usare il modello esperto serve prima la chiave di TypeSafe.',
  noMode: (label, mode) => `«${label}» non ha la modalità ${mode}.`,
  keyFromEnv: (env) => `La chiave viene da ${env}: toglila da lì.`,
  jevNoKey: 'nessuna chiave TypeSafe',
  jevTimeout: (ms) => `Jev non ha risposto entro ${ms} ms`,
  jevNetwork: (name) => `Jev non raggiungibile (${name})`,
  jevUnreadable: 'risposta di Jev non leggibile',
  jevInvalid: (message) => `risposta di Jev non valida: ${message}`,
  jevKeyRejected: (status) => `chiave TypeSafe rifiutata (${status})`,
  jevNoCredit: (suffix) => `credito TypeSafe finito (402)${suffix}`,
  jevRejected: (status, suffix) => `richiesta rifiutata da Jev (${status})${suffix}`,
  jevRateLimit: 'limite di richieste di Jev (429)',
  jevOverloaded: 'Jev è sovraccarico (529)',
  jevError: (status, suffix) => `errore di Jev (${status})${suffix}`,
  tsNetwork: (name) => `TypeSafe non raggiungibile (${name})`,
  tsUnknownKey: 'TypeSafe non riconosce questa chiave.',
  tsUnexpected: (status) => `risposta inattesa di TypeSafe (${status})`,
};

export const decisionStrings = () => pick({ en, it });
