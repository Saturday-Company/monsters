import { fake } from '@monsters/providers/testing';
import type { LogEvent, ToolContext } from '@monsters/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import type { AgentRunResult } from '../src/agents/run-agent.ts';
import { createCoreServices, KilledError, type CoreServices } from '../src/index.ts';
import {
  DELEGATION_STOP_GRACE_MS,
  delegateTool,
  type SubagentRunParams,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';
import { tempHome } from './helpers.ts';
import { deferred, never, promptText, startTestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * Review of 28/10 (D-216), the engine: a message of the user is answered or still waits, and
 * every delegation that started ends with an event, whatever the timing of a failure or a Stop.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const s of opened.splice(0)) s.db.close();
});

type Sent = { runId: string; queued: boolean; messageId: string };

const runEvents = (t: { events: () => LogEvent[] }, agent: string) =>
  t.events().filter((e): e is LogEvent<'run'> => e.type === 'run' && e.agent === agent);

describe('a message written during a run (D-216)', () => {
  it('is not lost when the turn that read it fails: a run of its own answers it', async () => {
    const release = deferred();
    const t = await startTestHub({
      titan: [
        fake.toolCall('vault_list', {}, { gate: release.promise }),
        // The step that reads the second message fails: the turn fails.
        fake.httpError(500, 'boom'),
        fake.text('Sono tre note.'),
      ],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'Guarda le note' });
    const second = await t.json<Sent>('POST', '/api/messages', { text: 'e dimmi quante sono' });
    expect(second).toMatchObject({ runId: first.runId, queued: true });
    release.resolve();
    expect((await t.runEnded(first.runId)).data.status).toBe('failed');
    // The model had read it in the failed step: it still gets a turn that answers it.
    expect(promptText(t.provider.calls[1]!.options.prompt)).toContain('e dimmi quante sono');
    const started = await t.waitEvent(
      (e): e is LogEvent<'run'> =>
        e.type === 'run' &&
        e.agent === 'titan' &&
        e.runId !== first.runId &&
        e.data.status === 'started',
    );
    expect((await t.runEnded(started.runId!)).data.status).toBe('completed');
    expect(t.provider.calls).toHaveLength(3);
    // Its request is the message that waited (the failed job goes with it as notes, D-199).
    expect(promptText(t.provider.calls[2]!.options.prompt.at(-1))).toMatch(
      /^\{"role":"user","content":\[\{"type":"text","text":"e dimmi quante sono/,
    );
    expect(runEvents(t, 'titan').filter((e) => e.data.status === 'started')).toHaveLength(2);
  });
});

describe('a delegation always ends in the log, even when its delegate never returns (D-216)', () => {
  const member = (id: string, name: string, kind = 'subagent') =>
    ({ config: { id, name, kind, role: name } }) as unknown as AgentDefinition;

  /** A delegate that never returns, not even after its stop (a hung tool, a stream that ignores it). */
  function setup() {
    const s = createCoreServices({ home: tempHome(), killGraceMs: 100 });
    opened.push(s);
    const run = s.runs.startRun({ agent: 'titan', goal: 'test' });
    const all = [member('titan', 'Titan', 'orchestrator'), member('rhea', 'Rhea')];
    const seen: { params?: SubagentRunParams } = {};
    const ctx = {
      run,
      self: all[0],
      team: {
        list: () => all,
        get: (n: string) => all.find((a) => a.config.name.toLowerCase() === n.toLowerCase()),
        instructionFields: () => Promise.resolve(undefined),
      },
      log: s.log,
      runSubagent: (p: SubagentRunParams): Promise<AgentRunResult> => {
        seen.params = p;
        return never;
      },
    } as unknown as TeamToolsContext;
    const caller = new AbortController();
    const tc = {
      agentId: 'titan',
      runId: run.id,
      signal: caller.signal,
      emit: () => {},
    } as unknown as ToolContext;
    const ends = () =>
      s.log
        .query({ runId: run.id, type: 'delegation', limit: 100 })
        .filter((e): e is LogEvent<'delegation'> => e.type === 'delegation')
        .filter((e) => e.data.status !== 'started');
    return { run, ctx, caller, tc, ends, seen };
  }

  it('the user stops it: the delegation ends as stopped after the grace', async () => {
    inLang('en');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { ctx, caller, tc, ends, seen } = setup();
    let settled = false;
    const report = delegateTool(ctx)
      .execute({ agent: 'Rhea', goal: 'Find the moons' }, tc)
      .finally(() => {
        settled = true;
      });
    report.catch(() => {});
    await vi.waitFor(() => expect(seen.params).toBeDefined());
    caller.abort(new KilledError('run', 'stopped from the app'));
    await vi.advanceTimersByTimeAsync(DELEGATION_STOP_GRACE_MS - 100);
    expect(settled).toBe(false);
    expect(ends()).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    await expect(report).rejects.toBeInstanceOf(KilledError);
    const end = ends();
    expect(end).toHaveLength(1);
    expect(end[0]!.data).toMatchObject({ status: 'aborted', error: 'The user stopped Rhea.' });
  });

  it('the kill switch reaches the run, not the call: the same', async () => {
    inLang('en');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { run, ctx, tc, ends, seen } = setup();
    const report = delegateTool(ctx).execute({ agent: 'Rhea', goal: 'Find the moons' }, tc);
    report.catch(() => {});
    await vi.waitFor(() => expect(seen.params).toBeDefined());
    void run.abort(new KilledError('global', 'from the app'));
    await vi.advanceTimersByTimeAsync(DELEGATION_STOP_GRACE_MS + 100);
    await report.catch(() => {});
    expect(ends()).toHaveLength(1);
    expect(ends()[0]!.data).toMatchObject({ status: 'aborted' });
    expect(seen.params!.scope.aborted).toBe(true);
  });
});
