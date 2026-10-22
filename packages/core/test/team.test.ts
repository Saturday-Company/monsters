import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROSTER } from '@monsters/monster-kit';
import { fake } from '@monsters/providers/testing';
import { ulid, type AgentSummary, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  EventLog,
  coreMigrations,
  defaultVaultDir,
  loadHubSettings,
  migrate,
  openDb,
  readBraveKey,
  orchestratorTools,
  readOpenRouterKey,
} from '../src/index.ts';
import { TeamService } from '../src/team/team-service.ts';
import { tempHome } from './helpers.ts';
import { deferred, promptText, startTestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/** POSIX file modes do not exist on Windows. */
const posix = process.platform !== 'win32';

describe('team', () => {
  it('bootstraps Titan, Rhea and Dione with the roster genomes and a fresh vault', async () => {
    inLang('it');
    const t = await startTestHub({}, { withoutTeam: true, hub: { bootstrap: true } });
    const agents = await t.json<AgentSummary[]>('GET', '/api/agents');
    expect(agents.map((a) => [a.id, a.name, a.isOrchestrator, a.state])).toEqual([
      ['titan', 'Titan', true, 'idle'],
      ['dione', 'Dione', false, 'idle'],
      ['rhea', 'Rhea', false, 'idle'],
    ]);
    expect(agents[0]!.genome).toEqual(JSON.parse(JSON.stringify(ROSTER.titan.variants.A)));
    expect(agents[2]!.role).toBe('ricerche online e sintesi con fonti');
    for (const id of ['titan', 'rhea', 'dione']) {
      expect(existsSync(join(t.home, 'agents', id, 'AGENTS.md'))).toBe(true);
    }
    const titanYaml = readFileSync(join(t.home, 'agents', 'titan', 'agent.yaml'), 'utf8');
    expect(titanYaml).toContain('- delegate');
    expect(titanYaml).toContain('- vault_undo');

    // The vault lives inside a custom MONSTERS_HOME, with an area per agent.
    const vault = t.core.hub.vault.root;
    expect(vault).toBe(join(t.home, 'Monsters Note'));
    for (const name of ['Titan', 'Rhea', 'Dione']) {
      expect(existsSync(join(vault, 'Agenti', name, 'MEMORY.md'))).toBe(true);
    }
    expect(await t.core.hub.team.memory('rhea')).toContain('# Memoria di Rhea');

    // No model configured: messages are refused with a clear error.
    const res = await t.api('POST', '/api/messages', { text: 'ciao' });
    expect(res.status).toBe(409);
  });

  it('never creates or loads an agent with the id of the user or of the system', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const dir = join(tempHome(), 'agents');
    const team = new TeamService({ dir, log });
    await team.load();
    await expect(team.bootstrap({ user: 'Giulio', orchestratorName: 'System' })).rejects.toThrow(
      expect.objectContaining({ code: 'invalid_name' }),
    );
    expect(existsSync(join(dir, 'system'))).toBe(false);

    // A folder written by hand is refused like a duplicate.
    await team.bootstrap({ user: 'Giulio' });
    const yaml = readFileSync(join(dir, 'rhea', 'agent.yaml'), 'utf8');
    mkdirSync(join(dir, 'user'));
    for (const f of ['agent.yaml', 'AGENTS.md']) {
      const text = readFileSync(join(dir, 'rhea', f), 'utf8');
      writeFileSync(
        join(dir, 'user', f),
        f === 'agent.yaml' ? yaml.replace(/^id: rhea$/m, 'id: user') : text,
      );
    }
    await team.load();
    expect(team.get('user')).toBeUndefined();
    expect(team.list().map((a) => a.config.id)).toEqual(['titan', 'dione', 'rhea']);
    expect(log.query({ type: 'error' }).at(-1)?.data).toMatchObject({ code: 'agent_invalid' });
  });

  it('takes the search from the orchestrator when someone else has it, and keeps its pages (D-026, D-161)', async () => {
    const t = await startTestHub({});
    const team = t.core.hub.team;
    const tools = (id: string) => team.get(id)!.config.tools;
    const web = ['web_search', 'web_fetch'];
    expect(tools('rhea')).toEqual(expect.arrayContaining(web));
    expect(tools('titan')).toEqual(expect.arrayContaining(['delegate', 'vault_write']));
    // The searches are delegated, the pages the user names are read by the capo itself.
    expect(tools('titan').filter((x) => web.includes(x))).toEqual(['web_fetch']);
    expect(team.webOff('titan')).toBe('covered');
    // The file still declares them: the rule is applied at runtime, also to old teams.
    const yaml = readFileSync(join(t.home, 'agents', 'titan', 'agent.yaml'), 'utf8');
    expect(yaml).toContain('- web_search');

    // No web permission: nobody has it.
    team.setPolicy({ vault: true, web: false });
    expect([...tools('titan'), ...tools('rhea')].filter((x) => web.includes(x))).toEqual([]);
    expect(team.webOff('titan')).toBe('permission');
    team.setPolicy({ vault: true, web: true });
    expect(tools('titan').filter((x) => web.includes(x))).toEqual(['web_fetch']);

    // Without the researcher, the orchestrator searches by itself.
    rmSync(join(t.home, 'agents', 'rhea'), { recursive: true });
    await team.load();
    expect(tools('titan')).toEqual(expect.arrayContaining(web));
    expect(team.webOff('titan')).toBeUndefined();
  });

  it('orchestratorTools: a squad with the web takes only web_search from the capo (D-161)', () => {
    const declared = ['vault_search', 'delegate', 'web_search', 'web_fetch'];
    const covered = orchestratorTools(declared, true);
    expect(covered).toContain('web_fetch');
    expect(covered).not.toContain('web_search');
    expect(covered).toEqual(expect.arrayContaining(['vault_search', 'delegate']));
    // Nobody else has the web: the capo keeps both.
    expect(orchestratorTools(declared, false)).toEqual(expect.arrayContaining(declared));
    // The input is not touched.
    expect(declared).toContain('web_search');
  });

  it('creates a missing MEMORY.md on first use and reads an existing one', async () => {
    inLang('it');
    const t = await startTestHub({ rhea: [fake.text('ok')] }, { lang: 'it' });
    const vault = t.core.hub.vault.root;
    expect(await t.core.hub.team.memory('Rhea')).toContain('Memoria di Rhea');
    expect(readFileSync(join(vault, 'Agenti/Rhea/MEMORY.md'), 'utf8')).toContain('author: rhea');
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: '@rhea ciao' });
    await t.runEnded(sent.runId);
    expect(promptText(t.provider.calls[0]!.options.prompt)).toContain('## La tua memoria');
  });

  it('adds messages that arrive during a run to the next step', async () => {
    const release = deferred();
    const t = await startTestHub({
      titan: [
        fake.toolCall('vault_list', {}, { gate: release.promise }),
        fake.text('Ho visto entrambe le richieste.'),
      ],
    });
    const first = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: 'Guarda le note',
    });
    const second = await t.json<{ runId: string; queued: boolean }>('POST', '/api/messages', {
      text: 'e dimmi quante sono',
    });
    expect(second).toMatchObject({ runId: first.runId, queued: true });
    release.resolve();
    await t.runEnded(first.runId);
    expect(t.provider.calls).toHaveLength(2);
    const prompt = t.provider.calls[1]!.options.prompt;
    expect(prompt.at(-1)).toMatchObject({ role: 'user' });
    expect(promptText(prompt.at(-1))).toContain('e dimmi quante sono');
  });

  it('tracks the activity of the agents for the speech bubbles', async () => {
    const release = deferred();
    const t = await startTestHub({
      rhea: [
        fake.toolCall('web_search', { query: 'lune di Saturno' }),
        fake.text('fatto', { gate: release.promise }),
      ],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: '@rhea Cerca le lune',
    });
    await t.waitEvent((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
    const rhea = (list: AgentSummary[]) => list.find((a) => a.id === 'rhea');
    expect(rhea(await t.json<AgentSummary[]>('GET', '/api/agents'))).toMatchObject({
      state: 'working',
      activity: 'searches the web: lune di Saturno',
    });
    release.resolve();
    await t.runEnded(sent.runId);
    const idle = rhea(await t.json<AgentSummary[]>('GET', '/api/agents'));
    expect(idle).toMatchObject({ state: 'idle' });
    expect(idle!.activity).toBeUndefined();
  });

  it('saves a verified OpenRouter key with mode 600 and never returns it', async () => {
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const calls: string[] = [];
    const fakeFetch: typeof fetch = (input, init) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      const auth = new Headers(init?.headers).get('authorization');
      return Promise.resolve(
        auth === `Bearer ${key}`
          ? Response.json({
              data: { label: 'Monsters (free)', is_free_tier: false, limit: 0, usage: 0 },
            })
          : new Response('{"error":"unauthorized"}', { status: 401 }),
      );
    };
    const t = await startTestHub({}, { hub: { providers: undefined, fetch: fakeFetch } });
    expect(await t.json('GET', '/api/settings')).toEqual({
      language: 'en',
      openrouterKey: { set: false, freeOnly: true },
      braveKey: { set: false },
      webSearch: {
        mode: 'auto',
        engine: 'parallel',
        active: false,
        reason: 'free_only',
        usdPer1000: { parallel: 1.09, exa: 7.09 },
      },
      vaultPath: join(t.home, 'Monsters Note'),
      vaultLayout: 'it',
      userName: 'Giulio',
      // Tests keep secrets in files (MONSTERS_SECRETS=file in vitest.config.ts).
      secrets: { backend: 'file', reason: 'forced', unreadable: [] },
    });

    const bad = await t.api('PUT', '/api/settings/openrouter-key', {
      key: 'sk-or-v1-wrongwrongwrong',
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_key');

    const res = await t.api('PUT', '/api/settings/openrouter-key', { key });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(key);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      label: 'Monsters (free)',
      isFreeTier: false,
    });
    expect(calls.every((u) => u === 'https://openrouter.ai/api/v1/key')).toBe(true);

    const file = join(t.home, 'secrets', 'openrouter.key');
    if (posix) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(t.home, 'secrets')).mode & 0o777).toBe(0o700);
    }
    expect(readOpenRouterKey(join(t.home, 'secrets'), {})).toEqual({ key, source: 'file' });
    const settings = await t.api('GET', '/api/settings');
    const settingsText = await settings.text();
    expect(settingsText).not.toContain(key);
    expect(JSON.parse(settingsText)).toMatchObject({
      openrouterKey: { set: true, freeOnly: true, label: 'Monsters (free)' },
    });
    // 1000 requests per day once the account has credits.
    const snapshot = t.core.hub.providers.get('openrouter').budget.snapshot();
    expect(JSON.stringify(snapshot)).toContain('1000');
    // The key is redacted from the log if anything ever tries to write it.
    const e = t.core.log.append({
      agent: 'system',
      type: 'error',
      data: { message: `oops ${key}` },
    });
    expect(e.data.message).not.toContain(key);
  });

  it('web_search: DuckDuckGo CAPTCHA → Wikipedia, then Brave once its key is saved', async () => {
    const braveKey = 'BSA-0123456789abcdef0123';
    const hosts: string[] = [];
    const fakeFetch: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      hosts.push(url.hostname);
      if (url.hostname === 'api.search.brave.com') {
        const ok = new Headers(init?.headers).get('x-subscription-token') === braveKey;
        return Promise.resolve(
          ok
            ? Response.json({ web: { results: [{ title: 'Titano', url: 'https://t.example' }] } })
            : new Response('', { status: 401 }),
        );
      }
      if (url.hostname.endsWith('.wikipedia.org')) {
        return Promise.resolve(
          Response.json({ query: { search: [{ title: 'Titano (astronomia)', snippet: 'luna' }] } }),
        );
      }
      return Promise.resolve(new Response('<div class="anomaly-modal"></div>', { status: 202 }));
    };
    const search = (query: string) => fake.toolCall('web_search', { query });
    const t = await startTestHub(
      { rhea: [search('Titano'), fake.text('ok'), search('Titano'), fake.text('ok')] },
      { hub: { webTools: undefined, fetch: fakeFetch } },
    );
    const output = async (text: string) => {
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text });
      await t.runEnded(sent.runId);
      const result = t
        .events(sent.runId)
        .find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
      return result?.data.output as { backend: string; notice?: string };
    };

    const before = await output('@rhea Cerca Titano');
    expect(before.backend).toBe('wikipedia');
    expect(before.notice).toMatch(/only from Wikipedia/);
    // The region follows the monsters' writing language: English, the app's, by default (D-153).
    expect(hosts.slice(0, 2)).toEqual(['html.duckduckgo.com', 'en.wikipedia.org']);
    const warnings = t
      .events()
      .filter((e) => e.type === 'error' && e.data.code === 'search_fallback');
    expect(warnings).toHaveLength(1);

    const bad = await t.api('PUT', '/api/settings/brave-key', { key: 'con spazi dentro' });
    expect(bad.status).toBe(400);
    const res = await t.api('PUT', '/api/settings/brave-key', { key: braveKey });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(braveKey);
    const file = join(t.home, 'secrets', 'brave.key');
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readBraveKey(join(t.home, 'secrets'), {})).toEqual({ key: braveKey, source: 'file' });
    const settings = await t.api('GET', '/api/settings');
    const settingsText = await settings.text();
    expect(settingsText).not.toContain(braveKey);
    expect(JSON.parse(settingsText)).toMatchObject({ braveKey: { set: true } });

    hosts.length = 0;
    const after = await output('@rhea Cerca ancora Titano');
    expect(after.backend).toBe('brave');
    expect(after.notice).toBeUndefined();
    expect(hosts).toEqual(['api.search.brave.com']);
    // The key never reaches the log.
    expect(JSON.stringify(t.events())).not.toContain(braveKey);
  });
});

