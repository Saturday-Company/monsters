import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProviderRegistry,
  RateBudget,
  type HarnessEvent,
  type HarnessProvider,
  type HarnessTask,
} from '@monsters/providers';
import { FakeProvider } from '@monsters/providers/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import { summaryHeader } from '../src/agents/run-agent.ts';
import { runHarnessAgent } from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';
import { startTestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * The conversation goes in the message of the turn, not in the appended system prompt (D-166):
 * that prompt is the same turn after turn, so the harness's prompt cache (Claude Code, Codex)
 * reads it instead of writing it again. The audit of 24/10 measured 8-17k cache writes on the
 * first request of every turn, because the "Recent conversation" at the end changed the text.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monsters-stable-prefix-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function recorder(id: 'claude-agent' | 'codex' = 'claude-agent'): HarnessProvider & {
  tasks: HarnessTask[];
} {
  const tasks: HarnessTask[] = [];
  return {
    id,
    kind: 'harness',
    auth: 'external-login',
    budget: new RateBudget({ id, windows: [], limitScope: 'account' }),
    tasks,
    listModels: () => Promise.resolve([]),
    async *run(task): AsyncGenerator<HarnessEvent> {
      await Promise.resolve();
      tasks.push(task);
      yield { type: 'text', text: 'fatto' };
      yield { type: 'done', reason: 'stop', text: 'fatto' };
    },
  };
}

async function turn(
  harness: HarnessProvider,
  task: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  summary?: string,
) {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db);
  const scope = new ControlScope('run', 'r1', null, 100);
  await runHarnessAgent({
    agent: {
      config: parseAgentConfig({
        id: 'rhea',
        name: 'Rhea',
        role: 'Ricerca',
        color: '#336699',
        models: [{ provider: harness.id, model: 'sonnet' }],
      }),
      instructions: 'You are Rhea.',
    },
    harness,
    task,
    tools: [],
    history,
    ...(summary ? { summary } : {}),
    signal: scope.signal,
    scope,
    log,
    runId: 'r1',
    sessions: new HarnessToolSessions(log),
    mcpUrl: () => 'http://127.0.0.1:1/api/harness/mcp',
    workspace: join(dir, 'ws'),
    scratchRoot: join(dir, 'scratch'),
    systemTools: false,
  });
}

const FIRST = [
  { role: 'user' as const, content: 'Find three articles on local-first software.' },
  { role: 'assistant' as const, content: 'Here they are: A, B and C.' },
];
const SECOND = [
  ...FIRST,
  { role: 'user' as const, content: 'Summarise the first one.' },
  { role: 'assistant' as const, content: 'A says data stays on your computer.' },
];

describe('the appended system prompt does not change with the conversation (D-166)', () => {
  it.each(['claude-agent', 'codex'] as const)(
    'is byte-identical across turns on %s, whatever the history and the summary',
    async (id) => {
      const harness = recorder(id);
      await turn(harness, 'Find three articles.', []);
      await turn(harness, 'Summarise the first one.', FIRST);
      await turn(harness, 'And the second?', SECOND, 'The user wants a reading list.');
      const [a, b, c] = harness.tasks.map((t) => t.instructions);
      expect(a).toBeTruthy();
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(a).not.toContain('Recent conversation');
      expect(a).not.toContain('Find three articles on local-first software.');
    },
  );

  it('puts the conversation in the message of the turn, before the new request', async () => {
    const harness = recorder();
    await turn(harness, 'And the second?', SECOND, 'The user wants a reading list.');
    const prompt = harness.tasks[0]!.prompt;
    const at = (text: string) => prompt.indexOf(text);
    expect(prompt.startsWith('## Recent conversation\n')).toBe(true);
    // The summary first, whole and as data inside its tag; then the turns; then the request.
    expect(prompt).toContain(
      `${summaryHeader()}\nThe user wants a reading list.\n</previous_summary>`,
    );
    expect(at('<previous_summary')).toBeLessThan(at('User: Find three articles'));
    expect(at('User: Find three articles')).toBeLessThan(at('You: A says data stays'));
    expect(at('You: A says data stays')).toBeLessThan(at('## Current request'));
    expect(prompt.endsWith('## Current request\nAnd the second?')).toBe(true);
  });

  it('a first turn has no conversation: the message is the request, as before', async () => {
    const harness = recorder();
    await turn(harness, 'Find three articles.', []);
    expect(harness.tasks[0]!.prompt).toBe('Find three articles.');
  });

  it('the Italian family keeps its header and labels, and adds its own request header', async () => {
    inLang('it');
    const harness = recorder();
    await turn(harness, 'E il secondo?', [
      { role: 'user', content: 'Trovami tre articoli.' },
      { role: 'assistant', content: 'Ecco: A, B e C.' },
    ]);
    expect(harness.tasks[0]!.prompt).toBe(
      '## Conversazione recente\nUtente: Trovami tre articoli.\nTu: Ecco: A, B e C.\n\n## Richiesta attuale\nE il secondo?',
    );
    expect(harness.tasks[0]!.instructions).not.toContain('Conversazione recente');
  });

  it('two turns of the same monster in the same chat share the system prompt (whole hub)', async () => {
    const harness = recorder();
    const providers = new ProviderRegistry().register(new FakeProvider({ models: {} }));
    providers.register(harness);
    const t = await startTestHub({}, { hub: { providers } });
    if (!providers.has(harness.id)) providers.register(harness);
    t.core.hub.team.setPolicy({ vault: true, web: true, shell: true, folders: [] });
    await t.core.hub.team.setModels('titan', [{ provider: 'claude-agent', model: 'sonnet' }]);
    const m1 = await t.json<{ runId: string }>('POST', '/api/messages', {
      to: 'titan',
      text: 'Can you find me three good articles?',
    });
    await t.runEnded(m1.runId);
    const m2 = await t.json<{ runId: string }>('POST', '/api/messages', {
      to: 'titan',
      text: 'Now summarise the first one.',
    });
    await t.runEnded(m2.runId);
    const m3 = await t.json<{ runId: string }>('POST', '/api/messages', {
      to: 'titan',
      text: 'And the second?',
    });
    await t.runEnded(m3.runId);
    expect(harness.tasks).toHaveLength(3);
    const [a, b, c] = harness.tasks;
    expect(b!.instructions).toBe(a!.instructions);
    expect(c!.instructions).toBe(a!.instructions);
    // The earlier turns are there, in the message.
    expect(c!.prompt).toContain('## Recent conversation');
    expect(c!.prompt).toContain('Can you find me three good articles?');
    expect(c!.prompt.endsWith('## Current request\nAnd the second?')).toBe(true);
  }, 60_000);
});
