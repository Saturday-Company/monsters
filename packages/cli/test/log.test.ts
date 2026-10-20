import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveMonthOf,
  coreMigrations,
  EventLog,
  homePaths,
  migrate,
  openDb,
} from '@monsters/core';
import { run, type Io } from '../src/main.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function capture(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

const DAY = 86_400_000;

/** A stopped core's data directory with old bulky events (200 days ago) and a recent one. */
function homeWithOldLog(): { home: string; month: string } {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-cli-log-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const db = openDb(homePaths(home).db);
  migrate(db, 'core', coreMigrations);
  const old = Date.now() - 200 * DAY;
  let now = old;
  const log = new EventLog(db, { now: () => now });
  log.append({
    agent: 'titan',
    runId: 'r1',
    type: 'provider_usage',
    data: { provider: 'openrouter', model: 'm1', costUsd: 0.0125 },
  });
  log.append({
    agent: 'titan',
    runId: 'r1',
    type: 'tool_result',
    data: { callId: 'c1', tool: 'vault_read', ok: true, output: 'x'.repeat(3000) },
  });
  log.append({
    agent: 'titan',
    runId: 'r1',
    type: 'message',
    data: { role: 'agent', text: 'Ecco la nota' },
  });
  now = Date.now();
  log.append({
    agent: 'titan',
    runId: 'r2',
    type: 'tool_result',
    data: { callId: 'c2', tool: 'vault_read', ok: true },
  });
  db.close();
  return { home, month: archiveMonthOf(old) };
}

describe('monsters log', () => {
  it('archive with the core stopped, then status and read of the month', async () => {
    const { home, month } = homeWithOldLog();

    const dry = capture();
    expect(await run(['log', 'archive', '--dry-run', '--home', home], dry)).toBe(0);
    expect(dry.lines[0]).toMatch(/^Da archiviare 2 eventi/);

    const io = capture();
    expect(await run(['log', 'archive', '--home', home], io)).toBe(0);
    expect(io.errors).toEqual([]);
    expect(io.lines[0]).toMatch(/^Archiviati 2 eventi/);
    expect(io.lines.join('\n')).toContain(`${month}  2 eventi`);
    expect(io.lines.join('\n')).toContain('Copia del database prima del primo archivio');

    // The log keeps the final answer and the recent event, plus the note of the archive.
    const db = openDb(homePaths(home).db);
    const left = db.all<{ type: string }>('SELECT type FROM events ORDER BY id').map((r) => r.type);
    db.close();
    expect(left).toEqual(['message', 'tool_result', 'log_archive']);

    const again = capture();
    expect(await run(['log', 'archive', '--home', home], again)).toBe(0);
    expect(again.lines[0]).toMatch(/^Niente da archiviare/);

    const status = capture();
    expect(await run(['log', '--home', home], status)).toBe(0);
    expect(status.lines.join('\n')).toContain('Archivio automatico: acceso');
    expect(status.lines.join('\n')).toContain(month);

    const read = capture();
    expect(await run(['log', 'read', '--month', month, '--home', home], read)).toBe(0);
    expect(read.lines).toHaveLength(2);
    expect(read.lines[0]).toMatch(/titan {2}provider_usage {2}openrouter:m1 \$0\.0125$/);
    expect(read.lines[1]).toMatch(/tool_result {2}vault_read ok$/);

    const json = capture();
    expect(
      await run(
        ['log', 'read', '--month', month, '--type', 'tool_result', '--json', '--home', home],
        json,
      ),
    ).toBe(0);
    expect(json.lines).toHaveLength(1);
    expect(JSON.parse(json.lines[0]!)).toMatchObject({
      type: 'tool_result',
      runId: 'r1',
      data: { tool: 'vault_read', ok: true },
    });
  });

  it('read: a month without archive, or no month', async () => {
    const { home } = homeWithOldLog();
    const none = capture();
    expect(await run(['log', 'read', '--month', '2001-01', '--home', home], none)).toBe(1);
    expect(none.errors[0]).toMatch(/Nessun archivio per 2001-01/);
    const bad = capture();
    expect(await run(['log', 'read', '--home', home], bad)).toBe(2);
  });
});
