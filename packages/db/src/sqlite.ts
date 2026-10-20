import { chmodSync, existsSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/** Mode of database files: owner read/write only. */
const FILE_MODE = 0o600;

/** chmod that ignores platforms without POSIX permissions. */
function chmodSafe(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch (err) {
    if (process.platform !== 'win32') throw err;
  }
}

export type SqlValue = SQLInputValue;
export type SqlParams = SqlValue[] | [Record<string, SqlValue>];

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  run(...params: SqlParams): RunResult;
  get<T = Record<string, unknown>>(...params: SqlParams): T | undefined;
  all<T = Record<string, unknown>>(...params: SqlParams): T[];
}

/**
 * Minimal database interface used by Monsters. It hides `node:sqlite` so the
 * driver can be swapped (e.g. better-sqlite3 inside Electron) without touching
 * the callers.
 */
export interface Db {
  readonly path: string;
  prepare(sql: string): Statement;
  exec(sql: string): void;
  run(sql: string, ...params: SqlParams): RunResult;
  get<T = Record<string, unknown>>(sql: string, ...params: SqlParams): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: SqlParams): T[];
  /** Runs `fn` in a transaction (nested calls use savepoints). Rolls back on throw. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

class SqliteStatement implements Statement {
  readonly #stmt: StatementSync;
  constructor(stmt: StatementSync) {
    this.#stmt = stmt;
  }
  run(...params: SqlParams): RunResult {
    const r = this.#stmt.run(...(params as SqlValue[]));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  get<T>(...params: SqlParams): T | undefined {
    return this.#stmt.get(...(params as SqlValue[])) as T | undefined;
  }
  all<T>(...params: SqlParams): T[] {
    return this.#stmt.all(...(params as SqlValue[])) as T[];
  }
}

class SqliteDb implements Db {
  readonly path: string;
  readonly #db: DatabaseSync;
  readonly #cache = new Map<string, Statement>();
  #depth = 0;

  constructor(path: string) {
    this.path = path;
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec('PRAGMA busy_timeout = 5000');
    if (path !== ':memory:') {
      this.#db.exec('PRAGMA journal_mode = WAL');
      this.#db.exec('PRAGMA synchronous = NORMAL');
    }
  }

  prepare(sql: string): Statement {
    let stmt = this.#cache.get(sql);
    if (!stmt) {
      stmt = new SqliteStatement(this.#db.prepare(sql));
      this.#cache.set(sql, stmt);
    }
    return stmt;
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  run(sql: string, ...params: SqlParams): RunResult {
    return this.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: SqlParams): T | undefined {
    return this.prepare(sql).get<T>(...params);
  }

  all<T>(sql: string, ...params: SqlParams): T[] {
    return this.prepare(sql).all<T>(...params);
  }

  transaction<T>(fn: () => T): T {
    const nested = this.#depth > 0;
    const savepoint = `sp_${this.#depth}`;
    this.#db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.#depth++;
    let ok = false;
    try {
      const result = fn();
      if (result instanceof Promise) {
        throw new TypeError('Db.transaction callback must be synchronous');
      }
      ok = true;
      return result;
    } finally {
      this.#depth--;
      if (ok) {
        this.#db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      } else if (this.#db.isTransaction) {
        this.#db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      }
    }
  }

  close(): void {
    this.#cache.clear();
    if (this.#db.isOpen) this.#db.close();
  }
}

/** Opens (or creates) a SQLite database. Files are created with mode 600. */
export function openDb(path: string): Db {
  const isFile = path !== ':memory:';
  const existed = isFile && existsSync(path);
  const db = new SqliteDb(path);
  if (isFile && !existed) {
    // Touch the file so it exists, then restrict it (and WAL/SHM siblings).
    db.exec('PRAGMA user_version');
  }
  if (isFile) {
    for (const p of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(p)) chmodSafe(p, FILE_MODE);
    }
  }
  return db;
}
