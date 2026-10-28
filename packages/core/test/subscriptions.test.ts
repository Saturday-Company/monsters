import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as nodeFs from 'node:fs';
import type * as nodeFsPromises from 'node:fs/promises';
import type { HarnessBinary } from '@monsters/providers';
import {
  fake as fake2,
  FAKE_CLAUDE_SCRIPT,
  FAKE_CODEX_SCRIPT,
  fakeSiwc,
  planError,
  responsesText,
  type FakeSiwc,
} from '@monsters/providers/testing';
import type { ClaudeConnectionsResponse, LogEvent, SubscriptionsResponse } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FREE_CHAIN } from '../src/agents/archetypes.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * Subscriptions end to end on a real core (M2.7, D-035), with a fake OpenAI
 * and fake `claude`/`codex` binaries: ChatGPT sign-in and plan errors without
 * fallback, Claude Agent and Codex runs with Monsters' tools over MCP, the kill
 * switch, the child's environment, and no file under ~/.claude ever opened by
 * Monsters.
 */

// Every path Monsters' own code touches through node:fs (the fake binaries run
// in their own processes and are not counted).
const touched: string[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof nodeFs>();
  const wrapped: Record<string, unknown> = {};
  // `realpathSync.native` and the like are wrapped too: the code calls them.
  const track = (fn: (...a: unknown[]) => unknown): unknown => {
    const w = (...args: unknown[]) => {
      for (const a of args.slice(0, 2)) {
        if (typeof a === 'string' || a instanceof URL) touched.push(String(a));
      }
      return fn(...args);
    };
    const native = (fn as { native?: unknown }).native;
    return typeof native === 'function'
      ? Object.assign(w, { native: track(native as (...a: unknown[]) => unknown) })
      : w;
  };
  for (const [name, value] of Object.entries(real)) {
    wrapped[name] =
      typeof value === 'function' && /^[a-z]/.test(name)
        ? track(value as (...a: unknown[]) => unknown)
        : value;
  }
  // isomorphic-git probes this property on the fs it gets.
  wrapped['_original_unwrapped_fs'] = undefined;
  return { ...wrapped, default: wrapped };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof nodeFsPromises>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    wrapped[name] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            for (const a of args.slice(0, 2)) {
              if (typeof a === 'string' || a instanceof URL) touched.push(String(a));
            }
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value;
  }
  // isomorphic-git probes this property on the fs it gets.
  wrapped['_original_unwrapped_fs'] = undefined;
  return { ...wrapped, default: wrapped };
});

let dir: string;
let fakeHome: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monsters-subs-'));
  fakeHome = join(dir, 'home');
  // The user's login, as Claude Code keeps it: only the binary may read it.
  mkdirSync(join(fakeHome, '.claude'), { recursive: true });
  writeFileSync(
    join(fakeHome, '.claude', '.credentials.json'),
    JSON.stringify({ method: 'claude.ai', sentinel: 'never-read-by-monsters' }),
  );
  // The user's environment, with keys that must not reach the children.
  vi.stubEnv('HOME', fakeHome);
  vi.stubEnv('USERPROFILE', fakeHome);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-user-key-not-for-children');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'auth-token-not-for-children');
  vi.stubEnv('OPENAI_API_KEY', 'sk-openai-not-for-children');
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-not-for-children');
  vi.stubEnv('MONSTERS_SOMETHING', 'not-for-children');
  touched.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const records = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown> & { kind: string });
  } catch {
    return [];
  }
};

function fakeBinary(
  script: string,
  scenario: string,
  extra: string[] = [],
): { binary: HarnessBinary; record: string } {
  const record = join(dir, `${scenario}-${Math.random().toString(36).slice(2)}.jsonl`);
  return {
    record,
    binary: {
      command: process.execPath,
      args: [script, `--fake-record=${record}`, `--fake-scenario=${scenario}`, ...extra],
      source: 'configured',
    },
  };
}

