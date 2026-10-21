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
};

export const teamToolsPrompts = () => pick({ en, it });
