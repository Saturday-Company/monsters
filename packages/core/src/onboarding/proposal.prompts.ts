import { pick, type Lang } from '@monsters/shared';
import { archetypeTexts } from '../agents/archetypes.prompts.ts';

/*
 * The prompts of the team proposal at the first start (D-153, wave 3): the Italian ones of the
 * evals, never edited, and their English twins. The JSON keys of the answer are the code's and
 * stay as they are; the profile's keys are only read by the model and follow the family.
 */

export interface ProposalPromptInput {
  userName: string;
  orchestratorName: string;
  /** The profile as the model reads it (`profile` builds it with the family's keys). */
  profileJson: string;
  language: string;
  names: string;
  web: boolean;
}

interface ProposalProfile {
  userName: string;
  occupation: string[];
  goals: string[];
  delegate: string[];
  tools: string[];
  askFirst: string[];
  tone: string;
  language: string;
}

const it = {
  system: `Progetti la squadra di agenti AI di una persona, a partire dal suo profilo.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza markdown.`,
  profile: (p: ProposalProfile): Record<string, unknown> => ({
    nome: p.userName,
    occupazione: p.occupation,
    obiettivi: p.goals,
    da_delegare: p.delegate,
    strumenti: p.tools,
    chiedere_sempre_prima_di: p.askFirst,
    tono: p.tone,
    lingua: p.language,
  }),
  prompt: (x: ProposalPromptInput) => {
    const tools = x.web
      ? '["web"] se l’agente deve cercare o leggere sul web, altrimenti []'
      : '[] (il web non è permesso)';
    return `Profilo:
${x.profileJson}

Proponi da 2 a 5 agenti (meglio 2-3, pochi e utili) che lavorano per ${x.userName} sotto il coordinatore ${x.orchestratorName}.
Ogni agente ha un compito chiaro e diverso dagli altri, legato al profilo.
Se ${x.userName} deve ricevere testi (post, mail, documenti), uno degli agenti li scrive: il coordinatore gli passa quei lavori. Se servono fatti dal web, uno degli agenti fa le ricerche.
Le regole comuni a tutti (scrivere in ${x.language}, link alle pagine web come [testo](url), nomi dei file leggibili) sono già nel modello: nei duties metti solo regole proprie del mestiere di quell'agente.
Per ora gli agenti lavorano solo con le note del vault e, se permesso, con il web: niente compiti su app o account esterni (mail, social, Notion…).

Archetipi di partenza, da usare quando servono e adattare al profilo:
- Rhea: ricerche online e sintesi con fonti.
- Dione: testi pronti da usare (post, mail, riassunti, piani).

Nomi ammessi: ${x.names} (gli altri nell'ordine). Mai ${x.orchestratorName}.

Formato:
{"agents":[{"name":"Rhea","title":"la ricercatrice","role":"ricerche online e sintesi con fonti","mission":"trovi informazioni affidabili e aggiornate e le trasformi in note utili","context":"${x.userName} …","duties":["…"],"area":"Risorse/Ricerche","tools":["web"],"look":{"shape":"egg","eyes":"round"}}]}

Regole dei campi (tutto in italiano, ogni campo su una riga, niente markdown):
- name: uno dei nomi ammessi.
- title: chi è, con l'articolo ("la ricercatrice", "il pianificatore"), max 60 caratteri.
- role: cosa fa in una frase breve, max 120 caratteri.
- mission: il suo lavoro in seconda persona, max 200 caratteri.
- context: una frase su ${x.userName} utile a quell'agente, max 200 caratteri.
- duties: da 1 a 4 regole pratiche in seconda persona, max 200 caratteri ciascuna.
- area: una cartella del vault per i risultati, come "Risorse/Ricerche" o "Progetti/Social" (solo lettere, numeri e "/", mai Agenti, Modelli o Privato).
- tools: ${tools}.
- look (facoltativo): shape tra blob, egg, pear, bean, dome, lumpy; eyes tra round, cyclops, stalk, trio; mouth tra smile, grin, canyon, tiny; topper tra tuft, antenna, crest, geyser.`;
  },
  retry: (prompt: string, reason: string) =>
    `${prompt}\n\nLa tua risposta precedente non era valida: ${reason}\nRispondi di nuovo con il solo JSON corretto.`,
  /** The report of a monster made to measure (no archetype). */
  genericReport: 'cosa hai fatto (massimo 5 righe), le note create o modificate, i dubbi aperti',
  attemptNoAnswer: (reason: string) => `proposta del team: il modello non ha risposto (${reason})`,
  attemptInvalid: (attempt: number, reason: string) =>
    `proposta del team non valida (tentativo ${attempt}): ${reason}`,
};

