import type { PlanLimitsReading, PlanWindowReading } from '@monsters/shared';
import { providerTexts } from '../providers.strings.ts';

/*
 * Plan limits as the official programs print them while they work (D-111).
 * Nothing here asks for them: Claude Code writes a `rate_limit_event` to its
 * stream-json output, Codex's app-server sends `account/rateLimits/updated`.
 * Both parsers are tolerant: a field that is missing or of an unexpected type
 * is skipped, an unknown window or event is ignored, and none of them throws.
 *
 * Claude Code 2.1.302 (schema of `SDKRateLimitEvent`, read in the binary):
 *   { type: 'rate_limit_event', uuid, session_id, rate_limit_info: {
 *       status: 'allowed' | 'allowed_warning' | 'rejected',
 *       resetsAt?: int (unix seconds), utilization?: number (fraction of the window, 1 = 100%),
 *       rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
 *                       | 'seven_day_overage_included' | 'overage',
 *       unifiedWindows?: { five_hour?, seven_day?, seven_day_overage_included?: { utilization, resetsAt } },
 *       overage…, isUsingOverage?, surpassedThreshold?, … } }
 * The top level describes the window that limits now; `unifiedWindows` carries the
 * session and weekly windows on every observation. The per-model weekly windows
 * (Opus, Sonnet) arrive only as the top-level window.
 *
 * Codex app-server (assumed from its open-source protocol, not seen in real output
 * here: Codex is not installed on this computer): notification
 * `account/rateLimits/updated` with `{ rateLimits: { primary?, secondary?: { usedPercent,
 * windowDurationMins, resetsAt (unix seconds) } } }`; the `token_count` events of the CLI's
 * JSON carry the same as `rate_limits` with `used_percent`, `window_minutes`,
 * `resets_in_seconds` or `resets_at`. Both spellings are read.
 */

const WINDOW_MINUTES: Record<string, number> = { five_hour: 300, seven_day: 10_080 };
const CLAUDE_WINDOWS = new Set(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']);

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Claude's `utilization` is a fraction (1 = 100%, more when the usage runs past
 * the cap). A value above 5 cannot be a fraction: taken as a percentage already.
 */
function fractionToPercent(u: number): number {
  return Math.max(0, u > 5 ? u : u * 100);
}

/** A reset time in ms; the readings give seconds since the epoch (a value that large is already ms). */
function epochMs(v: unknown): number | null {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function claudeInfo(raw: unknown): Record<string, unknown> | null {
  const top = obj(raw);
  return obj(top?.['rate_limit_info']) ?? top;
}

/** The plan reading of one Claude Code `rate_limit_event` (or its `rate_limit_info`); null when it names no window. */
export function parseClaudeRateLimit(raw: unknown): PlanLimitsReading | null {
  const info = claudeInfo(raw);
  if (!info) return null;
  const windows = new Map<string, PlanWindowReading>();
  const unified = obj(info['unifiedWindows']);
  for (const id of ['five_hour', 'seven_day']) {
    const w = obj(unified?.[id]);
    const u = num(w?.['utilization']);
    if (!w || u === null) continue;
    windows.set(id, {
      id,
      usedPercent: fractionToPercent(u),
      resetsAt: epochMs(w['resetsAt']),
      windowMinutes: WINDOW_MINUTES[id] ?? null,
    });
  }
  // The window that limits now: the only source of the per-model weekly ones.
  const type = info['rateLimitType'];
  if (typeof type === 'string' && CLAUDE_WINDOWS.has(type) && !windows.has(type)) {
    const u = num(info['utilization']);
    const rejected = info['status'] === 'rejected';
    if (u !== null || rejected) {
      const percent = u === null ? 100 : fractionToPercent(u);
      windows.set(type, {
        id: type,
        usedPercent: rejected ? Math.max(100, percent) : percent,
        resetsAt: epochMs(info['resetsAt']),
        windowMinutes: WINDOW_MINUTES[type] ?? null,
      });
    }
  }
  if (windows.size === 0) return null;
  return { plan: 'claude', windows: [...windows.values()], partial: true };
}

/** A `rejected` event: the reset time (ms, or null) of the window that refused the request. */
export function claudeRejection(raw: unknown): { resetsAt: number | null } | null {
  const info = claudeInfo(raw);
  if (!info || info['status'] !== 'rejected') return null;
  return { resetsAt: epochMs(info['resetsAt']) };
}

/** "at 4:00 PM" within the day, "Wed 4:00 PM" later ("alle 16:00", "mer 16:00"): how a reset time reads in a message. */
export function resetPhrase(resetsAt: number, now: number): string {
  const t = providerTexts();
  return resetsAt - now < 20 * 3_600_000 ? t.resetToday(resetsAt) : t.resetLater(resetsAt);
}

function codexWindow(id: string, raw: unknown, now: number): PlanWindowReading | null {
  const w = obj(raw);
  if (!w) return null;
  const used = num(w['usedPercent'] ?? w['used_percent']);
  if (used === null) return null;
  const minutes = num(w['windowDurationMins'] ?? w['windowMinutes'] ?? w['window_minutes']);
  const inSeconds = num(w['resetsInSeconds'] ?? w['resets_in_seconds']);
  const resetsAt =
    epochMs(w['resetsAt'] ?? w['resets_at']) ??
    (inSeconds !== null ? now + inSeconds * 1000 : null);
  return {
    id,
    usedPercent: Math.max(0, used),
    resetsAt,
    windowMinutes: minutes !== null && minutes > 0 ? minutes : null,
  };
}

/**
 * The plan reading of a Codex rate-limit snapshot: the params of
 * `account/rateLimits/updated` (`{ rateLimits }`), a `token_count` payload
 * (`{ rate_limits }`) or the snapshot itself.
 */
export function parseCodexRateLimits(raw: unknown, now: number): PlanLimitsReading | null {
  const top = obj(raw);
  if (!top) return null;
  const byId = obj(top['rateLimitsByLimitId']);
  const snap =
    obj(byId?.['codex']) ??
    obj(top['rateLimits']) ??
    obj(top['rate_limits']) ??
    obj(obj(top['info'])?.['rate_limits']) ??
    top;
  const windows = [
    codexWindow('primary', snap['primary'], now),
    codexWindow('secondary', snap['secondary'], now),
  ].filter((w): w is PlanWindowReading => w !== null);
  if (windows.length === 0) return null;
  return { plan: 'chatgpt', windows, partial: false };
}