async function until<T>(read: () => Promise<T> | T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const isRunEnd =
  (runId: string) =>
  (e: LogEvent): e is LogEvent<'run'> =>
    e.type === 'run' && e.runId === runId && e.data.status !== 'started';

interface Sent {
  runId: string;
}

async function signInChatGPT(t: TestHub, fake: FakeSiwc): Promise<void> {
  const login = await t.json<{ authorizeUrl: string; redirectUri: string }>(
    'POST',
    '/api/subscriptions/chatgpt/login',
    {},
  );
  expect(login.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  expect((await fetch(fake.approve(login.authorizeUrl))).status).toBe(200);
  await until(
    () => t.json<SubscriptionsResponse>('GET', '/api/subscriptions'),
    (v) => v.chatgpt.signedIn,
  );
}

function hubOptions(
  fake: FakeSiwc,
  binaries: { claude?: HarnessBinary; codex?: HarnessBinary } = {},
) {
  return {
    hub: {
      fetch: fake.fetch,
      subscriptions: {
        siwcEndpoints: fake.endpoints,
        callbackPort: 0,
        binaries: { claude: binaries.claude ?? null, codex: binaries.codex ?? null },
      },
    },
  };
}

describe('ChatGPT plan', () => {
  it('signs in from the API, keeps tokens out of the log and runs an agent on the plan', async () => {
    const fake = fakeSiwc();
    const t = await startTestHub({}, hubOptions(fake));
    await signInChatGPT(t, fake);

    const view = await t.json<SubscriptionsResponse>('GET', '/api/subscriptions');
    expect(view.chatgpt).toMatchObject({
      signedIn: true,
      email: 'giulia@example.com',
      welcomeSeen: false,
      usageUrl: 'https://chatgpt.com/settings/usage',
    });
    // The license is an id the UI words in the app's language, not an Italian sentence.
    expect(view.claude.package.license).toBe('proprietary');
    expect(view.codex.package.license).toBe('Apache-2.0');
    const file = join(t.home, 'secrets', 'chatgpt.json');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(t.home, 'chatgpt-host-id'), 'utf8')).toMatch(/^urn:uuid:/);
    await t.json('POST', '/api/subscriptions/chatgpt/welcome', {});
    expect(
      (await t.json<SubscriptionsResponse>('GET', '/api/subscriptions')).chatgpt.welcomeSeen,
    ).toBe(true);

    await t.json('PUT', '/api/agents/titan/models', {
      models: [
        { provider: 'chatgpt', model: 'gpt-test' },
        { provider: 'fake', model: 'titan' },
      ],
    });
    fake.replies.push(() => responsesText('Ciao dal piano ChatGPT.'));
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'ciao' });
    await t.waitEvent(isRunEnd(sent.runId));
    const events = t.events(sent.runId);
    const usage = events.find((e) => e.type === 'provider_usage');
    expect(usage?.data).toMatchObject({ provider: 'chatgpt', model: 'gpt-test' });
    expect(
      events.some((e) => e.type === 'message' && e.data.text === 'Ciao dal piano ChatGPT.'),
    ).toBe(true);

    // The usage limit is shown as it arrives; the fake provider (second link) is never asked.
    fake.replies.splice(0);
    fake.replies.push(() =>
      planError(
        429,
        'subscription_sharing_usage_limit_exceeded',
        'You have reached the limit for this app.',
      ),
    );
    t.provider.calls.length = 0;
    const limited = await t.json<Sent>('POST', '/api/messages', { text: 'ancora' });
    await t.waitEvent(isRunEnd(limited.runId));
    const error = t
      .events(limited.runId)
      .find(
        (e) => e.type === 'error' && e.data.code === 'subscription_sharing_usage_limit_exceeded',
      );
    expect((error?.data as { message?: string } | undefined)?.message).toContain(
      'You have reached the limit for this app.',
    );
    expect(t.provider.calls).toHaveLength(0);

    // No token ever reached the log.
    const all = JSON.stringify(t.core.log.all());
    for (const token of fake.validTokens) expect(all).not.toContain(token);

    const out = await t.json<SubscriptionsResponse>('DELETE', '/api/subscriptions/chatgpt');
    expect(out.chatgpt.signedIn).toBe(false);
    expect(t.core.hub.providers.has('chatgpt')).toBe(false);
  });
});

