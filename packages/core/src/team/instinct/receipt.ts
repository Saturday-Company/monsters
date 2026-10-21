import {
  autoEffort,
  WEB_SEARCH_USAGE_PROVIDER,
  type LogEvent,
  type ReceiptData,
  type ToolFailureCause,
  type UndoRunResult,
} from '@monsters/shared';
import { TYPESAFE_PROVIDER_ID } from '../jev.ts';
import type { EventLog } from '../../log/event-log.ts';
import { instinctStrings } from './instinct.strings.ts';

/*
 * The receipt of a job (D-067, research 07 killer feature 2): at the end of
 * every turn the core, not the model, writes what happened from the log:
 * the request, the delegations with their verified outcome (✓/✗ per
 * criterion of `done_when` and `constraints`), the notes created and changed
 * with the commits "Annulla tutto" undoes, the tools that leave the vault,
 * the outbound actions the brake looked at, cost and duration.
 */

/** Tools of a harness that leave the vault (D-069), logged as `claude-agent.Bash`, `codex.shell`. */
const HARNESS_EXTERNAL = new Set([
  'Bash',
  'WebSearch',
  'WebFetch',
  'Write',
  'Edit',
  'shell',
  'file_change',
]);

/** Tools that leave the vault: the web, other programs, the terminal, the files. */
export function isExternalTool(tool: string): boolean {
  const harness = /^(?:claude-agent|codex)\.(.+)$/.exec(tool)?.[1];
  if (harness !== undefined) return HARNESS_EXTERNAL.has(harness) || harness.startsWith('mcp__');
  return (
    tool.startsWith('web_') ||
    tool.startsWith('mcp__') ||
    tool === 'shell' ||
    tool.startsWith('fs_')
  );
}

/** The receipt's words for a refusal of the run's setup (D-127), in the app's language now. */
const refusalWhy = (refusal: 'not_in_run' | 'monsters_rule'): string =>
  instinctStrings().refusal[refusal];

/** The receipt's words for the cause of a failed call (D-132); a plain error has none. */
function causeWhy(cause: ToolFailureCause): string | undefined {
  const t = instinctStrings();
  switch (cause) {
    case 'user_declined':
    case 'user_no_answer':
    case 'setting_off':
    case 'not_linked':
    case 'site_refused':
    case 'limit':
      return t.cause[cause];
    case 'monsters_policy':
      return t.refusal.monsters_rule;
    case 'not_in_run':
      return t.refusal.not_in_run;
    default:
      return undefined;
  }
}

/** Every event of a run after `after` (an id), oldest first. */
export function runEventsAfter(log: EventLog, runId: string, after?: string): LogEvent[] {
  const out: LogEvent[] = [];
  let cursor = after;
  for (;;) {
    const page = log.query({
      runId,
      order: 'asc',
      limit: 1000,
      ...(cursor ? { after: cursor } : {}),
    });
    out.push(...page);
    if (page.length < 1000) return out;
    cursor = page.at(-1)!.id;
  }
}

const DELEGATION_STATUS = new Set([
  'completed',
  'failed',
  'aborted',
  'max_steps',
  'token_limit',
  'run_limit',
]);

