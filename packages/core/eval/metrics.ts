import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import {
  PROFILE_NOTE_PATH,
  URL_IN_TEXT,
  WEB_SEARCH_USAGE_PROVIDER,
  type LogEvent,
} from '@monsters/shared';
import { stableJson } from '../src/agents/call-tracker.ts';
import { endsWithQuestion } from '../src/team/final-question.ts';
import { FINAL_QUESTION_REMINDERS } from '../src/team/final-question.prompts.ts';
import { DISH_WORDS } from './cases.ts';

/*
 * Automatic checks of one eval run, from the event log and the vault on disk.
 * Heuristics on purpose: simple, explainable, the same before and after.
 */

const IT_WORDS = new Set(
  (
    'il lo la gli le di del della dei delle degli dello che e è per con non un una uno sono nel nella nei ' +
    'alla al alle ai si come più anche questo questa questi ma da dal dalla sul sulla sui ci ha hanno ' +
    'perché quando dove tra fra suo sua nostro nostra molto ogni tutto tutti'
  ).split(' '),
);
const EN_WORDS = new Set(
  (
    'the of and to is for with that are on as by this be from it an or at was which these their ' +
    'have has its not but you your our more most also into than'
  ).split(' '),
);

export type Language = 'it' | 'en' | 'mixed' | 'short';

/** Stopword count: Italian when Italian words clearly win. */
export function detectLanguage(text: string): Language {
  const words = stripForProse(text)
    .toLowerCase()
    .match(/[\p{L}']+/gu);
  if (!words || words.length < 20) return 'short';
  let it = 0;
  let en = 0;
  for (const w of words) {
    if (IT_WORDS.has(w)) it++;
    if (EN_WORDS.has(w)) en++;
  }
  if (it >= 2 * en && it >= 5) return 'it';
  if (en >= 2 * it && en >= 5) return 'en';
  return 'mixed';
}

/** Body without frontmatter. */
export function bodyOf(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Body without links, URLs, code and hashtags: only the prose counts for the language. */
function stripForProse(text: string): string {
  return bodyOf(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ');
}

export interface WikilinkCheck {
  total: number;
  broken: string[];
}

/** Wikilinks whose target is a URL or a note that does not exist. */
export function checkWikilinks(text: string, notes: Set<string>): WikilinkCheck {
  const broken: string[] = [];
  let total = 0;
  for (const m of bodyOf(text).matchAll(/!?\[\[([^\]]+?)\]\]/g)) {
    total++;
    const target = (m[1] ?? '').split('|')[0]!.split('#')[0]!.trim();
    if (/:\/\//.test(target) || !resolves(target, notes)) broken.push(m[0]);
  }
  return { total, broken };
}

function resolves(target: string, notes: Set<string>): boolean {
  const key = target.replace(/\.md$/i, '').toLowerCase();
  if (key === '') return true; // [[#Heading]]: same note
  return notes.has(key) || notes.has(posix.basename(key));
}

export interface LinkCheck {
  markdown: number;
  wikilink: number;
  bare: number;
}

/** External links by form: `[text](url)` (good), inside `[[…]]` (broken in Obsidian), bare. */
export function checkExternalLinks(text: string): LinkCheck {
  const body = bodyOf(text);
  const markdown = [...body.matchAll(/\]\(\s*<?https?:\/\/[^)\s]+/g)].length;
  const wikilink = [...body.matchAll(/\[\[[^\]]*https?:\/\/[^\]]*\]\]/g)].length;
  const all = [...body.matchAll(URL_IN_TEXT)].length;
  return { markdown, wikilink, bare: Math.max(0, all - markdown - wikilink) };
}

/** A file name a person would write: no underscores, not a lowercase-dashed slug. */
export function isNaturalFileName(path: string): boolean {
  const name = posix.basename(path).replace(/\.md$/i, '');
  if (name.includes('_')) return false;
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return false;
  return true;
}

/** Every Markdown note of the vault, as lowercase paths and names without `.md`. */
export function vaultNoteKeys(root: string): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.md')) {
        const rel = relative(root, full).split(sep).join('/').replace(/\.md$/i, '').toLowerCase();
        keys.add(rel);
        keys.add(posix.basename(rel));
      }
    }
  };
  walk(root);
  return keys;
}

export interface NoteReport {
  path: string;
  agent: string;
  language: Language;
  naturalName: boolean;
  wikilinks: number;
  brokenWikilinks: string[];
  links: LinkCheck;
  chars: number;
}

/** Requests and tokens of one agent in the run, from its `provider_usage` events. */
export interface AgentUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens read from the provider's prompt cache. */
  cachedInputTokens: number;
  costUsd: number;
}

