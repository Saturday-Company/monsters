import { dotPalette } from '@monsters/monster-kit';
import { ArrowUpRight, CaretDown, CaretUp } from '@phosphor-icons/react';
import type { UndoRunResult } from '@monsters/shared';
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { notePath } from '../../lib/router.ts';
import { cn, domId, formatTime, formatUsd } from '../../lib/utils.ts';
import { errorText, undoRun, useApp } from '../../store/app.ts';
import {
  baseName,
  costText,
  doneSummary,
  formatDuration,
  instrumentationLine,
  modelShort,
  toolShort,
  type ChatItem,
} from '../../store/derive.ts';
import { useAgent, useNameOf, useResolvedTheme } from '../../store/hooks.ts';
import {
  delegationModelLine,
  NOTE_ACTION,
  outboundLine,
  receiptActions,
  receiptMemories,
  receiptModelLine,
  receiptModels,
  receiptNotes,
  VERDICT,
  type Tone,
} from '../../store/instinct.ts';
import { usePrefs } from '../../store/prefs.ts';
import {
  doneStepText,
  isOutsideStep,
  liveStepText,
  taskVerdict,
  turnCost,
  turnDuration,
  turnNow,
  turnSentence,
  type Turn,
  type TurnStep,
} from '../../store/turn.ts';
import { accentInk } from '../../theme/bubbles.ts';
import { THEMES } from '../../theme/tokens.ts';
import { Meter } from '../ui/Meter.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { chatStrings } from './chat.strings.ts';
import { ReadOnlyContext } from './readonly.ts';

/*
 * The work strip of a turn (docs/design.md, "The chat"): one row in the chat's own tone between
 * the request and the reply, under the monster's small screen. While the turn works it is alive:
 * the step under way in words ("Asking Rhea · Searching “tram 28”"), the last steps below it, the
 * others folded. When the turn ends it closes into one sentence ("Worked 1 min · asked Rhea and
 * Dione · 2 notes · free"); open, it is the turn's receipt (D-067, D-068): the timeline (tasks
 * with their checks ✓/?/✗ and the reason, searches, what the instinct said), the notes touched,
 * what left the computer, security, cost and time, "Undo the whole job" (two presses, like Stop)
 * and "Behind the scenes" on that run. The black screen stays for Behind the scenes.
 */

/** How long "Undo the whole job" stays armed after the first press (as Stop). */
const ARMED_MS = 5000;

/** The last steps the live strip shows; the others are folded. */
const LIVE_STEPS = 3;

/** Searches shown in the timeline before "N steps before". */
const TIMELINE_STEPS = 6;

const LED_TONE: Record<Tone, 'ok' | 'signal' | 'stop' | undefined> = {
  ok: 'ok',
  warn: 'signal',
  stop: 'stop',
  muted: undefined,
};

/** A monster's light: a small dot in its colour, readable on the chat's surfaces. */
function Light({ agent }: { agent: string }) {
  const a = useAgent(agent);
  const theme = useResolvedTheme();
  const color = useMemo(
    () => accentInk(a ? dotPalette(a.genome).lit : THEMES[theme].screenMuted, theme),
    [a, theme],
  );
  return (
    <span
      aria-hidden
      className="mt-[7px] inline-block size-2 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
    />
  );
}

/** One line of the timeline: a mark (a light, a monster's light) and the words. */
function Entry({
  mark,
  children,
  testId,
  className,
}: {
  mark: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <li className={cn('flex items-start gap-2.5', className)} data-testid={testId}>
      <span className="flex w-2 shrink-0 justify-center">{mark}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

const toneLed = (tone: Tone) => (
  <span aria-hidden className="led mt-[6px]" data-tone={LED_TONE[tone]} />
);

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h4 className="label text-ink-muted">{title}</h4>
      <ul className="grid gap-1.5">{children}</ul>
    </div>
  );
}

