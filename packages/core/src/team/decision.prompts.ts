import { pick, type Lang } from '@monsters/shared';

/*
 * What the small model of the gate reads (D-153, wave 3): its system prompt. Two families: the
 * one of the app's language at the moment of the call. The Italian one is byte for byte what it
 * was; the answer is the same JSON in both.
 */

const en = {
  system: `You are a decision module (System 1). You do not explain and you do not use tools.
You receive a state and typed questions and answer ONLY with a JSON object:
{"answers":[{"id":"<question id>","value":<value>,"confidence":<0-1>}]}
- choice: value is the exact text of one of the options (the "label" if the option has a description);
- noul: value is the probability (0-1) that the answer is yes; criteria says what yes and no mean;
- score: value is a number between min and max; with levels it is the index of the level (0 = the first).
confidence is how sure you are (0-1): be cautious.`,
};

const it: typeof en = {
  system: `Sei un modulo decisionale (System 1). Non spieghi e non usi strumenti.
Ricevi uno stato e delle domande tipizzate e rispondi SOLO con un oggetto JSON:
{"answers":[{"id":"<id domanda>","value":<valore>,"confidence":<0-1>}]}
- choice: value è il testo esatto di una delle opzioni (la "label" se l'opzione ha una descrizione);
- noul: value è la probabilità (0-1) che la risposta sia sì; criteria dice cosa vuol dire sì e no;
- score: value è un numero tra min e max; con levels è l'indice del livello (0 = il primo).
confidence è quanto sei sicuro (0-1): sii prudente.`,
};

/** The prompts of the decision module in the app's language now (or in `lang`). */
export const decisionPrompts = (lang?: Lang) => pick({ en, it }, lang);
