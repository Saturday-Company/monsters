import type { ProviderRegistry } from '@monsters/providers';
import type { EventLog } from './event-log.ts';

/*
 * The rate budgets live in memory; the log remembers the requests (ARCHITECTURE
 * §2.4). At startup, and whenever a provider is created again, its budget is
 * seeded with the `provider_usage` events still inside its windows, so a
 * restart does not hand out the daily quota a second time.
 *
 * One `provider_usage` is one served request, whoever made it (agent loop,
 * subagent, DecisionGate, onboarding): each call site logs only its own
 * requests, so nothing is counted twice. Failed attempts (fallbacks) leave no
 * `provider_usage` and are not restored. For OpenRouter the provider's own
 * count of the UTC day (`syncDailyQuota`, read in the background when the
 * provider is configured) covers them: once read, it replaces the log for the
 * day window, which stays the fallback when the read fails. Otherwise the
 * rate-limit headers block the budget at the first refusal.
 *
 * A provider whose quota belongs to its key (`keyId`, OpenRouter) gets back
 * only the requests of that key: a new key may be another account. Events
 * written before the fingerprint existed count only if they are not older than
 * the last change of key (`legacySince`): since then the key in use made them.
 */

/**
 * Seeds the budgets of `ids` (default: every registered provider) from the log.
 * Returns how many past requests each budget took back.
 */
export function restoreRateBudgets(
  providers: ProviderRegistry,
  log: EventLog,
  options: {
    ids?: string[];
    now?: number;
    /**
     * By provider: events without a key fingerprint count only from this time
     * (the last change of key). Absent: they all count.
     */
    legacySince?: Record<string, number>;
  } = {},
): Map<string, number> {
  const restored = new Map<string, number>();
  const targets = providers
    .list()
    .filter((p) => options.ids === undefined || options.ids.includes(p.id));
  const longest = (p: (typeof targets)[number]) =>
    Math.max(0, ...p.budget.snapshot().windows.map((w) => w.windowMs));
  const span = Math.max(0, ...targets.map(longest));
  if (span === 0) return restored;
  const usage = log.providerUsage((options.now ?? Date.now()) - span);
  for (const p of targets) {
    const legacySince = options.legacySince?.[p.id] ?? -Infinity;
    const past = (usage.get(p.id) ?? [])
      // Only the requests its windows count (OpenRouter: the free models, D-082).
      .filter((u) => u.model === undefined || p.budget.counts(u.model))
      .filter((u) =>
        p.keyId === undefined
          ? true
          : u.keyId === undefined
            ? u.ts >= legacySince
            : u.keyId === p.keyId,
      )
      .map((u) => u.ts);
    if (past.length) restored.set(p.id, p.budget.restore({ granted: past }));
  }
  return restored;
}
