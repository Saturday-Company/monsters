import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  AuthService,
  coreMigrations,
  EventLog,
  migrate,
  openDb,
  startCore,
  type CoreServer,
  type Db,
} from '../src/index.ts';
import { EMAIL, PASSWORD, postJson, setupUser, tempHome } from './helpers.ts';

const BURST = 5;
const dbs: Db[] = [];
let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
  for (const db of dbs.splice(0)) db.close();
});

/** An AuthService on an in-memory db with a controllable clock. */
async function authWithClock() {
  const db = openDb(':memory:');
  dbs.push(db);
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db);
  const clock = { t: 1_000_000 };
  const auth = new AuthService(db, log, {
    sessionTtlMs: 60_000,
    cliTokenPath: `${tempHome()}-unused`,
    now: () => clock.t,
  });
  await auth.setup(EMAIL, PASSWORD);
  return { auth, log, clock };
}

async function outcome(p: Promise<unknown>): Promise<'ok' | 'wrong' | 'limited'> {
  try {
    return (await p) ? 'ok' : 'wrong';
  } catch (err) {
    if (err instanceof AuthError && err.code === 'too_many_attempts') return 'limited';
    throw err;
  }
}

describe('login rate limit', () => {
  it('evaluates at most the burst of 60 parallel wrong logins', async () => {
    const { auth, log } = await authWithClock();
    const results = await Promise.all(
      Array.from({ length: 60 }, () => outcome(auth.login(EMAIL, 'wrong password'))),
    );
    expect(results.filter((r) => r === 'wrong')).toHaveLength(BURST);
    expect(results.filter((r) => r === 'limited')).toHaveLength(60 - BURST);
    // Only the evaluated attempts reached argon2 (and the log).
    const failed = log
      .query({ type: 'auth' })
      .filter((e) => e.type === 'auth' && e.data.action === 'login_failed');
    expect(failed).toHaveLength(BURST);
  });

  it('backs off progressively instead of locking out, so the right password works again soon', async () => {
    const { auth, clock } = await authWithClock();
    for (let i = 0; i < BURST; i++)
      expect(await outcome(auth.login(EMAIL, 'nope-nope'))).toBe('wrong');

    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const err = await auth.login(EMAIL, 'nope-nope').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthError);
      waits.push((err as AuthError).retryAfterMs);
      clock.t += (err as AuthError).retryAfterMs;
      expect(await outcome(auth.login(EMAIL, 'nope-nope'))).toBe('wrong');
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000]);

    // Even after many failures the wait is capped (60 s): the owner gets back in.
    for (let i = 0; i < 20; i++) {
      clock.t += 60_000;
      await auth.login(EMAIL, 'nope-nope');
    }
    const err = await auth.login(EMAIL, PASSWORD).catch((e: unknown) => e);
    expect((err as AuthError).retryAfterMs).toBeLessThanOrEqual(60_000);
    clock.t += 60_000;
    expect(await outcome(auth.login(EMAIL, PASSWORD))).toBe('ok');
    // A successful login resets the counter.
    expect(await outcome(auth.login(EMAIL, 'nope-nope'))).toBe('wrong');
  });

  it('gives a known browser its own bucket: an attacker cannot lock it out', async () => {
    const { auth } = await authWithClock();
    const first = await auth.login(EMAIL, PASSWORD);
    expect(first?.deviceToken).toBeTruthy();

    // Someone else hammers the login without the device cookie.
    for (let i = 0; i < 30; i++) await outcome(auth.login(EMAIL, 'attacker guess'));
    expect(await outcome(auth.login(EMAIL, PASSWORD))).toBe('limited');

    const again = await auth.login(EMAIL, PASSWORD, { deviceToken: first?.deviceToken });
    expect(again).not.toBeNull();
    expect(again?.deviceToken).toBe(first?.deviceToken);
    // A forged device token falls back to the shared (limited) bucket.
    expect(await outcome(auth.login(EMAIL, PASSWORD, { deviceToken: 'forged' }))).toBe('limited');
  });

  it('answers 429 with Retry-After over HTTP and sets the device cookie on success', async () => {
    core = await startCore({ home: tempHome(), port: 0 });
    await setupUser(core);
    const statuses = await Promise.all(
      Array.from({ length: 60 }, async () => {
        const res = await postJson(`${core?.url}/api/login`, {
          email: EMAIL,
          password: 'wrong password',
        });
        if (res.status === 429) expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        return res.status;
      }),
    );
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(BURST);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(60 - BURST);
  });

  it('issues a device cookie at setup that bypasses the shared bucket', async () => {
    core = await startCore({ home: tempHome(), port: 0 });
    const res = await setupUser(core);
    const device = res.headers.getSetCookie().find((c) => c.startsWith('monsters_device='));
    expect(device).toMatch(/HttpOnly/i);
    expect(device).toMatch(/SameSite=Strict/i);
    for (let i = 0; i < 20; i++) {
      await postJson(`${core.url}/api/login`, { email: EMAIL, password: 'attacker guess' });
    }
    const ok = await postJson(
      `${core.url}/api/login`,
      { email: EMAIL, password: PASSWORD },
      { cookie: device?.split(';')[0] ?? '' },
    );
    expect(ok.status).toBe(200);
  });
});
