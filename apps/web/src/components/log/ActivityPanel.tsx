import { ArrowRight } from '@phosphor-icons/react';
import type { LogEvent } from '@monsters/shared';
import { useMemo } from 'react';
import { useApp } from '../../store/app.ts';
import {
  agentFileOf,
  baseName,
  isUserNoteChange,
  listText,
  recentMemoryOwners,
  runOwners,
} from '../../store/derive.ts';
import { useNameOf } from '../../store/hooks.ts';
import { still } from '../../lib/motion.ts';
import { plainText } from '../../lib/markdown.ts';
import { MCP_PAUSED_PATH, openChat, PATHS, vaultPath } from '../../lib/router.ts';
import { cn, formatAgo } from '../../lib/utils.ts';
import { DraftsSection } from '../projects/DraftCards.tsx';
import { canUndo, pausedToolEvents } from './activity.ts';
import { ActorAvatar, ActorLight, UndoButton } from './EventRow.tsx';

const VERB: Record<string, string> = {
  create: 'creata',
  edit: 'modificata',
  move: 'spostata',
  delete: 'cestinata',
  restore: 'ripristinata',
  undo: 'modifica annullata',
};

/** How many notes "Note toccate" lists. */
const NOTES_SHOWN = 5;

/**
 * The latest change of each note touched recently (newest first): after an
 * undo and a restore the row tells the restore, not "Annullata".
 */
export function latestNoteChanges(
  events: readonly LogEvent[],
  max = NOTES_SHOWN,
): LogEvent<'vault_change'>[] {
  const out: LogEvent<'vault_change'>[] = [];
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i]!;
    if (e.type !== 'vault_change' || !isUserNoteChange(e)) continue;
    const key = e.data.path.toLocaleLowerCase('it-IT');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** The latest change a monster made to its own notes (its memory): when and who, for the panel. */
export function latestMemoryChange(events: readonly LogEvent[]): LogEvent<'vault_change'> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'vault_change' || e.agent === 'system') continue;
    if (agentFileOf(e.data.path)?.kind === 'memory') return e;
  }
  return null;
}

/**
 * The change a row is about: an undo (or the undo of an undo, "Rifai") stands
 * for the change at the start of the chain, shown with its state.
 */
export function rootChange(
  events: readonly LogEvent[],
  e: LogEvent<'vault_change'>,
): LogEvent<'vault_change'> | null {
  let at: LogEvent<'vault_change'> | undefined = e;
  for (let guard = 0; at && at.data.action === 'undo' && guard < 50; guard++) {
    const id: string | undefined = at.data.undoneActionId;
    if (!id) return null;
    at = events.find(
      (x): x is LogEvent<'vault_change'> => x.type === 'vault_change' && x.data.actionId === id,
    );
  }
  return at && canUndo(at) ? at : null;
}

/**
 * "Da rivedere", the optional column next to the chat on wide windows: the
 * drafts of the monsters to confirm (D-098, D-100), the questions waiting for
 * you and the notes touched lately, each with its undo.
 * Everything else is in Attività.
 */
