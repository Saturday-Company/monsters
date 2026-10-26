import {
  ProviderRegistry,
  RateBudget,
  type HarnessEvent,
  type HarnessProvider,
  type HarnessTask,
} from '@monsters/providers';
import { FakeProvider } from '@monsters/providers/testing';
import { autoChain, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import type { DecisionPort, SystemOneAnswer } from '../src/index.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * A short follow-up that continues the previous job (D-195), in the real core. The case of
 * 26/10: a hard job (Opus, high effort) stopped at its step cap after reading the theme of an
 * event and the designs of last week; "finisci pure" was tiered medium on its words alone and
 * started a new Claude Code session with only the conversation, so the facts were gone.
 */

type Sent = { runId: string };

const THEME = 'Tema 2026: «Spiriti del fumetto», manifesto di Castellini, viola e oro';

/**
 * A Claude harness: the first job reads a page, writes what it found and stops at its cap; every
 * later run answers. `sessions: false` never says its session (a harness that does not).
 */
function claudeHarness(opts: { sessions?: boolean; goneOnResume?: boolean } = {}) {
  const tasks: HarnessTask[] = [];
  const harness: HarnessProvider & { tasks: HarnessTask[] } = {
    id: 'claude-agent',
    kind: 'harness',
    auth: 'external-login',
    budget: new RateBudget({ id: 'claude-agent', windows: [], limitScope: 'account' }),
    tasks,
    listModels: () => Promise.resolve([]),
    // eslint-disable-next-line @typescript-eslint/require-await
    async *run(task): AsyncGenerator<HarnessEvent> {
      tasks.push(task);
      if (task.plain) {
        yield { type: 'done', reason: 'stop', text: 'Riassunto.' };
        return;
      }
      if (task.resume && opts.goneOnResume) {
        yield {
          type: 'done',
          reason: 'error',
          code: 'resume_not_found',
          error: 'Claude Code closed: No conversation found with session ID',
        };
        return;
      }
      const id = task.resume ?? `sess-${tasks.length}`;
      if (opts.sessions !== false) yield { type: 'session', id, model: task.model ?? 'sonnet' };
      if (tasks.filter((t) => !t.plain).length === 1) {
        yield {
          type: 'tool-call',
          id: 'call-1',
          name: 'Bash',
          input: { command: 'curl -sL https://lucca2026.example/it/home' },
        };
        yield { type: 'tool-result', id: 'call-1', output: THEME };
        yield {
          type: 'tool-call',
          id: 'call-2',
          name: 'WebSearch',
          input: { query: 'Lucca 2026' },
        };
        yield { type: 'tool-result', id: 'call-2', output: 'Japan Town, 29 ottobre - 2 novembre' };
        yield { type: 'usage', model: task.model ?? 'sonnet', inTok: 1000, outTok: 50 };
        yield { type: 'text', text: 'Ho letto il tema: ora applico tutto nel design Canva.' };
        yield { type: 'done', reason: 'max-steps' };
        return;
      }
      yield { type: 'usage', model: task.model ?? 'sonnet', inTok: 100, outTok: 10 };
      yield { type: 'done', reason: 'stop', text: `Finito (${task.model}).` };
    },
  };
  return harness;
}

/** Jev: the first request is hard, every other one medium (as "finisci pure" read alone). */
function jev(): DecisionPort {
  return {
    id: 'jev',
    decide: (request) => {
      const state = request.state as { richiesta?: unknown; request?: unknown };
      const raw = state.richiesta ?? state.request;
      const asked = typeof raw === 'string' ? raw : '';
      const answers: SystemOneAnswer[] = request.questions.map((q) => ({
        id: q.id,
        value:
          q.id === 'tier'
            ? /grafica/i.test(asked)
              ? 1.4
              : 0.6
            : q.type === 'choice'
              ? typeof q.options[0] === 'string'
                ? q.options[0]
                : q.options[0]!.label
              : q.id === 'done'
                ? 0.95
                : 0.1,
        confidence: 0.9,
      }));
      return Promise.resolve({ answers, model: 'jev-1.13.0' });
    },
  };
}

async function hubWith(harness: HarnessProvider) {
  const providers = new ProviderRegistry().register(new FakeProvider({ models: {} }));
  providers.register(harness);
  const t = await startTestHub(
    {},
    {
      hub: { providers, decisionPort: jev(), settings: { instinct: { engine: 'jev' } } },
    },
  );
  if (!providers.has(harness.id)) providers.register(harness);
  await t.json('PUT', '/api/agents/titan/models', {
    models: autoChain('medium'),
    auto: { base: 'medium' },
  });
  return t;
}

const tierOf = (events: LogEvent[]) =>
  events.find(
    (e): e is LogEvent<'instinct'> =>
      e.type === 'instinct' && e.data.action === 'tier' && e.parentId === null,
  );

async function hardJobThen(harness: HarnessProvider, followUp: string) {
  const t = await hubWith(harness);
  const first = await t.json<Sent>('POST', '/api/messages', {
    text: 'Fammi la grafica della settimana a tema Lucca Comics 2026',
  });
  await t.runEnded(first.runId);
  const second = await t.json<Sent>('POST', '/api/messages', { text: followUp });
  expect((await t.runEnded(second.runId)).data.status).toBe('completed');
  return { t, first, second };
}

const runs = (h: { tasks: HarnessTask[] }) => h.tasks.filter((x) => !x.plain);

describe('a follow-up that continues the previous job (D-195)', () => {
  it('"finisci pure" after a hard job cut at its cap: Opus at high effort, the same session, the request alone', async () => {
    const harness = claudeHarness();
    const { t, first, second } = await hardJobThen(harness, 'finisci pure');
    const [a, b] = runs(harness);
    expect(a!.model).toBe('opus');
    expect(b!.model).toBe('opus');
    expect(b!.effort).toBe('high');
    // The session of the first job, resumed: everything it read is still in its context.
    expect(b!.resume).toBe('sess-1');
    expect(b!.prompt.startsWith('finisci pure')).toBe(true);
    expect(b!.prompt).not.toContain('## Recent conversation');
    expect(b!.prompt).not.toContain('<previous_job');
    const tier = tierOf(t.events(second.runId))!;
    expect(tier.data.details).toMatchObject({
      level: 'hard',
      model: 'claude-agent:opus',
      effort: 'high',
      continues: first.runId,
    });
    expect(tier.data.message).toBe('Continues a hard job: Titan uses opus.');
    // The first job read a page: the run that continues it starts tainted.
    const end = await t.runEnded(second.runId);
    expect(end.data.tainted).toBe(true);
  });

  it('without the session (a restart, a harness that does not say it): the notes of the job go with the request', async () => {
    const harness = claudeHarness({ sessions: false });
    await hardJobThen(harness, 'vai avanti');
    const b = runs(harness)[1]!;
    expect(b.model).toBe('opus');
    expect(b.resume).toBeUndefined();
    // The conversation as before, and the steps of the job with what they found.
    expect(b.prompt).toContain('## Recent conversation');
    expect(b.prompt).toContain('<previous_job source=');
    expect(b.prompt).toContain('curl -sL https://lucca2026.example/it/home');
    expect(b.prompt).toContain('Spiriti del fumetto');
    expect(b.prompt).toContain('WebSearch {"query":"Lucca 2026"} → Japan Town');
    expect(b.prompt).toContain('Titan used all');
    expect(b.prompt.indexOf('## Current request')).toBeLessThan(b.prompt.indexOf('<previous_job'));
  });

  it('a session the harness no longer has: the same turn again without it, with the notes', async () => {
    const harness = claudeHarness({ goneOnResume: true });
    await hardJobThen(harness, 'ok procedi');
    const [, lost, again] = runs(harness);
    expect(lost!.resume).toBe('sess-1');
    expect(again!.resume).toBeUndefined();
    expect(again!.model).toBe('opus');
    expect(again!.prompt).toContain('## Recent conversation');
    expect(again!.prompt).toContain('Spiriti del fumetto');
  });

  it('a new request after the hard job has its own level and its own context', async () => {
    const harness = claudeHarness();
    const { t, second } = await hardJobThen(
      harness,
      'Scrivimi una mail a Marco per spostare la riunione di domani alle 15, con tono cordiale e breve',
    );
    const b = runs(harness)[1]!;
    expect(b.model).toBe('sonnet');
    expect(b.resume).toBeUndefined();
    expect(b.prompt).not.toContain('<previous_job');
    expect(tierOf(t.events(second.runId))!.data.details).not.toHaveProperty('continues');
  });

  it('"grazie" closes the job: no level of it, no session', async () => {
    const harness = claudeHarness();
    await hardJobThen(harness, 'grazie');
    const b = runs(harness)[1]!;
    expect(b.model).toBe('sonnet');
    expect(b.resume).toBeUndefined();
  });
});
