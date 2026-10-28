import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { STREAM_HEARTBEAT_MS, type StreamMessage } from '@monsters/shared';
import { startCore, type CoreServer } from '../src/index.ts';
import { BROWSER_HEADERS, browserSession, sessionCookie, setupUser, tempHome } from './helpers.ts';

let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
});

function wsUrl(c: CoreServer, query = '') {
  return `${c.url.replace('http', 'ws')}/api/stream${query}`;
}

/** Resolves with the HTTP status of a rejected handshake, or 101 if it opens. */
function handshake(url: string, options: WebSocket.ClientOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('open', () => {
      resolve(101);
      ws.close();
    });
    ws.on('error', (err) => reject(err));
  });
}

function collect(ws: WebSocket): StreamMessage[] {
  const messages: StreamMessage[] = [];
  ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString()) as StreamMessage));
  return messages;
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function loggedIn() {
  core = await startCore({ home: tempHome(), port: 0 });
  const res = await setupUser(core);
  const session = await browserSession(res);
  return {
    c: core,
    cookie: sessionCookie(res) ?? '',
    secret: session['x-monsters-session'],
    session,
  };
}

/** Opens a browser's socket and sends `first` as its first message (the session's secret, S-B13). */
async function browserSocket(c: CoreServer, cookie: string, first: string | undefined) {
  const ws = new WebSocket(wsUrl(c), { origin: c.url, headers: { cookie } });
  const messages = collect(ws);
  const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
  await new Promise((r) => ws.once('open', r));
  if (first !== undefined) ws.send(first);
  return { ws, messages, closed };
}

