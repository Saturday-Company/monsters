import {
  originalRequest,
  type EventDataMap,
  type LogEvent,
  type ReceiptData,
} from '@monsters/shared';
import { receiptSummary, securitySentence } from '../../store/instinct.ts';

/** One readable line of an agent's terminal, with the run it belongs to (`run`). */
export type TermEntry = (
  | { kind: 'thought'; id: string; ts: number; text: string; live: boolean }
  | { kind: 'message'; id: string; ts: number; text: string }
  | {
      kind: 'tool';
      id: string;
      ts: number;
      callId: string;
      tool: string;
      input: unknown;
      result?: {
        ok: boolean;
        output?: unknown;
        error?: string | undefined;
        durationMs?: number | undefined;
      };
    }
  | {
      kind: 'delegation';
      id: string;
      ts: number;
      dir: 'out' | 'in';
      other: string;
      goal: string;
      status: string;
      summary?: string | undefined;
      error?: string | undefined;
    }
  | { kind: 'error'; id: string; ts: number; message: string; code?: string | undefined }
  | {
      kind: 'vault';
      id: string;
      ts: number;
      action: string;
      path: string;
      actionId?: string | undefined;
    }
  | { kind: 'question'; id: string; ts: number; text: string }
  | { kind: 'run'; id: string; ts: number; status: string; goal?: string | undefined }
  | {
      kind: 'usage';
      id: string;
      ts: number;
      model: string;
      tokens: number;
      durationMs?: number | undefined;
    }
  /** The instinct about this monster (D-067): said in words when shown (needs the names). */
  | { kind: 'instinct'; id: string; ts: number; data: EventDataMap['instinct'] }
  /** A text with orders to the monsters in what this monster read. */
  | { kind: 'security'; id: string; ts: number; data: EventDataMap['security'] }
  /** The receipt of a turn this monster received. */
  | { kind: 'receipt'; id: string; ts: number; data: ReceiptData }
) & { run?: string | undefined };

export type TermFilter = 'all' | 'thoughts' | 'tools' | 'errors' | 'delegations';

export function entryMatches(e: TermEntry, f: TermFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'thoughts':
      return e.kind === 'thought' || e.kind === 'message' || e.kind === 'question';
    case 'tools':
      return e.kind === 'tool' || e.kind === 'vault' || e.kind === 'usage';
    case 'errors':
      return (
        e.kind === 'error' || e.kind === 'security' || (e.kind === 'tool' && e.result?.ok === false)
      );
    case 'delegations':
      return e.kind === 'delegation' || e.kind === 'receipt';
  }
}

export function entryText(e: TermEntry): string {
  switch (e.kind) {
    case 'thought':
    case 'message':
    case 'question':
      return e.text;
    case 'tool':
      return `${e.tool} ${JSON.stringify(e.input ?? '')} ${e.result?.error ?? ''}`;
    case 'delegation':
      return `${e.other} ${e.goal} ${e.summary ?? ''}`;
    case 'error':
      return e.message;
    case 'vault':
      return e.path;
    case 'run':
      return e.goal ?? '';
    case 'usage':
      return e.model;
    case 'instinct':
      return e.data.message;
    case 'security':
      return securitySentence(e.data);
    case 'receipt':
      return `${originalRequest(e.data.request)} ${receiptSummary(e.data)}`;
  }
}

