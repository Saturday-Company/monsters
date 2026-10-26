import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import { defineTool, ToolError, type LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  briefLanguageNote,
  buildSystemPrompt,
  createCoreServices,
  extractUrls,
  isAcknowledgement,
  mayBeAcknowledgement,
  normalizeUrl,
  parseAgentConfig,
  runAgent,
  SourceTracker,
  UNVERIFIED_LINKS_NOTE,
  type AgentConfigInput,
  type AgentDefinition,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function setup(
  models: Record<string, FakeScript>,
  extra: { windows?: { limit: number; windowMs: number }[]; pinServedModel?: boolean } = {},
) {
  const services = createCoreServices({ home: tempHome() });
  opened.push(services);
  const provider = new FakeProvider({ models, ...extra });
  const providers = new ProviderRegistry().register(provider);
  return { ...services, provider, providers };
}

function agent(overrides: Partial<AgentConfigInput> = {}): AgentDefinition {
  return {
    config: parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      role: 'ricerche online',
      color: '#4f8df7',
      models: [{ provider: 'fake', model: 'a' }],
      tools: ['lookup'],
      limits: { maxSteps: 5 },
      ...overrides,
    }),
    instructions: '# Rhea\n\nSei Rhea, la ricercatrice.',
  };
}

const MOONS: Record<string, string> = { rea: 'Rea: seconda luna di Saturno, 1527 km.' };

const lookup = defineTool({
  name: 'lookup',
  description: 'Looks up a moon of Saturn.',
  inputSchema: z.object({ q: z.string().min(1) }),
  readOnly: true,
  execute: ({ q }) => {
    const hit = MOONS[q.toLowerCase()];
    if (!hit) {
      return Promise.reject(
        new ToolError('NOT_FOUND', `no moon called "${q}"`, {
          hint: 'Use the Italian name, e.g. "rea".',
        }),
      );
    }
    return Promise.resolve({ text: hit });
  },
});

function events(log: CoreServices['log'], runId: string): LogEvent[] {
  return log.query({ runId, limit: 1000 });
}

/** Text of the tool results the model saw in a later call. */
function toolResultsSeen(prompt: unknown): string {
  return JSON.stringify(
    (prompt as { role: string; content: unknown }[]).filter((m) => m.role === 'tool'),
  );
}

