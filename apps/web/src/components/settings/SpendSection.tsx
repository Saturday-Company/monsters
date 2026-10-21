import {
  formatEur,
  formatList,
  formatNumber,
  type SpendMeterView,
  type SpendUpdate,
  type SpendView,
  SETTINGS_SECTIONS,
} from '@monsters/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { domId, parseAmount } from '../../lib/utils.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { AgentMark, DisclosureRow, FormField, Group, Row, RowBody, Status } from './parts.tsx';
import { spendStrings } from './spend.strings.ts';

/*
 * Settings → Models → Spending cap (D-070): what the monsters spent today
 * and this month with paid models, against the caps of the team and, when
 * set, of a monster. A cap reached stops only the work that costs money;
 * subscriptions and free models are counted apart, in the footer. The numbers
 * sit on a small screen with ten segments: the light turns signal at 80%,
 * stop at 100%.
 */

/** Ten segments on a small screen: the share of the cap spent. */
export function SpendDisplay({ meter, testId }: { meter: SpendMeterView; testId?: string }) {
  const ratio = meter.ratio ?? 0;
  const on = meter.capEur === null ? 0 : Math.min(10, Math.ceil(ratio * 10 - 1e-9));
  const lit = ratio >= 1 ? 'var(--stop)' : ratio >= 0.8 ? 'var(--signal)' : 'var(--screen-ink)';
  return (
    <span
      className="screen inline-flex h-8 items-center gap-2.5 rounded-[8px] px-2.5"
      data-testid={testId}
      data-level={ratio >= 1 ? 'stopped' : ratio >= 0.8 ? 'warning' : 'ok'}
    >
      <span aria-hidden className="flex items-center gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <i
            key={i}
            className="block h-[12px] w-[4px] rounded-[1px]"
            style={{ background: i < on ? lit : 'var(--screen-off)' }}
          />
        ))}
      </span>
      <span className="font-mono text-micro leading-none tracking-[0.04em] text-screen-ink tabular-nums">
        {formatEur(meter.spentEur)}
        {meter.capEur !== null ? ` / ${formatEur(meter.capEur)}` : ''}
      </span>
    </span>
  );
}

/** The screen already says "spent / cap": a line under it only when there is no cap to compare to. */
export function noCapNote(meter: SpendMeterView): string | undefined {
  return meter.capEur === null ? spendStrings().noCap : undefined;
}

/** One link of the chain of caps: a monster, the project, the whole team. */
export interface CapLink {
  id: 'monster' | 'project' | 'team';
  label: string;
  /** Whose cap it is, when it is one among many (the monster closest to its cap). */
  who?: string | undefined;
  /** The day or month meter closest to its cap; null when there is no cap. */
  meter: SpendMeterView | null;
  period?: 'oggi' | 'mese';
}

/** Of a day and a month meter, the one closest to its cap (with a cap); null when neither has one. */
export function closestMeter(
  day: SpendMeterView,
  month: SpendMeterView,
): { meter: SpendMeterView; period: 'oggi' | 'mese' } | null {
  const days = day.capEur !== null ? { meter: day, period: 'oggi' as const } : null;
  const months = month.capEur !== null ? { meter: month, period: 'mese' as const } : null;
  if (days && months) return (days.meter.ratio ?? 0) > (months.meter.ratio ?? 0) ? days : months;
  return days ?? months;
}

/** Of several owners of caps (monsters, projects), the one closest to its cap. */
export function closestOf(
  items: readonly { name: string; day: SpendMeterView; month: SpendMeterView }[],
): { who: string; meter: SpendMeterView; period: 'oggi' | 'mese' } | null {
  let best: { who: string; meter: SpendMeterView; period: 'oggi' | 'mese' } | null = null;
  for (const i of items) {
    const c = closestMeter(i.day, i.month);
    if (c && (!best || (c.meter.ratio ?? 0) > (best.meter.ratio ?? 0)))
      best = { who: i.name, ...c };
  }
  return best;
}

