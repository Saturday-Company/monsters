import {
  formatEur,
  formatNumber,
  matchRunLimitsPreset,
  RUN_LIMIT_BOUNDS,
  RUN_LIMIT_PRESETS,
  runLimitsUpdateFor,
  SETTINGS_SECTIONS,
  USD_TO_EUR_DEFAULT,
  type RunLimitPreset,
  type RunLimitsUpdate,
  type RunLimitsValues,
  type RunLimitsView,
} from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { domId, parseAmount } from '../../lib/utils.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { setUsdToEur } from '../../store/derive.ts';
import { Button } from '../ui/button.tsx';
import { Segmented } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { limitsStrings } from './limits.strings.ts';
import { useSettingsTarget } from './settings-target.ts';
import { DisclosureRow, FormField, LoadFailed, RowBody, useRetry } from './parts.tsx';

/*
 * Settings → Models → Spending cap → Safety net (D-064, C2): what stops a job that runs away. Opened,
 * three keys (Careful / Normal / Generous, or "Custom" when the values match none) set the limits at
 * once; the steps, tokens, cost and delegations one by one sit in the Advanced drawer "Exact limits",
 * for the models paid per use and, apart, for the plans. A closed row under the cap (D-167: no
 * section of its own); it reads the core only when opened. Used by the jobs that start from now on.
 *
 * The core keeps the cost of a job in dollars, as the providers bill it. The settings show euros,
 * at the rate the spending cap uses (`SpendView.usdToEur`), and convert back when saving.
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

/** A cost in dollars (the core's) as the text of its field in euros, to the cent. */
const eurTextOf = (usd: number, rate: number) => asText(Math.round(usd * rate * 100) / 100);

type Texts = Record<string, string>;
const textsOf = (v: RunLimitsValues, rate: number): Texts =>
  Object.fromEntries(
    FIELDS.map((f) => [
      f.id,
      f.kind === 'costUsd' ? eurTextOf(v.maxRunCostUsd, rate) : asText(valueOf(v, f)),
    ]),
  );

/** The bounds of a field as shown: the cost's in euros, rounded inwards to the cent. */
function boundsShown(f: Field, rate: number): { min: number; max: number } {
  const { min, max } = RUN_LIMIT_BOUNDS[f.kind];
  if (f.kind !== 'costUsd') return { min, max };
  return { min: Math.ceil(min * rate * 100) / 100, max: Math.floor(max * rate * 100) / 100 };
}

/**
 * The fields whose text differs from what `view.limits` shows, as an update; or the first one that
 * is not valid. The cost is typed in euros and sent in dollars.
 */
function updateFrom(
  texts: Texts,
  view: RunLimitsView,
  rate: number,
): { update: RunLimitsUpdate } | { invalid: Field } {
  const update: RunLimitsUpdate = {};
  const shown = textsOf(view.limits, rate);
  for (const f of FIELDS) {
    const n = parseAmount(texts[f.id] ?? '');
    const { min, max } = RUN_LIMIT_BOUNDS[f.kind];
    const isCost = f.kind === 'costUsd';
    // The text of the cost as the core's figure shows it is not a change (the euro rounds).
    if (texts[f.id] === shown[f.id]) continue;
    const value = n == null ? n : isCost ? Math.round((n / rate) * 10_000) / 10_000 : n;
    if (
      value == null ||
      value < min - 1e-9 ||
      value > max + 1e-9 ||
      (!isCost && !Number.isInteger(value))
    )
      return { invalid: f };
    const clamped = Math.min(max, Math.max(min, value));
    if (clamped === valueOf(view.limits, f)) continue;
    if (f.group === 'plan') update.plan = { ...update.plan, [f.name]: clamped };
    else (update as Record<string, number>)[f.name] = clamped;
  }
  return { update };
}

