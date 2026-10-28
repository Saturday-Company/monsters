import { ulid, type EventInput, type LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { giroOfRun } from '../src/store/giro-of-run.ts';

let clock = 1_760_000_000_000;
function ev<T extends EventInput>(input: T): LogEvent {
  clock += 1000;
  return {
    id: ulid(clock),
    ts: clock,
    agent: input.agent,
    runId: input.runId ?? null,
    parentId: input.parentId ?? null,
    type: input.type,
    data: input.data,
  } as LogEvent;
}

const started = (runId: string, giro: string) =>
  ev({
    agent: 'titan',
    runId,
    type: 'automation_run_started',
    data: { automationId: 'auto1', name: 'Report', giro, trigger: { kind: 'manual' } },
  } as unknown as EventInput);

describe('giroOfRun: where the question of an automation is answered', () => {
  it('maps every run of a giro, the ones that continue it too, to its automation and giro', () => {
    const log = [started('run1', 'run1'), started('run2', 'run1')];
    const map = giroOfRun(log);
    expect(map.get('run1')).toEqual({ automationId: 'auto1', giro: 'run1' });
    expect(map.get('run2')).toEqual({ automationId: 'auto1', giro: 'run1' });
    // A run of a chat is not a giro: its question is answered in the chat.
    expect(map.get('chat-run')).toBeUndefined();
  });

  it('follows the log as it grows without changing the map already handed out', () => {
    const first = [started('run1', 'run1')];
    const before = giroOfRun(first);
    const after = giroOfRun([...first, started('run3', 'run3')]);
    expect(after.get('run3')).toEqual({ automationId: 'auto1', giro: 'run3' });
    expect(before.has('run3')).toBe(false);
  });
});
