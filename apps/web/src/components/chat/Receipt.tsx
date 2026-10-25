import { dotPalette } from '@monsters/monster-kit';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { originalRequest, type ReceiptData, type UndoRunResult } from '@monsters/shared';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { notePath } from '../../lib/router.ts';
import { cn, domId, formatTime, formatUsd } from '../../lib/utils.ts';
import { errorText, undoRun, useApp } from '../../store/app.ts';
import { baseName, formatDuration, toolShort, type ChatItem } from '../../store/derive.ts';
import { useAgent, useNameOf } from '../../store/hooks.ts';
import {
  delegationModelLine,
  NOTE_ACTION,
  outboundLine,
  receiptActions,
  receiptCost,
  receiptMemories,
  receiptModelLine,
  receiptModels,
  receiptNotes,
  receiptSummary,
  VERDICT,
  type Tone,
} from '../../store/instinct.ts';
import { usePrefs } from '../../store/prefs.ts';
import { chatStrings } from './chat.strings.ts';

/*
 * The receipt of a job in the chat (D-067, D-068): a display of the
 * instrument, not a card. What was asked, each job passed on with its outcome
 * ("finito davvero", "in dubbio"…) and its criteria ✓/✗ with the reason, the
 * notes touched, what left the computer, cost and steps; "Annulla tutto il
 * lavoro" asks twice, like Ferma ("DI NUOVO"), then says what it undid. The
 * latest receipt of a chat opens by itself, the older ones are one line.
 */

/** How long "Annulla tutto" stays armed after the first press (as Ferma). */
const ARMED_MS = 5000;

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-screen-ok',
  warn: 'text-screen-signal',
  stop: 'text-screen-stop',
  muted: 'text-screen-muted',
};

/** One line of the display: a mark in its column, the words beside it. */
function Line({
  mark,
  tone = 'muted',
  children,
  className,
}: {
  mark: string;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('grid grid-cols-[14px_minmax(0,1fr)] gap-x-2', className)}>
      <span aria-hidden className={cn('text-center', TONE_CLASS[tone])}>
        {mark}
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h4 className="label text-screen-muted">{title}</h4>
      <ul className="grid gap-1.5">{children}</ul>
    </div>
  );
}

/** A monster's name in its own light, as on its monitor. */
function AgentName({ id, name }: { id: string; name: string }) {
  const agent = useAgent(id);
  const lit = useMemo(() => (agent ? dotPalette(agent.genome).lit : undefined), [agent]);
  return <span style={lit ? { color: lit } : undefined}>{name}</span>;
}

function Delegations({ data, details }: { data: ReceiptData; details: boolean }) {
  const s = chatStrings().receipt;
  return (
    <Part title={s.tasks}>
      {data.delegations.map((d, i) => {
        const v = VERDICT[d.verdict];
        const meta = [
          // Each delegation has its own level (D-109): which model it got and why.
          delegationModelLine(d),
          d.retried ? s.retried : null,
          details && d.steps !== undefined ? s.steps(d.steps) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Line key={i} mark={v.mark} tone={v.tone}>
            <p data-testid="receipt-delegation" data-verdict={d.verdict}>
              <AgentName id={d.agent} name={d.agentName} />{' '}
              <span className="text-screen-ink">{d.goal}</span>{' '}
              <span className={cn('label whitespace-nowrap', TONE_CLASS[v.tone])}>· {v.word}</span>
            </p>
            {meta && <p className="text-screen-muted">{meta}</p>}
            {d.criteria.length > 0 && (
              <ul className="mt-1 grid gap-1">
                {d.criteria.map((c, j) => {
                  const tone: Tone = c.ok === true ? 'ok' : c.ok === false ? 'stop' : 'muted';
                  return (
                    <Line
                      key={j}
                      mark={c.ok === true ? '✓' : c.ok === false ? '✗' : '·'}
                      tone={tone}
                    >
                      <p data-testid="receipt-criterion" data-ok={String(c.ok)}>
                        <span className="text-screen-ink">
                          {c.kind === 'notes' ? s.notesSaved : c.text}
                        </span>
                        {c.reason && <span className="text-screen-muted"> · {c.reason}</span>}
                        {c.ok === null && !c.reason && (
                          <span className="text-screen-muted">{s.notChecked}</span>
                        )}
                      </p>
                    </Line>
                  );
                })}
              </ul>
            )}
          </Line>
        );
      })}
    </Part>
  );
}

