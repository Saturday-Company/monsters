import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider } from '@monsters/providers/testing';
import { ToolError, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  CallTracker,
  camelCase,
  compactSchema,
  createToolCallRepair,
  DecisionPortError,
  LlmDecisionPort,
  matchToolName,
  normalizeInput,
  repairJson,
  snakeCase,
  stableJson,
} from '../src/index.ts';
import { loopFromStored, loopMetrics } from '../eval/metrics.ts';

/* Deterministic pieces of D-064: repairs, repeated calls, loop metrics, gate timeout. */

describe('tool call repair (AG-17)', () => {
  const names = ['delegate', 'vault_read', 'ask_user'];

  it('matches tool names in another case, with dashes or prefixes', () => {
    expect(matchToolName('Delegate', names)).toBe('delegate');
    expect(matchToolName('vault-read', names)).toBe('vault_read');
    expect(matchToolName('VaultRead', names)).toBe('vault_read');
    expect(matchToolName('functions.ask_user', names)).toBe('ask_user');
    expect(matchToolName('mcp__monsters__vault_read', names)).toBe('vault_read');
    expect(matchToolName('web_search', names)).toBeUndefined();
  });

  it('maps an MCP tool called without its mcp__server__ prefix; a lone word never does (D-163)', () => {
    const mcp = [
      'vault_read',
      'mcp__anteiku__anteiku_task_crea',
      'mcp__anteiku__anteiku_clienti_crea',
      'mcp__anteiku__anteiku_task_elenca',
      'mcp__anteiku__search',
      'mcp__notion__search',
    ];
    // The whole name after the prefix, in other spellings too.
    expect(matchToolName('anteiku_task_crea', mcp)).toBe('mcp__anteiku__anteiku_task_crea');
    expect(matchToolName('AnteikuTaskCrea', mcp)).toBe('mcp__anteiku__anteiku_task_crea');
    expect(matchToolName('anteiku-task-elenca', mcp)).toBe('mcp__anteiku__anteiku_task_elenca');
    // A unique tail with an underscore.
    expect(matchToolName('task_crea', mcp)).toBe('mcp__anteiku__anteiku_task_crea');
    expect(matchToolName('clienti_crea', mcp)).toBe('mcp__anteiku__anteiku_clienti_crea');
    // A lone word: many tools end so, none is guessed.
    expect(matchToolName('crea', mcp)).toBeUndefined();
    expect(matchToolName('elenca', mcp)).toBeUndefined();
    // Two servers have a `search`: ambiguous, not guessed.
    expect(matchToolName('search', mcp)).toBeUndefined();
    // A tail shared by two tools is ambiguous too.
    expect(matchToolName('x_crea', ['mcp__a__a_x_crea', 'mcp__b__b_x_crea'])).toBeUndefined();
    // Names of Monsters' own tools win, and an unknown name stays unknown.
    expect(matchToolName('vault_read', mcp)).toBe('vault_read');
    expect(matchToolName('anteiku_task_inventa', mcp)).toBeUndefined();
  });

  it('never crosses servers, never stretches a name onto a longer tool (C-1)', () => {
    const tools = [
      'vault_read',
      'ask_user',
      'mcp__slack__send_message',
      'mcp__slack__list_channels',
      'mcp__crm__bulk_delete_contacts',
      'mcp__crm__list_contacts',
      'mcp__crm__delete_contact',
      'mcp__anteiku__anteiku_task_crea',
      'mcp__anteiku__anteiku_clienti_crea',
      'mcp__anteiku__anteiku_clienti_elenca',
      'mcp__saturday-notion__notion_create_page',
      'mcp__saturday-notion__notion-search',
      'mcp__docs__gdocs_read',
      'mcp__docs__gdocs_write',
      'mcp__docs__gdocs_list',
    ];
    const cases: [string, string | undefined][] = [
      // Another server named: its tools or nothing.
      ['mcp__gmail__send_message', undefined],
      ['mcp__notion__create_page', undefined],
      ['mcp__gmail__vault_read', undefined],
      ['mcp__slack__send_message', 'mcp__slack__send_message'],
      ['mcp__Slack__sendMessage', 'mcp__slack__send_message'],
      ['mcp__slack__send-message', 'mcp__slack__send_message'],
      // The harnesses' name for Monsters' own tools.
      ['mcp__monsters__vault_read', 'vault_read'],
      ['mcp__monsters__AskUser', 'ask_user'],
      ['functions.mcp__slack__send_message', 'mcp__slack__send_message'],
      // No server: the whole tool name, in any spelling.
      ['send_message', 'mcp__slack__send_message'],
      ['SendMessage', 'mcp__slack__send_message'],
      ['delete_contact', 'mcp__crm__delete_contact'],
      ['notion_search', 'mcp__saturday-notion__notion-search'],
      // A longer tool that only ends with the name is another tool.
      ['delete_contacts', undefined],
      ['mcp__crm__delete_contacts', undefined],
      ['contacts', undefined],
      // The server's namespace head left out: its name, a word of it, or a head all its tools share.
      ['task_crea', 'mcp__anteiku__anteiku_task_crea'],
      ['mcp__anteiku__task_crea', 'mcp__anteiku__anteiku_task_crea'],
      ['mcp__anteiku__clienti-elenca', 'mcp__anteiku__anteiku_clienti_elenca'],
      ['create_page', 'mcp__saturday-notion__notion_create_page'],
      ['mcp__saturday-notion__create_page', 'mcp__saturday-notion__notion_create_page'],
      ['mcp__docs__read', undefined],
      ['mcp__slack__task_crea', undefined],
      ['', undefined],
    ];
    for (const [asked, want] of cases)
      expect([asked, matchToolName(asked, tools)]).toEqual([asked, want]);
    // A head shared by a server's tools is a namespace only with three tools or more.
    expect(
      matchToolName('delete_contacts', ['mcp__crm__bulk_delete_contacts', 'mcp__crm__bulk_tag']),
    ).toBeUndefined();
    expect(
      matchToolName('read_doc', ['mcp__g__gd_read_doc', 'mcp__g__gd_list', 'mcp__g__gd_write_doc']),
    ).toBe('mcp__g__gd_read_doc');
  });

  it('repairs the JSON free models write, or gives up', () => {
    expect(repairJson('{"a": 1}')).toBe('{"a": 1}');
    expect(JSON.parse(repairJson('```json\n{"a": 1}\n```')!)).toEqual({ a: 1 });
    expect(JSON.parse(repairJson('Ecco: {"a": [1, 2,],} spero vada')!)).toEqual({ a: [1, 2] });
    expect(JSON.parse(repairJson('{"ok": True, "x": None}')!)).toEqual({ ok: true, x: null });
    expect(JSON.parse(repairJson('{"q": "True story"}')!)).toEqual({ q: 'True story' });
    expect(JSON.parse(repairJson('{"goal": "Cerca", "links": ["a"')!)).toEqual({
      goal: 'Cerca',
      links: ['a'],
    });
    expect(repairJson('')).toBe('{}');
    expect(repairJson('non è json')).toBeNull();
  });

  it('renames keys to the schema spelling and parses values passed as strings', () => {
    const schema = {
      properties: {
        context_links: { type: 'array' },
        done_when: { type: 'string' },
        max_chars: { type: 'integer' },
        blocking: { type: 'boolean' },
      },
    };
    expect(
      normalizeInput(
        { contextLinks: '["a","b"]', doneWhen: 'salvato', max_chars: '500', blocking: 'false' },
        schema,
      ),
    ).toEqual({
      input: { context_links: ['a', 'b'], done_when: 'salvato', max_chars: 500, blocking: false },
      fixed: ['keys', 'values'],
    });
    // Strings stay strings, unknown keys stay as they are.
    expect(normalizeInput({ done_when: '42', other: 1 }, schema)).toEqual({
      input: { done_when: '42', other: 1 },
      fixed: [],
    });
    expect(snakeCase('contextLinks')).toBe('context_links');
    expect(camelCase('context_links')).toBe('contextLinks');
  });

  it('the SDK hook fixes name and JSON and reports what it fixed', async () => {
    const fixed: [string, string[]][] = [];
    const repair = createToolCallRepair((id, what) => fixed.push([id, what]));
    const tools = { vault_read: {} } as never;
    const out = await repair({
      toolCall: { type: 'tool-call', toolCallId: 'c1', toolName: 'Vault-Read', input: "{'x'" },
      tools,
    } as never);
    expect(out).toBeNull(); // single quotes: not repaired for sure
    const ok = await repair({
      toolCall: {
        type: 'tool-call',
        toolCallId: 'c2',
        toolName: 'Vault-Read',
        input: '{"path": "a",}',
      },
      tools,
    } as never);
    expect(ok).toMatchObject({ toolName: 'vault_read', input: '{"path": "a"}' });
    expect(fixed).toEqual([['c2', ['name', 'json']]]);
  });

  it('describes the arguments of a tool in one line', () => {
    expect(
      compactSchema({
        properties: { path: { type: 'string' }, kind: { enum: ['a', 'b'] } as never },
        required: ['path'],
      }),
    ).toBe('{ path: string, kind?: "a" | "b" }');
  });
});

