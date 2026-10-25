import { formatNumber, VaultFolderSchema, type AutomationView } from '@monsters/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { describeError } from '../../lib/api.ts';
import {
  cronOfForm,
  formatWhen,
  formOfCron,
  nextRuns,
  personalSquad,
  scheduleText,
  userTimeZone,
  weekdayKeys,
  type ScheduleForm,
  type SchedulePreset,
} from '../../lib/automations.ts';
import { isLive } from '../../lib/projects.ts';
import { automationPath, openPage, useHashParam } from '../../lib/router.ts';
import { cn, domId, parseAmount } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { useAgents, useOrchestrator, type AgentView } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { DisclosureRow, Group, Row } from '../settings/parts.tsx';
import { Button } from '../ui/button.tsx';
import { Chip, Segmented, Switch } from '../ui/controls.tsx';
import { Field, Input, Label } from '../ui/field.tsx';
import { automationsStrings } from './automations.strings.ts';

/*
 * Create or change an automation (docs/design.md, "Automazioni"). Up front what everyone needs: the
 * name, the objective and when (ogni giorno / ogni settimana / ogni mese alle…, or the cron rule
 * under "Avanzato" with its description in Italian), with the next three giri on a small screen.
 * Behind a closed "More options" row (C2): the squad (the personal one or a project, D-100), the
 * capo and who takes part among its monsters (on their screens, as keys; by default the capo
 * decides), the folder of the results, the notices, one optional cap in euros per giro and, in its
 * own Advanced drawer, the steps and tokens. Without a cap the giro follows the limits of every job
 * (the core merges only what is set, `AutomationService.#limits`). A new one can be saved as a
 * draft, to finish later.
 */

const PRESET_IDS: SchedulePreset[] = ['daily', 'weekly', 'monthly', 'advanced'];

function go(hash: string) {
  window.location.hash = hash;
}

interface FormState {
  name: string;
  /** The project's id, or '' for the personal squad. */
  project: string;
  lead: string;
  participants: string[];
  schedule: ScheduleForm;
  timezone: string;
  objective: string;
  folder: string;
  maxSteps: string;
  maxTokens: string;
  maxEur: string;
  notifyApp: boolean;
  notifyTelegram: boolean;
}

function initial(a: AutomationView | null, lead: string, project: string): FormState {
  if (!a) {
    return {
      name: '',
      project,
      lead,
      participants: [],
      schedule: { ...formOfCron('0 9 * * 1'), preset: 'weekly' },
      timezone: userTimeZone(),
      objective: '',
      folder: '',
      maxSteps: '',
      maxTokens: '',
      maxEur: '',
      notifyApp: true,
      notifyTelegram: false,
    };
  }
  return {
    name: a.name,
    project: a.project ?? '',
    lead: a.lead,
    participants: a.participants.filter((p) => p !== a.lead),
    schedule: formOfCron(a.schedule.cron),
    timezone: a.schedule.timezone,
    objective: a.objective,
    folder: a.resultsFolder ?? '',
    maxSteps: a.limits.maxSteps?.toString() ?? '',
    maxTokens: a.limits.maxTotalTokens?.toString() ?? '',
    maxEur: a.limits.maxEur === undefined ? '' : formatNumber(a.limits.maxEur),
    notifyApp: a.notify.app,
    notifyTelegram: a.notify.telegram,
  };
}

/** The zones the browser knows, the chosen one always among them. */
function zones(current: string): string[] {
  let list: string[];
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    list = ['Europe/Rome', 'Europe/London', 'America/New_York', 'UTC'];
  }
  return list.includes(current) ? list : [current, ...list];
}

/**
 * A number field read with the app language's marks (`parseAmount`, D-172): undefined when
 * empty, NaN when not a number, so "1,000" in English is a thousand and never 1.
 */
function numberOf(s: string): number | undefined {
  const n = parseAmount(s);
  return n === null ? undefined : (n ?? NaN);
}

type Errors = Partial<Record<'name' | 'objective' | 'schedule' | 'folder' | 'limits', string>>;

