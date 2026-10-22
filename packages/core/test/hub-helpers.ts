import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '@monsters/providers';
import { FakeProvider, type FakeScript } from '@monsters/providers/testing';
import {
  appLang,
  defineTool,
  setAppLang,
  setVaultLayout,
  VAULT_LAYOUTS,
  type Lang,
  type LogEvent,
  type MonstersTool,
} from '@monsters/shared';
import { afterEach } from 'vitest';
import { z } from 'zod';
import {
  dioneBlueprint,
  newVaultLayout,
  orchestratorBlueprint,
  rheaBlueprint,
  SESSION_COOKIE,
  startCore,
  writeAgentFolder,
  type CoreServer,
  type HubOptions,
} from '../src/index.ts';
import { generateToken, hashToken } from '../src/auth/tokens.ts';
import { ownerOnly } from '../src/server/app.ts';
import { tempHome } from './helpers.ts';

/**
 * A session of the user in person on `core` (review of 18/10, M1), made in the database: the
 * account too when there is none yet. For the requests the CLI token may not make.
 */
export function ownerCookie(core: CoreServer): string {
  let user = core.db.get<{ id: string }>('SELECT id FROM users LIMIT 1');
  if (!user) {
    user = { id: 'owner-of-the-tests' };
    core.db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      user.id,
      'giulio@example.com',
      'not-a-hash',
      Date.now(),
    );
  }
  const token = generateToken();
  const now = Date.now();
  // Not bound to a secret (a session of the desktop app's own jar, S-B13) and confirmed now
  // (the password just typed): the most sensitive changes too.
  core.db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)',
    hashToken(token),
    user.id,
    now,
    now + 24 * 3_600_000,
    now,
    now,
  );
  return `${SESSION_COOKIE}=${token}`;
}

/** What only the user in person may do: approvals, grants, Telegram (see `OWNER_ONLY`). */
const ANSWER_PATH = /^\/api\/questions\/[^/]+\/answer$/;

const cores: CoreServer[] = [];
// Closing a core waits for its runs and children: on a busy Windows runner that is more than
// the 10 s default of a hook. The limit is here because `--hookTimeout` on the command line
// does not reach the projects of the workspace (vitest 5), while `--testTimeout` does.
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
  // A hub started with `lang` set the language: back to English (the language of the tests).
  setAppLang('en');
  // …and a hub on an English vault the layout in use (D-154): back to the Italian one.
  setVaultLayout('it');
}, 60_000);

