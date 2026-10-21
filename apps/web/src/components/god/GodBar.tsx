import { dotPalette } from '@monsters/monster-kit';
import type { Question as QuestionT } from '@monsters/shared';
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { plainText } from '../../lib/markdown.ts';
import { chatPath } from '../../lib/router.ts';
import { useStill } from '../../lib/motion.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { chatSummary, type ChatItem } from '../../store/derive.ts';
import {
  statusText,
  useAgents,
  useConnection,
  useLive,
  type AgentView,
} from '../../store/hooks.ts';
import { seenOf, useReads } from '../../store/reads.ts';
import { expressionFor, Monster } from '../monster/Monster.tsx';
import { fitDots } from '../monster/MonsterScreen.tsx';
import {
  collectBands,
  godLabel,
  godLine,
  godState,
  MARQUEE_ROWS,
  marqueeColumns,
  marqueeSpeed,
  squadCount,
} from './god.ts';
import { godStrings } from './god.strings.ts';
import { Marquee } from './marquee.ts';
import './god.css';

/** Size of the god's creature on the bar. */
const CREATURE_W = 46;
const CREATURE_H = 40;

/*
 * The bar of the god of the monsters (docs/design.md, "La barra del Dio",
 * D-101, D-102), at the head of the sidebar, above the squads: a black screen
 * where the colours of every monster of every squad run as dots, faster the
 * more monsters work, drifting at rest, still when all is quiet or stopped;
 * under them the god on its screen, its name in its light and what it is
 * doing on one line. It is the god's entry in the sidebar (its chat has no row
 * of its own, D-102): a link to its chat, outlined while that chat is open,
 * with the questions waiting there and the unread messages, one stop of the
 * chats' arrow keys (ChatList). The dots are a canvas (marquee.ts): React
 * renders only when the state of the house changes, never per frame.
 */

export interface GodBarProps {
  god: AgentView;
  /** The god's chat (useChats): its unread messages. */
  thread: readonly ChatItem[];
  /** Questions waiting in the god's chat (see `questionHome`). */
  waiting: readonly QuestionT[];
  /** Its chat is the one on screen. */
  selected: boolean;
  /** The one stop of the chat list in the tab order. */
  tabbable: boolean;
  onOpen: () => void;
  /** The arrows of the chat list. */
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement>) => void;
  /** "⌘1" / "Ctrl 1", and how ARIA says it. */
  shortcut?: { shown: string; aria: string };
}