describe('repeated calls (AG-16)', () => {
  it('stable JSON: the same arguments in another order are the same call', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      stableJson({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('gives the earlier result once more, then refuses; a write clears it', () => {
    const t = new CallTracker();
    expect(t.repeat('web_search', { q: 'x' })).toBeUndefined();
    t.remember('web_search', { q: 'x' }, { hits: 1 }, true);
    expect(t.repeat('web_search', { q: 'x' })).toEqual({ output: { hits: 1 } });
    expect(() => t.repeat('web_search', { q: 'x' })).toThrow(ToolError);
    t.remember('vault_write', { path: 'a' }, { ok: true }, false);
    expect(t.repeat('web_search', { q: 'x' })).toBeUndefined();
  });

  it('counts failures in a row: a reminder at three, another model at four, once each', () => {
    const t = new CallTracker();
    t.result(false);
    t.result(false);
    expect(t.streakAction()).toBeNull();
    t.result(false);
    expect(t.streakAction()).toEqual({ action: 'remind', count: 3 });
    expect(t.streakAction()).toBeNull();
    t.result(false);
    expect(t.streakAction()).toEqual({ action: 'demote', count: 4 });
    t.result(true);
    expect(t.errorStreak).toBe(0);
  });
});

describe('loop metrics of the eval (AG-09)', () => {
  let n = 0;
  const ev = (e: Partial<LogEvent> & Pick<LogEvent, 'type' | 'data'>): LogEvent => ({
    id: `e${String(++n).padStart(3, '0')}`,
    ts: 0,
    agent: 'titan',
    runId: 'r',
    parentId: null,
    ...e,
  });

  it('requests and tokens per agent, steps per delegation, repeats, invalid input, summaries, fallbacks', () => {
    const d1 = ev({
      type: 'delegation',
      data: { from: 'titan', to: 'rhea', goal: 'Cerca X', status: 'started' },
    });
    const events = [
      ev({
        type: 'provider_usage',
        data: {
          provider: 'f',
          model: 'm',
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 80,
        },
      }),
      d1,
      ev({
        type: 'provider_usage',
        agent: 'rhea',
        parentId: d1.id,
        data: { provider: 'f', model: 'm', inputTokens: 50, outputTokens: 5 },
      }),
      ev({
        type: 'provider_usage',
        agent: 'rhea',
        parentId: d1.id,
        data: { provider: 'f', model: 'm', inputTokens: 60, outputTokens: 6, costUsd: 0.01 },
      }),
      ev({
        type: 'tool_call',
        agent: 'rhea',
        parentId: d1.id,
        data: { callId: '1', tool: 'web_search', input: { q: 'x', n: 1 } },
      }),
      ev({
        type: 'tool_call',
        agent: 'rhea',
        parentId: d1.id,
        data: { callId: '2', tool: 'web_search', input: { n: 1, q: 'x' } },
      }),
      ev({
        type: 'tool_call',
        agent: 'rhea',
        parentId: d1.id,
        data: { callId: '3', tool: 'vault_write', input: {}, repaired: ['keys'] },
      }),
      ev({
        type: 'tool_result',
        agent: 'rhea',
        data: { callId: '3', tool: 'vault_write', ok: false, error: 'INVALID_INPUT: x' },
      }),
      ev({ type: 'error', agent: 'rhea', data: { code: 'provider_fallback', message: 'a → b' } }),
      ev({ type: 'error', agent: 'rhea', data: { code: 'max_steps', message: 'finiti' } }),
      ev({
        type: 'delegation',
        data: { from: 'titan', to: 'rhea', goal: 'Cerca X', status: 'completed', summary: '' },
      }),
      ev({
        type: 'delegation',
        data: { from: 'titan', to: 'rhea', goal: 'cerca x!', status: 'started' },
      }),
      ev({
        type: 'delegation',
        data: { from: 'titan', to: 'rhea', goal: 'cerca x!', status: 'completed', summary: '1234' },
      }),
    ];
    expect(loopMetrics(events)).toEqual({
      agents: {
        titan: {
          requests: 1,
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 80,
          costUsd: 0,
        },
        rhea: {
          requests: 2,
          inputTokens: 110,
          outputTokens: 11,
          cachedInputTokens: 0,
          costUsd: 0.01,
        },
      },
      stepsPerDelegation: [
        { to: 'rhea', steps: 2, tools: { web_search: 2, vault_write: 1 } },
        { to: 'rhea', steps: 0, tools: {} },
      ],
      paidSearches: { count: 0, costUsd: 0, engines: [] },
      repeatedCalls: 1,
      invalidInput: 1,
      repairedCalls: 1,
      emptySummaries: 1,
      avgSummaryChars: 4,
      repeatedDelegations: 1,
      fallbacks: 1,
      limitStops: 1,
    });
  });

  it('from saved metrics without events: only what their lists tell', () => {
    expect(
      loopFromStored({
        delegations: ['rhea: Cerca X', 'dione: Scrivi', 'rhea: cerca x'],
        errors: ['rhea: provider_fallback a → b', 'dione: max_steps Dione ha finito i 12 passi'],
      }),
    ).toMatchObject({
      agents: null,
      repeatedCalls: null,
      repeatedDelegations: 1,
      fallbacks: 1,
      limitStops: 1,
    });
  });
});

describe('the LLM of the gate has a time limit (AG-04)', () => {
  it('a model that never answers is given up: the gate then asks the user', async () => {
    const provider = new FakeProvider({
      models: { gate: [fake.text('{}', { gate: new Promise(() => {}) })] },
    });
    const port = new LlmDecisionPort({
      providers: new ProviderRegistry().register(provider),
      models: [{ provider: 'fake', model: 'gate' }],
      timeoutMs: 50,
    });
    const started = Date.now();
    const err = await port
      .decide({
        state: 'ask_user',
        questions: [{ id: 'q', type: 'noul', prompt: 'Serve chiedere?' }],
      })
      .catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(err).toBeInstanceOf(DecisionPortError);
  });
});
