import { pick } from '@monsters/shared';

/*
 * What a job of a monster says to the person when it stops, falls back or fails (D-153):
 * the lines of Activity written by the run loop. The reminders and notes the model reads
 * (`[Promemoria del sistema]`, the final step note) are not here.
 */

const en = {
  fallbackReason: {
    auth: 'invalid key',
    quota: 'credit used up',
    rate_limit: 'request limit',
    context: 'context too long',
    model_gone: 'model not available',
    unavailable: 'unreachable',
    bad_request: 'request refused',
    aborted: 'interrupted',
    subscription: 'ChatGPT plan, no automatic switch',
    empty: 'empty answer',
    paid_blocked: 'paid model not turned on',
  },
  fallbackLine: (from: string, to: string | undefined, reason: string, error: string) =>
    `${from} → ${to ?? 'none'} (${reason}): ${error}`,
  stopScope: {
    global: 'you stopped all the monsters',
    agent: 'you stopped this monster',
    run: 'you stopped this job',
    tool: 'you stopped a tool',
  } as Record<string, string>,
  aborted: (name: string, why: string | undefined) =>
    `${name}’s job stopped${why ? `: ${why}` : ''}`,
  contextAlmostFull: (name: string, tokens: number, window: number, keep: number) =>
    `Context almost full for ${name} (~${tokens} tokens of ${window}): I’m dropping old results from the context, the ones from the last ${keep} steps stay whole`,
  contextStillFull: (name: string, tokens: number, window: number) =>
    `Context still full for ${name} (~${tokens} tokens of ${window}): I’m summing up the steps so far in one message`,
  contextRescue: (model: string) =>
    `${model} refused the request, too long for its context: I’m summing up the steps so far and trying the same model again`,
  noStart: (name: string, limit: string) => `${name} doesn’t start: ${limit}`,
  theModel: 'The model',
  streamBroke: (from: string, error: string) =>
    `${from} stopped halfway through its answer (${error}): trying the same step again`,
  errorStreak: (name: string, count: number, moved: boolean) =>
    `${name}: ${count} tool errors in a row${moved ? ', trying the next model' : ''}`,
  emptyAnswerRetry: (from: string, echoed: boolean, other: boolean) =>
    `${from} gave an empty answer${echoed ? ' (it only repeated the request)' : ''}: ${other ? 'trying the next model' : 'trying again'}`,
  answerTruncated: (name: string) =>
    `${name}’s answer was cut: the model reached its maximum length`,
  truncatedNote:
    '[The answer stops here: the model reached its maximum length. Type “continue” for the rest.]',
  emptyFailed: (name: string, echoed: boolean, retried: boolean) =>
    `${name} didn’t give an answer: the model answered ${echoed ? 'only repeating the request' : 'with no text'}${retried ? ', even on the new attempts' : ''}. Try again, or pick another model in Settings → Models.`,
  emptyFailedChain: (name: string) =>
    `${name} didn’t give an answer: the model answered empty again on the new attempt and with the other models of the chain. Try again in a moment, or pick another model in Settings → Models.`,
  maxSteps: (name: string, n: number) => `${name} used all ${n} steps without finishing`,
  extraSteps: (name: string) => `${name} used the extra steps without finishing`,
  stops: (name: string, why: string) => `${name} stops: ${why}`,
  taskLimit: 'task limit reached',
  tokenLimit: (name: string, n: number) => `${name} went over the limit of ${n} tokens`,
  reportAtLastStep: ' (report written at the last step)',
};

const it: typeof en = {
  fallbackReason: {
    auth: 'chiave non valida',
    quota: 'credito esaurito',
    rate_limit: 'limite di richieste',
    context: 'contesto troppo lungo',
    model_gone: 'modello non disponibile',
    unavailable: 'non raggiungibile',
    bad_request: 'richiesta rifiutata',
    aborted: 'interrotto',
    subscription: 'piano ChatGPT, nessun cambio automatico',
    empty: 'risposta vuota',
    paid_blocked: 'modello a pagamento non attivo',
  },
  fallbackLine: (from, to, reason, error) => `${from} → ${to ?? 'nessuno'} (${reason}): ${error}`,
  stopScope: {
    global: 'hai fermato tutti i mostri',
    agent: 'hai fermato questo mostro',
    run: 'hai fermato questo lavoro',
    tool: 'hai fermato uno strumento',
  },
  aborted: (name, why) => `Il lavoro di ${name} si è fermato${why ? `: ${why}` : ''}`,
  contextAlmostFull: (name, tokens, window, keep) =>
    `Contesto quasi pieno per ${name} (~${tokens} token su ${window}): tolgo dal contesto i risultati vecchi, restano interi quelli degli ultimi ${keep} passi`,
  contextStillFull: (name, tokens, window) =>
    `Contesto ancora pieno per ${name} (~${tokens} token su ${window}): riassumo i passi fatti finora in un messaggio`,
  contextRescue: (model) =>
    `${model} ha rifiutato la richiesta, troppo lunga per il suo contesto: riassumo i passi fatti e riprovo lo stesso modello`,
  noStart: (name, limit) => `${name} non parte: ${limit}`,
  theModel: 'Il modello',
  streamBroke: (from, error) =>
    `${from} si è interrotto a metà risposta (${error}): riprovo lo stesso passo`,
  errorStreak: (name, count, moved) =>
    `${name}: ${count} errori di fila negli strumenti${moved ? ', provo il modello successivo' : ''}`,
  emptyAnswerRetry: (from, echoed, other) =>
    `${from} ha dato una risposta vuota${echoed ? ' (ha solo ripetuto la richiesta)' : ''}: ${other ? 'provo il modello successivo' : 'nuovo tentativo'}`,
  answerTruncated: (name) =>
    `La risposta di ${name} è stata tagliata: il modello è arrivato alla lunghezza massima`,
  truncatedNote:
    '[La risposta si interrompe qui: il modello è arrivato alla lunghezza massima. Scrivi «continua» per il resto.]',
  emptyFailed: (name, echoed, retried) =>
    `${name} non ha dato una risposta: il modello ha risposto ${echoed ? 'ripetendo solo la richiesta' : 'senza testo'}${retried ? ', anche ai nuovi tentativi' : ''}. Riprova, o scegli un altro modello in Impostazioni → Modelli.`,
  emptyFailedChain: (name) =>
    `${name} non ha dato una risposta: il modello ha risposto vuoto anche al nuovo tentativo e con gli altri modelli della catena. Riprova tra poco, o scegli un altro modello in Impostazioni → Modelli.`,
  maxSteps: (name, n) => `${name} ha finito i ${n} passi senza concludere`,
  extraSteps: (name) => `${name} ha finito i passi in più senza concludere`,
  stops: (name, why) => `${name} si ferma: ${why}`,
  taskLimit: 'limite del compito raggiunto',
  tokenLimit: (name, n) => `${name} ha superato il limite di ${n} token`,
  reportAtLastStep: ' (rapporto scritto all’ultimo passo)',
};

export const runAgentStrings = () => pick({ en, it });
