import { VaultFolderSchema, type AutomationView } from '@monsters/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { describeError } from '../../lib/api.ts';
import {
  cronOfForm,
  formatWhen,
  formOfCron,
  nextRuns,
  scheduleText,
  userTimeZone,
  WEEKDAY_KEYS,
  type ScheduleForm,
  type SchedulePreset,
} from '../../lib/automations.ts';
import { PERSONAL_SQUAD } from '../../lib/automations.ts';
import { isLive } from '../../lib/projects.ts';
import { automationPath, openPage, useHashParam } from '../../lib/router.ts';
import { cn, domId } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { useAgents, useOrchestrator, type AgentView } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Group, Row } from '../settings/parts.tsx';
import { Button } from '../ui/button.tsx';
import { Chip, Segmented, Switch } from '../ui/controls.tsx';
import { Field, Input, Label } from '../ui/field.tsx';

/*
 * Create or change an automation (docs/design.md, "Automazioni"): the name
 * and the objective, the squad (the personal one or a project, D-100), the
 * capo and who takes part among its monsters (on their screens, as keys), when (ogni giorno / ogni settimana / ogni mese alle…, or the cron
 * rule under "Avanzato" with its description in Italian), with the next three
 * giri on a small screen, the folder of the results, the limits of one giro
 * and the notices. A new one can be saved as a draft, to finish later.
 */

const PRESETS: { value: SchedulePreset; label: string }[] = [
  { value: 'daily', label: 'Ogni giorno' },
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'advanced', label: 'Avanzato' },
];

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
    maxEur: a.limits.maxEur?.toLocaleString('it-IT') ?? '',
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

/** A number field read: undefined when empty, NaN when not a number. */
function numberOf(s: string): number | undefined {
  const t = s.trim().replace(/\./g, '').replace(',', '.');
  if (!t) return undefined;
  return Number(t);
}

