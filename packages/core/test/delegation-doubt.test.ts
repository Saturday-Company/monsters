import type { LogEvent, ToolContext } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import type { AgentRunResult } from '../src/agents/run-agent.ts';
import { createCoreServices, type CoreServices } from '../src/index.ts';
import type { DoneCheckResult } from '../src/team/instinct/done-check.ts';
import {
  delegateTool,
  delegationDoubtNext,
  DELEGATION_INCOMPLETE_NEXT,
  DELEGATION_NEXT,
  unsureCriteria,
  type SubagentRunParams,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * A delegation the check is unsure of (the middle band) gives the person something to decide
 * on: the criteria it was unsure of, the notes delivered and the task go in the `doubt` event,
 * and the lead reads a specific `next` that tells it to verify before it replies.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

const member = (id: string, name: string, kind = 'subagent') =>
  ({ config: { id, name, kind, role: name } }) as unknown as AgentDefinition;

const finished: AgentRunResult = {
  status: 'completed',
  text: 'Fatto',
  finalText: 'Ho scritto la nota',
  steps: 2,
  usage: { inputTokens: 0, outputTokens: 0 },
  model: null,
  missingTools: [],
};

const unsure = 'Mirko può capire quale progetto presentare';

const doubtful: DoneCheckResult = {
  verdict: 'doubt',
  criteria: [
    { text: 'Notes saved', kind: 'notes', ok: true, by: 'rules' },
    { text: unsure, kind: 'done_when', ok: null, by: 'model', p: 0.5 },
    { text: 'In italiano', kind: 'constraint', ok: true, by: 'model', p: 0.9 },
  ],
  missing: [],
  byModel: true,
  doubt: `The check is not sure: «${unsure}»`,
};

async function delegate(check: DoneCheckResult): Promise<{
  report: Record<string, unknown>;
  events: LogEvent[];
}> {
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
    doneCheck: { enabled: true, check: () => Promise.resolve(check) },
    runSubagent: (p: SubagentRunParams) => {
      // The notes the member delivered, as the vault logs them under its tool calls.
      const call = s.log.append({
        agent: 'rhea',
        runId: run.id,
        parentId: p.parentId,
        type: 'tool_call',
        data: { callId: 'c1', tool: 'vault_write', input: {} },
      });
      for (const [action, path] of [
        ['create', 'Commerciale/Pitch.md'],
        ['edit', 'Commerciale/Elenco.md'],
      ] as const)
        s.log.append({
          agent: 'rhea',
          runId: run.id,
          parentId: call.id,
          type: 'vault_change',
          data: { action, path, commit: 'abc1234', actionId: `act_${action}` },
        });
      return Promise.resolve(finished);
    },
  } as unknown as TeamToolsContext;
  const tc = {
    agentId: 'titan',
    runId: run.id,
    signal: new AbortController().signal,
    emit: () => {},
  } as unknown as ToolContext;
  const report = (await delegateTool(ctx).execute(
    { agent: 'Rhea', goal: 'Prepara il pitch' },
    tc,
  )) as Record<string, unknown>;
  return { report, events: s.log.query({ runId: run.id, limit: 1000 }) };
}

describe('a delegation in doubt (middle band)', () => {
  it('the doubt event carries the unsure points, the notes delivered and the task', async () => {
    inLang('en');
    const { events } = await delegate(doubtful);
    const e = events.find((x): x is LogEvent<'instinct'> => x.type === 'instinct')!;
    expect(e.data).toMatchObject({ use: 'done_check', action: 'doubt', subject: 'rhea' });
    expect(e.data.details).toEqual({
      doubt: doubtful.doubt,
      points: [unsure],
      notes: ['Commerciale/Pitch.md', 'Commerciale/Elenco.md'],
      goal: 'Prepara il pitch',
    });
  });

  it('the lead is told to verify the notes itself, naming the unsure points', async () => {
    inLang('en');
    const { report } = await delegate(doubtful);
    expect(report['check_reason']).toBe(doubtful.doubt);
    expect(report['next']).toBe(delegationDoubtNext([unsure]));
    expect(report['next']).toContain(`"${unsure}"`);
    expect(report['next']).toMatch(/verify those points yourself/);
    expect(report['next']).not.toBe(DELEGATION_NEXT);
  });

  it('other verdicts keep their own next', async () => {
    inLang('en');
    const incomplete = await delegate({
      ...doubtful,
      verdict: 'incomplete',
      missing: ['nothing saved'],
    });
    expect(incomplete.report['next']).toBe(DELEGATION_INCOMPLETE_NEXT);
    const verified = await delegate({
      verdict: 'verified',
      criteria: [{ text: 'x', kind: 'done_when', ok: true, by: 'model', p: 0.9 }],
      missing: [],
      byModel: true,
    });
    expect(verified.report['next']).toBe(DELEGATION_NEXT);
  });

  it('only the criteria the model was unsure of count as points', () => {
    expect(unsureCriteria(doubtful)).toEqual([unsure]);
    expect(delegationDoubtNext([])).not.toContain('about:');
  });
});
