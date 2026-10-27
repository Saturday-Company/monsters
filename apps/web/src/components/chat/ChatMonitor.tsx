import { dotPalette } from '@monsters/monster-kit';
import type { ChatConversation } from '@monsters/shared';
import { ClockCounterClockwise, NotePencil, TerminalWindow } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { KICK_MS } from '../../lib/motion.ts';
import { cn, domId, formatShortDay, formatTime } from '../../lib/utils.ts';
import { errorText, getApi, notify, startNewConversation } from '../../store/app.ts';
import { CONFUSED_TEXT, type LiveState } from '../../store/derive.ts';
import { waitsForUser, type AgentView } from '../../store/hooks.ts';
import { usePrefs } from '../../store/prefs.ts';
import { expressionFor, Monster } from '../monster/Monster.tsx';
import { fitDots } from '../monster/MonsterScreen.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { useLayer } from '../ui/layers.ts';
import { Meter } from '../ui/Meter.tsx';
import { ContextKey } from '../usage/ContextKey.tsx';
import { chatStrings } from './chat.strings.ts';

/** "Behind the scenes" (the agent terminal): the label of the UI, "terminal" in the tooltip. */
export const behindTheScenes = (name: string) => chatStrings().monitor.behind(name);

/** Height of the monitor and of the creature on it (docs/design.md, "Monitor del mostro"). */
const MONITOR_H = 76;
const CREATURE_H = 60;

/*
 * The monster's monitor, on top of its chat (docs/design.md, "La chat"): a
 * black screen across the column that never scrolls, with the creature big,
 * its name in Doto in its own light, what it is doing in Martian Mono, and its
 * light keys (the context meter only with "Show technical details", Behind the
 * scenes, Conversations, New conversation), 40 px tall. When the monster starts
 * working the name flickers like a screen waking up and the meter starts; a
 * question waiting lights the orange lamp.
 */
export function ChatMonitor({
  agent,
  live,
  roleText,
  asking,
  halted,
  noModel,
  canStartOver,
  viewing,
  currentSince,
  onViewConversation,
}: {
  agent: AgentView;
  live: LiveState;
  /** "capo squadra · coordina 3 mostri", or the role of a member. */
  roleText: string;
  /** A question of this chat waits for the user. */
  asking: boolean;
  halted: boolean;
  noModel: boolean;
  canStartOver: boolean;
  /** The earlier conversation on screen (read-only), or null for the current one. */
  viewing: ChatConversation | null;
  /** When the current conversation began, if known (the list says "Since …"). */
  currentSince: number | null;
  /** A pick in the Conversations list: an earlier one, or null for the current. */
  onViewConversation: (c: ChatConversation | null) => void;
}) {
  const details = usePrefs((p) => p.showDetails);
  /** Where the Conversations list hangs, under the screen (it would be cut inside it). */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const lit = dotPalette(agent.genome).lit;
  const busy =
    !waitsForUser(live) &&
    (live.mood === 'working' || live.mood === 'talking' || live.mood === 'waiting');
  const kick = useKick(busy);
  const size = fitDots(200, CREATURE_H, 0);
  const s = chatStrings().monitor;

  let status: ReactNode;
  if (halted) {
    // The halt band says why: the monitor only says how the monster is.
    status = <span className="truncate text-screen-muted">{s.asleep}</span>;
  } else if (asking) {
    status = (
      <span className="text-screen-signal flex min-w-0 items-center gap-2">
        <span aria-hidden className="led" data-tone="signal" data-blink="" />
        <span className="truncate @max-[460px]:hidden">{s.waitingAnswer}</span>
        <span className="truncate @min-[460px]:hidden">{s.questionForYou}</span>
      </span>
    );
  } else if (live.mood === 'error') {
    status = (
      <span className="flex min-w-0 items-start gap-2 text-screen-stop">
        <span aria-hidden className="led mt-1" data-tone="stop" />
        <span className="line-clamp-2">{live.activity ?? s.problem}</span>
      </span>
    );
  } else if (busy && live.confused) {
    // Going round in circles: the instinct asked it to change its way (D-067).
    status = (
      <span
        className="flex min-w-0 items-center gap-2 text-screen-ink"
        data-testid="monitor-confused"
      >
        <span aria-hidden className="monitor-name font-mono text-caption leading-4 font-semibold">
          ?
        </span>
        <span className="label truncate @max-[460px]:hidden">{CONFUSED_TEXT}</span>
        <span className="label truncate @min-[460px]:hidden">{s.changingCourse}</span>
      </span>
    );
  } else if (busy) {
    status = (
      <span className="flex min-w-0 items-start gap-2 text-screen-ink">
        <Meter active color={lit} className="monitor-meter mt-[3px] shrink-0" />
        <span className="line-clamp-2">
          {live.activity ?? (live.mood === 'talking' ? s.writing : s.atWork)}
        </span>
      </span>
    );
  } else if (noModel) {
    status = <span className="text-screen-muted">{s.waitingModel}</span>;
  } else {
    status = <span className="truncate text-screen-muted">{roleText}</span>;
  }

  return (
    <div className="@container shrink-0 px-4 pt-4 pb-1">
      <div
        className="monitor screen screen-lines flex items-center gap-4 overflow-hidden @max-[460px]:gap-3 rounded-[12px] pr-2 pl-4"
        style={{ height: MONITOR_H, '--lit': lit } as CSSProperties}
        data-testid="chat-monitor"
        data-kick={kick ? '' : undefined}
        data-mood={live.mood}
        data-confused={live.confused ? 'true' : undefined}
      >
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: size, height: CREATURE_H }}
        >
          <Monster
            genome={agent.genome}
            size={size}
            expression={expressionFor(live.mood, live.confused)}
          />
        </span>
        <div className="min-w-0 flex-1" aria-hidden>
          <p className="monitor-name dots truncate text-title1 leading-[30px]">{agent.name}</p>
          {/* What it is doing comes before the keys: two lines rather than cut. */}
          <p className="mt-0.5 flex max-h-8 min-h-4 min-w-0 items-center font-mono text-micro leading-4 tracking-[0.02em]">
            {status}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Consumi (D-075): the context as lineette, a technical detail (docs/design.md). */}
          {details && <ContextKey agentId={agent.id} name={agent.name} />}
          <button
            type="button"
            className="screen-key h-10 min-w-10"
            onClick={() => openTerminalAt(agent.id)}
            aria-label={behindTheScenes(agent.name)}
            title={s.behindTitle}
            data-testid="behind-the-scenes"
          >
            <TerminalWindow size={18} aria-hidden />
            <span className="label @max-[860px]:hidden" aria-hidden>
              {s.behindLabel}
            </span>
          </button>
          <ConversationsKey
            agent={agent}
            viewing={viewing}
            currentSince={currentSince}
            onPick={onViewConversation}
            popoverHost={host}
          />
          <NewConversationKey agent={agent} disabled={!canStartOver} />
        </div>
      </div>
      <div ref={setHost} className="relative h-0" />
    </div>
  );
}

