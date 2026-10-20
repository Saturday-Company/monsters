import {
  conversationUsage,
  type AgentUsageView,
  type ContextUsage,
  type LogEvent,
  type SpendView,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { mockPlanLimits, planOfProvider } from './plan-limits.ts';

/*
 * `GET /api/agents/:id/usage` of the mock core (D-075): the same sum as the
 * core (`conversationUsage` of the shared package) over the mock's events,
 * and the context of the mock's steps: plausible parts that grow with the
 * conversation, on a free model with a 64k window (or Claude Code with its
 * base on a subscription).
 */

/** The free model of the mock's monsters and its window. */
export const MOCK_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
export const MOCK_WINDOW = 65_536;
export const MOCK_CLAUDE_WINDOW = 1_000_000;

/** The context of a step: `turns` earlier messages, `results` tool results read in the turn. */
export function mockContext(o: {
  turns: number;
  results: number;
  harness?: boolean;
}): ContextUsage {
  const parts = {
    ...(o.harness ? { base: 22_140 } : {}),
    instructions: o.harness ? 1210 : 1830,
    memory: 640,
    tools: o.harness ? 2350 : 3420,
    conversation: 1460 + o.turns * 860,
    ...(o.results > 0 ? { tool_results: o.results * 1240 } : {}),
    current: 190,
  };
  const total = Object.values(parts).reduce((n, v) => n + v, 0);
  return {
    total,
    window: o.harness ? MOCK_CLAUDE_WINDOW : MOCK_WINDOW,
    parts,
    source: 'measured',
  };
}

/** Messages of the agent's current conversation so far: how much history a new step carries. */
export function turnsOf(events: readonly LogEvent[], agentId: string): number {
  let turns = 0;
  for (const e of events) {
    if (e.type === 'new_conversation' && (!e.data.to || e.data.to === agentId)) turns = 0;
    else if (e.type === 'message' && !e.data.partial) {
      if (e.agent === 'user' && e.data.to === agentId) turns++;
      else if (e.agent === agentId && e.data.role === 'agent' && e.parentId === null) turns++;
    }
  }
  return turns;
}

const SUBSCRIPTIONS = new Set(['claude-agent', 'codex', 'chatgpt']);

export function handleUsage(
  method: string,
  path: string,
  o: {
    events: readonly LogEvent[];
    agents: () => { id: string }[];
    spend: () => SpendView;
    providerOf: (agentId: string) => string | undefined;
  },
): RawResponse | null {
  const m = /^\/api\/agents\/([^/]+)\/usage$/.exec(path);
  if (!m || method !== 'GET') return null;
  const agentId = decodeURIComponent(m[1]!);
  if (!o.agents().some((a) => a.id === agentId))
    return { status: 404, body: { error: 'unknown_agent' } };
  let start: LogEvent | null = null;
  for (const e of o.events) {
    if (e.type === 'new_conversation' && (!e.data.to || e.data.to === agentId)) start = e;
  }
  const events = start ? o.events.filter((e) => e.id > start.id) : o.events;
  const spend = o.spend();
  const { context, session } = conversationUsage({ agentId, events, usdToEur: spend.usdToEur });
  const mine = spend.agents.find((a) => a.id === agentId);
  const empty = { spentEur: 0, capEur: null, ratio: null };
  const view: AgentUsageView = {
    agentId,
    since: start?.ts ?? null,
    subscription: SUBSCRIPTIONS.has(o.providerOf(agentId) ?? ''),
    planLimits: planOfProvider(o.providerOf(agentId))
      ? mockPlanLimits(planOfProvider(o.providerOf(agentId))!)
      : null,
    context,
    session,
    spend: {
      usdToEur: spend.usdToEur,
      warnAt: spend.warnAt,
      day: spend.day,
      month: spend.month,
      agent: { paid: mine?.paid ?? false, day: mine?.day ?? empty, month: mine?.month ?? empty },
    },
  };
  return { status: 200, body: view };
}
