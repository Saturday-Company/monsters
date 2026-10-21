import { CaretRight, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import type { Question as QuestionT } from '@monsters/shared';
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { Squad } from '../../lib/projects.ts';
import { plainText } from '../../lib/markdown.ts';
import { chatPath, openPage, projectPath } from '../../lib/router.ts';
import { cn, domId, formatListTime } from '../../lib/utils.ts';
import {
  capitalize,
  chatSummary,
  CONFUSED_TEXT,
  previewText,
  type ChatItem,
} from '../../store/derive.ts';
import {
  statusText,
  useLive,
  useNameOf,
  useResolvedTheme,
  waitsForUser,
  type AgentView,
} from '../../store/hooks.ts';
import { setPrefs, usePrefs } from '../../store/prefs.ts';
import { seenOf, useReads } from '../../store/reads.ts';
import { accentInk } from '../../theme/bubbles.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { GodBar } from '../god/GodBar.tsx';
import { KeyCap } from '../ui/button.tsx';
import { Meter } from '../ui/Meter.tsx';
import { openPalette } from '../shell/CommandPalette.tsx';
import { chatStrings } from './chat.strings.ts';

/*
 * The chat list: one strip per monster (docs/design.md, "Striscia del
 * mostro": its screen, name, state, time and lights), in the team's order: the
 * orchestrator first, as the god's bar at the head (D-101, D-102), then the
 * squads (the personal one, then the projects with their lead first, D-100),
 * each foldable. The order never changes with the traffic: the monsters keep their
 * place, so the hand finds them where it left them. What needs the user
 * stands out instead: a question waiting for an answer, then unread messages.
 */

/** Whether a key press asks for the next or previous row of a vertical list. */
function step(key: string): number | 'first' | 'last' | null {
  if (key === 'ArrowDown') return 1;
  if (key === 'ArrowUp') return -1;
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/** ⌘1 / Ctrl 1: the god's chat from anywhere (ReadyShell). */
const GOD_SHORTCUT = isMac
  ? { shown: '⌘1', aria: 'Meta+1' }
  : { shown: 'Ctrl 1', aria: 'Control+1' };

export interface ChatListProps {
  /** The orchestrator, above every squad (the God of the monsters, plan B2): its bar, not a row. */
  god: AgentView | null;
  /** The personal squad, then one per active project (lib/projects.ts, `squadsOf`). */
  squads: readonly Squad<AgentView>[];
  threads: ReadonlyMap<string, ChatItem[]>;
  /** Open questions per chat they belong to (see `questionHome`). */
  waiting: ReadonlyMap<string, QuestionT[]>;
  selected: string | null;
  onOpen: (agentId: string) => void;
  /** The project whose page is on screen: its name is the current place. */
  currentProject?: string | null;
  /** After the squads, inside the list: "Nuovo progetto" (D-100). */
  afterSquads?: ReactNode;
  /** What follows the monsters in the scrolling part of the sidebar (Note, Attività). */
  after?: ReactNode;
}

/** The key of the personal squad among the folded ones (the projects use their ids). */
const PERSONAL_KEY = '~personale';

/** The chat rows on screen, in order (folded squads have none). */
function rowsIn(nav: HTMLElement | null): HTMLAnchorElement[] {
  return nav ? [...nav.querySelectorAll<HTMLAnchorElement>('[data-testid="chat-row"]')] : [];
}

/**
 * Whether the scrolling list continues below what is in sight: the fade at its foot says so.
 * Follows the scroll, the size of the list and the size of what it holds.
 */
function useMoreBelow(scroller: React.RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    el.addEventListener('scroll', check, { passive: true });
    // Observing calls it once at the start, then on every change of size.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [scroller]);
  return more;
}

export function ChatList({
  god,
  squads,
  threads,
  waiting,
  selected,
  onOpen,
  currentProject = null,
  afterSquads,
  after,
}: ChatListProps) {
  const nav = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const moreBelow = useMoreBelow(scroller);
  const godBar = useRef<HTMLAnchorElement>(null);
  const hintId = `${domId(useId())}-hint`;
  const s = chatStrings().list;
  const folded = usePrefs((p) => p.foldedSquads);
  const shown = [
    ...(god ? [god] : []),
    ...squads.flatMap((g) => (folded.includes(g.key || PERSONAL_KEY) ? [] : g.members)),
  ];
  // One row in the tab order: the open chat, else the first one.
  const tabbable = shown.some((a) => a.id === selected) ? selected : (shown[0]?.id ?? null);

  // The god's bar is the first stop of the arrows, above the strips (D-102).
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const s = step(e.key);
    const rows = [...(godBar.current ? [godBar.current] : []), ...rowsIn(nav.current)];
    if (s === null || rows.length === 0) return;
    const at = rows.findIndex((r) => r === document.activeElement);
    // Only between the rows: the keys of the squads' names keep their own arrows.
    if (at < 0) return;
    e.preventDefault();
    const next =
      s === 'first'
        ? 0
        : s === 'last'
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, at + s));
    const row = rows[next]!;
    row.focus();
    const id = row.dataset['agent'];
    if (id) onOpen(id);
  };

  const row = (a: AgentView) => (
    <li key={a.id}>
      <ChatRow
        agent={a}
        thread={threads.get(a.id) ?? []}
        waiting={waiting.get(a.id) ?? []}
        selected={a.id === selected}
        tabbable={a.id === tabbable}
        onOpen={() => onOpen(a.id)}
      />
    </li>
  );

  return (
    <>
      {god && (
        <GodBar
          ref={godBar}
          god={god}
          thread={threads.get(god.id) ?? []}
          waiting={waiting.get(god.id) ?? []}
          selected={god.id === selected}
          tabbable={god.id === tabbable}
          onOpen={() => onOpen(god.id)}
          onKeyDown={onListKey}
          shortcut={GOD_SHORTCUT}
        />
      )}
      <div className="shrink-0 px-3 pt-1 pb-2">
        {/* The search of the instrument is the palette: monsters, notes, messages, commands. */}
        <button
          type="button"
          id="monster-search"
          onClick={() => openPalette()}
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          aria-describedby={hintId}
          data-testid="search-key"
          className="well relative flex h-10 w-full items-center rounded-[10px] pr-3 pl-10 text-left text-body text-ink-muted focus-visible:outline-2 focus-visible:outline-signal-ink"
        >
          <MagnifyingGlass
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-3 text-ink-muted"
          />
          <span className="min-w-0 flex-1 truncate">{s.search}</span>
          <KeyCap className="pointer-events-none shrink-0 max-md:hidden">
            {isMac ? '⌘K' : 'Ctrl K'}
          </KeyCap>
          <span id={hintId} className="sr-only">
            {s.hint(isMac)}
          </span>
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} className="scroll-soft min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <nav
            ref={nav}
            aria-label={s.nav}
            data-testid="chat-list-nav"
            onKeyDown={onListKey}
            className="grid grid-cols-[minmax(0,1fr)]"
          >
            {squads.map((g) =>
              g.members.length === 0 && squads.length === 1 ? null : (
                <SquadGroup
                  key={g.key || PERSONAL_KEY}
                  squad={g}
                  folded={folded.includes(g.key || PERSONAL_KEY)}
                  current={!!g.key && g.key === currentProject}
                >
                  {g.members.map(row)}
                </SquadGroup>
              ),
            )}
            {afterSquads}
          </nav>
          {after}
        </div>
        {moreBelow && (
          // The list goes on below: the chassis fades over its last row.
          <div
            aria-hidden
            data-testid="list-fade"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-chassis to-transparent"
          />
        )}
      </div>
    </>
  );
}