describe('runAgent', () => {
  it('runs a tool call, feeds the result back and logs every step', async () => {
    const env = setup({
      a: [fake.toolCall('lookup', { q: 'rea' }, { id: 'c1' }), fake.text('Rea misura 1527 km.')],
    });
    const run = env.runs.startRun({ agent: 'rhea', goal: 'Quanto è grande Rea?' });
    const result = await runAgent({
      agent: agent(),
      task: 'Quanto è grande Rea?',
      tools: [lookup],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    run.finish();

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Rea misura 1527 km.',
      steps: 2,
      missingTools: [],
    });
    expect(result.usage).toEqual({ inputTokens: 24, outputTokens: 14 });
    expect(toolResultsSeen(env.provider.calls[1]!.options.prompt)).toContain('1527 km');

    const log = events(env.log, run.id);
    const types = log.map((e) => e.type);
    expect(types).toEqual([
      'run',
      'tool_call',
      'tool_result',
      'provider_usage',
      'message',
      'provider_usage',
      'message',
      'run',
    ]);
    const call = log.find((e) => e.type === 'tool_call')!;
    const res = log.find((e) => e.type === 'tool_result')!;
    expect(call.data).toEqual({ callId: 'c1', tool: 'lookup', input: { q: 'rea' } });
    expect(res.parentId).toBe(call.id);
    expect(res.data).toMatchObject({ ok: true, output: { text: MOONS.rea } });
    const messages = log.filter((e): e is LogEvent<'message'> => e.type === 'message');
    expect(messages.map((m) => m.data.partial)).toEqual([true, undefined]);
    expect(messages.at(-1)?.data.text).toBe('Rea misura 1527 km.');
  });

  it('returns a ToolError to the model, which corrects the call', async () => {
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: 'Rhea' }),
        fake.toolCall('lookup', { q: '' }),
        fake.toolCall('lookup', { q: 'rea' }),
        fake.text('Trovata: 1527 km.'),
      ],
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent(),
      task: 'Cerca Rhea',
      tools: [lookup],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });

    expect(result.status).toBe('completed');
    // The model saw code, message and hint of the failure.
    const seen = toolResultsSeen(env.provider.calls[1]!.options.prompt);
    expect(seen).toContain('NOT_FOUND');
    expect(seen).toContain('Use the Italian name');
    // Invalid input is a readable INVALID_INPUT too.
    expect(toolResultsSeen(env.provider.calls[2]!.options.prompt)).toContain('INVALID_INPUT');

    const results = events(env.log, run.id).filter(
      (e): e is LogEvent<'tool_result'> => e.type === 'tool_result',
    );
    expect(results.map((r) => r.data.ok)).toEqual([false, false, true]);
    expect(results[0]!.data.error).toMatch(/^NOT_FOUND/);
  });

  it('falls back to the next model on 429 and logs it', async () => {
    const env = setup({ a: [fake.rateLimited()], b: [fake.text('ok da b')] });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent({
        models: [
          { provider: 'fake', model: 'a' },
          { provider: 'fake', model: 'b' },
        ],
      }),
      task: 'ciao',
      tools: [],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result).toMatchObject({
      status: 'completed',
      text: 'ok da b',
      model: { provider: 'fake', model: 'b' },
    });
    const log = events(env.log, run.id);
    const fallback = log.find((e): e is LogEvent<'error'> => e.type === 'error');
    expect(fallback?.data).toMatchObject({ code: 'provider_fallback' });
    expect(fallback?.data.message).toContain('fake:a → fake:b');
    const usage = log.find((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage');
    expect(usage?.data).toMatchObject({ provider: 'fake', model: 'b', step: 0 });
  });

  it('pins the model picked by the router for the rest of the session', async () => {
    const env = setup(
      {
        router: [fake.toolCall('lookup', { q: 'rea' }, { servedModel: 'vendor/x' })],
        'vendor/x': [fake.text('fatto')],
      },
      { pinServedModel: true },
    );
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent({ models: [{ provider: 'fake', model: 'router' }] }),
      task: 'Rea?',
      tools: [lookup],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('completed');
    expect(env.provider.calls.map((c) => c.model)).toEqual(['router', 'vendor/x']);
    const usage = events(env.log, run.id).filter(
      (e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage',
    );
    expect(usage.map((u) => [u.data.model, u.data.requestedModel])).toEqual([
      ['vendor/x', 'router'],
      ['vendor/x', undefined],
    ]);
  });

  it('shares the rate budget between agents: the second request waits for the window', async () => {
    const env = setup(
      { a: [fake.text('uno'), fake.text('due')] },
      { windows: [{ limit: 1, windowMs: 200 }] },
    );
    const run = env.runs.startRun({ agent: 'rhea' });
    const common = {
      tools: [],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    };
    const t0 = Date.now();
    const [first, second] = await Promise.all([
      runAgent({ ...common, agent: agent(), task: 'uno' }),
      runAgent({ ...common, agent: agent({ id: 'dione', name: 'Dione' }), task: 'due' }),
    ]);
    expect([first.status, second.status]).toEqual(['completed', 'completed']);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(180);
    const queued = events(env.log, run.id)
      .filter((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage')
      .map((u) => u.data.queuedMs ?? 0);
    expect(queued.filter((q) => q > 0)).toHaveLength(1);
  });

  it('stops cleanly when the kill switch fires mid-stream', async () => {
    const long = 'Rea è la seconda luna più grande di Saturno. '.repeat(10);
    const env = setup({ a: [fake.text(long, { chunkSize: 5, delayMs: 15 }), fake.text('mai')] });
    const run = env.runs.startRun({ agent: 'rhea', goal: 'Racconta' });
    const seenPartial = new Promise<void>((resolve) => {
      const off = env.log.subscribe((e) => {
        if (e.type === 'message' && e.data.partial) {
          off();
          resolve();
        }
      });
    });
    const running = runAgent({
      agent: agent(),
      task: 'Racconta',
      tools: [lookup],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
      partialFlushMs: 20,
    });
    await seenPartial;
    await env.runs.kill({ by: 'ui', reason: 'test' });
    const result = await running;

    expect(result.status).toBe('aborted');
    expect(env.provider.calls).toHaveLength(1);
    const log = events(env.log, run.id);
    expect(log.some((e) => e.type === 'error' && e.data.code === 'aborted')).toBe(true);
    // Plain words, no gender for the agent's name, no internal "stopped (global)".
    const stop = log.find((e): e is LogEvent<'error'> => e.type === 'error');
    expect(stop?.data.message).toMatch(/^.+’s job stopped: test$/);
    expect(log.some((e) => e.type === 'run' && e.data.status === 'aborted')).toBe(true);
    // The partial text is closed by a final (empty) message marked as aborted.
    const messages = log.filter((e): e is LogEvent<'message'> => e.type === 'message');
    expect(messages.filter((m) => m.data.partial !== true).map((m) => m.data)).toEqual([
      { role: 'agent', text: '', status: 'aborted' },
    ]);
    expect(messages.at(-1)?.data.status).toBe('aborted');
    const partial = messages.map((m) => m.data.text).join('');
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(long.length);
    expect(env.log.query({ type: 'kill' })).toHaveLength(1);
  });

  it('closes the partial text with a failed final message when the stream breaks', async () => {
    const env = setup({
      // Every attempt breaks: the one retry of the step (D-064) as well.
      a: () => fake.text('Ecco i ', { breakWith: new Error('connection reset') }),
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent(),
      task: 'x',
      tools: [],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
      partialFlushMs: 5,
    });
    expect(result.status).toBe('failed');
    const messages = events(env.log, run.id).filter(
      (e): e is LogEvent<'message'> => e.type === 'message',
    );
    expect(messages.map((m) => m.data)).toEqual([
      { role: 'agent', text: 'Ecco i ', partial: true },
      { role: 'agent', text: '', status: 'failed' },
    ]);
  });

  it('keeps the last tool results whole and masks the older ones, read again with result_read', async () => {
    inLang('it');
    const page = (n: number) => `pagina ${n} `.repeat(800);
    const fetchPage = defineTool({
      name: 'lookup',
      description: 'Reads a long page.',
      inputSchema: z.object({ q: z.string() }),
      readOnly: true,
      execute: ({ q }) => Promise.resolve({ text: page(Number(q)) }),
    });
    const env = setup({
      a: [
        fake.toolCall('lookup', { q: '1' }),
        fake.toolCall('lookup', { q: '2' }),
        fake.toolCall('lookup', { q: '3' }),
        fake.toolCall('result_read', { ref: 'r1', offset: 0, length: 500 }),
        fake.text('Fatto.'),
      ],
    });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent({ limits: { maxSteps: 8 } }),
      task: 'leggi tre pagine',
      tools: [fetchPage],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
      contextLimits: { recentToolResultChars: 2 * page(1).length + 100 },
    });
    expect(result.status).toBe('completed');
    const third = toolResultsSeen(env.provider.calls[3]!.options.prompt);
    expect(third).toContain('tolto dal contesto');
    expect(third).toContain('result_read {\\"ref\\":\\"r1\\"}');
    // Over the budget the oldest go until half of it is free: pages 1 and 2, page 3 stays.
    expect(third).not.toContain(page(1).trim());
    expect(third).not.toContain(page(2).trim());
    expect(third).toContain(page(3).trim());
    expect(third.match(/tolto dal contesto/g)).toHaveLength(2);
    expect(third.length).toBeLessThan(page(1).length + 2000);
    // The agent read the first page again, a slice of it.
    const fourth = toolResultsSeen(env.provider.calls[4]!.options.prompt);
    expect(fourth).toContain('[Monsters] r1 (lookup): caratteri 0-500 di');
    // result_read is one of the agent's tools, as any other.
    const names = (env.provider.calls[0]!.options.tools ?? []).map((t) => t.name);
    expect(names).toEqual(['lookup', 'result_read']);
  });

  it('stops at the step limit', async () => {
    const env = setup({ a: () => fake.toolCall('lookup', { q: 'rea' }) });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent({ limits: { maxSteps: 2 } }),
      task: 'loop',
      tools: [lookup],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result).toMatchObject({ status: 'max_steps', steps: 2 });
    expect(env.provider.calls).toHaveLength(2);
  });

  it('tells the agent once when few of its steps are left (D-196)', async () => {
    inLang('en');
    const env = setup({ a: () => fake.toolCall('lookup', { q: 'rea' }) });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent({ limits: { maxSteps: 10 } }),
      task: 'loop',
      tools: [lookup],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('max_steps');
    const prompts = env.provider.calls.map((c) => JSON.stringify(c.options.prompt));
    expect(prompts).toHaveLength(10);
    // Steps 1-9 may use tools, the 10th is the report: told before the 8th, with 2 left.
    const note = '2 steps left of your 10 for this task';
    expect(prompts.map((p) => p.includes(note))).toEqual([
      ...Array<boolean>(7).fill(false),
      true,
      true,
      true,
    ]);
    expect(prompts[9]!.split(note)).toHaveLength(2);
    expect(prompts[9]).toContain('Last step: you have no more tools');
  });

  it('reports a failure when every model is unavailable', async () => {
    const env = setup({ a: [fake.httpError(503)] });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent(),
      task: 'x',
      tools: [],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no model available/);
    expect(
      events(env.log, run.id).some((e) => e.type === 'error' && e.data.code === 'agent_failed'),
    ).toBe(true);
  });

  it('only exposes the tools listed in agent.yaml', async () => {
    const env = setup({ a: [fake.text('ok')] });
    const run = env.runs.startRun({ agent: 'rhea' });
    const other = defineTool({
      name: 'secret',
      description: 'not for Rhea',
      inputSchema: z.object({}),
      execute: () => Promise.resolve('x'),
    });
    const result = await runAgent({
      agent: agent({ tools: ['lookup', 'vault_read'] }),
      task: 'x',
      tools: [lookup, other],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.missingTools).toEqual(['vault_read']);
    const offered = (env.provider.calls[0]!.options.tools ?? []).map((t) => t.name);
    expect(offered).toEqual(['lookup', 'result_read']);
  });
});

