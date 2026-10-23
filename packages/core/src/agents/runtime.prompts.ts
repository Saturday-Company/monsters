import { pick, type Lang } from '@monsters/shared';

/*
 * What the model reads from the run loop's machinery (D-153): the reminder after failures in a
 * row, the hint for a repeated call, the notes of a long or masked result, the folded progress,
 * the error of a call with invalid arguments. Two families: the one of the app's language at
 * the moment the text is produced. The Italian one is byte for byte what it was.
 */

const en = {
  repeatedCallHint:
    'You already have this result: use it, or change approach (another query, another source, another tool).',
  errorStreakReminder: (count: number) =>
    `[System reminder] The last ${count} tool calls failed. ` +
    'Read the code and hint of the last error and change approach: different arguments, another tool, ' +
    'or stop and write the report with what you have.',
  hiddenTextMark: '[invisible text removed]',
  invalidArguments: (tool: string, problem: string) => `invalid arguments for ${tool}: ${problem}`,
  invalidArgumentsHint: (tool: string, schema: string) =>
    `Fix the arguments and call the tool again. Arguments of ${tool}: ${schema} (? = optional).`,
  // result_read and the notes of the results kept out of the context (context.ts)
  readRange: (start: string, end: string, total: string, next: number | null) =>
    next !== null
      ? `characters ${start}-${end} of ${total}; the rest with offset ${next}`
      : `characters ${start}-${end} of ${total}, to the end`,
  offloadedNote: (total: string, shown: string, ref: string, offset: number) =>
    `[Monsters] Long result (${total} characters): here are the first ${shown}. The rest with result_read {"ref":"${ref}","offset":${offset}}.`,
  filtersHint: (tool: string, filters: string) =>
    `If you need only part of it, call ${tool} again with its filters (${filters}) instead of reading on.`,
  readsOver: (ref: string, max: number) => `${ref} has been read ${max} times in this job already`,
  readsOverHint: (tool: string) =>
    `Call ${tool} again with its filters for the part you need, or go on with what you have read.`,
  maskedNote: (tool: string, chars: string, ref: string) =>
    `[Monsters] Result of ${tool} taken out of the context to make room (${chars} characters). If you still need it: result_read {"ref":"${ref}"}.`,
  resultErrorKind: 'error, ',
  resultSize: (chars: string, ref: string) => `${chars} characters, result_read {"ref":"${ref}"}`,
  // the progress text of the steps folded away (context-guard.ts)
  youWrote: (text: string) => `- You wrote: “${text}”`,
  noResult: 'no result',
  done: 'done',
  errorPrefix: 'error: ',
  progressHead:
    '[Monsters] To make room in the context, your earlier steps in this task are summed up here (calls and outcomes). Whole results can be read again with result_read and the ref, if there is one.',
  olderStepsDropped: (n: number) => `- (… ${n} older steps removed)`,
};

const it: typeof en = {
  repeatedCallHint:
    'Hai già questo risultato: usalo, oppure cambia approccio (un’altra query, un’altra fonte, un altro strumento).',
  errorStreakReminder: (count) =>
    `[Promemoria del sistema] Le ultime ${count} chiamate agli strumenti sono fallite. ` +
    'Leggi codice e suggerimento dell’ultimo errore e cambia approccio: argomenti diversi, un altro strumento, ' +
    'oppure fermati e scrivi il rapporto con quello che hai.',
  hiddenTextMark: '[testo invisibile tolto]',
  invalidArguments: (tool, problem) => `argomenti non validi per ${tool}: ${problem}`,
  invalidArgumentsHint: (tool, schema) =>
    `Correggi gli argomenti e richiama lo strumento. Argomenti di ${tool}: ${schema} (? = facoltativo).`,
  readRange: (start, end, total, next) =>
    next !== null
      ? `caratteri ${start}-${end} di ${total}; il resto con offset ${next}`
      : `caratteri ${start}-${end} di ${total}, fino alla fine`,
  offloadedNote: (total, shown, ref, offset) =>
    `[Monsters] Risultato lungo (${total} caratteri): qui i primi ${shown}. Il resto con result_read {"ref":"${ref}","offset":${offset}}.`,
  filtersHint: (tool, filters) =>
    `Se te ne serve solo una parte, richiama ${tool} con i suoi filtri (${filters}) invece di leggere avanti.`,
  readsOver: (ref, max) => `${ref} è già stato letto ${max} volte in questo lavoro`,
  readsOverHint: (tool) =>
    `Richiama ${tool} con i suoi filtri per la parte che ti serve, o vai avanti con quello che hai letto.`,
  maskedNote: (tool, chars, ref) =>
    `[Monsters] Risultato di ${tool} tolto dal contesto per fare spazio (${chars} caratteri). Se ti serve ancora: result_read {"ref":"${ref}"}.`,
  resultErrorKind: 'errore, ',
  resultSize: (chars, ref) => `${chars} caratteri, result_read {"ref":"${ref}"}`,
  youWrote: (text) => `- Hai scritto: «${text}»`,
  noResult: 'senza risultato',
  done: 'fatto',
  errorPrefix: 'errore: ',
  progressHead:
    '[Monsters] Per fare spazio nel contesto, i tuoi passi di prima in questo compito sono riassunti qui (chiamate ed esiti). I risultati interi si rileggono con result_read e il ref, se c’è.',
  olderStepsDropped: (n) => `- (… ${n} passi più vecchi tolti)`,
};

export const runtimePrompts = (lang?: Lang) => pick({ en, it }, lang);
