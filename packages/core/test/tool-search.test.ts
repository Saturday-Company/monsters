import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import { defineTool, type LogEvent, type MonstersTool } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCoreServices,
  DeferredTools,
  parseAgentConfig,
  type AgentConfigInput,
  type AgentDefinition,
  type CoreServices,
  monstersCard,
  recentToolUse,
  runAgent,
  searchTerms,
  stem,
  ToolIndex,
  TOOL_SEARCH,
  TOOL_SEARCH_DEFAULT,
  TOOL_SEARCH_FREE,
  toolSearchConfigFor,
  withTurnDeferrals,
} from '../src/index.ts';
import { missedToolsNote } from '../src/agents/run-agent.ts';
import { anteikuToolDefs } from './fixtures/fake-anteiku-server.ts';
import { tempHome } from './helpers.ts';

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function setupAgents(models: Record<string, FakeScript>) {
  const services = createCoreServices({ home: tempHome() });
  opened.push(services);
  const provider = new FakeProvider({ models });
  return { ...services, provider, providers: new ProviderRegistry().register(provider) };
}

function agentFor(overrides: Partial<AgentConfigInput> = {}): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche',
      color: '#4f8df7',
      models: [{ provider: 'fake', model: 'a' }],
      tools: [],
      limits: { maxSteps: 5 },
      ...overrides,
    }),
    instructions: '# Rhea',
  };
}

/*
 * Tools loaded when needed (C.2, D-075): ranking of `tools_search`, the fixed
 * order and the set that only grows, and a run where the monster finds the
 * Anteiku tool it needs among 124.
 */

const calls: { tool: string; input: unknown }[] = [];

/** The Anteiku tools as the core makes them from the server (`mcp__anteiku__…`). */
function anteikuTools(): MonstersTool[] {
  return anteikuToolDefs().map((d) =>
    defineTool({
      name: `mcp__anteiku__${d.name}`,
      description: `[External tool, MCP server "anteiku"] ${d.description}`,
      inputSchema: z.record(z.string(), z.unknown()),
      inputJsonSchema: d.inputSchema,
      readOnly: d.readOnly,
      destructive: d.destructive,
      execute: (input) => {
        calls.push({ tool: d.name, input });
        return Promise.resolve(`ok ${d.name}`);
      },
    }),
  );
}

const own = (name: string): MonstersTool =>
  defineTool({
    name,
    description: `The tool ${name}.`,
    inputSchema: z.object({}),
    readOnly: true,
    execute: () => Promise.resolve('ok'),
  });