describe('answers of the turn (Phase 2 demo)', () => {
  const two = (extra: Partial<AgentConfigInput> = {}) =>
    agent({
      models: [
        { provider: 'fake', model: 'a' },
        { provider: 'fake', model: 'b' },
      ],
      ...extra,
    });
  const run = async (
    env: ReturnType<typeof setup>,
    def: AgentDefinition,
    task: string,
  ): Promise<{ result: Awaited<ReturnType<typeof runAgent>>; log: LogEvent[] }> => {
    const r = env.runs.startRun({ agent: 'rhea', goal: task });
    const result = await runAgent({
      agent: def,
      task,
      tools: [lookup],
      signal: r.signal,
      log: env.log,
      runId: r.id,
      providers: env.providers,
    });
    r.finish(result.status === 'failed' ? 'failed' : 'completed');
    return { result, log: events(env.log, r.id) };
  };
  const finals = (log: LogEvent[]) =>
    log.filter(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' && e.data.role === 'agent' && !e.data.partial,
    );
  const partials = (log: LogEvent[]) =>
    log
      .filter((e): e is LogEvent<'message'> => e.type === 'message' && e.data.partial === true)
      .map((e) => e.data.text)
      .join('');

  it('an empty answer is asked again, then of the next model: never a completed empty run', async () => {
    // OpenRouter closed the stream without a chunk twice after the tool result.
    const env = setup({
      a: [fake.toolCall('lookup', { q: 'rea' }), fake.empty(), fake.empty()],
      b: [fake.text('Rea misura 1527 km.')],
    });
    const { result, log } = await run(env, two(), 'Quanto è grande Rea?');
    expect(result).toMatchObject({ status: 'completed', text: 'Rea misura 1527 km.' });
    expect(env.provider.calls.map((c) => c.model)).toEqual(['a', 'a', 'a', 'b']);
    const fallbacks = log.filter(
      (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'provider_fallback',
    );
    expect(fallbacks.map((e) => e.data.message)).toEqual([
      expect.stringMatching(/^fake:a → fake:a \(empty answer\)/),
      expect.stringMatching(/^fake:a → fake:b \(empty answer\)/),
    ]);
    expect(finals(log).at(-1)?.data.text).toBe('Rea misura 1527 km.');
  });

  it('when every model answers empty the run fails with a clear message', async () => {
    const env = setup({ a: [fake.empty(), fake.empty()] });
    const { result, log } = await run(env, agent(), 'Quanto è grande Rea, la luna di Saturno?');
    expect(result.status).toBe('failed');
    expect(result.text).toBe('');
    expect(result.error).toMatch(/^Rhea didn’t give an answer: the model answered empty/);
    expect(log.find((e) => e.type === 'error' && e.data.code === 'agent_failed')).toBeDefined();
  });

  it('an answer that only repeats the task is retried, then the next model answers', async () => {
    const task = '@Rhea cerca e leggi con calma almeno cinque pagine sulla storia dei tortellini.';
    const env = setup({
      a: [
        // The demo: the request repeated as text before the tool calls, then as the answer.
        fake.toolCall('lookup', { q: 'rea' }, { text: `${task}\n` }),
        fake.text(task),
        fake.text(` ${task} `),
      ],
      b: [fake.text('I tortellini nascono a Bologna nel Medioevo.')],
    });
    const { result, log } = await run(env, two(), task);
    expect(result).toMatchObject({
      status: 'completed',
      text: 'I tortellini nascono a Bologna nel Medioevo.',
    });
    expect(env.provider.calls.map((c) => c.model)).toEqual(['a', 'a', 'a', 'b']);
    const retries = log.filter(
      (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'empty_answer',
    );
    expect(retries.map((e) => e.data.message)).toEqual([
      expect.stringMatching(/it only repeated the request\): trying again$/),
      expect.stringMatching(/trying the next model$/),
    ]);
    // The echo never reached the chat, not even as a draft.
    expect(partials(log)).not.toContain('tortellini.');
    expect(partials(log)).toContain('nascono a Bologna');
    // The retry resent the conversation without the echoed answer: it ends with the tool result.
    const retry = env.provider.calls[2]!.options.prompt;
    expect(retry.at(-1)?.role).toBe('tool');
  });

  it('with one model only, a repeated task ends the run as failed, not completed', async () => {
    const task = 'Scrivimi un riassunto lungo della storia della mortadella di Bologna.';
    const env = setup({ a: [fake.text(task), fake.text(task)] });
    const { result } = await run(env, agent(), task);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/only repeating the request, even on the new attempts/);
  });

  it('a short greeting answered with the same words is an answer, not an echo', async () => {
    const env = setup({ a: [fake.text('Ciao!')] });
    const { result } = await run(env, agent(), 'ciao');
    expect(result).toMatchObject({ status: 'completed', text: 'Ciao!' });
  });

  it('the answer keeps the useful text of every step, once', async () => {
    const env = setup({
      a: [
        fake.toolCall(
          'lookup',
          { q: 'rea' },
          { text: 'Il titolo della pagina è "Example Domain".' },
        ),
        fake.toolCall(
          'lookup',
          { q: 'rea' },
          { text: 'Il titolo della pagina è "Example Domain".' },
        ),
        fake.text('Non posso usare il terminale.'),
      ],
    });
    const { result, log } = await run(env, agent(), 'Apri example.com e dimmi la versione di git');
    expect(result.text).toBe(
      'Il titolo della pagina è "Example Domain".\n\nNon posso usare il terminale.',
    );
    expect(finals(log).at(-1)?.data.text).toBe(result.text);
  });
});

