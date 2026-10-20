import type { Db } from './sqlite.ts';

export interface Migration {
  /** Positive integer, strictly increasing within a namespace. */
  version: number;
  name: string;
  up: string | ((db: Db) => void);
}

/**
 * Applies pending migrations of a namespace (e.g. "core", "vault") in order,
 * each in its own transaction. Namespaces let every package own its tables in
 * the same database without coordinating version numbers.
 * Returns the versions applied.
 */
export function migrate(db: Db, namespace: string, migrations: readonly Migration[]): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    namespace  TEXT    NOT NULL,
    version    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, version)
  ) STRICT`);

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (!Number.isInteger(m.version) || m.version < 1) {
      throw new Error(`invalid migration version ${m.version} in ${namespace}`);
    }
    if (i > 0 && sorted[i - 1]?.version === m.version) {
      throw new Error(`duplicate migration version ${m.version} in ${namespace}`);
    }
  });

  const row = db.get<{ v: number | null }>(
    'SELECT MAX(version) AS v FROM schema_migrations WHERE namespace = ?',
    namespace,
  );
  const current = row?.v ?? 0;
  const applied: number[] = [];
  for (const m of sorted) {
    if (m.version <= current) continue;
    db.transaction(() => {
      if (typeof m.up === 'string') db.exec(m.up);
      else m.up(db);
      db.run(
        'INSERT INTO schema_migrations (namespace, version, name, applied_at) VALUES (?, ?, ?, ?)',
        namespace,
        m.version,
        m.name,
        Date.now(),
      );
    });
    applied.push(m.version);
  }
  return applied;
}