function toggleFold(key: string) {
  const folded = usePrefs.getState().foldedSquads;
  setPrefs({
    foldedSquads: folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key],
  });
}

/**
 * One squad of the sidebar (D-100): its name in `.label` with the number of
 * its monsters and the caret that folds it; a project's name leads to its
 * page. The rows are the monsters' strips, the lead first.
 */
function SquadGroup({
  squad,
  folded,
  current,
  children,
}: {
  squad: Squad<AgentView>;
  folded: boolean;
  current: boolean;
  children: ReactNode;
}) {
  const key = squad.key || PERSONAL_KEY;
  const listId = `squad-${domId(key)}`;
  const count = squad.members.length;
  const s = chatStrings().list;
  return (
    <section
      aria-label={squad.label}
      data-testid="squad"
      data-squad={squad.key || 'personale'}
      className="grid grid-cols-[minmax(0,1fr)] gap-0.5 pt-2"
    >
      <h2 className="flex h-9 min-w-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => toggleFold(key)}
          aria-expanded={!folded}
          aria-controls={folded ? undefined : listId}
          aria-label={s.foldLabel(folded, squad.label)}
          title={s.foldTitle(folded)}
          data-testid="squad-fold"
          className="key-ghost inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:text-ink"
        >
          <CaretRight
            size={12}
            weight="bold"
            aria-hidden
            className={cn('turn', !folded && 'rotate-90')}
          />
        </button>
        {squad.key ? (
          <a
            href={projectPath(squad.key)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              openPage(projectPath(squad.key));
            }}
            aria-current={current ? 'page' : undefined}
            data-testid="squad-link"
            className={cn(
              'label flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink',
              current
                ? 'bg-panel text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]'
                : 'row-key text-ink-muted hover:text-ink',
            )}
          >
            <span className="min-w-0 truncate">{squad.label}</span>
            <span aria-hidden className="shrink-0">
              · {count}
            </span>
            <span className="sr-only">{s.squadSr(count)}</span>
          </a>
        ) : (
          <span className="label flex min-w-0 flex-1 items-center gap-2 px-2 text-ink-muted">
            <span className="min-w-0 truncate">{squad.label}</span>
            <span aria-hidden className="shrink-0">
              · {count}
            </span>
          </span>
        )}
      </h2>
      {!folded && (
        <ul id={listId} className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {children}
        </ul>
      )}
    </section>
  );
}

