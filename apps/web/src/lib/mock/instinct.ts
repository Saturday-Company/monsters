import {
  INSTINCT_DESCRIPTION,
  INSTINCT_ENGINE_TEXTS,
  INSTINCT_TITLE,
  INSTINCT_USE_INFO,
  INSTINCT_USES,
  InstinctUpdateSchema,
  type InstinctMode,
  type InstinctUse,
  type InstinctView,
  type LogEvent,
  type Receipt,
  type ReceiptData,
  type ScorecardView,
  type UndoRunResult,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import type { MockDecisions } from './decisions.ts';

/*
 * The instinct of the mock core (D-067): engine and modes of the uses (the
 * engine is the one of `/api/settings/decisions`), the pagella dei mostri, the
 * receipts of a run (built from the mock's own events when a run ends) and
 * "Annulla tutto il lavoro".
 */

const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: { error, ...(message ? { message } : {}) },
});
const ok = (body: unknown): RawResponse => ({ status: 200, body });

const EXTERNAL = (tool: string) =>
  tool.startsWith('web_') || tool.startsWith('mcp__') || tool === 'shell' || tool.startsWith('fs_');

/** The receipt of a run of the mock, from its events (same shape as the core's). */
export function mockReceipt(
  runId: string,
  events: readonly LogEvent[],
  status: ReceiptData['status'],
  agentName: (id: string) => string,
  now = Date.now(),
): ReceiptData {
  const mine = events.filter((e) => e.runId === runId);
  const request = mine.find(
    (e): e is LogEvent<'message'> => e.type === 'message' && e.data.role === 'user',
  );
  const tools = new Map<string, { calls: number; failed: number }>();
  const usage = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    instinctCostUsd: 0,
    instinctCalls: 0,
  };
  const delegations: ReceiptData['delegations'] = [];
  const notes: ReceiptData['notes'] = [];
  const outbound: ReceiptData['outbound'] = [];
  let stuck = 0;
  let injections = 0;
  /** The model of each monster and why (D-093), as the core's receipt. */
  const models = new Map<string, NonNullable<ReceiptData['models']>[number]>();
  const modelOf = (agent: string) => {
    let m = models.get(agent);
    if (!m) models.set(agent, (m = { agent, model: '' }));
    return m;
  };
  for (const e of mine) {
    if (e.type === 'delegation' && e.data.status !== 'started') {
      const doneWhen = e.data.doneWhen;
      delegations.push({
        agent: e.data.to,
        agentName: agentName(e.data.to),
        goal: e.data.goal,
        status: e.data.status,
        verdict: e.data.status === 'failed' ? 'failed' : (e.data.check?.verdict ?? 'verified'),
        criteria: e.data.check?.criteria ?? [
          ...(doneWhen
            ? [
                {
                  text: doneWhen,
                  kind: 'done_when' as const,
                  ok: true,
                  by: 'model' as const,
                  p: 0.82,
                },
              ]
            : []),
          { text: 'Note salvate', kind: 'notes' as const, ok: true, by: 'rules' as const },
        ],
        ...(e.data.check?.retried ? { retried: true } : {}),
        ...(e.data.model ? { model: e.data.model } : {}),
        ...(e.data.steps !== undefined ? { steps: e.data.steps } : {}),
        ...(e.data.costUsd !== undefined ? { costUsd: e.data.costUsd } : {}),
      });
    } else if (e.type === 'vault_change' && e.data.action !== 'propose') {
      notes.push({
        path: e.data.path,
        action: e.data.action,
        agent: e.agent,
        ...(e.data.commit ? { commit: e.data.commit } : {}),
        ...(e.data.actionId ? { actionId: e.data.actionId } : {}),
      });
    } else if (e.type === 'tool_call' && EXTERNAL(e.data.tool)) {
      const t = tools.get(e.data.tool) ?? { calls: 0, failed: 0 };
      t.calls++;
      tools.set(e.data.tool, t);
    } else if (e.type === 'tool_result' && EXTERNAL(e.data.tool) && !e.data.ok) {
      const t = tools.get(e.data.tool);
      if (t) t.failed++;
    } else if (e.type === 'instinct') {
      // As the core's receipt (core/src/team/instinct/receipt.ts).
      const i = e.data;
      const level = i.details?.['level'];
      if (
        i.action === 'tier' &&
        i.subject &&
        (level === 'simple' || level === 'medium' || level === 'hard')
      ) {
        modelOf(i.subject).level = level;
      }
      if (i.use === 'stuck' && i.action !== 'stuck_notice') stuck++;
      if (i.use === 'outbound' && i.action !== 'outbound_hold') {
        const d = i.details ?? {};
        outbound.push({
          agent: i.subject ?? 'system',
          tool: typeof d['tool'] === 'string' ? d['tool'] : '',
          category: typeof d['category'] === 'string' ? d['category'] : '',
          outcome:
            d['outcome'] === 'expired'
              ? 'expired'
              : i.action === 'outbound_approved'
                ? 'approved'
                : i.action === 'outbound_refused'
                  ? 'refused'
                  : 'marked',
          summary: typeof d['summary'] === 'string' ? d['summary'] : i.message,
        });
      }
    } else if (e.type === 'security') {
      if (e.data.action === 'injection_removed') injections++;
    } else if (e.type === 'provider_usage') {
      usage.costUsd += e.data.costUsd ?? 0;
      usage.inputTokens += e.data.inputTokens ?? 0;
      usage.outputTokens += e.data.outputTokens ?? 0;
      if (e.data.provider === 'typesafe') {
        usage.instinctCalls++;
        usage.instinctCostUsd += e.data.costUsd ?? 0;
      } else {
        usage.modelCalls++;
        modelOf(e.agent).model = `${e.data.provider}:${e.data.model}`;
      }
    } else if (e.type === 'error' && e.data.fallback?.reason === 'usage_limit') {
      modelOf(e.agent).limited = e.data.fallback.from;
    }
  }
  const startedAt = mine[0]?.ts ?? Date.now();
  return {
    request: request?.data.text ?? '',
    ...(request ? { requestEventId: request.id } : {}),
    // Who received the request: the agent of the run, never the user's message.
    agent:
      mine.find((e) => e.type === 'run' && e.data.status === 'started')?.agent ??
      mine.find((e) => e.agent !== 'user' && e.agent !== 'system')?.agent ??
      'system',
    status,
    delegations,
    notes,
    externalTools: [...tools].map(([tool, t]) => ({ tool, ...t })),
    outbound,
    alerts: { stuck, injections },
    ...(() => {
      const served = [...models.values()].filter((m) => m.model);
      return served.length > 0 ? { models: served } : {};
    })(),
    usage,
    startedAt,
    durationMs: Math.max(0, now - startedAt),
    undoable: notes.some((n) => n.actionId && n.action !== 'undo'),
  };
}

