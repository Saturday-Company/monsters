import {
  CONTEXT_COMPACT_AT,
  CONTEXT_PARTS,
  formatNumber,
  type ContextPart,
  type LogEvent,
  type UsageContext,
} from '@monsters/shared';
import { usageStrings } from './usage.strings.ts';

/*
 * The Consumi panel without React (D-075): which segment of the bar is lit by
 * which part, the words of the parts, the numbers as the instrument says them.
 */

/** Long names (legend of the panel, screen readers). */
export function partName(part: ContextPart, provider?: string): string {
  const names = usageStrings().parts;
  return part === 'base' ? names.base(provider) : names[part];
}

/** What each part is, in one line (the legend's second line). */
export function partHint(part: ContextPart): string {
  return usageStrings().hints[part];
}

/** "820", "8.4K", "38K", "1M", "1.2M": tokens on the instrument ("8,4K" in Italian). */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(n)));
  const one = { maximumFractionDigits: 1 };
  if (n < 10_000) return `${formatNumber(n / 1000, one)}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${formatNumber(n / 1_000_000, one)}M`;
}

/** "12,345": a whole count with the thousands of the language ("12.345" in Italian). */
export const formatCount = (n: number) => formatNumber(Math.round(n));

/** "31%", "<1%", null without a window. */
export function percentText(total: number, window: number | null): string | null {
  if (!window) return null;
  const pct = (total / window) * 100;
  if (pct > 0 && pct < 0.5) return '<1%';
  return `${Math.round(pct)}%`;
}

/** "31%", or the tokens when the window is unknown, "0%" before the first step, a dash while the new window is unknown. */
export function contextAmount(context: UsageContext | null): string {
  if (!context) return '0%';
  // The model changed and its window is not known yet: no share of the old one (D-086).
  if (context.measuredWith && !context.window) return '–';
  return percentText(context.total, context.window) ?? formatTokens(context.total);
}

/**
 * The bar: `count` segments, each a `1/count` of the window. The used ones are
 * shared among the parts in their order (largest remainder), each part with at
 * least one segment when there are enough: a part that exists is seen. Null
 * for a free segment. Without a window nothing is lit.
 */
export function segmentsOf(
  parts: readonly { part: ContextPart; tokens: number }[],
  total: number,
  window: number | null,
  count: number,
): (ContextPart | null)[] {
  const out: (ContextPart | null)[] = Array.from({ length: count }, () => null);
  if (!window || total <= 0) return out;
  const lit = Math.min(count, Math.max(1, Math.round((total / window) * count)));
  const shown = CONTEXT_PARTS.flatMap((p) => {
    const tokens = parts.find((x) => x.part === p)?.tokens ?? 0;
    return tokens > 0 ? [{ part: p, tokens }] : [];
  });
  const sum = shown.reduce((n, p) => n + p.tokens, 0);
  if (sum === 0) return out;
  const each = new Map<ContextPart, number>();
  const minimum = lit >= shown.length ? 1 : 0;
  let left = lit - minimum * shown.length;
  const room = shown.map((p) => ({ part: p.part, v: (p.tokens / sum) * left }));
  for (const r of room) {
    const n = Math.floor(r.v);
    each.set(r.part, minimum + n);
  }
  left -= room.reduce((n, r) => n + Math.floor(r.v), 0);
  const order = [...room].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)));
  for (let i = 0; left > 0; i++, left--) {
    const part = order[i % order.length]!.part;
    each.set(part, (each.get(part) ?? 0) + 1);
  }
  let i = 0;
  for (const p of shown) for (let k = 0; k < (each.get(p.part) ?? 0); k++) out[i++] = p.part;
  return out;
}

/** The segment where compaction starts (`CONTEXT_COMPACT_AT`), as an index in `count`. */
export const thresholdAt = (count: number, threshold = CONTEXT_COMPACT_AT) =>
  Math.round(count * threshold);

