import { fake } from '@monsters/providers/testing';
import type { LogEvent, ToolContext } from '@monsters/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import { abortCause, type AgentRunResult } from '../src/agents/run-agent.ts';
import {
  CallerStoppedError,
  ClosingError,
  ControlScope,
  createCoreServices,
  HaltedError,
  KilledError,
  type CoreServices,
} from '../src/index.ts';
import type { DoneChecker } from '../src/team/instinct/done-check.ts';
import {
  askTeammateTool,
  delegateTool,
  type SubagentRunParams,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';
import { never, startTestHub } from './hub-helpers.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * Cancellation follows the caller, and nothing outlives the work it was for (review of 28/10,
 * P0-3): a delegation stops with the tool call that waits for it, a scope that ends stops the
 * work still going on under it, a delegation always ends in the log, and nothing new starts
 * once the core is closing.
 */

const posix = process.platform !== 'win32';
const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function services() {
  const s = createCoreServices({ home: tempHome(), killGraceMs: 100 });
  opened.push(s);
  return s;
}

const member = (id: string, name: string, kind = 'subagent') =>
  ({ config: { id, name, kind, role: name } }) as unknown as AgentDefinition;

const result = (r: Partial<AgentRunResult>): AgentRunResult => ({
  status: 'completed',
  text: '',
  finalText: '',
  steps: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
  model: null,
  missingTools: [],
  ...r,
});

/** A sub-agent that works until its scope stops, then reports the stop as the runners do. */
function untilStopped(seen: { scope?: ControlScope }) {
  return (p: SubagentRunParams): Promise<AgentRunResult> => {
    seen.scope = p.scope;
    return new Promise((resolve) => {
      p.scope.signal.addEventListener(
        'abort',
        () => {
          const cause = abortCause(p.scope.signal.reason);
          resolve(result({ status: 'aborted', steps: 1, ...(cause ? { stopCause: cause } : {}) }));
        },
        { once: true },
      );
    });
  };
}

function setup(
  runSubagent: (p: SubagentRunParams) => Promise<AgentRunResult>,
  extra: Partial<TeamToolsContext> = {},
) {
  const s = services();
  const run = s.runs.startRun({ agent: 'titan', goal: 'test' });
  const rhea = member('rhea', 'Rhea');
  const dione = member('dione', 'Dione');
  const all = [member('titan', 'Titan', 'orchestrator'), rhea, dione];
  const ctx = {
    run,
    self: all[0],
    team: {
      list: () => all,
      get: (n: string) => all.find((a) => a.config.name.toLowerCase() === n.toLowerCase()),
      instructionFields: () => Promise.resolve(undefined),
    },
    log: s.log,
    runSubagent,
    ...extra,
  } as unknown as TeamToolsContext;
  const caller = new AbortController();
  const tc = {
    agentId: 'titan',
    runId: run.id,
    signal: caller.signal,
    emit: () => {},
  } as unknown as ToolContext;
  const ended = () =>
    s.log
      .query({ runId: run.id, type: 'delegation', limit: 100 })
      .filter((e): e is LogEvent<'delegation'> => e.type === 'delegation')
      .filter((e) => e.data.status !== 'started');
  return { s, run, ctx, caller, tc, ended, rhea, dione };
}

describe('a delegation follows the call that waits for it', () => {
  it('the lead stops mid-call (a limit, a crash): the delegate stops, with its processes', async () => {
    inLang('en');
    const seen: { scope?: ControlScope } = {};
    let pid: number | undefined;
    let exited: Promise<void> | undefined;
    const { run, ctx, caller, tc, ended } = setup((p) => {
      if (posix) {
        const child = p.scope.spawn('sleep', ['60'], { stdio: 'ignore' });
        pid = child.pid;
        exited = new Promise((r) => child.once('exit', () => r()));
      }
      return untilStopped(seen)(p);
    });
    const report = delegateTool(ctx).execute({ agent: 'Rhea', goal: 'Find the moons' }, tc);
    await vi.waitFor(() => expect(seen.scope).toBeDefined());
    // As the harness's scope at its token limit: the call's signal stops, the run goes on.
    caller.abort(new KilledError('agent', 'token limit 1000'));
    await expect(report).rejects.toBeInstanceOf(KilledError);
    expect(run.aborted).toBe(false);
    expect(seen.scope!.signal.reason).toBeInstanceOf(CallerStoppedError);
    // Still a child of the run until then (F-1); nothing of it is left there now.
    expect(run.children()).toEqual([]);
    expect(run.countProcesses()).toBe(0);
    if (posix) {
      await exited;
      expect(pid).toBeDefined();
    }
    const [end] = ended();
    expect(end!.data).toMatchObject({
      status: 'aborted',
      error: 'The monster that asked Rhea for this stopped, so Rhea stopped too.',
    });
  });

  it('a caller already stopped when the delegate starts: it never works', async () => {
    const { ctx, caller, tc } = setup(() => Promise.reject(new Error('never called')));
    caller.abort(new KilledError('agent', 'stopped'));
    await expect(
      delegateTool(ctx).execute({ agent: 'Rhea', goal: 'Find the moons' }, tc),
    ).rejects.toBeInstanceOf(KilledError);
  });

  it('the kill switch keeps its own cause through the caller', () => {
    const caller = new AbortController();
    const scope = new ControlScope('agent', 'rhea:1', null, 100).follow(caller.signal);
    const kill = new KilledError('global', 'from the app');
    caller.abort(kill);
    expect(scope.signal.reason).toBe(kill);
    expect(abortCause(scope.signal.reason)).toBe('kill_switch');
  });

  it('ask_teammate: the asker stopped, the teammate stops too', async () => {
    inLang('en');
    const seen: { scope?: ControlScope } = {};
    const { ctx, caller, tc, ended, rhea, dione } = setup(untilStopped(seen));
    const tool = askTeammateTool({
      ...ctx,
      self: dione,
      members: () => [dione, rhea],
    });
    const answer = tool.execute({ agent: 'Rhea', question: 'Which sources?' }, tc);
    await vi.waitFor(() => expect(seen.scope).toBeDefined());
    caller.abort(new KilledError('agent', 'Dione stopped'));
    await expect(answer).rejects.toBeInstanceOf(KilledError);
    expect(seen.scope!.aborted).toBe(true);
    expect(ended()[0]!.data).toMatchObject({ from: 'dione', to: 'rhea', status: 'aborted' });
  });

  it('a follower that ended follows nobody', () => {
    const caller = new AbortController();
    const scope = new ControlScope('agent', 'rhea:1', null, 100).follow(caller.signal);
    scope.close();
    caller.abort();
    expect(scope.aborted).toBe(false);
  });
});