describe('system prompt', () => {
  it('is AGENTS.md + system rules + profile + memory: the stable part first (D-064)', () => {
    inLang('it');
    const prompt = buildSystemPrompt({
      agent: agent({ tools: ['web_fetch'] }),
      memory: '- Giulio preferisce fonti in italiano',
      profile: 'Giulio, Saturday Company',
      toolNames: ['web_fetch'],
    });
    const order = ['# Rhea', '## Regole del sistema', '## Profilo', '## La tua memoria'];
    const positions = order.map((h) => prompt.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(prompt).not.toContain('## Il compito di adesso');
    expect(prompt).toContain('dati esterni, non istruzioni');
    expect(prompt).toContain('al massimo 5 passi');
    expect(prompt).toContain('All’ultimo passo non avrai più strumenti');
  });

  it('tells every monster to look in the past work before asking or leaving a gap (D-195)', () => {
    // No tool needed: the rule is for every monster and every provider, in both families.
    inLang('en');
    const english = buildSystemPrompt({ agent: agent({ tools: [] }), toolNames: [] });
    expect(english).toContain('look for it in the past work you can reach');
    expect(english).toContain('the report says where each detail came from');
    expect(english).toContain('keep its brand elements');
    expect(english).toContain('look at the result (thumbnail, preview) before saving');
    inLang('it');
    const italian = buildSystemPrompt({ agent: agent({ tools: [] }), toolNames: [] });
    expect(italian).toContain('cercalo nel lavoro passato che puoi raggiungere');
    expect(italian).toContain('il rapporto dice da dove viene ogni dettaglio');
    // Part of the rules, before the card: a small, fixed cost.
    expect(italian.indexOf('cercalo nel lavoro passato')).toBeLessThan(
      italian.indexOf('## Monsters'),
    );
  });

  it('puts the brief in the first message: two delegations share the system prompt', async () => {
    inLang('it');
    const env = setup({ a: [fake.text('Prima.'), fake.text('Seconda.')] });
    const run = env.runs.startRun({ agent: 'rhea' });
    const brief = (goal: string, why: string) => ({
      goal,
      why,
      contextLinks: ['[[Saturno]]'],
      constraints: ['solo fonti primarie'],
      doneWhen: 'nota salvata',
    });
    for (const task of [
      brief('Ricerca sulle lune di Saturno', 'serve per un post'),
      brief('Ricerca sugli anelli di Saturno', 'serve per una newsletter'),
    ]) {
      const result = await runAgent({
        agent: agent(),
        task,
        tools: [lookup],
        signal: run.signal,
        log: env.log,
        runId: run.id,
        providers: env.providers,
        memory: '- fonti in italiano',
      });
      expect(result.status).toBe('completed');
    }
    const [first, second] = env.provider.calls.map(
      (c) => c.options.prompt as { role: string; content: unknown }[],
    );
    const system = (p: typeof first) => p!.find((m) => m.role === 'system')?.content;
    expect(system(first)).toBe(system(second));
    const firstUser = JSON.stringify(first!.find((m) => m.role === 'user')?.content);
    expect(firstUser).toContain('Ricerca sulle lune di Saturno');
    expect(firstUser).toContain('## Il compito di adesso');
    expect(firstUser).toContain('Note utili nel vault: [[Saturno]]');
    expect(firstUser).toContain('Finito quando: nota salvata');
    // The language of the notes, whatever the language of the brief (D-073).
    expect(firstUser).toContain(briefLanguageNote());
  });

  it('an answer that only repeats the goal of a brief is still an echo', async () => {
    const goal = 'Prepara tre idee di post sulla nuova crostata di stagione';
    const env = setup({ a: [fake.text(goal), fake.text(goal)] });
    const run = env.runs.startRun({ agent: 'rhea' });
    const result = await runAgent({
      agent: agent(),
      task: { goal, why: 'per Instagram', doneWhen: 'idee nel rapporto' },
      tools: [],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    expect(result.status).toBe('failed');
    expect(result.text).toBe('');
  });
});

describe('link check of agents with web tools (D-026)', () => {
  const webSearch = defineTool({
    name: 'web_search',
    description: 'Searches the web.',
    inputSchema: z.object({ query: z.string() }),
    readOnly: true,
    execute: () =>
      Promise.resolve({
        results: [{ title: 'Ribollita', url: 'https://it.wikipedia.org/wiki/Ribollita' }],
      }),
  });
  const written: string[] = [];
  const vaultWrite = defineTool({
    name: 'vault_write',
    description: 'Writes a note.',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: ({ path, content }) => {
      written.push(content);
      return Promise.resolve({ path: `${path}.md`, hash: 'h1' });
    },
  });
  const content =
    '# Ribollita\n\nFonti: [Wikipedia](https://www.it.wikipedia.org/wiki/Ribollita/#Storia), ' +
    '[Comune](https://www.comune.firenze.it/ribollita-storia), la brochure su https://lapo.example/menu.';

  async function write(tools: string[]) {
    const env = setup({
      a: [
        fake.toolCall('web_search', { query: 'ribollita' }),
        fake.toolCall('vault_write', { path: 'Risorse/Ricerche/Ribollita', content }),
        fake.text('Nota salvata.'),
      ],
    });
    const run = env.runs.startRun({ agent: 'rhea', goal: 'ribollita' });
    await runAgent({
      agent: agent({ tools, limits: { maxSteps: 5 } }),
      task: {
        goal: 'Cerca la storia della ribollita',
        why: 'Il menu è su https://lapo.example/menu',
      },
      tools: [webSearch, vaultWrite],
      signal: run.signal,
      log: env.log,
      runId: run.id,
      providers: env.providers,
    });
    run.finish();
    const result = events(env.log, run.id).find(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.data.tool === 'vault_write',
    );
    return { env, output: result?.data.output as Record<string, unknown> };
  }

  it('warns about links that no tool result of the run contains, without blocking', async () => {
    const { env, output } = await write(['web_search', 'vault_write']);
    // The note is written as it is: the check only warns.
    expect(written.at(-1)).toBe(content);
    expect(output).toMatchObject({
      path: 'Risorse/Ricerche/Ribollita.md',
      unverified_links: ['https://www.comune.firenze.it/ribollita-storia'],
      links_note: UNVERIFIED_LINKS_NOTE,
    });
    expect(toolResultsSeen(env.provider.calls[2]!.options.prompt)).toContain(
      'do not come from your searches',
    );
  });

  it('leaves the notes of agents without web tools alone', async () => {
    const { output } = await write(['vault_write']);
    expect(output).toEqual({ path: 'Risorse/Ricerche/Ribollita.md', hash: 'h1' });
  });

  it('compares pages, not spellings', () => {
    expect(normalizeUrl('https://www.Example.org/a%20b/#x')).toBe('example.org/a b');
    expect(normalizeUrl('http://example.org/a b.')).toBe('example.org/a b');
    expect(extractUrls('vedi [x](https://a.example/p_(q)) e https://b.example/r.')).toEqual([
      'https://a.example/p_(q',
      'https://b.example/r',
    ]);
    // Brackets and quotes of other scripts close an address (D-073, a note of the eval of 16/10).
    expect(
      extractUrls(
        'Fonti:【https://www.galbani.it/ricette/pappardelle-al-cinghiale】 «https://c.example/x» “https://d.example/y”。',
      ),
    ).toEqual([
      'https://www.galbani.it/ricette/pappardelle-al-cinghiale',
      'https://c.example/x',
      'https://d.example/y',
    ]);
    expect(normalizeUrl('https://www.osteriafiore.it/menu】')).toBe('osteriafiore.it/menu');
    const tracker = new SourceTracker('Brief: https://brief.example/x');
    tracker.add({ results: [{ url: 'https://seen.example/page' }] });
    const edit = {
      ops: [
        { str_replace: { old: 'https://old.example/gone', new: 'https://seen.example/page/' } },
        { append: { text: 'Altro: https://brief.example/x e https://made-up.example/y' } },
      ],
    };
    expect(tracker.unverified('vault_edit', edit)).toEqual(['https://made-up.example/y']);
    // Reported once.
    expect(tracker.unverified('vault_edit', edit)).toEqual([]);
  });

  it('remembers the titles of the pages it saw, for the links of the notes (M2.0)', () => {
    const tracker = new SourceTracker();
    tracker.add({
      results: [
        { title: 'Ribollita', url: 'https://it.wikipedia.org/wiki/Ribollita', snippet: '' },
      ],
    });
    tracker.add({ url: 'https://www.lapo.example/menu/', title: 'Menu - Trattoria da Lapo' });
    expect(tracker.titleOf('https://it.wikipedia.org/wiki/Ribollita')).toBe('Ribollita');
    expect(tracker.titleOf('https://lapo.example/menu')).toBe('Menu - Trattoria da Lapo');
    expect(tracker.titleOf('https://other.example/')).toBeUndefined();
  });

  it('gives the vault tools of a web agent the titles of its results', async () => {
    const seen: (string | undefined)[] = [];
    const titled = defineTool({
      name: 'vault_write',
      description: 'Writes a note.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: (_input, ctx) => {
        seen.push(ctx.linkTitle?.('https://it.wikipedia.org/wiki/Ribollita'));
        return Promise.resolve({ path: 'x.md', hash: 'h' });
      },
    });
    for (const tools of [[webSearch, titled], [titled]]) {
      const env = setup({
        a: [
          fake.toolCall(tools.length > 1 ? 'web_search' : 'vault_write', {
            query: 'ribollita',
            path: 'x',
            content: 'x',
          }),
          fake.toolCall('vault_write', { path: 'x', content: 'x' }),
          fake.text('ok'),
        ],
      });
      const run = env.runs.startRun({ agent: 'rhea', goal: 'ribollita' });
      await runAgent({
        agent: agent({ tools: tools.map((x) => x.name), limits: { maxSteps: 5 } }),
        task: { goal: 'Cerca la ribollita' },
        tools,
        signal: run.signal,
        log: env.log,
        runId: run.id,
        providers: env.providers,
      });
      run.finish();
    }
    // With web tools the title is known; without, the tool gets no lookup.
    expect(seen).toEqual(['Ribollita', undefined, undefined]);
  });
});

describe('the reply to a stop hook reminder (D-108)', () => {
  it('tells an acknowledgement from an answer', () => {
    for (const t of [
      'OK',
      'Ok.',
      'ok!',
      '**OK**',
      'Fatto.',
      'Va bene, grazie!',
      "D'accordo",
      '',
      '👍',
    ])
      expect(isAcknowledgement(t), t).toBe(true);
    for (const t of [
      'Ok, ecco la mail.',
      'Fatto: la nota è in Bozze.',
      'Rapporto rifatto con la fonte.',
      'No',
      'ok ok ok ok ok',
    ])
      expect(isAcknowledgement(t), t).toBe(false);
    // While streaming, a beginning that may still be an "OK" is held back.
    for (const t of ['O', 'Ok', 'Ok, fa', 'Va', '']) expect(mayBeAcknowledgement(t), t).toBe(true);
    for (const t of ['Ok, ecco', 'La mail', 'Fatto: la n']) {
      expect(mayBeAcknowledgement(t), t).toBe(false);
    }
  });

  it('a report rewritten after "finito davvero?" replaces the first one, an "OK" never', async () => {
    for (const [reply, expected] of [
      ['Rapporto rifatto con la fonte.', 'Rapporto rifatto con la fonte.'],
      ['OK', 'Rapporto senza fonte.'],
    ] as const) {
      const env = setup({ a: [fake.text('Rapporto senza fonte.'), fake.text(reply)] });
      const r = env.runs.startRun({ agent: 'rhea', goal: 'Cerca Rea' });
      const result = await runAgent({
        agent: agent(),
        task: 'Cerca Rea',
        tools: [lookup],
        signal: r.signal,
        log: env.log,
        runId: r.id,
        providers: env.providers,
        onFinalAnswer: () => ({ text: 'Manca la fonte.', textCounts: true }),
      });
      r.finish();
      expect(result).toMatchObject({ status: 'completed', text: expected, finalText: expected });
      const finals = events(env.log, r.id)
        .filter((e): e is LogEvent<'message'> => e.type === 'message' && e.data.role === 'agent')
        .filter((e) => !e.data.partial)
        .map((e) => e.data.text);
      expect(finals).toEqual([expected]);
    }
  });
});
