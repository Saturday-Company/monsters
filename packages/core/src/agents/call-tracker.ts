import { ToolError } from '@monsters/shared';
import { runtimePrompts } from './runtime.prompts.ts';

/*
 * What one agent did with its tools during one run (D-064): free models repeat
 * the same search, read the same note again or retry a call that keeps
 * failing, and every repetition is a step and a request.
 * - an identical call to a read-only tool gets the earlier result again, with
 *   no I/O, marked `repeated`; the third one is refused with a hint. Any
 *   successful call of a tool that is not read-only clears the cache (a write
 *   may change what a read returns);
 * - failures in a row (any tool) are counted: the loop reminds the agent at
 *   the third and moves to another model at the fourth;
 * - calls fixed by the SDK repair hook (`repairToolCall`) are remembered until
 *   their execution logs them.
 */

/** JSON with the keys of every object sorted: the same arguments give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return value;
}

/** Identical read-only calls answered from the cache before the next one is refused. */
export const MAX_IDENTICAL_CALLS = 2;
/** Failures in a row before a reminder to the agent. */
export const ERROR_STREAK_REMINDER = 3;
/** Failures in a row before the session moves to the next model. */
export const ERROR_STREAK_DEMOTE = 4;

/** What a refused repeated call says (the app's language at the moment it is read). */
export const repeatedCallHint = (): string => runtimePrompts().repeatedCallHint;

/** What the agent reads in the next step after failures in a row. */
export function errorStreakReminder(count: number): string {
  return runtimePrompts().errorStreakReminder(count);
}

interface Seen {
  count: number;
  output: unknown;
}

export class CallTracker {
  readonly #calls = new Map<string, Seen>();
  readonly #repaired = new Map<string, string[]>();
  #streak = 0;
  /** Streak value already reported to the loop (each threshold fires once per streak). */
  #reported = 0;

  /**
   * Before running a read-only tool: the earlier result of the same call, or
   * a `REPEATED_CALL` error at the third identical call. Undefined when the
   * call is new.
   */
  repeat(tool: string, input: unknown): { output: unknown } | undefined {
    const seen = this.#calls.get(`${tool}:${stableJson(input)}`);
    if (!seen) return undefined;
    if (seen.count >= MAX_IDENTICAL_CALLS) {
      seen.count++;
      throw new ToolError(
        'REPEATED_CALL',
        `${tool} called ${seen.count} times with the same arguments`,
        { hint: repeatedCallHint() },
      );
    }
    seen.count++;
    return { output: seen.output };
  }

  /** After a successful call: remembered when read-only, otherwise the cache is cleared. */
  remember(tool: string, input: unknown, output: unknown, readOnly: boolean): void {
    if (!readOnly) {
      this.#calls.clear();
      return;
    }
    this.#calls.set(`${tool}:${stableJson(input)}`, { count: 1, output });
  }

  /** Counts a result: a failure extends the streak, a success ends it. */
  result(ok: boolean): void {
    if (ok) {
      this.#streak = 0;
      this.#reported = 0;
    } else this.#streak++;
  }

  get errorStreak(): number {
    return this.#streak;
  }

  /**
   * What the loop should do before the next step: `remind` when the streak
   * reached the reminder threshold, `demote` at the demote threshold. Each
   * fires once per streak.
   */
  streakAction(): { action: 'remind' | 'demote'; count: number } | null {
    const n = this.#streak;
    if (n >= ERROR_STREAK_DEMOTE && this.#reported < ERROR_STREAK_DEMOTE) {
      this.#reported = n;
      return { action: 'demote', count: n };
    }
    if (n >= ERROR_STREAK_REMINDER && this.#reported < ERROR_STREAK_REMINDER) {
      this.#reported = n;
      return { action: 'remind', count: n };
    }
    return null;
  }

  /** The SDK repair hook fixed this call: what it fixed (logged with the call). */
  markRepaired(callId: string, what: string[]): void {
    if (what.length > 0)
      this.#repaired.set(callId, [...(this.#repaired.get(callId) ?? []), ...what]);
  }

  /** What was repaired in this call (read once). */
  takeRepaired(callId: string): string[] {
    const what = this.#repaired.get(callId) ?? [];
    this.#repaired.delete(callId);
    return what;
  }
}
