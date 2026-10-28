import {
  autoEffort,
  defineTool,
  ToolError,
  type MonstersTool,
  type Question,
} from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import {
  abortCause,
  type AgentRunResult,
  type RunAgentOptions,
  type TaskBrief,
} from '../agents/run-agent.ts';
import { KilledError, type ControlScope } from '../kill/control-scope.ts';
import type { RunHandle } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { ActionKindSchema, type DecisionGate } from './decision.ts';
import type { DoneChecker, DoneCheckResult } from './instinct/done-check.ts';
import { instinctStrings } from './instinct/instinct.strings.ts';
import { QuestionExpiredError, type QuestionOption, type QuestionStore } from './questions.ts';
import { teamToolsPrompts, type DelegationStopBy } from './team-tools.prompts.ts';
import {
  earlierDelegation,
  rememberDelegation,
  REPEATED_DELEGATION_NOTE,
} from './delegation-memo.ts';
import { DEFAULT_RUN_LIMITS, runBudget, type RunBudget } from './run-limits.ts';
import { proposeMonsterTool, type MonsterProposals } from './propose-monster.ts';
import type { TeamService } from './team-service.ts';
import { unicodeWords } from './word-boundary.ts';

/*
 * Orchestrator tools (ARCHITECTURE §5.4): `delegate` starts a sub-agent with a
 * focused brief and returns a short summary plus the notes it touched, read
 * from the log of the vault (never from the agent's own words);
 * `ask_user` sends the user a question with 2-4 options (or none: an open
 * question answered in free text), after asking the DecisionGate whether the
 * choice really needs the user.
 */

/**
 * ~750 tokens at ~4 characters per token: the report stays in the
 * orchestrator's context for the rest of the run (D-064).
 */
export const MAX_SUMMARY_CHARS = 3000;

/**
 * How long a native run holds a blocking `ask_user` (D-078): an answer within
 * it costs no restart; past it the question is parked and the run ends.
 */
export const ASK_USER_WAIT_MS = 10 * 60_000;

/** What the model reads when its question is parked: end the turn, the answer comes as a new turn. */
export const PARKED_NOTE =
  'The question is now with the user. End your turn now with one short line saying you are waiting ' +
  'for their answer; do not repeat the question in your text and do not decide for them. ' +
  'Their answer will start a new turn, with your question and their answer in front of you.';

export interface SubagentRunParams {
  agent: AgentDefinition;
  brief: TaskBrief;
  run: RunHandle;
  /** Child scope of the run: aborting the run aborts it. */
  scope: ControlScope;
  /** The `delegation` event: parent of the sub-agent's events. */
  parentId: string;
  /** The subtask as the delegating monster wrote it (`subtaskText`): what its level is asked on (D-109). */
  subtask: string;
  /** "Finito davvero?" (D-067): the stop hook of the sub-agent. */
  onFinalAnswer?: RunAgentOptions['onFinalAnswer'];
  /** A teammate's question (`ask_teammate`, D-201): the one asked answers and asks no third. */
  consult?: boolean;
}

export interface TeamToolsContext {
  run: RunHandle;
  /** The orchestrator. */
  self: AgentDefinition;
  team: TeamService;
  log: EventLog;
  questions: QuestionStore;
  gate: DecisionGate;
  /** Cost limits of the run. Default: the run's budget with the default limits. */
  budget?: RunBudget;
  /**
   * `message` event of the user's request being worked on: the one-question
   * limit of `ask_user` counts from there, so a new request in the same run
   * gets its own question (answers to questions are not requests).
   */
  currentRequest?: () => string | undefined;
  /**
   * Text of that request: the context of the DecisionGate and, in every brief,
   * the user's own words (a sub-agent does not see the conversation, D-065).
   */
  requestText?: () => string | undefined;
  /** How the agents address the user ("Giulio"), for the brief. */
  userName?: string;
  /** The project of `self`, when it is a project's capo: its squad is on the project's page. */
  projectName?: string | undefined;
  /** "Finito davvero?" after every delegation (D-067); without it nothing is checked. */
  doneCheck?: DoneChecker;
  /**
   * Level the instinct gave a delegation, by its `delegation` event (D-109: the
   * subtask's own, or the request's), for the scorecard; `chose` when it chose the
   * monster's model (a chain with a light and a strong link), for the receipt.
   */
  tier?: (
    delegation: string,
  ) => { level: 'simple' | 'medium' | 'hard'; chose: boolean } | undefined;
  /**
   * How long a blocking `ask_user` holds the call before it parks the
   * question (D-078): 0 on a harness (Claude Code, Codex: never hold a call),
   * `ASK_USER_WAIT_MS` by default.
   */
  askWaitMs?: () => number;
  /**
   * Who `delegate` may reach: the monsters of the coordinator's squad (D-097:
   * the Squadra personale for the orchestrator, its project for a lead).
   * Default: every monster of the team.
   */
  members?: () => AgentDefinition[];
  runSubagent(params: SubagentRunParams): Promise<AgentRunResult>;
  /** Draft flow of the team (`team_propose_monster`, D-075); without it the tool is not given. */
  proposals?: MonsterProposals;
}

/** What one delegation needs of the context: `delegate` and `ask_teammate` share it. */
type DelegationContext = Pick<
  TeamToolsContext,
  | 'run'
  | 'self'
  | 'team'
  | 'log'
  | 'budget'
  | 'doneCheck'
  | 'tier'
  | 'requestText'
  | 'userName'
  | 'runSubagent'
