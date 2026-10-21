import type { PlanLimitId, PlanLimitsView } from '@monsters/shared';
import { useEffect, useState } from 'react';
import { formatAgo, liveWindow, litSegments, toneNote, windowNote } from './plan-limits-format.ts';
import { usageStrings } from './usage.strings.ts';

/*
 * Utilizzo del piano (docs/design.md, "Utilizzo del piano"; D-111): one bar of
 * twenty lineette per window of the plan (Sessione, Settimana, Opus settimana
 * on Claude; the two windows of ChatGPT named by their length), the percent
 * used, when it resets and how old the reading is. The numbers are what the
 * official program printed during the monster's last work on that plan, so the
 * block says it updates only then. Colour is never alone: from 80% the percent
 * is in signal and a word says so, from 95% in stop.
 */

const SEGMENTS = 20;

/** The clock of the page, ticking every half minute so "tra 1 h 32" and "20 min fa" stay true. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const PLAN_NAME: Record<PlanLimitId, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
};

function Bar({ percent, tone }: { percent: number; tone: 'ok' | 'warn' | 'high' }) {
  const on = litSegments(percent, SEGMENTS);
  const lit =
    tone === 'high' ? 'var(--stop)' : tone === 'warn' ? 'var(--signal)' : 'var(--screen-ink)';
  return (
    <span aria-hidden className="flex w-full items-center gap-[2px]">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <i
          key={i}
          className="block h-[14px] min-w-[3px] flex-1 rounded-[1px]"
          style={{ background: i < on ? lit : 'var(--screen-off)' }}
        />
      ))}
    </span>
  );
}

/**
 * The windows of one plan on a screen. `view` null: nothing observed yet.
 * Inside the Consumi screen use `embedded`; in Settings it sits on a small
 * screen of its own.
 */
export function PlanLimitsBlock({
  plan,
  view,
  embedded = false,
}: {
  plan: PlanLimitId;
  view: PlanLimitsView | null;
  embedded?: boolean;
}) {
  const s = usageStrings().plan;
  const now = useNow();
  const windows = view?.windows.map((w) => liveWindow(w, now)) ?? [];
  const body = (
    <div
      className="grid gap-3"
      data-testid={`plan-limits-${plan}`}
      data-empty={view ? 'no' : 'yes'}
    >
      {windows.length === 0 ? (
        <p
          className="text-caption leading-[19px] text-screen-muted"
          data-testid="plan-limits-empty"
        >
          {s.empty(PLAN_NAME[plan])}
        </p>
      ) : (
        <ul className="grid gap-3.5">
          {windows.map((w) => {
            const flag = toneNote(w);
            const color =
              w.tone === 'high'
                ? 'text-screen-stop'
                : w.tone === 'warn'
                  ? 'text-screen-signal'
                  : 'text-screen-ink';
            return (
              <li
                key={w.id}
                className="grid gap-1.5"
                data-testid={`plan-window-${w.id}`}
                data-tone={w.reset ? 'reset' : w.tone}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, w.usedPercent)}
                aria-label={s.meter(w.label, w.usedPercent, flag)}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="label text-screen-muted">{w.label}</span>
                  <span className={`text-footnote leading-5 tabular-nums ${color}`}>
                    <span data-testid="plan-percent">{w.usedPercent}%</span>
                    {flag && <span className="label ml-2">{flag}</span>}
                  </span>
                </div>
                <Bar percent={w.usedPercent} tone={w.tone} />
                <p className="text-micro leading-[17px] text-screen-muted" data-testid="plan-reset">
                  {windowNote(w, now)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-micro leading-[17px] text-screen-muted" data-testid="plan-updated">
        {s.updated(view ? formatAgo(view.observedAt, now) : null)}
      </p>
    </div>
  );
  if (embedded) return body;
  return <div className="screen px-3.5 py-3">{body}</div>;
}