/**
 * The conversations of this chat (F-5): a key that opens a list with the current one on top and
 * the earlier ones under it (title, day, messages). A pick shows that one read-only in the chat;
 * "Current" goes back. The list hangs under the monitor, outside its black screen.
 */
function ConversationsKey({
  agent,
  viewing,
  currentSince,
  onPick,
  popoverHost,
}: {
  agent: AgentView;
  viewing: ChatConversation | null;
  currentSince: number | null;
  onPick: (c: ChatConversation | null) => void;
  popoverHost: HTMLElement | null;
}) {
  const s = chatStrings().monitor;
  const [open, setOpen] = useState(false);
  const key = useRef<HTMLButtonElement>(null);
  const listId = domId(useId());
  return (
    <>
      <button
        ref={key}
        type="button"
        className="screen-key h-10 min-w-10"
        onClick={() => setOpen((o) => !o)}
        aria-label={s.conversations}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="dialog"
        title={s.conversationsTitle}
        data-testid="conversations-key"
        data-viewing={viewing ? '' : undefined}
      >
        <ClockCounterClockwise size={18} aria-hidden />
        <span className="label @max-[860px]:hidden" aria-hidden>
          {s.conversations}
        </span>
      </button>
      {open && popoverHost && (
        <ConversationsList
          id={listId}
          agent={agent}
          viewing={viewing}
          currentSince={currentSince}
          host={popoverHost}
          opener={key}
          onClose={() => setOpen(false)}
          onPick={(c) => {
            setOpen(false);
            onPick(c);
          }}
        />
      )}
    </>
  );
}

function NewConversationKey({ agent, disabled }: { agent: AgentView; disabled: boolean }) {
  const s = chatStrings().monitor;
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await startNewConversation(agent.id);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="screen-key h-10 min-w-10"
      onClick={() => void start()}
      disabled={disabled || busy}
      aria-label={s.newConversation}
      title={s.newConversationWith(agent.name)}
    >
      <NotePencil size={18} aria-hidden />
      <span className="label @max-[860px]:hidden" aria-hidden>
        {s.newConversation}
      </span>
    </button>
  );
}