/** The id of the link closest to its threshold (spent > 0), or null when nothing has spent. */
export function hotLink(links: readonly CapLink[]): CapLink['id'] | null {
  let best: CapLink | null = null;
  for (const l of links) {
    if (!l.meter || (l.meter.ratio ?? 0) <= 0) continue;
    if (!best || (l.meter.ratio ?? 0) > (best.meter!.ratio ?? 0)) best = l;
  }
  return best?.id ?? null;
}

/**
 * A cap higher than one that holds it (a monster above its project or the team, a project above
 * the team) can never be the first to stop anything: one sentence per such link, said plainly.
 * Only caps of the same period (a day, a month) can be compared.
 */
export function capWarnings(links: readonly CapLink[]): string[] {
  const out: string[] = [];
  links.forEach((inner, i) => {
    if (!inner.meter || inner.meter.capEur === null || !inner.period) return;
    for (const outer of links.slice(i + 1)) {
      if (!outer.meter || outer.meter.capEur === null || outer.period !== inner.period) continue;
      if (inner.meter.capEur <= outer.meter.capEur) continue;
      out.push(
        spendStrings().higherThan(
          inner.who ? `${inner.label} (${inner.who})` : inner.label,
          outer.id,
        ),
      );
      break;
    }
  });
  return out;
}

/**
 * "Monster ≤ Project ≤ Whole squad" (U-13): the three caps in the order they
 * hold, on a small screen, the one closest to its threshold lit. At the top of
 * every view of Spending, so the caps are said once, here.
 */
