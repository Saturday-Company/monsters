import {
  appLang,
  ONBOARDING_QUESTIONS,
  onboardingQuestionsIn,
  checkOnboardingAnswer,
  writingLanguage,
  type AgentPermissions,
  type Lang,
  type OnboardingAnswer,
} from '@monsters/shared';
import type { DecisionRuleInput } from '../team/decision.ts';
import { teamStrings } from '../team/team.strings.ts';
import { PROFILE_TEXTS } from './profile.prompts.ts';

/*
 * From the answers of the first start to a typed profile, `profilo.md` (memory,
 * not instructions: research 03 §5) and the "always ask" rules of the
 * DecisionGate. The profile's words (option labels, the writing language's
 * name) and `profilo.md` are in the family of the app's language when they are
 * made (D-153): what the monsters read about the user.
 */

export type Answers = Record<string, OnboardingAnswer>;

export interface Profile {
  userName: string;
  orchestratorName: string;
  /** Labels of the chosen options, then the free text if any. */
  occupation: string[];
  /** The free text of the occupation answer (also last in `occupation`): the user's own words. */
  occupationText?: string | undefined;
  goals: string[];
  /** The free text of the goals answer (also last in `goals`). */
  goalsText?: string | undefined;
  delegate: string[];
  tools: string[];
  /** Ids of the "ask first" options (publish, contact, spend, delete, goal). */
  askFirst: string[];
  askFirstText?: string | undefined;
  tone: string;
  /** Language id (it, en, …) and its name in the profile's family ("italiano", "Italian"), for the templates. */
  languageId: string;
  language: string;
  styleNotes?: string | undefined;
  /** The family the labels and names are in (the app's language when the profile was made). */
  lang: Lang;
}

/** Ids of the questions still without a valid answer. */
export function missingAnswers(answers: Answers): string[] {
  return ONBOARDING_QUESTIONS.filter((q) => {
    const a = answers[q.id];
    return !a || checkOnboardingAnswer(q, a).length > 0;
  }).map((q) => q.id);
}

function question(id: string, lang: Lang) {
  // The labels of the options go inside the profile's sentences: the profile's family.
  const q = onboardingQuestionsIn(lang).find((x) => x.id === id);
  if (!q) throw new Error(`unknown onboarding question ${id}`);
  return q;
}

function values(answers: Answers, qid: string, gid: string): string[] {
  return (answers[qid]?.values[gid] ?? []).map((v) => v.trim()).filter(Boolean);
}

function labels(answers: Answers, qid: string, lang: Lang, gid = 'cosa'): string[] {
  const group = question(qid, lang).groups.find((g) => g.id === gid);
  const chosen = values(answers, qid, gid).map(
    (v) => group?.options.find((o) => o.id === v)?.label ?? v,
  );
  const text = answers[qid]?.text?.trim();
  return text ? [...chosen, text] : chosen;
}

function label(answers: Answers, qid: string, gid: string, lang: Lang): string {
  const q = question(qid, lang);
  const group = q.groups.find((g) => g.id === gid)!;
  const v = values(answers, qid, gid)[0] ?? group.defaults[0] ?? '';
  return group.options.find((o) => o.id === v)?.label ?? v;
}

/** Collapses spaces and capitalises the first letter of a name. */
export function cleanName(name: string): string {
  const one = name.replace(/\s+/g, ' ').trim();
  return one.charAt(0).toUpperCase() + one.slice(1);
}

export function profileFromAnswers(answers: Answers, lang: Lang = appLang()): Profile {
  // No answer: the monsters write in the language of the profile's words (D-153).
  const languageId = values(answers, 'tono', 'lingua')[0] ?? lang;
  return {
    userName: cleanName(values(answers, 'nomi', 'user')[0] ?? teamStrings(lang).userName),
    orchestratorName: cleanName(values(answers, 'nomi', 'orchestrator')[0] ?? 'Titan'),
    occupation: labels(answers, 'lavoro', lang),
    occupationText: answers['lavoro']?.text?.trim() || undefined,
    goals: labels(answers, 'obiettivi', lang),
    goalsText: answers['obiettivi']?.text?.trim() || undefined,
    delegate: labels(answers, 'deleghe', lang),
    tools: labels(answers, 'strumenti', lang),
    askFirst: values(answers, 'chiedi', 'cosa'),
    askFirstText: answers['chiedi']?.text?.trim() || undefined,
    tone: label(answers, 'tono', 'tono', lang).toLowerCase(),
    languageId,
    language: writingLanguage(languageId)?.[lang] ?? writingLanguage('it')![lang],
    styleNotes: answers['tono']?.text?.trim() || undefined,
    lang,
  };
}

const list = (items: string[], empty: string) =>
  items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${empty}`;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const CONTEXT_MAX = 200;

/** The user's own words in quotes, on one line, at most `max` characters. */
function quoted(text: string, max: number): string {
  let one = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?…]+$/u, '');
  if (one.length > max) one = `${one.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  return `«${one}»`;
}

