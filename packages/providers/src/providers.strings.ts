import { formatDate, pick } from '@monsters/shared';

/*
 * What a person reads from the providers (D-153): errors that reach the UI, the page the browser
 * shows after "Sign in with ChatGPT", the messages of the Claude Code and Codex harnesses. What the
 * model reads (Codex's answer to `request_user_input`) stays in `harness/codex.ts`.
 */

const en = {
  allFailed: (tried: string) => `no model available: ${tried || 'empty chain'}`,
  emptyResponse: (finishReason?: string) =>
    `the model answered with no text and no actions (empty response${finishReason ? `, finish: ${finishReason}` : ''})`,
  /** `settings` is the place of the models in the settings ("Settings → Models"). */
  paidModelBlocked: (model: string, provider: string, settings: string) =>
    `${model} is a paid model and ${provider} is set to free models only: ` +
    `turn on “Also use paid models” in ${settings} (${provider}), ` +
    'or pick a free model (the ones ending in :free)',
  streamFirst: (ref: string, seconds: number) =>
    `${ref} didn’t start answering within ${seconds} s`,
  streamIdle: (ref: string, seconds: number) =>
    `${ref} stopped halfway through its answer: no data for ${seconds} s`,

  claudeMissing: 'Claude Code isn’t installed.',
  claudeMissingRun: (settings: string) =>
    `Claude Code isn’t installed: install it, or connect your Claude plan in ${settings}.`,
  /** The reason of a connector check that said nothing. */
  noAnswer: 'no answer',
  claudeClosed: (code: string | number | null, tail: string) =>
    `Claude Code closed without a result (${code ?? 'signal'})${tail ? `: ${tail}` : ''}`,
  /** Appended to a usage-limit error: when the window opens again. */
  resetsAt: (when: string) => `(resets ${when})`,
  /** How a reset time reads: "at 4:00 PM" within the day, "Wed 4:00 PM" later. */
  resetToday: (ts: number) => `at ${formatDate(ts, { hour: 'numeric', minute: '2-digit' })}`,
  resetLater: (ts: number) =>
    `${formatDate(ts, { weekday: 'short' }).replace('.', '')} ${formatDate(ts, { hour: 'numeric', minute: '2-digit' })}`,

  codexMissing: (settings: string) => `Codex isn’t installed: turn it on in ${settings}.`,
  codexNoReply: (method: string, seconds: number) =>
    `codex app-server isn’t answering ${method} (${seconds} s)`,
  codexIdle: (seconds: number) => `codex app-server has given no sign of life for ${seconds} s`,
  codexTokenExpired: (message: string) =>
    `The ChatGPT token stopped being valid halfway through the turn: try again (${message})`,
  codexMcpFailed: (server: string) =>
    `Codex could not connect to Monsters’ tools (the \`${server}\` server), so the turn did not start: try again`,
  codexClosed: (tail: string) =>
    `Codex closed before the end of the turn${tail ? `: ${tail}` : ''}`,

  /** Sign in with ChatGPT: OpenAI out of reach. */
  unreachableInUse: 'Your ChatGPT sign-in is still valid: try again shortly.',
  unreachableSignIn: 'Try connecting again shortly.',
  unreachable: (host: string, cause: string, then: string, hint: string) =>
    `I can’t reach OpenAI (${host}): ${cause}. ${then}${hint}`,

  /** The page the browser shows when the sign-in comes back to the local callback. */
  pageLang: 'en',
  pageDone: 'Done',
  pageFailed: 'Sign-in not completed',
  pageClosed: 'This sign-in is already closed: try again from Monsters.',
  pageBadState: 'Invalid response (state). Try again from Monsters.',
  pageCancelled: 'Sign-in cancelled. You can close this tab.',
  pageBadClient: 'Invalid response (client). Try again from Monsters.',
  pageNoRegistration: 'Registration not completed. Try again from Monsters.',
  pageNoCode: 'Response without a code. Try again from Monsters.',
  pageOk: 'Signed in to ChatGPT. You can close this tab and go back to Monsters.',
  pageError: 'Sign-in not completed. Go back to Monsters for details.',
};

const it: typeof en = {
  allFailed: (tried) => `nessun modello disponibile: ${tried || 'catena vuota'}`,
  emptyResponse: (finishReason) =>
    `il modello ha risposto senza testo né azioni (risposta vuota${finishReason ? `, fine: ${finishReason}` : ''})`,
  paidModelBlocked: (model, provider, settings) =>
    `${model} è un modello a pagamento e ${provider} è impostato sui soli modelli gratuiti: ` +
    `attiva “Usa anche modelli a pagamento” in ${settings} (${provider}), ` +
    'oppure scegli un modello gratuito (quelli che finiscono con :free)',
  streamFirst: (ref, seconds) => `${ref} non ha cominciato a rispondere entro ${seconds} s`,
  streamIdle: (ref, seconds) => `${ref} si è fermato a metà risposta: nessun dato da ${seconds} s`,

  claudeMissing: 'Claude Code non è installato.',
  claudeMissingRun: (settings) =>
    `Claude Code non è installato: installalo, o collega il piano Claude in ${settings}.`,
  noAnswer: 'nessuna risposta',
  claudeClosed: (code, tail) =>
    `Claude Code si è chiuso senza risultato (${code ?? 'segnale'})${tail ? `: ${tail}` : ''}`,
  resetsAt: (when) => `(si ripristina ${when})`,
  resetToday: (ts) => `alle ${formatDate(ts, { hour: '2-digit', minute: '2-digit' })}`,
  resetLater: (ts) =>
    `${formatDate(ts, { weekday: 'short' }).replace('.', '')} ${formatDate(ts, { hour: '2-digit', minute: '2-digit' })}`,

  codexMissing: (settings) => `Codex non è installato: attivalo in ${settings}.`,
  codexNoReply: (method, seconds) => `codex app-server non risponde a ${method} (${seconds} s)`,
  codexIdle: (seconds) => `codex app-server non dà segnali da ${seconds} s`,
  codexTokenExpired: (message) =>
    `Il token di ChatGPT non vale più a metà del turno: riprova (${message})`,
  codexMcpFailed: (server) =>
    `Codex non è riuscito a collegarsi agli strumenti di Monsters (il server \`${server}\`), quindi il turno non è partito: riprova`,
  codexClosed: (tail) => `Codex si è chiuso prima della fine del turno${tail ? `: ${tail}` : ''}`,

  unreachableInUse: 'L’accesso a ChatGPT resta valido: riprova tra poco.',
  unreachableSignIn: 'Riprova il collegamento tra poco.',
  unreachable: (host, cause, then, hint) =>
    `Non riesco a raggiungere OpenAI (${host}): ${cause}. ${then}${hint}`,

  pageLang: 'it',
  pageDone: 'Fatto',
  pageFailed: 'Accesso non completato',
  pageClosed: 'Questo accesso è già chiuso: riprova da Monsters.',
  pageBadState: 'Risposta non valida (state). Riprova da Monsters.',
  pageCancelled: 'Accesso annullato. Puoi chiudere questa scheda.',
  pageBadClient: 'Risposta non valida (client). Riprova da Monsters.',
  pageNoRegistration: 'Registrazione non completata. Riprova da Monsters.',
  pageNoCode: 'Risposta senza codice. Riprova da Monsters.',
  pageOk: 'Accesso a ChatGPT completato. Puoi chiudere questa scheda e tornare a Monsters.',
  pageError: 'Accesso non completato. Torna a Monsters per i dettagli.',
};

export const providerTexts = () => pick({ en, it });
