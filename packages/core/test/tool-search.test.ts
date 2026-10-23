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
import { missedToolsNote, turnWords } from '../src/agents/run-agent.ts';
import { ENTRY_TOOL, preloadOf, toolCatalog } from '../src/agents/tool-search.ts';
import {
  ANTEIKU_OPERATIONS,
  anteikuToolDefs,
  anteikuToolName,
} from './fixtures/fake-anteiku-server.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

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
    inLang('it');
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
    inLang('it');
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

  it('the card says the services are already the monster’s and names their tools (D-163)', () => {
    inLang('it');
    const card = monstersCard({
      toolNames: ['vault_search', TOOL_SEARCH, 'mcp__anteiku__search'],
    });
    expect(card).toContain('servizi collegati, già tuoi (mai chiedere all’utente accessi');
    expect(card).toContain('es. `mcp__anteiku__search`');
    expect(card).toContain('\n  - anteiku (`mcp__anteiku__…`): search\n');
    expect(card).not.toContain('molti strumenti');
  });
});

describe('tools_search tells the truth (M6 of the review of 19/10, D-134)', () => {
  const tools = () => [own('vault_search'), own('result_read'), ...anteikuTools()];

  it('a tool already sent is found as "pronto", never "nessuno strumento trovato"', () => {
    inLang('it');
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
    inLang('it');
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

/** Names of the tools of one request, as the provider got them. */
const sentTools = (env: ReturnType<typeof setupAgents>, i: number) =>
  (env.provider.calls[i]!.options.tools ?? []).map((t) => t.name);

describe('tools_search in a run', () => {
  const PROJECT = '00000000-0000-4000-8200-000000000001';

  it('the first request carries the tools the words of the task point at; a search appends, the prefix stays (D-163)', async () => {
    const env = setupAgents({
      a: [
        fake.toolCall(TOOL_SEARCH, { query: 'registra ore' }),
        fake.toolCall('mcp__anteiku__anteiku_ore_registra', { ore: 2, progetto_id: PROJECT }),
        fake.text('Ore registrate.'),
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
      { tool: 'anteiku_ore_registra', input: { ore: 2, progetto_id: PROJECT } },
    ]);
    const sent = env.provider.calls.map((_, i) => sentTools(env, i));
    // First request: result_read, the preload from the task's words (never more than the config
    // allows, sorted so the prefix is stable), then the search. Not the 122 tools.
    const first = sent[0]!;
    expect(first[0]).toBe('result_read');
    expect(first.at(-1)).toBe(TOOL_SEARCH);
    const preload = first.slice(1, -1);
    expect(preload.length).toBeGreaterThan(0);
    expect(preload.length).toBeLessThanOrEqual(TOOL_SEARCH_DEFAULT.preload);
    expect(preload).toContain('mcp__anteiku__anteiku_task_crea');
    expect(preload).toEqual([...preload].sort());
    expect(preload).not.toContain('mcp__anteiku__anteiku_ore_registra');
    // The search found ore_registra: it is appended after the search, the prefix is the same.
    expect(sent[1]!.slice(0, first.length)).toEqual(first);
    expect(sent[1]!.slice(first.length)).toContain('mcp__anteiku__anteiku_ore_registra');
    expect(sent[1]!.length).toBeLessThanOrEqual(first.length + TOOL_SEARCH_DEFAULT.maxResults);
    expect(sent[2]).toEqual(sent[1]);
    // The context of each step counts only the tools sent.
    const usage = env.log
      .query({ runId: run.id, type: 'provider_usage' })
      .map((e) => (e as LogEvent<'provider_usage'>).data.context?.parts.tools ?? 0);
    expect(usage[0]).toBeGreaterThan(0);
    expect(usage[1]).toBeGreaterThanOrEqual(usage[0]!);
    // The search is a tool call like the others, in the log.
    const searched = env.log
      .query({ runId: run.id, type: 'tool_call' })
      .map((e) => (e as LogEvent<'tool_call'>).data.tool);
    expect(searched).toEqual([TOOL_SEARCH, 'mcp__anteiku__anteiku_ore_registra']);
  });

  it('a later run starts with the tools the monster used, and the ones the words of the task point at', async () => {
    const env = setupAgents({
      a: [
        fake.toolCall('mcp__anteiku__anteiku_task_crea', { titolo: 'x', progetto_id: PROJECT }),
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
    // No word of the task points at any tool: only what the monster used.
    expect(sentTools(env, 0)).toEqual([
      'result_read',
      'mcp__anteiku__anteiku_task_crea',
      TOOL_SEARCH,
    ]);

    // Another job whose words point at the hours: those first, the used one fills in; the order
    // is the same whatever the order of the tools given to the run.
    const sentFor = async (extraTools: MonstersTool[]) => {
      const e = setupAgents({ a: [fake.text('ok')] });
      e.log.append({
        agent: 'rhea',
        type: 'tool_call',
        data: { callId: 'c0', tool: 'mcp__anteiku__anteiku_task_crea', input: {} },
      });
      const r = e.runs.startRun({ agent: 'rhea' });
      await runAgent({
        agent: agentFor(),
        task: 'Registra le ore di lavoro di ieri',
        tools: [],
        extraTools,
        signal: r.signal,
        log: e.log,
        runId: r.id,
        providers: e.providers,
      });
      return sentTools(e, 0);
    };
    const forward = await sentFor(anteikuTools());
    expect(forward).toContain('mcp__anteiku__anteiku_ore_registra');
    expect(forward).toContain('mcp__anteiku__anteiku_task_crea');
    expect(forward.slice(1, -1)).toEqual([...forward.slice(1, -1)].sort());
    expect(await sentFor(anteikuTools().reverse())).toEqual(forward);
  });

  it('a waiting tool called by its full name runs in that step, without a search; it is sent from the next request (D-163)', async () => {
    const env = setupAgents({
      a: [
        fake.toolCall('mcp__anteiku__anteiku_pagamenti_segna_pagato', { id: 'p1' }),
        fake.text('Segnato.'),
      ],
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    calls.length = 0;
    const result = await runAgent({
      agent: agentFor({ limits: { maxSteps: 4 } }),
      task: 'Ciao',
      tools: [],
      extraTools: anteikuTools(),
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('completed');
    // It ran at once (step 1), not "invalid, loaded for the next step".
    expect(calls).toEqual([{ tool: 'anteiku_pagamenti_segna_pagato', input: { id: 'p1' } }]);
    const results = env.log
      .query({ runId: run.id, type: 'tool_result' })
      .map((e) => JSON.stringify((e as LogEvent<'tool_result'>).data));
    expect(results.join('\n')).toContain('ok anteiku_pagamenti_segna_pagato');
    // Never sent to the model before the call; sent after it, behind the same prefix.
    const first = sentTools(env, 0);
    expect(first).not.toContain('mcp__anteiku__anteiku_pagamenti_segna_pagato');
    // "Ciao" points at nothing: only half the slots, tools that open a service (search first).
    const entry = first.filter((n) => n.startsWith('mcp__anteiku__'));
    expect(entry).toHaveLength(TOOL_SEARCH_DEFAULT.preload / 2);
    for (const n of entry) expect(n.replace('mcp__anteiku__', '')).toMatch(ENTRY_TOOL);
    expect(entry).toContain('mcp__anteiku__anteiku_documenti_cerca');
    expect(first).toEqual(['result_read', ...entry, TOOL_SEARCH]);
    expect(sentTools(env, 1)).toEqual([...first, 'mcp__anteiku__anteiku_pagamenti_segna_pagato']);
    // The model was never told its call was invalid.
    expect(JSON.stringify(env.provider.calls[1]!.options.prompt)).not.toMatch(/invalid|non valid/i);
  });

  it('a name without the mcp__server__ prefix is repaired and runs; a lone word is not guessed (D-163)', async () => {
    const env = setupAgents({
      a: [fake.toolCall('anteiku_clienti_elenca', { testo: 'Rossi' }), fake.text('Fatto.')],
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    calls.length = 0;
    const result = await runAgent({
      agent: agentFor({ limits: { maxSteps: 4 } }),
      task: 'Ciao',
      tools: [],
      extraTools: anteikuTools(),
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('completed');
    expect(calls).toEqual([{ tool: 'anteiku_clienti_elenca', input: { testo: 'Rossi' } }]);
    const called = env.log
      .query({ runId: run.id, type: 'tool_call' })
      .map((e) => (e as LogEvent<'tool_call'>).data.tool);
    expect(called).toEqual(['mcp__anteiku__anteiku_clienti_elenca']);
    // The repaired call also loads the tool for the next request.
    expect(sentTools(env, 1)).toContain('mcp__anteiku__anteiku_clienti_elenca');

    // A lone word is not a tool of the run: nothing runs.
    const lone = setupAgents({ a: [fake.toolCall('elenca', {}), fake.text('Non so.')] });
    const r2 = lone.runs.startRun({ agent: 'rhea' });
    calls.length = 0;
    await runAgent({
      agent: agentFor({ limits: { maxSteps: 4 } }),
      task: 'Ciao',
      tools: [],
      extraTools: anteikuTools(),
      signal: r2.signal,
      log: lone.log,
      runId: r2.id,
      providers: lone.providers,
    });
    expect(calls).toEqual([]);
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

/** The names a catalog line stands for: `prefix` + `area_{a,b}` / `x_* (n)` / `x` items, expanded. */
function catalogNames({ prefix, names }: { prefix: string; names: string }): string[] {
  return names.split(' · ').flatMap((item) => {
    const group = /^(.+)_\{(.+)\}$/.exec(item);
    return group
      ? group[2]!.split(',').map((part) => `${prefix}${group[1]!}_${part}`)
      : [`${prefix}${item}`];
  });
}

describe('toolCatalog: the names of a service in a few words (D-163)', () => {
  it('Anteiku’s 122 operations and search/fetch: under ~1,900 characters, every name recoverable', () => {
    const names = [...ANTEIKU_OPERATIONS.map(anteikuToolName), 'search', 'fetch'];
    expect(names).toHaveLength(124);
    const catalog = toolCatalog(names);
    expect(catalog.names.length).toBeLessThan(1900);
    expect(catalog.names).not.toContain('* (');
    expect(catalogNames(catalog).sort()).toEqual([...names].sort());
    // `search` and `fetch` do not share the `anteiku_` prefix: it stays in the names.
    expect(catalog.prefix).toBe('');
    expect(catalog.names).toContain('anteiku_clienti_{aggiorna,archivia,crea,elenca,leggi}');
    expect(catalog.names).toContain('anteiku_task_{aggiorna,aggiorna_punto,');
    expect(catalog.names).toMatch(/(^| · )search( · |$)/);
    // The same names in another order give the same text.
    expect(toolCatalog([...names].reverse())).toEqual(catalog);
    // Without search/fetch every name shares the prefix: it is said once.
    const only = names.filter((n) => n.startsWith('anteiku_'));
    const factored = toolCatalog(only);
    expect(factored.prefix).toBe('anteiku_');
    expect(factored.names).toContain('clienti_{aggiorna,archivia,crea,elenca,leggi}');
    expect(factored.names).not.toContain('anteiku_');
    expect(catalogNames(factored).sort()).toEqual([...only].sort());
    expect(factored.names.length).toBeLessThan(catalog.names.length);
  });

  it('an English verb-first set: grouped by the verb, every name recoverable', () => {
    const names = [
      'list_issues',
      'get_issue',
      'create_issue',
      'update_issue',
      'list_pull_requests',
      'get_pull_request',
      'create_pull_request',
      'merge_pull_request',
      'search_code',
      'search_issues',
      'get_file_contents',
      'create_branch',
      'list_branches',
    ];
    const catalog = toolCatalog(names);
    expect(catalog.prefix).toBe('');
    expect(catalog.names).toBe(
      'create_{branch,issue,pull_request} · get_{file_contents,issue,pull_request} · list_{branches,issues,pull_requests} · merge_pull_request · search_{code,issues} · update_issue',
    );
    expect(catalogNames(catalog).sort()).toEqual([...names].sort());
    // Shorter than the names written out.
    expect(catalog.names.length).toBeLessThan(names.join(' · ').length);
    // A prefix all the names share is factored out, cut after an underscore.
    const prefixed = toolCatalog(names.map((n) => `gh_${n}`));
    expect(prefixed.prefix).toBe('gh_');
    expect(prefixed.names).toBe(catalog.names);
  });

  it('small and odd sets: one name, none, a name without underscore, duplicates', () => {
    expect(toolCatalog([])).toEqual({ prefix: '', names: '' });
    expect(toolCatalog(['search'])).toEqual({ prefix: '', names: 'search' });
    expect(toolCatalog(['a_b'])).toEqual({ prefix: '', names: 'a_b' });
    expect(toolCatalog(['x_one', 'x_two', 'x_one'])).toEqual({ prefix: 'x_', names: 'one · two' });
    const mixed = ['ping', 'task_crea', 'task_elenca'];
    expect(catalogNames(toolCatalog(mixed)).sort()).toEqual(mixed.sort());
  });

  it('past 2,600 characters only the groups and how many names each has', () => {
    const verbs = [
      'aggiorna',
      'archivia',
      'consolida',
      'duplica',
      'elenca',
      'leggi',
      'ordina',
      'riapri',
    ];
    const names = Array.from({ length: 80 }, (_, i) => verbs.map((v) => `area${i}_${v}`)).flat();
    const catalog = toolCatalog(names);
    // Written out the names would be far over the limit.
    expect(names.join(' · ').length).toBeGreaterThan(2600);
    expect(catalog.names.length).toBeLessThan(2600);
    expect(catalog.names.split(' · ')).toHaveLength(80);
    expect(catalog.names).toContain('area0_* (8)');
    expect(catalog.names).toContain('area79_* (8)');
    expect(catalog.names).not.toContain('consolida');
    // A group of one keeps its name.
    expect(toolCatalog([...names, 'unico_solo']).names).toContain('unico_solo');
    // Under the limit the same shape is written out.
    expect(toolCatalog(names.slice(0, 16)).names).toBe(
      'area0_{aggiorna,archivia,consolida,duplica,elenca,leggi,ordina,riapri} · area1_{aggiorna,archivia,consolida,duplica,elenca,leggi,ordina,riapri}',
    );
  });

  it('ENTRY_TOOL: the tools that open a service', () => {
    for (const n of [
      'search',
      'fetch',
      'anteiku_documenti_cerca',
      'list_issues',
      'x_get_user',
      'anteiku_clienti_elenca',
      'anteiku_task_leggi',
      'read_file',
      'find_all',
    ]) {
      expect(n, n).toMatch(ENTRY_TOOL);
    }
    for (const n of [
      'anteiku_task_crea',
      'create_issue',
      'delete_listing',
      'searching',
      'budget_set',
      'target',
    ]) {
      expect(n, n).not.toMatch(ENTRY_TOOL);
    }
  });
});

describe('preloadOf: the MCP tools sent from the first step (D-163)', () => {
  const all = () => anteikuTools();
  const short = (names: string[]) => names.map((n) => n.replace('mcp__anteiku__', ''));

  it('the tools the words point at come first, the most used ones fill the rest', () => {
    const query = 'registra le ore di lavoro';
    const used = ['mcp__anteiku__anteiku_clienti_leggi', 'mcp__anteiku__anteiku_task_elenca'];
    const out = preloadOf(all(), used, query, 5);
    expect(out).toHaveLength(5);
    // The best match first; ceil(3/4 of 5) = 4 slots for the relevant ones (the hours), the
    // recent one right after them, before the rest of the relevant.
    expect(out[0]).toBe('mcp__anteiku__anteiku_ore_registra');
    for (const n of out.slice(0, 4)) expect(n).toMatch(/_ore_/);
    expect(out[4]).toBe(used[0]);
    // With four slots: three relevant, then the recent one.
    const four = preloadOf(all(), used, query, 4);
    expect(four.slice(0, 3)).toEqual(out.slice(0, 3));
    expect(four[3]).toBe(used[0]);
    // The order of the tools given does not matter.
    expect(preloadOf(all().reverse(), used, query, 5)).toEqual(out);
  });

  it('a stray word does not fill the slots with tools that do not point at the request', () => {
    const out = preloadOf(all(), [], 'registra ore e cliente', 8);
    expect(out[0]).toBe('mcp__anteiku__anteiku_ore_registra');
    expect(out.length).toBeLessThanOrEqual(8);
    // Every tool sent has a word of the request in its name.
    for (const n of short(out)) expect(n, n).toMatch(/ore|registr|client/);
    // A request in a language the tools do not speak points at nothing: no tool by chance.
    expect(
      preloadOf(all(), [], 'xyzzy plugh', 8).every((n) =>
        ENTRY_TOOL.test(
          n
            .split('__')
            .at(-1)!
            .replace(/^anteiku_/, ''),
        ),
      ),
    ).toBe(true);
  });

  it('without a query the recent ones, in their order; the ones not in the run are ignored', () => {
    const recent = [
      'mcp__anteiku__anteiku_task_elenca',
      'mcp__other__something',
      'mcp__anteiku__anteiku_clienti_leggi',
      'mcp__anteiku__anteiku_task_elenca',
    ];
    expect(short(preloadOf(all(), recent, '', 5))).toEqual([
      'anteiku_task_elenca',
      'anteiku_clienti_leggi',
    ]);
    // A query that matches nothing is the same as none.
    expect(short(preloadOf(all(), recent, 'xyzzy plugh', 5))).toEqual([
      'anteiku_task_elenca',
      'anteiku_clienti_leggi',
    ]);
    expect(short(preloadOf(all(), recent, '   ', 1))).toEqual(['anteiku_task_elenca']);
  });

  it('without any signal: tools that open a service, the search first, half the slots', () => {
    const tools = [...all(), own('mcp__anteiku__search'), own('mcp__anteiku__fetch')];
    const out = preloadOf(tools, [], '', 8);
    expect(out).toHaveLength(4);
    // The searches first (by name), then the others that list or read.
    expect(short(out).slice(0, 2)).toEqual(['anteiku_documenti_cerca', 'search']);
    for (const n of short(out)) expect(n).toMatch(ENTRY_TOOL);
    // The same whatever the order the tools come in.
    expect(preloadOf([...tools].reverse(), [], '', 8)).toEqual(out);
    expect(preloadOf(tools, [], '', 3)).toHaveLength(1);
    expect(preloadOf(tools, [], '', 1)).toHaveLength(1);
    // A server with no tool that opens it: nothing.
    expect(preloadOf([own('mcp__x__crea_cosa'), own('mcp__x__togli_cosa')], [], '', 8)).toEqual([]);
  });

  it('never more than the slots, whatever the signals', () => {
    const recent = all().map((t) => t.name);
    for (const slots of [0, 1, 2, 3, 5, 8, 30]) {
      for (const query of ['', 'crea task cliente preventivo ore', 'a b c d e f g h i j k']) {
        const out = preloadOf(all(), recent, query, slots);
        expect(out.length, `${slots} slots, "${query}"`).toBeLessThanOrEqual(slots);
        expect(new Set(out).size).toBe(out.length);
      }
    }
    expect(preloadOf(all(), recent, 'crea task', 0)).toEqual([]);
    expect(preloadOf([], recent, 'crea task', 8)).toEqual([]);
    // One slot: the best match, not a recent one.
    expect(preloadOf(all(), recent, 'registra ore', 1)).toEqual([
      'mcp__anteiku__anteiku_ore_registra',
    ]);
  });

  it('turnWords: the request, why, and the last two messages of the user', () => {
    const history = [
      { role: 'user' as const, content: 'primo' },
      { role: 'assistant' as const, content: 'risposta' },
      { role: 'user' as const, content: 'secondo' },
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'terzo' }] },
    ];
    const words = turnWords({ goal: 'Fai X', why: 'perché Y' }, history);
    expect(words).toBe('Fai X\nperché Y\nsecondo\nterzo');
    expect(turnWords({ goal: 'Solo' }, [])).toBe('Solo');
  });
});

describe('DeferredTools: the turn’s words, what is sent, what was called by name (D-163)', () => {
  const tools = () => [own('vault_search'), own('result_read'), ...anteikuTools()];

  it('the query drives the preload; below the threshold there is none', () => {
    const d = DeferredTools.plan(
      tools(),
      TOOL_SEARCH_DEFAULT,
      () => [],
      new Map(),
      'registra le ore di lavoro',
    )!;
    expect(d.activeNames()).toContain('mcp__anteiku__anteiku_ore_registra');
    expect(d.activeNames().slice(0, 2)).toEqual(['vault_search', 'result_read']);
    expect(d.activeNames().at(-1)).toBe(TOOL_SEARCH);
    expect(d.activeNames().length).toBeLessThanOrEqual(2 + TOOL_SEARCH_DEFAULT.preload + 1);
    // Free chains preload less.
    const free = DeferredTools.plan(
      tools(),
      TOOL_SEARCH_FREE,
      () => [],
      new Map(),
      'registra ore',
    )!;
    expect(free.activeNames().length).toBeLessThanOrEqual(2 + TOOL_SEARCH_FREE.preload + 1);
    // Few MCP tools: sent as before, the query changes nothing.
    const few = [own('vault_search'), ...anteikuTools().slice(0, 5), own('project_propose')];
    const a = DeferredTools.plan(few, TOOL_SEARCH_DEFAULT, () => [], new Map(), '')!;
    const b = DeferredTools.plan(few, TOOL_SEARCH_DEFAULT, () => [], new Map(), 'cliente')!;
    expect(b.activeNames()).toEqual(a.activeNames());
  });

  it('sends: the loaded ones and the base, not the ones that wait; names of the run only', () => {
    const d = DeferredTools.plan(tools(), TOOL_SEARCH_DEFAULT)!;
    const wait = 'mcp__anteiku__anteiku_pagamenti_segna_pagato';
    expect(d.sends('vault_search')).toBe(true);
    expect(d.sends(TOOL_SEARCH)).toBe(true);
    expect(d.sends(wait)).toBe(false);
    // Not a tool of the run (a provider tool, say): not this filter's to hold back.
    expect(d.sends('web_search_preview')).toBe(true);
    d.search('segna pagamento pagato', 1);
    expect(d.sends(wait)).toBe(true);
  });

  it('calledDirectly loads the deferred tools that ran, ignores the others, stops at the cap', () => {
    const d = DeferredTools.plan(tools(), { ...TOOL_SEARCH_DEFAULT, maxLoaded: 2 })!;
    const [a, b, c] = [
      'mcp__anteiku__anteiku_pagamenti_segna_pagato',
      'mcp__anteiku__anteiku_ore_registra',
      'mcp__anteiku__anteiku_task_sposta',
    ];
    expect(d.calledDirectly([a, 'vault_search', 'not_a_tool'])).toEqual([a]);
    expect(d.sends(a)).toBe(true);
    // Called twice: loaded once.
    expect(d.calledDirectly([a])).toEqual([]);
    expect(d.activeNames().filter((n) => n === a)).toHaveLength(1);
    expect(d.calledDirectly([b, c])).toEqual([b]);
    // Past the cap it still runs when called; it is just not sent.
    expect(d.sends(c)).toBe(false);
    expect(d.loaded).toEqual([a, b]);
  });
});