/** A monster as a key with its screen: the capo of an automation, who takes part (D-096). */
export function MonsterKey({
  agent,
  pressed,
  role,
  onClick,
}: {
  agent: AgentView;
  pressed: boolean;
  role: 'radio' | 'checkbox';
  onClick: () => void;
}) {
  const s = automationsStrings().form;
  return (
    <button
      type="button"
      role={role}
      aria-checked={pressed}
      data-pressed={pressed ? 'true' : undefined}
      onClick={onClick}
      data-testid={`pick-${agent.id}`}
      className={cn(
        'key relative inline-flex h-14 items-center gap-2.5 rounded-[12px] pr-4 pl-1.5 text-body font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        pressed ? 'text-ink [--cap:var(--panel)]' : 'text-ink-muted hover:text-ink',
      )}
    >
      <MonsterScreen
        genome={agent.genome}
        mood="idle"
        width={44}
        height={40}
        pad={2}
        animated={false}
      />
      <span className="grid text-left">
        <span className="leading-5">{agent.name}</span>
        {pressed && (
          <span className="label leading-4 text-signal-ink">
            {role === 'radio' ? s.lead : s.takesPart}
          </span>
        )}
      </span>
    </button>
  );
}

/** The monsters of a squad: the personal one has the orchestrator and the monsters with no project. */
function squadMembers(agents: readonly AgentView[], project: string): AgentView[] {
  const members = agents.filter((x) => (x.project ?? '') === project);
  // The lead first: it receives the objective.
  return project ? members.sort((x, y) => Number(!!y.isLead) - Number(!!x.isLead)) : members;
}

/** Whether a form holds something of the closed "More options" row, so that it opens on it. */
function hasExtras(f: FormState, defaultLead: string, fromProject: boolean): boolean {
  return (
    fromProject ||
    f.project !== '' ||
    f.lead !== defaultLead ||
    f.participants.length > 0 ||
    f.folder !== '' ||
    f.maxEur !== '' ||
    f.maxSteps !== '' ||
    f.maxTokens !== '' ||
    !f.notifyApp ||
    f.notifyTelegram
  );
}