/**
 * How the loop went (D-064, AG-09): what the run cost per agent and where it
 * wasted steps. Everything comes from the event log, so a kept run can be
 * scored again offline. `null` where the source has no such data (a run
 * rescored from its saved metrics only, without the events).
 */
export interface LoopMetrics {
  /** Per agent id. Null without the events. */
  agents: Record<string, AgentUsage> | null;
  /**
   * Model steps of each delegation, in order (`to: steps`), with its tool calls
   * by tool (D-071: where the steps of a research go). Null without the events.
   */
  stepsPerDelegation: { to: string; steps: number; tools?: Record<string, number> }[] | null;
  /** Paid web searches of the run (D-071) and what they cost; null without the events. */
  paidSearches?: { count: number; costUsd: number; engines: string[] } | null;
  /** Tool calls of an agent identical to an earlier one of the same agent and turn. */
  repeatedCalls: number | null;
  /** Tool results refused for invalid arguments. */
  invalidInput: number | null;
  /** Calls the runtime repaired before running them (tool name, JSON, keys). */
  repairedCalls: number | null;
  /** Delegations that ended without a summary (completed or not). */
  emptySummaries: number | null;
  /** Average length of the summaries of the delegations that returned one, in characters. */
  avgSummaryChars: number | null;
  /** Delegations to the same agent with the same goal as an earlier one of the run. */
  repeatedDelegations: number;
  /** Moves to the next link of a fallback chain. */
  fallbacks: number;
  /** Agents stopped by a limit (steps, tokens, run budget) instead of finishing. */
  limitStops: number;
}

const LIMIT_CODES = new Set(['max_steps', 'token_limit', 'run_limit']);

const normGoal = (goal: string) =>
  goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Same goal to the same agent twice: the second delegation redoes the first. */
function repeatedDelegationsOf(list: { to: string; goal: string }[]): number {
  const seen = new Set<string>();
  let repeated = 0;
  for (const d of list) {
    const key = `${d.to}|${normGoal(d.goal)}`;
    if (seen.has(key)) repeated++;
    seen.add(key);
  }
  return repeated;
}

export function loopMetrics(events: LogEvent[]): LoopMetrics {
  const agents: Record<string, AgentUsage> = {};
  const delegationSteps = new Map<
    string,
    { to: string; steps: number; tools: Record<string, number> }
  >();
  const paid = { count: 0, costUsd: 0, engines: new Set<string>() };
  const started: { to: string; goal: string }[] = [];
  const callKeys = new Set<string>();
  let repeatedCalls = 0;
  let invalidInput = 0;
  let repairedCalls = 0;
  let emptySummaries = 0;
  const summaries: number[] = [];
  let fallbacks = 0;
  let limitStops = 0;
  for (const e of events) {
    switch (e.type) {
      case 'provider_usage': {
        if (e.data.provider === WEB_SEARCH_USAGE_PROVIDER) {
          // A paid search: a cost, not a model request (D-071).
          paid.count++;
          paid.costUsd += e.data.costUsd ?? 0;
          paid.engines.add(e.data.model);
          break;
        }
        const a = (agents[e.agent] ??= {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          costUsd: 0,
        });
        a.requests++;
        a.inputTokens += e.data.inputTokens ?? 0;
        a.outputTokens += e.data.outputTokens ?? 0;
        a.cachedInputTokens += e.data.cachedInputTokens ?? 0;
        a.costUsd += e.data.costUsd ?? 0;
        const d = e.parentId ? delegationSteps.get(e.parentId) : undefined;
        if (d) d.steps++;
        break;
      }
      case 'delegation':
        if (e.data.status === 'started') {
          delegationSteps.set(e.id, { to: e.data.to, steps: 0, tools: {} });
          started.push({ to: e.data.to, goal: e.data.goal });
        } else if (e.data.status !== 'aborted') {
          const summary = (e.data.summary ?? '').trim();
          if (summary) summaries.push(summary.length);
          else emptySummaries++;
        }
        break;
      case 'tool_call': {
        // Same agent, same turn or delegation (parent), same tool, same arguments.
        const key = `${e.agent}|${e.parentId ?? ''}|${e.data.tool}|${stableJson(e.data.input)}`;
        if (callKeys.has(key)) repeatedCalls++;
        const d = e.parentId ? delegationSteps.get(e.parentId) : undefined;
        if (d) d.tools[e.data.tool] = (d.tools[e.data.tool] ?? 0) + 1;
        callKeys.add(key);
        if (e.data.repaired?.length) repairedCalls++;
        break;
      }
      case 'tool_result':
        if (!e.data.ok && e.data.error?.startsWith('INVALID_INPUT')) invalidInput++;
        break;
      case 'error':
        if (e.data.code === 'provider_fallback') fallbacks++;
        if (e.data.code && LIMIT_CODES.has(e.data.code)) limitStops++;
        break;
      default:
        break;
    }
  }
  return {
    agents,
    stepsPerDelegation: [...delegationSteps.values()],
    paidSearches: {
      count: paid.count,
      costUsd: Math.round(paid.costUsd * 1e6) / 1e6,
      engines: [...paid.engines],
    },
    repeatedCalls,
    invalidInput,
    repairedCalls,
    emptySummaries,
    avgSummaryChars: summaries.length
      ? Math.round(summaries.reduce((n, x) => n + x, 0) / summaries.length)
      : null,
    repeatedDelegations: repeatedDelegationsOf(started),
    fallbacks,
    limitStops,
  };
}

