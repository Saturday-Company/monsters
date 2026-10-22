import { generateKeyPairSync } from 'node:crypto';
import { jsonSchema, streamText, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { setAppLang, type PlanLimitsReading } from '@monsters/shared';
import {
  ChatGPTProvider,
  KeyedProvider,
  ProviderRegistry,
  SIWC_DIRECT_SCOPE,
  SiwcClient,
  SiwcError,
  SubscriptionPlanError,
  chatgptUnreachableText,
  isHostId,
  newHostId,
  type CredentialStore,
  type SessionEvent,
  type SiwcRecord,
} from '../src/index.ts';
import {
  fakeHttp,
  fakeSiwc,
  planError,
  responsesFailed,
  responsesText,
  responsesTool,
  streamReply,
  type FakeSiwc,
} from '../src/testing/index.ts';
import type { ModelSession } from '../src/session.ts';

const urlOf = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/*
 * Sign in with ChatGPT against a fake OpenAI (no real call): PKCE, loopback
 * callback, dynamic registration, ID token checks, serialized refresh,
 * revocation; the Responses adapter (store:false, stream:true, namespace
 * tools); plan errors that never fall back to another way of paying.
 */

function memoryStore(): CredentialStore & { record: SiwcRecord | null; writes: number } {
  const s = {
    record: null as SiwcRecord | null,
    writes: 0,
    read: () => (s.record ? structuredClone(s.record) : null),
    write: (r: SiwcRecord) => {
      s.writes++;
      s.record = structuredClone(r);
    },
  };
  return s;
}

function client(fake: FakeSiwc, store = memoryStore(), hostId = newHostId()) {
  return {
    store,
    hostId,
    siwc: new SiwcClient({ store, hostId, endpoints: fake.endpoints, fetch: fake.fetch }),
  };
}

async function signIn(fake: FakeSiwc, siwc: SiwcClient) {
  const login = await siwc.startLogin({ port: 0 });
  const res = await fetch(fake.approve(login.url));
  expect(res.status).toBe(200);
  return { login, creds: await login.done };
}

describe('Sign in with ChatGPT', () => {
  it('registers dynamically with PKCE and a loopback callback on 127.0.0.1', async () => {
    const fake = fakeSiwc();
    const { siwc, store, hostId } = client(fake);
    const { login, creds } = await signIn(fake, siwc);

    const p = fake.lastAuthorize!;
    expect(login.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(p.get('client_id')).toBe('dynamic_agent_client');
    expect(p.get('agent_name_hint')).toBe('Monsters');
    expect(p.get('ext_agent_host_id')).toBe(hostId);
    expect(isHostId(hostId)).toBe(true);
    expect(p.get('scope')).toBe(
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    );
    expect(p.get('resource')).toBe(fake.endpoints.resource);
    expect(p.get('response_type')).toBe('code');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('state')).toBeTruthy();
    expect(p.get('nonce')).toBeTruthy();

    // The code exchange carries the verifier, the issued client id and the same redirect.
    const exchange = new URLSearchParams(fake.to('/oauth/token')[0]!.body);
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('client_id')).toBe('oaiapp_fake123');
    expect(exchange.get('redirect_uri')).toBe(login.redirectUri);
    expect(exchange.get('code_verifier')).toBeTruthy();
    expect(exchange.has('client_secret')).toBe(false);

    expect(creds.client_id).toBe('oaiapp_fake123');
    expect(creds.subject).toBe('user-fake-sub');
    expect(creds.email).toBe('giulia@example.com');
    expect(creds.scopes).toContain(SIWC_DIRECT_SCOPE);
    expect(creds.ext_agent_host_id).toBe(hostId);
    expect(store.record?.registration?.client_id).toBe('oaiapp_fake123');
    expect(siwc.account()).toMatchObject({
      email: 'giulia@example.com',
      clientId: 'oaiapp_fake123',
    });
  });

  it('shows the page of the callback in the language of the app', async () => {
    try {
      for (const [lang, page] of [
        ['en', ['lang="en"', '<h1 style="font-size:1.4rem">Done</h1>', 'Signed in to ChatGPT.']],
        [
          'it',
          ['lang="it"', '<h1 style="font-size:1.4rem">Fatto</h1>', 'Accesso a ChatGPT completato.'],
        ],
      ] as const) {
        setAppLang(lang);
        const fake = fakeSiwc();
        const { siwc } = client(fake);
        const login = await siwc.startLogin({ port: 0 });
        const html = await (await fetch(fake.approve(login.url))).text();
        for (const part of page) expect(html).toContain(part);
        await login.done;
      }
    } finally {
      setAppLang('en');
    }
  });

  it('signs in again with the issued client id, hints and no agent name', async () => {
    const fake = fakeSiwc();
    const { siwc, store } = client(fake);
    await signIn(fake, siwc);
    expect(await siwc.signOut()).toEqual({ confirmed: true });
    expect(store.record?.credentials).toBeNull();
    // Revocation: the refresh token, its hint and the issued client id.
    const revoke = new URLSearchParams(fake.to('/oauth/revoke')[0]!.body);
    expect(revoke.get('token_type_hint')).toBe('refresh_token');
    expect(revoke.get('client_id')).toBe('oaiapp_fake123');

    const login = await siwc.startLogin({ port: 0 });
    const res = await fetch(fake.approve(login.url, { omitClientId: true }));
    expect(res.status).toBe(200);
    await login.done;
    const p = fake.lastAuthorize!;
    expect(p.get('client_id')).toBe('oaiapp_fake123');
    expect(p.has('agent_name_hint')).toBe(false);
    expect(p.get('id_token_hint')).toBeTruthy();
    expect(p.get('login_hint')).toBe('giulia@example.com');
    expect(siwc.signedIn()).toBe(true);
  });

  it('refuses a changed client id, a foreign state, a denial and a missing registration', async () => {
    const fake = fakeSiwc();
    const { siwc } = client(fake);

    let login = await siwc.startLogin({ port: 0 });
    await fetch(fake.approve(login.url, { error: 'access_denied' }));
    await expect(login.done).rejects.toMatchObject({ code: 'access_denied' });

    login = await siwc.startLogin({ port: 0 });
    await fetch(fake.approve(login.url, { omitClientId: true }));
    await expect(login.done).rejects.toMatchObject({ code: 'registration_incomplete' });
    // No code was ever exchanged.
    expect(fake.to('/oauth/token')).toHaveLength(0);

    await signIn(fake, siwc);
    await siwc.signOut();
    login = await siwc.startLogin({ port: 0 });
    await fetch(fake.approve(login.url, { clientId: 'oaiapp_other' }));
    await expect(login.done).rejects.toMatchObject({ code: 'client_mismatch' });

    // A foreign state is refused, and the sign-in stays open for the real answer
    // (any local page could send one to close it).
    login = await siwc.startLogin({ port: 0 });
    expect((await fetch(fake.approve(login.url, { state: 'forged' }))).status).toBe(400);
    expect((await fetch(fake.approve(login.url))).status).toBe(200);
    await expect(login.done).resolves.toMatchObject({ client_id: 'oaiapp_fake123' });
  });

  it('refuses a grant without ChatGPT plan usage', async () => {
    const fake = fakeSiwc({ scope: 'openid profile email offline_access' });
    const { siwc, store } = client(fake);
    const login = await siwc.startLogin({ port: 0 });
    await fetch(fake.approve(login.url));
    await expect(login.done).rejects.toMatchObject({ code: 'scope_missing' });
    expect(store.record?.credentials ?? null).toBeNull();
  });

  it('verifies the ID token signature against the JWKS', async () => {
    const fake = fakeSiwc();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const store = memoryStore();
    // Same claims, signed with a key the JWKS does not publish.
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      endpoints: fake.endpoints,
      fetch: async (input, init) => {
        const res = await fake.fetch(input, init);
        if (!urlOf(input).includes('/oauth/token')) return res;
        const body = (await res.json()) as Record<string, unknown>;
        const payload = String(body['id_token']).split('.')[1]!;
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
          string,
          unknown
        >;
        return new Response(JSON.stringify({ ...body, id_token: fake.idToken(claims, other) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const login = await siwc.startLogin({ port: 0 });
    await fetch(fake.approve(login.url));
    await expect(login.done).rejects.toMatchObject({ code: 'invalid_id_token' });
    expect(store.record?.credentials ?? null).toBeNull();
  });

  it('refreshes near expiry, once for concurrent callers, rotating the refresh token', async () => {
    const fake = fakeSiwc({ expiresIn: 60 });
    const { siwc, store } = client(fake);
    const { creds } = await signIn(fake, siwc);
    const before = store.record!.credentials!.refresh_token;
    const tokens = await Promise.all([siwc.accessToken(), siwc.accessToken(), siwc.accessToken()]);
    expect(fake.refreshCount).toBe(1);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).not.toBe(creds.access_token);
    const refresh = new URLSearchParams(fake.to('/oauth/token').at(-1)!.body);
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('client_id')).toBe('oaiapp_fake123');
    expect(refresh.get('resource')).toBe(fake.endpoints.resource);
    expect(refresh.has('scope')).toBe(false);
    expect(store.record!.credentials!.refresh_token).not.toBe(before);
  });

  it('keeps the tokens on a temporary failure and signs out on a terminal one', async () => {
    const fake = fakeSiwc({ expiresIn: 60 });
    const { siwc, store } = client(fake);
    const { creds } = await signIn(fake, siwc);
    fake.failRefresh = 'server_error';
    // OpenAI down for a moment: the token, still valid for a minute, serves meanwhile.
    await expect(siwc.accessToken({ minValidityMs: 20 * 60_000 })).resolves.toBe(
      creds.access_token,
    );
    expect(store.record!.credentials).not.toBeNull();

    fake.failRefresh = 'refresh_token_expired';
    await expect(siwc.accessToken()).rejects.toBeInstanceOf(SiwcError);
    expect(store.record!.credentials).toBeNull();
    // The registration stays: the next sign-in reuses the issued client id.
    expect(store.record!.registration?.client_id).toBe('oaiapp_fake123');
  });

  it('a failed refresh with an expired token is an error, not a sign-out', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 10_000), registration: null };
    const fetch = (() =>
      Promise.resolve(
        new Response('bad gateway', { status: 502 }),
      )) as unknown as typeof globalThis.fetch;
    const siwc = new SiwcClient({ store, hostId: newHostId(), fetch, now: () => now });
    await expect(siwc.accessToken()).rejects.toMatchObject({ code: 'unavailable' });
    expect(store.record.credentials).not.toBeNull();
  });
});

