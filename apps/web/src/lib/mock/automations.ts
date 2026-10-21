import {
  AutomationCreateSchema,
  AutomationUpdateSchema,
  describeSchedule,
  timeOptions,
  ulid,
  type AgentSummary,
  type Automation,
  type AutomationRunDetail,
  type AutomationRunSummary,
  type AutomationTrigger,
  type AutomationView,
  type DraftView,
  type EventInput,
  type LogEvent,
  type Question,
} from '@monsters/shared';
import { Cron } from 'croner';
import type { RawResponse } from '../transport.ts';
import { mockLang, tr } from './lang.ts';
import { DEMO_AREA, DEMO_PROJECT_ID } from './projects.ts';

/*
 * `/api/automations` of the mock core (D-094; contract in
 * shared/src/automations.ts). The definitions live here, the giri in the event
 * log, as in the core: a giro is rebuilt from its `automation_run_*` events.
 * The demo has Giulio's example: "Post della settimana", every Sunday at 23:00,
 * in the project "Social di Saturday" (mock/projects.ts): its lead Iapetus with
 * Calypso (texts) and Pandora (pictures), two giri done.
 * "Esegui ora" plays a short scripted giro (held by the tests like the rest).
 */

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

type Step = [delayMs: number, run: () => void];

export interface MockAutomationsOptions {
  agents: () => AgentSummary[];
  events: () => readonly LogEvent[];
  log: (event: EventInput, ts?: number) => LogEvent;
  halted: () => boolean;
  /** Scripted steps, as the core's scenarios: held by the tests, dropped by Ferma. */
  schedule: (steps: Step[]) => void;
  questions: () => readonly Question[];
  timezone?: string;
}

export const DEMO_AUTOMATION_ID = 'post-della-settimana';

/** In a script: the id of the latest delegation started (a delegated monster's message points there). */
const DELEGATION = '@delegation';

const demoObjective = () =>
  tr(
    'Prepare the posts of the Saturday page for the coming week: three posts (Monday, Wednesday, Friday), each with the copy, the hashtags and an image. Start from the week’s notes and the themes that work best. Save the plan in a single note, ready to read on Monday morning.',
    'Prepara i post della pagina di Saturday per la settimana che arriva: tre post (lunedì, mercoledì, venerdì), ognuno con il testo, gli hashtag e un’immagine. Parti dalle note della settimana e dai temi che funzionano di più. Salva il piano in una nota sola, pronta da leggere lunedì mattina.',
  );

/** The locale of dates in the mock's language. */
const locale = () => (mockLang() === 'it' ? 'it-IT' : 'en-US');

function slug(name: string, taken: (id: string) => boolean): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || tr('automation', 'automazione');
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

function nextSlot(a: Automation, after: number): number | null {
  try {
    const job = new Cron(a.schedule.cron, {
      timezone: a.schedule.timezone,
      mode: '5-part',
      paused: true,
    });
    return job.nextRun(new Date(after))?.getTime() ?? null;
  } catch {
    return null;
  }
}

const dayFmt = () => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' });

export class MockAutomations {
  private readonly defs = new Map<string, Automation>();
  private readonly o: MockAutomationsOptions;
  private readonly tz: string;

  constructor(o: MockAutomationsOptions) {
    this.o = o;
    this.tz = o.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }

  /* --------------------------------------------------------------- the demo */

