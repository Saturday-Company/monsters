/*
 * The action log of the hero's tmux pane: one request ("sum up this week's notes") as the core
 * writes it, event by event, in the stored shape of `LogEventSchema` (@monsters/shared; the
 * site test validates every event against it). The pane prints one compact line per event,
 * the way a log viewer would: time, actor, type, the telling fields of `data`.
 */

export interface SiteEvent {
  id: string;
  ts: number;
  agent: string;
  runId: string | null;
  parentId: string | null;
  type: string;
  data: Record<string, unknown>;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A valid ULID for a timestamp; the random part is derived from `n` (deterministic builds). */
export function ulidAt(ts: number, n: number): string {
  let time = '';
  let t = ts;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  let x = (Math.imul(n + 1, 2654435761) ^ ts) >>> 0 || 1;
  for (let i = 0; i < 16; i++) {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    rand += CROCKFORD[x % 32];
  }
  return time + rand;
}

/** 20 October 2026, 17:42:07 UTC: the session the pane replays. */
const T0 = Date.UTC(2026, 9, 20, 17, 42, 7, 113);
const REQUEST = "sum up this week's notes";
const NOTE = 'Inbox/week-42.md';
const SHA = 'c2e9d47';

type Draft = Omit<SiteEvent, 'id' | 'ts' | 'runId' | 'parentId'> & { dt: number };

const DRAFTS: Draft[] = [
  {
    dt: 0,
    agent: 'user',
    type: 'message',
    data: { role: 'user', text: REQUEST, to: 'titan', channel: 'ui' },
  },
  { dt: 9, agent: 'titan', type: 'run', data: { status: 'started', goal: REQUEST } },
  {
    dt: 420,
    agent: 'titan',
    type: 'tool_call',
    data: { callId: 'c1', tool: 'vault_search', input: { query: 'week 42' } },
  },
  {
    dt: 461,
    agent: 'titan',
    type: 'tool_result',
    data: { callId: 'c1', tool: 'vault_search', ok: true, durationMs: 41 },
  },
  {
    dt: 1290,
    agent: 'titan',
    type: 'delegation',
    data: {
      from: 'titan',
      to: 'rhea',
      status: 'started',
      goal: 'read the notes of the week',
      doneWhen: 'a list with links',
    },
  },
  {
    dt: 2210,
    agent: 'rhea',
    type: 'provider_usage',
    data: {
      provider: 'openrouter',
      model: 'openrouter/free',
      inputTokens: 5120,
      outputTokens: 388,
      costUsd: 0,
      step: 0,
    },
  },
  {
    dt: 2240,
    agent: 'rhea',
    type: 'tool_call',
    data: { callId: 'c2', tool: 'vault_read', input: { path: 'Inbox/ideas.md' } },
  },
  {
    dt: 2252,
    agent: 'rhea',
    type: 'tool_result',
    data: { callId: 'c2', tool: 'vault_read', ok: true, durationMs: 12 },
  },
  {
    dt: 3010,
    agent: 'rhea',
    type: 'tool_call',
    data: { callId: 'c3', tool: 'web_fetch', input: { url: 'https://example.com/changelog' } },
  },
  {
    dt: 3015,
    agent: 'rhea',
    type: 'instinct',
    data: {
      use: 'outbound',
      action: 'outbound_hold',
      message: 'web_fetch leaves the computer: asking first',
      subject: 'rhea',
    },
  },
  {
    dt: 5480,
    agent: 'rhea',
    type: 'delegation',
    data: { from: 'titan', to: 'rhea', status: 'completed', goal: 'read the notes of the week' },
  },
  {
    dt: 5530,
    agent: 'titan',
    type: 'delegation',
    data: { from: 'titan', to: 'dione', status: 'started', goal: 'draft the summary' },
  },
  {
    dt: 7102,
    agent: 'dione',
    type: 'tool_call',
    data: { callId: 'c4', tool: 'vault_write', input: { path: NOTE } },
  },
  {
    dt: 7140,
    agent: 'dione',
    type: 'vault_change',
    data: { action: 'create', path: NOTE, commit: SHA },
  },
  {
    dt: 7150,
    agent: 'dione',
    type: 'tool_result',
    data: { callId: 'c4', tool: 'vault_write', ok: true, durationMs: 48 },
  },
  {
    dt: 7300,
    agent: 'dione',
    type: 'delegation',
    data: { from: 'titan', to: 'dione', status: 'completed', goal: 'draft the summary' },
  },
  {
    dt: 7420,
    agent: 'titan',
    type: 'receipt',
    data: {
      request: REQUEST,
      agent: 'titan',
      status: 'completed',
      delegations: [
        {
          agent: 'rhea',
          agentName: 'Rhea',
          goal: 'read the notes of the week',
          status: 'completed',
          verdict: 'verified',
          criteria: [],
        },
        {
          agent: 'dione',
          agentName: 'Dione',
          goal: 'draft the summary',
          status: 'completed',
          verdict: 'verified',
          criteria: [],
        },
      ],
      notes: [{ path: NOTE, action: 'create', agent: 'dione', commit: SHA }],
      externalTools: [{ tool: 'web_fetch', calls: 1, failed: 0 }],
      outbound: [
        {
          agent: 'rhea',
          tool: 'web_fetch',
          category: 'web',
          outcome: 'approved',
          summary: 'example.com',
        },
      ],
      alerts: { stuck: 0, injections: 0 },
      usage: {
        costUsd: 0,
        inputTokens: 18_904,
        outputTokens: 1_377,
        modelCalls: 6,
        instinctCostUsd: 0,
        instinctCalls: 2,
      },
      startedAt: T0 + 9,
      durationMs: 7_411,
      undoable: true,
    },
  },
  { dt: 7431, agent: 'titan', type: 'run', data: { status: 'completed' } },
];

const RUN = ulidAt(T0 + 9, 999);

export const EVENTS: SiteEvent[] = DRAFTS.map(({ dt, ...e }, i) => ({
  id: ulidAt(T0 + dt, i),
  ts: T0 + dt,
  runId: e.type === 'message' ? null : RUN,
  parentId: null,
  ...e,
}));

export { clock, summarize } from './eventfmt.ts';