>;

/*
 * Delegations still settling after their run was aborted: the model loop stops at
 * once on a kill, while a delegation still has to stop its sub-agent and log
 * `aborted`. The dispatcher awaits them before reporting the run as ended.
 */
const inflight = new WeakMap<RunHandle, Set<Promise<unknown>>>();

function trackInflight<I, O>(run: RunHandle, tool: MonstersTool<I, O>): MonstersTool<I, O> {
  return {
    ...tool,
    execute(input, tc) {
      const p = tool.execute(input, tc);
      let set = inflight.get(run);
      if (!set) inflight.set(run, (set = new Set()));
      set.add(p);
      const done = () => set.delete(p);
      p.then(done, done);
      return p;
    },
  };
}

/** Resolves when every delegation of the run has settled (or after `timeoutMs`). */
export async function inflightSettled(run: RunHandle, timeoutMs = 5000): Promise<void> {
  const set = inflight.get(run);
  if (!set || set.size === 0) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...set]),
    new Promise<void>((r) => (timer = setTimeout(r, timeoutMs))),
  ]);
  clearTimeout(timer);
}

export function truncateSummary(
  text: string,
  max = MAX_SUMMARY_CHARS,
): { text: string; truncated: boolean } {
  const t = text.trim();
  if (t.length <= max) return { text: t, truncated: false };
  const cut = t.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return {
    text: `${(lastBreak > max * 0.6 ? cut.slice(0, lastBreak + 1) : cut).trimEnd()}${teamToolsPrompts().summaryCut}`,
    truncated: true,
  };
}

/** Small models often pass a single string where a list is expected. */
const oneOrMany = (v: unknown) => (typeof v === 'string' ? [v] : v);

const DelegateInput = z.object({
  agent: z.string().min(1).describe('Name of the team member, e.g. "Rhea"'),
  goal: z.string().min(1).max(2000).describe('What to achieve, in one or two sentences'),
  why: z.string().max(1000).optional().describe('Why it is needed and decisions already taken'),
  context_links: z
    .preprocess(oneOrMany, z.array(z.string().min(1).max(300)).max(20))
    .optional()
    .describe('Vault notes to read, as paths or [[wikilinks]]: links, not their content'),
  constraints: z.preprocess(oneOrMany, z.array(z.string().min(1).max(500)).max(10)).optional(),
  output_format: z.string().max(500).optional().describe('What the result looks like'),
  done_when: z.string().max(500).optional().describe('When the task is finished'),
});

/**
 * The schema with the team's names as an enum in the JSON schema (AG-25): free
 * models pick a name from the list instead of guessing it. The value stays a
 * string: "rhea" or "@Rhea" still find Rhea, any other name gets `NOT_FOUND`
 * with the team in the hint.
 */
export function delegateInputSchema(names: readonly string[]) {
  if (names.length === 0) return DelegateInput;
  return DelegateInput.extend({
    agent: z
      .string()
      .min(1)
      .meta({ description: 'Name of the team member', enum: [...names] }),
  });
}

type DelegateInputValue = z.infer<typeof DelegateInput>;

/** Fields of the brief the delegating agent may fill, as `delegate` names them. */
const BRIEF_FIELDS = ['why', 'context_links', 'constraints', 'output_format', 'done_when'] as const;
/** The user's request in a brief: enough for the words and the implicit constraints. */
const MAX_REQUEST_CHARS = 600;

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The brief of a delegation with its defaults (review AG-11), so a free model
 * that writes only `agent` and `goal` still gives a complete brief: the user's
 * request in `why` (the sub-agent never sees the conversation), "done when"
 * and the result format from the agent's blueprint. `filled` lists the fields
 * the delegating agent wrote itself.
 */
export function completeBrief(
  input: DelegateInputValue,
  defaults: {
    request?: string | undefined;
    user?: string | undefined;
    area?: string;
    report?: string;
  },
): { brief: TaskBrief; filled: string[] } {
  const filled = BRIEF_FIELDS.filter((k) => {
    const v = input[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v?.trim());
  });
  const request = defaults.request?.trim();
  const repeated =
    !request ||
    plain(`${input.goal}\n${input.why ?? ''}`).includes(plain(request.slice(0, MAX_REQUEST_CHARS)));
  const clipped =
    request && request.length > MAX_REQUEST_CHARS
      ? `${request.slice(0, MAX_REQUEST_CHARS - 1)}…`
      : request;
  const t = teamToolsPrompts();
  const asked = repeated ? undefined : t.requestOf(defaults.user, clipped!);
  const why = [input.why?.trim(), asked].filter(Boolean).join('\n');
  const doneWhen =
    input.done_when?.trim() || (defaults.area ? t.doneWhenSaved(defaults.area) : t.doneWhenReport);
  const outputFormat = input.output_format?.trim() || defaults.report;
  return {
    brief: {
      goal: input.goal,
      ...(why ? { why } : {}),
      ...(input.context_links?.length ? { contextLinks: input.context_links } : {}),
      ...(input.constraints?.length ? { constraints: input.constraints } : {}),
      ...(outputFormat ? { outputFormat } : {}),
      doneWhen,
    },
    filled,
  };
}