/**
 * One sentence about the user for the agents' AGENTS.md (max 200 chars, one
 * line), in the third person. The chosen options become "si occupa di X e di
 * Y", "gestisce un’attività"; the free text is the user's own words, in the
 * first person or not: it goes in quotes as it is, never glued to a verb
 * ("si occupa di co-fondatore…", review of 16/10).
 */
export function contextSentence(p: Profile): string {
  const t = PROFILE_TEXTS[p.lang].context;
  const fields: string[] = [];
  const verbs: string[] = [];
  for (const o of p.occupation) {
    if (o === p.occupationText) continue;
    const verb = t.verbs[lower(o)];
    if (verb) verbs.push(verb);
    else fields.push(lower(o));
  }
  const clauses = [...(fields.length > 0 ? [t.worksIn(fields.slice(0, 2))] : []), ...verbs];
  const goal = p.goals.find((g) => g !== p.goalsText);
  const goalText = goal ? undefined : p.goalsText;
  const build = (room: { work: number; goal: number }): string => {
    let head: string;
    if (clauses.length > 0) {
      head = `${p.userName} ${clauses.join(t.and)}`;
      if (p.occupationText && room.work > 0) {
        head += t.inOwnWords(quoted(p.occupationText, room.work));
      }
    } else if (p.occupationText && room.work > 0) {
      head = t.introduces(p.userName, quoted(p.occupationText, room.work));
    } else {
      head = t.entrusted(p.userName);
    }
    const tail = goal
      ? t.wants(t.goal(lower(goal)))
      : goalText && room.goal > 0
        ? t.forWeeks(quoted(goalText, room.goal))
        : '';
    return `${head}${tail}.`.replace(/\s+/g, ' ');
  };
  // The user's words take what is left: first the work, then the goal.
  let sentence = build({ work: 90, goal: 70 });
  for (const room of [
    { work: 60, goal: 50 },
    { work: 40, goal: 0 },
    { work: 0, goal: 0 },
  ]) {
    if (sentence.length <= CONTEXT_MAX) break;
    sentence = build(room);
  }
  if (sentence.length > CONTEXT_MAX) sentence = `${sentence.slice(0, 196).trimEnd()}….`;
  return sentence;
}

/**
 * `profilo.md`: what the agents know about the user (frontmatter `type: profile` is added by the
 * vault write), in the profile's family.
 */
export function renderProfile(p: Profile, permissions: AgentPermissions | null): string {
  const t = PROFILE_TEXTS[p.lang];
  const ask = [
    ...p.askFirst.map((id) => t.ask[id] ?? id),
    ...(p.askFirstText ? [p.askFirstText] : []),
  ];
  const can = permissions
    ? [
        permissions.vault ? t.can.vaultWrite : t.can.vaultRead,
        permissions.web ? t.can.web : t.can.noWeb,
        ...(permissions.shell ? [t.can.shell] : []),
        ...(permissions.folders?.length
          ? [
              t.can.folders(
                permissions.folders
                  .map((f) => `${f.path}${f.write ? '' : t.can.readOnly}`)
                  .join(', '),
              ),
            ]
          : []),
      ]
    : [];
  return t.note({
    user: p.userName,
    orchestrator: p.orchestratorName,
    occupation: list(p.occupation, t.none),
    goals: list(p.goals, t.none),
    delegate: list(p.delegate, t.none),
    tools: list(p.tools, t.none),
    ask: list(ask, t.nothingToAsk),
    tone: p.tone,
    language: p.language,
    style: p.styleNotes,
    can: can.length ? list(can, t.none) : undefined,
  });
}

const DEFAULT_ASK_IDS = ['publish', 'contact', 'spend', 'delete', 'goal'];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * DecisionGate rules from the "ask first" answer: chosen kinds are "ask"
 * rules, unchosen defaults are turned off (they fall to the gray zone, never
 * to "proceed"), free text becomes an extra "ask" rule on its key words.
 */
export function decisionRulesFrom(p: Profile): { rules: DecisionRuleInput[]; disabled: string[] } {
  const chosen = new Set(p.askFirst);
  const rules: DecisionRuleInput[] = DEFAULT_ASK_IDS.filter((id) => chosen.has(id)).map((id) => ({
    id,
    effect: 'ask',
  }));
  const disabled = DEFAULT_ASK_IDS.filter((id) => !chosen.has(id));
  if (p.askFirstText) {
    const words = [
      ...new Set(
        p.askFirstText
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 5),
      ),
    ].slice(0, 5);
    if (words.length > 0) {
      rules.push({
        id: 'user-ask',
        effect: 'ask',
        patterns: words.map((w) => `\\b${escapeRegex(w.slice(0, Math.max(5, w.length - 2)))}`),
        description: p.askFirstText.slice(0, 120),
      });
    }
  }
  return { rules, disabled };
}
