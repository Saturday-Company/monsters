import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coreMigrations, ensureHome, migrate, openDb, StateStore } from '../src/index.ts';
import { tempHome } from './helpers.ts';

const posix = process.platform !== 'win32';

describe('sqlite adapter', () => {
  it('runs prepare/run/get/all', () => {
    const db = openDb(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    expect(db.run('INSERT INTO t (name) VALUES (?)', 'a').changes).toBe(1);
    db.prepare('INSERT INTO t (name) VALUES (?)').run('b');
    expect(db.get<{ name: string }>('SELECT name FROM t WHERE id = ?', 2)?.name).toBe('b');
    expect(db.all('SELECT * FROM t')).toHaveLength(2);
    db.close();
  });

  it('rolls back failed transactions, including nested ones', () => {
    const db = openDb(':memory:');
    db.exec('CREATE TABLE t (v INTEGER)');
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT * FROM t')).toHaveLength(0);

    db.transaction(() => {
      db.run('INSERT INTO t VALUES (1)');
      try {
        db.transaction(() => {
          db.run('INSERT INTO t VALUES (2)');
          throw new Error('inner');
        });
      } catch {
        // inner rolled back, outer continues
      }
      db.run('INSERT INTO t VALUES (3)');
    });
    expect(db.all<{ v: number }>('SELECT v FROM t ORDER BY v').map((r) => r.v)).toEqual([1, 3]);
    db.close();
  });

  it('applies numbered migrations once, per namespace', () => {
    const db = openDb(':memory:');
    expect(migrate(db, 'core', coreMigrations)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(migrate(db, 'core', coreMigrations)).toEqual([]);
    expect(
      migrate(db, 'other', [{ version: 1, name: 'x', up: 'CREATE TABLE other_x (a INTEGER)' }]),
    ).toEqual([1]);
    expect(() =>
      migrate(db, 'dup', [
        { version: 1, name: 'a', up: '' },
        { version: 1, name: 'b', up: '' },
      ]),
    ).toThrow(/duplicate/);
    db.close();
  });

  it('persists state in a key/value table', () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const state = new StateStore(db);
    state.set('k', { a: 1 });
    expect(state.get('k')).toEqual({ a: 1 });
    state.delete('k');
    expect(state.get('k')).toBeUndefined();
    db.close();
  });

  it.runIf(posix)('creates the data dir with 700 and the db with 600', () => {
    const home = tempHome();
    ensureHome(home);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    const db = openDb(join(home, 'monsters.db'));
    expect(statSync(join(home, 'monsters.db')).mode & 0o777).toBe(0o600);
    db.close();
  });
});
