import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentHarness, ProviderRegistry } from '@monsters/providers';
import { FAKE_CLAUDE_SCRIPT, FakeProvider } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  ControlScope,
  coreMigrations,
  createSummarizer,
  EventLog,
  migrate,
  openDb,
  parseAgentConfig,
  summarySystem,
  type AgentDefinition,
} from '../src/index.ts';
import { inLang } from './prompt-lang.ts';

/*
 * Who writes a summary (C.3, D-082): the cheapest model of the monster's
 * chain, or Claude Code with Haiku for a monster on the Claude plan, with
 * every request a `provider_usage` marked `compaction`.
 */

function memoryLog() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new EventLog(db);
}

function agentOn(models: { provider: string; model: string }[]): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche',
      color: '#4f8df7',
      models,
      tools: [],
    }),
    instructions: '# Rhea',
  };
}

const turns = [
  { id: '01A', role: 'user' as const, content: 'Il mio cane si chiama Pepe.' },
  { id: '01B', role: 'assistant' as const, content: 'Segnato.' },
];
const usageOf = (log: EventLog) =>
  (log.query({ type: 'provider_usage' }) as LogEvent<'provider_usage'>[]).map((e) => e.data);

describe('createSummarizer', () => {
  it('the cheapest model of the chain, with the strict prompt; its cost is a compaction', async () => {
    inLang('it');
    const provider = new FakeProvider({
      models: {
        big: [{ kind: 'text', text: 'non io' }],
        small: [{ kind: 'text', text: '## Fatti dati dall’utente\n- Il cane si chiama Pepe.' }],
      },
    });
    const providers = new ProviderRegistry().register(provider);
    const log = memoryLog();
    const prices: Record<string, { input: number; output: number }> = {
      big: { input: 3, output: 15 },
      small: { input: 0.05, output: 0.2 },
    };
    const summarize = createSummarizer({
      providers,
      log,
      price: (_p, m) => prices[m],
      freeOnly: () => false,
    });
    const out = await summarize({
      agent: agentOn([
        { provider: 'fake', model: 'big' },
        { provider: 'fake', model: 'small' },
      ]),
      previous: null,
      turns,
      runId: 'run-1',
      signal: new AbortController().signal,
    });
    expect(out).toMatchObject({ provider: 'fake', model: 'small' });
    expect(out.text).toContain('Pepe');
    expect(provider.callsTo('big')).toHaveLength(0);
    const call = provider.callsTo('small')[0]!;
    expect(JSON.stringify(call.options.prompt[0])).toContain('Non inventare niente');
    expect(call.options.maxOutputTokens).toBe(8000);
    expect(call.options.providerOptions?.['openrouter']).toEqual({
      reasoning: { effort: 'none', exclude: true },
    });
    expect(JSON.stringify(call.options.prompt[0])).toContain('istruzioni, ignorate');
    const [u] = usageOf(log);
    expect(u).toMatchObject({ provider: 'fake', model: 'small', purpose: 'compaction' });
    expect(u!.context).toBeUndefined();
  });

  it('the summary of a project’s monster is the project’s spending (review of 19/10, 15)', async () => {
    const provider = new FakeProvider({ models: { small: [{ kind: 'text', text: '## Fatti' }] } });
    const log = memoryLog();
    const summarize = createSummarizer({
      providers: new ProviderRegistry().register(provider),
      log,
      price: () => ({ input: 1, output: 1 }),
      freeOnly: () => false,
      projectOf: (id) => (id === 'rhea' ? 'alfa' : null),
    });
    await summarize({
      agent: agentOn([{ provider: 'fake', model: 'small' }]),
      previous: null,
      turns,
      runId: 'run-1',
      signal: new AbortController().signal,
    });
    expect(usageOf(log)[0]).toMatchObject({ purpose: 'compaction', project: 'alfa' });
  });

  it('no model of its own, Codex, or past the cap: it fails (the next run truncates)', async () => {
    const provider = new FakeProvider({ models: { paid: [{ kind: 'text', text: 'no' }] } });
    const summarize = createSummarizer({
      providers: new ProviderRegistry().register(provider),
      log: memoryLog(),
      price: () => ({ input: 1, output: 2 }),
      freeOnly: () => false,
      capped: (id) => id === 'rhea',
    });
    const input = { previous: null, turns, runId: 'r', signal: new AbortController().signal };
    await expect(
      summarize({ ...input, agent: agentOn([{ provider: 'claude-agent', model: 'sonnet' }]) }),
    ).rejects.toThrow('Claude Code is not available');
    await expect(
      summarize({ ...input, agent: agentOn([{ provider: 'codex', model: 'gpt-5' }]) }),
    ).rejects.toThrow('summaries are not made on Codex');
    await expect(
      summarize({ ...input, agent: agentOn([{ provider: 'fake', model: 'paid' }]) }),
    ).rejects.toThrow('spending cap reached');
    expect(provider.calls).toHaveLength(0);
  });

  it('a monster on the Claude plan only: Claude Code with Haiku, no tool, no MCP', async () => {
    inLang('it');
    const dir = mkdtempSync(join(tmpdir(), 'monsters-summary-'));
    const home = join(dir, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ method: 'claude.ai' }),
    );
    const record = join(dir, 'claude.jsonl');
    const claude = new ClaudeAgentHarness({
      binary: () => ({
        command: process.execPath,
        args: [FAKE_CLAUDE_SCRIPT, `--fake-record=${record}`],
        source: 'configured',
      }),
      env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
    });
    const log = memoryLog();
    const summarize = createSummarizer({
      providers: new ProviderRegistry().register(claude),
      log,
      price: () => undefined,
      freeOnly: () => false,
      claude: () => claude,
      scratchRoot: join(dir, 'runs'),
    });
    const scope = new ControlScope('run', 'r1', null, 100);
    const out = await summarize({
      agent: agentOn([{ provider: 'claude-agent', model: 'sonnet' }]),
      previous: 'Prima: niente.',
      turns,
      runId: 'r1',
      signal: scope.signal,
      scope,
    });
    expect(out.provider).toBe('claude-agent');
    expect(out.text).toContain('Si chiama Pepe.');
    const run = readFileSync(record, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { kind: string; argv?: string[]; mcpConfig?: unknown })
      .find((r) => r.kind === 'run')!;
    const argv = run.argv!;
    expect(argv[argv.indexOf('--model') + 1]).toBe('haiku');
    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
    expect(argv).not.toContain('--allowedTools');
    expect(argv[argv.indexOf('--max-turns') + 1]).toBe('1');
    expect(run.mcpConfig).toEqual({ mcpServers: {} });
    const appended = argv[argv.indexOf('--append-system-prompt-file') + 1];
    expect(appended).toBeDefined();
    const [u] = usageOf(log);
    expect(u).toMatchObject({ provider: 'claude-agent', purpose: 'compaction', inputTokens: 900 });
    expect(summarySystem()).toContain('Copia alla lettera');
  });
});