export function CapChain({ links, testId }: { links: readonly CapLink[]; testId: string }) {
  const hot = hotLink(links);
  const hotLabel = links.find((l) => l.id === hot);
  const warnings = capWarnings(links);
  return (
    <div
      role="group"
      aria-label={spendStrings().chainLabel(
        links.map((l) => l.label),
        hotLabel?.label ?? null,
      )}
      className="screen mx-4 my-3 flex flex-wrap items-stretch gap-x-2 gap-y-2 rounded-[10px] px-3 py-2.5"
      data-testid={testId}
      data-hot={hot ?? undefined}
    >
      {links.map((l, i) => {
        const isHot = l.id === hot;
        // Each "≤" travels with the link that follows it: the chain wraps between pairs.
        return (
          <div key={l.id} className="flex items-stretch gap-x-2">
            {i > 0 && (
              <span aria-hidden className="self-center font-mono text-footnote text-screen-muted">
                ≤
              </span>
            )}
            <div
              className={isHot ? 'grid gap-0.5 text-screen-ink' : 'grid gap-0.5 text-screen-muted'}
              data-testid={`${testId}-${l.id}`}
              data-hot={isHot ? 'true' : undefined}
            >
              <span className="label flex items-center gap-1.5">
                {isHot && <span aria-hidden className="led" data-tone="signal" />}
                {l.label}
              </span>
              <span className="font-mono text-micro tabular-nums">
                {l.meter
                  ? `${formatEur(l.meter.spentEur)} / ${formatEur(l.meter.capEur ?? 0)} ${l.period ? spendStrings().period[l.period] : ''}`
                  : spendStrings().noCapShort}
                {l.who ? ` · ${l.who}` : ''}
              </span>
            </div>
          </div>
        );
      })}
      {warnings.length > 0 && (
        <div className="grid basis-full gap-0.5" data-testid={`${testId}-warning`}>
          {warnings.map((w) => (
            <p key={w} className="text-footnote leading-snug text-screen-ink">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What the cap cannot count (D-114): paid models whose price Monsters does not
 * know. They are not stopped, so the card says it plainly; null when there are none.
 */
export function unpricedNotice(labels: readonly string[], whose?: string): string | null {
  const names = [...new Set(labels)];
  if (names.length === 0) return null;
  return spendStrings().unpriced(names, whose);
}

/**
 * Direct keys priced by OpenRouter's public list (D-114): the cap counts them at an estimated
 * cost and stops them like the others; null when there are none.
 */
export function estimatedNotice(labels: readonly string[], whose?: string): string | null {
  const names = [...new Set(labels)];
  if (names.length === 0) return null;
  return spendStrings().estimated(names, whose);
}

/** "12,5" or "12.5" → 12.5; empty → null (no cap); not a number or below 0,50 → undefined. */
export function parseEur(text: string): number | null | undefined {
  const n = parseAmount(text);
  return n === null ? null : n !== undefined && n >= 0.5 ? n : undefined;
}

// No grouping: the field is read back by `parseAmount`, where a "," or a "." may be a decimal mark.
const eurText = (v: number | null | undefined) =>
  v == null ? '' : formatNumber(v, { maximumFractionDigits: 2, useGrouping: false });

/** Two fields (a day, a month) and "Save": the caps of the team or of one monster. */
export function CapsForm({
  daily,
  monthly,
  onSave,
  testId,
  dailyRef,
  emptyHint,
}: {
  daily: number | null | undefined;
  monthly: number | null | undefined;
  onSave: (caps: { dailyEur: number | null; monthlyEur: number | null }) => Promise<void>;
  testId: string;
  dailyRef?: React.RefObject<HTMLInputElement | null>;
  emptyHint: string;
}) {
  const s = spendStrings();
  const id = domId(useId());
  const [day, setDay] = useState(eurText(daily));
  const [month, setMonth] = useState(eurText(monthly));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // New caps from the core (saved here or elsewhere): the fields follow.
  const [shown, setShown] = useState({ daily, monthly });
  if (shown.daily !== daily || shown.monthly !== monthly) {
    setShown({ daily, monthly });
    setDay(eurText(daily));
    setMonth(eurText(monthly));
  }
  const changed = day !== eurText(daily) || month !== eurText(monthly);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const d = parseEur(day);
    const m = parseEur(month);
    if (d === undefined || m === undefined) {
      setError(s.form.invalid);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSave({ dailyEur: d, monthlyEur: m });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3" data-testid={testId}>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <FormField id={`${id}-day`} label={s.form.day}>
          <Input
            id={`${id}-day`}
            ref={dailyRef}
            inputMode="decimal"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-invalid={error ? true : undefined}
            data-testid={`${testId}-day`}
          />
        </FormField>
        <FormField id={`${id}-month`} label={s.form.month}>
          <Input
            id={`${id}-month`}
            inputMode="decimal"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-invalid={error ? true : undefined}
            data-testid={`${testId}-month`}
          />
        </FormField>
      </div>
      {/* One hint for both fields, under the pair: under one alone it pushed the other out of line. */}
      {error ? (
        <p className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-footnote leading-snug text-ink-muted">{emptyHint}</p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant={changed ? 'primary' : 'secondary'}
          size="sm"
          disabled={busy || !changed}
          data-testid={`${testId}-save`}
        >
          {s.save}
        </Button>
      </div>
    </form>
  );
}

/** A chain link from the closest meter (or none): `meter`, `period`, and `who` when it is one of many. */
export function chainOf(
  c: { meter: SpendMeterView; period: 'oggi' | 'mese'; who?: string } | null,
): Pick<CapLink, 'meter' | 'period' | 'who'> {
  return c ? { meter: c.meter, period: c.period, who: c.who } : { meter: null };
}

export function SpendSection() {
  const s = spendStrings();
  const [view, setView] = useState<SpendView | null>(null);
  const [failed, setFailed] = useState(false);
  const dailyRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    getApi()
      .spend()
      .then((v) => alive && (setView(v), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed)
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        {s.failed}
      </p>
    );
  if (!view) return null;

  const save = async (update: SpendUpdate, said: string) => {
    const next = await getApi().setSpend(update);
    setView(next);
    notify(said, 'success');
  };

  const paid = view.agents.filter((a) => a.paid || a.month.spentEur > 0);
  const reached = view.status === 'stopped';
  const notCounted = [
    view.free.requests > 0
      ? s.freeRequests(formatNumber(view.free.requests), view.free.requests)
      : null,
    ...view.subscriptions.map((sub) =>
      s.subscriptionRequests(sub.label, formatNumber(sub.requests), sub.requests),
    ),
  ].filter(Boolean);
  const unpriced = unpricedNotice(view.unpriced.map((u) => u.label));
  const estimated = estimatedNotice((view.estimated ?? []).map((u) => u.label));

  return (
    <Group
      title={SETTINGS_SECTIONS.tettoDiSpesa.label}
      id="settings-tetto"
      testId="spend-section"
      description={s.description}
      footer={
        <span data-testid="spend-footer">
          {notCounted.length > 0 ? s.notCounted(notCounted.join(' · ')) : ''}
          {s.rate(formatNumber(view.usdToEur))}
        </span>
      }
    >
      <CapChain
        testId="spend-chain"
        links={[
          { id: 'monster', ...chainOf(closestOf(view.agents)), label: s.links.monster },
          { id: 'project', ...chainOf(closestOf(view.projects ?? [])), label: s.links.project },
          { id: 'team', ...chainOf(closestMeter(view.day, view.month)), label: s.links.team },
        ]}
      />
      {unpriced && (
        <RowBody>
          <Status testId="spend-unpriced">{unpriced}</Status>
        </RowBody>
      )}
      {estimated && (
        <RowBody>
          <Status testId="spend-estimated">{estimated}</Status>
        </RowBody>
      )}
      {view.status !== 'ok' && (
        <RowBody>
          <Status testId="spend-status">
            {reached ? s.reached : s.warned(Math.round(view.warnAt * 100))}
          </Status>
          {reached && (
            <div>
              <Button
                variant="primary"
                size="sm"
                data-testid="spend-raise"
                onClick={() => {
                  const cap =
                    view.day.ratio !== null && view.day.ratio >= 1 ? view.day : view.month;
                  const next = Math.max(1, Math.ceil(((cap.capEur ?? 0) * 2) / 5) * 5);
                  void save(
                    cap === view.day ? { dailyEur: next } : { monthlyEur: next },
                    s.raised(formatEur(next), cap === view.day),
                  ).catch((err: unknown) => notify(errorText(err), 'error'));
                }}
              >
                {s.raise}
              </Button>
            </div>
          )}
        </RowBody>
      )}
      <Row label={s.today} description={noCapNote(view.day)} testId="spend-day">
        <SpendDisplay meter={view.day} testId="spend-day-display" />
      </Row>
      <Row label={s.thisMonth} description={noCapNote(view.month)} testId="spend-month">
        <SpendDisplay meter={view.month} testId="spend-month-display" />
      </Row>
      <RowBody>
        <CapsForm
          testId="spend-caps"
          daily={view.day.capEur}
          monthly={view.month.capEur}
          dailyRef={dailyRef}
          emptyHint={s.emptyHint}
          onSave={(caps) => save(caps, s.saved)}
        />
      </RowBody>
      {paid.length > 0 && (
        <DisclosureRow
          as="div"
          label={s.perMonster}
          description={s.perMonsterText}
          testId="spend-agents"
        >
          <ul className="grid">
            {paid.map((a) => (
              <li key={a.id} className="seam-t" data-testid={`spend-agent-${a.id}`}>
                <Row
                  leading={<AgentMark id={a.id} color="var(--ink-muted)" width={40} height={34} />}
                  label={a.name}
                  description={s.agentLine(
                    formatEur(a.day.spentEur),
                    formatEur(a.month.spentEur),
                    a.paid,
                    a.unpriced?.length ? formatList(a.unpriced) : null,
                  )}
                />
                <RowBody>
                  <CapsForm
                    testId={`spend-caps-${a.id}`}
                    daily={a.caps.dailyEur}
                    monthly={a.caps.monthlyEur}
                    emptyHint={s.agentEmptyHint}
                    onSave={(caps) => save({ agents: { [a.id]: caps } }, s.agentSaved(a.name))}
                  />
                </RowBody>
              </li>
            ))}
          </ul>
        </DisclosureRow>
      )}
    </Group>
  );
}
