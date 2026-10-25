import { describe, expect, it } from 'vitest';
import { startTestHub } from './hub-helpers.ts';

/*
 * The state of a monster that has two jobs at once (D-157): a run ending clears the blocking
 * question of that run only (C-6).
 */

describe('waiting state per run (C-6)', () => {
  it('the end of one run keeps the other run’s open question', async () => {
    const t = await startTestHub({});
    const { log } = t.core;
    const { team } = t.core.hub;
    const run = (runId: string, status: 'started' | 'completed') =>
      log.append({ agent: 'rhea', runId, type: 'run', data: { status, goal: 'work' } });
    run('r1', 'started');
    run('r2', 'started');
    log.append({
      agent: 'rhea',
      runId: 'r1',
      type: 'question',
      data: { questionId: 'q1', question: 'Which one?', options: [], blocking: true },
    });
    expect(team.state('rhea').state).toBe('waiting');
    run('r2', 'completed');
    expect(team.state('rhea').state).toBe('waiting');
    run('r1', 'completed');
    expect(team.state('rhea').state).not.toBe('waiting');
    await t.core.close();
  });

  it('its own run ending still clears its question', async () => {
    const t = await startTestHub({});
    const { log } = t.core;
    const { team } = t.core.hub;
    log.append({ agent: 'rhea', runId: 'r1', type: 'run', data: { status: 'started' } });
    log.append({
      agent: 'rhea',
      runId: 'r1',
      type: 'question',
      data: { questionId: 'q1', question: 'Which one?', options: [], blocking: true },
    });
    log.append({ agent: 'rhea', runId: 'r1', type: 'run', data: { status: 'aborted' } });
    expect(team.state('rhea').state).toBe('stopped');
    await t.core.close();
  });
});
