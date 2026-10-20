import type { Db } from './sqlite.ts';

/** Small persistent key/value store for core state (e.g. the kill switch). */
export class StateStore {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  get<T>(key: string): T | undefined {
    const row = this.#db.get<{ value: string }>('SELECT value FROM state WHERE key = ?', key);
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    this.#db.run(
      `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      Date.now(),
    );
  }

  delete(key: string): void {
    this.#db.run('DELETE FROM state WHERE key = ?', key);
  }
}
