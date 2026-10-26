import { pick, vaultLayout } from '@monsters/shared';

/*
 * What the models read from `delegate` and `ask_user` (D-153, wave 3): the tool descriptions
 * with their JSON examples, the defaults of a brief, the subtask the level is asked on, the
 * hints of the errors that carry an example, and the words of the report of a delegation. Two
 * families: the one of the app's language at the moment the text is produced. The Italian one
 * is byte for byte what it was (a description that was English with an Italian example stays so);
 * the English one translates the VALUES of the examples and keeps the keys. The vault paths
 * are those of the vault in use (`Risorse/Ricerche/…`, `Resources/Research/…`: D-154).
 */

/** Who or what stopped a delegated run (D-160): `stopped_by` of the report. */
export type DelegationStopBy =
  | 'user'
  | 'kill_switch'
  | 'shutdown'
  | 'run_limit'
  | 'token_limit'
  | 'max_steps'
  | 'watchdog'
  | 'tools_unavailable'
  | 'harness'
  | 'error'
  | 'unknown';

const en = {
  summaryCut: '\n[…summary cut: the details are in the notes]',
  requestOf: (user: string | undefined, request: string) =>
    `${user ? `Request from ${user}` : 'Request from the user'}: “${request}”`,
  doneWhenSaved: (area: string) => `the result is saved in ${area}/ and the report is ready`,
  doneWhenReport: 'the report is ready',
  // The subtask the level is asked on
  subtaskWhy: (why: string) => `Why: ${why}`,
  subtaskConstraints: (list: string) => `Constraints: ${list}`,
  subtaskResult: (format: string) => `Result: ${format}`,
  subtaskDone: (done: string) => `Done when: ${done}`,
  // What the orchestrator reads of "is it really done?" (D-067)
  checkDoubt: 'doubt',
  checkIncomplete: 'incomplete',
  delegateDescription: (maxParallel: number, maxPerRun: number) =>
    'Give a task to a team member and wait for a short report (summary + notes created). ' +
    'Use it when the work needs their skill: texts to deliver (posts, emails, documents) go to the writer, ' +
    'web research to the researcher. Do quick things yourself: delegating is expensive. ' +
    'For a creative text (post, slogan, newsletter) ask the writer for 2 variants of tone or cut, ' +
    'even when the profile gives a tone: the user picks one. ' +
    `Several delegate calls in the same step run in parallel (at most ${maxParallel} at once, ` +
    `${maxPerRun} per task). ` +
    "Write the brief in the user's language: the agent writes its notes in the same language. " +
    'Example: {"agent": "Dione", "goal": "The November newsletter for the customers, in 2 variants", ' +
    `"context_links": ["${vaultLayout().research}/November news"], "done_when": "drafts saved in a note"}`,
  askTeammateDescription: (names: string) =>
    'Ask a teammate of your squad a question and wait for their answer: what they know, what they found, ' +
    'a check on a piece of your work, or a short piece of work in their skill. Use it when you need ' +
    'something only they have instead of guessing; do quick things yourself. They do not see your task: ' +
    'say what you are working on in `context` and give notes as `context_links`. They answer you, ' +
    `they cannot ask a third monster. Teammates: ${names}. ` +
    'Example: {"agent": "Rhea", "question": "Which three sources did you use for the November market note?", ' +
    `"context": "I am writing the newsletter from it", "context_links": ["${vaultLayout().research}/November market"]}`,
  consultFormat: 'a short answer to the question, for a teammate: facts, sources, note paths',
  consultDone: 'you have answered the question (save a note only if they ask for one)',
  consultFrom: (name: string) =>
    `${name}, a teammate of your squad, asks you this while working on their own task.`,
  consultNext:
    'This is your teammate’s answer: use it in your own work and say in your report what came from them. ' +
    'Do not ask the same thing again.',
  consultFailedNext:
    'Your teammate could not answer (stopped_by, reason): go on with what you have, and say in your report ' +
    'what is missing because of it.',
  askUserDescription:
    'Ask the user a choice that is theirs: publishing, writing to others, spending, deleting for good, ' +
    'changing the goal, or taste (tone, variant, which draft). Only for such a choice or a fact that blocks ' +
    'the work: a question you can answer or look up yourself (a piece of information, a definition, a ' +
    'simple request) is answered, never asked back. Use it instead of asking in your reply: ' +
    'the user answers with one tap. One question, 2-4 short options, your recommendation, the kind. ' +
    'Each option says what it contains (a short label and a description): the user chooses from the card, ' +
    'without opening the notes, so never just "Variant A" / "Variant B". ' +
    'Reversible choices may be decided for you: the result says so. ' +
    'Without options it is an open question with a free answer: use it for facts only the user knows ' +
    '(products, prices, names, dates) instead of making them up. ' +
    'Examples: {"question": "Which version of the newsletter?", "options": [' +
    '{"label": "Short and direct", "description": "3 news items in a list, an invitation to drop by the shop"}, ' +
    '{"label": "Personal story", "description": "A story from the workshop, then the news"}], ' +
    '"recommended": "Short and direct", "kind": "taste"}; ' +
    '{"question": "What news is there this month?"}',
  optionsWithoutContentHint:
    'Write the options again with their content: a short label that names it (e.g. "Warm, friendly tone") ' +
    'and a description of what that option contains, then call ask_user again.',
  // Why a delegated run stopped (D-160): the facts of Monsters, never a guess of the lead.
  stoppedBy: (by: DelegationStopBy, name: string, detail: string): string => {
    const d = detail ? `: ${detail}` : '';
    switch (by) {
      case 'user':
        return `The user stopped ${name}.`;
      case 'kill_switch':
        return `The user pressed Stop: every monster stopped, ${name} too.`;
      case 'shutdown':
        return `Monsters was closing, so ${name} stopped.`;
      case 'run_limit':
        return `${name} stopped at the limit of this whole task (steps, tokens or cost)${d}`;
      case 'token_limit':
        return `${name} used up its own token limit and was stopped${d}`;
      case 'max_steps':
        return `${name} used all its steps and was stopped${d}`;
      case 'watchdog':
        return `${name}'s program gave no sign of life for too long and Monsters stopped it${d}`;
      case 'tools_unavailable':
        return `${name}'s program could not reach Monsters' tools (vault, web, team), so Monsters stopped it${d}`;
      case 'harness':
        return `${name}'s program (Claude Code or Codex) stopped by itself, without being asked.`;
      case 'error':
        return `${name} failed with an error${d}`;
      default:
        return `${name} stopped before finishing; Monsters has no cause on record.`;
    }
  },
  stoppedNext:
    'The task stopped before the end: there is no complete result. Tell the user plainly who or what stopped it ' +
    '(stopped_by, reason, in their language) and what was done (steps_done, the notes): never say the agent ' +
    'did not respond or that its tools did not answer unless the reason says so. Do not present partial work as done.',
  partialNext:
    'The agent stopped at a limit before the end (stopped_by, reason): the summary is partial. Present only what ' +
    'it says, as partial, say which limit stopped it, and do not present the task as done. You may delegate once ' +
    'more only for what is missing.',
};