  /** Giulio's example with two Sundays done (events at their times: call before the rest). */
  seedDemo(now = Date.now()): void {
    const created = now - 20 * 86_400_000;
    const a: Automation = {
      id: DEMO_AUTOMATION_ID,
      name: tr('Weekly posts', 'Post della settimana'),
      lead: 'iapetus',
      project: DEMO_PROJECT_ID,
      participants: ['calypso', 'pandora'],
      schedule: { cron: '0 23 * * 0', timezone: this.tz },
      objective: demoObjective(),
      resultsFolder: `${DEMO_AREA()}/${tr('Posts', 'Post')}`,
      limits: { maxSteps: 60, maxEur: 2 },
      notify: { app: true, telegram: true },
      status: 'active',
      createdBy: 'user',
      createdAt: created,
      updatedAt: created,
      activeSince: created,
    };
    this.defs.set(a.id, a);
    const job = new Cron(a.schedule.cron, { timezone: a.schedule.timezone, paused: true });
    const slots = job
      .previousRuns(2, new Date(now))
      .map((d) => d.getTime())
      .reverse();
    for (const slot of slots) {
      const play = this.player();
      // A giro of a Sunday took a few minutes (the script is timed for "Esegui ora").
      for (const [at, input] of this.script(a, `run_auto_${slot}`, 'schedule', slot)) {
        play(input, slot + at * 15);
      }
    }
  }

  /** Logs the events of a script in order, the delegated messages tied to their delegation. */
  private player(): (input: EventInput, ts?: number) => void {
    let delegation: string | null = null;
    return (input, ts) => {
      const e = this.o.log(
        input.parentId === DELEGATION ? { ...input, parentId: delegation } : input,
        ts,
      );
      if (e.type === 'delegation' && e.data.status === 'started') delegation = e.id;
    };
  }

