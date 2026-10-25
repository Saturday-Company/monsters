import {
  formatNumber,
  RUN_LIMIT_BOUNDS,
  SETTINGS_SECTIONS,
  type RunLimitsUpdate,
  type RunLimitsValues,
  type RunLimitsView,
} from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { domId, parseAmount } from '../../lib/utils.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { limitsStrings } from './limits.strings.ts';
import { useSettingsTarget } from './settings-target.ts';
import { DisclosureRow, FormField, RowBody } from './parts.tsx';

/*
 * Settings → Models → Spending cap → Limits of each job (D-064): the steps, tokens, cost and
 * delegations that stop a job that runs away, for the models paid per use and, apart, for the
 * subscriptions. A closed row under the cap (D-167: no section of its own); it reads the core
 * only when opened. Saved at once, used by the jobs that start from now on.
 */

type ApiName =
  'maxRunSteps' | 'maxRunTokens' | 'maxSubagentTokens' | 'maxRunCostUsd' | 'maxDelegationsPerRun';
type PlanName = 'maxRunSteps' | 'maxRunTokens' | 'maxSubagentTokens';

interface Field {
  /** Test id suffix and DOM id part. */
  id: string;
  group: 'api' | 'plan';
  name: ApiName | PlanName;
  kind: keyof typeof RUN_LIMIT_BOUNDS;
  label: 'steps' | 'tokens' | 'subagentTokens' | 'cost' | 'delegations';
}

const API_FIELDS: readonly Field[] = [
  { id: 'steps', group: 'api', name: 'maxRunSteps', kind: 'steps', label: 'steps' },
  { id: 'tokens', group: 'api', name: 'maxRunTokens', kind: 'tokens', label: 'tokens' },
  {
    id: 'agent-tokens',
    group: 'api',
    name: 'maxSubagentTokens',
    kind: 'tokens',
    label: 'subagentTokens',
  },
  { id: 'cost', group: 'api', name: 'maxRunCostUsd', kind: 'costUsd', label: 'cost' },
  {
    id: 'delegations',
    group: 'api',
    name: 'maxDelegationsPerRun',
    kind: 'delegations',
    label: 'delegations',
  },
];
const PLAN_FIELDS: readonly Field[] = [
  { id: 'plan-steps', group: 'plan', name: 'maxRunSteps', kind: 'steps', label: 'steps' },
  { id: 'plan-tokens', group: 'plan', name: 'maxRunTokens', kind: 'tokens', label: 'tokens' },
  {
    id: 'plan-agent-tokens',
    group: 'plan',
    name: 'maxSubagentTokens',
    kind: 'tokens',
    label: 'subagentTokens',
  },
];
const FIELDS = [...API_FIELDS, ...PLAN_FIELDS];

const valueOf = (v: RunLimitsValues, f: Field): number =>
  f.group === 'plan' ? v.plan[f.name as PlanName] : v[f.name];

// No grouping: a plain number is read back the same in both languages.
const asText = (n: number) => formatNumber(n, { maximumFractionDigits: 2, useGrouping: false });

type Texts = Record<string, string>;
const textsOf = (v: RunLimitsValues): Texts =>
  Object.fromEntries(FIELDS.map((f) => [f.id, asText(valueOf(v, f))]));

/** The fields whose text differs from `view.limits`, as an update; or the first one that is not valid. */
function updateFrom(
  texts: Texts,
  view: RunLimitsView,
): { update: RunLimitsUpdate } | { invalid: Field } {
  const update: RunLimitsUpdate = {};
  for (const f of FIELDS) {
    const n = parseAmount(texts[f.id] ?? '');
    const { min, max } = RUN_LIMIT_BOUNDS[f.kind];
    const whole = f.kind !== 'costUsd';
    if (n == null || n < min || n > max || (whole && !Number.isInteger(n))) return { invalid: f };
    if (n === valueOf(view.limits, f)) continue;
    if (f.group === 'plan') update.plan = { ...update.plan, [f.name]: n };
    else (update as Record<string, number>)[f.name] = n;
  }
  return { update };
}

