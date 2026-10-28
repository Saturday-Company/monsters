import { readFileSync } from 'node:fs';
import { LOGIN_EXCHANGE_PATH, type FileMeta } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService, coreMigrations, EventLog, migrate, openDb, type Db } from '../src/index.ts';
import {
  FILE_TICKET_TTL_MS,
  FILE_TICKET_USES,
  THUMBS_TICKET_RESOURCE,
} from '../src/auth/auth-service.ts';
import { png } from './file-fixtures.ts';
import {
  BROWSER_HEADERS,
  browserSession,
  EMAIL,
  PASSWORD,
  postJson,
  sessionCookie,
  setupUser,
  tempHome,
} from './helpers.ts';
import { startTestHub, TERMINAL_OFF, type TestHub } from './hub-helpers.ts';

/*
 * Review of 18/10, S-B13: on 127.0.0.1 the browser sends `monsters_session` to every local
 * service, whatever its port. A browser's session is bound to a secret the UI keeps in its tab
 * (a header, the first message of the WebSocket); the bytes of a file in an <img> or an
 * <iframe> carry a short ticket of the session and of that file. And the residual risk of M1:
 * the most sensitive changes need the password typed in the last minutes.
 */

type Session = Record<string, string>;

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

const token = (t: TestHub) => readFileSync(t.core.paths.cliToken, 'utf8').trim();

async function uploadPng(t: TestHub, name: string): Promise<FileMeta> {
  const f = new FormData();
  f.set('file', new Blob([new Uint8Array(png(8, 6))]), name);
  const res = await fetch(`${t.core.url}/api/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token(t)}` },
    body: f,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as FileMeta;
}

const ticketFor = async (t: TestHub, session: Session, id: string, part = 'content') => {
  const res = await fetch(`${t.core.url}/api/files/${id}/ticket`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, ...session },
    body: JSON.stringify({ part }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { ticket: string }).ticket;
};

describe('a browser session needs its secret, not the cookie alone (S-B13)', () => {
  it('refuses a request with the cookie and no secret, or another secret', async () => {
    const t = await startTestHub({});
    const res = await setupUser(t.core);
    const session = await browserSession(res);
    const cookie = session.cookie;
    expect(session['x-monsters-session'].length).toBeGreaterThanOrEqual(43);
    // The secret is never a cookie: only the session's own cookie is set.
    expect(res.headers.getSetCookie().join('\n')).not.toContain(session['x-monsters-session']);

    const me = (headers: Session) => fetch(`${t.core.url}/api/me`, { headers });
    expect((await me(session)).status).toBe(200);
    const alone = await me({ cookie });
    expect(alone.status).toBe(401);
    expect(await alone.json()).toMatchObject({ error: 'session_secret_required' });
    expect((await me({ cookie, 'x-monsters-session': 'x'.repeat(43) })).status).toBe(401);

    // A state change as another local service would send it: the cookie, the anti-CSRF header,
    // the right Origin, everything but the secret.
    const kill = await fetch(`${t.core.url}/api/kill`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, cookie, origin: t.core.url },
      body: '{}',
    });
    expect(kill.status).toBe(401);
    expect(t.core.runs.halted).toBe(false);
    // Nor can it log the user out: only its own copy of the cookie is cleared.
    const out = await fetch(`${t.core.url}/api/logout`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, cookie },
    });
    expect(out.status).toBe(200);
    expect((await me(session)).status).toBe(200);

    // A second login is a second session with a secret of its own.
    const again = await browserSession(
      await postJson(`${t.core.url}/api/login`, { email: EMAIL, password: PASSWORD }),
    );
    expect(again['x-monsters-session']).not.toBe(session['x-monsters-session']);
    expect(
      (await me({ cookie: again.cookie, 'x-monsters-session': session['x-monsters-session'] }))
        .status,
    ).toBe(401);
  });

  it('the desktop app keeps its own cookie jar: its sessions need no secret', async () => {
    const t = await startTestHub({});
    await setupUser(t.core);
    // A password login from the app's window (D-044, one session per destination).
    const login = await postJson(`${t.core.url}/api/login`, {
      email: EMAIL,
      password: PASSWORD,
      partitioned: true,
    });
    expect(await login.clone().json()).toEqual({ email: EMAIL });
    const cookie = sessionCookie(login)!;
    expect((await fetch(`${t.core.url}/api/me`, { headers: { cookie } })).status).toBe(200);
    // The automatic login of the app (login token over its own channel, then the exchange).
    const { token: login2 } = t.core.auth.issueLoginToken('desktop');
    const exchanged = await postJson(`${t.core.url}${LOGIN_EXCHANGE_PATH}`, { token: login2 });
    expect(await exchanged.clone().json()).toEqual({ email: EMAIL });
    const me = await fetch(`${t.core.url}/api/me`, {
      headers: { cookie: sessionCookie(exchanged)! },
    });
    expect(await me.json()).toMatchObject({ owner: true, recent: true });
  });
});

