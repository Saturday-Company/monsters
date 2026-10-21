import { fake } from '@monsters/providers/testing';
import {
  spendCapPath,
  type AutomationView,
  type DraftConfirmResponse,
  type LogEvent,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startTestHub, type TestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * Collaudo of block B from a clean clone (17/10): the defects found on a real
 * core with Haiku 5.5, each with the test that was red before the fix.
 */

const isType =
  <T extends LogEvent['type']>(
    type: T,
    extra: (e: Extract<LogEvent, { type: T }>) => boolean = () => true,
  ) =>
  (e: LogEvent): e is Extract<LogEvent, { type: T }> =>
    e.type === type && extra(e as Extract<LogEvent, { type: T }>);

async function ask(t: TestHub, text: string): Promise<string> {
  const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text });
  await t.runEnded(sent.runId);
  return sent.runId;
}

describe('project_propose: the participants may name the monster a copy comes from', () => {
  it('"Dione" in the first automation is the copy of Dione, and so is the lead copied from Rhea', async () => {
    // Haiku proposed a copy of Dione and named "Dione" among the participants:
    // refused three times ("non è tra i mostri del progetto"), then the
    // automation was left out of the draft.
    const t = await startTestHub({
      titan: [
        fake.toolCall('tools_search', { query: 'progetto' }),
        fake.toolCall('project_propose', {
          name: 'Social Saturday',
          goal: 'i post della settimana dopo, pronti ogni domenica sera',
          lead: { copy_of: 'Rhea' },
          monsters: [
            { copy_of: 'Dione' },
            { name: 'Lino', role: 'immagini dei post', mission: 'prepari le immagini dei post' },
          ],
          automations: [
            {
              name: 'Post della settimana',
              cron: '0 21 * * 0',
              timezone: 'Europe/Rome',
              objective: 'Prepara i post della settimana dopo, testi e immagini.',
              participants: ['Dione', 'lino', 'rhea'],
            },
          ],
        }),
        fake.text('Ti ho preparato la bozza.'),
      ],
    });
    const runId = await ask(t, 'apri un progetto per i social');
    const result = t
      .events(runId)
      .find(isType('tool_result', (e) => e.data.tool === 'project_propose'))!;
    expect(result.data.error).toBeUndefined();
    expect(result.data.ok).toBe(true);
    const draft = t.core.hub.team.project('social-saturday')!;
    const lead = draft.plan!.lead.name;
    const copy = draft.plan!.members.map((m) => ('copyOf' in m ? m.name : m.draft.name))[0]!;
    expect(copy).not.toBe('Dione');
    expect(lead).not.toBe('Rhea');
    expect(draft.plan!.automations[0]!.participants).toEqual([copy, 'Lino', lead]);

    const confirmed = await t.json<DraftConfirmResponse>(
      'POST',
      '/api/drafts/project/social-saturday/confirm',
    );
    expect(confirmed.kind).toBe('project');
    const autos = await t.json<AutomationView[]>('GET', '/api/automations');
    const ids = t.core.hub.team.members('social-saturday').map((a) => a.config.id);
    expect(autos[0]!.participants.every((p) => ids.includes(p))).toBe(true);
    expect(autos[0]!.participants).not.toContain('dione');
  });

  it('a monster copied twice is not an alias: its name stays ambiguous and is refused', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('tools_search', { query: 'progetto' }),
        fake.toolCall('project_propose', {
          name: 'Due Dione',
          goal: 'due copie della stessa scrittrice',
          monsters: [{ copy_of: 'Dione' }, { copy_of: 'Dione' }],
          automations: [
            {
              name: 'Giro',
              cron: '0 9 * * 1',
              objective: 'Scrivete le bozze della settimana.',
              participants: ['Dione'],
            },
          ],
        }),
        fake.text('Non è andata.'),
      ],
    });
    const runId = await ask(t, 'apri un progetto');
    const result = t
      .events(runId)
      .find(isType('tool_result', (e) => e.data.tool === 'project_propose'))!;
    expect(result.data.ok).toBe(false);
    expect(result.data.error).toMatch(/“Dione” isn’t one of the project’s monsters/);
  });
});

describe('the stop at the project’s cap says where to raise it', () => {
  it('"nella scheda Spesa del progetto", not "Impostazioni → Modelli"', async () => {
    inLang('it');
    const t = await startTestHub({ titan: [] }, { lang: 'it' });
    const project = await t.json<{ id: string; lead: string }>('POST', '/api/projects', {
      name: 'Saturday',
      lead: { name: 'Leda' },
      spend: { dailyEur: 0.5 },
    });
    t.core.log.append({
      agent: project.lead,
      type: 'provider_usage',
      data: { provider: 'fake', model: project.lead, costUsd: 1 },
    });
    const sent = await t.json<{ runId: string }>('POST', `/api/projects/${project.id}/messages`, {
      text: 'prepara i post',
    });
    await t.runEnded(sent.runId);
    const error = t
      .events(sent.runId)
      .find((e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'spend_cap');
    expect(error?.data.message).toMatch(/raggiunto il tetto di spesa del progetto Saturday/);
    expect(error?.data.message).toContain(spendCapPath('Saturday'));
    expect(error?.data.message).not.toContain(spendCapPath());
  });
});