export function AutomationForm({ a }: { a: AutomationView | null }) {
  const allAgents = useAgents();
  const orch = useOrchestrator();
  const projects = useProjects();
  const live = (projects ?? []).filter(isLive);
  // "Nuova automazione" from a project's page (`&progetto=…`) starts in its squad.
  const fromProject = useHashParam('project') ?? '';
  const [f, setF] = useState<FormState>(() => {
    const project = a ? (a.project ?? '') : fromProject;
    const first = squadMembers(allAgents, project)[0]?.id;
    return initial(a, project ? (first ?? '') : (orch?.id ?? allAgents[0]?.id ?? ''), project);
  });
  const agents = squadMembers(allAgents, f.project);
  // Closed unless it holds something the person chose (an automation being changed, or one started
  // from a project's page, whose squad it shows).
  const [more, setMore] = useState(() => {
    const members = squadMembers(allAgents, f.project);
    const defaultLead = f.project ? (members[0]?.id ?? '') : (orch?.id ?? allAgents[0]?.id ?? '');
    return hasExtras(f, defaultLead, !a && fromProject !== '');
  });
  const [advanced, setAdvanced] = useState(() => f.maxSteps !== '' || f.maxTokens !== '');
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = domId(useId());
  const s = automationsStrings().form;
  const set = (patch: Partial<FormState>) => setF((st) => ({ ...st, ...patch }));
  const setSchedule = (patch: Partial<ScheduleForm>) =>
    setF((st) => ({ ...st, schedule: { ...st.schedule, ...patch } }));

  const cron = cronOfForm(f.schedule);
  const preview = useMemo(() => (cron ? nextRuns(cron, f.timezone, 3) : null), [cron, f.timezone]);
  const scheduleOk = cron !== null && preview !== null && preview.length > 0;
  const tzList = useMemo(() => zones(f.timezone), [f.timezone]);

  const choosePreset = (preset: SchedulePreset) => {
    // "Avanzato" starts from the rule of the preset on screen.
    if (preset === 'advanced')
      setSchedule({ preset, cron: cronOfForm(f.schedule) ?? f.schedule.cron });
    else setSchedule({ preset });
  };
  const chooseSquad = (project: string) => {
    const members = squadMembers(allAgents, project);
    const lead = project ? (members[0]?.id ?? '') : (orch?.id ?? members[0]?.id ?? '');
    set({ project, lead, participants: [] });
  };
  const chooseLead = (id: string) =>
    set({ lead: id, participants: f.participants.filter((p) => p !== id) });
  const toggleParticipant = (id: string) =>
    set({
      participants: f.participants.includes(id)
        ? f.participants.filter((p) => p !== id)
        : [...f.participants, id],
    });
  const toggleDay = (day: number) =>
    setSchedule({
      weekdays: f.schedule.weekdays.includes(day)
        ? f.schedule.weekdays.filter((d) => d !== day)
        : [...f.schedule.weekdays, day],
    });

  const check = (): Errors => {
    const e: Errors = {};
    if (!f.name.trim()) e.name = s.errName;
    if (!f.objective.trim()) e.objective = s.errObjective;
    if (!scheduleOk) {
      e.schedule =
        f.schedule.preset === 'weekly' && f.schedule.weekdays.length === 0
          ? s.errNoDay
          : f.schedule.preset === 'advanced'
            ? s.errCron
            : s.errTime;
    }
    if (f.folder.trim() && !VaultFolderSchema.safeParse(f.folder.trim()).success) {
      e.folder = s.errFolder;
    }
    const steps = numberOf(f.maxSteps);
    const tokens = numberOf(f.maxTokens);
    const eur = numberOf(f.maxEur);
    if (
      (steps !== undefined && !(Number.isInteger(steps) && steps >= 1 && steps <= 2000)) ||
      (tokens !== undefined &&
        !(Number.isInteger(tokens) && tokens >= 1000 && tokens <= 50_000_000)) ||
      (eur !== undefined && !(eur >= 0.01 && eur <= 1000))
    ) {
      e.limits = s.errLimits;
    }
    return e;
  };

  const submit = async (draft: boolean) => {
    const e = check();
    setErrors(e);
    setFailure(null);
    // What is wrong in the closed rows must be in view.
    if (e.folder || e.limits) setMore(true);
    if (e.limits) setAdvanced(true);
    if (Object.keys(e).length > 0) return;
    const steps = numberOf(f.maxSteps);
    const tokens = numberOf(f.maxTokens);
    const eur = numberOf(f.maxEur);
    const limits = {
      ...(steps !== undefined ? { maxSteps: steps } : {}),
      ...(tokens !== undefined ? { maxTotalTokens: tokens } : {}),
      ...(eur !== undefined ? { maxEur: eur } : {}),
    };
    const common = {
      name: f.name.trim(),
      lead: f.lead,
      participants: f.participants.filter((p) => p !== f.lead),
      schedule: { cron: cron!, timezone: f.timezone },
      objective: f.objective.trim(),
      limits,
      notify: { app: f.notifyApp, telegram: f.notifyTelegram },
    };
    setBusy(true);
    try {
      const api = getApi();
      const saved = a
        ? await api.updateAutomation(a.id, {
            ...common,
            project: f.project || null,
            resultsFolder: f.folder.trim() || null,
          })
        : await api.createAutomation({
            ...common,
            ...(f.project ? { project: f.project } : {}),
            ...(f.folder.trim() ? { resultsFolder: f.folder.trim() } : {}),
            status: draft ? 'draft' : 'active',
          });
      notify(
        a
          ? s.saved(saved.name)
          : draft
            ? s.savedDraft(saved.name)
            : s.ready(saved.name, saved.scheduleText),
      );
      go(automationPath(saved.id));
    } catch (err) {
      setFailure(describeError(err));
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(false);
  };

  const others = agents.filter((x) => x.id !== f.lead);
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-6"
      data-testid="automation-form"
      aria-labelledby={`${ids}-title`}
    >
      <h2 id={`${ids}-title`} className="px-1 text-title2 font-semibold text-ink">
        {a ? s.editTitle(a.name) : s.newTitle}
      </h2>

      <Group title={s.whatTitle}>
        <div className="grid gap-5 px-4 pt-1 pb-4">
          <Field id={`${ids}-name`} label={s.name} error={errors.name}>
            <Input
              id={`${ids}-name`}
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={s.namePlaceholder}
              maxLength={80}
              aria-invalid={errors.name ? true : undefined}
              data-testid="form-name"
            />
          </Field>
          <Field id={`${ids}-objective`} label={s.goal} hint={s.goalHint} error={errors.objective}>
            <textarea
              id={`${ids}-objective`}
              value={f.objective}
              onChange={(e) => set({ objective: e.target.value })}
              rows={5}
              maxLength={8000}
              aria-invalid={errors.objective ? true : undefined}
              data-testid="form-objective"
              placeholder={s.goalPlaceholder}
              className="well min-h-[132px] w-full resize-y rounded-[10px] px-3.5 py-3 text-large leading-[1.5] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-stop"
            />
          </Field>
        </div>
      </Group>

      <Group title={s.whenTitle}>
        <div className="grid gap-5 px-4 pt-1 pb-4">
          <Segmented<SchedulePreset>
            value={f.schedule.preset}
            onChange={choosePreset}
            options={PRESET_IDS.map((value) => ({ value, label: s.presets[value] }))}
            label={s.whenLabel}
            size="sm"
            className="grid w-full grid-cols-2 gap-y-1.5 min-[560px]:inline-flex min-[560px]:w-auto [&>button]:px-3"
          />
          {f.schedule.preset === 'weekly' && (
            <div className="grid gap-2">
              <Label id={`${ids}-days`}>{s.day}</Label>
              <div role="group" aria-labelledby={`${ids}-days`} className="flex flex-wrap gap-1.5">
                {weekdayKeys().map((d) => (
                  <Chip
                    key={d.day}
                    pressed={f.schedule.weekdays.includes(d.day)}
                    onClick={() => toggleDay(d.day)}
                    className="h-10 px-3.5 text-body"
                  >
                    <span aria-hidden>{d.short}</span>
                    <span className="sr-only">{d.long}</span>
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {f.schedule.preset !== 'advanced' && (
            <div className="flex flex-wrap gap-4">
              {f.schedule.preset === 'monthly' && (
                <Field id={`${ids}-dom`} label={s.dayOfMonth}>
                  <select
                    id={`${ids}-dom`}
                    value={f.schedule.monthDay}
                    onChange={(e) => setSchedule({ monthDay: Number(e.target.value) })}
                    className="well set-select h-11 w-32 rounded-[10px] pr-9 pl-3.5 text-body text-ink focus:outline-2 focus:outline-signal-ink"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {s.monthDay(n)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field id={`${ids}-time`} label={s.at}>
                <Input
                  id={`${ids}-time`}
                  type="time"
                  value={f.schedule.time}
                  onChange={(e) => setSchedule({ time: e.target.value })}
                  className="w-36 tabular-nums"
                  data-testid="form-time"
                />
              </Field>
            </div>
          )}
          {f.schedule.preset === 'advanced' && (
            <Field id={`${ids}-cron`} label={s.cronRule} hint={s.cronHint}>
              <Input
                id={`${ids}-cron`}
                value={f.schedule.cron}
                onChange={(e) => setSchedule({ cron: e.target.value })}
                spellCheck={false}
                autoCapitalize="off"
                className="font-mono text-footnote"
                placeholder="0 23 * * 0"
                data-testid="form-cron"
              />
            </Field>
          )}
          <Field id={`${ids}-tz`} label={s.timezone}>
            <select
              id={`${ids}-tz`}
              value={f.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
              className="well set-select h-11 w-full max-w-[320px] rounded-[10px] pr-9 pl-3.5 text-body text-ink focus:outline-2 focus:outline-signal-ink"
            >
              {tzList.map((z) => (
                <option key={z} value={z}>
                  {z === userTimeZone() ? `${z} (${s.yours})` : z}
                </option>
              ))}
            </select>
          </Field>
          <div
            className="screen grid gap-1.5 rounded-[12px] px-4 py-3"
            aria-live="polite"
            data-testid="form-schedule-preview"
          >
            {scheduleOk ? (
              <>
                <p
                  className="text-large font-semibold text-screen-ink"
                  data-testid="form-schedule-text"
                >
                  {scheduleText(cron, f.timezone)}
                </p>
                <p className="font-mono text-micro tracking-[0.06em] text-screen-muted uppercase">
                  {s.nextRuns}
                </p>
                <ol
                  className="grid gap-0.5 font-mono text-caption text-screen-ink tabular-nums"
                  data-testid="form-next-runs"
                >
                  {preview.map((t) => (
                    <li key={t}>{formatWhen(t)}</li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="font-mono text-micro tracking-[0.06em] text-screen-stop uppercase">
                {errors.schedule ?? s.invalidRule}
              </p>
            )}
          </div>
        </div>
      </Group>

      <Group label={s.moreOptions}>
        <DisclosureRow
          as="div"
          label={s.moreOptions}
          description={s.moreOptionsHint}
          open={more}
          onOpenChange={setMore}
          testId="form-more"
        >
          <div className="grid gap-5 px-4 pt-3 pb-4">
            {(live.length > 0 || f.project) && (
              <div className="grid gap-2">
                <Label id={`${ids}-squad`}>{s.squad}</Label>
                <div
                  role="group"
                  aria-labelledby={`${ids}-squad`}
                  className="flex flex-wrap gap-2"
                  data-testid="automation-squad-pick"
                >
                  {[{ id: '', name: personalSquad() }, ...live].map((p) => (
                    <Chip
                      key={p.id || 'personale'}
                      pressed={f.project === p.id}
                      onClick={() => chooseSquad(p.id)}
                    >
                      {p.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label id={`${ids}-lead`}>{s.lead}</Label>
              <p className="text-footnote text-ink-muted">{s.leadHint}</p>
              <div
                role="radiogroup"
                aria-labelledby={`${ids}-lead`}
                className="flex flex-wrap gap-2.5 pb-1"
              >
                {agents.map((x) => (
                  <MonsterKey
                    key={x.id}
                    agent={x}
                    role="radio"
                    pressed={f.lead === x.id}
                    onClick={() => chooseLead(x.id)}
                  />
                ))}
              </div>
            </div>
            {others.length > 0 && (
              <div className="grid gap-2">
                <Label id={`${ids}-crew`}>{s.takingPart}</Label>
                <p className="text-footnote text-ink-muted">{s.takingPartHint}</p>
                <div
                  role="group"
                  aria-labelledby={`${ids}-crew`}
                  className="flex flex-wrap gap-2.5 pb-1"
                >
                  {others.map((x) => (
                    <MonsterKey
                      key={x.id}
                      agent={x}
                      role="checkbox"
                      pressed={f.participants.includes(x.id)}
                      onClick={() => toggleParticipant(x.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            <Field id={`${ids}-folder`} label={s.folder} hint={s.folderHint} error={errors.folder}>
              <Input
                id={`${ids}-folder`}
                value={f.folder}
                onChange={(e) => set({ folder: e.target.value })}
                placeholder={s.folderPlaceholder}
                aria-invalid={errors.folder ? true : undefined}
                data-testid="form-folder"
              />
            </Field>
            <Field
              id={`${ids}-eur`}
              label={s.capPerRun}
              hint={errors.limits ? undefined : s.capHint}
              error={errors.limits}
            >
              <Input
                id={`${ids}-eur`}
                inputMode="decimal"
                value={f.maxEur}
                onChange={(e) => set({ maxEur: e.target.value })}
                placeholder="2"
                className="w-36"
                aria-invalid={errors.limits ? true : undefined}
                data-testid="form-cap-eur"
              />
            </Field>
          </div>
          <div className="seam-t">
            <p className="label px-4 pt-3 text-ink-muted">{s.noticesTitle}</p>
            <Row label={s.inApp} description={s.inAppHint}>
              <Switch
                checked={f.notifyApp}
                onCheckedChange={(v) => set({ notifyApp: v })}
                label={s.inAppLabel}
              />
            </Row>
            <Row label={s.telegram} description={s.telegramHint}>
              <Switch
                checked={f.notifyTelegram}
                onCheckedChange={(v) => set({ notifyTelegram: v })}
                label={s.telegramLabel}
              />
            </Row>
          </div>
          <div className="seam-t">
            <DisclosureRow
              as="div"
              advanced
              label={s.advanced}
              description={s.advancedHint}
              open={advanced}
              onOpenChange={setAdvanced}
              testId="form-advanced"
            >
              <div className="grid gap-3 px-4 py-3 min-[560px]:grid-cols-2">
                <Field id={`${ids}-steps`} label={s.steps}>
                  <Input
                    id={`${ids}-steps`}
                    inputMode="numeric"
                    value={f.maxSteps}
                    onChange={(e) => set({ maxSteps: e.target.value })}
                    placeholder="60"
                    data-testid="form-cap-steps"
                  />
                </Field>
                <Field id={`${ids}-tokens`} label={s.tokens}>
                  <Input
                    id={`${ids}-tokens`}
                    inputMode="numeric"
                    value={f.maxTokens}
                    onChange={(e) => set({ maxTokens: e.target.value })}
                    placeholder="200000"
                    data-testid="form-cap-tokens"
                  />
                </Field>
              </div>
            </DisclosureRow>
          </div>
        </DisclosureRow>
      </Group>

      {failure && (
        <p role="alert" className="rounded-[12px] bg-stop-soft px-4 py-3 text-body text-stop-ink">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5 pb-4">
        <Button type="submit" disabled={busy} data-testid="form-save">
          {a ? s.save : s.create}
        </Button>
        {!a && (
          <Button variant="secondary" onClick={() => void submit(true)} disabled={busy}>
            {s.saveDraft}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => openPage(a ? automationPath(a.id) : automationPath())}
          disabled={busy}
        >
          {s.cancel}
        </Button>
      </div>
    </form>
  );
}