export const ChatRow = forwardRef<
  HTMLAnchorElement,
  {
    agent: AgentView;
    thread: readonly ChatItem[];
    waiting: readonly QuestionT[];
    selected: boolean;
    tabbable: boolean;
    onOpen: () => void;
  }
>(function ChatRow({ agent, thread, waiting, selected, tabbable, onOpen }, ref) {
  const s = chatStrings().list;
  const live = useLive(agent.id);
  const nameOf = useNameOf();
  const theme = useResolvedTheme();
  const seen = useReads((r) => seenOf(r, agent.id));
  const summary = useMemo(() => chatSummary(thread, seen), [thread, seen]);
  const previewId = `${domId(useId())}-preview`;
  // The open chat is being read: no badge for it.
  const unread = selected ? 0 : summary.unread;
  const question = waiting.at(-1);
  const meter = accentInk(agent.color, theme);
  const asks = waitsForUser(live);
  const busy =
    !asks && (live.mood === 'working' || live.mood === 'talking' || live.mood === 'waiting');

  let line: ReactNode;
  if (question) {
    line = <span className="font-medium text-ink">{s.asks(plainText(question.question))}</span>;
  } else if (asks) {
    // Its question sits in the chat where the work started (e.g. the orchestrator's).
    line = <span className="font-medium text-ink">{s.waitingAnswer}</span>;
  } else if (live.mood === 'error') {
    line = (
      <span className="flex min-w-0 items-center gap-1 text-stop-ink">
        <WarningCircle size={15} weight="fill" aria-hidden className="shrink-0" />
        <span className="truncate">{live.activity ?? s.problem}</span>
      </span>
    );
  } else if (busy) {
    line = (
      <span className="text-ink">
        {live.confused
          ? capitalize(CONFUSED_TEXT)
          : (live.activity ?? (live.mood === 'talking' ? s.writing : s.atWork))}
      </span>
    );
  } else if (live.mood === 'stopped') {
    line = s.sleeps;
  } else if (summary.last) {
    line = previewText(summary.last, nameOf);
  } else {
    line = agent.role || s.noMessages;
  }

  const label = [
    `${agent.name}, ${statusText(live)}`,
    question ? s.asksLabel(plainText(question.question)) : null,
    unread ? s.unreadLabel(unread) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <a
      ref={ref}
      href={chatPath(agent.id)}
      onClick={(e) => {
        // A plain click opens the chat in place; with a modifier the browser opens a new tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen();
      }}
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-describedby={question ? undefined : previewId}
      aria-current={selected ? 'page' : undefined}
      data-testid="chat-row"
      data-agent={agent.id}
      data-waiting={question ? 'true' : undefined}
      className={cn(
        'group relative flex h-[68px] w-full items-center gap-3 rounded-[12px] py-2 pr-3 pl-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink',
        selected ? 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'row-key',
      )}
    >
      <MonsterScreen
        genome={agent.genome}
        mood={live.mood}
        confused={live.confused}
        width={60}
        height={52}
        // Always alive: at rest it blinks, at work it thinks, done it is happy, stopped it
        // sleeps. Frames are visibility toggles, nearly free; out of sight they rest.
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-large leading-6 font-semibold text-ink">
            {agent.name}
          </span>
          {summary.last && (
            <time
              dateTime={new Date(summary.last.ts).toISOString()}
              className={cn(
                'label shrink-0 font-normal',
                unread || question ? 'text-signal-ink' : 'text-ink-muted',
              )}
            >
              {formatListTime(summary.last.ts)}
            </time>
          )}
        </span>
        <span className="mt-0.5 flex h-5 items-center gap-2">
          <span
            id={previewId}
            className={cn(
              'min-w-0 flex-1 truncate text-caption leading-5',
              unread ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {line}
          </span>
          {question ? (
            <span
              className="label inline-flex shrink-0 items-center gap-1.5 text-signal-ink"
              data-testid="chat-row-question"
            >
              <span aria-hidden className="led" data-tone="signal" data-blink="" />
              {waiting.length}
              <span className="sr-only">{s.questionsSr(waiting.length)}</span>
            </span>
          ) : unread > 0 ? (
            <span
              className="label inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-ink px-1.5 text-panel"
              data-testid="chat-row-unread"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : busy ? (
            <Meter active color={meter} className="shrink-0" />
          ) : null}
        </span>
      </span>
    </a>
  );
});
