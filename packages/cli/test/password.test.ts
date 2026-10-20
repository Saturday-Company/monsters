import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CSRF_HEADER, CSRF_HEADER_VALUE, startCore, type CoreServer } from '@monsters/core';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type Io } from '../src/main.ts';

const dirs: string[] = [];
const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const EMAIL = 'giulio@example.com';
const OLD = 'la password vecchia';
const NEW = 'la password nuova';
const HEADERS = { 'content-type': 'application/json', [CSRF_HEADER]: CSRF_HEADER_VALUE };

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-cli-pw-'));
  dirs.push(dir);
  return join(dir, 'home');
}

type TypedIo = Io & { lines: string[]; errors: string[]; written: string };

function typed(...lines: string[]): TypedIo {
  const io: TypedIo = {
    lines: [],
    errors: [],
    written: '',
    out: (l) => io.lines.push(l),
    err: (l) => io.errors.push(l),
    write: (t) => {
      io.written += t;
    },
    input: Readable.from(lines.map((l) => `${l}\n`)),
    tty: false,
  };
  return io;
}

async function startWithAccount(h: string) {
  const core = await startCore({ home: h, port: 0, env: {}, hub: { decisionPort: null } });
  cores.push(core);
  const res = await fetch(`${core.url}/api/setup`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: EMAIL, password: OLD, setupCode: core.setupCode }),
  });
  expect(res.status).toBe(201);
  return core;
}

const login = (core: CoreServer, password: string) =>
  fetch(`${core.url}/api/login`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: EMAIL, password }),
  }).then((r) => r.status);

describe('monsters password', () => {
  it('with the core stopped: asks twice, checks, writes the data folder', async () => {
    const h = home();
    const io0 = typed(NEW, NEW);
    expect(await run(['password', '--home', h], io0)).toBe(1);
    expect(io0.errors.join('\n')).toMatch(/No account/);

    const first = await startWithAccount(h);
    await first.close();
    cores.splice(0);

    const mismatch = typed(NEW, 'altra cosa ancora');
    expect(await run(['password', '--home', h], mismatch)).toBe(1);
    expect(mismatch.errors.join('\n')).toMatch(/different/);
    const short = typed('corta', 'corta');
    expect(await run(['password', '--home', h], short)).toBe(1);
    expect(short.errors.join('\n')).toMatch(/at least 8/);
    const empty = typed();
    expect(await run(['password', '--home', h], empty)).toBe(1);

    const io = typed(NEW, NEW);
    expect(await run(['password', '--home', h], io)).toBe(0);
    expect(io.written).toContain('New password: ');
    expect(io.written).toContain('Type it again: ');
    expect(io.lines.join('\n')).toMatch(/Password changed/);
    // Never echoed back.
    expect(io.lines.join('\n') + io.written).not.toContain(NEW);

    const core = await startCore({ home: h, port: 0, env: {}, hub: { decisionPort: null } });
    cores.push(core);
    expect(await login(core, OLD)).toBe(401);
    expect(await login(core, NEW)).toBe(200);
  }, 30_000);

  it('with the core running: refused before the password is typed, nothing changes (M1)', async () => {
    const h = home();
    const core = await startWithAccount(h);
    const io = typed(NEW, NEW);
    expect(await run(['password', '--home', h], io)).toBe(1);
    expect(io.errors.join('\n')).toMatch(/Monsters is running: stop it first/);
    expect(io.written).not.toContain('New password: ');
    expect(await login(core, OLD)).toBe(200);
    expect(await login(core, NEW)).toBe(401);
  }, 30_000);
});