describe('tickets for the bytes of a file (S-B13)', () => {
  it('an <img> loads with the cookie and a ticket of that file, never with the cookie alone', async () => {
    const t = await startTestHub({});
    const session = await browserSession(await setupUser(t.core));
    const cookie = session.cookie;
    const a = await uploadPng(t, 'a.png');
    const b = await uploadPng(t, 'b.png');
    const get = (path: string, headers: Session = { cookie }) =>
      fetch(`${t.core.url}${path}`, { headers });

    // The cookie alone, as an <img> on the page of another local service would load it.
    expect((await get(`/api/files/${a.id}/content`)).status).toBe(401);
    // With the secret (a fetch of the UI) it works, as before.
    expect((await get(`/api/files/${a.id}/content`, session)).status).toBe(200);

    const ticket = await ticketFor(t, session, a.id);
    const ok = await get(`/api/files/${a.id}/content?ticket=${ticket}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect((await get(`/api/files/${a.id}/content?download=1&ticket=${ticket}`)).status).toBe(200);
    // Another file, another part, another endpoint: refused.
    expect((await get(`/api/files/${b.id}/content?ticket=${ticket}`)).status).toBe(401);
    expect((await get(`/api/files/${a.id}/thumb?ticket=${ticket}`)).status).toBe(401);
    expect((await get(`/api/files/${a.id}?ticket=${ticket}`)).status).toBe(401);
    expect((await get(`/api/files?ticket=${ticket}`)).status).toBe(401);
    // Without the cookie, a ticket is nothing.
    expect((await get(`/api/files/${a.id}/content?ticket=${ticket}`, {})).status).toBe(401);
    // Another session's cookie with this ticket: refused.
    const other = await browserSession(
      await postJson(`${t.core.url}/api/login`, { email: EMAIL, password: PASSWORD }),
    );
    expect(
      (await get(`/api/files/${a.id}/content?ticket=${ticket}`, { cookie: other.cookie })).status,
    ).toBe(401);

    // A ticket needs a session with its secret (another service cannot ask for one) and is
    // refused to the CLI token, which sends its header anyway.
    const noSecret = await fetch(`${t.core.url}/api/files/${a.id}/ticket`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, cookie },
      body: '{}',
    });
    expect(noSecret.status).toBe(401);
    const viaToken = await fetch(`${t.core.url}/api/files/${a.id}/ticket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token(t)}` },
      body: '{}',
    });
    expect(viaToken.status).toBe(403);
  });

  it('a ticket expires after a couple of minutes and after a few requests', async () => {
    const db = openDb(':memory:');
    dbs.push(db);
    migrate(db, 'core', coreMigrations);
    const clock = { t: 1_000_000 };
    const auth = new AuthService(db, new EventLog(db), {
      sessionTtlMs: 24 * 3_600_000,
      cliTokenPath: `${tempHome()}-unused`,
      now: () => clock.t,
    });
    const session = await auth.setup(EMAIL, PASSWORD);
    const sessionId = auth.authenticateSession(session.token, {
      secret: session.secret,
    })!.sessionId!;
    const resource = 'file:F1:content';
    const load = (value: string, r = resource) =>
      auth.authenticateSession(session.token, { ticket: { value, resource: r } }) !== null;

    const { ticket } = auth.issueFileTicket(sessionId, resource);
    expect(load(ticket)).toBe(true);
    clock.t += FILE_TICKET_TTL_MS + 1;
    expect(load(ticket)).toBe(false);

    const few = auth.issueFileTicket(sessionId, resource).ticket;
    for (let i = 0; i < FILE_TICKET_USES; i++) expect(load(few)).toBe(true);
    expect(load(few)).toBe(false);

    const other = auth.issueFileTicket(sessionId, 'file:F2:content').ticket;
    expect(load(other)).toBe(false);
    expect(load(other, 'file:F2:content')).toBe(true);
  });

  it('one ticket for the thumbnails of a long list; each session keeps its own pool (review 19/10, n. 14)', async () => {
    const db = openDb(':memory:');
    dbs.push(db);
    migrate(db, 'core', coreMigrations);
    const auth = new AuthService(db, new EventLog(db), {
      sessionTtlMs: 24 * 3_600_000,
      cliTokenPath: `${tempHome()}-unused`,
    });
    const first = await auth.setup(EMAIL, PASSWORD);
    const second = (await auth.login(EMAIL, PASSWORD))!;
    const idOf = (s: { token: string; secret?: string | null }) =>
      auth.authenticateSession(s.token, { secret: s.secret ?? '' })!.sessionId!;
    const load = (s: { token: string }, value: string, resource: string) =>
      auth.authenticateSession(s.token, { ticket: { value, resource } }) !== null;

    // 600 thumbnails, one ticket: each loads, the bytes of a file do not.
    const thumbs = auth.issueFileTicket(idOf(first), THUMBS_TICKET_RESOURCE).ticket;
    for (let i = 0; i < 600; i++) expect(load(first, thumbs, `file:F${i}:thumb`)).toBe(true);
    expect(load(first, thumbs, 'file:F1:content')).toBe(false);
    expect(load(second, thumbs, 'file:F1:thumb')).toBe(false);

    // Another session asking hundreds of tickets does not push this one's out.
    const mine = auth.issueFileTicket(idOf(first), 'file:A:content').ticket;
    for (let i = 0; i < 1000; i++) auth.issueFileTicket(idOf(second), `file:B${i}:content`);
    expect(load(first, mine, 'file:A:content')).toBe(true);
  });
});

describe('the most sensitive changes need the password typed recently (residual risk of M1)', () => {
  const SHELL_FOR_RHEA = { agents: { rhea: { vault: true, web: true, shell: true, folders: [] } } };
  const WEB_ONLY_FOR_RHEA = { agents: { rhea: { vault: true, web: false, folders: [] } } };

  it('a session confirmed a while ago asks again; the password confirms it in place', async () => {
    // The terminal is on by default: this team has it off, turning it on is the sensitive change.
    const t = await startTestHub({}, { hub: { settings: TERMINAL_OFF } });
    const session = await browserSession(await setupUser(t.core));
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${t.core.url}${path}`, {
        method,
        headers: { ...BROWSER_HEADERS, ...session },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    // Just logged in: recent.
    expect(await (await call('GET', '/api/me')).json()).toMatchObject({ recent: true });

    // Sixteen minutes later.
    t.core.db.run('UPDATE sessions SET confirmed_at = ?', Date.now() - 16 * 60_000);
    expect(await (await call('GET', '/api/me')).json()).toMatchObject({
      owner: true,
      recent: false,
    });
    for (const [method, path, body] of [
      ['PUT', '/api/permissions', SHELL_FOR_RHEA],
      ['POST', '/api/telegram/pairing', {}],
      ['PUT', '/api/telegram/token', { token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi' }],
      ['PATCH', '/api/telegram/bots/222222222', { fullTools: true }],
    ] as const) {
      const res = await call(method, path, body);
      expect([path, res.status]).toEqual([path, 403]);
      expect(await res.json()).toMatchObject({ error: 'confirm_required' });
    }
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(false);
    // What is less sensitive goes on with the session: other permissions, the stop.
    expect((await call('PUT', '/api/permissions', WEB_ONLY_FOR_RHEA)).status).toBe(200);
    expect((await call('POST', '/api/kill', {})).status).toBe(200);

    // "Conferma che sei tu": a wrong password changes nothing; the right one, in place.
    const wrong = await call('POST', '/api/auth/confirm', { password: 'non è lei' });
    expect(wrong.status).toBe(400);
    expect((await call('PUT', '/api/permissions', SHELL_FOR_RHEA)).status).toBe(403);
    expect((await call('POST', '/api/auth/confirm', { password: PASSWORD })).status).toBe(200);
    expect((await call('PUT', '/api/permissions', SHELL_FOR_RHEA)).status).toBe(200);
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(true);
    const actions = t.core.log
      .query({ type: 'auth', limit: 100 })
      .map((e) => (e.data as { action: string }).action);
    expect(actions).toEqual(expect.arrayContaining(['confirm_failed', 'confirmed']));
    // The password never reaches the log.
    expect(JSON.stringify(t.core.log.query({ limit: 1000 }))).not.toContain(PASSWORD);
  });

  it('the desktop app on its own core stays recent; a session of the CLI token is not the owner', async () => {
    const t = await startTestHub({});
    await setupUser(t.core);
    t.core.db.run('UPDATE sessions SET confirmed_at = ?', Date.now() - 60 * 60_000);
    const exchange = async (by: 'desktop' | 'cli') => {
      const { token: login } = t.core.auth.issueLoginToken(by);
      const res = await postJson(`${t.core.url}${LOGIN_EXCHANGE_PATH}`, { token: login });
      return { cookie: sessionCookie(res)! };
    };
    const put = (session: Session) =>
      fetch(`${t.core.url}/api/permissions`, {
        method: 'PUT',
        headers: { ...BROWSER_HEADERS, ...session },
        body: JSON.stringify(SHELL_FOR_RHEA),
      });
    const bridge = await exchange('desktop');
    // Hours later, still the app's own session of this start: recent, no password asked.
    t.core.db.run('UPDATE sessions SET created_at = ?', Date.now() - 5 * 3_600_000);
    expect((await put(bridge)).status).toBe(200);

    const minted = await exchange('cli');
    const refused = await put(minted);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'owner_required' });
    // The password typed in that session makes it the user's, and recent.
    const confirm = await fetch(`${t.core.url}/api/auth/confirm`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...minted },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(confirm.status).toBe(200);
    expect((await put(minted)).status).toBe(200);
    // The CLI token cannot confirm anything.
    const viaToken = await fetch(`${t.core.url}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token(t)}` },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(viaToken.status).toBe(403);
  });

  it('the desktop app’s own session ends with the core that opened it (review 19/10)', async () => {
    const a = await startTestHub({});
    await setupUser(a.core);
    const { token: login } = a.core.auth.issueLoginToken('desktop');
    const res = await postJson(`${a.core.url}${LOGIN_EXCHANGE_PATH}`, { token: login });
    const bridge = { cookie: sessionCookie(res)! };
    const me = (t: TestHub) =>
      fetch(`${t.core.url}/api/me`, { headers: { ...BROWSER_HEADERS, ...bridge } });
    expect(await (await me(a)).json()).toMatchObject({ owner: true, recent: true });
    // A password session of the browser survives the restart; the app's own does not.
    const browser = await browserSession(
      await postJson(`${a.core.url}/api/login`, { email: EMAIL, password: PASSWORD }),
    );
    const home = a.core.config.home;
    await a.core.close();
    const b = await startTestHub({}, { home, withoutTeam: true });
    expect((await me(b)).status).toBe(401);
    const again = await fetch(`${b.core.url}/api/me`, {
      headers: { ...BROWSER_HEADERS, ...browser },
    });
    expect(again.status).toBe(200);
  });

  it('a monster back from the archive with the Terminal asks the same confirmation (review 19/10, n. 6)', async () => {
    // The terminal is on by default: this team has it off, only Rhea is given it.
    const t = await startTestHub({}, { hub: { settings: TERMINAL_OFF } });
    const session = await browserSession(await setupUser(t.core));
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${t.core.url}${path}`, {
        method,
        headers: { ...BROWSER_HEADERS, ...session },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    expect((await call('PUT', '/api/permissions', SHELL_FOR_RHEA)).status).toBe(200);
    expect((await call('DELETE', '/api/team/agents/dione')).status).toBe(200);
    expect((await call('DELETE', '/api/team/agents/rhea')).status).toBe(200);
    t.core.db.run('UPDATE sessions SET confirmed_at = ?', Date.now() - 16 * 60_000);

    // Dione had no Terminal: back with the session as it is.
    expect((await call('POST', '/api/team/archived/dione/restore', {})).status).toBe(200);
    // Rhea had it: the password first.
    const refused = await call('POST', '/api/team/archived/rhea/restore', {});
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'confirm_required' });
    expect(t.core.hub.team.byId('rhea')).toBeUndefined();
    expect((await call('POST', '/api/auth/confirm', { password: PASSWORD })).status).toBe(200);
    expect((await call('POST', '/api/team/archived/rhea/restore', {})).status).toBe(200);
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(true);
  });
});