/** Credentials as stored after a sign-in (refresh token `RT1`). */
function storedCreds(expiresAt: number) {
  return {
    issuer: 'https://auth.openai.com',
    subject: 'u1',
    client_id: 'oaiapp_x',
    ext_agent_host_id: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    id_token: 'a.b.c',
    access_token: 'AT1',
    refresh_token: 'RT1',
    token_type: 'Bearer' as const,
    expires_in: 3600,
    scopes: [],
    saved_at: '',
    expires_at: expiresAt,
  };
}

describe('Sign in with ChatGPT: refresh against sign-out and sign-in', () => {
  /** A fake OpenAI whose token answer waits for `release()`. */
  function gatedOpenAI(answer: () => Response) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const revoked: string[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const u = urlOf(url);
      if (u.endsWith('/oauth/token')) {
        await gate;
        return answer();
      }
      if (u.endsWith('openid-configuration'))
        return new Response(
          JSON.stringify({ revocation_endpoint: 'https://auth.openai.com/revoke' }),
        );
      if (u.endsWith('/revoke')) {
        revoked.push(new URLSearchParams(init?.body as string).get('token') ?? '');
        return new Response('', { status: 200 });
      }
      throw new Error(`unexpected ${u}`);
    };
    return { fetch, release, revoked };
  }
  const rotated = () =>
    new Response(JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }), {
      status: 200,
    });

  it('a sign-out waits for the refresh in flight and revokes the rotated token', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 60_000), registration: null };
    const openai = gatedOpenAI(rotated);
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch: openai.fetch,
      now: () => now,
    });
    const token = siwc.accessToken();
    await new Promise((r) => setTimeout(r, 10));
    const out = siwc.signOut();
    openai.release();
    await expect(token).resolves.toBe('AT2');
    expect((await out).confirmed).toBe(true);
    expect(store.record.credentials).toBeNull();
    expect(openai.revoked).toEqual(['RT2']);
  });

  it('a refresh never overwrites a sign-in made meanwhile', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 60_000), registration: null };
    const openai = gatedOpenAI(rotated);
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch: openai.fetch,
      now: () => now,
    });
    const token = siwc.accessToken();
    await new Promise((r) => setTimeout(r, 10));
    // Another sign-in lands in the store (another core, a sign-in completed meanwhile).
    const fresh = { ...storedCreds(now + 3_600_000), access_token: 'ATX', refresh_token: 'RTX' };
    store.write({ version: 1, credentials: fresh, registration: null });
    openai.release();
    await expect(token).resolves.toBe('ATX');
    expect(store.record.credentials?.refresh_token).toBe('RTX');
    // The token the refresh got is revoked, never kept.
    expect(openai.revoked).toEqual(['RT2']);
  });

  it('a terminal refresh error does not sign out a sign-in made meanwhile', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 60_000), registration: null };
    const openai = gatedOpenAI(
      () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch: openai.fetch,
      now: () => now,
    });
    const token = siwc.accessToken();
    await new Promise((r) => setTimeout(r, 10));
    const fresh = { ...storedCreds(now + 3_600_000), refresh_token: 'RTX' };
    store.write({ version: 1, credentials: fresh, registration: null });
    openai.release();
    await expect(token).rejects.toMatchObject({ code: 'signed_out' });
    expect(store.record.credentials?.refresh_token).toBe('RTX');
  });
});