describe('Claude Agent', () => {
  it("runs an agent on the user's Claude Code with Monsters tools over MCP", async () => {
    const fake = fakeSiwc();
    const { binary, record } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));

    // Off until the user turns it on; the login comes from the binary.
    expect((await t.json<SubscriptionsResponse>('GET', '/api/subscriptions')).claude.enabled).toBe(
      false,
    );
    const on = await t.json<SubscriptionsResponse>(
      'POST',
      '/api/subscriptions/claude-agent/activate',
      {},
    );
    expect(on.claude).toMatchObject({
      enabled: true,
      state: 'subscription',
      authMethod: 'claude.ai',
    });

    await t.json('PUT', '/api/agents/rhea/models', {
      models: [{ provider: 'claude-agent', model: 'sonnet' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));
    const events = t.events(sent.runId);

    // Monsters' tool, called by the harness over MCP, is logged as Rhea's, in the run.
    const call = events.find((e) => e.type === 'tool_call' && e.data.tool === 'vault_search');
    expect(call).toMatchObject({ agent: 'rhea', runId: sent.runId });
    expect(
      events.some((e) => e.type === 'tool_result' && e.data.tool === 'vault_search' && e.data.ok),
    ).toBe(true);
    expect(events.find((e) => e.type === 'provider_usage')?.data).toMatchObject({
      provider: 'claude-agent',
      model: 'claude-sonnet-test',
    });
    const final = events
      .filter(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' && e.agent === 'rhea' && !e.data.partial,
      )
      .at(-1);
    expect(final?.data.text).toContain('Fatto:');
    expect(
      events.find((e): e is LogEvent<'run'> => e.type === 'run' && e.data.status !== 'started')
        ?.data.status,
    ).toBe('completed');

    // AGENTS.md in the agent's folder (D-007), no CLAUDE.md: Claude Code reads
    // no file of the folder and gets AGENTS.md in the appended prompt (D-079).
    const run = records(record).find((r) => r.kind === 'run')!;
    const cwd = run['cwd'] as string;
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toContain('Rhea');

    // The child's environment: the user's, without unwanted keys or Monsters settings.
    const withEnv = records(record).filter((r) => r['env'] !== undefined);
    expect(withEnv.map((r) => r.kind)).toEqual(['version', 'status', 'run']);
    for (const r of withEnv) {
      const env = r['env'] as Record<string, string>;
      for (const name of [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'OPENAI_API_KEY',
        'OPENROUTER_API_KEY',
        'MONSTERS_SOMETHING',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ]) {
        expect(env[name], `${r.kind}: ${name}`).toBeUndefined();
      }
      expect(env['HOME']).toBe(fakeHome);
      expect(Object.values(env).join('\n')).not.toContain(t.core.paths.home);
    }
    expect((run['argv'] as string[]).includes('--bare')).toBe(false);

    // Monsters never opened anything under ~/.claude (the binary did, by itself).
    const claudeDir = join(fakeHome, '.claude');
    // The spy sees the harness code too (it writes the run's MCP config).
    expect(touched.some((p) => p.endsWith('mcp.json'))).toBe(true);
    expect(touched.filter((p) => p.startsWith(claudeDir))).toEqual([]);
    expect(touched.filter((p) => p.includes('.credentials.json'))).toEqual([]);
  });

  it('abbonamento prima (D-069): the agents on the default chain move to Claude, once', async () => {
    const fake = fakeSiwc();
    const { binary } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));
    // Dione is still on the free chain Monsters gave it; Rhea's chain was chosen.
    await t.core.hub.team.setModels('dione', DEFAULT_FREE_CHAIN);
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    await until(
      () => t.core.hub.team.get('dione')!.config.models[0]!.provider,
      (p) => p === 'claude-agent',
    );
    expect(t.core.hub.team.get('dione')!.config.models).toEqual([
      { provider: 'claude-agent', model: 'sonnet' },
    ]);
    expect(t.core.hub.team.get('rhea')!.config.models[0]!.provider).toBe('fake');
    const said = t.core.log
      .query({ type: 'message', limit: 100 })
      .filter((e) => e.type === 'message' && e.data.role === 'system')
      .map((e) => (e as LogEvent<'message'>).data.text);
    expect(said).toContain(
      'Now Dione works with your Claude plan. You can change it in Settings → Models.',
    );
    // Once per plan: a chain the user puts back later stays.
    await t.core.hub.team.setModels('dione', DEFAULT_FREE_CHAIN);
    await t.json('GET', '/api/subscriptions?check=1');
    expect(t.core.hub.team.get('dione')!.config.models).toEqual(DEFAULT_FREE_CHAIN);
  });

  it('services through Claude (D-069): chosen in the gallery, asked to the binary, in the run', async () => {
    const fake = fakeSiwc();
    const { binary, record } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));
    // Without the Claude plan the gallery keeps them as "Presto".
    expect((await t.json<ClaudeConnectionsResponse>('GET', '/api/claude-connections')).claude).toBe(
      false,
    );
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    const figma = await t.json<ClaudeConnectionsResponse>(
      'PUT',
      '/api/claude-connections/figma',
      {},
    );
    expect(figma.claude).toBe(true);
    expect(figma.connections.find((c) => c.id === 'figma')).toMatchObject({
      added: true,
      state: 'connected',
    });
    const slack = await t.json<ClaudeConnectionsResponse>('PUT', '/api/claude-connections/slack', {
      agents: ['rhea'],
    });
    expect(slack.connections.find((c) => c.id === 'slack')!.state).toBe('needs_login');
    await expect(t.json('PUT', '/api/claude-connections/github', {})).rejects.toThrow(/404/);

    await t.json('PUT', '/api/agents/rhea/models', {
      models: [{ provider: 'claude-agent', model: 'sonnet' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));
    const run = records(record)
      .filter((r) => r.kind === 'run')
      .at(-1)!;
    const argv = run['argv'] as string[];
    expect(argv).not.toContain('--strict-mcp-config');
    expect(argv).toEqual(expect.arrayContaining(['mcp__claude_ai_Figma', 'mcp__claude_ai_Slack']));
    // The checks ran in a folder of Monsters, not in the user's projects.
    for (const r of records(record).filter((x) => x.kind === 'mcp-get')) {
      // The child's cwd is spelled by its system (real on macOS, `/private/var/…`; the short
      // 8.3 name kept on Windows): both sides in their real spelling.
      expect(realpathSync.native(r['cwd'] as string)).toContain(
        realpathSync.native(t.core.paths.home),
      );
    }
    const removed = await t.json<ClaudeConnectionsResponse>(
      'DELETE',
      '/api/claude-connections/slack',
    );
    expect(removed.connections.find((c) => c.id === 'slack')!.added).toBe(false);
  });

  it('the kill switch stops a harness that ignores SIGINT in less than 2 s', async () => {
    const fake = fakeSiwc();
    const { binary, record } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'hang');
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    await t.json('PUT', '/api/agents/titan/models', {
      models: [{ provider: 'claude-agent', model: 'sonnet' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'lavora a lungo' });
    await t.waitEvent(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' && e.runId === sent.runId && e.data.partial === true,
    );
    const pid = (await until(
      () => records(record).find((r) => r.kind === 'run'),
      (r) => r !== undefined,
    ))!['pid'] as number;
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive()).toBe(true);
    const started = Date.now();
    await t.json('POST', '/api/kill', { reason: 'test' });
    await until(
      () => alive(),
      (a) => !a,
      3000,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    const end = await t.waitEvent(isRunEnd(sent.runId));
    expect(end.data.status).toBe('aborted');

    // The request in flight is counted, and before the kill closes the run.
    await until(
      () => t.events(sent.runId),
      (events) => events.some((e) => e.type === 'error' && e.data.code === 'aborted'),
    );
    const events = t.events(sent.runId);
    const usageAt = events.findIndex((e) => e.type === 'provider_usage');
    const closedAt = events.findIndex((e) => e.type === 'run' && e.data.status === 'aborted');
    expect(usageAt).toBeGreaterThanOrEqual(0);
    expect(usageAt).toBeLessThan(closedAt);
    expect(events[usageAt]?.data).toMatchObject({
      provider: 'claude-agent',
      inputTokens: 100,
      outputTokens: 1,
    });
    expect(events.filter((e) => e.type === 'provider_usage')).toHaveLength(1);
  });

  it('a chain starting with a harness that is off fails clearly, never the next link', async () => {
    const fake = fakeSiwc();
    const { binary } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    await t.json('PUT', '/api/agents/titan/models', {
      models: [
        { provider: 'claude-agent', model: 'sonnet' },
        { provider: 'fake', model: 'titan' },
      ],
    });
    // Turned off afterwards: the agent's chain still starts with it.
    await t.json('DELETE', '/api/subscriptions/claude-agent');
    t.provider.calls.length = 0;
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'ciao' });
    const end = await t.waitEvent(isRunEnd(sent.runId));
    expect(end.data.status).toBe('failed');
    const error = t
      .events(sent.runId)
      .find((e) => e.type === 'error' && e.data.code === 'harness_unavailable');
    expect((error?.data as { message?: string } | undefined)?.message).toContain('Claude Agent');
    expect(t.provider.calls).toHaveLength(0);
  });

  it('the run budget stops the harness (D-021)', async () => {
    const fake = fakeSiwc();
    const { binary } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool');
    const options = hubOptions(fake, { claude: binary });
    const t = await startTestHub(
      {},
      { hub: { ...options.hub, settings: { limits: { plan: { maxRunSteps: 1 } } } } },
    );
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    await t.json('PUT', '/api/agents/titan/models', {
      models: [{ provider: 'claude-agent', model: 'sonnet' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'lavora' });
    await t.waitEvent(isRunEnd(sent.runId));
    const limit = t
      .events(sent.runId)
      .find((e) => e.type === 'error' && e.data.code === 'run_limit');
    expect(limit?.agent).toBe('titan');
    expect((limit?.data as { message?: string } | undefined)?.message).toContain(
      'model steps on the plan',
    );
    expect(limit?.data).toMatchObject({ limit: { kind: 'steps', value: 1, plan: true } });
  });

  it('reports a missing login with the terminal instruction, never a login of its own', async () => {
    writeFileSync(
      join(fakeHome, '.claude', '.credentials.json'),
      JSON.stringify({ method: 'none' }),
    );
    const fake = fakeSiwc();
    const { binary } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));
    const on = await t.json<SubscriptionsResponse>(
      'POST',
      '/api/subscriptions/claude-agent/activate',
      {},
    );
    expect(on.claude.state).toBe('logged_out');
  });
});