describe('the confused monster in the state of the core (D-072)', () => {
  it('starts on stuck_*, lasts at least 4 s, ends at the next action after', async () => {
    let now = 1_000_000;
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db, { now: () => now });
    const team = new TeamService({ dir: join(tempHome(), 'agents'), log });
    await team.load();
    await team.bootstrap({ user: 'Giulio' });
    team.attach();
    const stuck = (subject: string) =>
      log.append({
        agent: 'system',
        runId: 'r1',
        type: 'instinct',
        data: { use: 'stuck', action: 'stuck_nudge', message: 'gira a vuoto', subject },
      });
    const tool = () =>
      log.append({
        agent: 'rhea',
        runId: 'r1',
        type: 'tool_call',
        data: { callId: `c${now}`, tool: 'web_search', input: { query: 'x' } },
      });
    const rhea = () => team.summaries().find((a) => a.id === 'rhea')!;

    // A monster at rest is never confused.
    stuck('rhea');
    expect(rhea().confusedSince).toBeUndefined();

    log.append({ agent: 'rhea', runId: 'r1', type: 'run', data: { status: 'started', goal: 'x' } });
    stuck('rhea');
    const since = now;
    expect(rhea()).toMatchObject({ state: 'working', confusedSince: since });
    now += 1_000;
    tool();
    expect(rhea().confusedSince).toBe(since);
    now += 3_000;
    tool();
    expect(rhea().confusedSince).toBeUndefined();

    // The final answer and the end of the run end it at once.
    stuck('rhea');
    log.append({
      agent: 'rhea',
      runId: 'r1',
      type: 'message',
      data: { role: 'agent', text: 'ok' },
    });
    expect(rhea().confusedSince).toBeUndefined();
    stuck('rhea');
    log.append({ agent: 'rhea', runId: 'r1', type: 'run', data: { status: 'completed' } });
    expect(rhea()).toMatchObject({ state: 'idle' });
    expect(rhea().confusedSince).toBeUndefined();
  });
});