describe('tools_search: ranking', () => {
  it('stems Italian and English alike', () => {
    expect(['crea', 'creare', 'creates'].map(stem)).toEqual(['cre', 'cre', 'creat']);
    expect(['clienti', 'cliente', 'tasks', 'pagamenti'].map(stem)).toEqual([
      'client',
      'client',
      'task',
      'pagament',
    ]);
    expect(searchTerms('anteiku_task_crea listCustomers Attività')).toEqual([
      'anteik',
      'task',
      'cre',
      'list',
      'customer',
      'attivit',
    ]);
  });

  it('finds the right Anteiku tool among 122, in Italian, in English, by regex or by name', () => {
    const tools = anteikuTools();
    expect(tools).toHaveLength(122);
    const index = new ToolIndex(tools);
    const top = (q: string, k = 1) =>
      index.search(q, k).map((r) => r.name.replace('mcp__anteiku__', ''));
    expect(top('crea task')).toEqual(['anteiku_task_crea']);
    expect(top('create a new task', 3)).toContain('anteiku_task_crea');
    expect(top('elenca clienti')).toEqual(['anteiku_clienti_elenca']);
    expect(top('list customers', 2)).toContain('anteiku_clienti_elenca');
    expect(top('segna pagamento pagato')).toEqual(['anteiku_pagamenti_segna_pagato']);
    expect(top('aggiungi voce preventivo')).toEqual(['anteiku_preventivi_aggiungi_voce']);
    expect(top('/^anteiku_preventivi_togli/', 10)).toEqual([
      'anteiku_preventivi_togli_scenario',
      'anteiku_preventivi_togli_sconto',
      'anteiku_preventivi_togli_voce',
    ]);
    expect(top('anteiku_ore_registra')).toEqual(['anteiku_ore_registra']);
    expect(index.search('xyzzy', 5)).toEqual([]);
    expect(index.search('/[/', 5)).toEqual([]);
    // Deterministic: the same query, the same order.
    expect(index.search('aggiorna', 10)).toEqual(index.search('aggiorna', 10));
  });

  it('matches names with * patterns, never a regex of the model (ReDoS, review of 16/10)', () => {
    const index = new ToolIndex(anteikuTools());
    const names = (q: string, k = 10) =>
      index.search(q, k).map((r) => r.name.replace('mcp__anteiku__', ''));
    expect(names('anteiku_preventivi_togli_*')).toEqual([
      'anteiku_preventivi_togli_scenario',
      'anteiku_preventivi_togli_sconto',
      'anteiku_preventivi_togli_voce',
    ]);
    expect(names('*PREVENTIVI*togli*')).toHaveLength(3);
    expect(names('/^anteiku_preventivi_togli_voce$/')).toEqual(['anteiku_preventivi_togli_voce']);
    expect(names('/_voce$/')).toContain('anteiku_preventivi_togli_voce');
    expect(names('/^preventivi/')).toEqual([]);
    // Real regex syntax is refused, too many stars or too long too.
    expect(index.search('/(a+)+$/', 5)).toEqual([]);
    expect(index.search('/anteiku_(task|clienti)/', 5)).toEqual([]);
    expect(index.search('a*b*c*d*e*f*g', 5)).toEqual([]);
    expect(index.search(`${'x'.repeat(101)}*`, 5)).toEqual([]);
    // A long hostile name and the classic catastrophic patterns: linear time.
    const long = new ToolIndex([
      defineTool({
        name: `mcp__evil__${'a'.repeat(5000)}b`,
        description: 'x',
        inputSchema: z.object({}),
        execute: () => Promise.resolve(null),
      }),
    ]);
    const t0 = performance.now();
    for (const q of ['/(a+)+$/', '/(.*a){20}/', '*a*a*a*a*a', '/^(a|aa)+$/', 'a*'.repeat(5)]) {
      long.search(q, 5);
    }
    expect(performance.now() - t0).toBeLessThan(50);
    expect(long.search('*a*a*a*a*b', 5)).toHaveLength(1);
  });
});