/**
 * What the saved metrics of an older run (without its events) still tell about
 * the loop: delegations repeated and fallbacks, from the lists kept in the
 * result. Everything else is unknown.
 */
export function loopFromStored(m: Pick<RunMetrics, 'delegations' | 'errors'>): LoopMetrics {
  const list = m.delegations.map((d) => {
    const i = d.indexOf(': ');
    return { to: d.slice(0, i), goal: d.slice(i + 2) };
  });
  return {
    agents: null,
    stepsPerDelegation: null,
    repeatedCalls: null,
    invalidInput: null,
    repairedCalls: null,
    emptySummaries: null,
    avgSummaryChars: null,
    repeatedDelegations: repeatedDelegationsOf(list),
    fallbacks: m.errors.filter((e) => /^[^:]+: provider_fallback\b/.test(e)).length,
    limitStops: m.errors.filter((e) => /^[^:]+: (max_steps|token_limit|run_limit)\b/.test(e))
      .length,
  };
}

export interface RunMetrics {
  status: string;
  requests: number;
  durationS: number;
  delegatedResearch: boolean;
  delegatedWriting: boolean;
  /** Who wrote the text to deliver: the writer, or the orchestrator itself. */
  writer: 'dione' | 'orchestrator' | 'none';
  askUserCalls: number;
  /** Questions of the orchestrator that reached the user (with or without options). */
  questionsToUser: number;
  /** ask_user calls the tool refused (invalid options, a second question in the task). */
  askUserRefused: number;
  /** ask_user calls the gate turned into "proceed": the user never saw them. */
  askUserGated: number;
  /** Questions that reached the user with 2-4 options. */
  questionWithOptions: boolean;
  /** Open questions (no options) that reached the user. */
  openQuestions: number;
  /** Reminders of the stop hook (question left in the text). */
  reminders: number;
  /** Answers of the orchestrator ending with a question that no ask_user followed. */
  textQuestionsUnfollowed: number;
  /** Dishes in the writer's notes and the orchestrator's answers that the user never gave. */
  inventedDishes: string[];
  /** One of them is about taste (tone, variant, which draft), not about publishing or sending. */
  tasteQuestion: boolean;
  questions: string[];
  answeredAndClosed: boolean;
  /** The end of the final answer asks something in plain text (a "?" in the last 700 characters). */
  plainTextQuestion: boolean;
  notes: NoteReport[];
  notesItalian: boolean;
  /** The language the monsters were asked to write in (D-153). Missing in older results: Italian. */
  writingLanguage?: 'it' | 'en';
  /** Every note is in the writing language (or too short to tell). Missing in older results. */
  notesInLanguage?: boolean;
  /** Dollars of the model requests of the run (`provider_usage`), paid searches excluded. */
  costUsd?: number;
  brokenWikilinks: number;
  externalLinks: LinkCheck;
  /** External links of the researcher's notes only: the sources (M2.0). */
  researcherLinks: LinkCheck;
  unnaturalNames: string[];
  searchFound: boolean | null;
  /** Every option of the questions with options has a description (null: no such question). */
  optionsDescribed: boolean | null;
  /** Results of vault_write/vault_edit that warned about links never seen in the run (D-026). */
  unverifiedLinkWarnings: number;
  orchestratorTools: string[];
  delegations: string[];
  errors: string[];
  answer: string;
  /** Cost and waste of the loop (D-064). Missing in results saved before it. */
  loop?: LoopMetrics;
}

type Ev = LogEvent;