/** Builds the terminal of one agent from the event log. */
export function buildTerminal(events: readonly LogEvent[], agentId: string): TermEntry[] {
  const out: TermEntry[] = [];
  const thoughts = new Map<string, Extract<TermEntry, { kind: 'thought' }>>();
  const tools = new Map<string, Extract<TermEntry, { kind: 'tool' }>>();
  /** Event ids of this monster's tool calls: a removed text points at one of them. */
  const calls = new Set<string>();

  for (const e of events) {
    const before = out.length;
    // Entries added for this event belong to its run (the instrumentation line opens it).
    const tag = () => {
      if (!e.runId) return;
      for (let i = before; i < out.length; i++) out[i]!.run = e.runId;
    };
    // The instinct writes as `system`: its lines go to the monster they are about.
    if (e.type === 'instinct') {
      if (e.data.subject === agentId) {
        out.push({ kind: 'instinct', id: e.id, ts: e.ts, data: e.data });
        tag();
      }
      continue;
    }
    if (e.type === 'security') {
      if (e.parentId && calls.has(e.parentId)) {
        out.push({ kind: 'security', id: e.id, ts: e.ts, data: e.data });
        tag();
      }
      continue;
    }
    if (e.type === 'receipt') {
      if (e.data.agent === agentId) {
        out.push({ kind: 'receipt', id: e.id, ts: e.ts, data: e.data });
        tag();
      }
      continue;
    }
    if (e.type === 'tool_call' && e.agent === agentId) calls.add(e.id);
    if (e.type === 'delegation') {
      const d = e.data;
      if (d.to === agentId || d.from === agentId) {
        out.push({
          kind: 'delegation',
          id: e.id,
          ts: e.ts,
          dir: d.from === agentId ? 'out' : 'in',
          other: d.from === agentId ? d.to : d.from,
          goal: d.goal,
          status: d.status,
          summary: d.summary,
          error: d.error,
        });
        tag();
      }
      continue;
    }
    if (e.type === 'run' && (e.data.status === 'aborted' || e.data.status === 'failed')) {
      // Nothing of this run is still being written (delegates included).
      const open = thoughts.get(e.runId ?? '');
      if (open) {
        open.live = false;
        thoughts.delete(e.runId ?? '');
      }
    }
    if (e.agent !== agentId) continue;
    const runKey = e.runId ?? '';
    switch (e.type) {
      case 'message': {
        if (e.data.role !== 'agent') break;
        const open = thoughts.get(runKey);
        if (e.data.partial) {
          if (open) open.text += e.data.text;
          else {
            const t = {
              kind: 'thought' as const,
              id: e.id,
              ts: e.ts,
              text: e.data.text,
              live: true,
            };
            thoughts.set(runKey, t);
            out.push(t);
          }
        } else {
          if (open) {
            const idx = out.indexOf(open);
            out.splice(idx, 1, {
              kind: 'message',
              id: open.id,
              ts: open.ts,
              text: e.data.text || open.text,
              run: open.run,
            });
            thoughts.delete(runKey);
          } else if (e.data.text.trim()) {
            out.push({ kind: 'message', id: e.id, ts: e.ts, text: e.data.text });
          }
        }
        break;
      }
      case 'tool_call': {
        const open = thoughts.get(runKey);
        if (open) {
          open.live = false;
          thoughts.delete(runKey);
        }
        const t = {
          kind: 'tool' as const,
          id: e.id,
          ts: e.ts,
          callId: e.data.callId,
          tool: e.data.tool,
          input: e.data.input,
        };
        tools.set(`${runKey}|${e.data.callId}`, t);
        out.push(t);
        break;
      }
      case 'tool_result': {
        const t = tools.get(`${runKey}|${e.data.callId}`);
        const result = {
          ok: e.data.ok,
          output: e.data.output,
          error: e.data.error,
          durationMs: e.data.durationMs,
        };
        if (t) t.result = result;
        else
          out.push({
            kind: 'tool',
            id: e.id,
            ts: e.ts,
            callId: e.data.callId,
            tool: e.data.tool,
            input: undefined,
            result,
          });
        break;
      }
      case 'error':
        out.push({ kind: 'error', id: e.id, ts: e.ts, message: e.data.message, code: e.data.code });
        break;
      case 'vault_change':
        out.push({
          kind: 'vault',
          id: e.id,
          ts: e.ts,
          action: e.data.action,
          path: e.data.path,
          actionId: e.data.actionId,
        });
        break;
      case 'question':
        out.push({ kind: 'question', id: e.id, ts: e.ts, text: e.data.question });
        break;
      case 'run':
        out.push({ kind: 'run', id: e.id, ts: e.ts, status: e.data.status, goal: e.data.goal });
        break;
      case 'provider_usage':
        out.push({
          kind: 'usage',
          id: e.id,
          ts: e.ts,
          model: e.data.model,
          tokens: (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0),
          durationMs: e.data.durationMs,
        });
        break;
      default:
        break;
    }
    tag();
  }
  for (const t of thoughts.values()) t.live = true;
  return out;
}