  /** The events of one giro, with their offset from its start (ms). */
  private script(
    a: Automation,
    runId: string,
    trigger: AutomationTrigger,
    slot: number | undefined,
  ): [number, EventInput][] {
    const lead = a.lead;
    const helpers = a.participants.filter((p) => p !== lead && this.has(p));
    const writer = helpers[0];
    const artist = helpers[1];
    const weekStart = (slot ?? Date.now()) + 86_400_000;
    const week = `${dayFmt().format(weekStart)} – ${dayFmt().format(weekStart + 6 * 86_400_000)}`;
    const folder = a.resultsFolder ? `${a.resultsFolder}/` : '';
    const note = `${folder}${tr('Posts', 'Post')} ${week}.md`;
    const when =
      slot !== undefined
        ? new Intl.DateTimeFormat(locale(), {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            ...timeOptions(mockLang()),
          }).format(slot)
        : '';
    const head =
      slot !== undefined
        ? tr(
            `[Automation “${a.name}” (run of ${when})]`,
            `[Automazione «${a.name}» (giro di ${when})]`,
          )
        : tr(`[Automation “${a.name}”, run now]`, `[Automazione «${a.name}», eseguita ora]`);
    const objective = [head, a.objective].join('\n\n');
    const out: [number, EventInput][] = [];
    const at = (ms: number, input: EventInput) => out.push([ms, input]);
    const usage = (agent: string, step: number): EventInput => ({
      agent,
      runId,
      type: 'provider_usage',
      data: {
        provider: 'openrouter',
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        inputTokens: 3200 + step * 900,
        outputTokens: 420 + step * 60,
        costUsd: 0,
        durationMs: 1900,
        step,
      },
    });
    at(0, {
      agent: lead,
      runId,
      type: 'automation_run_started',
      data: {
        automationId: a.id,
        name: a.name,
        giro: runId,
        trigger,
        ...(slot !== undefined ? { slot } : {}),
      },
    });
    at(10, {
      agent: lead,
      runId,
      type: 'run',
      data: { status: 'started', goal: tr(`Automation “${a.name}”`, `Automazione «${a.name}»`) },
    });
    at(20, {
      agent: 'user',
      runId,
      type: 'message',
      data: { role: 'user', text: objective, to: lead, channel: 'automation', automationId: a.id },
    });
    at(1500, usage(lead, 0));
    const planGoal = tr(
      `Plan and copy for the posts of the week ${week}`,
      `Piano e testi dei post della settimana ${week}`,
    );
    const imagesGoal = tr('The images of the three posts', 'Le immagini dei tre post');
    if (writer) {
      at(1600, {
        agent: lead,
        runId,
        type: 'delegation',
        data: {
          from: lead,
          to: writer,
          status: 'started',
          goal: planGoal,
        },
      });
      at(1700, {
        agent: lead,
        runId,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            `I’ll hand the plan and the copy to ${this.name(writer)}${artist ? `, then the images to ${this.name(artist)}` : ''}.`,
            `Passo il piano e i testi a ${this.name(writer)}${artist ? `, poi le immagini a ${this.name(artist)}` : ''}.`,
          ),
        },
      });
      at(5200, usage(writer, 1));
      at(5400, {
        agent: writer,
        runId,
        type: 'vault_change',
        data: { action: 'create', path: note, actionId: `act_${runId}_plan` },
      });
      at(5500, {
        agent: writer,
        runId,
        parentId: DELEGATION,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'Here’s the plan: Monday a behind-the-scenes look at the studio, Wednesday a client case, Friday a quick tip with the carousel. Copy and hashtags are in the note.',
            'Ecco il piano: lunedì il dietro le quinte dello studio, mercoledì un caso cliente, venerdì un consiglio veloce con il carosello. Testi e hashtag sono nella nota.',
          ),
        },
      });
      at(5600, {
        agent: lead,
        runId,
        type: 'delegation',
        data: {
          from: lead,
          to: writer,
          status: 'completed',
          goal: planGoal,
          summary: tr('3 posts with copy and hashtags', '3 post con testi e hashtag'),
        },
      });
    }
    if (artist) {
      at(5800, {
        agent: lead,
        runId,
        type: 'delegation',
        data: { from: lead, to: artist, status: 'started', goal: imagesGoal },
      });
      at(9200, usage(artist, 2));
      at(9400, {
        agent: artist,
        runId,
        type: 'vault_change',
        data: { action: 'edit', path: note, actionId: `act_${runId}_images` },
      });
      at(9500, {
        agent: lead,
        runId,
        type: 'delegation',
        data: {
          from: lead,
          to: artist,
          status: 'completed',
          goal: imagesGoal,
          summary: tr('3 images described in the note', '3 immagini descritte nella nota'),
        },
      });
    }
    at(10_800, usage(lead, 3));
    const noteLink = note.replace(/\.md$/, '');
    const answer = tr(
      `Done: the posts for the week ${week} are ready in the note [[${noteLink}]]. Three posts (Monday, Wednesday, Friday) with copy, hashtags and the image idea. To check: Wednesday’s client case mentions a name, make sure that’s okay.`,
      `Fatto: i post della settimana ${week} sono pronti nella nota [[${noteLink}]]. Tre post (lunedì, mercoledì, venerdì) con testo, hashtag e l’idea dell’immagine. Da guardare: il caso cliente di mercoledì cita un nome, controlla che vada bene.`,
    );
    at(11_000, { agent: lead, runId, type: 'message', data: { role: 'agent', text: answer } });
    at(11_100, { agent: lead, runId, type: 'run', data: { status: 'completed' } });
    at(11_200, {
      agent: lead,
      runId,
      type: 'automation_run_finished',
      data: {
        automationId: a.id,
        name: a.name,
        giro: runId,
        status: 'completed',
        costUsd: 0,
        steps: 2 + (writer ? 1 : 0) + (artist ? 1 : 0),
        tokens: 16_480,
        notes: [note],
        summary: answer.slice(0, 600),
        notify: a.notify,
      },
    });
    return out;
  }

  private has(id: string): boolean {
    return this.o.agents().some((x) => x.id === id);
  }

  private name(id: string): string {
    return this.o.agents().find((x) => x.id === id)?.name ?? id;
  }

  /* ------------------------------------------------------------ the giri */

  /** The giri of every automation from the log, newest first. */
  private history(): Map<string, AutomationRunSummary[]> {
    const byGiro = new Map<string, AutomationRunSummary>();
    const out = new Map<string, AutomationRunSummary[]>();
    const push = (s: AutomationRunSummary) => {
      const list = out.get(s.automationId) ?? [];
      list.push(s);
      out.set(s.automationId, list);
    };
    for (const e of this.o.events()) {
      if (e.type === 'automation_run_started' && e.runId) {
        const g = byGiro.get(e.data.giro);
        if (g) {
          g.runIds.push(e.runId);
          g.state = 'running';
          continue;
        }
        const s: AutomationRunSummary = {
          id: e.data.giro,
          automationId: e.data.automationId,
          state: 'running',
          trigger: e.data.trigger,
          ...(e.data.slot !== undefined ? { slot: e.data.slot } : {}),
          startedAt: e.ts,
          runIds: [e.runId],
          costUsd: 0,
          steps: 0,
          tokens: 0,
        };
        byGiro.set(e.data.giro, s);
        push(s);
      } else if (e.type === 'automation_run_finished') {
        const s = byGiro.get(e.data.giro);
        if (!s) continue;
        s.state = e.data.status;
        s.costUsd = e.data.costUsd ?? s.costUsd;
        s.steps = e.data.steps ?? s.steps;
        s.tokens = e.data.tokens ?? s.tokens;
        if (e.data.error) s.error = e.data.error;
        if (e.data.status !== 'waiting_user') s.endedAt = e.ts;
      } else if (e.type === 'automation_run_skipped') {
        push({
          id: e.id,
          automationId: e.data.automationId,
          state: 'skipped',
          trigger: e.data.trigger,
          ...(e.data.slot !== undefined ? { slot: e.data.slot } : {}),
          startedAt: e.ts,
          endedAt: e.ts,
          runIds: [],
          reason: e.data.reason,
          message: e.data.message,
          costUsd: 0,
          steps: 0,
          tokens: 0,
        });
      }
    }
    for (const list of out.values()) list.reverse();
    return out;
  }

  private view(a: Automation, history: readonly AutomationRunSummary[]): AutomationView {
    const open = history.find((s) => s.state === 'running' || s.state === 'waiting_user');
    const last = history.find((s) => s !== open);
    return {
      ...a,
      scheduleText: describeSchedule(a.schedule.cron, {
        timezone: a.schedule.timezone,
        userTimezone: this.tz,
      }),
      nextRunAt: a.status === 'active' ? nextSlot(a, Date.now()) : null,
      current: open ?? null,
      last: last ?? null,
    };
  }

  private detail(a: Automation, giro: string): AutomationRunDetail | null {
    const run = (this.history().get(a.id) ?? []).find((s) => s.id === giro);
    if (!run) return null;
    const runs = new Set(run.runIds);
    const messages: AutomationRunDetail['messages'] = [];
    const notes: string[] = [];
    const files: AutomationRunDetail['files'] = [];
    let finalAnswer: string | undefined;
    let lead = a.lead;
    for (const e of this.o.events()) {
      if (!e.runId || !runs.has(e.runId)) continue;
      if (e.type === 'automation_run_started' && e.data.giro === giro && !e.data.continues) {
        lead = e.agent;
      } else if (e.type === 'message' && !e.data.partial && e.data.text.trim()) {
        const user = e.agent === 'user' && e.data.role === 'user';
        if (!user && e.data.role !== 'agent') continue;
        messages.push({
          id: e.id,
          ts: e.ts,
          runId: e.runId,
          agent: e.agent,
          role: user ? 'user' : 'agent',
          text: e.data.text,
          ...(e.parentId !== null ? { delegated: true } : {}),
        });
        if (!user && e.parentId === null && e.agent === lead) finalAnswer = e.data.text;
      } else if (e.type === 'vault_change' && e.data.action !== 'delete') {
        if (!notes.includes(e.data.path)) notes.push(e.data.path);
      } else if (e.type === 'file' && e.data.action === 'created') {
        files.push({ id: e.data.id, name: e.data.name });
      }
    }
    const questions = this.o
      .questions()
      .filter((q) => q.status === 'open' && runs.has(q.runId))
      .map((q) => ({ id: q.id, question: q.question }));
    return {
      run,
      messages,
      ...(finalAnswer !== undefined ? { finalAnswer } : {}),
      notes,
      files,
      questions,
    };
  }

  /** A run of a giro ended badly (Ferma, an error): its giro ends too, like the core. */
  observe(e: LogEvent): void {
    if (e.type !== 'run' || !e.runId || e.data.status === 'started') return;
    if (e.data.status === 'completed') return;
    const started = this.o
      .events()
      .find((x) => x.type === 'automation_run_started' && x.runId === e.runId);
    if (started?.type !== 'automation_run_started') return;
    const done = this.o
      .events()
      .some((x) => x.type === 'automation_run_finished' && x.runId === e.runId);
    if (done) return;
    const a = this.defs.get(started.data.automationId);
    this.o.log({
      agent: started.agent,
      runId: e.runId,
      type: 'automation_run_finished',
      data: {
        automationId: started.data.automationId,
        name: started.data.name,
        giro: started.data.giro,
        status: e.data.status === 'waiting_user' ? 'waiting_user' : e.data.status,
        ...(e.data.error ? { error: e.data.error } : {}),
        ...(a ? { notify: a.notify } : {}),
      },
    });
  }

  private change(
    action: 'created' | 'updated' | 'deleted' | 'paused' | 'resumed' | 'confirmed',
    a: Automation,
  ): void {
    this.o.log({
      agent: 'user',
      type: 'automation_change',
      data: { action, automationId: a.id, name: a.name, by: 'ui' },
    });
  }

  private checkAgents(lead: string, participants: readonly string[]): RawResponse | null {
    for (const id of [lead, ...participants]) {
      if (!this.has(id)) return fail(400, 'unknown_agent', `no agent called "${id}"`);
    }
    return null;
  }

  private checkSchedule(cron: string, timezone: string): RawResponse | null {
    try {
      new Cron(cron, { timezone, mode: '5-part', paused: true }).nextRun();
      return null;
    } catch (err) {
      return fail(400, 'invalid_schedule', `${tr('when', 'quando')}: ${(err as Error).message}`);
    }
  }

  /** "Esegui ora": a short giro of the capo, step by step. */
  private runNow(a: Automation): RawResponse {
    if (this.o.halted()) {
      return fail(
        409,
        'halted',
        tr('Monsters is stopped: press Resume.', 'Monsters è fermo: premi Riprendi.'),
      );
    }
    if (a.status === 'draft') {
      return fail(
        409,
        'draft',
        tr('It’s a draft: confirm it first.', 'È una bozza: confermala prima.'),
      );
    }
    const open = (this.history().get(a.id) ?? []).some(
      (s) => s.state === 'running' || s.state === 'waiting_user',
    );
    if (open) {
      return fail(
        409,
        'already_running',
        tr('A run is already in progress.', 'C’è già un giro in corso.'),
      );
    }
    const runId = ulid();
    const play = this.player();
    let last = 0;
    const steps: Step[] = this.script(a, runId, 'manual', undefined).map(([at, input]) => {
      const delay = at - last;
      last = at;
      return [Math.max(0, delay) / 4, () => play(input)];
    });
    // The first event at once: the menu shows the giro "In corso" when the answer arrives.
    const [, first] = steps.shift()!;
    first();
    this.o.schedule(steps);
    return ok({ state: 'running', runId }, 202);
  }

  /* --------------------------------------------------------------- routes */

  /** The automation drafts of `/api/drafts` (D-098): the mock core lists them with the others. */
  draftViews(): DraftView[] {
    const history = this.history();
    return [...this.defs.values()]
      .filter((a) => a.status === 'draft')
      .map((a) => ({
        kind: 'automation' as const,
        id: a.id,
        title: a.name,
        summary: tr(
          `${a.createdBy !== 'user' ? `${this.name(a.createdBy)} suggests the automation` : 'Draft of the automation'} “${a.name}”: ${describeSchedule(a.schedule.cron)}.`,
          `${a.createdBy !== 'user' ? `${this.name(a.createdBy)} propone l’automazione` : 'Bozza dell’automazione'} «${a.name}»: ${describeSchedule(a.schedule.cron)}.`,
        ),
        from: a.createdBy,
        ...(a.createdBy !== 'user' ? { fromName: this.name(a.createdBy) } : {}),
        ...(a.project ? { project: a.project } : {}),
        createdAt: a.createdAt,
        automation: this.view(a, history.get(a.id) ?? []),
      }));
  }

  /** "Conferma" or "Scarta" on an automation draft (`/api/drafts/automation/:id/…`). */
  draftAction(id: string, action: 'confirm' | 'discard'): RawResponse {
    const a = this.defs.get(id);
    if (!a) return fail(404, 'unknown_draft', tr('Unknown draft.', 'Bozza sconosciuta.'));
    if (a.status !== 'draft') {
      return fail(409, 'draft_closed', tr('Draft already closed.', 'Bozza già chiusa.'));
    }
    const from = a.createdBy !== 'user' ? { from: a.createdBy } : {};
    if (action === 'discard') {
      this.defs.delete(a.id);
      this.o.log({
        agent: 'user',
        type: 'automation_change',
        data: { action: 'discarded', automationId: a.id, name: a.name, by: 'ui', ...from },
      });
      return ok({ ok: true });
    }
    const now = Date.now();
    const next: Automation = { ...a, status: 'active', updatedAt: now, activeSince: now };
    this.defs.set(a.id, next);
    this.o.log({
      agent: 'user',
      type: 'automation_change',
      data: {
        action: 'confirmed',
        automationId: a.id,
        name: a.name,
        by: 'ui',
        status: 'active',
        ...from,
      },
    });
    return ok({ kind: 'automation', id: a.id, automation: a.id });
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (!path.startsWith('/api/automations')) return null;
    const parts = path.split('/').slice(3).map(decodeURIComponent);
    const [id, sub, giro] = parts;
    if (!id) {
      if (method === 'GET') {
        const history = this.history();
        return ok([...this.defs.values()].map((a) => this.view(a, history.get(a.id) ?? [])));
      }
      if (method === 'POST') return this.create(body);
      return null;
    }
    const a = this.defs.get(id);
    if (!a) {
      return fail(
        404,
        'unknown_automation',
        tr('This automation doesn’t exist.', 'Questa automazione non c’è.'),
      );
    }
    const history = () => this.history().get(a.id) ?? [];
    if (sub === undefined) {
      if (method === 'GET') return ok(this.view(a, history()));
      if (method === 'PATCH') return this.update(a, body);
      if (method === 'DELETE') {
        this.defs.delete(a.id);
        this.change('deleted', a);
        return ok({ ok: true });
      }
      return null;
    }
    if (method === 'POST' && (sub === 'pause' || sub === 'resume')) {
      const status = sub === 'pause' ? 'paused' : 'active';
      const next: Automation = {
        ...a,
        status,
        updatedAt: Date.now(),
        ...(status === 'active' ? { activeSince: Date.now() } : {}),
      };
      this.defs.set(a.id, next);
      this.change(sub === 'pause' ? 'paused' : 'resumed', next);
      return ok(this.view(next, history()));
    }
    if (method === 'POST' && sub === 'run') return this.runNow(a);
    if (method === 'GET' && sub === 'runs' && giro === undefined) return ok(history());
    if (method === 'GET' && sub === 'runs' && giro) {
      const d = this.detail(a, giro);
      return d
        ? ok(d)
        : fail(404, 'unknown_run', tr('This run doesn’t exist.', 'Questo giro non c’è.'));
    }
    return null;
  }

  private create(body: unknown): RawResponse {
    const p = AutomationCreateSchema.safeParse(body);
    if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
    const schedule = {
      cron: p.data.schedule.cron.trim(),
      timezone: p.data.schedule.timezone ?? this.tz,
    };
    // Without a capo: the project's lead, else the orchestrator (D-097).
    const agents = this.o.agents();
    const lead =
      p.data.lead ??
      (p.data.project
        ? agents.find((x) => x.project === p.data.project && x.isLead)?.id
        : undefined) ??
      (agents.find((x) => x.isOrchestrator) ?? agents[0])?.id ??
      '';
    const bad =
      this.checkSchedule(schedule.cron, schedule.timezone) ??
      this.checkAgents(lead, p.data.participants);
    if (bad) return bad;
    const now = Date.now();
    const a: Automation = {
      id: slug(p.data.name, (x) => this.defs.has(x)),
      name: p.data.name,
      lead,
      ...(p.data.project !== undefined ? { project: p.data.project } : {}),
      participants: [...new Set(p.data.participants)],
      schedule,
      objective: p.data.objective,
      ...(p.data.resultsFolder !== undefined ? { resultsFolder: p.data.resultsFolder } : {}),
      limits: p.data.limits,
      notify: p.data.notify,
      status: p.data.status,
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
      ...(p.data.status === 'active' ? { activeSince: now } : {}),
    };
    this.defs.set(a.id, a);
    this.change('created', a);
    return ok(this.view(a, []), 201);
  }

  private update(a: Automation, body: unknown): RawResponse {
    const p = AutomationUpdateSchema.safeParse(body);
    if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
    const u = p.data;
    const schedule = u.schedule
      ? { cron: u.schedule.cron.trim(), timezone: u.schedule.timezone ?? a.schedule.timezone }
      : a.schedule;
    const lead = u.lead ?? a.lead;
    const participants = u.participants ? [...new Set(u.participants)] : a.participants;
    const bad =
      this.checkSchedule(schedule.cron, schedule.timezone) ?? this.checkAgents(lead, participants);
    if (bad) return bad;
    const now = Date.now();
    const confirmed = a.status === 'draft' && u.status === 'active';
    const next: Automation = {
      ...a,
      ...(u.name !== undefined ? { name: u.name } : {}),
      lead,
      participants,
      schedule,
      ...(u.objective !== undefined ? { objective: u.objective } : {}),
      ...(u.limits !== undefined ? { limits: u.limits } : {}),
      notify: { ...a.notify, ...(u.notify ?? {}) },
      ...(u.status !== undefined ? { status: u.status } : {}),
      updatedAt: now,
      ...(u.status === 'active' && a.status !== 'active' ? { activeSince: now } : {}),
    };
    if (u.project === null) delete next.project;
    else if (u.project !== undefined) next.project = u.project;
    if (u.resultsFolder === null) delete next.resultsFolder;
    else if (u.resultsFolder !== undefined) next.resultsFolder = u.resultsFolder;
    this.defs.set(a.id, next);
    this.change(confirmed ? 'confirmed' : 'updated', next);
    return ok(this.view(next, this.history().get(a.id) ?? []));
  }

  /** Test hook: a draft as `automation_propose` will make it (a monster's proposal). */
  propose(input: Partial<Automation> & Pick<Automation, 'name' | 'lead'>): string {
    const now = Date.now();
    const a: Automation = {
      id: slug(input.name, (x) => this.defs.has(x)),
      participants: [],
      schedule: { cron: '0 8 * * 1', timezone: this.tz },
      objective: tr(
        'Give me a summary of the week’s notes.',
        'Fammi un riassunto delle note della settimana.',
      ),
      limits: {},
      notify: { app: true, telegram: false },
      createdBy: input.lead,
      createdAt: now,
      updatedAt: now,
      ...input,
      status: 'draft',
    };
    this.defs.set(a.id, a);
    // As `automation_propose` logs it (D-098): `created` with the draft's status and who proposed it.
    this.o.log({
      agent: input.lead,
      type: 'automation_change',
      data: {
        action: 'created',
        automationId: a.id,
        name: a.name,
        from: input.lead,
        status: 'draft',
      },
    });
    return a.id;
  }
}