describe('WebSocket /api/stream', () => {
  it('rejects connections without authentication', async () => {
    const { c } = await loggedIn();
    expect(await handshake(wsUrl(c))).toBe(401);
    expect(await handshake(wsUrl(c), { origin: c.url })).toBe(401);
    expect(await handshake(wsUrl(c), { headers: { authorization: 'Bearer wrong' } })).toBe(401);
  });

  it('rejects foreign origins even with a valid session', async () => {
    const { c, cookie } = await loggedIn();
    expect(await handshake(wsUrl(c), { origin: 'https://evil.example', headers: { cookie } })).toBe(
      403,
    );
    expect(await handshake(wsUrl(c), { origin: 'null', headers: { cookie } })).toBe(403);
    expect(await handshake(wsUrl(c), { origin: c.url, headers: { cookie } })).toBe(101);
  });

  it('streams log events to an authenticated browser session', async () => {
    const { c, cookie, secret } = await loggedIn();
    const { ws, messages } = await browserSocket(
      c,
      cookie,
      JSON.stringify({ kind: 'auth', secret }),
    );
    await waitFor(() => messages.some((m) => m.kind === 'hello'));

    c.log.append({ agent: 'rhea', type: 'message', data: { role: 'agent', text: 'ciao' } });
    await waitFor(() => messages.some((m) => m.kind === 'event'));
    const ev = messages.find((m) => m.kind === 'event');
    expect(ev?.kind === 'event' && ev.event.type === 'message' && ev.event.data.text).toBe('ciao');
    ws.close();
  });

  it('accepts the CLI token and replays events after a cursor', async () => {
    const { c } = await loggedIn();
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    const first = c.log.append({ agent: 'system', type: 'error', data: { message: 'one' } });
    c.log.append({ agent: 'system', type: 'error', data: { message: 'two' } });

    const ws = new WebSocket(wsUrl(c, `?after=${first.id}`), {
      headers: { authorization: `Bearer ${token}` },
    });
    const messages = collect(ws);
    await waitFor(() => messages.some((m) => m.kind === 'replay_done'));
    const replayed = messages.flatMap((m) => (m.kind === 'event' ? [m.event] : []));
    expect(replayed.map((e) => (e.type === 'error' ? e.data.message : ''))).toEqual(['two']);
    ws.close();
  });

  it('replays every event after the cursor, page by page, then goes live without gaps', async () => {
    const { c } = await loggedIn();
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    const first = c.log.append({ agent: 'system', type: 'error', data: { message: 'cursor' } });
    for (let i = 0; i < 2500; i++) {
      c.log.append({
        agent: 'titan',
        runId: 'R',
        type: 'message',
        data: { role: 'agent', text: String(i), partial: true },
      });
    }
    const last = c.log.append({ agent: 'titan', type: 'error', data: { message: 'last' } });

    const ws = new WebSocket(wsUrl(c, `?after=${first.id}`), {
      headers: { authorization: `Bearer ${token}` },
    });
    const messages = collect(ws);
    await new Promise((r) => ws.once('open', r));
    // Written while the replay is in progress.
    const during = c.log.append({ agent: 'titan', type: 'error', data: { message: 'during' } });
    await waitFor(() => messages.some((m) => m.kind === 'replay_done'), 15_000);
    const live = c.log.append({ agent: 'titan', type: 'error', data: { message: 'live' } });
    await waitFor(() => messages.some((m) => m.kind === 'event' && m.event.id === live.id));

    const ids = messages.flatMap((m) => (m.kind === 'event' ? [m.event.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toHaveLength(2503);
    expect(ids).toContain(last.id);
    expect(ids).toContain(during.id);
    ws.close();
    // 2500 separate writes: from 0.4 s on Linux to over 6 s on a busy Windows runner.
  }, 30_000);

  it('sends a stopped run before the expiry of its open question', async () => {
    const { c } = await loggedIn();
    const token = readFileSync(c.paths.cliToken, 'utf8').trim();
    const ws = new WebSocket(wsUrl(c), { headers: { authorization: `Bearer ${token}` } });
    const messages = collect(ws);
    await waitFor(() => messages.some((m) => m.kind === 'hello'));
    const run = c.runs.startRun({ agent: 'titan', goal: 'tono?' });
    c.hub.questions.create({
      agent: 'titan',
      runId: run.id,
      question: 'Che tono?',
      options: [
        { id: '1', label: 'Ironico' },
        { id: '2', label: 'Serio' },
      ],
      blocking: true,
    });
    await c.runs.killRun(run.id, { by: 'cli' });
    await waitFor(() =>
      messages.some((m) => m.kind === 'event' && m.event.type === 'question_expired'),
    );
    const types = messages.flatMap((m) =>
      m.kind === 'event' && m.event.runId === run.id
        ? [`${m.event.type}${m.event.type === 'run' ? `:${m.event.data.status}` : ''}`]
        : [],
    );
    expect(types).toEqual(['run:started', 'question', 'kill', 'run:aborted', 'question_expired']);
    ws.close();
  });

  it('closes the stream when the session logs out', async () => {
    const { c, cookie, secret, session } = await loggedIn();
    const { messages, closed } = await browserSocket(
      c,
      cookie,
      JSON.stringify({ kind: 'auth', secret }),
    );
    await waitFor(() => messages.some((m) => m.kind === 'hello'));
    await fetch(`${c.url}/api/logout`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...session },
    });
    expect(await closed).toBe(4401);
  });

  it('a browser session without its secret gets nothing and is closed (S-B13)', async () => {
    const { c, cookie, secret } = await loggedIn();
    c.log.append({ agent: 'rhea', type: 'message', data: { role: 'agent', text: 'privato' } });
    // The cookie alone (another local service that received it): a wrong secret, a message
    // that is not the secret, the secret in the URL instead of the first message.
    for (const first of [
      JSON.stringify({ kind: 'auth', secret: 'x'.repeat(43) }),
      JSON.stringify({ kind: 'hello' }),
      'non json',
    ]) {
      const { messages, closed } = await browserSocket(c, cookie, first);
      expect(await closed).toBe(4401);
      expect(messages).toEqual([]);
    }
    const inUrl = new WebSocket(wsUrl(c, `?secret=${secret}&after=00000000000000000000000000`), {
      origin: c.url,
      headers: { cookie },
    });
    const urlMessages = collect(inUrl);
    await new Promise((r) => inUrl.once('open', r));
    inUrl.send(JSON.stringify({ kind: 'auth' }));
    expect(await new Promise<number>((r) => inUrl.once('close', (code) => r(code)))).toBe(4401);
    expect(urlMessages).toEqual([]);
    // The HTTP API refuses the cookie alone too, with a code the UI understands.
    const me = await fetch(`${c.url}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: 'session_secret_required' });
  });

  it('sends an application heartbeat the page can listen for', async () => {
    // Only the interval is faked: the sockets are real and the timers of the core keep their time.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { c, cookie, secret } = await loggedIn();
      const { ws, messages } = await browserSocket(
        c,
        cookie,
        JSON.stringify({ kind: 'auth', secret }),
      );
      await waitFor(() => messages.some((m) => m.kind === 'hello'));
      expect(messages.some((m) => m.kind === 'ping')).toBe(false);
      vi.advanceTimersByTime(STREAM_HEARTBEAT_MS);
      await waitFor(() => messages.some((m) => m.kind === 'ping'));
      ws.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Sends raw bytes to the core and resolves with what it answers until it closes the socket. */
function rawRequest(c: CoreServer, text: string): Promise<string> {
  const { port, hostname } = new URL(c.url);
  return new Promise((resolve, reject) => {
    const socket = connect({ port: Number(port), host: hostname.replace(/^\[|\]$/g, '') });
    let answer = '';
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error('the core did not close the socket'));
    });
    socket.on('data', (chunk: Buffer) => (answer += chunk.toString('latin1')));
    // A reset after the answer is as good as a clean end.
    socket.on('error', () => resolve(answer));
    socket.on('close', () => resolve(answer));
    socket.on('connect', () => socket.write(text));
  });
}

function upgradeTo(target: string): string {
  return (
    `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
    `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`
  );
}

describe('WebSocket /api/stream: whatever a client sends, the core stays up', () => {
  it('answers a malformed upgrade target with 400 and closes the socket, without an uncaught error', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      const { c } = await loggedIn();
      const targets = [
        'http://a:99999/api/stream',
        'http://[::1/x',
        'http://a b/api/stream',
        'http://:80/api/stream',
        'http://%/api/stream',
      ];
      // More than the process guard's storm threshold (25 in a minute): none may count.
      for (let round = 0; round < 6; round++) {
        for (const target of targets) {
          const answer = await rawRequest(c, upgradeTo(target));
          expect(answer.split('\r\n')[0]).toMatch(/^HTTP\/1\.1 (400|404) /);
        }
      }
      expect(await rawRequest(c, upgradeTo('http://a:99999/api/stream'))).toMatch(
        /^HTTP\/1\.1 400 /,
      );
      // The same targets on a plain request (outside the upgrade, Hono's listener has the same job).
      for (const target of targets) {
        const answer = await rawRequest(
          c,
          `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
        );
        expect(answer.split('\r\n')[0]).toMatch(/^HTTP\/1\.1 [45]\d\d /);
      }
      // Garbage that is not HTTP at all, and a socket reset in the middle of a handshake.
      await rawRequest(c, '\x00\x01\x02 not http\r\n\r\n');
      const half = connect({ port: Number(new URL(c.url).port), host: '127.0.0.1' });
      half.on('error', () => {});
      half.write(upgradeTo('/api/stream').slice(0, 40));
      half.resetAndDestroy();
      await new Promise((r) => setTimeout(r, 50));

      expect(uncaught).toEqual([]);
      // Still serving, over HTTP and over the stream.
      expect((await fetch(`${c.url}/api/setup-status`)).status).toBe(200);
      expect(await handshake(wsUrl(c))).toBe(401);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});