async function signedProvider(fake: FakeSiwc) {
  const { siwc } = client(fake);
  await signIn(fake, siwc);
  return new ChatGPTProvider({ client: siwc, fetch: fake.fetch });
}

describe('Sign in with ChatGPT: OpenAI out of reach (after a wake, in a VPN)', () => {
  const down = (code: string) =>
    new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
  const refreshed = () =>
    new Response(JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('no answer: tried again after each wait, then the new token', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 10_000), registration: null };
    let calls = 0;
    const fetch = (() => {
      calls++;
      return calls < 3 ? Promise.reject(down('ENOTFOUND')) : Promise.resolve(refreshed());
    }) as unknown as typeof globalThis.fetch;
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch,
      now: () => now,
      retryDelaysMs: [20, 40],
    });
    const started = Date.now();
    await expect(siwc.accessToken()).resolves.toBe('AT2');
    expect(calls).toBe(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(store.record.credentials?.refresh_token).toBe('RT2');
  });

  it('still no answer: the cause in the error, the sign-in kept, said in the language of the app', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 10_000), registration: null };
    let calls = 0;
    const fetch = (() => {
      calls++;
      return Promise.reject(down('SELF_SIGNED_CERT_IN_CHAIN'));
    }) as unknown as typeof globalThis.fetch;
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch,
      now: () => now,
      retryDelaysMs: [1, 1],
    });
    const err = await siwc.accessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiwcError);
    expect(err).toMatchObject({
      code: 'unavailable',
      network: { kind: 'tls', code: 'SELF_SIGNED_CERT_IN_CHAIN', host: 'auth.openai.com' },
    });
    expect((err as Error).message).toContain('auth.openai.com is unreachable (tls');
    expect(calls).toBe(3);
    // Never a sign-out for the network.
    expect(store.record.credentials?.refresh_token).toBe('RT1');
    expect(chatgptUnreachableText(err, 'in_use')).toBe(
      'I can’t reach OpenAI (auth.openai.com): the connection is intercepted by a program on the network (VPN, corporate proxy or antivirus) that Monsters doesn’t trust. Your ChatGPT sign-in is still valid: try again shortly. If you’re on a VPN or behind a corporate proxy, try without it or ask for auth.openai.com to be allowed.',
    );
    expect(chatgptUnreachableText(new Error('wrapped', { cause: err }), 'sign_in')).toContain(
      'Try connecting again shortly.',
    );
    setAppLang('it');
    try {
      expect(chatgptUnreachableText(err, 'in_use')).toBe(
        'Non riesco a raggiungere OpenAI (auth.openai.com): la connessione è intercettata da un programma della rete (VPN, proxy aziendale o antivirus) che Monsters non riconosce. L’accesso a ChatGPT resta valido: riprova tra poco. Se sei in VPN o dietro un proxy aziendale, prova senza o chiedi di consentire auth.openai.com.',
      );
      expect(chatgptUnreachableText(new Error('wrapped', { cause: err }), 'sign_in')).toContain(
        'Riprova il collegamento tra poco.',
      );
    } finally {
      setAppLang('en');
    }
  });

  it('a reset after connecting is not sent again: the refresh token may be used already', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 10_000), registration: null };
    let calls = 0;
    const fetch = (() => {
      calls++;
      return Promise.reject(down('ECONNRESET'));
    }) as unknown as typeof globalThis.fetch;
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch,
      now: () => now,
      retryDelaysMs: [1, 1],
    });
    const err = await siwc.accessToken().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'unavailable', network: { kind: 'refused' } });
    expect(calls).toBe(1);
    expect(store.record.credentials?.refresh_token).toBe('RT1');
  });

  it('an HTTP answer is OpenAI speaking: never tried again, no network words', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    store.record = { version: 1, credentials: storedCreds(now + 10_000), registration: null };
    let calls = 0;
    const fetch = (() => {
      calls++;
      return Promise.resolve(new Response('bad gateway', { status: 502 }));
    }) as unknown as typeof globalThis.fetch;
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch,
      now: () => now,
      retryDelaysMs: [1, 1],
    });
    const err = await siwc.accessToken().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'unavailable' });
    expect(calls).toBe(1);
    expect(chatgptUnreachableText(err, 'in_use')).toBeUndefined();
  });

  it('the token still valid serves meanwhile, after the attempts', async () => {
    const now = 1_000_000;
    const store = memoryStore();
    // Valid for 2 more minutes: inside the refresh margin, above the minimum.
    store.record = { version: 1, credentials: storedCreds(now + 120_000), registration: null };
    let calls = 0;
    const fetch = (() => {
      calls++;
      return Promise.reject(down('ENETUNREACH'));
    }) as unknown as typeof globalThis.fetch;
    const siwc = new SiwcClient({
      store,
      hostId: newHostId(),
      fetch,
      now: () => now,
      retryDelaysMs: [1, 1],
    });
    await expect(siwc.accessToken()).resolves.toBe('AT1');
    expect(calls).toBe(3);
  });
});