function eurOf(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  if (!t) return undefined;
  return Number(t);
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
            {role === 'radio' ? 'Capo' : 'Partecipa'}
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

export function AutomationForm({ a }: { a: AutomationView | null }) {
  const allAgents = useAgents();
  const orch = useOrchestrator();
  const projects = useProjects();
  const live = (projects ?? []).filter(isLive);
  // "Nuova automazione" from a project's page (`&progetto=…`) starts in its squad.
  const fromProject = useHashParam('progetto') ?? '';
  const [f, setF] = useState<FormState>(() => {
    const project = a ? (a.project ?? '') : fromProject;
    const first = squadMembers(allAgents, project)[0]?.id;
    return initial(a, project ? (first ?? '') : (orch?.id ?? allAgents[0]?.id ?? ''), project);
  });
  const agents = squadMembers(allAgents, f.project);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = domId(useId());
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const setSchedule = (patch: Partial<ScheduleForm>) =>
    setF((s) => ({ ...s, schedule: { ...s.schedule, ...patch } }));

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
    if (!f.name.trim()) e.name = 'Dai un nome all’automazione.';
    if (!f.objective.trim()) e.objective = 'Scrivi cosa deve fare il capo a ogni giro.';
    if (!scheduleOk) {
      e.schedule =
        f.schedule.preset === 'weekly' && f.schedule.weekdays.length === 0
          ? 'Scegli almeno un giorno.'
          : f.schedule.preset === 'advanced'
            ? 'Questa regola non si capisce: servono cinque campi (minuto ora giorno mese giorno-della-settimana).'
            : 'Scrivi un’ora valida, per esempio 23:00.';
    }
    if (f.folder.trim() && !VaultFolderSchema.safeParse(f.folder.trim()).success) {
      e.folder =
        'Una cartella delle note, per esempio Social/Saturday (senza / all’inizio, senza ..).';
    }
    const steps = numberOf(f.maxSteps);
    const tokens = numberOf(f.maxTokens);
    const eur = eurOf(f.maxEur);
    if (
      (steps !== undefined && !(Number.isInteger(steps) && steps >= 1 && steps <= 2000)) ||
      (tokens !== undefined &&
        !(Number.isInteger(tokens) && tokens >= 1000 && tokens <= 50_000_000)) ||
      (eur !== undefined && !(eur >= 0.01 && eur <= 1000))
    ) {
      e.limits = 'Passi da 1 a 2000, token da 1.000 a 50 milioni, euro da 0,01 a 1000.';
    }
    return e;
  };

  const submit = async (draft: boolean) => {
    const e = check();
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length > 0) return;
    const steps = numberOf(f.maxSteps);
    const tokens = numberOf(f.maxTokens);
    const eur = eurOf(f.maxEur);
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
          ? `Ho salvato «${saved.name}».`
          : draft
            ? `«${saved.name}» è una bozza: la confermi quando vuoi.`
            : `«${saved.name}» è pronta: ${saved.scheduleText}.`,
      );
      window.location.hash = automationPath(saved.id);
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
        {a ? `Modifica «${a.name}»` : 'Nuova automazione'}
      </h2>

      <Group title="Cosa fa">
        <div className="grid gap-5 px-4 pt-1 pb-4">
          <Field id={`${ids}-name`} label="Nome" error={errors.name}>
            <Input
              id={`${ids}-name`}
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Post della settimana"
              maxLength={80}
              aria-invalid={errors.name ? true : undefined}
              data-testid="form-name"
            />
          </Field>
          <Field
            id={`${ids}-objective`}
            label="Obiettivo"
            hint="Il testo che il capo riceve a ogni giro: cosa fare, per chi, dove mettere i risultati."
            error={errors.objective}
          >
            <textarea
              id={`${ids}-objective`}
              value={f.objective}
              onChange={(e) => set({ objective: e.target.value })}
              rows={5}
              maxLength={8000}
              aria-invalid={errors.objective ? true : undefined}
              data-testid="form-objective"
              placeholder="Prepara i post della settimana che arriva: tre post con testo, hashtag e immagine."
              className="well min-h-[132px] w-full resize-y rounded-[10px] px-3.5 py-3 text-large leading-[1.5] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-stop"
            />
          </Field>
        </div>
      </Group>

      <Group title="Chi la fa">
        <div className="grid gap-5 px-4 pt-1 pb-4">
          {(live.length > 0 || f.project) && (
            <div className="grid gap-2">
              <Label id={`${ids}-squad`}>Squadra</Label>
              <div
                role="group"
                aria-labelledby={`${ids}-squad`}
                className="flex flex-wrap gap-2"
                data-testid="automation-squad-pick"
              >
                {[{ id: '', name: PERSONAL_SQUAD }, ...live].map((p) => (
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
            <Label id={`${ids}-lead`}>Capo</Label>
            <p className="text-footnote text-ink-muted">
              Riceve l’obiettivo e passa i compiti agli altri.
            </p>
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
              <Label id={`${ids}-crew`}>Partecipano</Label>
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
        </div>
      </Group>

      <Group title="Quando">
        <div className="grid gap-5 px-4 pt-1 pb-4">
          <Segmented<SchedulePreset>
            value={f.schedule.preset}
            onChange={choosePreset}
            options={PRESETS}
            label="Quando gira"
            size="sm"
            className="grid w-full grid-cols-2 gap-y-1.5 min-[560px]:inline-flex min-[560px]:w-auto [&>button]:px-3"
          />
          {f.schedule.preset === 'weekly' && (
            <div className="grid gap-2">
              <Label id={`${ids}-days`}>Il giorno</Label>
              <div role="group" aria-labelledby={`${ids}-days`} className="flex flex-wrap gap-1.5">
                {WEEKDAY_KEYS.map((d) => (
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
                <Field id={`${ids}-dom`} label="Il giorno del mese">
                  <select
                    id={`${ids}-dom`}
                    value={f.schedule.monthDay}
                    onChange={(e) => setSchedule({ monthDay: Number(e.target.value) })}
                    className="well set-select h-11 w-32 rounded-[10px] pr-9 pl-3.5 text-body text-ink focus:outline-2 focus:outline-signal-ink"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1°' : n}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field id={`${ids}-time`} label="Alle">
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
            <Field
              id={`${ids}-cron`}
              label="Regola cron"
              hint="Cinque campi: minuto, ora, giorno del mese, mese, giorno della settimana (0 = domenica)."
            >
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
          <Field id={`${ids}-tz`} label="Fuso orario">
            <select
              id={`${ids}-tz`}
              value={f.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
              className="well set-select h-11 w-full max-w-[320px] rounded-[10px] pr-9 pl-3.5 text-body text-ink focus:outline-2 focus:outline-signal-ink"
            >
              {tzList.map((z) => (
                <option key={z} value={z}>
                  {z === userTimeZone() ? `${z} (il tuo)` : z}
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
                  Prossimi giri
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
                {errors.schedule ?? 'Regola non valida'}
              </p>
            )}
          </div>
        </div>
      </Group>

      <Group title="Risultati e limiti">
        <div className="grid gap-5 px-4 pt-1 pb-4">
          <Field
            id={`${ids}-folder`}
            label="Cartella delle note"
            hint="Dove il capo salva i risultati. Vuota: decide lui."
            error={errors.folder}
          >
            <Input
              id={`${ids}-folder`}
              value={f.folder}
              onChange={(e) => set({ folder: e.target.value })}
              placeholder="Social/Saturday"
              aria-invalid={errors.folder ? true : undefined}
              data-testid="form-folder"
            />
          </Field>
          <div className="grid gap-2">
            <p className="text-footnote font-medium text-ink">Tetto per giro</p>
            <div className="grid gap-3 min-[560px]:grid-cols-3">
              <Field id={`${ids}-steps`} label="Passi">
                <Input
                  id={`${ids}-steps`}
                  inputMode="numeric"
                  value={f.maxSteps}
                  onChange={(e) => set({ maxSteps: e.target.value })}
                  placeholder="60"
                />
              </Field>
              <Field id={`${ids}-tokens`} label="Quantità di lavoro (token)">
                <Input
                  id={`${ids}-tokens`}
                  inputMode="numeric"
                  value={f.maxTokens}
                  onChange={(e) => set({ maxTokens: e.target.value })}
                  placeholder="200000"
                />
              </Field>
              <Field id={`${ids}-eur`} label="Euro">
                <Input
                  id={`${ids}-eur`}
                  inputMode="decimal"
                  value={f.maxEur}
                  onChange={(e) => set({ maxEur: e.target.value })}
                  placeholder="2"
                />
              </Field>
            </div>
            {errors.limits ? (
              <p className="text-footnote text-on-danger-soft" role="alert">
                {errors.limits}
              </p>
            ) : (
              <p className="text-footnote text-ink-faint">
                Vuoti: valgono i limiti di ogni lavoro. Gli euro contano solo sui modelli a consumo.
              </p>
            )}
          </div>
        </div>
      </Group>

      <Group title="Avvisi a fine giro">
        <Row label="Nell’app" description="Un avviso quando il giro finisce o ha bisogno di te.">
          <Switch
            checked={f.notifyApp}
            onCheckedChange={(v) => set({ notifyApp: v })}
            label="Avviso nell’app"
          />
        </Row>
        <Row label="Su Telegram" description="Un messaggio dal bot, se l’hai collegato.">
          <Switch
            checked={f.notifyTelegram}
            onCheckedChange={(v) => set({ notifyTelegram: v })}
            label="Avviso su Telegram"
          />
        </Row>
      </Group>

      {failure && (
        <p role="alert" className="rounded-[12px] bg-stop-soft px-4 py-3 text-body text-stop-ink">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5 pb-4">
        <Button type="submit" disabled={busy} data-testid="form-save">
          {a ? 'Salva' : 'Crea automazione'}
        </Button>
        {!a && (
          <Button variant="secondary" onClick={() => void submit(true)} disabled={busy}>
            Salva come bozza
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => openPage(a ? automationPath(a.id) : automationPath())}
          disabled={busy}
        >
          Annulla
        </Button>
      </div>
    </form>
  );
}