/** A task handed over in the turn, with its outcome, its checks and the notes it wrote. */
function TaskEntry({
  task,
  turn,
  details,
}: {
  task: Extract<ChatItem, { kind: 'delegation' }>;
  turn: Turn;
  details: boolean;
}) {
  const s = chatStrings();
  const nameOf = useNameOf();
  const d = taskVerdict(turn.receipt?.data, task);
  const v = d ? VERDICT[d.verdict] : null;
  const word = v ? v.word : s.strip.taskStatus[task.status];
  const summary = task.status === 'completed' ? doneSummary(task.goal, task.summary) : null;
  const meta = [
    // Each task has its own level (D-109): which model it got and why, with the details on.
    d && details ? delegationModelLine(d) : null,
    d?.retried ? s.receipt.retried : null,
    d && details && d.steps !== undefined ? s.receipt.steps(d.steps) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Entry mark={<Light agent={task.to} />}>
      <p data-testid="receipt-delegation" data-verdict={d?.verdict} data-status={task.status}>
        {/* The task's monster: its own Behind the scenes, on this turn. */}
        <button
          type="button"
          onClick={() => openTerminalAt(task.to, turn.runId)}
          className="font-medium text-ink underline-offset-2 hover:underline"
          title={s.strip.behindLabel(nameOf(task.to))}
          data-testid="receipt-delegation-behind"
        >
          {s.strip.asked(nameOf(task.to))}
        </button>
        <span className="text-ink-muted">: {task.goal}</span>{' '}
        <span
          className={cn(
            'whitespace-nowrap',
            v?.tone === 'warn'
              ? 'text-signal-ink'
              : v?.tone === 'stop'
                ? 'text-stop-ink'
                : 'text-ink-muted',
          )}
        >
          · {word}
        </span>
      </p>
      {summary && <p className="text-ink">{summary}</p>}
      {meta && <p className="text-ink-muted">{meta}</p>}
      {d && d.criteria.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {d.criteria.map((c, j) => (
            <li
              key={j}
              className="flex items-start gap-2"
              data-testid="receipt-criterion"
              data-ok={String(c.ok)}
            >
              <span
                aria-hidden
                className={cn(
                  'w-3 shrink-0 text-center font-mono',
                  c.ok === true ? 'text-ink' : c.ok === false ? 'text-stop-ink' : 'text-ink-muted',
                )}
              >
                {c.ok === true ? '✓' : c.ok === false ? '✗' : '·'}
              </span>
              <span className="min-w-0">
                <span className="text-ink">
                  {c.kind === 'notes' ? s.receipt.notesSaved : c.text}
                </span>
                {c.reason && <span className="text-ink-muted"> · {c.reason}</span>}
                {c.ok === null && !c.reason && (
                  <span className="text-ink-muted">{s.receipt.notChecked}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {task.checks && task.checks.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {task.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-ink-muted" data-testid="task-check">
              <span
                aria-hidden
                className="led mt-[6px]"
                data-tone={c.tone === 'warn' ? 'signal' : c.tone === 'stop' ? 'stop' : undefined}
              />
              <span className="sr-only">{s.events.decision}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Entry>
  );
}

function UndoResult({ result }: { result: UndoRunResult }) {
  const s = chatStrings().receipt;
  const files = [...new Set(result.undone.flatMap((u) => u.files))];
  const n = result.undone.length;
  return (
    <div className="grid gap-1.5" role="status" data-testid="receipt-undone">
      <p className="font-medium text-ink">{n === 0 ? s.nothingToUndo : s.undone(n)}</p>
      {files.length > 0 && (
        <ul className="grid gap-1 text-ink-muted">
          {files.map((f) => (
            <li key={f}>↺ {baseName(f)}</li>
          ))}
        </ul>
      )}
      {result.failed.length > 0 && (
        <ul className="grid gap-1 text-stop-ink" data-testid="receipt-undo-failed">
          {result.failed.map((f) => (
            <li key={f.actionId}>✗ {f.message || s.undoFailed}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Undo the whole job": two presses, like the cover of Stop. */
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
        <p role="alert" className="text-stop-ink">
          {error}
        </p>
      )}
      {armed && (
        <span className="text-ink-muted max-sm:basis-full max-sm:text-right">{s.rollBack}</span>
      )}
      <button
        type="button"
        className={cn('key strip-key', armed && 'strip-key-armed')}
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

type TimelineEntry =
  | { kind: 'task'; ts: number; task: Extract<ChatItem, { kind: 'delegation' }> }
  | { kind: 'step'; ts: number; step: TurnStep }
  | { kind: 'instinct'; ts: number; item: Extract<ChatItem, { kind: 'instinct' }> };

/** The open strip: the receipt of the turn, in the chat's tone. */
function Details({ turn, id, undone }: { turn: Turn; id: string; undone: boolean }) {
  const s = chatStrings();
  const nameOf = useNameOf();
  const details = usePrefs((p) => p.showDetails);
  // An earlier conversation is for reading: nothing in it can be undone from here.
  const readOnly = useContext(ReadOnlyContext);
  const [result, setResult] = useState<UndoRunResult | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const data = turn.receipt?.data;

  const outsideSteps = turn.steps.filter(isOutsideStep);
  const hidden = allSteps ? 0 : Math.max(0, outsideSteps.length - TIMELINE_STEPS);
  const timeline: TimelineEntry[] = [
    ...turn.tasks.map((task) => ({ kind: 'task' as const, ts: task.ts, task })),
    ...outsideSteps.slice(hidden).map((step) => ({ kind: 'step' as const, ts: step.ts, step })),
    ...turn.instinct.map((item) => ({ kind: 'instinct' as const, ts: item.ts, item })),
  ].sort((a, b) => a.ts - b.ts);

  const notes = data ? receiptNotes(data) : [];
  const memories = data ? receiptMemories(data) : [];
  const models = data && details ? receiptModels(data, true) : [];
  const outside = (data?.externalTools ?? []).map((t) =>
    s.receipt.outsideTool(toolShort(t.tool), t.calls, t.failed, t.why),
  );
  // A text with orders removed is already in the timeline, as the defense said it.
  const defended = turn.instinct.some((i) => i.about === 'defense');
  const alerts = [
    data && data.alerts.injections > 0 && !defended
      ? s.receipt.injections(data.alerts.injections)
      : null,
    data && data.alerts.stuck > 0 ? s.receipt.stuck(data.alerts.stuck) : null,
  ].filter((a): a is string => a !== null);
  const ms = turnDuration(turn);
  const calls = data?.usage.modelCalls;
  // With the technical details: the tools of the whole run, the engine that answered the searches
  // (D-071) and the model, as the instrument says them.
  const instr =
    details && turn.stats ? instrumentationLine(turn.stats, nameOf(turn.agent), turn.agent) : null;
  const footer = [
    turnCost(turn, costText),
    calls !== undefined ? s.receipt.callsFooter(calls) : null,
    ms !== undefined ? formatDuration(ms) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      id={id}
      className="grid gap-4 px-3.5 pt-1 pb-3.5 text-caption leading-[18px]"
      data-testid="strip-details"
    >
      {timeline.length > 0 && (
        <Part title={s.strip.timeline}>
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setAllSteps(true)}
                className="min-h-6 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {s.strip.earlier(hidden)}
              </button>
            </li>
          )}
          {timeline.map((e) =>
            e.kind === 'task' ? (
              <TaskEntry key={e.task.id} task={e.task} turn={turn} details={details} />
            ) : e.kind === 'step' ? (
              <Entry key={e.step.id} mark={<Light agent={e.step.agent} />} testId="strip-step">
                <p className="text-ink-muted">
                  <span className="text-ink">{nameOf(e.step.agent)}</span> · {doneStepText(e.step)}
                </p>
              </Entry>
            ) : (
              <Entry
                key={e.item.id}
                mark={toneLed(
                  e.item.tone === 'stop' ? 'stop' : e.item.tone === 'warn' ? 'warn' : 'muted',
                )}
                testId="instinct-line"
              >
                <p className={e.item.tone ? 'text-ink' : 'text-ink-muted'}>
                  <span className="sr-only">
                    {e.item.about === 'defense'
                      ? s.events.about.defense
                      : e.item.about === 'spend'
                        ? s.events.about.spend
                        : s.events.about.other}
                    :{' '}
                  </span>
                  {e.item.text}
                </p>
              </Entry>
            ),
          )}
        </Part>
      )}
      {models.length > 0 && (
        <Part title={s.receipt.models}>
          {models.map((m) => (
            <Entry key={m.agent} mark={<Light agent={m.agent} />}>
              <p data-testid="receipt-model">
                <span className="text-ink">{nameOf(m.agent)}</span>
                <span className="text-ink-muted"> · {receiptModelLine(m)}</span>
              </p>
            </Entry>
          ))}
        </Part>
      )}
      {(notes.length > 0 || memories.length > 0) && (
        <Part title={s.receipt.notes}>
          {notes.map((n) => (
            <Entry key={n.path} mark={toneLed('ok')}>
              <a
                href={notePath(n.path)}
                className="hit-32 font-medium text-ink underline decoration-ink-faint underline-offset-[3px] hover:decoration-ink"
                data-testid="receipt-note"
              >
                {baseName(n.path)}
              </a>
              <span className="text-ink-muted">
                {' '}
                · {NOTE_ACTION[n.action] ?? s.receipt.touched}
              </span>
            </Entry>
          ))}
          {memories.length > 0 && (
            <Entry mark={toneLed('muted')}>
              <span className="text-ink-muted">{s.receipt.memories(memories.join(', '))}</span>
            </Entry>
          )}
        </Part>
      )}
      {(outside.length > 0 || (data?.outbound.length ?? 0) > 0) && (
        <Part title={s.receipt.outside}>
          {outside.length > 0 && (
            <Entry mark={toneLed('muted')}>
              <span className="text-ink">{outside.join(' · ')}</span>
            </Entry>
          )}
          {data?.outbound.map((o, i) => (
            <Entry
              key={i}
              mark={toneLed(
                o.outcome === 'approved' ? 'ok' : o.outcome === 'marked' ? 'warn' : 'stop',
              )}
            >
              <span className="text-ink">{outboundLine(o, nameOf)}</span>
            </Entry>
          ))}
        </Part>
      )}
      {alerts.length > 0 && (
        <Part title={s.receipt.security}>
          {alerts.map((a) => (
            <Entry key={a} mark={toneLed('warn')}>
              <span className="text-ink">{a}</span>
            </Entry>
          ))}
        </Part>
      )}
      <div className="strip-foot grid gap-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="label text-ink-muted" data-testid="receipt-cost">
            {footer}
            {details && data && data.usage.instinctCalls > 0 && (
              <span className="max-sm:block">{s.receipt.decisions(data.usage.instinctCalls)}</span>
            )}
            {details && data && (data.usage.compactionCalls ?? 0) > 0 && (
              <span className="max-sm:block" data-testid="receipt-compaction">
                {s.receipt.summaryLine}
                {data.usage.compactionCostUsd ? ` ${formatUsd(data.usage.compactionCostUsd)}` : ''}
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => openTerminalAt(turn.agent, turn.runId)}
              className="strip-link label inline-flex min-h-9 items-center gap-1 rounded-[8px] px-2 text-ink-muted"
              aria-label={s.strip.behindLabel(nameOf(turn.agent))}
              data-testid="strip-behind"
            >
              {s.strip.behind}
              <ArrowUpRight size={13} weight="bold" aria-hidden />
            </button>
            {data?.undoable && !undone && !result && turn.receipt && !readOnly && (
              <UndoAll runId={turn.receipt.runId} onDone={setResult} />
            )}
          </div>
        </div>
        {instr && (
          <p className="label text-ink-muted" data-testid="instrumentation">
            {instr}
          </p>
        )}
        {result && <UndoResult result={result} />}
        {undone && !result && (
          <p className="font-medium text-ink" data-testid="receipt-undone">
            {s.receipt.jobUndoneNotes}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The strip itself. `alive`: the turn works now (its monsters have this run among their work);
 * `activity`: the monster's own words for it when the log does not say more.
 */
export function WorkStrip({
  turn,
  alive,
  activity,
  color,
}: {
  turn: Turn;
  alive: boolean;
  activity: string | null;
  /** The monster's colour, for the meter. */
  color: string;
}) {
  const s = chatStrings().strip;
  const nameOf = useNameOf();
  const details = usePrefs((p) => p.showDetails);
  // Closed unless the user opens it: a turn that ends closes, the next one does not stay open (F-6).
  const [open, setOpen] = useState(false);
  const bodyId = domId(useId());
  const data = turn.receipt?.data;
  const actions = useMemo(() => (data ? receiptActions(data) : []), [data]);
  // Undone already (from here, Activity or another device): the state in words.
  const undone = useApp(
    (st) => actions.length > 0 && actions.every((a) => Object.hasOwn(st.undone, a)),
  );
  const model = useMemo(() => {
    if (!details) return null;
    const m = data?.models?.find((x) => x.agent === turn.agent) ?? data?.models?.[0];
    if (m) return receiptModelLine(m);
    const ref = turn.stats ? (turn.stats.models[turn.agent] ?? turn.stats.lastModel) : undefined;
    return ref ? modelShort(ref) : null;
  }, [details, data, turn.agent, turn.stats]);

  const now = alive ? turnNow(turn, nameOf) : [];
  const line = alive
    ? now.length > 0
      ? now.join(' · ')
      : (activity ?? chatStrings().panel.writing)
    : turnSentence(turn, { nameOf, cost: turnCost(turn, costText), undone, model });
  const recent = alive ? turn.steps.slice(-LIVE_STEPS) : [];
  const before = alive ? turn.steps.length - recent.length : 0;

  return (
    <section
      className="work-strip min-w-0"
      data-testid="work-strip"
      data-open={open ? 'true' : 'false'}
      data-alive={alive ? 'true' : 'false'}
      data-run={turn.runId}
      aria-label={s.sr(line)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        title={open ? s.close : s.open}
        className={cn(
          'strip-head flex min-h-9 max-w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left',
          open || alive ? 'w-full' : 'w-fit',
        )}
      >
        {alive ? <Meter active color={color} className="shrink-0" /> : null}
        <span
          className={cn(
            'min-w-0 text-footnote',
            alive ? 'flex-1 text-ink' : 'text-ink-muted',
            open && 'flex-1',
          )}
          data-testid={alive ? 'strip-now' : 'receipt-summary'}
        >
          {line}
        </span>
        {open ? (
          <CaretUp size={13} weight="bold" aria-hidden className="shrink-0 text-ink-muted" />
        ) : (
          <CaretDown size={13} weight="bold" aria-hidden className="shrink-0 text-ink-muted" />
        )}
      </button>
      {alive && recent.length > 1 && !open && (
        <ol
          className="grid gap-0.5 px-3 pb-2 text-caption text-ink-muted"
          data-testid="strip-steps"
        >
          {before > 0 && <li className="pl-[18px]">{s.earlier(before)}</li>}
          {recent.map((step) => (
            <li key={step.id} className="flex items-start gap-2.5">
              <Light agent={step.agent} />
              <span className="min-w-0 truncate">
                <span className="text-ink">{nameOf(step.agent)}</span> · {liveStepText(step)}
                <span className="sr-only"> · {formatTime(step.ts)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {open && <Details turn={turn} id={bodyId} undone={undone} />}
    </section>
  );
}