export class MockInstinct {
  private uses: Partial<Record<InstinctUse, InstinctMode>> = {};
  private engineChosen = false;

  private readonly deps: {
    decisions: MockDecisions;
    events: () => readonly LogEvent[];
    undo: (actionId: string) => RawResponse;
    agentName: (id: string) => string;
  };

  constructor(deps: MockInstinct['deps']) {
    this.deps = deps;
  }

  private view(): InstinctView {
    const { engine, keySet } = this.deps.decisions.state();
    return {
      title: INSTINCT_TITLE,
      description: INSTINCT_DESCRIPTION,
      engine,
      engineSource: this.engineChosen ? 'user' : 'default',
      engines: (['rules', 'llm', 'jev'] as const).map((id) => ({
        id,
        ...INSTINCT_ENGINE_TEXTS[id],
      })),
      uses: INSTINCT_USES.map((id) => {
        const info = INSTINCT_USE_INFO[id];
        const mode = this.uses[id] ?? info.defaultMode;
        const withModel =
          (engine === 'jev' && info.jev && keySet) || (engine === 'llm' && info.llm);
        return {
          id,
          mode,
          defaultMode: info.defaultMode,
          modes: [...info.modes],
          label: info.label,
          description: info.description,
          engines: [
            ...(info.rules ? (['rules'] as const) : []),
            ...(info.llm ? (['llm'] as const) : []),
            ...(info.jev ? (['jev'] as const) : []),
          ],
          active: mode !== 'off' && (info.rules || withModel),
          sends: info.sends,
        };
      }),
      jev: {
        keySet,
        ...(keySet ? { keySource: 'file' as const } : {}),
        model: 'jev-1.13.0',
        maxP: 0.45,
      },
    };
  }

