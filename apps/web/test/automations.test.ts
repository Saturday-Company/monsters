import { setAppLang, type AutomationView, type EventInput, type LogEvent } from '@monsters/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cronOfForm,
  formOfCron,
  groupBySquad,
  limitsText,
  nextRuns,
  personalSquad,
  runStateText,
  weekdayKeys,
  usageText,
  type ScheduleForm,
} from '../src/lib/automations.ts';
import { automationPath, routeOf } from '../src/lib/router.ts';
import { MockCore } from '../src/lib/mock/core.ts';
import { automationBusyText, automationWork, withoutAutomationRuns } from '../src/store/derive.ts';

const form = (patch: Partial<ScheduleForm>): ScheduleForm => ({
  preset: 'daily',
  time: '08:00',
  weekdays: [1],
  monthDay: 1,
  cron: '',
  ...patch,
});

describe('the schedule of the form', () => {
  it('turns the presets into cron rules', () => {
    expect(cronOfForm(form({ preset: 'daily', time: '23:05' }))).toBe('5 23 * * *');
    expect(cronOfForm(form({ preset: 'weekly', time: '23:00', weekdays: [0] }))).toBe('0 23 * * 0');
    expect(cronOfForm(form({ preset: 'weekly', time: '9:30', weekdays: [5, 1, 1] }))).toBe(
      '30 9 * * 1,5',
    );
    expect(cronOfForm(form({ preset: 'monthly', time: '07:00', monthDay: 1 }))).toBe('0 7 1 * *');
    expect(cronOfForm(form({ preset: 'advanced', cron: ' 0 9 1 * * ' }))).toBe('0 9 1 * *');
  });

  it('refuses what is missing', () => {
    expect(cronOfForm(form({ preset: 'weekly', weekdays: [] }))).toBeNull();
    expect(cronOfForm(form({ time: '25:00' }))).toBeNull();
    expect(cronOfForm(form({ time: '' }))).toBeNull();
    expect(cronOfForm(form({ preset: 'advanced', cron: '  ' }))).toBeNull();
  });

  it('reads a rule back into its preset, else "Avanzato"', () => {
    expect(formOfCron('0 23 * * 0')).toMatchObject({
      preset: 'weekly',
      time: '23:00',
      weekdays: [0],
    });
    expect(formOfCron('0 23 * * 7')).toMatchObject({ preset: 'weekly', weekdays: [0] });
    expect(formOfCron('30 8 * * *')).toMatchObject({ preset: 'daily', time: '08:30' });
    expect(formOfCron('0 9 15 * *')).toMatchObject({ preset: 'monthly', monthDay: 15 });
    expect(formOfCron('*/15 * * * *')).toMatchObject({ preset: 'advanced', cron: '*/15 * * * *' });
    expect(formOfCron('0 9 * * 1-5')).toMatchObject({ preset: 'advanced' });
    for (const cron of ['0 23 * * 0', '30 8 * * *', '0 9 15 * *', '0 18 * * 1,5']) {
      expect(cronOfForm(formOfCron(cron))).toBe(cron);
    }
  });

  it('computes the next giri in the zone, as the core does (croner)', () => {
    // Saturday 17 October 2026, 12:00 in Rome.
    const from = Date.UTC(2026, 9, 17, 10, 0);
    const next = nextRuns('0 23 * * 0', 'Europe/Rome', 3, from)!;
    expect(next).toHaveLength(3);
    // Sunday 18 at 23:00 in Rome is 21:00 UTC (summer time); on the 25th it is winter time.
    expect(new Date(next[0]!).toISOString()).toBe('2026-10-18T21:00:00.000Z');
    expect(new Date(next[1]!).toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(nextRuns('0 23 * *', 'Europe/Rome')).toBeNull();
    expect(nextRuns('0 23 * * 0', 'Marte/Olympus')).toBeNull();
    expect(nextRuns('99 23 * * 0', 'Europe/Rome')).toBeNull();
  });
});

describe('what the menu says', () => {
  it('names the states of a run', () => {
    expect(runStateText('completed')).toBe('Done');
    expect(runStateText('running')).toBe('Running');
    expect(runStateText('waiting_user')).toBe('Waiting for an answer');
    expect(runStateText('skipped')).toBe('Skipped');
    expect(runStateText('failed')).toBe('Failed');
  });

  it('says what a run used', () => {
    expect(usageText({ steps: 4, tokens: 16480, costUsd: 0 })).toBe(
      '4 steps · 16,480 tokens · free',
    );
    expect(usageText({ steps: 1, tokens: 900, costUsd: 0.042 })).toBe(
      '1 step · 900 tokens · $0.042',
    );
    expect(usageText({ steps: 1, tokens: 900, costUsd: 0.042 }, false)).toBe('1 step · $0.042');
    expect(usageText({ steps: 0, tokens: 0, costUsd: 0 })).toBeNull();
    expect(limitsText({})).toBeNull();
    expect(limitsText({ maxSteps: 60, maxEur: 2 })).toBe('up to 60 steps · €2 per run');
  });

  it('starts the week on Monday', () => {
    expect(weekdayKeys().map((d) => d.short)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  describe('in Italian', () => {
    beforeAll(() => setAppLang('it'));
    afterAll(() => setAppLang('en'));

    it('names the states of a giro', () => {
      expect(runStateText('completed')).toBe('Fatto');
      expect(runStateText('running')).toBe('In corso');
      expect(runStateText('waiting_user')).toBe('Aspetta una risposta');
      expect(runStateText('skipped')).toBe('Saltato');
      expect(runStateText('failed')).toBe('Errore');
    });

    it('says what a giro used', () => {
      expect(usageText({ steps: 4, tokens: 16480, costUsd: 0 })).toBe(
        '4 passi · 16.480 token · gratis',
      );
      expect(usageText({ steps: 1, tokens: 900, costUsd: 0.042 })).toBe(
        '1 passo · 900 token · 0,042 $',
      );
      expect(limitsText({ maxSteps: 60, maxEur: 2 })).toBe('al massimo 60 passi · 2 € a giro');
      expect(weekdayKeys()[0]).toMatchObject({ day: 1, short: 'Lun', long: 'lunedì' });
    });

    it('calls the squad of no project personal', () => {
      expect(personalSquad()).toBe('Squadra personale');
    });
  });

  it('groups by squad: the personal one first, drafts first inside a group', () => {
    const a = (id: string, extra: Partial<AutomationView> = {}) =>
      ({ id, name: id, status: 'active', ...extra }) as AutomationView;
    const groups = groupBySquad([
      a('zeta'),
      a('alfa', { project: 'saturday' }),
      a('beta', { status: 'draft' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([personalSquad(), 'saturday']);
    expect(personalSquad()).toBe('Personal squad');
    expect(groups[0]!.items.map((x) => x.id)).toEqual(['beta', 'zeta']);
  });

  it('has a route of its own', () => {
    expect(routeOf('#/automazioni')).toBe('automations');
    expect(routeOf(automationPath('post', { giro: 'r1' }))).toBe('automations');
    expect(automationPath('post', { giro: 'r1' })).toBe('#/automazioni?automazione=post&giro=r1');
    expect(automationPath(null, { mode: 'nuova' })).toBe('#/automazioni?vista=nuova');
  });
});

describe('the giri in the event stream', () => {
  let n = 0;
  const ev = (input: EventInput): LogEvent =>
    ({
      id: `01J00000000000000000000${String(n++).padStart(3, '0')}`,
      ts: n,
      runId: input.runId ?? null,
      parentId: input.parentId ?? null,
      agent: input.agent,
      type: input.type,
      data: input.data,
    }) as LogEvent;
  const started = ev({
    agent: 'titan',
    runId: 'g1',
    type: 'automation_run_started',
    data: { automationId: 'post', name: 'Post', giro: 'g1', trigger: 'schedule' },
  });
  const objective = ev({
    agent: 'user',
    runId: 'g1',
    type: 'message',
    data: { role: 'user', text: 'Fai i post', to: 'titan', channel: 'automation' },
  });
  const chat = ev({
    agent: 'user',
    runId: 'r2',
    type: 'message',
    data: { role: 'user', text: 'Ciao', to: 'titan' },
  });

  it('knows who is busy with a giro until it ends', () => {
    const work = automationWork([started, objective, chat]);
    expect([...work.runs]).toEqual(['g1']);
    expect(work.busy.get('titan')).toMatchObject({
      automationId: 'post',
      name: 'Post',
      giro: 'g1',
    });
    const finished = ev({
      agent: 'titan',
      runId: 'g1',
      type: 'automation_run_finished',
      data: { automationId: 'post', name: 'Post', giro: 'g1', status: 'waiting_user' },
    });
    const after = automationWork([started, objective, finished]);
    expect(after.busy.size).toBe(0);
    expect(after.waiting).toBe(1);
    const stopped = ev({ agent: 'titan', runId: 'g1', type: 'run', data: { status: 'aborted' } });
    expect(automationWork([started, stopped]).busy.size).toBe(0);
    expect(automationBusyText('Post')).toBe(
      'Sta facendo l’automazione «Post»: il tuo messaggio parte appena finisce',
    );
  });

  it('keeps the giri out of the chats', () => {
    const work = automationWork([started, objective, chat]);
    expect(withoutAutomationRuns([started, objective, chat], work.runs)).toEqual([chat]);
  });
});

describe('the automations of the mock core', () => {
  const call = (core: MockCore, method: string, path: string, body?: unknown) =>
    core.handle(method, path, body);

  it('has Giulio’s example with two Sundays done', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const list = call(core, 'GET', '/api/automations').body as AutomationView[];
    expect(list).toHaveLength(1);
    const a = list[0]!;
    expect(a).toMatchObject({
      id: 'post-della-settimana',
      lead: 'iapetus',
      project: 'social-di-saturday',
      participants: ['calypso', 'pandora'],
      scheduleText: 'ogni domenica alle 23:00',
      status: 'active',
    });
    expect(a.last?.state).toBe('completed');
    const runs = call(core, 'GET', '/api/automations/post-della-settimana/runs').body as {
      id: string;
    }[];
    expect(runs).toHaveLength(2);
    const giro = call(core, 'GET', `/api/automations/post-della-settimana/runs/${runs[0]!.id}`)
      .body as { messages: unknown[]; notes: string[]; finalAnswer?: string };
    expect(giro.notes).toHaveLength(1);
    expect(giro.finalAnswer).toMatch(/^Fatto: i post della settimana/);
  });

  it('refuses "Esegui ora" while stopped, a bad rule, an unknown monster', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    call(core, 'POST', '/api/kill', {});
    expect(call(core, 'POST', '/api/automations/post-della-settimana/run').status).toBe(409);
    const bad = call(core, 'POST', '/api/automations', {
      name: 'X',
      lead: 'titan',
      schedule: { cron: '99 * * * *' },
      objective: 'x',
    });
    expect(bad).toMatchObject({ status: 400, body: { error: 'invalid_schedule' } });
    const nobody = call(core, 'POST', '/api/automations', {
      name: 'X',
      lead: 'nessuno',
      schedule: { cron: '0 9 * * *' },
      objective: 'x',
    });
    expect(nobody).toMatchObject({ status: 400, body: { error: 'unknown_agent' } });
  });

  it('lists a monster’s draft in /api/drafts and confirms it there (D-098)', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const id = core.automations.propose({ name: 'Riassunto', lead: 'enceladus' });
    const drafts = call(core, 'GET', '/api/drafts').body as { kind: string; id: string }[];
    // The demo already has the orchestrator's project draft (D-100) and two proposals for the
    // instructions (D-113); made in the same millisecond on a fast machine, so the order between
    // the first two is not checked here.
    expect(drafts.filter((d) => d.kind !== 'docs')).toHaveLength(2);
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'automation', id, from: 'enceladus' }),
        expect.objectContaining({ kind: 'project', id: 'sito-di-saturday' }),
      ]),
    );
    expect(call(core, 'POST', `/api/automations/${id}/run`)).toMatchObject({ status: 409 });
    expect(call(core, 'POST', `/api/drafts/automation/${id}/confirm`).status).toBe(200);
    expect(call(core, 'GET', `/api/automations/${id}`).body).toMatchObject({ status: 'active' });
    expect(call(core, 'POST', `/api/drafts/automation/${id}/discard`)).toMatchObject({
      status: 409,
      body: { error: 'draft_closed' },
    });
    expect(
      (call(core, 'GET', '/api/drafts').body as { kind: string }[]).map((d) => d.kind),
    ).toEqual(['project', 'docs', 'docs']);
  });
});
