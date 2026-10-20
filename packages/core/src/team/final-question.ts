import type { EventLog } from '../log/event-log.ts';
import { BANDS, pendingRequest } from './instinct/questions.ts';
import { pOf, type System1 } from './instinct/system1.ts';
import { unicodeWords } from './word-boundary.ts';

/*
 * Question left in plain text (docs/eval/2026-10-14-demo.md): free models often
 * end their answer by asking the user something in the text, even when the
 * choice has clear options that `ask_user` would show as a card. The rule in
 * AGENTS.md alone is not enough, so the runtime acts like a stop hook: when the
 * orchestrator's final answer ends with a question and the run has no
 * `ask_user`, it gets one more chance with a short reminder (once per run).
 */

export const FINAL_QUESTION_REMINDER =
  'Hai fatto una domanda in testo: se ci sono opzioni chiare, usa ask_user con 2-4 opzioni; ' +
  "se manca un fatto che solo l'utente sa, ask_user senza opzioni; altrimenti la domanda in testo " +
  "va bene così e rispondi solo OK. Non ripetere la risposta: l'utente l'ha già letta.";

/** Openings of a question without "?": "vuoi che…", "preferisci…", "dimmi…". */
const CUE = unicodeWords(
  /(?:^|[,;:]\s+)(vuoi|volete|preferisci|preferite|dimmi|ditemi|fammi sapere|fatemi sapere|scegli|scegliete|let me know|tell me|would you like|do you want|shall i|should i|which (one )?do you)\b/iu,
);

/**
 * A fact only the user can give, said without a question (D-073, `hf2`
 * "manca solo il nome del referente", 0.63 for Jev): "mi mancano la data e il
 * numero di ospiti", "mi serve l'indirizzo", "non so ancora il prezzo". An
 * article must follow, so "mancano tre giorni" and "manca solo da rileggere"
 * are not; "lo faccio io" takes it back.
 */
const ARTICLE = "(?:(?:il|lo|la|i|gli|le|un|uno|una|del|della|dei|delle|degli)\\b|l['’]|un['’])";
const MISSING = unicodeWords(
  new RegExp(
    [
      `(?:^|[,;:]\\s+|\\bma\\s+|\\bperò\\s+)(?:mi\\s+)?manca(?:no)?\\s+(?:solo\\s+|soltanto\\s+|ancora\\s+|però\\s+)*${ARTICLE}`,
      `\\bmi\\s+serv(?:e|ono)\\s+(?:sapere\\s+|conoscere\\s+|ancora\\s+)*${ARTICLE}`,
      `\\bho\\s+bisogno\\s+(?:di\\s+sapere\\s+|di\\s+conoscere\\s+|del|della|dei|delle|degli|di)`,
      `\\bnon\\s+(?:so|conosco|trovo|ho)\\s+(?:ancora\\s+)?${ARTICLE}`,
      '\\bi\\s+(?:still\\s+)?need\\s+(?:to\\s+know\\s+)?(?:the|your|a|an)\\b',
      "\\b(?:i\\s+don't|i\\s+do\\s+not)\\s+(?:know|have)\\s+(?:the|your)\\b",
    ].join('|'),
    'iu',
  ),
);
/**
 * What can follow the missing fact in its sentence and keep it a request:
 * nothing, a purpose ("per chiudere", "così prenoto") or a plea. Anything
 * else is the agent going on by itself (D-074): "Non ho uno strumento per
 * pubblicare, quindi le trovi qui sopra", "Non so la data esatta, ma il sito
 * dice ottobre", "mancano i prezzi che Rhea cercherà", "non trovo la fonte,
 * l'ho tolta".
 */
