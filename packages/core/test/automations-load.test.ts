import { fake } from '@monsters/providers/testing';
import type { AutomationView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startTestHub } from './hub-helpers.ts';

/*
 * M9 of the review of 18/10: an automation every 5 minutes leaves about
 * 100,000 giri a year in the log. The menu, Telegram and `automation_propose`
 * read the giri at every call, and a start reads them again: they must not
 * decode the whole log each time.
 */

const GIRI = 20_000;

describe('automations with a long history', () => {
  it('list, get and runs stay fast with tens of thousands of events; a restart too', async () => {
    const t = await startTestHub(
      { titan: [fake.text('ok')] },
      { hub: { automations: { timezone: () => 'Europe/Rome' } } },
    );
    const created = await t.json<AutomationView>('POST', '/api/automations', {
      name: 'Ogni cinque minuti',
      lead: 'titan',
      participants: [],
      // Never due during the test: the history is written by hand below.
      schedule: { cron: '0 3 29 2 *', timezone: 'Europe/Rome' },
      objective: 'Controlla la posta.',
    });
    const { log, db } = t.core;
    const base = Date.now() - GIRI * 300_000;
    db.transaction(() => {
      for (let i = 0; i < GIRI; i++) {
        const runId = `01J${String(i).padStart(23, '0')}`;
        const slot = base + i * 300_000;
        log.append({
          agent: 'titan',
          runId,
          type: 'automation_run_started',
          data: {
            automationId: created.id,
            name: created.name,
            giro: runId,
            trigger: 'schedule',
            slot,
          },
        });
        log.append({
          agent: 'titan',
          runId,
          type: 'automation_run_finished',
          data: {
            automationId: created.id,
            name: created.name,
            giro: runId,
            status: 'completed',
            steps: 1,
          },
        });
      }
    });
    const automations = t.core.hub.automations;
    // The first call may build the summary of the history once.
    expect(automations.list()[0]?.last?.state).toBe('completed');
    const started = performance.now();
    for (let i = 0; i < 30; i++) {
      automations.list();
      automations.get(created.id);
      expect(automations.runs(created.id, 20)).toHaveLength(20);
    }
    const ms = performance.now() - started;
    // 90 reads: well under a millisecond each once the history is in memory.
    expect(ms).toBeLessThan(500);

    // A restart reads the history once, not once per giro.
    const home = t.home;
    await t.core.close();
    const restartAt = performance.now();
    const again = await startTestHub(
      { titan: [fake.text('ok')] },
      { home, hub: { automations: { timezone: () => 'Europe/Rome' } } },
    );
    expect(again.core.hub.automations.runs(created.id, 5)).toHaveLength(5);
    expect(performance.now() - restartAt).toBeLessThan(4_000);
  }, 120_000);
});