/** True for the length of the flicker (KICK_MS, chat.css) when `busy` turns on: the monitor wakes up. */
function useKick(busy: boolean): boolean {
  const [kick, setKick] = useState(false);
  const was = useRef(busy);
  useEffect(() => {
    if (busy && !was.current) {
      setKick(true);
      const t = setTimeout(() => setKick(false), KICK_MS);
      was.current = busy;
      return () => clearTimeout(t);
    }
    was.current = busy;
    return undefined;
  }, [busy]);
  return kick;
}

/** One page of earlier conversations. */
const PAGE = 20;

function ConversationsList({
  id,
  agent,
  viewing,
  currentSince,
  host,
  opener,
  onClose,
  onPick,
}: {
  id: string;
  agent: AgentView;
  viewing: ChatConversation | null;
  currentSince: number | null;
  host: HTMLElement;
  opener: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPick: (c: ChatConversation | null) => void;
}) {
  const s = chatStrings().conversations;
  const panel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{
    items: ChatConversation[];
    next: string | null;
    loading: boolean;
    error: boolean;
  }>({ items: [], next: null, loading: true, error: false });
  const fetchPage = useCallback(
    (before?: string) =>
      getApi()
        .chatConversations(agent.id, { limit: PAGE, ...(before ? { before } : {}) })
        .then((page) =>
          setState((st) => ({
            items: before ? [...st.items, ...page.conversations] : page.conversations,
            next: page.next,
            loading: false,
            error: false,
          })),
        )
        .catch(() => setState((st) => ({ ...st, loading: false, error: true }))),
    [agent.id],
  );
  const load = (before?: string) => {
    setState((st) => ({ ...st, loading: true, error: false }));
    void fetchPage(before);
  };
  // The first page: the state starts out loading, so nothing is set before it answers.
  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);
  useLayer({ onEscape: onClose, ref: panel, initialFocus: 'first' });
  // A press outside (but not on the key, which toggles it) closes the list.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || opener.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose, opener]);

  const row =
    'flex min-h-11 w-full items-start justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-panel focus-visible:outline-2 focus-visible:outline-signal-ink';
  return createPortal(
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-label={s.title}
      data-testid="conversations-list"
      className="popover rise-in absolute top-1 right-0 z-40 max-h-[min(420px,60dvh)] w-[min(440px,100%)] overflow-x-hidden overflow-y-auto rounded-[14px] p-1.5"
    >
      <p className="label px-2.5 pt-1.5 pb-1 text-ink-muted">{s.title}</p>
      <button
        type="button"
        onClick={() => onPick(null)}
        aria-current={viewing ? undefined : 'true'}
        data-testid="conversation-current"
        className={cn(row, !viewing && 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]')}
      >
        <span className="min-w-0">
          <span className="block text-body font-semibold text-ink">{s.current}</span>
          {currentSince !== null && (
            <span className="block text-footnote text-ink-muted">
              {s.currentSince(`${formatShortDay(currentSince)}, ${formatTime(currentSince)}`)}
            </span>
          )}
        </span>
      </button>
      <ul className="mt-1 grid gap-0.5" data-testid="conversation-items">
        {state.items.map((c) => (
          <li key={c.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onPick(c)}
              aria-current={viewing?.id === c.id ? 'true' : undefined}
              data-testid="conversation-item"
              className={cn(
                row,
                viewing?.id === c.id && 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">
                  {c.title || s.untitled}
                </span>
                <span className="block text-footnote text-ink-muted">
                  {formatShortDay(c.startedAt)} · {s.messages(c.messages)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {state.loading && (
        <p className="px-2.5 py-3 text-footnote text-ink-muted" role="status">
          {s.loading}
        </p>
      )}
      {state.error && (
        <p className="flex items-center justify-between gap-3 px-2.5 py-2 text-footnote text-stop-ink">
          <span>{s.failed}</span>
          <button
            type="button"
            onClick={() => load(state.items.length > 0 ? (state.next ?? undefined) : undefined)}
            className="min-h-8 font-medium hover:underline"
          >
            {s.retry}
          </button>
        </p>
      )}
      {!state.loading && !state.error && state.items.length === 0 && (
        <p className="px-2.5 py-3 text-footnote text-ink-muted" data-testid="conversations-empty">
          {s.empty}
        </p>
      )}
      {state.next && !state.loading && (
        <button
          type="button"
          onClick={() => load(state.next!)}
          data-testid="conversations-more"
          className={cn(row, 'items-center justify-center text-footnote font-medium text-ink')}
        >
          {s.more}
        </button>
      )}
    </div>,
    host,
  );
}