const GOES_ON = unicodeWords(
  /[,;:(]|\s[-–—]\s|\b(?:ma|però|quindi|perciò|dunque|allora|invece|comunque|anche\s+se|che|cui|dove|quando|appena|but|so|which|that|though|however|until)\b/iu,
);
const STILL_ASKS = unicodeWords(
  /^[,;:]?\s*(?:così|per|in\s+modo|prima\s+di|potresti|puoi|me\s+l[oaie]|dimmi|mandami|scrivimi|so\s+(?:that|i)|to|please|could|can)\b/iu,
);
/**
 * What follows says the agent is stuck without it, so it still asks: "…, che
 * non trovo nelle note", "…: senza quello non posso chiuderlo".
 */
const STUCK = unicodeWords(
  /\bnon\s+(?:l[oaie]\s+)?(?:posso|riesco|trovo|ho|so|conosco)\b|\bsenza\s+(?:quell[oaie]|quest[oaie]|di\s+(?:quell|quest)\w*|il|lo|la|i|gli|le|l['’])|\b(?:can['’]?t|cannot|could\s+not|couldn['’]t)\b/iu,
);
/**
 * Things an agent lacks that are not a fact of the user: a tool, a permission,
 * a way, the time ("non ho il permesso di inviare mail" says why it did not).
 */
const NOT_A_FACT = unicodeWords(
  /^(?:\w+['’]\s*)?(?:strument\w*|permess\w*|accesso|accessi|modo|possibilità|capacità|tempo|tool|tools|permission|permissions|access|way|ability)\b/iu,
);

/** "Manca il nome del referente": a fact only the user can give, asked for. */
function asksForMissing(sentence: string): boolean {
  const m = MISSING.exec(sentence);
  if (!m || SELF.test(sentence)) return false;
  const rest = sentence.slice(m.index + m[0].length);
  if (NOT_A_FACT.test(rest.trimStart())) return false;
  const brk = GOES_ON.exec(rest);
  if (!brk) return true;
  const after = rest.slice(brk.index);
  return STILL_ASKS.test(after) || STUCK.test(after);
}

/** The agent says it will see to it itself ("lo faccio io", "lo cerco io"). */
const SELF = unicodeWords(
  /\b(?:l[oae]\s+|ci\s+)?(?:faccio|cerco|chiedo|penso|sistemo|trovo)\s+io\b|\bi'?ll\b/iu,
);

/**
 * Offers that close a chat ("come posso aiutarti?", "fammi sapere se vuoi modifiche"):
 * not a choice to make.
 */
const SMALL_TALK = unicodeWords(
  new RegExp(
    [
      '^(come|in cosa|cosa) (posso|possiamo) (fare|aiutar\\w*)',
      '\\b(posso|possiamo) (fare|aiutar\\w*) (altro|in altro|ancora)\\b',
      "\\b(ti|vi|le) serv(e|ono) (altro|qualcos'altro|qualcosa)\\b",
      "^(serve|c'è) (altro|qualcos'altro)",
      // "fammi sapere se vuoi apportare modifiche", "se desideri cambiare qualcosa"
      '\\bse (vuoi|volete|desideri|desiderate)\\b.{0,25}\\b(modific\\w*|cambi\\w*|ritocc\\w*|aggiust\\w*)',
      '^(how|what) (else )?can i (help|do)',
      '\\banything else\\b',
      "\\bif you (want|need|'d like)\\b.{0,25}\\b(changes|tweaks|edits)\\b",
      '^(can|may) i help',
    ].join('|'),
    'iu',
  ),
);

interface Line {
  text: string;
  /** A list item ("- …", "1. …"). */
  item: boolean;
}

/** Non-empty lines without Markdown decoration and emoji. */
function cleanLines(text: string): Line[] {
  return text
    .split('\n')
    .map((raw) => ({
      item: /^\s*(?:[-*+]|\d+[.)])\s+/.test(raw),
      text: raw
        .replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, '')
        .replace(/[*_`~#]+/g, '')
        .replace(/\p{Extended_Pictographic}|\u{FE0F}/gu, '')
        .trim(),
    }))
    .filter((l) => l.text !== '');
}

/** Last sentence of a text, without Markdown decoration and emoji. */
export function lastSentence(text: string): string {
  const last = cleanLines(text).at(-1)?.text ?? '';
  // Sentences end with . ! ? (or …); keep the closing mark with its sentence.
  const sentences = last.match(/[^.!?…]+[.!?…]*/gu) ?? [last];
  const cleaned = sentences.map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
  return cleaned.at(-1) ?? '';
}

const isQuestion = (sentence: string) =>
  !SMALL_TALK.test(sentence) &&
  (sentence.includes('?') || CUE.test(sentence) || asksForMissing(sentence));

/** Lines after a question that only list its options ("- Va bene così", "Consiglio: …"). */
const MAX_OPTION_LINES = 5;
const MAX_OPTION_CHARS = 100;

/**
 * True when the text ends by asking the user something (and not just "anything
 * else?"): its last sentence, or a question followed only by a short list of options.
 */
export function endsWithQuestion(text: string): boolean {
  const sentence = lastSentence(text);
  if (sentence && isQuestion(sentence)) return true;
  const lines = cleanLines(text);
  let items = 0;
  for (let n = 1; n <= MAX_OPTION_LINES && n < lines.length; n++) {
    const line = lines[lines.length - n]!;
    if (line.text.length > MAX_OPTION_CHARS) return false;
    if (line.item) items++;
    const before = lines[lines.length - n - 1]!;
    if (items > 0 && !before.item && before.text.trimEnd().endsWith('?')) {
      const sentences = before.text.match(/[^.!?…]+[.!?…]*/gu) ?? [before.text];
      return isQuestion(sentences.at(-1)!.trim());
    }
  }
  return false;
}

/**
 * Stop hook of the orchestrator (see `RunAgentOptions.onFinalAnswer`): the
 * reminder when the answer ends with a question, the run has no `ask_user`
 * call of this agent and no reminder was sent yet; otherwise null.
 */
export function finalQuestionHook(
  log: EventLog,
  params: { agentId: string; runId: string; signal?: AbortSignal },
  /**
   * The instinct (D-067, research 08 §5.6): in OR with the regex, it sees the
   * questions without "?" ("manca solo il nome del referente") and, when it is
   * sure there is none, stops a reminder of the regex (a rhetorical question).
   */
  system1?: System1,
): (text: string) => Promise<string | null> {
  return async (text) => {
    const regex = endsWithQuestion(text);
    if (!regex && !system1?.available('final_question')) return null;
    const events = log.query({
      runId: params.runId,
      agent: params.agentId,
      type: ['tool_call', 'message'],
      limit: 5000,
    });
    const asked = events.some((e) => e.type === 'tool_call' && e.data.tool === 'ask_user');
    const reminded = events.some(
      (e) =>
        e.type === 'message' && e.data.role === 'system' && e.data.text === FINAL_QUESTION_REMINDER,
    );
    if (asked || reminded) return null;
    const answer = system1
      ? await system1
          .ask({
            use: 'final_question',
            agent: params.agentId,
            runId: params.runId,
            request: pendingRequest(text),
            logAs: { pending: { kind: 'final_question', bands: BANDS.finalQuestion } },
            ...(params.signal ? { signal: params.signal } : {}),
          })
          .catch(() => null)
      : null;
    const p = answer?.mode === 'on' ? pOf(answer, 'pending') : undefined;
    if (p === undefined) return regex ? FINAL_QUESTION_REMINDER : null;
    const remind = (regex && p >= BANDS.finalQuestion.low) || p >= BANDS.finalQuestion.high;
    if (remind && !regex) {
      log.append({
        agent: 'system',
        runId: params.runId,
        type: 'instinct',
        data: {
          use: 'final_question',
          action: 'final_question',
          message:
            'La risposta finiva con una domanda per te: ho chiesto di mandartela come scheda.',
          subject: params.agentId,
          confidence: p,
        },
      });
    }
    return remind ? FINAL_QUESTION_REMINDER : null;
  };
}
