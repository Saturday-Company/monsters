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
  tokenLimit: (name: string, n: number, plan = false) =>
    `${name} went over the limit of ${n} tokens${plan ? ' on the subscription' : ''}`,
  reportAtLastStep: ' (report written at the last step)',
  invisibleRemoved: (chars: number, source: string) =>
    `I removed ${chars} invisible characters from ${source}: they were hiding text.`,
  // A job on a harness (Claude Code, Codex)
  harnessUnavailable: (name: string, harness: string, where: string) =>
    `${name} works with ${harness}, which isn’t on now: turn it back on in ${where} or change the monster’s model.`,
  modelWord: 'model',
  planLimitFallback: (from: string, to: string, error: string | undefined) =>
    `${from} → ${to} (plan usage limit)${error ? `: ${error}` : ''}`,
  harnessRefused: (tool: string) =>
    `Claude Code’s ${tool} was refused by the rules of this job, not by you.`,
  harnessStalled: (name: string, minutes: number) =>
    `${name} has given no signal for ${minutes} minutes: the program is stuck and I stopped it`,
  harnessClosed: (name: string) => `${name}: the program closed without an answer`,
  harnessNoSignal: 'no signal from the program',
  // Monsters' own tools on a harness (D-160): the `monsters` server did not connect.
  monstersToolsDown: (harness: string, cause: string, retrying: boolean) =>
    `${harness} could not reach Monsters’ tools (vault, web, team) when it started: ${cause}.` +
    (retrying ? ' I’m starting it again.' : ''),
  harnessToolsUnavailable: (name: string, harness: string, cause: string) =>
    `${name} stopped: ${harness} could not reach Monsters’ tools (vault, web, team), so the job could not be done properly. Cause: ${cause}.`,
  mcpCause: {
    unreachable: (where: string) => `Monsters’ address for its tools (${where}) did not answer`,
    token: 'Monsters refused the key of this job',
    refused: (status: number) => `Monsters answered with an error (HTTP ${status})`,
    slow: 'Monsters was too busy to answer in time',
    pending: 'the connection was still starting when the model began (a slow start)',
    needsAuth: 'the program asked to sign in to Monsters’ tools, which never need it',
    harnessSide:
      'Monsters answers, but the program could not connect to it (a proxy, a firewall or a security program may be in the way)',
  },
  toolNeverReached: (detail: string) =>
    `The call never reached Monsters: ${detail || 'the program gave no reason'}`,
  harnessCallUnanswered: 'The program ended before the result of this call.',
  configWriteStopped:
    'A monster wanted to change Claude Code’s configuration in its folder: stopped.',
  internalFilesStopped: 'A monster wanted to use Monsters’ internal files: stopped.',
  monstersRuleRefusal: (tool: string) =>
    `Claude Code’s ${tool}: it doesn’t get there because of a fixed Monsters rule (its data, Claude Code and Codex configuration, the folders closed to this job), not because of a permission of yours.`,
  builtinOnlyAttached:
    'In this job Claude Code’s Read opens only the attached files: you didn’t deny it.',
  builtinNotInJob: (tool: string) =>
    `Claude Code’s ${tool} is not among this job’s tools: you didn’t deny it.`,
  builtinWebTools: ' For the web it has Monsters’ tools.',
  builtinWebElsewhere: (who: string, n: number) =>
    ` In this squad ${who} ${n > 1 ? 'have' : 'has'} the web.`,
  builtinNoWeb: ' This monster has no web.',
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
  tokenLimit: (name, n, plan = false) =>
    `${name} ha superato il limite di ${n} token${plan ? ' sull’abbonamento' : ''}`,
  reportAtLastStep: ' (rapporto scritto all’ultimo passo)',
  invisibleRemoved: (chars, source) =>
    `Ho tolto ${chars} caratteri invisibili da ${source}: nascondevano un testo.`,
  harnessUnavailable: (name, harness, where) =>
    `${name} lavora con ${harness}, che ora non è attivo: riattivalo in ${where} o cambia il modello del mostro.`,
  modelWord: 'modello',
  planLimitFallback: (from, to, error) =>
    `${from} → ${to} (limite d’uso del piano)${error ? `: ${error}` : ''}`,
  harnessRefused: (tool) =>
    `${tool} di Claude Code è stato rifiutato dalle regole di questo lavoro, non da te.`,
  harnessStalled: (name, minutes) =>
    `${name} non dà più segnali da ${minutes} minuti: il programma è bloccato e l’ho fermato`,
  harnessClosed: (name) => `${name}: il programma si è chiuso senza risposta`,
  harnessNoSignal: 'nessun segnale dal programma',
  monstersToolsDown: (harness, cause, retrying) =>
    `${harness} non è riuscito a raggiungere gli strumenti di Monsters (vault, web, squadra) all’avvio: ${cause}.` +
    (retrying ? ' Lo faccio ripartire.' : ''),
  harnessToolsUnavailable: (name, harness, cause) =>
    `${name} si è fermato: ${harness} non è riuscito a raggiungere gli strumenti di Monsters (vault, web, squadra), quindi il lavoro non si poteva fare come si deve. Causa: ${cause}.`,
  mcpCause: {
    unreachable: (where) =>
      `l’indirizzo di Monsters per i suoi strumenti (${where}) non ha risposto`,
    token: 'Monsters ha rifiutato la chiave di questo lavoro',
    refused: (status) => `Monsters ha risposto con un errore (HTTP ${status})`,
    slow: 'Monsters era troppo occupato per rispondere in tempo',
    pending:
      'il collegamento stava ancora partendo quando il modello ha cominciato (un avvio lento)',
    needsAuth:
      'il programma ha chiesto di accedere agli strumenti di Monsters, che non ne hanno mai bisogno',
    harnessSide:
      'Monsters risponde, ma il programma non è riuscito a collegarsi (può essere in mezzo un proxy, un firewall o un programma di sicurezza)',
  },
  toolNeverReached: (detail) =>
    `La chiamata non è mai arrivata a Monsters: ${detail || 'il programma non ha detto perché'}`,
  harnessCallUnanswered: 'Il programma si è chiuso prima del risultato di questa chiamata.',
  configWriteStopped:
    'Un mostro voleva cambiare la configurazione di Claude Code nella sua cartella: fermato.',
  internalFilesStopped: 'Un mostro voleva usare i file interni di Monsters: fermato.',
  monstersRuleRefusal: (tool) =>
    `${tool} di Claude Code: lì non arriva per una regola fissa di Monsters (i suoi dati, la configurazione di Claude Code e Codex, le cartelle chiuse a questo lavoro), non per un tuo permesso.`,
  builtinOnlyAttached:
    'In questo lavoro Read di Claude Code apre solo i file allegati: non l’hai negato tu.',
  builtinNotInJob: (tool) =>
    `${tool} di Claude Code non è tra gli strumenti di questo lavoro: non l’hai negato tu.`,
  builtinWebTools: ' Per il web ha gli strumenti di Monsters.',
  builtinWebElsewhere: (who) => ` Il web in questa squadra ce l’ha ${who}.`,
  builtinNoWeb: ' Questo mostro non ha il web.',
};

export const runAgentStrings = () => pick({ en, it });