  private scorecard(): ScorecardView {
    return {
      enabled: (this.uses.scorecard ?? 'on') === 'on',
      minDelegations: 20,
      rows: [
        {
          agent: 'rhea',
          agentName: this.deps.agentName('rhea'),
          model: 'openrouter:openrouter/free',
          tier: 'any',
          delegations: 14,
          checked: 12,
          verified: 10,
          doubt: 1,
          incomplete: 1,
          failed: 0,
          successRate: 10 / 12,
          avgSteps: 6.5,
          avgCostUsd: 0,
          costPerVerifiedUsd: 0,
        },
        {
          agent: 'dione',
          agentName: this.deps.agentName('dione'),
          model: 'openrouter:openrouter/free',
          tier: 'any',
          delegations: 9,
          checked: 9,
          verified: 8,
          doubt: 0,
          incomplete: 1,
          failed: 0,
          successRate: 8 / 9,
          avgSteps: 4.2,
          avgCostUsd: 0,
          costPerVerifiedUsd: 0,
        },
      ],
      reordered: {},
    };
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    const route = `${method} ${path}`;
    if (route === 'GET /api/settings/instinct') return ok(this.view());
    if (route === 'PUT /api/settings/instinct') {
      const p = InstinctUpdateSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
      for (const [use, mode] of Object.entries(p.data.uses ?? {}) as [
        InstinctUse,
        InstinctMode,
      ][]) {
        if (!INSTINCT_USE_INFO[use].modes.includes(mode)) {
          return fail(
            400,
            'mode_not_available',
            `«${INSTINCT_USE_INFO[use].label}» non ha la modalità ${mode}.`,
          );
        }
      }
      if (p.data.engine) {
        const res = this.deps.decisions.setEngine(p.data.engine);
        if (res) return res;
        this.engineChosen = true;
      }
      this.uses = { ...this.uses, ...p.data.uses };
      return ok(this.view());
    }
    if (route === 'GET /api/instinct/scorecard') return ok(this.scorecard());
    const receipts = /^GET \/api\/runs\/([^/]+)\/receipts$/.exec(route);
    if (receipts) {
      const runId = decodeURIComponent(receipts[1]!);
      const list: Receipt[] = this.deps
        .events()
        .filter((e): e is LogEvent<'receipt'> => e.type === 'receipt' && e.runId === runId)
        .map((e) => ({ ...e.data, id: e.id, ts: e.ts, runId }));
      return ok(list);
    }
    const undo = /^POST \/api\/runs\/([^/]+)\/undo$/.exec(route);
    if (undo) {
      const runId = decodeURIComponent(undo[1]!);
      const events = this.deps.events();
      if (!events.some((e) => e.runId === runId)) return fail(404, 'not_found');
      const result: UndoRunResult = { undone: [], failed: [] };
      const ids = events
        .filter(
          (e): e is LogEvent<'vault_change'> =>
            e.type === 'vault_change' && e.runId === runId && e.data.action !== 'undo',
        )
        .map((e) => e.data.actionId)
        .filter((id): id is string => typeof id === 'string')
        .reverse();
      for (const actionId of new Set(ids)) {
        const res = this.deps.undo(actionId);
        const b = res.body as {
          commit?: string;
          files?: string[];
          error?: string;
          message?: string;
        };
        if (res.status === 200) {
          result.undone.push({
            actionId,
            ...(b.commit ? { commit: b.commit } : {}),
            files: b.files ?? [],
          });
        } else {
          result.failed.push({ actionId, error: b.error ?? 'error', message: b.message ?? '' });
        }
      }
      return ok(result);
    }
    return null;
  }
}