describe('Codex', () => {
  it('needs ChatGPT, then runs with the SIWC token and Monsters tools over MCP', async () => {
    const fake = fakeSiwc();
    const { binary, record } = fakeBinary(FAKE_CODEX_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { codex: binary }));
    const refused = await t.api('POST', '/api/subscriptions/codex/activate', {});
    expect(refused.status).toBe(400);
    expect((await t.json<SubscriptionsResponse>('GET', '/api/subscriptions')).codex.state).toBe(
      'needs_chatgpt',
    );

    await signInChatGPT(t, fake);
    const on = await t.json<SubscriptionsResponse>('POST', '/api/subscriptions/codex/activate', {});
    expect(on.codex).toMatchObject({ enabled: true, state: 'ready' });

    await t.json('PUT', '/api/agents/dione/models', {
      models: [{ provider: 'codex', model: 'gpt-test' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Dione scrivi la bozza' });
    const end = await t.waitEvent(isRunEnd(sent.runId));
    expect(end.data.status).toBe('completed');
    const events = t.events(sent.runId);
    expect(
      events.find((e) => e.type === 'tool_call' && e.data.tool === 'vault_search'),
    ).toMatchObject({
      agent: 'dione',
    });
    expect(events.find((e) => e.type === 'provider_usage')?.data).toMatchObject({
      provider: 'codex',
    });

    const start = records(record).find((r) => r.kind === 'start')!;
    const env = start['env'] as Record<string, string>;
    expect(env['ACCESS_TOKEN']).toBe(fake.currentAccessToken);
    expect(env['CODEX_HOME']).toBe(join(t.home, 'harness', 'codex-home'));
    for (const name of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'MONSTERS_SOMETHING',
    ]) {
      expect(env[name], name).toBeUndefined();
    }
    // The access token never reached the log.
    expect(JSON.stringify(t.core.log.all())).not.toContain(fake.currentAccessToken);
  });

  it('D-140: Codex has no stop hook, so the core corrects what it said about the accesses', async () => {
    const fake = fakeSiwc();
    const { binary } = fakeBinary(FAKE_CODEX_SCRIPT, 'tool', [
      '--fake-answer=La ricerca web mi è stata negata dai permessi di questa sessione.',
    ]);
    const t = await startTestHub(
      {
        titan: [
          fake2.toolCall('delegate', { agent: 'Dione', goal: 'I prezzi del museo' }),
          fake2.text('Ecco.'),
        ],
      },
      hubOptions(fake, { codex: binary }),
    );
    await signInChatGPT(t, fake);
    inLang('it');
    await t.json('POST', '/api/subscriptions/codex/activate', {});
    await t.json('PUT', '/api/agents/dione/models', {
      models: [{ provider: 'codex', model: 'gpt-test' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'prezzi del museo' });
    expect((await t.waitEvent(isRunEnd(sent.runId))).data.status).toBe('completed');
    const events = t.events(sent.runId);
    const done = events.find(
      (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status === 'completed',
    )!;
    // The report that reaches the orchestrator carries the correction of the core.
    expect(done.data.summary).toContain('[Nota di Monsters]');
    expect(
      events.filter((e) => e.type === 'instinct' && e.data.action === 'access_claim'),
    ).toHaveLength(1);
  });

  it('the MCP endpoint refuses unknown tokens', async () => {
    const fake = fakeSiwc();
    const t = await startTestHub({}, hubOptions(fake));
    const res = await fetch(`${t.core.url}/api/harness/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('Claude Agent and the questions (D-078)', () => {
  async function onClaude(
    scenario: string,
    settings: Record<string, unknown> = {},
    extra: string[] = [],
  ) {
    const fake = fakeSiwc();
    const { binary, record } = fakeBinary(FAKE_CLAUDE_SCRIPT, scenario, extra);
    const options = hubOptions(fake, { claude: binary });
    const t = await startTestHub({}, { hub: { ...options.hub, settings } });
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    await t.json('PUT', '/api/agents/titan/models', {
      models: [{ provider: 'claude-agent', model: 'haiku' }],
    });
    return { t, record };
  }

  it('ask_user never holds Claude Code: the turn ends waiting, the answer starts a new run', async () => {
    const { t, record } = await onClaude('ask');
    inLang('it');
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    const end = await t.waitEvent(isRunEnd(sent.runId));
    expect(end.data.status).toBe('waiting_user');
    // The MCP call came back at once with the instruction to end the turn.
    const mcp = records(record).find((r) => r.kind === 'mcp')!;
    const text = JSON.stringify(mcp['result']);
    expect(text).toContain('waiting_user');
    expect(text).toContain('End your turn now');
    const parked = t
      .events(sent.runId)
      .find((e): e is LogEvent<'question_parked'> => e.type === 'question_parked');
    expect(parked?.data.reason).toBe('harness');
    const open = await t.json<{ id: string; parked?: boolean }[]>(
      'GET',
      '/api/questions?status=open',
    );
    expect(open).toMatchObject([{ parked: true }]);

    await t.json('POST', `/api/questions/${open[0]!.id}/answer`, { optionId: '2' });
    const next = await t.waitEvent(
      (e): e is LogEvent<'run'> =>
        e.type === 'run' && e.data.status === 'started' && e.runId !== sent.runId,
    );
    expect((await t.waitEvent(isRunEnd(next.runId!))).data.status).toBe('completed');
    const runs = records(record).filter((r) => r.kind === 'run');
    expect(runs).toHaveLength(2);
    expect(runs[1]!['prompt']).toContain('Risposta alla tua domanda "Che tono?": Serio');
  });

  it("keeps Claude Code's terminal and files out of Monsters' data, except its own folder", async () => {
    const { t, record } = await onClaude('files', { permissions: { shell: true } });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'guarda in giro' });
    await t.waitEvent(isRunEnd(sent.runId));
    const hooks = records(record).filter((r) => r.kind === 'hook' && r['event'] === 'PreToolUse');
    const decision = (h: Record<string, unknown>) =>
      (h['answer'] as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
        ?.permissionDecision ?? 'go';
    expect(
      hooks.map((h) => [(h['payload'] as { tool_name: string }).tool_name, decision(h)]),
    ).toEqual([
      ['Read', 'go'],
      ['Read', 'deny'],
      ['Bash', 'deny'],
      ['Grep', 'deny'],
      ['Bash', 'go'],
    ]);
    // A second layer: deny rules for the rest of the data folder in the run's settings.
    const settings = records(record).find((r) => r.kind === 'settings')!['settings'] as {
      permissions?: { deny: string[] };
    };
    const deny = settings.permissions?.deny ?? [];
    expect(deny.some((d) => d.includes('/agents/**'))).toBe(true);
    // Its own folder stays open, except the harness configuration (D-079).
    expect(
      deny
        .filter((d) => d.includes('/workspaces/titan'))
        .every((d) =>
          /^Edit\(.*\/workspaces\/titan\/(\.claude|\.mcp\.json|CLAUDE|AGENTS|\.codex)/.test(d),
        ),
    ).toBe(true);
    expect(
      t
        .events(sent.runId)
        .filter((e) => e.type === 'security' && e.data.action === 'internal_denied'),
    ).toHaveLength(3);
  });

  /*
   * D-108, the sequence of the Automatica eval (A t04, A t08, B t08): the
   * answer ends with a question in the text, the Stop hook sends the reminder,
   * Claude Code replies "OK" and that "OK" was the answer of the run.
   */
  const ANSWER =
    'La mail è pronta in Inbox/Bozze/Sollecito.md, con i segnaposto. Se mi dai nome e importo, la compilo?';
  const agentMessages = (events: LogEvent[]) =>
    events.filter(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' && e.agent === 'titan' && e.data.role === 'agent',
    );

  for (const reply of ['ok', 'ok-late']) {
    it(`a question left in the text, then "OK" to the reminder: the answer stays (${reply})`, async () => {
      const { t, record } = await onClaude('remind', {}, [`--fake-reply=${reply}`]);
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'mail di sollecito' });
      const end = await t.waitEvent(isRunEnd(sent.runId));
      expect(end.data.status).toBe('completed');
      const stops = records(record).filter((r) => r.kind === 'hook' && r['event'] === 'Stop');
      expect((stops[0]!['answer'] as { decision?: string }).decision).toBe('block');
      const events = t.events(sent.runId);
      expect(events.filter((e) => e.type === 'message' && e.data.role === 'system')).toHaveLength(
        1,
      );
      const messages = agentMessages(events);
      expect(messages.filter((m) => !m.data.partial).map((m) => m.data.text)).toEqual([ANSWER]);
      // The "OK" is never streamed into the chat either.
      expect(messages.map((m) => m.data.text).join('')).not.toContain('OK');
    });
  }

  it('D-140: "il web mi è stato negato" goes back once with the true cause, then rewritten', async () => {
    const { t, record } = await onClaude('denied');
    inLang('it');
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'cerca i prezzi' });
    expect((await t.waitEvent(isRunEnd(sent.runId))).data.status).toBe('completed');
    const reason = String(records(record).find((r) => r.kind === 'stop-reason')?.['reason']);
    expect(reason).toContain('[Controllo del sistema]');
    expect(reason).toContain('Il web mi è stato negato in questa sessione');
    expect(reason).toContain('«modalità don’t ask»');
    const events = t.events(sent.runId);
    expect(
      agentMessages(events)
        .filter((m) => !m.data.partial)
        .map((m) => m.data.text),
    ).toEqual(['Riscritto: il web non ce l’ho in questo lavoro, la ricerca la fa chi ce l’ha.']);
    expect(
      events.filter((e) => e.type === 'instinct' && e.data.action === 'access_claim'),
    ).toHaveLength(1);
  });

  it('D-140: an answer without claims about accesses goes through the Stop hook untouched', async () => {
    const { t, record } = await onClaude('denied', {}, ['--fake-answer=Ho preparato la bozza.']);
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'la bozza' });
    expect((await t.waitEvent(isRunEnd(sent.runId))).data.status).toBe('completed');
    expect(records(record).some((r) => r.kind === 'stop-reason')).toBe(false);
    expect(
      agentMessages(t.events(sent.runId))
        .filter((m) => !m.data.partial)
        .map((m) => m.data.text),
    ).toEqual(['Ho preparato la bozza.']);
  });

  it('a question left in the text, then ask_user and "OK": waiting, the answer said once', async () => {
    const { t } = await onClaude('remind', {}, ['--fake-reply=ask']);
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'mail di sollecito' });
    const end = await t.waitEvent(isRunEnd(sent.runId));
    expect(end.data.status).toBe('waiting_user');
    const events = t.events(sent.runId);
    const messages = agentMessages(events);
    expect(messages.filter((m) => !m.data.partial).map((m) => m.data.text)).toEqual([ANSWER]);
    expect(messages.map((m) => m.data.text).join('')).not.toContain('OK');
    // The question is a real one now: a card, parked until the user answers.
    expect(events.some((e) => e.type === 'question_parked')).toBe(true);
  });
});

describe('Plan limits (D-111)', () => {
  async function claudeHub(extra: string[] = []) {
    const fake = fakeSiwc();
    const { binary, record } = fakeBinary(FAKE_CLAUDE_SCRIPT, 'tool', extra);
    const t = await startTestHub({}, hubOptions(fake, { claude: binary }));
    await t.json('POST', '/api/subscriptions/claude-agent/activate', {});
    await t.json('PUT', '/api/agents/rhea/models', {
      models: [{ provider: 'claude-agent', model: 'sonnet' }],
    });
    return { t, fake, record };
  }

  const limitsOf = async (t: TestHub) =>
    (await t.json<SubscriptionsResponse>('GET', '/api/subscriptions')).limits;

  it('keeps what Claude Code printed during a run and shows it in the subscriptions and in Consumi', async () => {
    const { t } = await claudeHub();
    expect((await limitsOf(t)).claude).toBeNull();
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));

    const limits = await limitsOf(t);
    expect(limits.chatgpt).toBeNull();
    const view = limits.claude!;
    expect(view.windows.map((w) => [w.label, w.usedPercent, w.reset])).toEqual([
      ['Session', 9, false],
      ['Week', 63, false],
      ['Opus week', 41, false],
    ]);
    expect(Date.now() - view.observedAt).toBeLessThan(30_000);
    expect(view.windows[0]!.resetsAt! - Date.now()).toBeGreaterThan(80 * 60_000);

    // The monster on the plan carries them in its Consumi; one that is not, none.
    const usage = await t.json<{ planLimits: unknown }>('GET', '/api/agents/rhea/usage');
    expect(usage.planLimits).toEqual(view);
    const other = await t.json<{ planLimits: unknown }>('GET', '/api/agents/dione/usage');
    expect(other.planLimits).toBeNull();
  });

  it('survives a restart of the core', async () => {
    const { t } = await claudeHub();
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));
    const before = (await limitsOf(t)).claude!;
    await t.core.close();

    const again = await startTestHub({}, { home: t.home, ...hubOptions(fakeSiwc()) });
    expect((await limitsOf(again)).claude).toEqual(before);
  });

  it('does not log the readings', async () => {
    const { t } = await claudeHub();
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));
    expect(JSON.stringify(t.core.log.all())).not.toMatch(/rate_limit|resetsAt|utilization/);
  });

  it('a run with no limits events leaves the block empty', async () => {
    const { t } = await claudeHub(['--fake-limits=off']);
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));
    expect((await limitsOf(t)).claude).toBeNull();
  });

  it('a request the plan refused says when it opens again, in the error', async () => {
    const { t } = await claudeHub(['--fake-limits=rejected']);
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea trova le ricette' });
    await t.waitEvent(isRunEnd(sent.runId));
    const error = t.events(sent.runId).find((e) => e.type === 'error');
    expect((error?.data as { message: string }).message).toMatch(/resets at \d{1,2}:\d\d [AP]M/);
    const five = (await limitsOf(t)).claude!.windows[0]!;
    expect(five).toMatchObject({ label: 'Session', usedPercent: 100, tone: 'high' });
  });

  it('a monster on the ChatGPT route shows the windows the response carried, and its usage', async () => {
    const fake = fakeSiwc();
    const t = await startTestHub({}, hubOptions(fake));
    await signInChatGPT(t, fake);
    await t.json('PUT', '/api/agents/dione/models', {
      models: [{ provider: 'chatgpt', model: 'gpt-test' }],
    });
    expect((await limitsOf(t)).chatgpt).toBeNull();
    const nowSec = Math.floor(Date.now() / 1000);
    fake.replies.push(() =>
      responsesText('Bozza pronta.', 'gpt-test', {
        'x-codex-primary-used-percent': '24',
        'x-codex-primary-window-minutes': '300',
        'x-codex-primary-reset-at': String(nowSec + 75 * 60),
        'x-codex-secondary-used-percent': '81',
        'x-codex-secondary-window-minutes': '10080',
        'x-codex-secondary-reset-at': String(nowSec + 4 * 86_400),
      }),
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Dione scrivi la bozza' });
    await t.waitEvent(isRunEnd(sent.runId));

    const limits = await limitsOf(t);
    expect(limits.chatgpt!.windows.map((w) => [w.label, w.usedPercent, w.tone])).toEqual([
      ['5 hours', 24, 'ok'],
      ['Week', 81, 'warn'],
    ]);
    // Consumi of the monster: the same windows, and a request with its tokens.
    const usage = await t.json<{ planLimits: unknown; session: { inputTokens: number } }>(
      'GET',
      '/api/agents/dione/usage',
    );
    expect(usage.planLimits).toEqual(limits.chatgpt);
    expect(t.events(sent.runId).find((e) => e.type === 'provider_usage')?.data).toMatchObject({
      provider: 'chatgpt',
      inputTokens: 12,
      outputTokens: 7,
    });
    // Nothing of the reading is logged.
    expect(JSON.stringify(t.core.log.all())).not.toMatch(/x-codex|usedPercent/);

    // A later response without windows leaves the last reading as it was.
    fake.replies.splice(0);
    fake.replies.push(() => responsesText('Altra.'));
    const again = await t.json<Sent>('POST', '/api/messages', { text: '@Dione ancora' });
    await t.waitEvent(isRunEnd(again.runId));
    expect((await limitsOf(t)).chatgpt).toEqual(limits.chatgpt);
  });

  it('Codex limits go to the ChatGPT plan, and signing out forgets them', async () => {
    const fake = fakeSiwc();
    const { binary } = fakeBinary(FAKE_CODEX_SCRIPT, 'tool');
    const t = await startTestHub({}, hubOptions(fake, { codex: binary }));
    await signInChatGPT(t, fake);
    await t.json('POST', '/api/subscriptions/codex/activate', {});
    await t.json('PUT', '/api/agents/dione/models', {
      models: [{ provider: 'codex', model: 'gpt-test' }],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Dione scrivi la bozza' });
    await t.waitEvent(isRunEnd(sent.runId));

    const limits = await limitsOf(t);
    expect(limits.claude).toBeNull();
    expect(limits.chatgpt!.windows.map((w) => [w.label, w.usedPercent, w.tone])).toEqual([
      ['5 hours', 24, 'ok'],
      ['Week', 81, 'warn'],
    ]);
    expect(
      (await t.json<{ planLimits: unknown }>('GET', '/api/agents/dione/usage')).planLimits,
    ).toEqual(limits.chatgpt);

    const out = await t.json<SubscriptionsResponse>('DELETE', '/api/subscriptions/chatgpt');
    expect(out.limits.chatgpt).toBeNull();
  });
});