export function ActivityPanel({ className }: { className?: string }) {
  const events = useApp((s) => s.events);
  const questions = useApp((s) => s.questions);
  const nameOf = useNameOf();
  const open = Object.values(questions).filter((q) => q.status === 'open');
  const notes = useMemo(() => latestNoteChanges(events), [events]);
  const memories = useMemo(() => recentMemoryOwners(events), [events]);
  const memory = useMemo(
    () => (memories.length > 0 ? latestMemoryChange(events) : null),
    [memories, events],
  );
  const owners = useMemo(() => runOwners(events), [events]);
  const paused = useMemo(() => pausedToolEvents(events), [events]);

  return (
    <aside
      aria-label="Da rivedere"
      data-testid="activity-panel"
      className={cn('flex min-h-0 flex-col overflow-hidden', className)}
    >
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h2 className="px-1 pb-4 text-title3 font-semibold text-ink">Da rivedere</h2>
        <DraftsSection />
        {paused.length > 0 && (
          <section aria-labelledby="paused-title" className="mb-6" data-testid="paused-tools">
            <h3
              id="paused-title"
              className="label flex items-center gap-2 px-1 pb-2 text-ink-muted"
            >
              <span aria-hidden className="led" data-tone="signal" />
              Strumenti fermi
            </h3>
            <ul className="tape">
              {paused.map((e) => (
                <li key={e.id} className="px-1.5 py-2.5">
                  <p className="text-body leading-snug text-ink">
                    {e.data.message ?? 'Uno strumento è cambiato.'}
                  </p>
                  <a
                    href={MCP_PAUSED_PATH}
                    className="label mt-1 inline-flex min-h-6 items-center gap-1 text-signal-ink hover:underline"
                  >
                    Decidi nelle impostazioni <ArrowRight size={12} weight="bold" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="pending-title" className="mb-6">
          <h3 id="pending-title" className="label flex items-center gap-2 px-1 pb-2 text-ink-muted">
            <span
              aria-hidden
              className="led"
              data-tone={open.length > 0 ? 'signal' : undefined}
              data-blink={open.length > 0 ? '' : undefined}
            />
            Aspettano una tua risposta
          </h3>
          {open.length === 0 ? (
            <p className="px-1 py-1.5 text-body text-ink-muted">Nessuna domanda aperta.</p>
          ) : (
            <ul className="tape">
              {open.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => {
                      openChat(owners.get(q.runId) ?? q.from);
                      // The chat may have to mount first.
                      setTimeout(() =>
                        document
                          .querySelector(`[data-question="${CSS.escape(q.id)}"]`)
                          ?.scrollIntoView({
                            behavior: still() ? 'auto' : 'smooth',
                            block: 'center',
                          }),
                      );
                    }}
                    className="row-key flex w-full items-start gap-3 rounded-[10px] px-1.5 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
                    data-testid="pending-question"
                  >
                    <ActorAvatar id={q.from} size={36} />
                    <span className="min-w-0">
                      <span className="label block text-ink-faint">{nameOf(q.from)} ti chiede</span>
                      <span className="mt-0.5 line-clamp-3 block text-body leading-snug font-medium text-ink">
                        {plainText(q.question)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="notes-title">
          <h3 id="notes-title" className="label px-1 pb-2 text-ink-muted">
            Note toccate
          </h3>
          {notes.length === 0 ? (
            <p className="px-1 py-1.5 text-body text-ink-muted">
              Nessuna nota modificata, per ora.
            </p>
          ) : (
            <ul className="tape">
              {notes.map((latest) => {
                const root = rootChange(events, latest);
                const e = root ?? latest;
                const gone = latest.data.action === 'delete';
                return (
                  <li
                    key={latest.id}
                    className="flex items-center gap-3 px-1.5 py-2.5"
                    data-testid="note-row"
                  >
                    <span className="flex h-5 w-2 shrink-0 items-center">
                      <ActorLight id={e.agent} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* The title on up to two lines: the end of a name is often the point. */}
                      {gone ? (
                        <p className="line-clamp-2 text-body leading-snug font-medium break-words text-ink-muted line-through decoration-1">
                          {baseName(e.data.path)}
                        </p>
                      ) : (
                        <a
                          href={vaultPath(e.data.path)}
                          className="line-clamp-2 text-body leading-snug font-medium break-words text-ink hover:underline"
                        >
                          {baseName(e.data.path)}
                        </a>
                      )}
                      {/* Who may be cut, never when: the time keeps its place. */}
                      <p className="mt-0.5 flex min-w-0 gap-1 text-caption text-ink-muted">
                        <span className="min-w-0 truncate">
                          {VERB[e.data.action] ?? 'toccata'} da{' '}
                          {e.agent === 'user' ? 'te' : nameOf(e.agent)}
                        </span>
                        <span className="shrink-0 tabular-nums">·&nbsp;{formatAgo(e.ts)}</span>
                      </p>
                    </div>
                    {root?.data.actionId && <UndoButton actionId={root.data.actionId} compact />}
                  </li>
                );
              })}
              {memory && (
                <li className="flex items-center gap-3 px-1.5 py-2.5" data-testid="memory-line">
                  <span className="flex h-5 w-2 shrink-0 items-center">
                    <ActorLight id={memory.agent} />
                  </span>
                  <p className="flex min-w-0 flex-1 gap-1 text-caption text-ink-muted">
                    <span className="min-w-0">
                      {listText(memories)}{' '}
                      {memories.length === 1
                        ? 'ha aggiornato i suoi appunti'
                        : 'hanno aggiornato i loro appunti'}
                    </span>
                    <span className="shrink-0 tabular-nums">·&nbsp;{formatAgo(memory.ts)}</span>
                  </p>
                </li>
              )}
            </ul>
          )}
        </section>

        <a
          href={PATHS.log}
          className="key mt-6 inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-footnote font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
        >
          Tutta l’attività <ArrowRight size={15} weight="bold" aria-hidden />
        </a>
      </div>
    </aside>
  );
}