describe('a delegation always ends in the log', () => {
  it('stopped during the final check: logged as aborted before the stop goes on', async () => {
    inLang('en');
    let stop = () => {};
    const doneCheck = {
      enabled: true,
      check: (_input: unknown, c: { signal: AbortSignal }) => {
        stop();
        return Promise.reject(c.signal.reason as Error);
      },
    } as unknown as DoneChecker;
    const { ctx, caller, tc, ended } = setup(
      () => Promise.resolve(result({ status: 'completed', finalText: 'Three moons', steps: 2 })),
      { doneCheck },
    );
    stop = () => caller.abort(new KilledError('run', 'stopped from the app'));
    await expect(
      delegateTool(ctx).execute({ agent: 'Rhea', goal: 'Find the moons' }, tc),
    ).rejects.toBeInstanceOf(KilledError);
    const ends = ended();
    expect(ends).toHaveLength(1);
    expect(ends[0]!.data).toMatchObject({
      status: 'aborted',
      error: 'The user stopped Rhea.',
      steps: 2,
    });
  });
});

describe('a scope that ends never leaves work behind', () => {
  it('close() stops the children still working and their processes; closed ones stay as they are', async () => {
    const parent = new ControlScope('run', 'r1', null, 100);
    const working = parent.child('agent', 'rhea:1');
    const done = parent.child('agent', 'dione:1');
    done.close();
    const child = posix ? working.spawn('sleep', ['60'], { stdio: 'ignore' }) : undefined;
    const exited = child ? new Promise((r) => child.once('exit', r)) : Promise.resolve();
    parent.close();
    expect(working.aborted).toBe(true);
    expect(working.signal.reason).toBeInstanceOf(CallerStoppedError);
    expect(abortCause(working.signal.reason)).toBe('caller');
    expect(done.aborted).toBe(false);
    await parent.settled;
    await exited;
    expect(parent.countProcesses()).toBe(0);
  });

  it('a run that finishes stops what is still working under it: no orphan the kill switch misses', async () => {
    const s = services();
    const run = s.runs.startRun({ agent: 'titan', goal: 'test' });
    const delegate = run.child('agent', 'rhea:1');
    const stopped = new Promise((r) =>
      delegate.signal.addEventListener('abort', r, { once: true }),
    );
    run.finish('completed');
    await stopped;
    expect(delegate.signal.reason).toBeInstanceOf(CallerStoppedError);
    expect(s.runs.activeRuns()).toEqual([]);
    const end = s.log.query({ runId: run.id, type: 'run', limit: 10 }).at(-1)!;
    expect(end.data).toMatchObject({ status: 'completed' });
  });
});

describe('nothing new starts once the core is closing', () => {
  it('startRun and serviceScope refuse with a ClosingError, a HaltedError', async () => {
    const s = services();
    await s.runs.shutdown();
    expect(() => s.runs.startRun({ agent: 'titan' })).toThrow(ClosingError);
    expect(() => s.runs.startRun({ agent: 'titan' })).toThrow(HaltedError);
    expect(() => s.runs.serviceScope('mcp:x')).toThrow(ClosingError);
    try {
      s.runs.startRun({ agent: 'titan' });
    } catch (err) {
      expect((err as HaltedError).code).toBe('closing');
    }
  });

  it('a message sent while closing is kept and runs at the next start; a card answer is refused', async () => {
    inLang('en');
    const t = await startTestHub({ titan: [fake.text('never', { gate: never })] });
    const question = t.core.hub.questions.create({
      agent: 'titan',
      runId: 'r-asked',
      parentId: null,
      question: 'Which tone?',
      options: [],
      blocking: true,
    });
    await t.core.runs.shutdown();
    // A Telegram message arriving while the core closes: logged, no run started for it.
    const sent = t.core.hub.dispatcher.send({
      text: 'Find flights to Lisbon',
      channel: 'telegram',
    });
    expect(sent.queued).toBe(true);
    expect(t.core.runs.activeRuns()).toEqual([]);
    expect(t.events(sent.runId).map((e) => e.type)).toEqual(['message']);
    // A tap on a card: refused, the question stays open for the next start.
    expect(() => t.core.hub.answer(question.id, { text: 'warm' }, 'telegram')).toThrow(
      expect.objectContaining({ code: 'closing' }) as Error,
    );
    expect(t.core.hub.questions.get(question.id)?.status).toBe('open');
    await t.core.close();

    // The next start runs it, in the run it was logged in.
    const next = await startTestHub(
      { titan: [fake.text('Here are the flights.')] },
      { home: t.home },
    );
    const end = await next.runEnded(sent.runId);
    expect(end.data.status).toBe('completed');
    expect(
      next
        .events(sent.runId)
        .some((e) => e.type === 'message' && e.data.role === 'agent' && !e.data.partial),
    ).toBe(true);
  });
});