describe('at work only while a run or a task is open (D-157)', () => {
  it('lists the open items, and a run that ends takes its tasks along', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const team = new TeamService({ dir: join(tempHome(), 'agents'), log });
    await team.load();
    await team.bootstrap({ user: 'Giulio' });
    team.attach();
    const of = (id: string) => team.summaries().find((a) => a.id === id)!;
    const task = (status: 'started' | 'completed', to: string, parentId: string | null) =>
      log.append({
        agent: 'titan',
        runId: 'r1',
        parentId,
        type: 'delegation',
        data: { from: 'titan', to, status, goal: `Lavoro per ${to}` },
      });

    log.append({ agent: 'titan', runId: 'r1', type: 'run', data: { status: 'started' } });
    const call = ulid();
    task('started', 'rhea', call);
    // A task logged without its `delegate` call: its end is still recognised (by its goal).
    task('started', 'dione', null);
    expect(of('titan')).toMatchObject({ state: 'working', work: ['run:r1'] });
    expect(of('rhea')).toMatchObject({ state: 'working', work: [`task:r1:${call}:rhea`] });
    task('completed', 'dione', null);
    expect(of('dione')).toMatchObject({ state: 'idle', work: [] });

    // The core died with Rhea's task open: at the next start the run is closed (`restart`),
    // and the task goes with it. No monster is left "at work".
    log.append({
      agent: 'titan',
      runId: 'r1',
      type: 'run',
      data: { status: 'aborted', reason: 'restart' },
    });
    expect(of('rhea')).toMatchObject({ state: 'stopped', work: [] });
    expect(team.working()).toEqual([]);
  });
});