describe('ChatGPT plan windows (D-156)', () => {
  const headers = {
    'x-codex-primary-used-percent': '24',
    'x-codex-primary-window-minutes': '300',
    'x-codex-primary-reset-at': String(Math.floor(Date.now() / 1000) + 3600),
    'x-codex-secondary-used-percent': '81',
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-secondary-reset-at': String(Math.floor(Date.now() / 1000) + 86_400),
  };

  async function readings(reply: () => Response) {
    const fake = fakeSiwc();
    const { siwc } = client(fake);
    await signIn(fake, siwc);
    const seen: PlanLimitsReading[] = [];
    const provider = new ChatGPTProvider({
      client: siwc,
      fetch: fake.fetch,
      onPlanLimits: (r) => seen.push(r),
    });
    fake.replies.push(reply);
    const result = streamText({
      model: provider.model('gpt-test'),
      prompt: 'ciao',
      maxRetries: 0,
    });
    await result.consumeStream();
    return { seen, usage: await result.usage };
  }

  it('reports the windows a response carries, with its usage', async () => {
    const { seen, usage } = await readings(() => responsesText('Fatto.', 'gpt-test', headers));
    expect(usage.inputTokens).toBe(12);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ plan: 'chatgpt', partial: true });
    expect(seen[0]!.windows.map((w) => [w.id, w.usedPercent, w.windowMinutes])).toEqual([
      ['primary', 24, 300],
      ['secondary', 81, 10080],
    ]);
  });

  it('reports nothing when the response has no window, and the answer still comes', async () => {
    const { seen, usage } = await readings(() => responsesText('Fatto.'));
    expect(seen).toEqual([]);
    expect(usage.outputTokens).toBe(7);
  });

  it('reports the windows of a refused request too', async () => {
    const fake = fakeSiwc();
    const { siwc } = client(fake);
    await signIn(fake, siwc);
    const seen: PlanLimitsReading[] = [];
    const provider = new ChatGPTProvider({
      client: siwc,
      fetch: fake.fetch,
      onPlanLimits: (r) => seen.push(r),
    });
    fake.replies.push(() => {
      const res = planError(429, 'subscription_sharing_usage_limit_exceeded', 'limit');
      res.headers.set('x-codex-primary-used-percent', '100');
      return res;
    });
    const result = streamText({ model: provider.model('gpt-test'), prompt: 'ciao', maxRetries: 0 });
    await result.consumeStream();
    expect(seen[0]!.windows).toMatchObject([{ id: 'primary', usedPercent: 100 }]);
  });

  it('a failing listener never costs the request', async () => {
    const fake = fakeSiwc();
    const { siwc } = client(fake);
    await signIn(fake, siwc);
    const provider = new ChatGPTProvider({
      client: siwc,
      fetch: fake.fetch,
      onPlanLimits: () => {
        throw new Error('boom');
      },
    });
    fake.replies.push(() => responsesText('Fatto.', 'gpt-test', headers));
    const result = streamText({ model: provider.model('gpt-test'), prompt: 'ciao', maxRetries: 0 });
    expect(await result.text).toBe('Fatto.');
  });
});