/** Latest new conversation of this monster (a general one, or its own): its time, or 0. */
export function conversationSince(events: readonly LogEvent[], agentId: string): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'new_conversation' && (!e.data.to || e.data.to === agentId)) return e.ts;
  }
  return 0;
}

/**
 * The context of the monster's latest step in its current conversation, from
 * the events the UI has (live from the stream); null before its first step.
 */
export function latestContext(
  events: readonly LogEvent[],
  agentId: string,
  owners: ReadonlyMap<string, string>,
): UsageContext | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'new_conversation' && (!e.data.to || e.data.to === agentId)) return null;
    if (e.type !== 'provider_usage' || e.agent !== agentId || !e.data.context) continue;
    // Its own chat only: a step for another monster's task is another conversation.
    if (!e.runId || owners.get(e.runId) !== agentId) continue;
    const c = e.data.context;
    return {
      total: c.total,
      window: c.window ?? null,
      threshold: CONTEXT_COMPACT_AT,
      parts: CONTEXT_PARTS.flatMap((part) => {
        const tokens = c.parts[part] ?? 0;
        return tokens > 0 ? [{ part, tokens }] : [];
      }),
      source: c.source,
      provider: e.data.provider,
      model: e.data.model,
      ts: e.ts,
      runId: e.runId,
    };
  }
  return null;
}

/** A model of a monster's chain (from its summary). */
export interface CurrentModel {
  provider: string;
  model: string;
}

const sameModel = (c: { provider: string; model: string }, m: CurrentModel) =>
  c.provider === m.provider && c.model === m.model;

/** The step's model is no longer in the chain: the user changed it (a fallback stays in it). */
const changedFrom = (c: UsageContext, chain: readonly CurrentModel[] | null) =>
  chain !== null && chain.length > 0 && !chain.some((m) => sameModel(c, m));

/**
 * The context the key shows (D-086): the latest step from the stream, the
 * panel's data before the first event. When the step's model is no longer in
 * the monster's chain (the user changed it), the share is against the window
 * of the chain's first model: the core's read gives it (`measuredWith`); until
 * it arrives, the step without a window (a dash), never the old model's
 * percentage.
 */
export function contextNow(
  fromEvents: UsageContext | null,
  fetched: UsageContext | null,
  chain: readonly CurrentModel[] | null,
): UsageContext | null {
  const first = chain?.[0];
  const pending = (c: UsageContext): UsageContext => ({
    ...c,
    provider: first!.provider,
    model: first!.model,
    window: null,
    measuredWith: c.measuredWith ?? { provider: c.provider, model: c.model },
  });
  if (!fromEvents) return fetched && changedFrom(fetched, chain) ? pending(fetched) : fetched;
  if (changedFrom(fromEvents, chain)) {
    if (fetched && first && sameModel(fetched, first) && fetched.ts >= fromEvents.ts) {
      return fetched;
    }
    return pending(fromEvents);
  }
  if (fromEvents.window === null && fetched && fetched.model === fromEvents.model) {
    return { ...fromEvents, window: fetched.window };
  }
  return fromEvents;
}

const USAGE_TYPES = new Set<LogEvent['type']>([
  'provider_usage',
  'run',
  'new_conversation',
  'tool_call',
  'decision',
]);

/** Debounce of the reads after an event: a step brings a few events at once. */
const REFRESH_MS = 250;
/** At most one read every this often while events arrive (D-079: the core reads the log for it). */
export const USAGE_REFRESH_MIN_MS = 2000;

/**
 * When the next read after an event may go: after the debounce, and not
 * sooner than `USAGE_REFRESH_MIN_MS` after the previous read.
 */
export function usageRefreshDelay(lastReadAt: number | null, now: number): number {
  if (lastReadAt === null) return REFRESH_MS;
  return Math.max(REFRESH_MS, lastReadAt + USAGE_REFRESH_MIN_MS - now);
}

/** Id of the latest event that may change the panel: it is read again when this moves. */
export function usageStamp(events: readonly LogEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (USAGE_TYPES.has(e.type)) return e.id;
  }
  return '';
}
