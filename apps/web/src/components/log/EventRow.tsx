import {
  ArrowArcRight,
  ArrowBendUpLeft,
  ArrowCounterClockwise,
  CaretRight,
  Gear,
  User,
} from '@phosphor-icons/react';
import { dotPalette } from '@monsters/monster-kit';
import type { LogEvent } from '@monsters/shared';
import { memo, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { describeError } from '../../lib/api.ts';
import { openChat } from '../../lib/router.ts';
import { dismissUndoConflict, getApi, notify, undoAction, useApp } from '../../store/app.ts';
import {
  categoryOf,
  describeEvent,
  isQuietError,
  runOwners,
  undoConflictText,
} from '../../store/derive.ts';
import { canUndo, TYPE_LABEL, undoState } from './activity.ts';
import { detailsOf } from './details.ts';
import { useAgent, useNameOf } from '../../store/hooks.ts';
import { cn, domId, formatTime, prettyJson } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import './log.css';

/**
 * Who acted, as a picture: a monster on its small black screen, you or
 * Monsters as an icon in a well of the same size.
 */
export function ActorAvatar({ id, size = 30 }: { id: string; size?: number }) {
  const agent = useAgent(id);
  const height = Math.round(size * 0.86);
  if (agent)
    return <MonsterScreen genome={agent.genome} mood="idle" width={size} height={height} />;
  const Icon = id === 'user' ? User : Gear;
  return (
    <span
      className="well inline-flex shrink-0 items-center justify-center rounded-[8px] text-ink-muted"
      style={{ width: size, height }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

/**
 * The light of who acted on the tape: a monster's LED colour (the light of its
 * dots), the ink for you, an unlit light for Monsters; red for an error.
 */
export function ActorLight({ id, error = false }: { id: string; error?: boolean }) {
  const agent = useAgent(id);
  const lit = useMemo(() => (agent ? dotPalette(agent.genome).lit : null), [agent]);
  if (error) return <span aria-hidden className="led" data-tone="stop" />;
  const color = lit ?? (id === 'user' ? 'var(--ink)' : null);
  return (
    <span
      aria-hidden
      className="led"
      data-tone={lit ? 'ok' : undefined}
      style={color ? ({ '--led': color } as CSSProperties) : undefined}
    />
  );
}

/**
 * Undoes a change (or the undo of it: "Rifai"), with a toast that offers the
 * opposite for 8 seconds. Exported for the other places with an undo.
 */
export async function toggleUndo(actionId: string, force = false): Promise<void> {
  const before = undoState(actionId, useApp.getState().undone, useApp.getState().events);
  if (!before.next) return;
  const ok = await undoAction(before.next, force, true);
  if (!ok) return;
  const nowUndone = !before.undone;
  notify(nowUndone ? 'Modifica annullata' : 'Modifica rifatta', 'success', {
    // The toast offers the opposite: the change back, or undone again.
    action: { label: nowUndone ? 'Rifai' : 'Annulla', run: () => void toggleUndo(actionId) },
    ms: 8000,
  });
}

/**
 * Annulla / Annullata · Rifai for one vault action. The state follows the
 * chain of undos (an undo of the undo brings the change back), so it is right
 * after a "Rifai" and after a reload.
 */
export function UndoButton({
  actionId,
  compact = false,
}: {
  actionId: string;
  /** Narrow columns: a small key with the icon only, the words in its name and tooltip. */
  compact?: boolean;
}) {
  // Two primitive selections: a new object per render would loop the store.
  const undone = useApp((s) => undoState(actionId, s.undone, s.events).undone);
  const next = useApp((s) => undoState(actionId, s.undone, s.events).next);
  const state = { undone, next };
  const conflicted = state.next ?? actionId;
  const conflict = useApp((s) => s.undoConflicts[conflicted]);
  const [busy, setBusy] = useState(false);
  const run = (force = false) => {
    setBusy(true);
    void toggleUndo(actionId, force).finally(() => setBusy(false));
  };
  if (conflict)
    return (
      <div
        className="flex max-w-[280px] flex-col items-end gap-1.5 text-right"
        role="alert"
        data-testid="undo-conflict"
      >
        <p className="text-footnote leading-snug text-ink-muted">{undoConflictText(conflict)}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => dismissUndoConflict(conflicted)}>
            Lascia stare
          </Button>
          <Button
            size="sm"
            variant="dangerSoft"
            disabled={busy}
            onClick={() => run(true)}
            data-testid="undo-force"
          >
            {state.undone ? 'Rifai comunque' : 'Annulla comunque'}
          </Button>
        </div>
      </div>
    );
  if (state.undone)
    return (
      <span className="inline-flex shrink-0 items-center gap-2" data-testid="undo-done">
        <span className="label px-1 text-ink-faint">Annullata</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !state.next}
          onClick={() => run()}
          data-testid="redo"
          aria-label={compact ? 'Rifai' : undefined}
          title={compact ? 'Rifai la modifica' : undefined}
          className={cn(compact && 'size-8 rounded-[8px] px-0')}
        >
          <ArrowArcRight size={16} aria-hidden />
          {!compact && 'Rifai'}
        </Button>
      </span>
    );
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy || !state.next}
      onClick={() => run()}
      data-testid="undo"
      aria-label={compact ? 'Annulla' : undefined}
      title={compact ? 'Annulla la modifica' : undefined}
      className={cn(compact && 'size-8 rounded-[8px] px-0')}
    >
      <ArrowCounterClockwise size={16} aria-hidden />
      {!compact && 'Annulla'}
    </Button>
  );
}

