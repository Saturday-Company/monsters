/*
 * When the core started by the app dies unexpectedly it is restarted after a growing pause
 * (1, 2, 4, 8, 16 s), at most `maxAttempts` times in a row; a core that ran for
 * `stableAfterMs` before dying starts the count again. After that the app stops trying and
 * shows the error with a "Riprova" button.
 */

export interface RestartPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  stableAfterMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  stableAfterMs: 60_000,
};

export class RestartBackoff {
  readonly policy: RestartPolicy;
  #failures = 0;

  constructor(policy: RestartPolicy = DEFAULT_RESTART_POLICY) {
    this.policy = policy;
  }

  /** Consecutive crashes counted so far. */
  get failures(): number {
    return this.#failures;
  }

  /**
   * Records a crash of a core that had been up for `uptimeMs` (0 if it never got ready).
   * Returns the attempt number and the pause before it, or null to give up.
   */
  onCrash(uptimeMs: number): { attempt: number; delayMs: number } | null {
    if (uptimeMs >= this.policy.stableAfterMs) this.#failures = 0;
    this.#failures++;
    if (this.#failures > this.policy.maxAttempts) return null;
    const delayMs = Math.min(
      this.policy.maxDelayMs,
      this.policy.baseDelayMs * 2 ** (this.#failures - 1),
    );
    return { attempt: this.#failures, delayMs };
  }

  /** After a manual retry. */
  reset(): void {
    this.#failures = 0;
  }
}
