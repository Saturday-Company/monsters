import type { LogEvent, ToolContext } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import type { AgentRunResult } from '../src/agents/run-agent.ts';
import { createCoreServices, KilledError, type CoreServices } from '../src/index.ts';
import {
  delegateTool,
  delegationStop,
  type SubagentRunParams,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * A delegation that did not complete says who or what stopped it and what was done (D-160):
 * never `{status: 'aborted', summary: ''}`, from which the lead made up "Rhea did not respond".
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

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

async function delegate(
  runSubagent: (p: SubagentRunParams) => Promise<AgentRunResult>,
): Promise<{ report: Record<string, unknown>; events: LogEvent[] }> {
  const s = createCoreServices({ home: tempHome() });
  opened.push(s);
  const run = s.runs.startRun({ agent: 'titan', goal: 'test' });
  const rhea = member('rhea', 'Rhea');
  const ctx = {
    run,
    self: member('titan', 'Titan', 'orchestrator'),
    team: {
      list: () => [member('titan', 'Titan'), rhea],
      get: (n: string) => (n.toLowerCase() === 'rhea' ? rhea : undefined),
      instructionFields: () => Promise.resolve(undefined),
    },
    log: s.log,
    runSubagent,
  } as unknown as TeamToolsContext;
  const tc = {
    agentId: 'titan',
    runId: run.id,
    signal: new AbortController().signal,
    emit: () => {},
  } as unknown as ToolContext;
  const report = (await delegateTool(ctx).execute(
    { agent: 'Rhea', goal: 'Cerca le lune di Saturno' },
    tc,
  )) as Record<string, unknown>;
  return { report, events: s.log.query({ runId: run.id, limit: 1000 }) };
}

const ended = (events: LogEvent[]) =>
  events.find(
    (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status !== 'started',
  )!;

describe('a delegation that stopped says why (D-160)', () => {
  it('stopped by the user: who, the steps done, no empty summary', async () => {
    inLang('en');
    const { report, events } = await delegate((p) => {
      void p.scope.abort(new KilledError('run', 'stopped from the app'));
      return Promise.resolve(result({ status: 'aborted', steps: 3, stopCause: 'user' }));
    });
    expect(report).toMatchObject({
      agent: 'Rhea',
      status: 'aborted',
      stopped_by: 'user',
      reason: 'The user stopped Rhea.',
      steps_done: 3,
      next: expect.stringContaining('never say the agent did not respond') as unknown,
    });
    expect(report).not.toHaveProperty('summary');
    expect(ended(events).data).toMatchObject({
      status: 'aborted',
      error: 'The user stopped Rhea.',
    });
  });

  it('the harness program stopped by itself, with what it wrote so far', async () => {
    inLang('it');
    const { report } = await delegate(() =>
      Promise.resolve(
        result({ status: 'aborted', stopCause: 'harness', steps: 2, finalText: 'Trovate 2 lune' }),
      ),
    );
    expect(report).toMatchObject({
      stopped_by: 'harness',
      partial: 'Trovate 2 lune',
      reason: expect.stringContaining('si è fermato da solo') as unknown,
    });
  });

  it('Monsters’ tools unreachable: a failure with that cause, not "did not respond"', async () => {
    inLang('en');
    const { report } = await delegate(() =>
      Promise.resolve(
        result({
          status: 'failed',
          stopCause: 'tools_unavailable',
          error: 'Rhea stopped: Claude Code could not reach Monsters’ tools',
        }),
      ),
    );
    expect(report).toMatchObject({
      status: 'failed',
      stopped_by: 'tools_unavailable',
      reason: expect.stringContaining('could not reach Monsters') as unknown,
    });
  });

  it('a token limit keeps the partial report and is not recorded as completed', async () => {
    inLang('en');
    const { report, events } = await delegate(() =>
      Promise.resolve(
        result({
          status: 'token_limit',
          steps: 7,
          finalText: 'Titano e Rea; mancano le altre',
          error: 'Rhea reached its token limit (1000)',
        }),
      ),
    );
    expect(report).toMatchObject({
      status: 'token_limit',
      stopped_by: 'token_limit',
      summary: 'Titano e Rea; mancano le altre',
      partial: true,
      steps_done: 7,
      reason: expect.stringContaining('token limit') as unknown,
      next: expect.stringContaining('partial') as unknown,
    });
    const end = ended(events).data;
    expect(end).toMatchObject({
      status: 'aborted',
      runStatus: 'token_limit',
      summary: 'Titano e Rea; mancano le altre',
    });
    expect(end.status).not.toBe('completed');
  });

  it('writes which cap stopped the agent on the delegation, for the UI to word it', async () => {
    inLang('en');
    const limit = { kind: 'steps', value: 400, plan: true } as const;
    const partial = await delegate(() =>
      Promise.resolve(result({ status: 'run_limit', finalText: 'A metà', limit })),
    );
    expect(ended(partial.events).data).toMatchObject({ runStatus: 'run_limit', limit });
    // Without a word: still a failed delegation, still with the cap.
    const empty = await delegate(() => Promise.resolve(result({ status: 'run_limit', limit })));
    expect(ended(empty.events).data).toMatchObject({
      status: 'failed',
      runStatus: 'run_limit',
      limit,
    });
    // A delegation that completed has none.
    const done = await delegate(() =>
      Promise.resolve(result({ status: 'completed', finalText: 'Fatto' })),
    );
    expect(ended(done.events).data).not.toHaveProperty('limit');
  });

  it('a completed delegation stays as it was', async () => {
    inLang('en');
    const { report, events } = await delegate(() =>
      Promise.resolve(result({ status: 'completed', finalText: 'Rapporto completo', steps: 2 })),
    );
    expect(report).toMatchObject({ status: 'completed', summary: 'Rapporto completo' });
    expect(report).not.toHaveProperty('stopped_by');
    expect(ended(events).data.status).toBe('completed');
  });

  it('maps the facts to a cause', () => {
    expect(delegationStop(result({ status: 'run_limit' }), undefined, false)).toBe('run_limit');
    expect(delegationStop(result({ status: 'max_steps' }), undefined, false)).toBe('max_steps');
    expect(delegationStop(undefined, undefined, true)).toBe('error');
    expect(delegationStop(result({ status: 'aborted' }), new KilledError('global'), false)).toBe(
      'kill_switch',
    );
    expect(
      delegationStop(result({ status: 'aborted' }), new KilledError('global', 'shutdown'), false),
    ).toBe('shutdown');
    expect(delegationStop(result({ status: 'aborted' }), undefined, false)).toBe('unknown');
  });
});
