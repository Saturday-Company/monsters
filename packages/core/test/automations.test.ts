import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fake, type FakeCall, type FakeStep } from '@monsters/providers/testing';
import type {
  Automation,
  AutomationRunDetail,
  AutomationRunSummary,
  AutomationView,
  LogEvent,
  Question,
} from '@monsters/shared';
import { describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import {
  AutomationStore,
  createCoreServices,
  LOCK_FILE,
  EventLog,
  migrate,
  missedSlot,
  openDb,
  nextSlot,
  previousSlot,
  QuestionStore,
  recentConversation,
  runBudget,
  teamMigrations,
  type SchedulerClock,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { deferred, never, promptText, startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * Automations (D-094): the schedule (time zones, DST, missed slots), the
 * files, and the giri in a real core with a fake provider and a fake clock:
 * own run, never inside the user's work, out of the chat, kill switch,
 * questions that park the giro.
 */

const ROME = { cron: '0 23 * * 0', timezone: 'Europe/Rome' };
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A clock whose time moves only with `advance`, running the timers that fall due. */
function fakeClock(start: number) {
  let now = start;
  let seq = 0;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  const clock: SchedulerClock = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  return {
    clock,
    get now() {
      return now;
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = Math.max(now, t.at);
        t.fn();
      }
      now = end;
    },
  };
}

const isType =
  <T extends LogEvent['type']>(
    type: T,
    extra: (e: Extract<LogEvent, { type: T }>) => boolean = () => true,
  ) =>
  (e: LogEvent): e is Extract<LogEvent, { type: T }> =>
    e.type === type && extra(e as Extract<LogEvent, { type: T }>);

const isAutomationPrompt = (call: FakeCall) =>
  promptText(call.options.prompt).includes('[Automazione');

/** Waits until nothing runs in the dispatcher (a run's end is async). */
async function settled(t: TestHub): Promise<void> {
  await t.core.hub.dispatcher.idle();
  await new Promise((r) => setTimeout(r, 10));
}

const draft = (over: Record<string, unknown> = {}) => ({
  name: 'Post della settimana',
  lead: 'titan',
  participants: ['rhea', 'dione'],
  schedule: ROME,
  objective: 'Prepara i post della pagina di Saturday per la settimana dopo.',
  resultsFolder: 'Social/Settimana',
  ...over,
});

describe('schedule', () => {
  it('computes the next slot in the time zone, across DST', () => {
    // Saturday 17/10/2026 → Sunday 18/10 at 23:00 in Rome (CEST, UTC+2).
    const sat = Date.parse('2026-10-17T10:00:00Z');
    expect(new Date(nextSlot(ROME, sat)!).toISOString()).toBe('2026-10-18T21:00:00.000Z');
    // After the clocks go back (25/10): 23:00 is UTC+1.
    const after = Date.parse('2026-10-19T00:00:00Z');
    expect(new Date(nextSlot(ROME, after)!).toISOString()).toBe('2026-10-25T22:00:00.000Z');
    // The same expression in New York.
    const ny = { cron: '0 8 * * *', timezone: 'America/New_York' };
    expect(new Date(nextSlot(ny, sat)!).toISOString()).toBe('2026-10-17T12:00:00.000Z');
    // A slot in the hour that does not exist (29/03/2026, 2:00→3:00) runs at the first valid time.
    const night = { cron: '30 2 * * *', timezone: 'Europe/Rome' };
    const spring = nextSlot(night, Date.parse('2026-03-28T12:00:00Z'))!;
    expect(new Date(spring).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // A slot in the hour that repeats (25/10/2026) runs once.
    const autumn = nextSlot(night, Date.parse('2026-10-24T12:00:00Z'))!;
    expect(new Date(autumn).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(new Date(nextSlot(night, autumn)!).toISOString()).toBe('2026-10-26T01:30:00.000Z');
    // The latest slot at or before a time.
    expect(previousSlot(ROME, Date.parse('2026-10-18T21:00:00Z'))).toBe(
      Date.parse('2026-10-18T21:00:00Z'),
    );
  });

  it('a slot missed while off runs if less than half the interval passed, else it is skipped', () => {
    const daily = { cron: '0 8 * * *', timezone: 'Europe/Rome' };
    const slot = Date.parse('2026-10-17T06:00:00Z');
    const since = slot - 3 * DAY;
    expect(missedSlot(daily, since, slot + 2 * HOUR)).toEqual({ slot, missed: 3, catchUp: true });
    expect(missedSlot(daily, since, slot + 13 * HOUR)).toMatchObject({ slot, catchUp: false });
    // Nothing missed: the slot was handled.
    expect(missedSlot(daily, slot, slot + 2 * HOUR)).toBeNull();
  });
});

describe('AutomationStore', () => {
  it('saves and reads back the files; a broken file is reported, not used', () => {
    const dir = join(tempHome(), 'automations');
    const store = new AutomationStore(dir);
    const a: Automation = {
      id: 'post',
      name: 'Post',
      lead: 'titan',
      participants: ['rhea'],
      schedule: ROME,
      objective: 'Scrivi i post.',
      limits: { maxSteps: 40, maxEur: 0.5 },
      notify: { app: true, telegram: true },
      status: 'active',
      createdBy: 'user',
      createdAt: 1,
      updatedAt: 2,
      activeSince: 1,
    };
    store.save(a);
    writeFileSync(join(dir, 'rotta.yaml'), stringify({ id: 'rotta', name: '' }));
    const again = new AutomationStore(dir);
    const errors = again.load();
    expect(again.list()).toEqual([a]);
    expect(errors.map((e) => e.file)).toEqual([join(dir, 'rotta.yaml')]);
    expect(readFileSync(join(dir, 'post.yaml'), 'utf8')).toContain('cron: 0 23 * * 0');
  });
});

describe('the chat leaves the runs of an automation out', () => {
  it('recentConversation skips them, the giro reads only its own', () => {
    const s = createCoreServices({ home: tempHome() });
    migrate(s.db, 'team', teamMigrations);
    const questions = new QuestionStore(s.db, s.log);
    const say = (runId: string, text: string, agent = 'user') =>
      s.log.append({
        agent,
        runId,
        type: 'message',
        data: agent === 'user' ? { role: 'user', text, to: 'titan' } : { role: 'agent', text },
      });
    say('chat-1', 'ciao');
    say('chat-1', 'ciao Giulio', 'titan');
    s.log.append({
      agent: 'titan',
      runId: 'auto-1',
      type: 'automation_run_started',
      data: { automationId: 'post', name: 'Post', giro: 'auto-1', trigger: 'schedule' },
    });
    say('auto-1', '[Automazione «Post»] scrivi i post');
    say('auto-1', 'Post pronti', 'titan');
    const chat = recentConversation(s.log, questions, {
      agentId: 'titan',
      isOrchestrator: true,
      turns: 10,
    });
    expect(JSON.stringify(chat)).not.toContain('Automazione');
    expect(chat).toHaveLength(2);
    const giro = recentConversation(s.log, questions, {
      agentId: 'titan',
      isOrchestrator: true,
      turns: 10,
      runs: new Set(['auto-1']),
    });
    expect(giro.map((m) => m.content)).toEqual([
      '[Automazione «Post»] scrivi i post',
      'Post pronti',
    ]);
    s.db.close();
    s.lock.release();
  });
});

describe('automations in the core', () => {
  // 22:59 in Rome on Sunday 18/10/2026: the weekly slot is one minute away.
  const START = Date.parse('2026-10-18T20:59:00Z');

  async function hub(
    titan: (call: FakeCall) => FakeStep,
    opts: { home?: string; start?: number; askWaitMs?: number; maxWaitMs?: number } = {},
  ) {
    const time = fakeClock(opts.start ?? START);
    const t = await startTestHub(
      { titan, rhea: [fake.text('ok')], dione: [fake.text('ok')] },
      {
        ...(opts.home ? { home: opts.home } : {}),
        hub: {
          ...(opts.askWaitMs !== undefined ? { askWaitMs: opts.askWaitMs } : {}),
          automations: {
            clock: time.clock,
            waitPollMs: 1000,
            maxWaitMs: opts.maxWaitMs ?? 10 * MIN,
            timezone: () => 'Europe/Rome',
          },
        },
      },
    );
    return { t, time };
  }

  it('a slot opens a run of its own on the automation channel, out of the chat', async () => {
    const { t, time } = await hub((call) =>
      isAutomationPrompt(call) ? fake.text('Ho preparato i 5 post.') : fake.text('Ciao Giulio.'),
    );
    const created = await t.json<AutomationView>('POST', '/api/automations', draft());
    expect(created).toMatchObject({
      id: 'post-della-settimana',
      status: 'active',
      scheduleText: 'every Sunday at 11:00 PM',
      nextRunAt: Date.parse('2026-10-18T21:00:00Z'),
      current: null,
      last: null,
    });

    time.advance(MIN);
    const started = await t.waitEvent(isType('automation_run_started'));
    expect(started.data).toMatchObject({
      automationId: 'post-della-settimana',
      trigger: 'schedule',
      slot: Date.parse('2026-10-18T21:00:00Z'),
    });
    const finished = await t.waitEvent(isType('automation_run_finished'));
    expect(finished.data).toMatchObject({ status: 'completed', summary: 'Ho preparato i 5 post.' });
    const objective = t.events(started.runId!).find(isType('message', (e) => e.agent === 'user'))!;
    expect(objective.data).toMatchObject({
      channel: 'automation',
      to: 'titan',
      automationId: 'post-della-settimana',
    });
    expect(objective.data.text).toContain('Prepara i post della pagina di Saturday');
    expect(objective.data.text).toContain('Mostri che partecipano: Rhea');
    expect(objective.data.text).toContain('«Social/Settimana»');

    // The next message of the chat does not see the automation's run.
    await settled(t);
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'come va?' });
    await t.runEnded(sent.runId);
    const chat = promptText(t.provider.calls.at(-1)!.options.prompt);
    expect(chat).toContain('come va?');
    expect(chat).not.toContain('Automazione');
    expect(chat).not.toContain('5 post');

    const runs = await t.json<AutomationRunSummary[]>(
      'GET',
      '/api/automations/post-della-settimana/runs',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: started.runId, state: 'completed', trigger: 'schedule' });
    expect(runs[0]!.steps).toBeGreaterThan(0);
    const detail = await t.json<AutomationRunDetail>(
      'GET',
      `/api/automations/post-della-settimana/runs/${started.runId}`,
    );
    expect(detail.finalAnswer).toBe('Ho preparato i 5 post.');
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'agent']);
    const view = await t.json<AutomationView>('GET', '/api/automations/post-della-settimana');
    expect(view.last?.state).toBe('completed');
    expect(view.nextRunAt).toBe(Date.parse('2026-10-25T22:00:00Z'));
  });

  it('the limits of the automation are the limits of its run (the euro cap in dollars)', async () => {
    const gate = deferred();
    let calls = 0;
    const { t } = await hub(() => {
      calls++;
      return fake.text('Fatto.', { gate: gate.promise });
    });
    await t.json(
      'POST',
      '/api/automations',
      draft({ limits: { maxSteps: 2, maxTotalTokens: 5000, maxEur: 0.43 } }),
    );
    const now = await t.json<{ runId: string }>(
      'POST',
      '/api/automations/post-della-settimana/run',
    );
    while (calls === 0) await new Promise((r) => setTimeout(r, 5));
    const run = t.core.hub.dispatcher.conversation(now.runId)!.run;
    const limits = runBudget(run).limits;
    expect(limits).toMatchObject({ maxRunSteps: 2, maxRunTokens: 5000 });
    // 0.43 € at the default 0.86 $/€: 0.50 $ of reported cost (subscriptions report none).
    expect(limits.maxRunCostUsd).toBeCloseTo(0.5);
    // The other limits stay those of every run.
    expect(limits.maxDelegationsPerRun).toBe(12);
    gate.resolve();
    expect((await t.runEnded(now.runId)).data.status).toBe('completed');
  });

  it('a busy capo: the giro waits, never joins the user run; a message meanwhile waits for the giro', async () => {
    const userGate = deferred();
    const autoGate = deferred();
    const { t, time } = await hub((call) => {
      const text = promptText(call.options.prompt);
      if (isAutomationPrompt(call)) return fake.text('Post pronti.', { gate: autoGate.promise });
      if (text.includes('lavoro lungo'))
        return fake.text('Finito il lavoro lungo.', { gate: userGate.promise });
      return fake.text('Risposta alla domanda veloce.');
    });
    await t.json('POST', '/api/automations', draft());
    const user = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: 'fai un lavoro lungo',
    });
    await t.waitEvent(isType('run', (e) => e.runId === user.runId && e.data.status === 'started'));

    time.advance(MIN);
    const waiting = await t.json<AutomationView>('GET', '/api/automations/post-della-settimana');
    expect(waiting.current?.state).toBe('waiting_lead');
    expect(t.events().filter(isType('automation_run_started'))).toHaveLength(0);

    userGate.resolve();
    await t.runEnded(user.runId);
    await settled(t);
    // The user's run never got the objective.
    expect(promptText(t.provider.calls[0]!.options.prompt)).not.toContain('Automazione');
    time.advance(1000);
    const started = await t.waitEvent(isType('automation_run_started'));
    expect(started.runId).not.toBe(user.runId);

    // A message typed during the giro waits for it, in a run of its own.
    const typed = await t.json<{ runId: string; queued: boolean }>('POST', '/api/messages', {
      text: 'domanda veloce',
    });
    expect(typed.queued).toBe(true);
    expect(typed.runId).not.toBe(started.runId);
    autoGate.resolve();
    expect((await t.runEnded(started.runId!)).data.status).toBe('completed');
    expect((await t.runEnded(typed.runId)).data.status).toBe('completed');
    const autoPrompts = t.provider.calls
      .filter(isAutomationPrompt)
      .map((c) => promptText(c.options.prompt));
    expect(autoPrompts.join()).not.toContain('domanda veloce');
    const chat = promptText(t.provider.calls.at(-1)!.options.prompt);
    expect(chat).toContain('domanda veloce');
    expect(chat).toContain('fai un lavoro lungo');
    expect(chat).not.toContain('Post pronti');
  });

  it('a capo busy for too long: the slot is skipped as busy', async () => {
    const gate = deferred();
    const { t, time } = await hub(() => fake.text('Finito.', { gate: gate.promise }), {
      maxWaitMs: 5000,
    });
    await t.json('POST', '/api/automations', draft());
    const user = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'lavora' });
    await t.waitEvent(isType('run', (e) => e.runId === user.runId && e.data.status === 'started'));
    time.advance(MIN);
    time.advance(6000);
    const skipped = await t.waitEvent(isType('automation_run_skipped'));
    expect(skipped.data).toMatchObject({ reason: 'busy', trigger: 'schedule' });
    expect(skipped.data.message).toContain('was busy');
    gate.resolve();
    await t.runEnded(user.runId);
    expect(t.events().filter(isType('automation_run_started'))).toHaveLength(0);
  });

  it('the kill switch skips the slots and refuses "Esegui ora"; it stops a giro running', async () => {
    const gate = deferred();
    const { t, time } = await hub(() => fake.text('Post pronti.', { gate: gate.promise }));
    await t.json('POST', '/api/automations', draft());
    const now = await t.json<{ state: string; runId: string }>(
      'POST',
      '/api/automations/post-della-settimana/run',
    );
    expect(now.state).toBe('running');
    // One giro at a time.
    const again = await t.api('POST', '/api/automations/post-della-settimana/run');
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe('already_running');

    await t.json('POST', '/api/kill', {});
    const end = await t.waitEvent(isType('automation_run_finished'));
    expect(end.data.status).toBe('aborted');
    time.advance(MIN);
    const skipped = await t.waitEvent(isType('automation_run_skipped'));
    expect(skipped.data.reason).toBe('halted');
    const refused = await t.api('POST', '/api/automations/post-della-settimana/run');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('halted');
    // Riprendi e continua does not start the giro again as a chat request.
    const resumed = await t.json<{ continued?: unknown[] }>('POST', '/api/resume', {
      continue: true,
    });
    expect(resumed.continued).toEqual([]);
  });

  it('a question parks the giro as waiting_user; the answer goes on in the giro, not in the chat', async () => {
    const { t, time } = await hub(
      (call) => {
        const text = promptText(call.options.prompt);
        if (text.includes('Risposta alla tua domanda'))
          return fake.text('Ok: tono ironico, post pronti.');
        if (isAutomationPrompt(call)) {
          return text.includes('"ask_user"') && text.includes('Che tono?')
            ? fake.text('Aspetto la tua risposta sul tono.')
            : fake.toolCall('ask_user', {
                question: 'Che tono?',
                options: ['Ironico', 'Serio'],
                kind: 'taste',
              });
        }
        return fake.text('Ciao, dimmi.');
      },
      { askWaitMs: 30 },
    );
    await t.json('POST', '/api/automations', draft());
    time.advance(MIN);
    const started = await t.waitEvent(isType('automation_run_started'));
    expect((await t.runEnded(started.runId!)).data.status).toBe('waiting_user');
    const parked = await t.waitEvent(
      isType('automation_run_finished', (e) => e.data.status === 'waiting_user'),
    );
    expect(parked.data.giro).toBe(started.runId);
    await settled(t);
    const view = await t.json<AutomationView>('GET', '/api/automations/post-della-settimana');
    expect(view.current).toMatchObject({ id: started.runId, state: 'waiting_user' });

    // A plain message to the capo is a message of the chat, not the answer.
    const typed = await t.json<{ runId: string; answered?: string }>('POST', '/api/messages', {
      text: 'ironico',
    });
    expect(typed.answered).toBeUndefined();
    await t.runEnded(typed.runId);
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(open).toMatchObject({ question: 'Che tono?', parked: true });

    // The next slot (Sunday 25/10 at 23:00, after the clocks went back) finds the giro waiting.
    time.advance(7 * DAY + HOUR);
    const skipped = await t.waitEvent(isType('automation_run_skipped'));
    expect(skipped.data.reason).toBe('waiting_user');

    await t.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '1' });
    const next = await t.waitEvent(
      isType('automation_run_started', (e) => e.data.trigger === 'answer'),
    );
    expect(next.data).toMatchObject({ giro: started.runId, continues: started.runId });
    const done = await t.waitEvent(
      isType('automation_run_finished', (e) => e.data.status === 'completed'),
    );
    expect(done.data.giro).toBe(started.runId);
    const seen = promptText(t.provider.calls.at(-1)!.options.prompt);
    // The giro's own history: the objective, not the chat.
    expect(seen).toContain('Prepara i post della pagina di Saturday');
    expect(seen).not.toContain('Ciao, dimmi.');
    const runs = await t.json<AutomationRunSummary[]>(
      'GET',
      '/api/automations/post-della-settimana/runs',
    );
    const giro = runs.find((r) => r.id === started.runId)!;
    expect(giro).toMatchObject({ state: 'completed' });
    expect(giro.runIds).toEqual([started.runId, next.runId]);
  });

  it('pausing while a giro waits to resume after an answer closes the giro (it does not stay running)', async () => {
    const gate = deferred();
    const { t, time } = await hub(
      (call) => {
        if (isAutomationPrompt(call)) {
          return fake.toolCall('ask_user', {
            question: 'Che tono?',
            options: ['Ironico', 'Serio'],
            kind: 'taste',
          });
        }
        return fake.text('Ciao.', { gate: gate.promise });
      },
      { askWaitMs: 30 },
    );
    await t.json('POST', '/api/automations', draft());
    time.advance(MIN);
    const started = await t.waitEvent(isType('automation_run_started'));
    expect((await t.runEnded(started.runId!)).data.status).toBe('waiting_user');
    await settled(t);
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    // The capo is busy with a message of the chat when the answer arrives.
    const typed = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    await t.waitEvent(isType('run', (e) => e.runId === typed.runId && e.data.status === 'started'));
    await t.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '1' });
    const before = await t.json<AutomationView>('GET', '/api/automations/post-della-settimana');
    expect(before.current?.state).toBe('waiting_lead');

    await t.json('POST', '/api/automations/post-della-settimana/pause');
    const closed = await t.waitEvent(
      isType('automation_run_finished', (e) => e.data.status === 'aborted'),
    );
    expect(closed.data.giro).toBe(started.runId);
    const after = await t.json<AutomationView>('GET', '/api/automations/post-della-settimana');
    expect(after.current).toBeFalsy();
    gate.resolve();
    await t.runEnded(typed.runId);
  });

  it('a restart during a giro: no "si è fermato", the giro goes on at the start (B3)', async () => {
    const home = tempHome();
    const first = await hub(() => fake.text('mai', { gate: never }), { home });
    await first.t.json('POST', '/api/automations', draft({ notify: { telegram: true } }));
    first.time.advance(MIN);
    const started = await first.t.waitEvent(isType('automation_run_started'));
    await first.t.waitEvent(
      isType('run', (e) => e.runId === started.runId && e.data.status === 'started'),
    );
    await first.t.core.close();

    // Ten minutes later: the next slot is a week away, the giro goes on.
    const { t } = await hub(
      (call) =>
        promptText(call.options.prompt).includes('Monsters si è chiuso')
          ? fake.text('Ripreso: post pronti.')
          : fake.text('Ciao.'),
      { home, start: START + 10 * MIN },
    );
    const again = await t.waitEvent(
      isType(
        'automation_run_started',
        (e) => e.data.giro === started.runId && e.runId !== started.runId,
      ),
    );
    expect(again.data).toMatchObject({ continues: started.runId, trigger: 'schedule' });
    const done = await t.waitEvent(isType('automation_run_finished'));
    expect(done.data).toMatchObject({ giro: started.runId, status: 'completed' });
    const runs = await t.json<AutomationRunSummary[]>(
      'GET',
      '/api/automations/post-della-settimana/runs',
    );
    expect(runs[0]).toMatchObject({ id: started.runId, state: 'completed' });
    expect(runs[0]!.runIds).toEqual([started.runId, again.runId]);
    // The closing logged no end of the giro: nothing was announced (Telegram announces the ends).
    expect(t.events().filter(isType('automation_run_finished'))).toEqual([done]);
  });

  it('an answer to an older giro waits for the open one, and a paused automation does not go on (B4)', async () => {
    const { t, time } = await hub(
      (call) => {
        const text = promptText(call.options.prompt);
        if (!isAutomationPrompt(call)) return fake.text('Ciao.');
        if (text.includes('Risposta alla tua domanda')) return fake.text('Giro ripreso e finito.');
        if (text.includes('18 ottobre')) {
          return text.includes('Che tono?')
            ? fake.streamError(new Error('il modello si è rotto'))
            : fake.toolCall('ask_user', {
                question: 'Che tono?',
                options: ['Ironico', 'Serio'],
                kind: 'taste',
              });
        }
        return text.includes('Che colore?')
          ? fake.text('Aspetto il colore.')
          : fake.toolCall('ask_user', {
              question: 'Che colore?',
              options: ['Rosso', 'Blu'],
              kind: 'taste',
            });
      },
      { askWaitMs: 30 },
    );
    await t.json('POST', '/api/automations', draft());
    time.advance(MIN);
    const first = await t.waitEvent(isType('automation_run_started'));
    const failed = await t.waitEvent(isType('automation_run_finished'));
    expect(failed.data).toMatchObject({ giro: first.runId, status: 'failed' });
    await settled(t);
    // The next slot: a second giro, which waits for an answer of its own.
    time.advance(7 * DAY + HOUR);
    const second = await t.waitEvent(
      isType('automation_run_started', (e) => e.data.giro !== first.runId),
    );
    await t.waitEvent(
      isType(
        'automation_run_finished',
        (e) => e.data.giro === second.runId && e.data.status === 'waiting_user',
      ),
    );
    await settled(t);
    const open = await t.json<Question[]>('GET', '/api/questions?status=open');
    const tone = open.find((q) => q.question === 'Che tono?')!;
    const colour = open.find((q) => q.question === 'Che colore?')!;

    // The old giro's answer: it does not open a second giro beside the one waiting.
    await t.json('POST', `/api/questions/${tone.id}/answer`, { optionId: '1' });
    await settled(t);
    const resumedOld = () =>
      t.events().filter(isType('automation_run_started', (e) => e.data.giro === first.runId));
    expect(resumedOld()).toHaveLength(1);
    const view = await t.json<AutomationView>('GET', '/api/automations/post-della-settimana');
    expect(view.current).toMatchObject({ id: second.runId, state: 'waiting_user' });

    // The open giro ends: the old one goes on after it.
    await t.json('POST', `/api/questions/${colour.id}/answer`, { optionId: '1' });
    await t.waitEvent(
      isType(
        'automation_run_finished',
        (e) => e.data.giro === second.runId && e.data.status === 'completed',
      ),
    );
    // It waits for the capo to be free, like any giro.
    await settled(t);
    time.advance(2_000);
    const oldDone = await t.waitEvent(
      isType(
        'automation_run_finished',
        (e) => e.data.giro === first.runId && e.data.status === 'completed',
      ),
    );
    expect(oldDone.data.giro).toBe(first.runId);
    expect(resumedOld()).toHaveLength(2);
  });

  it('a giro answered while another was open goes on after a restart (review of 19/10, 3)', async () => {
    const home = tempHome();
    // The same giri as above (B4): the old one fails with its question open, the next waits.
    const titan = (call: FakeCall) => {
      const text = promptText(call.options.prompt);
      if (!isAutomationPrompt(call)) return fake.text('Ciao.');
      if (text.includes('Risposta alla tua domanda')) return fake.text('Giro ripreso e finito.');
      if (text.includes('18 ottobre')) {
        return text.includes('Che tono?')
          ? fake.streamError(new Error('il modello si è rotto'))
          : fake.toolCall('ask_user', {
              question: 'Che tono?',
              options: ['A', 'B'],
              kind: 'taste',
            });
      }
      return text.includes('Che colore?')
        ? fake.text('Aspetto il colore.')
        : fake.toolCall('ask_user', {
            question: 'Che colore?',
            options: ['A', 'B'],
            kind: 'taste',
          });
    };
    const first = await hub(titan, { home, askWaitMs: 30 });
    await first.t.json('POST', '/api/automations', draft());
    first.time.advance(MIN);
    const old = await first.t.waitEvent(isType('automation_run_started'));
    await first.t.waitEvent(isType('automation_run_finished'));
    await settled(first.t);
    first.time.advance(7 * DAY + HOUR);
    const open = await first.t.waitEvent(
      isType('automation_run_started', (e) => e.data.giro !== old.runId),
    );
    await first.t.waitEvent(
      isType(
        'automation_run_finished',
        (e) => e.data.giro === open.runId && e.data.status === 'waiting_user',
      ),
    );
    await settled(first.t);
    const questions = await first.t.json<Question[]>('GET', '/api/questions?status=open');
    const tone = questions.find((q) => q.question === 'Che tono?')!;
    const colour = questions.find((q) => q.question === 'Che colore?')!;
    // The old giro's answer waits for the open giro (B4)... and the core closes meanwhile.
    await first.t.json('POST', `/api/questions/${tone.id}/answer`, { optionId: '1' });
    await settled(first.t);
    await first.t.core.close();

    const { t, time } = await hub(titan, {
      home,
      askWaitMs: 30,
      start: START + 7 * DAY + HOUR + 10 * MIN,
    });
    await settled(t);
    // It still waits for the open giro: no second giro beside it.
    const resumedOld = () =>
      t.events().filter(isType('automation_run_started', (e) => e.data.giro === old.runId));
    expect(resumedOld()).toHaveLength(1);
    await t.json('POST', `/api/questions/${colour.id}/answer`, { optionId: '1' });
    await t.waitEvent(
      isType(
        'automation_run_finished',
        (e) => e.data.giro === open.runId && e.data.status === 'completed',
      ),
    );
    await settled(t);
    time.advance(2_000);
    const done = await t.waitEvent(
      isType(
        'automation_run_finished',
        (e) => e.data.giro === old.runId && e.data.status === 'completed',
      ),
    );
    expect(done.data.summary).toBe('Giro ripreso e finito.');
    expect(resumedOld()).toHaveLength(2);
  });

  it('a giro cut by a crash goes on at the start, like one cut by a restart (review of 19/10, 17)', async () => {
    const home = tempHome();
    const first = await hub(() => fake.text('mai'), { home });
    await first.t.json('POST', '/api/automations', draft());
    await first.t.core.close();
    // What a crash leaves in the log: a giro whose run started and never ended.
    const db = openDb(join(home, 'monsters.db'));
    const log = new EventLog(db);
    const runId = log.append({
      agent: 'titan',
      type: 'automation_run_started',
      runId: '01KCRASHED0000000000000000',
      data: {
        automationId: 'post-della-settimana',
        name: 'Post della settimana',
        giro: '01KCRASHED0000000000000000',
        trigger: 'schedule',
        slot: START + MIN,
      },
    }).runId!;
    log.append({ agent: 'titan', runId, type: 'run', data: { status: 'started', goal: 'giro' } });
    db.close();

    const { t } = await hub(
      (call) =>
        promptText(call.options.prompt).includes('Monsters si è chiuso')
          ? fake.text('Ripreso: post pronti.')
          : fake.text('Ciao.'),
      { home, start: START + 10 * MIN },
    );
    const again = await t.waitEvent(
      isType('automation_run_started', (e) => e.data.giro === runId && e.runId !== runId),
    );
    expect(again.data).toMatchObject({ continues: runId, trigger: 'schedule' });
    const done = await t.waitEvent(isType('automation_run_finished'));
    expect(done.data).toMatchObject({ giro: runId, status: 'completed' });
  });

  /**
   * What a crash of the core leaves: the data folder as it is while the giro works (no
   * `run aborted`, no closing), copied aside while the first core is still alive.
   */
  const crashCopy = (home: string): string => {
    const copy = tempHome();
    rmSync(copy, { recursive: true, force: true });
    cpSync(home, copy, { recursive: true });
    rmSync(join(copy, LOCK_FILE), { force: true });
    return copy;
  };

  it('a giro whose core crashed at work goes on at the start, at most twice (residual of D-116)', async () => {
    const working = (call: FakeCall) =>
      isAutomationPrompt(call) ? fake.text('mai', { gate: never }) : fake.text('Ciao.');
    const first = await hub(working);
    await first.t.json('POST', '/api/automations', draft());
    first.time.advance(MIN);
    const started = await first.t.waitEvent(isType('automation_run_started'));
    await vi.waitFor(() => expect(first.t.provider.callsTo('titan')).toHaveLength(1));
    const crashed = crashCopy(first.t.home);

    // Ten minutes later, on what the crash left: the giro goes on (and crashes again).
    const second = await hub(working, { home: crashed, start: START + 10 * MIN });
    const again = await second.t.waitEvent(
      isType(
        'automation_run_started',
        (e) => e.data.giro === started.runId && e.runId !== started.runId,
      ),
    );
    expect(again.data).toMatchObject({ continues: started.runId, trigger: 'schedule' });
    await vi.waitFor(() => expect(second.t.provider.callsTo('titan')).toHaveLength(1));
    expect(second.t.events().filter(isType('automation_run_finished'))).toEqual([]);
    const crashedTwice = crashCopy(second.t.home);

    const third = await hub(working, { home: crashedTwice, start: START + 20 * MIN });
    await third.t.waitEvent(
      isType(
        'automation_run_started',
        (e) => e.data.giro === started.runId && e.data.continues === again.runId,
      ),
    );
    await vi.waitFor(() => expect(third.t.provider.callsTo('titan')).toHaveLength(1));
    const crashedThrice = crashCopy(third.t.home);

    // Cut three times: it ends as before, it does not start again.
    const fourth = await hub(working, { home: crashedThrice, start: START + 30 * MIN });
    const done = await fourth.t.waitEvent(
      isType('automation_run_finished', (e) => e.data.giro === started.runId),
    );
    expect(done.data.status).toBe('aborted');
    await settled(fourth.t);
    expect(fourth.t.provider.callsTo('titan')).toHaveLength(0);
    for (const h of [first, second, third, fourth]) await h.t.core.close();
  });

  it('a giro cut by a crash after its next slot does not go on: that slot runs instead', async () => {
    const first = await hub((call) =>
      isAutomationPrompt(call) ? fake.text('mai', { gate: never }) : fake.text('Ciao.'),
    );
    await first.t.json('POST', '/api/automations', draft());
    first.time.advance(MIN);
    const started = await first.t.waitEvent(isType('automation_run_started'));
    await vi.waitFor(() => expect(first.t.provider.callsTo('titan')).toHaveLength(1));
    const crashed = crashCopy(first.t.home);
    await first.t.core.close();

    // Eight days later: the next slot came (and went), the old giro ends, nothing continues it.
    const { t } = await hub(() => fake.text('Giro nuovo.'), {
      home: crashed,
      start: START + 8 * DAY,
    });
    const closed = await t.waitEvent(
      isType('automation_run_finished', (e) => e.data.giro === started.runId),
    );
    expect(closed.data.status).toBe('aborted');
    await settled(t);
    const continued = t
      .events()
      .filter(
        isType(
          'automation_run_started',
          (e) => e.data.giro === started.runId && e.runId !== started.runId,
        ),
      );
    expect(continued).toEqual([]);
  });

  it('an answer to a giro of a paused automation closes the giro instead (B4)', async () => {
    const { t, time } = await hub(
      (call) =>
        isAutomationPrompt(call) && !promptText(call.options.prompt).includes('"ask_user"')
          ? fake.toolCall('ask_user', { question: 'Che tono?', options: ['A', 'B'], kind: 'taste' })
          : fake.text('Aspetto.'),
      { askWaitMs: 30 },
    );
    await t.json('POST', '/api/automations', draft());
    time.advance(MIN);
    const started = await t.waitEvent(isType('automation_run_started'));
    await t.waitEvent(isType('automation_run_finished', (e) => e.data.status === 'waiting_user'));
    await settled(t);
    await t.json('POST', '/api/automations/post-della-settimana/pause');
    const [open] = await t.json<Question[]>('GET', '/api/questions?status=open');
    await t.json('POST', `/api/questions/${open!.id}/answer`, { optionId: '1' });
    const closed = await t.waitEvent(
      isType('automation_run_finished', (e) => e.data.status === 'aborted'),
    );
    expect(closed.data.giro).toBe(started.runId);
    await settled(t);
    expect(
      t.events().filter(isType('automation_run_started', (e) => e.data.trigger === 'answer')),
    ).toEqual([]);
  });

  it('API: auth, validation, pause, draft, persistence across a restart', async () => {
    const home = tempHome();
    const first = await hub(() => fake.text('ok'), { home });
    const t = first.t;
    const anon = await fetch(`${t.core.url}/api/automations`);
    expect(anon.status).toBe(401);
    const bad = await t.api(
      'POST',
      '/api/automations',
      draft({ schedule: { cron: '61 * * * *' } }),
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_schedule');
    const stranger = await t.api('POST', '/api/automations', draft({ lead: 'nessuno' }));
    expect(stranger.status).toBe(400);
    expect((await t.api('GET', '/api/automations/nessuna')).status).toBe(404);

    // A draft (what `automation_propose` will make) never runs until confirmed.
    const d = await t.json<AutomationView>(
      'POST',
      '/api/automations',
      draft({ status: 'draft', schedule: { cron: '0 8 * * *' } }),
    );
    expect(d).toMatchObject({
      status: 'draft',
      nextRunAt: null,
      scheduleText: 'every day at 8:00 AM',
      schedule: { timezone: 'Europe/Rome' },
    });
    expect((await t.api('POST', `/api/automations/${d.id}/run`)).status).toBe(409);
    const confirmed = await t.json<AutomationView>('PATCH', `/api/automations/${d.id}`, {
      status: 'active',
      notify: { telegram: true },
      limits: { maxSteps: 30, maxEur: 0.2 },
    });
    expect(confirmed).toMatchObject({ status: 'active', notify: { app: true, telegram: true } });
    expect(confirmed.nextRunAt).toBe(Date.parse('2026-10-19T06:00:00Z'));
    const paused = await t.json<AutomationView>('POST', `/api/automations/${d.id}/pause`);
    expect(paused).toMatchObject({ status: 'paused', nextRunAt: null });
    expect(
      t
        .events()
        .filter(isType('automation_change'))
        .map((e) => e.data.action),
    ).toEqual(['created', 'confirmed', 'paused']);

    await t.core.close();
    const second = await hub(() => fake.text('ok'), { home });
    const list = await second.t.json<AutomationView[]>('GET', '/api/automations');
    expect(
      list.map(({ id, status, limits, schedule }) => ({ id, status, limits, schedule })),
    ).toEqual([
      {
        id: d.id,
        status: 'paused',
        limits: { maxSteps: 30, maxEur: 0.2 },
        schedule: { cron: '0 8 * * *', timezone: 'Europe/Rome' },
      },
    ]);
    expect((await second.t.api('DELETE', `/api/automations/${d.id}`)).status).toBe(200);
    expect(await second.t.json('GET', '/api/automations')).toEqual([]);
  });

  it('slots missed while the core was off: one runs at the start, a far one is skipped', async () => {
    const home = tempHome();
    const dir = join(home, 'automations');
    mkdirSync(dir, { recursive: true });
    // Now: Monday 19/10/2026 at 8:10 in Rome.
    const now = Date.parse('2026-10-19T06:10:00Z');
    const base = {
      lead: 'titan',
      participants: [],
      objective: 'Riassumi le novità.',
      limits: {},
      notify: { app: true, telegram: false },
      status: 'active',
      createdBy: 'user',
      createdAt: now - 30 * DAY,
      updatedAt: now - 30 * DAY,
      activeSince: now - 30 * DAY,
    };
    const daily = {
      ...base,
      id: 'mattina',
      name: 'Mattina',
      schedule: { cron: '0 8 * * *', timezone: 'Europe/Rome' },
    };
    // Wednesday 23:00: more than half a week ago.
    const weekly = {
      ...base,
      id: 'mercoledi',
      name: 'Mercoledì',
      schedule: { cron: '0 23 * * 3', timezone: 'Europe/Rome' },
    };
    // Created by the user with an earlier core (D-103: an active file needs the user's event).
    const earlier = await hub(() => fake.text('ok'), { home, start: now - 30 * DAY });
    for (const a of [daily, weekly]) {
      earlier.t.core.log.append({
        agent: 'user',
        type: 'automation_change',
        data: { action: 'created', automationId: a.id, name: a.name, by: 'ui', status: 'active' },
      });
    }
    await earlier.t.core.close();
    writeFileSync(join(dir, 'mattina.yaml'), stringify(daily));
    writeFileSync(join(dir, 'mercoledi.yaml'), stringify(weekly));
    const { t } = await hub(() => fake.text('Ecco il riassunto.'), { home, start: now });
    const started = await t.waitEvent(isType('automation_run_started'));
    expect(started.data).toMatchObject({
      automationId: 'mattina',
      trigger: 'catchup',
      slot: Date.parse('2026-10-19T06:00:00Z'),
    });
    const skipped = await t.waitEvent(isType('automation_run_skipped'));
    expect(skipped.data).toMatchObject({
      automationId: 'mercoledi',
      reason: 'missed',
      trigger: 'catchup',
    });
    expect(skipped.data.missed).toBeGreaterThan(1);
    await t.runEnded(started.runId!);
  });
});
