import { pick, vaultLayout, type Lang } from '@monsters/shared';

/*
 * What the models read when the team changes after the onboarding (D-153, wave 3): the prompt
 * of a monster made to measure ("Aggiungi un mostro") and the default words of a monster
 * whose AGENTS.md is rewritten without fields. The Italian ones are the evals', never edited.
 * The JSON keys of the answer are the code's; the profile's keys are only read by the model.
 */

export interface DraftPromptInput {
  userName: string;
  orchestratorName: string;
  occupation: string[];
  tone: string;
  language: string;
  /** "- Name: role" lines of the current squad. */
  team: string;
  description: string;
  name: string | undefined;
  free: string;
}

/*
 * The vault's names the prompt quotes are those of the vault in use (D-154): an Italian vault's
 * (`Progetti/Calendario`, `Agenti, Modelli o Privato`) in either family, an English vault's
 * otherwise.
 */
const exampleArea = () => (vaultLayout().id === 'it' ? 'Progetti/Calendario' : 'Projects/Calendar');
const reservedFolders = (or: string) => {
  const l = vaultLayout();
  return `${l.agents}, ${l.templates} ${or} ${l.private}`;
};

const it = {
  draftSystem: `Progetti un nuovo agente AI per la squadra di una persona.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza markdown.`,
  draftPrompt: (x: DraftPromptInput) => `Profilo:
${JSON.stringify({ nome: x.userName, occupazione: x.occupation, tono: x.tone, lingua: x.language }, null, 2)}

Squadra attuale (coordinatore ${x.orchestratorName}):
${x.team}

${x.userName} vuole un nuovo agente nella squadra. In parole sue: "${x.description.replace(/"/g, "'")}"
Progetta UN solo agente con un compito chiaro e diverso da quelli della squadra attuale.
Per ora gli agenti lavorano solo con le note del vault e, se serve, con il web.
${x.name ? `Il nome è ${x.name}.` : `Nomi ammessi: ${x.free}.`}

Formato:
{"agents":[{"name":"…","title":"il pianificatore","role":"…","mission":"…","context":"…","duties":["…"],"area":"${exampleArea()}","tools":[],"look":{"shape":"egg","eyes":"round"}}]}

Regole dei campi (tutto in italiano, ogni campo su una riga, niente markdown):
- title: chi è, con l'articolo, max 60 caratteri.
- role: cosa fa in una frase breve, max 120 caratteri.
- mission: il suo lavoro in seconda persona, max 200 caratteri.
- context: una frase su ${x.userName} utile a quell'agente, max 200 caratteri.
- duties: da 1 a 4 regole pratiche in seconda persona, max 200 caratteri ciascuna.
- area: una cartella del vault per i risultati (solo lettere, numeri e "/", mai ${reservedFolders('o')}).
- tools: ["web"] se deve cercare o leggere sul web, altrimenti [].
- look (facoltativo): shape tra blob, egg, pear, bean, dome, lumpy; eyes tra round, cyclops, stalk, trio; mouth tra smile, grin, canyon, tiny; topper tra tuft, antenna, crest, geyser.`,
  retry: (prompt: string, reason: string) =>
    `${prompt}\n\nLa tua risposta precedente non era valida: ${reason}\nRispondi di nuovo con il solo JSON corretto.`,
  /** The title of a monster with none given. */
  helperTitle: 'l’aiutante',
  /** The one duty of a monster rewritten without fields. */
  defaultDuty: (capo: string) =>
    `Lavori sui compiti che ti passa ${capo} e salvi i risultati nella tua cartella.`,
};

const en: typeof it = {
  draftSystem: `You design a new AI agent for a person’s squad.
Answer ONLY with a valid JSON object, with no text before or after and no markdown.`,
  draftPrompt: (x) => `Profile:
${JSON.stringify({ name: x.userName, occupation: x.occupation, tone: x.tone, language: x.language }, null, 2)}

Current squad (coordinator ${x.orchestratorName}):
${x.team}

${x.userName} wants a new agent in the squad. In their own words: "${x.description.replace(/"/g, "'")}"
Design ONE single agent with a clear task, different from those of the current squad.
For now the agents work only with the notes of the vault and, if needed, with the web.
${x.name ? `The name is ${x.name}.` : `Allowed names: ${x.free}.`}

Format:
{"agents":[{"name":"…","title":"the planner","role":"…","mission":"…","context":"…","duties":["…"],"area":"${exampleArea()}","tools":[],"look":{"shape":"egg","eyes":"round"}}]}

Rules of the fields (everything in English, each field on one line, no markdown):
- title: who they are, with the article, max 60 characters.
- role: what they do in a short sentence, max 120 characters.
- mission: their work in the second person, max 200 characters.
- context: a sentence about ${x.userName} useful to that agent, max 200 characters.
- duties: from 1 to 4 practical rules in the second person, max 200 characters each.
- area: a folder of the vault for the results (only letters, numbers and "/", never ${reservedFolders('or')}).
- tools: ["web"] if it has to search or read on the web, otherwise [].
- look (optional): shape among blob, egg, pear, bean, dome, lumpy; eyes among round, cyclops, stalk, trio; mouth among smile, grin, canyon, tiny; topper among tuft, antenna, crest, geyser.`,
  retry: (prompt, reason) =>
    `${prompt}\n\nYour previous answer was not valid: ${reason}\nAnswer again with only the correct JSON.`,
  helperTitle: 'the helper',
  defaultDuty: (capo) =>
    `You work on the tasks ${capo} passes you and save the results in your folder.`,
};

export const TEAM_MANAGER_PROMPTS: Record<Lang, typeof it> = { it, en };

export function teamManagerPrompts(lang?: Lang): typeof it {
  return pick(TEAM_MANAGER_PROMPTS, lang);
}