/**
 * The subtask as the delegating monster wrote it (D-109): what the level of the
 * delegation is asked on. Without the user's request that `completeBrief` adds
 * to `why`: the level is the subtask's, the request has its own.
 */
export function subtaskText(input: DelegateInputValue): string {
  const why = input.why?.trim();
  const format = input.output_format?.trim();
  const done = input.done_when?.trim();
  const t = teamToolsPrompts();
  return [
    input.goal.trim(),
    why ? t.subtaskWhy(why) : '',
    input.constraints?.length ? t.subtaskConstraints(input.constraints.join('; ')) : '',
    format ? t.subtaskResult(format) : '',
    done ? t.subtaskDone(done) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** `completeBrief` with the defaults of `target` (its blueprint) and of the run. */
export async function delegationBrief(
  ctx: DelegationContext,
  target: AgentDefinition,
  input: DelegateInputValue,
): Promise<{ brief: TaskBrief; filled: string[] }> {
  const fields = await ctx.team.instructionFields(target.config.id);
  const sub = fields?.kind === 'subagent' ? fields : undefined;
  return completeBrief(input, {
    request: ctx.requestText?.(),
    user: sub?.user ?? ctx.userName,
    ...(sub ? { area: sub.outputArea, report: sub.report.replace(/\.$/, '') } : {}),
  });
}

/** Notes a delegation touched, from its `vault_change` events. */
class TouchedNotes {
  readonly created = new Set<string>();
  readonly changed = new Set<string>();
  readonly deleted = new Set<string>();
  readonly proposed = new Set<string>();

  add(change: { action: string; path: string }): void {
    const { action, path } = change;
    if (action === 'create') this.created.add(path);
    else if (action === 'delete') {
      this.deleted.add(path);
      this.created.delete(path);
      this.changed.delete(path);
    } else if (action === 'propose') this.proposed.add(path);
    else if (!this.created.has(path)) this.changed.add(path);
  }

  /**
   * What the vault says the agent did, for the orchestrator: explicit even when
   * nothing happened, so it cannot report a note that does not exist.
   */
  report(name: string): {
    notes_created: string[];
    notes_changed: string[];
    notes_check: string;
  } {
    const list = (s: Set<string>) => [...s].join(', ');
    const said: string[] = [];
    if (this.created.size) said.push(`created ${list(this.created)}`);
    if (this.changed.size) said.push(`changed ${list(this.changed)}`);
    if (this.deleted.size) said.push(`deleted ${list(this.deleted)}`);
    if (this.proposed.size) said.push(`proposed changes to ${list(this.proposed)}`);
    const check = said.length
      ? `From the vault log: ${name} ${said.join('; ')}. No other note was created or changed.`
      : `From the vault log: ${name} created no note and changed none.`;
    return {
      notes_created: [...this.created],
      notes_changed: [...this.changed],
      notes_check: `${check} Mention only these notes, whatever the summary says.`,
    };
  }
}

/** The scope of one delegation in its run: the monster it went to, and its `started` event. */
export function delegationScopeId(to: string, startedId: string): string {
  return `${to}:${startedId}`;
}

/** The monster and the `started` event of a delegation's scope id; null for any other id. */
export function parseDelegationScope(id: string): { to: string; startedId: string } | null {
  const at = id.lastIndexOf(':');
  return at > 0 && at < id.length - 1 ? { to: id.slice(0, at), startedId: id.slice(at + 1) } : null;
}

/**
 * Who or what stopped a delegated run that did not complete (D-160), from the facts the core
 * has: the run's own cause, its status (a limit), the error, the reason of the stopped scope.
 */
export function delegationStop(
  result: AgentRunResult | undefined,
  scopeReason: unknown,
  failed: boolean,
): DelegationStopBy {
  if (result?.stopCause) return result.stopCause;
  const status = result?.status;
  if (status === 'run_limit' || status === 'token_limit' || status === 'max_steps') return status;
  if (failed || status === 'failed') return 'error';
  return abortCause(scopeReason) ?? 'unknown';
}

/** One delegation: logs it, runs the sub-agent in a child scope, returns the short report. */
async function runDelegation(
  ctx: DelegationContext,
  target: AgentDefinition,
  input: z.infer<typeof DelegateInput>,
  tc: Parameters<MonstersTool['execute']>[1],
) {
  const { run, log } = ctx;
  const from = ctx.self.config.id;
  const to = target.config.id;
  const { brief, filled } = await delegationBrief(ctx, target, input);
  // Stopped while the brief was being written: the task never starts (no "started" after a stop).
  tc.signal.throwIfAborted();
  const delegation = {
    from,
    to,
    goal: brief.goal,
    ...(brief.why ? { why: brief.why } : {}),
    ...(brief.doneWhen ? { doneWhen: brief.doneWhen } : {}),
    ...(brief.contextLinks?.length ? { contextLinks: brief.contextLinks } : {}),
    filled,
  };
  const parentId = tc.callEventId ?? null;
  const started = log.append({
    agent: from,
    runId: run.id,
    parentId,
    type: 'delegation',
    data: { ...delegation, status: 'started' },
  });

  // Notes touched by this delegation: vault_change events under its tool calls;
  // the tools it called and what its model calls cost (pagella dei mostri, D-067).
  const calls = new Set<string>();
  const toolNames = new Set<string>();
  const notes = new TouchedNotes();
  let costUsd: number | undefined;
  const unsubscribe = log.subscribe((e) => {
    if (e.runId !== run.id || e.agent !== to) return;
    if (e.type === 'tool_call' && e.parentId === started.id) {
      calls.add(e.id);
      toolNames.add(e.data.tool);
    } else if (e.type === 'vault_change' && e.parentId && calls.has(e.parentId)) {
      notes.add(e.data);
    } else if (e.type === 'provider_usage' && e.parentId === started.id) {
      if (e.data.costUsd !== undefined) costUsd = (costUsd ?? 0) + e.data.costUsd;
    }
  });

  // "Finito davvero?" (D-067): on the facts of the log, once as the sub-agent's
  // stop hook (a reminder and a few more steps), then on the final report.
  const doneCheck = ctx.doneCheck?.enabled ? ctx.doneCheck : undefined;
  const checkInput = (summary: string) => ({
    goal: brief.goal,
    doneWhen: brief.doneWhen,
    constraints: brief.constraints,
    filled,
    summary,
    notesCreated: [...notes.created],
    notesChanged: [...notes.changed],
    tools: [...toolNames],
  });
  const checkCtx = { agent: from, runId: run.id, parentId: started.id, signal: tc.signal };
  const runCheck = async (summary: string): Promise<DoneCheckResult | undefined> => {
    try {
      return await doneCheck!.check(checkInput(summary), checkCtx);
    } catch (err) {
      if (tc.signal.aborted) throw err;
      return undefined;
    }
  };
  let firstCheck: DoneCheckResult | undefined;
  const onFinalAnswer = doneCheck
    ? async (text: string) => {
        firstCheck = await runCheck(text);
        return firstCheck?.reminder ? { text: firstCheck.reminder, textCounts: true } : null;
      }
    : undefined;

  const scope = run.child('agent', delegationScopeId(to, started.id));
  let result: AgentRunResult | undefined;
  let failure: unknown;
  try {
    result = await ctx.runSubagent({
      agent: target,
      brief,
      run,
      scope,
      parentId: started.id,
      subtask: subtaskText(input),
      ...(onFinalAnswer ? { onFinalAnswer } : {}),
    });
  } catch (err) {
    failure = err;
  } finally {
    unsubscribe();
    scope.close();
  }

  const levelOf = ctx.tier?.(started.id);
  const level = levelOf?.chose ? levelOf.level : undefined;
  const tier: 'light' | 'strong' | undefined =
    levelOf?.level === 'simple' ? 'light' : levelOf?.level === 'hard' ? 'strong' : undefined;
  /** What the scorecard and the receipt read on the `delegation` event. */
  const facts = {
    ...(result?.model ? { model: `${result.model.provider}:${result.model.model}` } : {}),
    ...(tier ? { tier } : {}),
    ...(level ? { level } : {}),
    // "Automatica" (D-110): the effort of the model that served it.
    ...(target.config.autoModels && result?.model && autoEffort(result.model.model)
      ? { effort: autoEffort(result.model.model) }
      : {}),
    ...(result ? { steps: result.steps } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(result && result.status !== 'completed' ? { runStatus: result.status } : {}),
    // Which cap it was, for the UI to say it in the person's language.
    ...(result?.limit ? { limit: result.limit } : {}),
  };
  const name = target.config.name;
  /** What was done before the stop (D-160): the lead says it instead of "did not respond". */
  const done = { steps_done: result?.steps ?? 0, tools_used: [...toolNames] };
  const aborted = tc.signal.aborted || scope.aborted || result?.status === 'aborted';
  if (aborted) {
    const by = delegationStop(result, scope.signal.reason, false);
    const reason = teamToolsPrompts().stoppedBy(by, name, '');
    log.append({
      agent: from,
      runId: run.id,
      parentId,
      type: 'delegation',
      data: { ...delegation, status: 'aborted', error: reason, ...facts },
    });
    if (tc.signal.aborted) throw tc.signal.reason ?? new KilledError('agent');
    const partial = truncateSummary(result?.finalText || result?.text || '').text;
    return {
      agent: name,
      status: 'aborted',
      stopped_by: by,
      reason,
      ...done,
      ...(partial ? { partial } : {}),
      ...notes.report(name),
      next: teamToolsPrompts().stoppedNext,
    };
  }
  const failedCheck = { verdict: 'failed' as const, criteria: [] };
  if (failure !== undefined || result?.status === 'failed') {
    const error = failure instanceof Error ? failure.message : (result?.error ?? String(failure));
    const by = delegationStop(failure !== undefined ? undefined : result, undefined, true);
    log.append({
      agent: from,
      runId: run.id,
      parentId,
      type: 'delegation',
      data: { ...delegation, status: 'failed', error, check: failedCheck, ...facts },
    });
    const partial = truncateSummary(result?.finalText || result?.text || '').text;
    return {
      agent: name,
      status: 'failed',
      error,
      stopped_by: by,
      reason: teamToolsPrompts().stoppedBy(by, name, error),
      ...done,
      ...(partial ? { partial } : {}),
      ...notes.report(name),
      next: DELEGATION_FAILED_NEXT,
    };
  }
  // The report is the agent's last message, not the announcements of its steps (D-064).
  const summary = truncateSummary(result!.finalText || result!.text);
  if (!summary.text && result!.status !== 'completed') {
    // Stopped at a limit without a word: nothing to present as a result (AG-03).
    const error = `${target.config.name} stopped at its limit (${result!.status}) without a report`;
    log.append({
      agent: from,
      runId: run.id,
      parentId,
      type: 'delegation',
      data: { ...delegation, status: 'failed', error, check: failedCheck, ...facts },
    });
    const partial = truncateSummary(result!.text).text;
    const by = delegationStop(result, undefined, false);
    return {
      agent: name,
      status: 'failed',
      error,
      stopped_by: by,
      reason: teamToolsPrompts().stoppedBy(by, name, result!.error ?? ''),
      ...done,
      ...(partial ? { partial } : {}),
      ...notes.report(name),
      next: DELEGATION_FAILED_NEXT,
    };
  }
  if (result!.status !== 'completed') {
    /*
     * Stopped at a limit with something written (D-160): a partial report, never a
     * completed delegation. The event says "stopped" with the limit (`runStatus`), the
     * report keeps what was written and says what stopped it.
     */
    const by = delegationStop(result, undefined, false);
    const reason = teamToolsPrompts().stoppedBy(by, name, result!.error ?? '');
    log.append({
      agent: from,
      runId: run.id,
      parentId,
      type: 'delegation',
      data: { ...delegation, status: 'aborted', summary: summary.text, error: reason, ...facts },
    });
    return {
      agent: name,
      status: result!.status,
      stopped_by: by,
      reason,
      summary: summary.text,
      partial: true,
      ...done,
      ...notes.report(name),
      ...(summary.truncated ? { truncated: true } : {}),
      next: teamToolsPrompts().partialNext,
    };
  }

  // The verdict on the final report: again after a reminder, or the first time
  // when the hook did not run (a harness, a stop at a limit).
  const retried = Boolean(firstCheck?.reminder && result!.followUp);
  let check = firstCheck;
  if (doneCheck && (retried || !check)) check = (await runCheck(summary.text)) ?? check;
  if (retried) {
    instinctEvent(ctx, 'retry', target, {
      message: instinctStrings().retried(target.config.name),
      parentId: started.id,
      details: { missing: firstCheck!.missing, after: check?.verdict ?? 'unchecked' },
    });
  }
  if (check?.verdict === 'doubt') {
    instinctEvent(ctx, 'doubt', target, {
      message: instinctStrings().inDoubt(target.config.name, check.doubt ?? ''),
      parentId: started.id,
      details: {
        doubt: check.doubt ?? '',
        // What the person needs to decide (V-doubt): the criteria the check was unsure of,
        // the notes the monster delivered and the task itself.
        points: unsureCriteria(check),
        notes: [...new Set([...notes.created, ...notes.changed])],
        goal: brief.goal,
      },
    });
  }
  const logged =
    check && (check.verdict !== 'unchecked' || check.criteria.length > 0)
      ? {
          check: {
            verdict: check.verdict,
            criteria: check.criteria,
            ...(retried ? { retried } : {}),
          },
        }
      : {};
  log.append({
    agent: from,
    runId: run.id,
    parentId,
    type: 'delegation',
    data: { ...delegation, status: 'completed', summary: summary.text, ...logged, ...facts },
  });
  return {
    agent: target.config.name,
    status: result!.status,
    summary: summary.text,
    ...notes.report(target.config.name),
    ...(summary.truncated ? { truncated: true } : {}),
    ...checkReport(check),
    next: nextAfter(check),
  };
}

/** The texts of the criteria the check was unsure of (the middle band of the instinct). */
export function unsureCriteria(check: DoneCheckResult): string[] {
  return check.criteria.filter((c) => c.ok === null && c.by === 'model').map((c) => c.text);
}

/** What the orchestrator reads next, by the verdict of the check. */
function nextAfter(check: DoneCheckResult | undefined): string {
  if (check?.verdict === 'incomplete') return DELEGATION_INCOMPLETE_NEXT;
  if (check?.verdict === 'doubt') return delegationDoubtNext(unsureCriteria(check));
  return DELEGATION_NEXT;
}

/** What the orchestrator reads of "finito davvero?" (D-067). */
function checkReport(check: DoneCheckResult | undefined): Record<string, string> {
  if (!check) return {};
  if (check.verdict === 'verified') return { check: 'ok' };
  if (check.verdict === 'doubt') {
    return {
      check: teamToolsPrompts().checkDoubt,
      check_reason: check.doubt ?? 'some criterion is not clear',
    };
  }
  if (check.verdict === 'incomplete') {
    return { check: teamToolsPrompts().checkIncomplete, check_reason: check.missing.join('; ') };
  }
  return {};
}

function instinctEvent(
  ctx: DelegationContext,
  action: 'retry' | 'doubt',
  target: AgentDefinition,
  e: { message: string; parentId: string; details?: Record<string, unknown> },
): void {
  ctx.log.append({
    agent: 'system',
    runId: ctx.run.id,
    parentId: e.parentId,
    type: 'instinct',
    data: {
      use: 'done_check',
      action,
      message: e.message,
      subject: target.config.id,
      ...(e.details ? { details: e.details } : {}),
    },
  });
}

/** Read after a report the check found incomplete: it must not reach the user as done. */
export const DELEGATION_INCOMPLETE_NEXT =
  'The check of the system says the result is incomplete (check_reason). Do not present it as done: ' +
  'tell the user plainly what is missing, or delegate once more only for what is missing.';

/**
 * Read after a report the check was unsure of (middle band): the lead verifies before it
 * replies, instead of passing the doubt on or ignoring it.
 */
export function delegationDoubtNext(points: readonly string[]): string {
  const list = points.length > 0 ? ` about: ${points.map((p) => `"${p}"`).join('; ')}` : '';
  return (
    `The check of the system is unsure${list} (check_reason). Before you reply, read the notes ` +
    'the member delivered (notes_created, notes_changed) and verify those points yourself. If ' +
    'something is really missing, ask the member again for it once, or say it plainly in your ' +
    'reply. Do not present the result as certain.'
  );
}

/**
 * Read right after the report, when the orchestrator decides how to reply: the
 * same rule in AGENTS.md alone was not enough for free models (docs/eval/2026-10-14-demo.md).
 */
export const DELEGATION_NEXT =
  'Check the result, then reply. If it has variants (tone, cut, title), call ask_user now: which one, ' +
  'one question for the whole task even with several texts (each option is a variant for all of them), ' +
  '2-4 options, your recommendation, kind "taste". A single version is delivered as a draft. ' +
  'Do not end your reply with a question, and do not ask whether to publish or send: no tool of yours does it.';

/** Read after a failed delegation: no result to invent, no empty summary to pass off. */
export const DELEGATION_FAILED_NEXT =
  'The task failed: there is no result. Tell the user plainly what failed (the error, in their language) ' +
  'and do not present any result or note of this agent as done. You may delegate again once if it makes sense.';

export function delegateTool(ctx: TeamToolsContext): MonstersTool {
  // Resolved at call time: building the tool needs no run (schema-only uses).
  const budget = () => ctx.budget ?? runBudget(ctx.run);
  const limits = ctx.budget?.limits ?? DEFAULT_RUN_LIMITS;
  const members = () =>
    (ctx.members?.() ?? ctx.team.list()).filter((a) => a.config.id !== ctx.self.config.id);
  const names = () =>
    members()
      .map((a) => `${a.config.name} (${a.config.role})`)
      .join(', ');
  return trackInflight(
    ctx.run,
    defineTool({
      name: 'delegate',
      description: teamToolsPrompts().delegateDescription(
        limits.maxParallelDelegations,
        limits.maxDelegationsPerRun,
      ),
      inputSchema: delegateInputSchema(members().map((a) => a.config.name)),
      async execute(input, tc) {
        const found = ctx.team.get(input.agent);
        // Names are unique across the squads: a monster of another squad is not this one's (D-097).
        const target =
          found && members().some((m) => m.config.id === found.config.id) ? found : undefined;
        if (!target) {
          throw new ToolError('NOT_FOUND', `no team member called "${input.agent}"`, {
            hint: `Team: ${names() || 'nobody else'}.`,
          });
        }
        // The same goal already completed by the same agent in this run (AG-16).
        const earlier = earlierDelegation(ctx.run, target.config.id, input.goal);
        if (earlier) return { ...earlier, repeated: true, note: REPEATED_DELEGATION_NOTE };
        // Parallel and total caps: a clear error, before anything is logged or started.
        const release = budget().beginDelegation();
        try {
          const report = await runDelegation(ctx, target, input, tc);
          rememberDelegation(ctx.run, target.config.id, input.goal, report);
          return report;
        } finally {
          release();
        }
      },
    }),
  );
}

/** A monster asks a teammate of its squad (D-201): the one asked answers, never a third. */
export const ASK_TEAMMATE = 'ask_teammate';

const TeammateInput = z.object({
  agent: z.string().min(1).describe('Name of the teammate, e.g. "Rhea"'),
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe('What you need from them, in one or two sentences'),
  context: z
    .string()
    .max(1000)
    .optional()
    .describe('What you are working on and what you already know: they do not see your task'),
  context_links: z
    .preprocess(oneOrMany, z.array(z.string().min(1).max(300)).max(10))
    .optional()
    .describe('Vault notes to read, as paths or [[wikilinks]]: links, not their content'),
});

/**
 * `ask_teammate` (D-201): a monster at work asks another monster of its squad, never a
 * coordinator (the lead that delegated is waiting on it), and waits for the answer. It is a
 * delegation from that monster, so the log, the kill switch, the run's caps and the notes it
 * touched work as for `delegate`; the one asked runs without this tool (`consult`), so a
 * question never becomes a chain. No "finito davvero?": the asker judges the answer itself.
 */
export function askTeammateTool(
  ctx: Omit<DelegationContext, 'doneCheck'> & { members: () => AgentDefinition[] },
): MonstersTool {
  const budget = () => ctx.budget ?? runBudget(ctx.run);
  const peers = () => ctx.members().filter((a) => a.config.id !== ctx.self.config.id);
  const names = () =>
    peers()
      .map((a) => `${a.config.name} (${a.config.role})`)
      .join(', ');
  const t = teamToolsPrompts();
  return trackInflight(
    ctx.run,
    defineTool({
      name: ASK_TEAMMATE,
      description: t.askTeammateDescription(names() || 'nobody else'),
      inputSchema: TeammateInput.extend({
        agent: z
          .string()
          .min(1)
          .meta({ description: 'Name of the teammate', enum: peers().map((a) => a.config.name) }),
      }),
      async execute(input, tc) {
        const found = ctx.team.get(input.agent);
        const target =
          found && peers().some((m) => m.config.id === found.config.id) ? found : undefined;
        if (!target) {
          throw new ToolError('NOT_FOUND', `no teammate called "${input.agent}"`, {
            hint: `Teammates: ${names() || 'nobody else'}.`,
          });
        }
        const goal = input.question;
        const earlier = earlierDelegation(ctx.run, target.config.id, goal);
        if (earlier) return { ...earlier, repeated: true, note: REPEATED_DELEGATION_NOTE };
        const release = budget().beginDelegation();
        try {
          const why = [t.consultFrom(ctx.self.config.name), input.context?.trim()]
            .filter(Boolean)
            .join('\n');
          const report = await runDelegation(
            {
              ...ctx,
              // The one asked answers: it never asks a third monster.
              runSubagent: (p) => ctx.runSubagent({ ...p, consult: true }),
            },
            target,
            {
              agent: input.agent,
              goal,
              why,
              ...(input.context_links?.length ? { context_links: input.context_links } : {}),
              output_format: t.consultFormat,
              done_when: t.consultDone,
            },
            tc,
          );
          const answered = report.status === 'completed' && 'summary' in report;
          const out = { ...report, next: answered ? t.consultNext : t.consultFailedNext };
          rememberDelegation(ctx.run, target.config.id, goal, out);
          return out;
        } finally {
          release();
        }
      },
    }),
  );
}

const OptionInput = z.union([
  z.string().min(1).max(200),
  z.object({
    label: z.string().min(1).max(200).describe('Short name of the option'),
    description: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Recommended: what the option contains, so the user can choose without opening the notes',
      ),
  }),
]);

/**
 * A label that names an option without saying what it is ("Variante A",
 * "Opzione 2 (consigliata)"): the user cannot choose from it (Phase 1 demo).
 */
const GENERIC_LABEL =
  /^\s*(variante|versione|opzione|scelta|bozza|variant|version|option|choice|draft)\s*[a-z0-9]{1,2}\s*(\(?\s*(consigliat[ao]|raccomandat[ao]|recommended)\s*\)?)?\s*[.:!]?\s*$/i;

/** Every label is a bare "Variante A" and some option has no description: nothing to choose from. */
export function optionsWithoutContent(options: readonly QuestionOption[]): boolean {
  return (
    options.length > 0 &&
    options.every((o) => GENERIC_LABEL.test(o.label)) &&
    options.some((o) => !o.description?.trim())
  );
}

const AskUserInput = z.object({
  question: z.string().min(1).max(1000).describe('One clear question'),
  options: z
    .array(OptionInput)
    .max(4)
    .optional()
    .refine((o) => o === undefined || o.length !== 1, {
      message: 'give 2-4 options, or none for an open question',
    })
    .describe(
      '2-4 options, each saying what it contains (label + description); leave out for an open question answered in free text',
    ),
  recommended: z
    .string()
    .optional()
    .describe('The option you recommend (its label or its number, 1-4)'),
  blocking: z
    .boolean()
    .optional()
    .describe('Wait for the answer (default true). False: keep working, the answer arrives later'),
  kind: ActionKindSchema.optional().describe(
    'What the choice leads to: publish, contact (third parties), spend, delete, goal_change, taste, local, other',
  ),
});

/** Choices that always reach the user, even after another question of the task. */
const CONSEQUENTIAL_KINDS = new Set(['publish', 'contact', 'spend', 'delete', 'goal_change']);
/**
 * Closed roots (AG-02): `pag\w*` took "pagina", `invi\w*` "invito", `compr\w*`
 * "compreso", so a second choice of taste about "la pagina" passed the limit.
 */
const CONSEQUENTIAL_WORDS = unicodeWords(
  /\b(pubblic\w*|invi(a|ano|amo|are|arl[aeio]|ata|ate|ati|ato|i|iamo|o|erò|eremo)|sped\w*|pag(a|ano|are|arl[aeio]|ata|ate|ati|ato|amento|amenti|o|herò|heremo|hi\w*)|compr(a|ano|are|arl[aeio]|ata|ate|ati|ato|iamo|o|erò|eremo)|acquist\w*|cancell\w*|elimin\w*|publish\w*|send\w*|pay(s|ing|ment\w*)?|paid|buy\w*|delet\w*|purchas\w*|cancel\w*)\b/iu, // i18n-ignore
);

/**
 * The question with options this agent already asked for the same request
 * (`asked`: the questions since the request), when a new one would be a second
 * choice of the same task (the user gets one card per request, criterion 2 of
 * Phase 1; the free model asked one question per post). Open questions (facts)
 * and consequential choices are never limited.
 */
export function earlierChoice(
  asked: readonly Question[],
  agent: string,
  next: { question: string; options: readonly QuestionOption[]; kind?: string | undefined },
): Question | undefined {
  if (next.options.length === 0) return undefined;
  if (next.kind && CONSEQUENTIAL_KINDS.has(next.kind)) return undefined;
  if (CONSEQUENTIAL_WORDS.test([next.question, ...next.options.map((o) => o.label)].join('\n'))) {
    return undefined;
  }
  return asked.find((q) => q.from === agent && q.options.length >= 2 && q.status !== 'expired');
}

function resolveRecommended(
  options: QuestionOption[],
  raw: string | undefined,
): QuestionOption | undefined {
  if (raw === undefined) return undefined;
  const r = raw.trim().toLowerCase();
  return options.find((o) => o.id === r || o.label.trim().toLowerCase() === r);
}

export function askUserTool(ctx: TeamToolsContext): MonstersTool {
  return defineTool({
    name: 'ask_user',
    description: teamToolsPrompts().askUserDescription,
    inputSchema: AskUserInput,
    async execute(input, tc) {
      const options: QuestionOption[] = (input.options ?? []).map((o, i) =>
        typeof o === 'string'
          ? { id: String(i + 1), label: o }
          : {
              id: String(i + 1),
              label: o.label,
              ...(o.description ? { description: o.description } : {}),
            },
      );
      if (optionsWithoutContent(options)) {
        throw new ToolError('INVALID_INPUT', 'the options do not say what they contain', {
          hint: teamToolsPrompts().optionsWithoutContentHint,
        });
      }
      const { run } = ctx;
      const agent = ctx.self.config.id;
      const request = ctx.currentRequest?.();
      const sinceRequest = ctx.questions
        .list({ runId: run.id })
        .filter((q) => request === undefined || (ctx.questions.eventIdOf(q.id) ?? '') > request);
      const earlier = earlierChoice(sinceRequest, agent, {
        question: input.question,
        options,
        kind: input.kind,
      });
      if (earlier) {
        const chosen =
          earlier.options.find((o) => o.id === earlier.answer?.optionId)?.label ??
          earlier.answer?.text;
        throw new ToolError('LIMIT_REACHED', 'one question per task: the user already chose', {
          hint:
            `You already asked "${earlier.question}"` +
            (earlier.status === 'open'
              ? ', still waiting for the answer'
              : ` and the user answered "${chosen ?? ''}"`) +
            '. Apply that choice to the rest of the task (e.g. the same variant for every post) ' +
            'or decide yourself and say so in your reply. Next time ask one question that covers everything.',
        });
      }
      const recommended = resolveRecommended(options, input.recommended);
      const blocking = input.blocking ?? true;
      if (!blocking) {
        // Questions left open pile up for the user: a few at a time.
        const open = ctx.questions
          .list({ status: 'open', runId: run.id })
          .filter((q) => !q.blocking);
        (ctx.budget ?? runBudget(run)).assertQuestionRoom(open.length);
      }
      const parentId = tc.callEventId ?? null;

      const decision = await ctx.gate.decide(
        {
          agent,
          runId: run.id,
          parentId,
          question: input.question,
          options: options.map((o) => o.label),
          recommended: recommended?.label,
          kind: input.kind,
          // The request being worked on, not the first message of the run (AG-25).
          context: ctx.requestText?.() ?? run.goal,
        },
        tc.signal,
      );
      if (decision.outcome === 'proceed') {
        return {
          status: 'decided',
          choice: decision.choice,
          decided_by: decision.decidedBy,
          reason: decision.reason,
          note: 'No need to ask: go on with this choice and mention it in your answer.',
        };
      }

      const question = ctx.questions.create({
        agent,
        runId: run.id,
        parentId,
        question: input.question,
        options,
        recommended: recommended?.id,
        blocking,
      });
      if (!blocking) {
        return {
          status: 'sent',
          question_id: question.id,
          note: 'Question sent. Keep working on what does not depend on it: the answer arrives as a message.',
        };
      }
      // A harness never holds the call (D-078): its MCP call would be cut, the
      // question left with nothing behind it. A native run waits a while.
      const waitMs = Math.max(0, ctx.askWaitMs?.() ?? ASK_USER_WAIT_MS);
      const parked = (reason: 'harness' | 'timeout') => {
        ctx.questions.park(question.id, reason);
        return { status: 'waiting_user', question_id: question.id, note: PARKED_NOTE };
      };
      if (waitMs === 0) return parked('harness');
      const timeout = AbortSignal.timeout(waitMs);
      try {
        const answer = await ctx.questions.waitFor(
          question.id,
          AbortSignal.any([tc.signal, timeout]),
        );
        const option = options.find((o) => o.id === answer.optionId);
        return {
          status: 'answered',
          question_id: question.id,
          ...(option ? { choice: option.label } : {}),
          ...(answer.text ? { text: answer.text } : {}),
        };
      } catch (err) {
        if (tc.signal.aborted) throw err;
        if (timeout.aborted && !(err instanceof QuestionExpiredError)) {
          // Answered in the meantime (the answer reaches the run as a message) or still open.
          return ctx.questions.get(question.id)?.status === 'open'
            ? parked('timeout')
            : { status: 'waiting_user', question_id: question.id, note: PARKED_NOTE };
        }
        if (err instanceof QuestionExpiredError) {
          throw new ToolError('ABORTED', 'the question expired without an answer', {
            hint: 'Do not wait for it: finish what you can and tell the user what is left to decide.',
          });
        }
        throw err;
      }
    },
  });
}

export function teamTools(ctx: TeamToolsContext): MonstersTool[] {
  return [
    delegateTool(ctx),
    askUserTool(ctx),
    ...(ctx.proposals ? [proposeMonsterTool({ ...ctx, proposals: ctx.proposals })] : []),
  ];
}