describe('paid web search (D-071)', () => {
  const searchKey = 'sk-or-v1-search0123456789abcdef0123456789';
  /** OpenRouter answers the search (or 402), DuckDuckGo a CAPTCHA, Wikipedia one article. */
  function searchFetch(state: { credit: boolean; hosts: string[] }): typeof fetch {
    return (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      state.hosts.push(url.hostname);
      if (url.hostname === 'openrouter.ai') {
        return Promise.resolve(
          state.credit
            ? Response.json({
                choices: [
                  {
                    message: {
                      annotations: [
                        {
                          type: 'url_citation',
                          url_citation: {
                            url: 'https://ribollita.example/storia',
                            title: 'Storia della ribollita',
                            content: '## Origini\nZuppa contadina toscana.',
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 2500, completion_tokens: 1, cost: 0.00108 },
              })
            : Response.json({ error: { message: 'Insufficient credits' } }, { status: 402 }),
        );
      }
      if (url.hostname.endsWith('.wikipedia.org')) {
        return Promise.resolve(
          Response.json({ query: { search: [{ title: 'Ribollita', snippet: 'zuppa' }] } }),
        );
      }
      return Promise.resolve(new Response('<div class="anomaly-modal"></div>', { status: 202 }));
    };
  }

  it('goes first when on, logs its cost like a model, and steps aside without credit', async () => {
    const state = { credit: true, hosts: [] as string[] };
    const search = (query: string) => fake.toolCall('web_search', { query });
    const t = await startTestHub(
      {
        rhea: [
          search('ribollita origini'),
          fake.text('ok'),
          search('ribollita'),
          fake.text('ok'),
          search('peposo'),
          fake.text('ok'),
        ],
      },
      {
        hub: {
          webTools: undefined,
          fetch: searchFetch(state),
          searchKey,
          settings: { paidSearch: { mode: 'on', engine: 'parallel' } },
        },
      },
    );
    const run = async (text: string) => {
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text });
      await t.runEnded(sent.runId);
      const events = t.events(sent.runId);
      const result = events.find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
      return { events, output: result?.data.output as { backend: string; results: unknown[] } };
    };
    const settings = () =>
      t.json<{ webSearch: { active: boolean; reason?: string; mode: string } }>(
        'GET',
        '/api/settings',
      );
    expect((await settings()).webSearch).toMatchObject({ mode: 'on', active: true });

    const first = await run('@rhea Cerca le origini della ribollita');
    expect(first.output.backend).toBe('openrouter-parallel');
    expect(first.output.results).toEqual([
      {
        title: 'Storia della ribollita',
        url: 'https://ribollita.example/storia',
        snippet: 'Origini Zuppa contadina toscana.',
      },
    ]);
    const usage = first.events.filter(
      (e): e is LogEvent<'provider_usage'> =>
        e.type === 'provider_usage' && e.data.provider === 'web_search',
    );
    expect(usage).toHaveLength(1);
    expect(usage[0]!.data).toMatchObject({ model: 'openrouter/parallel-fast', costUsd: 0.00108 });
    expect(usage[0]!.agent).toBe('rhea');
    const receipt = first.events.find((e): e is LogEvent<'receipt'> => e.type === 'receipt');
    if (receipt) {
      expect(receipt.data.usage).toMatchObject({ searchCalls: 1, searchCostUsd: 0.00108 });
      expect(receipt.data.usage.costUsd).toBeGreaterThanOrEqual(0.00108);
    }

    // No credit left: DuckDuckGo (CAPTCHA), then Wikipedia; the settings say why.
    state.credit = false;
    state.hosts.length = 0;
    const second = await run('@rhea Cerca la ribollita');
    expect(second.output.backend).toBe('wikipedia');
    expect(state.hosts.slice(0, 2)).toEqual(['openrouter.ai', 'html.duckduckgo.com']);
    expect((await settings()).webSearch).toMatchObject({ active: false, reason: 'no_credit' });

    // Turned off from the settings: saved in settings.json, OpenRouter never asked.
    const off = await t.api('PUT', '/api/settings/web-search', { mode: 'off' });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { webSearch: unknown }).webSearch).toMatchObject({
      mode: 'off',
      active: false,
      reason: 'off',
    });
    expect(JSON.parse(readFileSync(join(t.home, 'settings.json'), 'utf8'))).toMatchObject({
      paidSearch: { mode: 'off', engine: 'parallel' },
    });
    state.hosts.length = 0;
    await run('@rhea Cerca il peposo');
    expect(state.hosts).not.toContain('openrouter.ai');
    expect((await t.api('PUT', '/api/settings/web-search', {})).status).toBe(400);
    expect(JSON.stringify(t.events())).not.toContain(searchKey);
  });
});

describe('hub settings', () => {
  it('reads settings.json, MONSTERS_VAULT and defaults', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    expect(loadHubSettings(home, {}, {})).toMatchObject({
      vault: join(home, 'Monsters Note'),
      userName: 'User',
      conversationTurns: 12,
      decisions: { threshold: 0.8 },
      // The instinct (D-067): Jev pinned, every use with its default mode.
      instinct: { uses: {}, jev: { model: 'jev-1.13.0', maxP: 0.45 } },
      openrouter: { freeOnly: true },
    });
    // The fallback name is the app's language's (C20).
    inLang('it');
    expect(loadHubSettings(home, {}, {}).userName).toBe('Utente');
    inLang('en');
    // The real home: `Monsters Vault` where it already exists (before the rename), else `Monsters Note`.
    expect(defaultVaultDir(join(homedir(), '.monsters'))).toBe(
      join(
        homedir(),
        existsSync(join(homedir(), 'Monsters Vault')) ? 'Monsters Vault' : 'Monsters Note',
      ),
    );
    const old = tempHome();
    mkdirSync(join(old, 'Monsters Vault'), { recursive: true });
    expect(defaultVaultDir(old)).toBe(join(old, 'Monsters Vault'));
    writeFileSync(
      join(home, 'settings.json'),
      JSON.stringify({ vault: '~/Note', userName: 'Giulio', decisions: { threshold: 0.9 } }),
    );
    const s = loadHubSettings(home, {}, {});
    expect(s).toMatchObject({
      vault: join(homedir(), 'Note'),
      userName: 'Giulio',
      decisions: { threshold: 0.9 },
    });
    expect(loadHubSettings(home, {}, { MONSTERS_VAULT: '/tmp/v' }).vault).toBe('/tmp/v');
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ decisions: { threshold: 3 } }));
    expect(() => loadHubSettings(home, {}, {})).toThrow(/threshold/);
  });
});