export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A promise that never settles (abortable through the fake provider's gate). */
export const never = new Promise<never>(() => {});

/** Offline `web_search`: canned results. */
export const fakeWebSearch: MonstersTool = defineTool({
  name: 'web_search',
  description: 'Searches the web.',
  inputSchema: z.object({ query: z.string() }),
  readOnly: true,
  execute: ({ query }) =>
    Promise.resolve({
      query,
      results: [
        { title: 'Encelado - NASA', url: 'https://science.nasa.gov/enceladus', snippet: 'geyser' },
      ],
    }),
});

export interface TestHub {
  core: CoreServer;
  provider: FakeProvider;
  home: string;
  api: (method: string, path: string, body?: unknown) => Promise<Response>;
  json: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
  /** `json` as the user in person (a session of the UI), whatever the path. */
  ownerJson: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
  /** Resolves with the final `run` event of a run. */
  runEnded: (runId: string) => Promise<LogEvent<'run'>>;
  /** Resolves with the first event matching the predicate (past or future). */
  waitEvent: <T extends LogEvent>(match: (e: LogEvent) => e is T) => Promise<T>;
  events: (runId?: string) => LogEvent[];
}

/**
 * Hub settings for the tests that need a starting state with the terminal off: it is on by
 * default (D-159), a team of the user who turned it off looks like this.
 */
export const TERMINAL_OFF = {
  permissions: { vault: true, web: true, shell: false, folders: [], agents: {} },
};

/**
 * Starts a core on a temporary home with the default team (Titan, Rhea, Dione)
 * whose models are on the fake provider: `fake:titan`, `fake:rhea`, `fake:dione`.
 */
export async function startTestHub(
  scripts: Record<string, FakeScript>,
  options: {
    hub?: HubOptions;
    withoutTeam?: boolean;
    home?: string;
    keyId?: string;
    /** The app's language of this hub (D-153); English unless a test pins the Italian family. */
    lang?: Lang;
  } = {},
): Promise<TestHub> {
  const home = options.home ?? tempHome();
  {
    // The core reads the language from `settings.json` at its start (without one it takes the
    // machine's), and the blueprints below are written in the language in use: a test hub is
    // in the language in use (English in a test unless `inLang` or `lang` says another), or the one its home already says.
    const file = join(home, 'settings.json');
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      // no settings yet
    }
    const saved = settings['language'];
    const lang: Lang = options.lang ?? (saved === 'it' || saved === 'en' ? saved : appLang());
    if (saved !== lang) {
      mkdirSync(home, { recursive: true });
      writeFileSync(file, JSON.stringify({ ...settings, language: lang }));
    }
    setAppLang(lang);
  }
  if (!options.withoutTeam) {
    const model = (id: string) => [{ provider: 'fake', model: id }];
    const agents = join(home, 'agents');
    // The team of the vault the core will make (D-154): Italian unless the test asks for English.
    const layout = VAULT_LAYOUTS[newVaultLayout()];
    await writeAgentFolder(
      join(agents, 'titan'),
      orchestratorBlueprint({ user: 'Giulio', models: model('titan') }),
      { layout },
    );
    await writeAgentFolder(
      join(agents, 'rhea'),
      rheaBlueprint({ user: 'Giulio', models: model('rhea'), layout }),
      { layout },
    );
    await writeAgentFolder(
      join(agents, 'dione'),
      dioneBlueprint({ user: 'Giulio', models: model('dione'), layout }),
      { layout },
    );
  }
  const provider = new FakeProvider({
    models: scripts,
    ...(options.keyId ? { keyId: options.keyId } : {}),
  });
  const providers = new ProviderRegistry().register(provider);
  const core = await startCore({
    home,
    port: 0,
    env: {},
    hub: {
      providers,
      webTools: [fakeWebSearch],
      decisionPort: null,
      ...options.hub,
      settings: { watchVault: false, userName: 'Giulio', ...options.hub?.settings },
    },
  });
  cores.push(core);
  const token = readFileSync(core.paths.cliToken, 'utf8').trim();
  // The CLI token, as the CLI; the user's session for what only the user may do (M1).
  let owner: string | undefined;
  const api = (method: string, path: string, body?: unknown, forceOwner = false) => {
    const asOwner = forceOwner || ownerOnly(method, path.split('?')[0]!) || ANSWER_PATH.test(path);
    if (asOwner) owner ??= ownerCookie(core);
    return fetch(`${core.url}${path}`, {
      method,
      headers: {
        ...(asOwner ? { cookie: owner! } : { authorization: `Bearer ${token}` }),
        'content-type': 'application/json',
        'x-monsters-request': '1',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };
  const call = async <T>(
    method: string,
    path: string,
    body: unknown,
    forceOwner: boolean,
  ): Promise<T> => {
    const res = await api(method, path, body, forceOwner);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return JSON.parse(text) as T;
  };
  const json = <T>(method: string, path: string, body?: unknown) =>
    call<T>(method, path, body, false);
  const ownerJson = <T>(method: string, path: string, body?: unknown) =>
    call<T>(method, path, body, true);
  const waitEvent = <T extends LogEvent>(match: (e: LogEvent) => e is T): Promise<T> =>
    new Promise((resolve) => {
      const past = core.log.query({ limit: 1000 }).find(match);
      if (past) return resolve(past);
      const off = core.log.subscribe((e) => {
        if (match(e)) {
          off();
          resolve(e);
        }
      });
    });
  const runEnded = (runId: string) =>
    waitEvent(
      (e): e is LogEvent<'run'> =>
        e.type === 'run' && e.runId === runId && e.data.status !== 'started',
    );
  const events = (runId?: string) => core.log.query({ ...(runId ? { runId } : {}), limit: 1000 });
  return {
    core,
    provider,
    home,
    api: (method, path, body) => api(method, path, body),
    json,
    ownerJson,
    runEnded,
    waitEvent,
    events,
  };
}

/** Text of the tool results the model saw in one of its calls. */
export function toolResultsSeen(prompt: unknown): string {
  return JSON.stringify((prompt as { role: string }[]).filter((m) => m.role === 'tool'));
}

/** Everything the model saw in one of its calls. */
export function promptText(prompt: unknown): string {
  return JSON.stringify(prompt);
}