/**
 * A sentence of the tape with its hyphenated words kept whole: a note called
 * "2026-10-14" never breaks into "2026-" and "10-14" on a narrow screen.
 */
export function unbroken(text: string): ReactNode[] {
  return text.split(/(\S+-\S+)/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** "Rispondi" on a question still open: to the chat where it waits (where its run started). */
function AnswerKey({ e }: { e: LogEvent<'question'> }) {
  // Only an open question looks for its chat (the owners of the runs cost a pass on the log).
  const home = useApp((s) => {
    if (s.questions[e.data.questionId]?.status !== 'open') return null;
    return (e.runId && runOwners(s.events).get(e.runId)) || e.agent;
  });
  if (!home) return null;
  return (
    <Button
      size="sm"
      variant="primary"
      onClick={() => openChat(home)}
      data-testid="answer-question"
    >
      <ArrowBendUpLeft size={16} weight="bold" aria-hidden />
      Rispondi
    </Button>
  );
}

function EventDetails({ id, e }: { id: string; e: LogEvent }) {
  const fields = detailsOf(e);
  return (
    <div id={id} className="screen tape-screen mt-2.5 mb-1 rounded-[10px] px-4 py-3 text-footnote">
      {fields.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-5 gap-y-2">
          {fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="label pt-px">{f.label}</dt>
              <dd
                data-code={f.code ? '' : undefined}
                className="max-h-48 min-w-0 overflow-auto break-words whitespace-pre-wrap [scrollbar-color:var(--screen-muted)_transparent] [scrollbar-width:thin]"
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <details className={cn(fields.length > 0 && 'mt-2.5')}>
        <summary className="label cursor-pointer text-screen-muted select-none hover:text-screen-ink">
          Dati tecnici
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto font-mono text-caption leading-[1.6] break-words whitespace-pre-wrap text-screen-ink [scrollbar-color:var(--screen-muted)_transparent] [scrollbar-width:thin]">
          {prettyJson({ type: e.type, agent: e.agent, runId: e.runId, ...e.data })}
        </pre>
      </details>
    </div>
  );
}

/** A reply of a dedicated bot the check held (D-114): the user may send it all the same. */
function heldReplyOf(e: LogEvent): boolean {
  return (
    e.type === 'instinct' &&
    e.data.action === 'outbound_refused' &&
    e.data.details?.['tool'] === 'telegram_reply' &&
    typeof e.data.details['held'] === 'object' &&
    e.data.details['held'] !== null
  );
}

/** «Manda comunque» (review of the waves 3 and 4); «Mandata» once it went. */
export function SendHeldButton({ e }: { e: LogEvent }) {
  const sent = useApp((s) =>
    s.events.some(
      (x) =>
        x.type === 'instinct' &&
        x.data.action === 'outbound_approved' &&
        x.data.details?.['heldId'] === e.id,
    ),
  );
  const [busy, setBusy] = useState(false);
  if (sent) return <span className="label px-1 text-ink-faint">Mandata</span>;
  const send = async () => {
    setBusy(true);
    try {
      await getApi().sendHeldReply(e.id);
      notify('Fatto: la risposta è partita.', 'success');
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void send()}>
      Manda comunque
    </Button>
  );
}

/** One event of Attività in plain language, with details on demand. */
export const EventRow = memo(function EventRow({
  e,
  compact = false,
}: {
  e: LogEvent;
  compact?: boolean;
}) {
  const nameOf = useNameOf();
  const [open, setOpen] = useState(false);
  const id = domId(useId());
  const cat = categoryOf(e);
  // Red only for what stopped the work: a step that failed and was made up for is a neutral line.
  const isError = e.type === 'error' && !isQuietError(e);
  const undo = canUndo(e) && e.type === 'vault_change' ? e.data.actionId : undefined;
  const actor =
    e.type === 'delegation' && e.data.status !== 'started'
      ? e.data.to
      : e.type === 'instinct' && e.data.subject
        ? e.data.subject
        : e.agent;
  const time = (
    <time
      dateTime={new Date(e.ts).toISOString()}
      className="label pt-[3px] text-ink-faint tabular-nums"
    >
      {formatTime(e.ts)}
    </time>
  );
  return (
    <li
      className={cn(
        'grid items-start gap-x-3',
        compact
          ? 'grid-cols-[2.75rem_8px_minmax(0,1fr)] py-2'
          : 'grid-cols-[2.75rem_8px_minmax(0,1fr)] py-3 sm:grid-cols-[3rem_8px_minmax(0,1fr)_auto] sm:gap-x-4',
      )}
      data-testid="event-row"
      data-type={e.type}
    >
      {time}
      <span className="flex h-[22px] items-center">
        <ActorLight id={actor} error={isError} />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'leading-snug',
            compact ? 'text-footnote' : 'text-body',
            isError ? 'text-stop-ink' : 'text-ink',
          )}
        >
          {unbroken(describeEvent(e, nameOf))}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-ink-faint">
          <span className="label">{TYPE_LABEL[cat]}</span>
          {!compact && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((v) => !v)}
              className="hit-24 inline-flex items-center gap-1 rounded-[4px] text-caption font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
            >
              Dettagli
              <CaretRight
                size={10}
                weight="bold"
                aria-hidden
                className={cn('turn', open && 'rotate-90')}
              />
            </button>
          )}
        </p>
        {open && <EventDetails id={id} e={e} />}
      </div>
      {!compact && undo && (
        <div className="flex max-sm:col-start-3 max-sm:mt-2.5 sm:justify-end">
          <UndoButton actionId={undo} />
        </div>
      )}
      {!compact && heldReplyOf(e) && (
        <div className="flex max-sm:col-start-3 max-sm:mt-2.5 sm:justify-end">
          <SendHeldButton e={e} />
        </div>
      )}
      {!compact && e.type === 'question' && (
        <div className="flex empty:hidden max-sm:col-start-3 max-sm:mt-2.5 sm:justify-end">
          <AnswerKey e={e} />
        </div>
      )}
    </li>
  );
});