const rhea = archetypeTexts('en').rhea;

const en: typeof it = {
  system: `You design the squad of AI agents of a person, starting from their profile.
Answer ONLY with a valid JSON object, with no text before or after and no markdown.`,
  profile: (p) => ({
    name: p.userName,
    occupation: p.occupation,
    goals: p.goals,
    to_delegate: p.delegate,
    tools: p.tools,
    always_ask_before: p.askFirst,
    tone: p.tone,
    language: p.language,
  }),
  prompt: (x) => {
    const tools = x.web
      ? '["web"] if the agent has to search or read on the web, otherwise []'
      : '[] (the web is not allowed)';
    return `Profile:
${x.profileJson}

Propose from 2 to 5 agents (better 2-3, few and useful) who work for ${x.userName} under the coordinator ${x.orchestratorName}.
Each agent has a clear task, different from the others’, tied to the profile.
If ${x.userName} has to receive texts (posts, emails, documents), one of the agents writes them: the coordinator passes those jobs to it. If facts from the web are needed, one of the agents does the research.
The rules shared by all (writing in ${x.language}, links to web pages as [text](url), readable file names) are already in the template: in the duties put only the rules of that agent’s own craft.
For now the agents work only with the notes of the vault and, if allowed, with the web: no tasks on external apps or accounts (email, social media, Notion…).

Starting archetypes, to use when they are needed and to adapt to the profile:
- Rhea: online research and summaries with sources.
- Dione: ready-to-use texts (posts, emails, summaries, plans).

Allowed names: ${x.names} (the others in order). Never ${x.orchestratorName}.

Format:
{"agents":[{"name":"Rhea","title":"${rhea.title}","role":"${rhea.summary}","mission":"${rhea.mission}","context":"${x.userName} …","duties":["…"],"area":"Risorse/Ricerche","tools":["web"],"look":{"shape":"egg","eyes":"round"}}]}

Rules of the fields (everything in English, each field on one line, no markdown):
- name: one of the allowed names.
- title: who they are, with the article ("the researcher", "the planner"), max 60 characters.
- role: what they do in a short sentence, max 120 characters.
- mission: their work in the second person, max 200 characters.
- context: a sentence about ${x.userName} useful to that agent, max 200 characters.
- duties: from 1 to 4 practical rules in the second person, max 200 characters each.
- area: a folder of the vault for the results, such as "Risorse/Ricerche" or "Progetti/Social" (only letters, numbers and "/", never Agenti, Modelli or Privato).
- tools: ${tools}.
- look (optional): shape among blob, egg, pear, bean, dome, lumpy; eyes among round, cyclops, stalk, trio; mouth among smile, grin, canyon, tiny; topper among tuft, antenna, crest, geyser.`;
  },
  retry: (prompt, reason) =>
    `${prompt}\n\nYour previous answer was not valid: ${reason}\nAnswer again with only the correct JSON.`,
  genericReport: 'what you did (at most 5 lines), the notes created or changed, the open doubts',
  attemptNoAnswer: (reason) => `team proposal: the model didn’t answer (${reason})`,
  attemptInvalid: (attempt, reason) => `invalid team proposal (attempt ${attempt}): ${reason}`,
};

export const PROPOSAL_PROMPTS: Record<Lang, typeof it> = { it, en };

export function proposalPrompts(lang?: Lang): typeof it {
  return pick(PROPOSAL_PROMPTS, lang);
}