function LimitsForm({ initial }: { initial: RunLimitsView }) {
  const s = limitsStrings();
  const id = domId(useId());
  const [view, setView] = useState(initial);
  const [texts, setTexts] = useState<Texts>(() => textsOf(initial.limits));
  const [error, setError] = useState<string | null>(null);
  const [invalidId, setInvalidId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = textsOf(view.limits);
  const changed = FIELDS.some((f) => texts[f.id] !== shown[f.id]);
  const atDefaults = FIELDS.every((f) => valueOf(view.limits, f) === valueOf(view.defaults, f));

  const apply = (next: RunLimitsView) => {
    setView(next);
    setTexts(textsOf(next.limits));
    setError(null);
    setInvalidId(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateFrom(texts, view);
    if ('invalid' in parsed) {
      const f = parsed.invalid;
      const { min, max } = RUN_LIMIT_BOUNDS[f.kind];
      setInvalidId(f.id);
      setError(s.invalid(s.fields[f.label], formatNumber(min), formatNumber(max)));
      return;
    }
    setBusy(true);
    try {
      apply(await getApi().setRunLimits(parsed.update));
      notify(s.saved, 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      apply(await getApi().resetRunLimits());
      notify(s.restored, 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const group = (
    key: 'api' | 'plan',
    title: string,
    hint: string,
    fields: readonly Field[],
  ): React.ReactNode => (
    <fieldset className="grid gap-3" data-testid={`limits-${key}`}>
      <legend className="mb-3 grid gap-0.5">
        <span className="label text-ink-muted">{title}</span>
        <span className="text-footnote leading-snug text-ink-muted">{hint}</span>
      </legend>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <FormField
            key={f.id}
            id={`${id}-${f.id}`}
            label={s.fields[f.label]}
            hint={s.defaultIs(
              formatNumber(valueOf(view.defaults, f), { maximumFractionDigits: 2 }),
            )}
          >
            <Input
              id={`${id}-${f.id}`}
              inputMode={f.kind === 'costUsd' ? 'decimal' : 'numeric'}
              value={texts[f.id] ?? ''}
              onChange={(e) => setTexts((t) => ({ ...t, [f.id]: e.target.value }))}
              aria-invalid={invalidId === f.id ? true : undefined}
              data-testid={`limits-${f.id}`}
            />
          </FormField>
        ))}
      </div>
    </fieldset>
  );

  return (
    <RowBody>
      <form onSubmit={(e) => void save(e)} className="grid gap-4" data-testid="limits-form">
        <p className="max-w-[62ch] text-footnote leading-snug text-ink-muted">{s.intro}</p>
        {group('api', s.groups.api, s.groups.apiHint, API_FIELDS)}
        {group('plan', s.groups.plan, s.groups.planHint, PLAN_FIELDS)}
        {error && (
          <p className="text-footnote text-stop-ink" role="alert" data-testid="limits-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || (atDefaults && !changed)}
            onClick={() => void restore()}
            data-testid="limits-reset"
          >
            {s.restore}
          </Button>
          <Button
            type="submit"
            variant={changed ? 'primary' : 'secondary'}
            size="sm"
            disabled={busy || !changed}
            data-testid="limits-save"
          >
            {s.save}
          </Button>
        </div>
      </form>
    </RowBody>
  );
}

/** The closed row under the spending cap; it reads the limits when opened. */
export function RunLimitsRow() {
  const s = limitsStrings();
  const target = useSettingsTarget();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  // A link to it (`?sezione=limiti`, from the line of a job that stopped at a limit) opens it.
  if (target !== seen) {
    setSeen(target);
    if (target === 'limiti') setOpen(true);
  }
  const [view, setView] = useState<RunLimitsView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getApi()
      .runLimits()
      .then((v) => alive && (setView(v), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <div id="settings-limiti" className="scroll-mt-4" data-testid="limits-row">
      <DisclosureRow
        as="div"
        label={SETTINGS_SECTIONS.limiti.label}
        description={s.rowHint}
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // Read again when it opens: the form keeps its own copy while it is open.
          if (!o) setView(null);
        }}
        testId="limits-toggle"
      >
        {failed ? (
          <RowBody>
            <p className="text-footnote text-ink-muted" role="status">
              {s.failed}
            </p>
          </RowBody>
        ) : view ? (
          <LimitsForm initial={view} />
        ) : null}
      </DisclosureRow>
    </div>
  );
}