const it: typeof en = {
  summaryCut: '\n[…riassunto tagliato: i dettagli sono nelle note]',
  requestOf: (user, request) =>
    `${user ? `Richiesta di ${user}` : 'Richiesta dell’utente'}: «${request}»`,
  doneWhenSaved: (area) => `il risultato è salvato in ${area}/ e il rapporto è pronto`,
  doneWhenReport: 'il rapporto è pronto',
  subtaskWhy: (why) => `Perché: ${why}`,
  subtaskConstraints: (list) => `Vincoli: ${list}`,
  subtaskResult: (format) => `Risultato: ${format}`,
  subtaskDone: (done) => `Finito quando: ${done}`,
  checkDoubt: 'dubbio',
  checkIncomplete: 'incompleto',
  delegateDescription: (maxParallel, maxPerRun) =>
    'Give a task to a team member and wait for a short report (summary + notes created). ' +
    'Use it when the work needs their skill: texts to deliver (posts, emails, documents) go to the writer, ' +
    'web research to the researcher. Do quick things yourself: delegating is expensive. ' +
    'For a creative text (post, slogan, newsletter) ask the writer for 2 variants of tone or cut, ' +
    'even when the profile gives a tone: the user picks one. ' +
    `Several delegate calls in the same step run in parallel (at most ${maxParallel} at once, ` +
    `${maxPerRun} per task). ` +
    "Write the brief in the user's language: the agent writes its notes in the same language. " +
    'Example: {"agent": "Dione", "goal": "La newsletter di novembre per i clienti, in 2 varianti", ' +
    `"context_links": ["${vaultLayout().research}/Novità di novembre"], "done_when": "bozze salvate in una nota"}`,
  askTeammateDescription: (names) =>
    'Ask a teammate of your squad a question and wait for their answer: what they know, what they found, ' +
    'a check on a piece of your work, or a short piece of work in their skill. Use it when you need ' +
    'something only they have instead of guessing; do quick things yourself. They do not see your task: ' +
    'say what you are working on in `context` and give notes as `context_links`. They answer you, ' +
    `they cannot ask a third monster. Teammates: ${names}. ` +
    'Example: {"agent": "Rhea", "question": "Quali tre fonti hai usato per la nota sul mercato di novembre?", ' +
    `"context": "Ci scrivo la newsletter", "context_links": ["${vaultLayout().research}/Mercato di novembre"]}`,
  consultFormat:
    'una risposta breve alla domanda, per un compagno di squadra: fatti, fonti, percorsi delle note',
  consultDone: 'hai risposto alla domanda (salva una nota solo se te la chiede)',
  consultFrom: (name) =>
    `${name}, un compagno della tua squadra, te lo chiede mentre lavora al suo incarico.`,
  consultNext:
    'This is your teammate’s answer: use it in your own work and say in your report what came from them. ' +
    'Do not ask the same thing again.',
  consultFailedNext:
    'Your teammate could not answer (stopped_by, reason): go on with what you have, and say in your report ' +
    'what is missing because of it.',
  askUserDescription:
    'Ask the user a choice that is theirs: publishing, writing to others, spending, deleting for good, ' +
    'changing the goal, or taste (tone, variant, which draft). Only for such a choice or a fact that blocks ' +
    'the work: a question you can answer or look up yourself (a piece of information, a definition, a ' +
    'simple request) is answered, never asked back. Use it instead of asking in your reply: ' +
    'the user answers with one tap. One question, 2-4 short options, your recommendation, the kind. ' +
    'Each option says what it contains (a short label and a description): the user chooses from the card, ' +
    'without opening the notes, so never just "Variante A" / "Variante B". ' +
    'Reversible choices may be decided for you: the result says so. ' +
    'Without options it is an open question with a free answer: use it for facts only the user knows ' +
    '(products, prices, names, dates) instead of making them up. ' +
    'Examples: {"question": "Quale versione della newsletter?", "options": [' +
    '{"label": "Breve e diretta", "description": "3 novità in elenco, invito a passare in negozio"}, ' +
    '{"label": "Racconto personale", "description": "Una storia dal laboratorio, poi le novità"}], ' +
    '"recommended": "Breve e diretta", "kind": "taste"}; ' +
    '{"question": "Quali novità ci sono questo mese?"}',
  optionsWithoutContentHint:
    'Write the options again with their content: a short label that names it (e.g. "Tono caldo e familiare") ' +
    'and a description of what that option contains, then call ask_user again.',
  stoppedBy: (by, name, detail) => {
    const d = detail ? `: ${detail}` : '';
    switch (by) {
      case 'user':
        return `L’utente ha fermato ${name}.`;
      case 'kill_switch':
        return `L’utente ha premuto il pulsante di arresto: si sono fermati tutti i mostri, anche ${name}.`;
      case 'shutdown':
        return `Monsters si stava chiudendo, quindi ${name} si è fermato.`;
      case 'run_limit':
        return `${name} si è fermato al limite di tutto questo lavoro (passi, token o costo)${d}`;
      case 'token_limit':
        return `${name} ha finito il suo limite di token ed è stato fermato${d}`;
      case 'max_steps':
        return `${name} ha usato tutti i suoi passi ed è stato fermato${d}`;
      case 'watchdog':
        return `Il programma di ${name} non ha dato segni di vita troppo a lungo e Monsters l’ha fermato${d}`;
      case 'tools_unavailable':
        return `Il programma di ${name} non è riuscito a raggiungere gli strumenti di Monsters (vault, web, squadra), quindi Monsters l’ha fermato${d}`;
      case 'harness':
        return `Il programma di ${name} (Claude Code o Codex) si è fermato da solo, senza che nessuno lo chiedesse.`;
      case 'error':
        return `${name} si è fermato per un errore${d}`;
      default:
        return `${name} si è fermato prima di finire; Monsters non ha una causa registrata.`;
    }
  },
  stoppedNext:
    'The task stopped before the end: there is no complete result. Tell the user plainly who or what stopped it ' +
    '(stopped_by, reason, in their language) and what was done (steps_done, the notes): never say the agent ' +
    'did not respond or that its tools did not answer unless the reason says so. Do not present partial work as done.',
  partialNext:
    'The agent stopped at a limit before the end (stopped_by, reason): the summary is partial. Present only what ' +
    'it says, as partial, say which limit stopped it, and do not present the task as done. You may delegate once ' +
    'more only for what is missing.',
};

export const teamToolsPrompts = () => pick({ en, it });