function UndoResult({ result }: { result: UndoRunResult }) {
  const s = chatStrings().receipt;
  const files = [...new Set(result.undone.flatMap((u) => u.files))];
  const n = result.undone.length;
  return (
    <div className="grid gap-1.5" role="status" data-testid="receipt-undone">
      <p className="label text-screen-ok">{n === 0 ? s.nothingToUndo : s.undone(n)}</p>
      {files.length > 0 && (
        <ul className="grid gap-1">
          {files.map((f) => (
            <Line key={f} mark="↺" tone="ok">
              <span className="text-screen-ink">{baseName(f)}</span>
            </Line>
          ))}
        </ul>
      )}
      {result.failed.length > 0 && (
        <ul className="grid gap-1" data-testid="receipt-undo-failed">
          {result.failed.map((f) => (
            <Line key={f.actionId} mark="✗" tone="stop">
              <span className="text-screen-stop">{f.message || s.undoFailed}</span>
            </Line>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Annulla tutto il lavoro": two presses, like the cover of Ferma. */
function UndoAll({ runId, onDone }: { runId: string; onDone: (r: UndoRunResult) => void }) {
  const s = chatStrings().receipt;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const press = async () => {
    setError(null);
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), ARMED_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    setBusy(true);
    try {
      onDone(await undoRun(runId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {error && (
        <p role="alert" className="text-screen-stop">
          {error}
        </p>
      )}
      {armed && (
        <span className="text-screen-muted max-sm:basis-full max-sm:text-right">{s.rollBack}</span>
      )}
      <button
        type="button"
        className={cn('screen-key receipt-undo', armed && 'text-screen-stop')}
        data-testid="receipt-undo"
        data-state={armed ? 'armed' : 'idle'}
        disabled={busy}
        onClick={() => void press()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && armed) {
            e.preventDefault();
            setArmed(false);
            if (timer.current) clearTimeout(timer.current);
          }
        }}
        aria-label={armed ? s.undoArmedLabel : s.undoAll}
        title={armed ? s.undoArmedTitle : undefined}
      >
        <span aria-hidden className="label">
          {busy ? s.undoing : armed ? s.again : s.undoAll}
        </span>
      </button>
    </div>
  );
}

export function ReceiptBlock({
  item,
  latest,
}: {
  item: Extract<ChatItem, { kind: 'receipt' }>;
  /** The latest receipt of the chat opens by itself. */
  latest: boolean;
}) {
  const data = item.data;
  const s = chatStrings().receipt;
  const nameOf = useNameOf();
  const details = usePrefs((p) => p.showDetails);
  const [open, setOpen] = useState(latest);
  const [result, setResult] = useState<UndoRunResult | null>(null);
  const bodyId = domId(useId());
  const actions = receiptActions(data);
  // Undone already (from here, Attività or another device): no key, the state in words.
  const allUndone = useApp(
    (s) => actions.length > 0 && actions.every((a) => Object.hasOwn(s.undone, a)),
  );
  const notes = receiptNotes(data);
  const usedModels = receiptModels(data, details);
  const memories = receiptMemories(data);
  const summary = receiptSummary(data);
  const outside = data.externalTools.map((t) =>
    s.outsideTool(toolShort(t.tool), t.calls, t.failed, t.why),
  );
  const alerts = [
    data.alerts.injections > 0 ? s.injections(data.alerts.injections) : null,
    data.alerts.stuck > 0 ? s.stuck(data.alerts.stuck) : null,
  ].filter((a): a is string => a !== null);
  const footer = [
    receiptCost(data),
    s.callsFooter(data.usage.modelCalls),
    formatDuration(data.durationMs),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      className="receipt screen font-mono text-micro leading-[19px] text-screen-ink"
      aria-label={s.label(summary)}
      data-testid="receipt"
      data-open={open ? 'true' : 'false'}
      data-run={item.runId}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="row-key flex min-h-11 w-full items-center gap-3 rounded-[10px] px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
      >
        <span className="label shrink-0 text-screen-ink">{s.receipt}</span>
        <span
          className="label min-w-0 flex-1 truncate text-screen-muted"
          data-testid="receipt-summary"
        >
          {allUndone ? s.jobUndone : summary}
        </span>
        <span className="label shrink-0 text-screen-muted max-sm:hidden">
          {formatTime(item.ts)}
        </span>
        {open ? (
          <CaretUp size={13} weight="bold" aria-hidden className="shrink-0 text-screen-muted" />
        ) : (
          <CaretDown size={13} weight="bold" aria-hidden className="shrink-0 text-screen-muted" />
        )}
      </button>
      {open && (
        <div id={bodyId} className="grid gap-4 px-4 pt-1 pb-4">
          <p className="text-screen-ink" data-testid="receipt-request">
            <span className="text-screen-muted">{s.request}</span>
            {s.quote(originalRequest(data.request))}
          </p>
          {usedModels.length > 0 && (
            <Part title={s.models}>
              {usedModels.map((m) => (
                <Line
                  key={m.agent}
                  mark={m.limited ? '!' : '◇'}
                  tone={m.limited ? 'warn' : 'muted'}
                >
                  <p data-testid="receipt-model">
                    <AgentName id={m.agent} name={nameOf(m.agent)} />{' '}
                    <span className="text-screen-ink">· {receiptModelLine(m)}</span>
                  </p>
                </Line>
              ))}
            </Part>
          )}
          {data.delegations.length > 0 && <Delegations data={data} details={details} />}
          {(notes.length > 0 || memories.length > 0) && (
            <Part title={s.notes}>
              {notes.map((n) => (
                <Line key={n.path} mark="◆" tone="ok">
                  <a
                    href={notePath(n.path)}
                    className="text-screen-ink underline decoration-[var(--screen-muted)] underline-offset-[3px] hover:decoration-[var(--screen-ink)]"
                    data-testid="receipt-note"
                  >
                    {baseName(n.path)}
                  </a>
                  <span className="text-screen-muted"> · {NOTE_ACTION[n.action] ?? s.touched}</span>
                </Line>
              ))}
              {memories.length > 0 && (
                <Line mark="·">
                  <span className="text-screen-muted">{s.memories(memories.join(', '))}</span>
                </Line>
              )}
            </Part>
          )}
          {(outside.length > 0 || data.outbound.length > 0) && (
            <Part title={s.outside}>
              {outside.length > 0 && (
                <Line mark="↗">
                  <span className="text-screen-ink">{outside.join(' · ')}</span>
                </Line>
              )}
              {data.outbound.map((o, i) => (
                <Line
                  key={i}
                  mark={o.outcome === 'approved' ? '✓' : o.outcome === 'marked' ? '?' : '✗'}
                  tone={o.outcome === 'approved' ? 'ok' : o.outcome === 'marked' ? 'warn' : 'stop'}
                >
                  <span className="text-screen-ink">{outboundLine(o, nameOf)}</span>
                </Line>
              ))}
            </Part>
          )}
          {alerts.length > 0 && (
            <Part title={s.security}>
              {alerts.map((a) => (
                <Line key={a} mark="!" tone="warn">
                  <span className="text-screen-ink">{a}</span>
                </Line>
              ))}
            </Part>
          )}
          <div className="receipt-foot grid gap-3 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="label text-screen-muted" data-testid="receipt-cost">
                {footer}
                {details && data.usage.instinctCalls > 0 && (
                  <span className="max-sm:block">{s.decisions(data.usage.instinctCalls)}</span>
                )}
                {details && (data.usage.compactionCalls ?? 0) > 0 && (
                  <span className="max-sm:block" data-testid="receipt-compaction">
                    {s.summaryLine}
                    {data.usage.compactionCostUsd
                      ? ` ${formatUsd(data.usage.compactionCostUsd)}`
                      : ''}
                  </span>
                )}
              </p>
              {data.undoable && !allUndone && !result && (
                <UndoAll runId={item.runId} onDone={setResult} />
              )}
            </div>
            {result && <UndoResult result={result} />}
            {allUndone && !result && (
              <p className="label text-screen-ok" data-testid="receipt-undone">
                {s.jobUndoneNotes}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