export function buildReceipt(params: {
  log: EventLog;
  runId: string;
  /** The user's message of this turn: everything after it belongs to the turn. */
  requestEventId: string;
  request: string;
  agent: string;
  status: ReceiptData['status'];
  agentName: (id: string) => string;
  now?: number;
}): ReceiptData {
  const { log, runId } = params;
  const first = log.get(params.requestEventId);
  const events = runEventsAfter(log, runId, params.requestEventId);
  const startedAt = first?.ts ?? events[0]?.ts ?? Date.now();

  const delegations: ReceiptData['delegations'] = [];
  const notes: ReceiptData['notes'] = [];
  const tools = new Map<
    string,
    { calls: number; failed: number; why?: string; causes?: Set<ToolFailureCause> }
  >();
  const outbound: ReceiptData['outbound'] = [];
  let stuck = 0;
  let injections = 0;
  /** Model of each monster and why (D-093), in the order they worked. */
  const models = new Map<string, NonNullable<ReceiptData['models']>[number]>();
  const modelOf = (agent: string) => {
    let m = models.get(agent);
    if (!m) models.set(agent, (m = { agent, model: '' }));
    return m;
  };
  const usage: ReceiptData['usage'] = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    instinctCostUsd: 0,
    instinctCalls: 0,
  };

  for (const e of events) {
    switch (e.type) {
      case 'delegation': {
        const d = e.data;
        if (d.status === 'started') break;
        const status = d.runStatus && DELEGATION_STATUS.has(d.runStatus) ? d.runStatus : d.status;
        delegations.push({
          agent: d.to,
          agentName: params.agentName(d.to),
          goal: d.goal,
          status: status as ReceiptData['delegations'][number]['status'],
          verdict: d.status === 'failed' ? 'failed' : (d.check?.verdict ?? 'unchecked'),
          criteria: d.check?.criteria ?? [],
          ...(d.check?.retried ? { retried: true } : {}),
          ...(d.model ? { model: d.model } : {}),
          ...(d.level ? { level: d.level } : {}),
          ...(d.effort ? { effort: d.effort } : {}),
          ...(d.steps !== undefined ? { steps: d.steps } : {}),
          ...(d.costUsd !== undefined ? { costUsd: d.costUsd } : {}),
        });
        break;
      }
      case 'vault_change': {
        const v = e.data;
        if (v.action === 'propose') break;
        notes.push({
          path: v.path,
          action: v.action,
          agent: e.agent,
          ...(v.commit ? { commit: v.commit } : {}),
          ...(v.actionId ? { actionId: v.actionId } : {}),
        });
        break;
      }
      case 'tool_call': {
        if (!isExternalTool(e.data.tool)) break;
        const t = tools.get(e.data.tool) ?? { calls: 0, failed: 0 };
        t.calls++;
        tools.set(e.data.tool, t);
        break;
      }
      case 'tool_result': {
        if (!isExternalTool(e.data.tool) || e.data.ok) break;
        const t = tools.get(e.data.tool);
        if (t) {
          t.failed++;
          // A refusal of the run's setup (D-127): the receipt says it was not the user.
          if (e.data.refusal) t.why ??= refusalWhy(e.data.refusal);
          // The cause the core wrote (D-132), for every failure, native loop and harness alike.
          if (e.data.cause) {
            t.why ??= causeWhy(e.data.cause);
            (t.causes ??= new Set()).add(e.data.cause);
          }
        }
        break;
      }
      case 'instinct': {
        const i = e.data;
        if (i.action === 'tier' && i.subject) {
          const level = i.details?.['level'];
          if (level === 'simple' || level === 'medium' || level === 'hard') {
            modelOf(i.subject).level = level;
          }
          // "Automatica" (D-110): set below from the model that served the request.
          if (i.details?.['effort']) modelOf(i.subject).effort = 'medium';
        }
        if (i.use === 'stuck' && i.action !== 'stuck_notice') stuck++;
        if (i.use === 'outbound' && i.action !== 'outbound_hold') {
          const d = i.details ?? {};
          const outcome =
            d['outcome'] === 'expired'
              ? 'expired'
              : i.action === 'outbound_approved'
                ? 'approved'
                : i.action === 'outbound_refused'
                  ? 'refused'
                  : 'marked';
          outbound.push({
            agent: i.subject ?? 'system',
            tool: typeof d['tool'] === 'string' ? d['tool'] : '',
            category: typeof d['category'] === 'string' ? d['category'] : '',
            outcome,
            summary: typeof d['summary'] === 'string' ? d['summary'] : i.message,
          });
        }
        break;
      }
      case 'security':
        if (e.data.action === 'injection_removed') injections++;
        break;
      case 'error':
        if (e.data.code === 'provider_fallback' && e.data.fallback?.reason === 'usage_limit') {
          modelOf(e.agent).limited = e.data.fallback.from;
        }
        break;
      case 'provider_usage': {
        const u = e.data;
        usage.costUsd += u.costUsd ?? 0;
        // A paid web search (D-071): its cost counts, it is not a model call.
        if (u.provider === WEB_SEARCH_USAGE_PROVIDER) {
          usage.searchCalls = (usage.searchCalls ?? 0) + 1;
          usage.searchCostUsd = (usage.searchCostUsd ?? 0) + (u.costUsd ?? 0);
          break;
        }
        usage.inputTokens += u.inputTokens ?? 0;
        usage.outputTokens += u.outputTokens ?? 0;
        if (u.purpose === 'compaction') {
          // The summary of the older turns (D-082): its cost counts, it is not a step.
          usage.compactionCalls = (usage.compactionCalls ?? 0) + 1;
          usage.compactionCostUsd = (usage.compactionCostUsd ?? 0) + (u.costUsd ?? 0);
        } else if (u.provider === TYPESAFE_PROVIDER_ID) {
          usage.instinctCalls++;
          usage.instinctCostUsd += u.costUsd ?? 0;
        } else {
          usage.modelCalls++;
          modelOf(e.agent).model = `${u.provider}:${u.model}`;
        }
        break;
      }
      default:
        break;
    }
  }
  const now = params.now ?? Date.now();
  return {
    request: params.request.slice(0, 2000),
    requestEventId: params.requestEventId,
    agent: params.agent,
    status: params.status,
    delegations,
    notes,
    externalTools: [...tools].map(([tool, t]) => ({
      tool,
      calls: t.calls,
      failed: t.failed,
      ...(t.why ? { why: t.why } : {}),
      ...(t.causes?.size ? { causes: [...t.causes] } : {}),
    })),
    outbound,
    alerts: { stuck, injections },
    ...(() => {
      const served = [...models.values()]
        .filter((m) => m.model)
        .map((m) => {
          // The effort of the model that served it, not of the first link (Opus → Sonnet).
          const { effort: had, ...rest } = m;
          const effort = had ? autoEffort(m.model) : undefined;
          return effort ? { ...rest, effort } : rest;
        });
      return served.length > 0 ? { models: served } : {};
    })(),
    usage,
    startedAt,
    durationMs: Math.max(0, now - startedAt),
    undoable: notes.some((n) => n.actionId && n.action !== 'undo'),
  };
}