describe('ChatGPT Responses adapter', () => {
  it('sends store:false, stream:true, instructions and namespaced tools; no refused parameters', async () => {
    const fake = fakeSiwc();
    const provider = await signedProvider(fake);
    fake.replies.push(
      () => responsesTool('vault_search', { query: 'ricette' }),
      () => responsesText('Trovate 2 note.'),
    );
    const calls: unknown[] = [];
    const result = streamText({
      model: provider.model('gpt-test'),
      system: 'Sei Rhea.',
      prompt: 'Cerca le ricette',
      temperature: 0.3,
      maxOutputTokens: 500,
      maxRetries: 0,
      stopWhen: () => false,
      tools: {
        vault_search: tool({
          description: 'Cerca nel vault',
          inputSchema: jsonSchema<{ query: string }>({
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          }),
          execute: (input) => {
            calls.push(input);
            return Promise.resolve({ results: 2 });
          },
        }),
      },
    });
    const text = await result.text;
    expect(calls).toEqual([{ query: 'ricette' }]);
    expect(text).toBe('Trovate 2 note.');

    const reqs = fake.to('/responses');
    expect(reqs).toHaveLength(2);
    const first = JSON.parse(reqs[0]!.body) as Record<string, unknown>;
    expect(first['store']).toBe(false);
    expect(first['stream']).toBe(true);
    expect(first['instructions']).toBe('Sei Rhea.');
    for (const refused of [
      'temperature',
      'max_output_tokens',
      'top_p',
      'previous_response_id',
      'metadata',
      'user',
    ]) {
      expect(first).not.toHaveProperty(refused);
    }
    expect((first['input'] as { role?: string }[]).some((i) => i.role === 'system')).toBe(false);
    expect(first['tools']).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'monsters',
        tools: [expect.objectContaining({ type: 'function', name: 'vault_search' })],
      }),
    ]);
    expect(reqs[0]!.headers['authorization']).toBe(`Bearer ${fake.currentAccessToken}`);

    // The second request resends the history: the call and its output, with the namespace.
    const second = JSON.parse(reqs[1]!.body) as { input: Record<string, unknown>[] };
    expect(second.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call',
          call_id: 'call_1',
          name: 'vault_search',
          namespace: 'monsters',
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_1',
          namespace: 'monsters',
        }),
      ]),
    );
    const usage = await result.totalUsage;
    expect(usage.inputTokens).toBe(24);
    expect(usage.outputTokens).toBe(14);
  });

  it('reasoning events are signs of life: a reasoning part comes before the text (F-A5)', async () => {
    const fake = fakeSiwc();
    const provider = await signedProvider(fake);
    const events = [
      { type: 'response.created', response: { id: 'r1', model: 'gpt-test', created_at: 1 } },
      { type: 'response.in_progress', response: { id: 'r1' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'rs' },
      },
      { type: 'response.reasoning_summary_text.delta', item_id: 'rs', delta: 'Ragiono. ' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs' } },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] },
      },
      { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Fatto.' },
      { type: 'response.completed', response: { id: 'r1', status: 'completed', usage: {} } },
    ];
    fake.replies.push(
      () =>
        new Response(
          events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const result = streamText({
      model: provider.model('gpt-test'),
      prompt: 'pensa',
      maxRetries: 0,
    });
    const types: string[] = [];
    for await (const part of result.fullStream) types.push(part.type);
    expect(types.indexOf('reasoning-start')).toBeGreaterThan(-1);
    expect(types.indexOf('reasoning-start')).toBeLessThan(types.indexOf('text-start'));
    expect(types.indexOf('reasoning-end')).toBeLessThan(types.indexOf('text-start'));
    expect(await result.text).toBe('Fatto.');
  });

  it('lists the visible models in server order', async () => {
    const fake = fakeSiwc();
    const provider = await signedProvider(fake);
    expect((await provider.listModels()).map((m) => m.id)).toEqual(['gpt-test', 'gpt-mini-test']);
  });
});

describe('ChatGPT plan errors', () => {
  async function chain(fake: FakeSiwc) {
    const provider = await signedProvider(fake);
    const paid = fakeHttp((req) =>
      req.url.includes('/chat/completions')
        ? streamReply('openai', { text: 'a pagamento' })
        : undefined,
    );
    const registry = new ProviderRegistry()
      .register(provider)
      .register(
        new KeyedProvider({ type: 'openai', apiKey: 'sk-test-0000000000', fetch: paid.fetch }),
      );
    const events: SessionEvent[] = [];
    const session = registry.session(
      [
        { provider: 'chatgpt', model: 'gpt-test' },
        { provider: 'openai', model: 'gpt-paid' },
      ],
      { onEvent: (e) => events.push(e) },
    );
    return { session, paid, events };
  }

  const run = async (session: ModelSession) => {
    const errors: unknown[] = [];
    const result = streamText({
      model: session,
      prompt: 'ciao',
      maxRetries: 0,
      onError: ({ error }) => {
        errors.push(error);
      },
    });
    const text = await Promise.resolve(result.text).catch(() => '');
    return { text, errors };
  };

  it('a usage limit stops the chain: no silent switch to a paid provider', async () => {
    const fake = fakeSiwc();
    const { session, paid, events } = await chain(fake);
    fake.replies.push(() =>
      planError(
        429,
        'subscription_sharing_usage_limit_exceeded',
        'You have reached the limit set for this app.',
      ),
    );
    const { text, errors } = await run(session);
    expect(text).toBe('');
    expect(paid.requests).toHaveLength(0);
    const err = errors[0] as SubscriptionPlanError;
    expect(err).toBeInstanceOf(SubscriptionPlanError);
    expect(err.code).toBe('subscription_sharing_usage_limit_exceeded');
    expect(err.message).toContain('You have reached the limit set for this app.');
    expect(err.requestId).toBe('req_fake_1');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'fallback', to: null, kind: 'subscription' }),
    );
  });

  it('a plan error after the stream opened stops the chain too', async () => {
    const fake = fakeSiwc();
    const { session, paid } = await chain(fake);
    fake.replies.push(() =>
      responsesFailed('subscription_sharing_usage_unavailable', 'Try again later.'),
    );
    const { errors } = await run(session);
    expect(paid.requests).toHaveLength(0);
    expect((errors[0] as SubscriptionPlanError).code).toBe(
      'subscription_sharing_usage_unavailable',
    );
  });

  it('keeps OpenAI codes and params of every plan error', async () => {
    const cases: [number, string, string?][] = [
      [403, 'subscription_sharing_user_not_eligible'],
      [400, 'subscription_sharing_unsupported_capability', 'tools[0]'],
      [403, 'chatpass_v2_scope_not_authorized'],
      [401, 'subscription_sharing_invalid_user'],
    ];
    for (const [status, code, param] of cases) {
      const fake = fakeSiwc();
      const { session, paid } = await chain(fake);
      fake.replies.push(() => planError(status, code, 'as it arrives', param));
      const { errors } = await run(session);
      const err = errors[0] as SubscriptionPlanError;
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      if (param) expect(err.param).toBe(param);
      expect(paid.requests).toHaveLength(0);
    }
  });

  it('any other failure of the plan does not fall back either', async () => {
    const fake = fakeSiwc();
    const { session, paid, events } = await chain(fake);
    fake.replies.push(
      () => new Response(JSON.stringify({ detail: 'direct routing unavailable' }), { status: 503 }),
    );
    const { errors } = await run(session);
    expect(errors).toHaveLength(1);
    expect(paid.requests).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'fallback', to: null }));
  });
});
