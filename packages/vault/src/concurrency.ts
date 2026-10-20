/*
 * In-process locks: one mutex per path (multi-path operations lock in sorted
 * order to avoid deadlocks) and a single FIFO queue for git, which does not
 * support concurrent commits on the same repository.
 */

/** Runs tasks one at a time, in submission order. */
export class SerialQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves when every task submitted so far has settled. */
  async idle(): Promise<void> {
    await this.#tail;
  }
}

/** Mutex per key. */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  /** Acquires all keys (sorted, deduplicated) and runs `fn` while holding them. */
  async withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    try {
      for (const key of sorted) releases.push(await this.#acquire(key));
      return await fn();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  async #acquire(key: string): Promise<() => void> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    };
  }
}