/**
 * The vault actions of a run still to undo, newest first: what "Annulla
 * tutto il lavoro" undoes one by one (an action already undone is skipped).
 */
export function undoableActions(log: EventLog, runId: string): string[] {
  const events = runEventsAfter(log, runId);
  const undone = new Set<string>();
  for (const e of events) {
    if (e.type === 'vault_change' && e.data.action === 'undo' && e.data.undoneActionId) {
      undone.add(e.data.undoneActionId);
    }
  }
  // Undo actions logged outside the run (by the user, after it) count too.
  for (const e of log.query({ type: 'vault_change', agent: 'user', order: 'desc', limit: 1000 })) {
    if (e.type === 'vault_change' && e.data.action === 'undo' && e.data.undoneActionId) {
      undone.add(e.data.undoneActionId);
    }
  }
  const ids: string[] = [];
  for (const e of [...events].reverse()) {
    if (e.type !== 'vault_change') continue;
    const { action, actionId } = e.data;
    if (!actionId || action === 'undo' || action === 'propose' || undone.has(actionId)) continue;
    if (!ids.includes(actionId)) ids.push(actionId);
  }
  return ids;
}

/** Undoes every action of a run, newest first; the ones that fail are reported, not retried. */
export async function undoRun(
  log: EventLog,
  runId: string,
  undo: (actionId: string) => Promise<{ commit: string | null; files: string[] }>,
): Promise<UndoRunResult> {
  const result: UndoRunResult = { undone: [], failed: [] };
  for (const actionId of undoableActions(log, runId)) {
    try {
      const r = await undo(actionId);
      result.undone.push({ actionId, ...(r.commit ? { commit: r.commit } : {}), files: r.files });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      result.failed.push({
        actionId,
        error: typeof code === 'string' ? code.toLowerCase() : 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