export const GodBar = forwardRef<HTMLAnchorElement, GodBarProps>(function GodBar(
  { god, thread, waiting, selected, tabbable, onOpen, onKeyDown, shortcut },
  ref,
) {
  const agents = useAgents();
  const live = useApp((s) => s.live);
  const halted = useApp((s) => s.halted);
  const connection = useConnection();
  // Who asks the user something, as one string: no new array per store change.
  const askersKey = useApp((s) =>
    Object.values(s.questions)
      .filter((q) => q.status === 'open')
      .map((q) => q.from)
      .join('|'),
  );
  const askers = useMemo(() => (askersKey ? askersKey.split('|') : []), [askersKey]);
  const still = useStill();
  const godLive = useLive(god.id);

  // `idle` comes to rest by itself: one timer to the moment it does, nothing per frame. A stale
  // `now` is fine in between: a change of the house is newer than it, so it reads as idle.
  const [now, setNow] = useState(() => Date.now());
  const ids = useMemo(() => agents.map((a) => a.id), [agents]);
  const state = godState({ halted, connection, live, agentIds: ids, askers, now });
  useEffect(() => {
    if (state.restsAt === null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, state.restsAt - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [state.restsAt]);

  const workingKey = state.working.join('|');
  const columns = useMemo(() => {
    const working = new Set(workingKey ? workingKey.split('|') : []);
    return marqueeColumns(collectBands(agents, god.id, working), MARQUEE_ROWS);
  }, [agents, god.id, workingKey]);
  const speed = marqueeSpeed(state.kind, state.working.length);
  const dimmed = state.kind === 'halted' || state.kind === 'offline';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marquee = useRef<Marquee | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const m = new Marquee(canvas, MARQUEE_ROWS);
    marquee.current = m;
    return () => {
      m.destroy();
      marquee.current = null;
    };
  }, []);
  useEffect(() => {
    marquee.current?.set({ columns, speed, dimmed }, still);
  }, [columns, speed, dimmed, still]);

  const squads = squadCount(agents);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const line = godLine({ state, god: live[god.id], nameOf, askers, godId: god.id, squads });
  const label = godLabel(state, agents.length, askers.length, god.name);
  const lit = dotPalette(god.genome).lit;
  const busyLine = state.kind === 'working' || state.kind === 'asking';
  const size = fitDots(CREATURE_W, CREATURE_H, 0);
  const motion = still ? 'still' : speed > 0 ? 'running' : 'still';
  const s = godStrings();

  const seen = useReads((r) => seenOf(r, god.id));
  const summary = useMemo(() => chatSummary(thread, seen), [thread, seen]);
  // The open chat is being read: no badge for it.
  const unread = selected ? 0 : summary.unread;
  const question = waiting.at(-1);
  const name = [
    `${god.name}, ${statusText(godLive)}`,
    question ? s.asksLabel(plainText(question.question)) : null,
    unread ? s.unreadLabel(unread) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="shrink-0 px-3 pt-2 pb-1">
      <a
        ref={ref}
        href={chatPath(god.id)}
        onClick={(e) => {
          // A plain click opens the chat in place; with a modifier the browser opens a new tab.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onOpen();
        }}
        onKeyDown={onKeyDown}
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected ? 'page' : undefined}
        aria-keyshortcuts={shortcut?.aria}
        data-testid="god-bar"
        data-agent={god.id}
        data-state={state.kind}
        data-speed={still ? 0 : speed}
        data-motion={motion}
        data-waiting={question ? 'true' : undefined}
        // It starts with the name and the state, as every chat row; then what the house does.
        aria-label={s.aria(name, squads, line, label.text)}
        title={s.open(god.name, shortcut?.shown ?? null)}
        className="god-bar screen screen-lines px-3 pt-2.5 pb-2"
        style={{ '--lit': lit } as CSSProperties}
      >
        <canvas ref={canvasRef} aria-hidden className="god-marquee" data-testid="god-marquee" />
        <span aria-hidden className="mt-2 flex items-center gap-3">
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: CREATURE_W, height: CREATURE_H }}
          >
            <Monster
              genome={god.genome}
              size={size}
              expression={expressionFor(godLive.mood, godLive.confused)}
              animated
              dimmed={godLive.mood === 'stopped'}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span
                className="god-name dots min-w-0 flex-1 truncate text-title3 leading-6"
                data-testid="god-name"
              >
                {god.name}
              </span>
              <span
                className={cn(
                  'label flex shrink-0 items-center gap-1.5',
                  label.tone === 'stop'
                    ? 'text-screen-stop'
                    : label.tone === 'off'
                      ? 'text-screen-muted'
                      : 'text-screen-ink',
                )}
                data-testid="god-label"
              >
                {label.tone !== 'off' && (
                  <span
                    aria-hidden
                    className="led"
                    data-tone={label.tone}
                    data-blink={label.blink ? '' : undefined}
                  />
                )}
                {label.text}
              </span>
            </span>
            <span className="flex h-5 items-center gap-2">
              <span
                className={cn(
                  'block min-w-0 flex-1 truncate font-mono text-micro leading-4',
                  busyLine ? 'text-screen-ink' : 'text-screen-muted',
                )}
                data-testid="god-line"
              >
                {line}
              </span>
              {/* What waits in the god's own chat, as on the strip of a chat (docs/design.md). */}
              {question ? (
                <span
                  className="god-signal label inline-flex shrink-0 items-center gap-1.5"
                  data-testid="god-question"
                >
                  <span className="led" data-tone="signal" data-blink="" />
                  {waiting.length}
                </span>
              ) : unread > 0 ? (
                <span
                  className="god-unread label inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] px-1.5"
                  data-testid="god-unread"
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </a>
    </div>
  );
});
