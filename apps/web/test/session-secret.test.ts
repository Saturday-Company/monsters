import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/lib/api.ts';
import {
  adoptSessionSecret,
  forgetSessionSecret,
  recoverSessionSecret,
  sessionSecret,
} from '../src/lib/session-secret.ts';
import { httpTransport, type Transport } from '../src/lib/transport.ts';

/*
 * S-B13 (review of 18/10): a browser's session is bound to a secret the UI keeps in its tab and
 * sends with every request, never in a cookie nor in an URL; a new tab asks the open ones.
 */

const ORIGIN = 'http://127.0.0.1:4747';

afterEach(() => {
  forgetSessionSecret();
  vi.unstubAllGlobals();
});

describe('the secret of a browser session', () => {
  it('goes in a header of every request, and first on the WebSocket', async () => {
    const seen: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: URL, init: RequestInit) => {
        seen.push(new Headers(init.headers));
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      }),
    );
    const sent: string[] = [];
    let opened: { url: string } | null = null;
    class FakeSocket {
      onopen: (() => void) | null = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      readonly url: string;
      constructor(url: URL) {
        this.url = url.href;
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test keeps the socket
        opened = this;
      }
      send(data: string) {
        sent.push(data);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = httpTransport(ORIGIN);

    await transport.request('GET', '/api/me');
    expect(seen[0]!.get('X-Monsters-Session')).toBeNull();

    adoptSessionSecret('segreto-della-scheda');
    expect(sessionSecret()).toBe('segreto-della-scheda');
    await transport.request('POST', '/api/kill', {});
    expect(seen[1]!.get('X-Monsters-Session')).toBe('segreto-della-scheda');
    expect(seen[1]!.get('X-Monsters-Request')).toBe('1');

    let socketOpened = false;
    const socket = transport.connect('/api/stream');
    socket.onopen = () => {
      socketOpened = true;
      // The secret went before the stream's own handler ran.
      expect(sent).toEqual([JSON.stringify({ kind: 'auth', secret: 'segreto-della-scheda' })]);
    };
    (opened as unknown as FakeSocket).onopen?.();
    expect(socketOpened).toBe(true);
    // Never in the URL.
    expect((opened as unknown as FakeSocket).url).not.toContain('segreto');

    forgetSessionSecret();
    await transport.request('GET', '/api/me');
    expect(seen[2]!.get('X-Monsters-Session')).toBeNull();
  });

  it('a new tab gets it from a tab already open on the same origin, or not at all', async () => {
    expect(await recoverSessionSecret(50)).toBeNull();
    // Another tab of the same origin, holding the session's secret.
    const other = new BroadcastChannel('monsters-session');
    other.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { kind: string; id?: string };
      if (m.kind === 'ask') other.postMessage({ kind: 'give', id: m.id, secret: 'della-altra' });
    };
    try {
      expect(await recoverSessionSecret(1000)).toBe('della-altra');
      expect(sessionSecret()).toBe('della-altra');
    } finally {
      other.close();
    }
  });

  it('login and setup keep the secret the core gives; logout forgets it', async () => {
    const answers: Record<string, unknown> = {
      'POST /api/login': { email: 'giulio@example.com', sessionSecret: 'nuovo' },
      'POST /api/logout': { ok: true },
    };
    const bodies: unknown[] = [];
    const transport: Transport = {
      kind: 'http',
      request: (method, path, body) => {
        bodies.push(body);
        return Promise.resolve({ status: 200, body: answers[`${method} ${path}`] });
      },
      connect: () => {
        throw new Error('unused');
      },
    };
    const api = new ApiClient(transport);
    expect(await api.login('giulio@example.com', 'password')).toEqual({
      email: 'giulio@example.com',
    });
    expect(sessionSecret()).toBe('nuovo');
    // Outside the desktop app: a session bound to a secret (no `partitioned`).
    expect(bodies[0]).toEqual({ email: 'giulio@example.com', password: 'password' });
    await api.logout();
    expect(sessionSecret()).toBeNull();
  });
});

describe('"Conferma che sei tu" for the most sensitive changes', () => {
  it('asks the password with the reason the core gives, then sends the request again', async () => {
    const calls: string[] = [];
    let confirmed = false;
    const transport: Transport = {
      kind: 'mock',
      request: (method, path) => {
        calls.push(`${method} ${path}`);
        return Promise.resolve(
          confirmed
            ? { status: 200, body: { ok: true } }
            : { status: 403, body: { error: 'confirm_required', message: 'di nuovo' } },
        );
      },
      connect: () => {
        throw new Error('unused');
      },
    };
    const api = new ApiClient(transport);
    const reasons: string[] = [];
    api.confirmOwner = (reason) => {
      reasons.push(reason);
      confirmed = true;
      return Promise.resolve(true);
    };
    await api.logout();
    expect(reasons).toEqual(['recent']);
    expect(calls).toEqual(['POST /api/logout', 'POST /api/logout']);
  });
});