/** A question of taste: tone, variant, version, style, which draft; not "shall I publish/send?". */
export function isTasteQuestion(text: string): boolean {
  return (
    /(ton[oei]s?\b|varian|version|stile|style|prefer|taglio|angle|bozz|draft|quale|which|approcc|approach)/i.test(
      text,
    ) && !/(pubblic|invi[ao]|spedi|programm|publish|send|schedul)/i.test(text)
  );
}

/**
 * English glosses of a dish the user gave: not a new dish. "Tortelli di zucca — pumpkin ravioli"
 * is the menu's own dish, explained to an English reader (D-153).
 */
const GLOSSES: { of: string; gloss: RegExp }[] = [
  { of: 'tortell', gloss: /\bpumpkin(?:[- ](?:filled|stuffed))? ravioli/g },
  // "tortelli di zucca — golden ravioli stuffed with pumpkin": the same sentence, the same dish.
  { of: 'tortell', gloss: /\btortell[^.\n]{0,80}?ravioli/g },
];

/**
 * Dish words in `written` (lower case) that `given` never has. A word counts where a word
 * starts ("toscanatradizionale" holds no "anatra"; a hashtag glued to the dish it names holds
 * no other); glosses of a given dish are not counted.
 */
export function inventedDishesOf(written: string, given: string): string[] {
  let text = written;
  for (const g of GLOSSES) if (given.includes(g.of)) text = text.replace(g.gloss, ' ');
  const starts = (w: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
  return DISH_WORDS.filter((w) => starts(w).test(text) && !given.includes(w));
}

export function evaluateRun(params: {
  events: Ev[];
  vaultRoot: string;
  orchestratorId: string;
  writerId: string;
  researcherId: string;
  requests: number;
  durationS: number;
  searchFound: boolean | null;
  /** The monsters' writing language of the run. Default Italian (the runs before D-153). */
  writingLanguage?: 'it' | 'en';
}): RunMetrics {
  const { events, vaultRoot, orchestratorId } = params;
  const writingLanguage = params.writingLanguage ?? 'it';
  const of = <T extends Ev['type']>(type: T): LogEvent<T>[] =>
    events.filter((e) => e.type === type) as LogEvent<T>[];
  const runs: LogEvent<'run'>[] = of('run');
  const changes: LogEvent<'vault_change'>[] = of('vault_change');
  const calls: LogEvent<'tool_call'>[] = of('tool_call');
  const errors: LogEvent<'error'>[] = of('error');

  const runEnd = runs.findLast((e) => e.data.status !== 'started');
  const delegations: LogEvent<'delegation'>[] = of('delegation').filter(
    (d) => d.data.status === 'started',
  );
  const delegatedTo = (id: string) => delegations.some((d) => d.data.to === id);
  const askCalls = of('tool_call').filter(
    (e) => e.agent === orchestratorId && e.data.tool === 'ask_user',
  );
  const gated = of('decision').filter(
    (d) => d.data.kind === 'ask_or_proceed' && d.data.choice !== 'ask_user',
  );
  const allQuestions = of('question');
  const questions = allQuestions.filter(
    (q) => q.data.options.length >= 2 && q.data.options.length <= 4,
  );
  const orchestratorAnswers = of('message').filter(
    (e) => e.agent === orchestratorId && e.data.role === 'agent' && !e.data.partial && !e.parentId,
  );
  const unfollowed = orchestratorAnswers.filter(
    (m) => endsWithQuestion(m.data.text) && !askCalls.some((c) => c.id > m.id),
  );
  const reminders = of('message').filter(
    (e) => e.data.role === 'system' && FINAL_QUESTION_REMINDERS.includes(e.data.text),
  );
  const answers = of('answer');
  const final = of('message').findLast(
    (e) => e.agent === orchestratorId && e.data.role === 'agent' && !e.data.partial,
  );
  const answer = final?.data.text ?? '';
  // The closing part of the answer: where a question in plain text ends up.
  const tail = answer.trim().slice(-700);

  const keys = vaultNoteKeys(vaultRoot);
  const touched = new Map<string, string>();
  for (const c of changes) {
    if (c.agent === 'system' || c.agent === 'user') continue;
    if (!['create', 'edit', 'propose'].includes(c.data.action)) continue;
    if (!c.data.path.toLowerCase().endsWith('.md')) continue;
    touched.set(c.data.path, c.agent);
  }
  const notes: NoteReport[] = [];
  for (const [path, agent] of touched) {
    let text: string;
    try {
      text = readFileSync(join(vaultRoot, path), 'utf8');
    } catch {
      continue; // moved or deleted later in the run
    }
    const wl = checkWikilinks(text, keys);
    notes.push({
      path,
      agent,
      language: detectLanguage(text),
      naturalName: path.startsWith('Agenti/') || isNaturalFileName(path),
      wikilinks: wl.total,
      brokenWikilinks: wl.broken,
      links: checkExternalLinks(text),
      chars: bodyOf(text).length,
    });
  }
  const content = notes.filter((n) => !n.path.startsWith('Agenti/'));
  const sumLinks = (list: NoteReport[]) =>
    list.reduce<LinkCheck>(
      (acc, n) => ({
        markdown: acc.markdown + n.links.markdown,
        wikilink: acc.wikilink + n.links.wikilink,
        bare: acc.bare + n.links.bare,
      }),
      { markdown: 0, wikilink: 0, bare: 0 },
    );
  const externalLinks = sumLinks(notes);
  const researcherLinks = sumLinks(content.filter((n) => n.agent === params.researcherId));

  const writing = delegatedTo(params.writerId);

  // Facts the user gave: the profile, the request, the answers to the questions.
  let profile = '';
  try {
    profile = readFileSync(join(vaultRoot, PROFILE_NOTE_PATH), 'utf8');
  } catch {
    // no profile note
  }
  const given = [
    profile,
    ...of('message')
      .filter((e) => e.data.role === 'user')
      .map((e) => e.data.text),
    ...answers.map((a) => a.data.text ?? ''),
  ]
    .join('\n')
    .toLowerCase();
  const written = [
    ...notes
      .filter((n) => n.agent === params.writerId && !n.path.startsWith('Agenti/'))
      .map((n) => {
        try {
          return readFileSync(join(vaultRoot, n.path), 'utf8');
        } catch {
          return '';
        }
      }),
    ...orchestratorAnswers.map((m) => m.data.text),
  ]
    .join('\n')
    .toLowerCase();
  const inventedDishes = inventedDishesOf(written, given);
  const loop = loopMetrics(events);
  const costUsd = Object.values(loop.agents ?? {}).reduce((n, a) => n + a.costUsd, 0);
  return {
    status: runEnd?.data.status ?? 'running',
    requests: params.requests,
    durationS: params.durationS,
    delegatedResearch: delegatedTo(params.researcherId),
    delegatedWriting: writing,
    writer: writing ? 'dione' : answer.length > 400 ? 'orchestrator' : 'none',
    askUserCalls: askCalls.length,
    questionsToUser: allQuestions.filter((q) => q.agent === orchestratorId).length,
    askUserRefused: of('tool_result').filter(
      (r) => r.agent === orchestratorId && r.data.tool === 'ask_user' && !r.data.ok,
    ).length,
    askUserGated: gated.length,
    questionWithOptions: questions.length > 0,
    openQuestions: allQuestions.length - questions.length,
    reminders: reminders.length,
    textQuestionsUnfollowed: unfollowed.length,
    inventedDishes,
    tasteQuestion: questions.some((q) =>
      isTasteQuestion([q.data.question, ...q.data.options.map((o) => o.label)].join('\n')),
    ),
    questions: questions.map(
      (q) => `${q.data.question} [${q.data.options.map((o) => o.label).join(' | ')}]`,
    ),
    answeredAndClosed:
      allQuestions.length > 0 &&
      answers.length >= allQuestions.length &&
      runEnd?.data.status === 'completed',
    plainTextQuestion: /\?/.test(tail),
    notes,
    notesItalian: notes.every((n) => n.language === 'it' || n.language === 'short'),
    writingLanguage,
    notesInLanguage: notes.every((n) => n.language === writingLanguage || n.language === 'short'),
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    brokenWikilinks: notes.reduce((n, x) => n + x.brokenWikilinks.length, 0),
    externalLinks,
    researcherLinks,
    unnaturalNames: content.filter((n) => !n.naturalName).map((n) => n.path),
    searchFound: params.searchFound,
    optionsDescribed:
      questions.length === 0
        ? null
        : questions.every((q) => q.data.options.every((o) => !!o.description?.trim())),
    unverifiedLinkWarnings: of('tool_result').filter(
      (r) =>
        r.data.ok &&
        typeof r.data.output === 'object' &&
        r.data.output !== null &&
        'unverified_links' in r.data.output,
    ).length,
    orchestratorTools: calls.filter((e) => e.agent === orchestratorId).map((e) => e.data.tool),
    delegations: delegations.map((d) => `${d.data.to}: ${d.data.goal.slice(0, 160)}`),
    errors: errors.map((e) => `${e.agent}: ${e.data.code ?? ''} ${e.data.message}`.trim()),
    answer,
    loop,
  };
}