function LimitsForm({
  initial,
  rate,
  exactOpen,
}: {
  initial: RunLimitsView;
  rate: number;
  exactOpen: boolean;
}) {
  const s = limitsStrings();
  const id = domId(useId());
  const [view, setView] = useState(initial);
  const [texts, setTexts] = useState<Texts>(() => textsOf(initial.limits, rate));
  const [error, setError] = useState<string | null>(null);
  const [invalidId, setInvalidId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exact, setExact] = useState(exactOpen);

  const shown = textsOf(view.limits, rate);
  const changed = FIELDS.some((f) => texts[f.id] !== shown[f.id]);
  const atDefaults = FIELDS.every((f) => valueOf(view.limits, f) === valueOf(view.defaults, f));
  const preset = matchRunLimitsPreset(view.limits, view.defaults);

  const apply = (next: RunLimitsView) => {
    setView(next);
    setTexts(textsOf(next.limits, rate));
    setError(null);
    setInvalidId(null);
  };

  const choose = async (next: RunLimitPreset) => {
    if (busy || next === preset) return;
    setBusy(true);
    try {
      apply(await getApi().setRunLimits(runLimitsUpdateFor(next, view.limits, view.defaults)));
      notify(s.presetSaved(s.presets[next]), 'success');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateFrom(texts, view, rate);
    if ('invalid' in parsed) {
      const f = parsed.invalid;
      const { min, max } = boundsShown(f, rate);
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
              f.kind === 'costUsd'
                ? eurTextOf(view.defaults.maxRunCostUsd, rate)
                : formatNumber(valueOf(view.defaults, f), { maximumFractionDigits: 2 }),
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

  const eur = formatEur(view.limits.maxRunCostUsd * rate);
  return (
    <>
      <RowBody>
        <p className="max-w-[62ch] text-footnote leading-snug text-ink-muted">{s.intro}</p>
        <div className="grid gap-2" data-testid="limits-presets">
          <Segmented<RunLimitPreset>
            value={preset === 'custom' ? null : preset}
            onChange={(p) => void choose(p)}
            options={RUN_LIMIT_PRESETS.map((value) => ({ value, label: s.presets[value] }))}
            label={s.presetsLabel}
            size="sm"
            className="w-full max-w-[420px] [&>button]:flex-1"
            fill
          />
          <p
            className="text-footnote leading-snug text-ink-muted"
            data-testid="limits-preset-hint"
            data-preset={preset}
          >
            {preset === 'custom' ? (
              <>
                <span className="label mr-1.5 text-ink" data-testid="limits-custom">
                  {s.custom}
                </span>
                {s.presetHint.custom}
              </>
            ) : (
              s.presetHint[preset](eur)
            )}{' '}
            {s.plansKeep}
          </p>
        </div>
      </RowBody>
      <div className="seam-t">
        <DisclosureRow
          as="div"
          advanced
          label={s.exact}
          description={s.exactHint}
          open={exact}
          onOpenChange={setExact}
          testId="limits-exact"
        >
          <RowBody>
            <form onSubmit={(e) => void save(e)} className="grid gap-4" data-testid="limits-form">
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
        </DisclosureRow>
      </div>
      {!exact && error && (
        <RowBody>
          <p className="text-footnote text-stop-ink" role="alert" data-testid="limits-error">
            {error}
          </p>
        </RowBody>
      )}
    </>
  );
}

/** The closed row under the spending cap; it reads the limits (and the rate of the cap) when opened. */
export function RunLimitsRow() {
  const s = limitsStrings();
  const target = useSettingsTarget();
  const [open, setOpen] = useState(false);
  // A link to it (`?sezione=limiti`, from the line of a job that stopped at a limit) opens the row
  // and its exact limits: the job may have stopped at steps or tokens, which are only there.
  const [linked, setLinked] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  if (target !== seen) {
    setSeen(target);
    if (target === 'limiti') {
      setOpen(true);
      setLinked(true);
    }
  }
  const [loaded, setLoaded] = useState<{ view: RunLimitsView; rate: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useRetry(() => setFailed(false));
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const api = getApi();
    Promise.all([
      api.runLimits(),
      // The rate of the spending cap; the default one if the cap cannot be read.
      api.spend().then(
        (v) => v.usdToEur,
        () => USD_TO_EUR_DEFAULT,
      ),
    ])
      .then(([view, rate]) => {
        setUsdToEur(rate);
        if (!alive) return;
        setLoaded({ view, rate });
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, attempt]);

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
          if (!o) {
            setLoaded(null);
            setLinked(false);
          }
        }}
        testId="limits-toggle"
      >
        {failed ? (
          <RowBody>
            <LoadFailed what={s.what} onRetry={retry} />
          </RowBody>
        ) : loaded ? (
          <LimitsForm initial={loaded.view} rate={loaded.rate} exactOpen={linked} />
        ) : null}
      </DisclosureRow>
    </div>
  );
}