describe('tools_search: the deferred tools of a run', () => {
  const tools = () => [own('vault_search'), own('result_read'), ...anteikuTools()];

  it('Monsters’ own rare tools always wait for a search, also with few MCP tools (D-098)', () => {
    const mine = [
      own('vault_search'),
      own('project_propose'),
      own('automation_propose'),
      own('project_send'),
      ...anteikuTools().slice(0, 5),
    ];
    const d = DeferredTools.plan(mine, TOOL_SEARCH_DEFAULT)!;
    expect(d.mcp).toBe(false);
    // The few MCP tools are sent as before; the rare own tools wait.
    expect(d.activeNames()).toEqual([
      'vault_search',
      ...anteikuTools()
        .slice(0, 5)
        .map((t) => t.name),
      TOOL_SEARCH,
    ]);
    expect(d.ownDeferred.sort()).toEqual(['automation_propose', 'project_propose', 'project_send']);
    expect(d.tool().description).toContain('automazioni (1)');
    expect(d.tool().description).toContain('progetti (2)');
    expect(d.search('progetto nuovo').tools.map((t) => t.name)).toContain('project_propose');
    expect(d.search('automazione').tools.map((t) => t.name)).toContain('automation_propose');
    // Without them, nothing waits.
    expect(
      DeferredTools.plan(
        mine.filter((t) => !t.name.startsWith('p') && !t.name.startsWith('a')),
        TOOL_SEARCH_DEFAULT,
      ),
    ).toBeNull();
    // The card names them and says how they load.
    const card = monstersCard({
      toolNames: mine.map((t) => t.name).concat(TOOL_SEARCH),
      mcpSearch: false,
      searched: d.ownDeferred,
    });
    expect(card).toContain('`project_propose`');
    expect(card).toContain('prima caricali con `tools_search`');
    expect(card).not.toContain('molti strumenti');
  });

  it('defers only past the threshold, free models sooner', () => {
    expect(DeferredTools.plan(tools().slice(0, 20), TOOL_SEARCH_DEFAULT)).toBeNull();
    expect(DeferredTools.plan(tools().slice(0, 20), TOOL_SEARCH_FREE)).not.toBeNull();
    expect(toolSearchConfigFor([{ provider: 'openrouter', model: 'a/b:free' }])).toBe(
      TOOL_SEARCH_FREE,
    );
    expect(
      toolSearchConfigFor([{ provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' }]),
    ).toBe(TOOL_SEARCH_DEFAULT);
  });

  it('sends its own tools, the most used ones and the search; the set only grows, in a fixed order', () => {
    const recent = recentToolUse(
      [
        'mcp__anteiku__anteiku_task_elenca',
        'mcp__anteiku__search',
        'mcp__anteiku__anteiku_task_elenca',
        'vault_search',
        'mcp__anteiku__anteiku_clienti_leggi',
        'mcp__anteiku__anteiku_task_elenca',
        'mcp__anteiku__anteiku_clienti_leggi',
      ].map((tool) => ({ data: { tool } })),
    );
    expect(recent).toEqual([
      'mcp__anteiku__anteiku_task_elenca',
      'mcp__anteiku__anteiku_clienti_leggi',
      'mcp__anteiku__search',
    ]);
    const d = DeferredTools.plan(
      tools(),
      { ...TOOL_SEARCH_DEFAULT, preload: 2, maxLoaded: 6 },
      () => recent,
    )!;
    expect(d.activeNames()).toEqual([
      'vault_search',
      'result_read',
      'mcp__anteiku__anteiku_clienti_leggi',
      'mcp__anteiku__anteiku_task_elenca',
      TOOL_SEARCH,
    ]);
    expect(d.deferredCount).toBe(120);
    const first = d.search('crea task', 2);
    expect(first.tools[0]!.name).toBe('mcp__anteiku__anteiku_task_crea');
    expect(first.tools[0]!.args).toContain('progetto_id');
    expect(first.tools[0]!.description).not.toContain('[External tool');
    expect(first.note).toContain('prossimo passo');
    const after = d.activeNames();
    expect(after.slice(0, 5)).toEqual([
      'vault_search',
      'result_read',
      'mcp__anteiku__anteiku_clienti_leggi',
      'mcp__anteiku__anteiku_task_elenca',
      TOOL_SEARCH,
    ]);
    expect(after.slice(5)).toEqual(first.tools.map((t) => t.name).sort());
    // The same search again adds nothing; another one appends.
    d.search('crea task', 2);
    expect(d.activeNames()).toEqual(after);
    d.search('elimina preventivo', 1);
    expect(d.activeNames().slice(0, after.length)).toEqual(after);
    expect(d.activeNames()).toHaveLength(after.length + 1);
    // The cap of the run: no more loads, the search says so.
    d.search('aggiorna', 5);
    const capped = d.search('riunioni', 3);
    expect(d.loaded).toHaveLength(6);
    // Never "pronti" for what the cap left out (M6 of the review of 19/10, D-134).
    expect(capped.note).toContain('limite di 6 strumenti caricati');
    expect(capped.note).toContain('Non è un no dell’utente');
    expect(capped.tools.filter((t) => t.status === 'non caricabile').length).toBeGreaterThan(0);
    expect(capped.note).not.toMatch(/Pronti dal prossimo passo: [^.]*riunioni/);
    // Two plans of the same tools: the same set and order.
    const again = DeferredTools.plan(
      tools(),
      { ...TOOL_SEARCH_DEFAULT, preload: 2 },
      () => recent,
    )!;
    expect(again.activeNames()).toEqual(after.slice(0, 5));
  });

  it('the card says the services have more tools to find', () => {
    const card = monstersCard({
      toolNames: ['vault_search', TOOL_SEARCH, 'mcp__anteiku__search'],
    });
    expect(card).toContain(
      'servizi collegati: anteiku (molti strumenti: cercali con `tools_search`)',
    );
  });
});

describe('tools_search tells the truth (M6 of the review of 19/10, D-134)', () => {
  const tools = () => [own('vault_search'), own('result_read'), ...anteikuTools()];

  it('a tool already sent is found as "pronto", never "nessuno strumento trovato"', () => {
    const d = DeferredTools.plan(tools(), TOOL_SEARCH_DEFAULT, () => [
      'mcp__anteiku__anteiku_task_crea',
    ])!;
    expect(d.activeNames()).toContain('mcp__anteiku__anteiku_task_crea');
    const found = d.search('crea task', 3);
    const task = found.tools.find((t) => t.name === 'mcp__anteiku__anteiku_task_crea');
    expect(task?.status).toBe('pronto');
    expect(found.note).toContain('Già pronti, chiamali ora: mcp__anteiku__anteiku_task_crea');
  });

  it('a tool called by name while it waits is loaded, past the cap it says so (never silent)', () => {
    const d = DeferredTools.plan(tools(), { ...TOOL_SEARCH_DEFAULT, maxLoaded: 1 })!;
    expect(d.loadCalled(['mcp__anteiku__anteiku_task_crea', 'vault_search'])).toEqual([
      { name: 'mcp__anteiku__anteiku_task_crea', state: 'loaded' },
    ]);
    expect(d.loadCalled(['mcp__anteiku__anteiku_preventivi_elimina', 'web_search'])).toEqual([
      { name: 'mcp__anteiku__anteiku_preventivi_elimina', state: 'limit', max: 1 },
      { name: 'web_search', state: 'unknown' },
    ]);
    const note = missedToolsNote(
      d.loadCalled(['mcp__anteiku__anteiku_preventivi_elimina', 'web_search']),
    );
    expect(note).toContain('limite di 1 strumenti caricati in questo lavoro');
    expect(note).toContain('web_search non è uno strumento di questo lavoro');
    expect(note).not.toMatch(/negat|denied/i);
  });

  it('own tools of this turn wait instead of going: the web on a free chain (A7)', () => {
    const mine = [own('vault_search'), own('web_search'), own('web_fetch'), own('vault_delete')];
    const turn = new Map([
      ['web_search', 'web'],
      ['web_fetch', 'web'],
      ['vault_delete', 'note'],
    ]);
    const d = DeferredTools.plan(mine, TOOL_SEARCH_FREE, () => [], turn)!;
    expect(d.activeNames()).toEqual(['vault_search', TOOL_SEARCH]);
    expect(d.ownDeferred.sort()).toEqual(['vault_delete', 'web_fetch', 'web_search']);
    expect(d.tool().description).toContain('web (2)');
    expect(d.search('cerca sul web').tools.map((t) => t.name)).toContain('web_search');
    expect(d.activeNames()).toContain('web_search');
  });
});

describe('the tools of a turn on a free chain wait, never go (D-134)', () => {
  it('the rare note tools stay in the run, deferred; vault_propose goes for who writes everywhere', () => {
    const agent = agentFor({
      models: [{ provider: 'openrouter', model: 'x:free' }],
      tools: ['vault_search', 'vault_write', 'vault_delete', 'vault_links', 'vault_propose'],
      vault: { read: ['**'], write: ['**'] },
    });
    const { agent: turn, deferred } = withTurnDeferrals(agent, 'scrivi un post');
    expect(turn.config.tools).toEqual([
      'vault_search',
      'vault_write',
      'vault_delete',
      'vault_links',
    ]);
    expect([...deferred.keys()].sort()).toEqual(['vault_delete', 'vault_links']);
    // The request is about deleting: sent at once.
    expect([...withTurnDeferrals(agent, 'elimina la nota X').deferred.keys()]).toEqual([
      'vault_links',
    ]);
  });
});

describe('tools_search in a run', () => {
  it('the monster finds the Anteiku tool, calls it from the next step; the tools sent stay few and in order', async () => {
    const env = setupAgents({
      a: [
        fake.toolCall(TOOL_SEARCH, { query: 'crea una task' }),
        fake.toolCall('mcp__anteiku__anteiku_task_crea', {
          titolo: 'Chiamare Rossi',
          progetto_id: '00000000-0000-4000-8200-000000000001',
        }),
        fake.text('Task creata.'),
      ],
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    calls.length = 0;
    const result = await runAgent({
      agent: agentFor({ limits: { maxSteps: 6 } }),
      task: 'Crea in Anteiku la task "Chiamare Rossi"',
      tools: [],
      extraTools: anteikuTools(),
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('completed');
    expect(calls).toEqual([
      {
        tool: 'anteiku_task_crea',
        input: { titolo: 'Chiamare Rossi', progetto_id: '00000000-0000-4000-8200-000000000001' },
      },
    ]);
    const sent = env.provider.calls.map((c) => (c.options.tools ?? []).map((t) => t.name));
    // First step: no Anteiku tool (nothing used before), the search and result_read.
    expect(sent[0]).toEqual(['result_read', TOOL_SEARCH]);
    // Then the five found are appended; the prefix stays.
    expect(sent[1]!.slice(0, 2)).toEqual(sent[0]);
    expect(sent[1]).toContain('mcp__anteiku__anteiku_task_crea');
    expect(sent[1]!.length).toBe(2 + TOOL_SEARCH_DEFAULT.maxResults);
    expect(sent[2]).toEqual(sent[1]);
    // The context of each step counts only the tools sent.
    const usage = env.log
      .query({ runId: run.id, type: 'provider_usage' })
      .map((e) => (e as LogEvent<'provider_usage'>).data.context?.parts.tools ?? 0);
    expect(usage[0]).toBeGreaterThan(0);
    expect(usage[0]).toBeLessThan(usage[1]!);
    // The search is a tool call like the others, in the log.
    const searched = env.log
      .query({ runId: run.id, type: 'tool_call' })
      .map((e) => (e as LogEvent<'tool_call'>).data.tool);
    expect(searched).toEqual([TOOL_SEARCH, 'mcp__anteiku__anteiku_task_crea']);
  });

  it('a later run starts with the tools the monster used', async () => {
    const env = setupAgents({
      a: [
        fake.toolCall('mcp__anteiku__anteiku_task_crea', {
          titolo: 'x',
          progetto_id: '00000000-0000-4000-8200-000000000001',
        }),
        fake.text('ok'),
      ],
    });
    // An earlier run used it.
    env.log.append({
      agent: 'rhea',
      type: 'tool_call',
      data: { callId: 'c0', tool: 'mcp__anteiku__anteiku_task_crea', input: {} },
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agentFor({ limits: { maxSteps: 4 } }),
      task: 'ancora',
      tools: [],
      extraTools: anteikuTools(),
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('completed');
    expect((env.provider.calls[0]!.options.tools ?? []).map((t) => t.name)).toEqual([
      'result_read',
      'mcp__anteiku__anteiku_task_crea',
      TOOL_SEARCH,
    ]);
  });

  it('`toolSearch: false` sends them all, as before', async () => {
    const env = setupAgents({ a: [fake.text('ok')] });
    const run = env.runs.startRun({ agent: 'rhea' });
    await runAgent({
      agent: agentFor(),
      task: 'x',
      tools: [],
      extraTools: anteikuTools(),
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
      toolSearch: false,
    });
    expect(env.provider.calls[0]!.options.tools).toHaveLength(123);
  });
});
