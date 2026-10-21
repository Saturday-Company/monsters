import type { EventLog } from '../../log/event-log.ts';
import type { StepCall, StepWatcher } from '../../agents/run-agent.ts';
import { instinctPrompts } from './instinct.prompts.ts';
import { instinctStrings } from './instinct.strings.ts';
import { BANDS, bandOf, STUCK_EVERY, STUCK_FIRST_STEP, stuckRequest } from './questions.ts';
import { pOf, type System1 } from './system1.ts';

/*
 * "Gira a vuoto?" during the run (D-067, research 08 §5.3), on top of the
 * rules of the call tracker (identical reads, failures in a row, D-064):
 * - rules, free: the same call with the same outcome 3 times in the last 6
 *   (a `vault_write` of the same text, a search that keeps giving the same
 *   results), or two calls alternating for 3 cycles;
 * - then Jev, every 4 steps from the 6th, only when the rules said nothing:
 *   it runs while the next step starts and its answer is read before the one
 *   after, so the loop never waits for it.
 * What it does: the first time a reminder ("stai ripetendo…: cambia strada o
 * chiudi con quello che hai"), the second time the next model of the chain.
 * Jev alone never stops a run; between 0.5 and 0.85 it only logs that the
 * monster looks stuck (the UI shows the confused monster).
 */

/** The reminder in Italian (the family of an Italian app); the one sent follows the app's language. */
export const STUCK_REMINDER = instinctPrompts('it').stuckReminder;

/** An outcome that is a failure ("errore", "errore CODE" / "error", "error CODE"): not this watcher's. */
const FAILED = /→ (?:errore|error)(?: |$)/; // i18n-ignore

/** Same call and outcome this many times in the window: going round in circles. */
const SAME_OUTCOME = 3;
const WINDOW = 6;

interface Seen {
  signature: string;
  line: string;
}

export interface StuckWatcherOptions {
  system1: System1;
  log: Pick<EventLog, 'append'>;
  /** The agent watched (id and name for the Activity). */
  agent: { id: string; name: string };
  runId: string;
  parentId?: string | null;
  goal: string;
  signal?: AbortSignal;
}

export class StuckWatcher implements StepWatcher {
  readonly #o: StuckWatcherOptions;
  readonly #calls: Seen[] = [];
  #nudges = 0;
  /** What to tell the loop before the next step. */
  #pending: { reminder?: string; demote?: boolean } | null = null;
  /** The engine is thinking (one question at a time). */
  #asking = false;
  /** Patterns already reported by the rules (each once). */
  readonly #reported = new Set<string>();
  #noticed = false;

  constructor(options: StuckWatcherOptions) {
    this.#o = options;
  }

  afterStep(step: number, calls: readonly StepCall[]): void {
    const mode = this.#o.system1.mode('stuck');
    if (mode === 'off') return;
    for (const c of calls) {
      this.#calls.push({
        signature: `${c.tool}(${c.args}) → ${c.outcome}`,
        line: `${c.tool}(${c.args}) → ${c.outcome}`,
      });
    }
    const rule = this.#rule();
    if (rule && !this.#reported.has(rule)) {
      this.#reported.add(rule);
      if (mode === 'on') this.#nudge('rules', rule);
      return;
    }
    const n = step + 1;
    if (n >= STUCK_FIRST_STEP && (n - STUCK_FIRST_STEP) % STUCK_EVERY === 0 && !this.#asking) {
      void this.#ask();
    }
  }

  beforeStep(): { reminder?: string; demote?: boolean } | null {
    const next = this.#pending;
    this.#pending = null;
    return next;
  }

  /** A rule that fires on the last calls, as a short description; null otherwise. */
  #rule(): string | null {
    const recent = this.#calls.slice(-WINDOW);
    const counts = new Map<string, number>();
    // Failures in a row are the call tracker's (reminder at 3, next model at 4).
    for (const c of recent) {
      if (FAILED.test(c.signature)) continue;
      counts.set(c.signature, (counts.get(c.signature) ?? 0) + 1);
    }
    for (const [sig, n] of counts)
      if (n >= SAME_OUTCOME) return instinctStrings().stuckRepeats(sig);
    if (recent.length === WINDOW) {
      const [a, b] = [recent[0]!.signature, recent[1]!.signature];
      if (a !== b && recent.every((c, i) => c.signature === (i % 2 === 0 ? a : b))) {
        return instinctStrings().stuckAlternates(recent[0]!.line, recent[1]!.line);
      }
    }
    return null;
  }

  async #ask(): Promise<void> {
    this.#asking = true;
    try {
      const steps = this.#calls.map((c) => c.line);
      if (steps.length < 3) return;
      const answer = await this.#o.system1.ask({
        use: 'stuck',
        agent: this.#o.agent.id,
        runId: this.#o.runId,
        parentId: this.#o.parentId ?? null,
        request: stuckRequest({ goal: this.#o.goal, steps }),
        logAs: { stuck: { kind: 'stuck', bands: BANDS.stuck } },
        ...(this.#o.signal ? { signal: this.#o.signal } : {}),
      });
      const p = pOf(answer, 'stuck');
      if (p === undefined || answer?.mode !== 'on') return;
      const band = bandOf(p, BANDS.stuck.low, BANDS.stuck.high);
      if (band === 'high') this.#nudge('model', instinctStrings().stuckByModel, p);
      else if (band === 'mid' && !this.#noticed) {
        this.#noticed = true;
        this.#event('stuck_notice', instinctStrings().stuckNotice(this.#o.agent.name), p);
      }
    } catch {
      // Aborted with the run: nothing to say.
    } finally {
      this.#asking = false;
    }
  }

  /** First a reminder, then the next model of the chain. Never a stop. */
  #nudge(by: 'rules' | 'model', why: string, p?: number): void {
    this.#nudges++;
    if (this.#nudges === 1) {
      this.#pending = { reminder: instinctPrompts().stuckReminder };
      this.#event('stuck_nudge', instinctStrings().stuckNudge(this.#o.agent.name), p, { by, why });
    } else if (this.#nudges === 2) {
      this.#pending = { reminder: instinctPrompts().stuckReminder, demote: true };
      this.#event('stuck_demote', instinctStrings().stuckDemote(this.#o.agent.name), p, {
        by,
        why,
      });
    }
  }

  #event(
    action: 'stuck_notice' | 'stuck_nudge' | 'stuck_demote',
    message: string,
    p?: number,
    details?: Record<string, unknown>,
  ): void {
    this.#o.log.append({
      agent: 'system',
      runId: this.#o.runId,
      parentId: this.#o.parentId ?? null,
      type: 'instinct',
      data: {
        use: 'stuck',
        action,
        message,
        subject: this.#o.agent.id,
        ...(p !== undefined ? { confidence: p } : {}),
        ...(details ? { details } : {}),
      },
    });
  }
}
