import { dotPalette } from '@monsters/monster-kit';
import type { ChatConversation, LogEvent } from '@monsters/shared';
import {
  ArrowClockwise,
  Coins,
  ArrowDown,
  ClockCounterClockwise,
  Plugs,
  TerminalWindow,
  X,
} from '@phosphor-icons/react';
import { useStill } from '../../lib/motion.ts';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  chatHistoryOf,
  errorText,
  getApi,
  loadChatOlder,
  notify,
  retryRun,
  sendMessage,
  startNewConversation,
  useApp,
} from '../../store/app.ts';
import {
  automationBusyText,
  automationWork,
  buildChat,
  busyMood,
  capitalize,
  chatThread,
  CONFUSED_TEXT,
  questionsClosedAt,
  retryOf,
  runOwners,
  runStatsIndex,
  splitConversation,
  telegramWhere,
  withoutAutomationRuns,
  type ChatItem,
} from '../../store/derive.ts';
import {
  statusText,
  useAgent,
  useAgents,
  useConnection,
  useLive,
  useNameOf,
  useOrchestrator,
  useResolvedTheme,
  waitsForUser,
  type AgentView,
} from '../../store/hooks.ts';
import { queuedMessages } from '../../store/queued.ts';
import { markSeen } from '../../store/reads.ts';
import { accentInk } from '../../theme/bubbles.ts';
import { playSound } from '../../lib/sound.ts';
import { cn, dayKey, formatDay, formatShortDay, formatTime } from '../../lib/utils.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { ToolbarActions, ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { Meter } from '../ui/Meter.tsx';
import {
  DelegationRow,
  ErrorRow,
  FileRow,
  InstinctRow,
  ReportRow,
  ResetRow,
  SystemRow,
} from './ChatEvents.tsx';
import { chatStrings } from './chat.strings.ts';
import { BubbleToolsContext, QueuedContext, type BubbleTools } from './BubbleTools.tsx';
import { behindTheScenes, ChatMonitor } from './ChatMonitor.tsx';
import { Composer, prefillComposer, type ComposerQuestion } from './Composer.tsx';
import { ReadOnlyContext } from './readonly.ts';
import { useContextLevel } from './useContextLevel.ts';
import { FirstSteps } from './FirstSteps.tsx';
import { Greeting } from './Greeting.tsx';
import { answeredIds, replyGate, type ReplyGate } from './ui-block/reply.ts';
import { ActiveKeypad, QuestionCard } from './QuestionCard.tsx';
import {
  AgentBubble,
  CarriedCaption,
  RelayedBubble,
  TelegramBubble,
  UserBubble,
} from './Bubbles.tsx';
import { TurnBlock, turnAlive, type ReplyBase } from './TurnBlock.tsx';
import {
  buildTurns,
  stableBlocks,
  runStepsIndex,
  type ChatBlock,
  type Turn,
} from '../../store/turn.ts';
import { clipText, plainText } from '../../lib/markdown.ts';
import { PreviewRow } from '../preview/PreviewRow.tsx';
import { ProposalCard } from './ProposalCard.tsx';
import { MODELS_PATH, useNoModel } from './useModel.ts';
import { attachToComposer } from './attachments.ts';
import { automationPath, SPEND_CAP_PATH, useHashParam } from '../../lib/router.ts';
import './chat.css';

/*
 * One chat (docs/design.md, "The chat"): the monster's monitor on top, fixed;
 * below a reading column of 760 px made of turns (TurnBlock: your request, the
 * work strip under the monster's small screen, the replies with their files, a
 * question as a keypad) and of the few events that belong to no turn, as labels
 * between seams. The messages scroll under the composer, set into the panel at
 * the bottom.
 */

/** A pause this long between two messages of the same sender keeps their bubbles apart. */
const GAP_MS = 30 * 60_000;

/** A pause this long between two turns of the same day shows the time at the head of the next. */
const TIME_GAP_MS = 5 * 60_000;

/** A question this recent, when it shows up in the open chat, rings (if the sounds are on). */
const FRESH_QUESTION_MS = 15_000;

/** At the top of a chat with more history on the core: one page more (scrolling up does it too). */
function OlderKey({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  const s = chatStrings().panel;
  return (
    <div className="flex justify-center px-4 pt-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onLoad}
        disabled={loading}
        data-testid="older-messages"
        className="h-9 gap-1.5 px-3 text-footnote font-medium"
      >
        <ClockCounterClockwise size={17} aria-hidden />
        {loading ? s.loadingEarlier : s.olderMessages}
      </Button>
    </div>
  );
}

/** Same sender as the item before, with no pause: the bubbles stay together. */
function sameRun(item: ChatItem, prev: ChatItem | undefined): boolean {
  if (!prev || item.ts - prev.ts > GAP_MS) return false;
  if (item.kind === 'agent')
    return prev.kind === 'agent' && prev.agent === item.agent && prev.via === item.via;
  if (item.kind === 'user') return prev.kind === 'user';
  if (item.kind === 'relayed') return prev.kind === 'relayed' && prev.from === item.from;
  if (item.kind === 'telegram')
    return (
      prev.kind === 'telegram' &&
      prev.sender.id === item.sender.id &&
      telegramWhere(prev) === telegramWhere(item)
    );
  return false;
}

const Row = memo(function Row({
  item,
  carried,
  chat,
  first,
  action,
  reply,
  sendReply,
}: {
  item: ChatItem;
  /** An open question of a previous conversation, shown in the current one. */
  carried: boolean;
  chat: string;
  /** First bubble of its run of bubbles. */
  first: boolean;
  action?: ReactNode;
  reply: ReplyGate;
  sendReply: (label: string) => Promise<void>;
}) {
  return (
    <>
      {item.kind === 'agent' && (
        <AgentBubble
          item={item}
          first={first}
          action={action}
          reply={reply}
          sendReply={sendReply}
        />
      )}
      {item.kind === 'user' && <UserBubble item={item} />}
      {item.kind === 'relayed' && <RelayedBubble item={item} first={first} />}
      {item.kind === 'telegram' && <TelegramBubble item={item} first={first} />}
      {item.kind === 'report' && <ReportRow item={item} />}
      {item.kind === 'delegation' && <DelegationRow item={item} chat={chat} />}
      {item.kind === 'question' && (
        <div className="flex flex-col gap-2 sm:pl-[44px]">
          {carried && <CarriedCaption questionId={item.questionId} />}
          <QuestionCard questionId={item.questionId} />
        </div>
      )}
      {item.kind === 'error' && <ErrorRow item={item} />}
      {item.kind === 'system' && <SystemRow item={item} />}
      {item.kind === 'reset' && <ResetRow item={item} />}
      {item.kind === 'instinct' && <InstinctRow item={item} />}
      {item.kind === 'file' && <FileRow item={item} />}
      {item.kind === 'proposal' && (
        <div className="sm:pl-[44px]">
          <ProposalCard item={item} />
        </div>
      )}
      {item.kind === 'preview' && (
        <div className="sm:pl-[44px]">
          <PreviewRow item={item} />
        </div>
      )}
    </>
  );
});

/** The day (and the time of its first message), in the flow. */
function DaySeparator({ ts }: { ts: number }) {
  return (
    <h3 className="label pt-3 pb-1 text-center text-ink-muted" data-testid="day-separator">
      {formatDay(ts)} · {formatTime(ts)}
    </h3>
  );
}

/**
 * What rises in (styles.css `.rise-in`, docs/design.md "Movimento"): only what
 * arrives while the chat is open. The rows there when it opened stay still, and
 * the server's copy of a message you sent does not come in twice: your message
 * rises when you send it (pending), its echo takes its place without moving.
 */
function rises(item: ChatItem, present: Pick<ReadonlySet<string>, 'has'>): boolean {
  if (present.has(item.id)) return false;
  return item.kind !== 'user' || item.pending === true;
}

/** The first item of a block: where it sits in time. */
function firstOf(block: ChatBlock): ChatItem | null {
  if (block.kind === 'item') return block.item;
  return block.request ?? block.received[0] ?? block.column[0] ?? block.tasks[0] ?? null;
}

/** The rows of the chat: days and pauses as separators, the turns, the items of no turn. */
function Rows({
  blocks,
  chat,
  rise,
  greetingId,
  greetingAction,
  replyBase,
  answered,
  sendReply,
}: {
  blocks: readonly ChatBlock[];
  chat: string;
  /** Whether an item arrived with the chat open (it rises in). */
  rise: (item: ChatItem) => boolean;
  greetingId: string | null;
  greetingAction: ReactNode;
  replyBase: ReplyBase;
  answered: ReadonlySet<string>;
  sendReply: (label: string) => Promise<void>;
}) {
  const nodes: ReactNode[] = [];
  let prevTs: number | null = null;
  let prevItem: ChatItem | undefined;
  for (const block of blocks) {
    const ts = block.kind === 'turn' ? block.ts : block.item.ts;
    const newDay = prevTs === null || dayKey(prevTs) !== dayKey(ts);
    const first = firstOf(block);
    const gap = !newDay && prevTs !== null && first?.kind !== 'reset' && ts - prevTs > TIME_GAP_MS;
    if (newDay)
      nodes.push(
        <li key={`day-${block.id}`} className="mt-2 first:mt-0">
          <DaySeparator ts={ts} />
        </li>,
      );
    else if (gap)
      nodes.push(
        <li key={`gap-${block.id}`} className="mt-4">
          <p className="label text-center text-ink-muted" data-testid="time-gap">
            {formatTime(ts)}
          </p>
        </li>,
      );
    if (block.kind === 'turn') {
      const hasGreeting = !!greetingId && block.column.some((c) => c.id === greetingId);
      nodes.push(
        <li
          key={block.id}
          className={cn(newDay || gap ? 'mt-2' : 'mt-5', first && rise(first) && 'rise-in')}
        >
          <TurnBlock
            turn={block}
            chat={chat}
            rises={rise}
            greetingId={hasGreeting ? greetingId : null}
            greetingAction={hasGreeting ? greetingAction : null}
            replyBase={replyBase}
            answered={answered}
            sendReply={sendReply}
          />
        </li>,
      );
      prevTs = lastTs(block);
      prevItem = undefined;
      continue;
    }
    const { item, carried } = block;
    const continues = !newDay && !gap && sameRun(item, prevItem);
    const event =
      item.kind === 'delegation' ||
      item.kind === 'system' ||
      item.kind === 'reset' ||
      item.kind === 'instinct' ||
      item.kind === 'report';
    nodes.push(
      <li
        // Stable: a question carried over keeps its element when the earlier messages open.
        key={item.id}
        className={cn(
          continues ? 'mt-1' : newDay || gap ? 'mt-2' : event ? 'mt-4' : 'mt-5',
          rise(item) && 'rise-in',
        )}
      >
        <Row
          item={item}
          carried={carried}
          chat={chat}
          first={!continues}
          action={item.id === greetingId ? greetingAction : undefined}
          reply={
            item.kind === 'agent'
              ? replyGate({
                  ...replyBase,
                  streaming: item.streaming,
                  answered: answered.has(item.id),
                })
              : 'open'
          }
          sendReply={sendReply}
        />
      </li>,
    );
    prevTs = item.ts;
    prevItem = item;
  }
  return (
    <ol className="flex flex-col pt-2 pb-5" data-testid="chat-list">
      {nodes}
    </ol>
  );
}

/** The time of the latest thing a turn said: a pause after it shows the time again. */
function lastTs(turn: Turn): number {
  let ts = turn.ts;
  for (const c of turn.column) if (c.ts > ts) ts = c.ts;
  return ts;
}

/** At the bottom while the monster works and has not started writing yet. */
function WorkingRow({ agent }: { agent: AgentView }) {
  const live = useLive(agent.id);
  const theme = useResolvedTheme();
  const meter = useMemo(
    () => accentInk(dotPalette(agent.genome).lit, theme),
    [agent.genome, theme],
  );
  const s = chatStrings().panel;
  const text = live.confused
    ? `${agent.name} ${CONFUSED_TEXT}`
    : (live.activity ?? (live.mood === 'talking' ? s.writing : s.atWork(agent.name)));
  return (
    <div className="flex items-start gap-2.5 pb-5" data-testid="working-row">
      <MonsterScreen
        genome={agent.genome}
        mood="working"
        confused={live.confused}
        width={34}
        height={30}
        pad={2}
      />
      <p className="bubble bubble-agent flex min-h-[30px] min-w-0 items-center gap-2.5 bg-raised px-3.5 py-2 text-body text-ink-muted">
        <Meter active color={meter} className="shrink-0" />
        <span className="truncate">{text}</span>
      </p>
    </div>
  );
}

/** First things to ask (audit 2.17). Ending with "…": they go in the field, to be finished. */
function Suggestions({ agent }: { agent: AgentView }) {
  const halted = useApp((s) => s.halted);
  const t = chatStrings().panel;
  const list = agent.isOrchestrator ? t.suggestionsLead : t.suggestionsMember;
  const pick = (s: string) => {
    if (s.endsWith('…')) {
      prefillComposer(`${s.slice(0, -1)} `);
      return;
    }
    sendMessage(s, agent.isOrchestrator ? undefined : agent.id).catch((err: unknown) =>
      notify(errorText(err), 'error'),
    );
  };
  return (
    <ul
      className="flex flex-wrap justify-center gap-2.5"
      aria-label={t.toStart}
      data-testid="suggestions"
    >
      {list.map((s) => (
        <li key={s}>
          <Button
            variant="secondary"
            size="sm"
            disabled={halted && !s.endsWith('…')}
            onClick={() => pick(s)}
            className="font-medium"
          >
            {s}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Under an error that ends the chat (audit UI-14): what to do about it instead
 * of the first suggestions, "Try again" (the request of the failed work again)
 * and "Behind the scenes" on that work.
 */
function ErrorActions({ item }: { item: Extract<ChatItem, { kind: 'error' }> }) {
  const s = chatStrings().panel;
  const halted = useApp((s) => s.halted);
  const canRetry = useApp((s) => !!item.runId && retryOf(s.events, item.runId) !== null);
  const agent = useAgent(item.agent);
  const [sent, setSent] = useState(false);
  // The spending cap (D-070): the work stops until the cap is raised.
  // i18n-ignore: the words of the core's message, Italian or English
  const capped = item.code === 'spend_cap' || /tetto di spesa|spending cap/i.test(item.text);
  return (
    <div className="flex flex-wrap justify-center gap-2.5 pb-5" data-testid="error-actions">
      {capped && (
        <a
          href={SPEND_CAP_PATH}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
          data-testid="raise-cap"
        >
          <Coins size={16} weight="bold" aria-hidden />
          {s.raiseCap}
        </a>
      )}
      {canRetry && !sent && !capped && (
        <Button
          variant="secondary"
          size="sm"
          disabled={halted}
          title={halted ? s.resumeFirst : undefined}
          onClick={() => {
            setSent(true);
            retryRun(item.runId!).catch((err: unknown) => {
              setSent(false);
              notify(errorText(err), 'error');
            });
          }}
        >
          <ArrowClockwise size={16} aria-hidden />
          {s.retry}
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => openTerminalAt(item.agent, item.runId)}
        aria-label={agent ? behindTheScenes(agent.name) : s.behindLabel}
      >
        <TerminalWindow size={16} aria-hidden />
        {s.behindLabel}
      </Button>
    </div>
  );
}

/** "Connect a model", inside the greeting or above the composer. */
function ConnectModel({ className }: { className?: string }) {
  const s = chatStrings().panel;
  return (
    <a
      href={MODELS_PATH}
      className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), className)}
    >
      <Plugs size={17} weight="bold" aria-hidden />
      {s.connectModel}
    </a>
  );
}

/** Context notes the user put away, by conversation and level (kept across reloads). */
const NOTES_KEY = 'monsters-context-notes';

function noteDismissed(key: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]') as string[]).includes(key);
  } catch {
    return false;
  }
}

function dismissNote(key: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]') as string[];
    localStorage.setItem(
      NOTES_KEY,
      JSON.stringify([...list.filter((k) => k !== key), key].slice(-40)),
    );
  } catch {
    // no storage: the note comes back with the next page load
  }
}

/**
 * Above the composer, in words, when the conversation is long (60% of the window) or its older
 * messages are summarized: one line and the key that starts a new one. Not on the monitor, not
 * a number. It can be put away, for this conversation and level.
 */
function ContextNote({
  level,
  onNew,
  onDismiss,
}: {
  level: 'long' | 'full';
  onNew: () => void;
  onDismiss: () => void;
}) {
  const s = chatStrings();
  return (
    <p
      className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-footnote text-ink-muted"
      data-testid="context-note"
      data-level={level}
      role="status"
    >
      <span>{level === 'full' ? s.panel.contextFull : s.panel.contextLong}</span>
      <button
        type="button"
        onClick={onNew}
        className="min-h-8 font-medium whitespace-nowrap text-signal-ink hover:underline"
        data-testid="context-note-new"
      >
        {s.monitor.newConversation}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={s.panel.dismiss}
        title={s.panel.dismiss}
        className="key-ghost inline-flex size-8 items-center justify-center rounded-[8px] text-ink-muted hover:text-ink"
        data-testid="context-note-dismiss"
      >
        <X size={14} weight="bold" aria-hidden />
      </button>
    </p>
  );
}

/** Under the monitor while an earlier conversation is on screen: which one, and the way back. */
function EarlierBand({
  conversation,
  onBack,
}: {
  conversation: ChatConversation;
  onBack: () => void;
}) {
  const s = chatStrings().conversations;
  return (
    <div
      className="card mx-4 mb-1 flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] px-3.5 py-1"
      role="status"
      data-testid="earlier-band"
    >
      <ClockCounterClockwise size={18} aria-hidden className="shrink-0 text-ink-muted" />
      <p className="min-w-0 flex-1 text-footnote font-medium text-ink">
        {s.band(formatShortDay(conversation.startedAt))}
      </p>
      <Button size="sm" variant="secondary" onClick={onBack} data-testid="earlier-back">
        {s.back}
      </Button>
    </div>
  );
}

/** Events of a conversation, merged by id (a page of older ones comes before). */
function mergeEvents(a: readonly LogEvent[], b: readonly LogEvent[]): LogEvent[] {
  const byId = new Map<string, LogEvent>();
  for (const e of [...a, ...b]) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** What the buttons of drawn blocks and the rows see in an earlier conversation: nothing to press. */
const READ_ONLY_BASE: ReplyBase = {
  question: false,
  working: false,
  halted: false,
  noModel: false,
  offline: false,
};
const NO_RISE = () => false;
const NO_SEND = () => Promise.resolve();

/**
 * An earlier conversation of this chat, read-only (F-5): its turns as the chat draws them, from
 * the pages the core gives for it (`conversationHistory`), without touching the chat's own events.
 */
function PastConversation({
  agent,
  conversation,
}: {
  agent: AgentView;
  conversation: ChatConversation;
}) {
  const s = chatStrings();
  const orchestrator = useOrchestrator();
  const nameOf = useNameOf();
  const [state, setState] = useState<{
    events: LogEvent[];
    floor: string | null;
    loading: boolean;
    error: boolean;
  }>({ events: [], floor: null, loading: true, error: false });
  const fetchPage = useCallback(
    (before?: string) =>
      getApi()
        .conversationHistory(agent.id, conversation.id, before)
        .then((page) =>
          setState((st) => ({
            events: mergeEvents(st.events, page.events),
            floor: page.floor,
            loading: false,
            error: false,
          })),
        )
        .catch(() => setState((st) => ({ ...st, loading: false, error: true }))),
    [agent.id, conversation.id],
  );
  const load = (before?: string) => {
    setState((st) => ({ ...st, loading: true, error: false }));
    void fetchPage(before);
  };
  // The first page: the state starts out loading, so nothing is set before it answers.
  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);
  const { blocks, answered } = useMemo(() => {
    const events = state.events;
    const chat = withoutAutomationRuns(events, automationWork(events).runs);
    const items = buildChat(chat, [], nameOf);
    const thread = chatThread(items, agent.id, {
      orchestrator: orchestrator?.id ?? '',
      owners: runOwners(chat),
    });
    return {
      blocks: buildTurns(thread, agent.id, {
        stats: runStatsIndex(events),
        steps: runStepsIndex(events),
      }),
      // Their buttons are old suggestions: "You already replied after this message".
      answered: new Set(thread.filter((it) => it.kind === 'agent').map((it) => it.id)),
    };
  }, [state.events, nameOf, agent.id, orchestrator?.id]);
  return (
    <ReadOnlyContext.Provider value>
      {/* Only Copy on its bubbles: nothing here is sent again or put back in the field. */}
      <BubbleToolsContext.Provider value={null}>
        <div className="flex flex-1 flex-col" data-testid="earlier-conversation">
          {state.floor && !state.loading && (
            <OlderKey loading={false} onLoad={() => load(state.floor!)} />
          )}
          {state.loading && (
            <p className="py-6 text-center text-body text-ink-muted" role="status">
              {s.conversations.loadingOne}
            </p>
          )}
          {state.error && (
            <p className="flex items-center justify-center gap-3 py-6 text-body text-stop-ink">
              {s.conversations.failedOne}
              <Button variant="secondary" size="sm" onClick={() => load(state.floor ?? undefined)}>
                {s.conversations.retry}
              </Button>
            </p>
          )}
          {blocks.length > 0 && (
            <Rows
              blocks={blocks}
              chat={agent.id}
              rise={NO_RISE}
              greetingId={null}
              greetingAction={null}
              replyBase={READ_ONLY_BASE}
              answered={answered}
              sendReply={NO_SEND}
            />
          )}
        </div>
      </BubbleToolsContext.Provider>
    </ReadOnlyContext.Provider>
  );
}

const NO_QUEUED: ReadonlySet<string> = new Set();

/** How much of a finished reply the screen reader hears at once. */
const ANNOUNCE_MAX = 400;

/**
 * What a screen reader hears of the chat (F-8): a finished reply and a new question, once each,
 * from a hidden live region; not the service lines, the strip, a reply in pieces or the whole
 * transcript. What was there when the chat opened, or came with a page of history, is not news.
 */
function useAnnouncement(
  thread: readonly ChatItem[],
  still: Pick<ReadonlySet<string>, 'has'>,
): RefObject<HTMLParagraphElement | null> {
  const nameOf = useNameOf();
  const questions = useApp((s) => s.questions);
  const region = useRef<HTMLParagraphElement>(null);
  const told = useRef(new Set<string>());
  useEffect(() => {
    let say: string | null = null;
    for (const it of thread) {
      if (told.current.has(it.id) || still.has(it.id)) continue;
      if (it.kind === 'agent' && !it.streaming) {
        told.current.add(it.id);
        say = `${nameOf(it.agent)}: ${clipText(plainText(it.text), ANNOUNCE_MAX)}`;
      } else if (it.kind === 'question') {
        const q = questions[it.questionId];
        if (!q) continue;
        told.current.add(it.id);
        say = chatStrings().strip.asks(nameOf(it.agent), q.question);
      }
    }
    // Written into the region itself: a change of its text is what the screen reader reads.
    if (say !== null && region.current) region.current.textContent = say;
  }, [thread, still, questions, nameOf]);
  return region;
}

export function ChatPanel({
  agentId,
  thread,
  rail,
}: {
  agentId: string;
  thread: ChatItem[];
  /**
   * The chat inside another page (a project's, D-100): the rail shows that
   * page's title and keys, the monster's name stays on its monitor.
   */
  rail?: { title: string; keys?: ReactNode };
}) {
  const agent = useAgent(agentId);
  const agents = useAgents();
  const t = chatStrings().panel;
  const live = useLive(agentId);
  const halted = useApp((s) => s.halted);
  const questions = useApp((s) => s.questions);
  const events = useApp((s) => s.events);
  const noModel = useNoModel();
  const orchestrator = useOrchestrator();
  const nameOf = useNameOf();
  const offline = useConnection() === 'closed';
  // A tap on a button of a drawn block sends its label the way the composer sends a message (D-162).
  const isLead = agent?.isOrchestrator ?? false;
  const sendReply = useCallback(
    (label: string) => sendMessage(label, isLead ? undefined : agentId),
    [agentId, isLead],
  );
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  // ChatsView keys the panel by chat: these are the rows that were there when it opened.
  const [present] = useState(() => new Set(thread.map((i) => i.id)));
  /** Rows older than this came with a page of history: they were there already, they do not rise. */
  const quietBefore = useRef('');
  const still = useMemo(
    () => ({ has: (id: string) => present.has(id) || id < quietBefore.current }),
    [present],
  );
  // The chat's own history (W-1): what is older than the pages of the whole hub.
  const olderLeft = useApp((s) => chatHistoryOf(s, agentId).hasOlder);
  const loadingOlder = useApp((s) => chatHistoryOf(s, agentId).loading);
  const closedAt = useMemo(() => questionsClosedAt(events), [events]);
  const stats = useMemo(() => runStatsIndex(events), [events]);
  // The monster works on a giro of an automation (D-094): a message written now starts after it.
  const busyWith = useMemo(
    () => automationWork(events).busy.get(agentId) ?? null,
    [events, agentId],
  );
  // Carried over: still open, or closed after the boundary (the answer stays in sight).
  const view = useMemo(
    () =>
      splitConversation(
        thread,
        (id, boundary) => questions[id]?.status === 'open' || (closedAt.get(id) ?? '') > boundary,
      ),
    [thread, questions, closedAt],
  );
  // The previous conversations are not in this list: the Conversations key on the monitor opens
  // them, read-only (F-5). Here only the current one, with the questions still open carried over.
  const [viewing, setViewing] = useState<ChatConversation | null>(null);
  const { boundary: viewBoundary, carried: viewCarried, current: viewCurrent } = view;
  const { shownItems, carriedIds } = useMemo(
    () =>
      !viewBoundary
        ? { shownItems: thread, carriedIds: new Set<string>() }
        : {
            shownItems: [...viewCarried, viewBoundary, ...viewCurrent],
            carriedIds: new Set(viewCarried.map((q) => q.id)),
          },
    [viewBoundary, viewCarried, viewCurrent, thread],
  );
  // The turns of the chat (store/turn.ts), keeping the identity of those that did not change
  // between two chunks of a streamed reply: their rows do not render again.
  const steps = useMemo(() => runStepsIndex(events), [events]);
  const [keepBlocks] = useState(stableBlocks);
  const blocks = useMemo(
    () => keepBlocks(buildTurns(shownItems, agentId, { stats, steps, carried: carriedIds })),
    [keepBlocks, shownItems, agentId, stats, steps, carriedIds],
  );
  const fresh =
    thread.length === 0 ||
    (!!view.boundary && view.current.length === 0 && view.carried.length === 0);
  const streaming = thread.some((it) => it.kind === 'agent' && it.streaming);
  // Working, or waiting for another monster; a question for the user is its own card.
  const working =
    !streaming &&
    !waitsForUser(live) &&
    (live.mood === 'working' || live.mood === 'talking' || live.mood === 'waiting');

  // The open question of this chat the composer answers (the oldest, as a queue).
  let openQuestion: (typeof questions)[string] | null = null;
  let openQuestionTs = 0;
  for (const item of shownItems) {
    if (item.kind !== 'question') continue;
    const q = questions[item.questionId];
    if (q?.status === 'open') {
      openQuestion = q;
      openQuestionTs = item.ts;
      break;
    }
  }
  const composerQuestion: ComposerQuestion | null = openQuestion
    ? {
        id: openQuestion.id,
        from: nameOf(openQuestion.from),
        text: openQuestion.question,
        options: openQuestion.options.length,
        picks: openQuestion.options,
        blocking: openQuestion.blocking,
      }
    : null;

  // Nothing from the user yet in this conversation: a few first things to ask.
  const current = view.boundary ? view.current : thread;
  // A message another monster wrote here for the user counts as the start (`project_send`).
  const userWrote = current.some(
    (it) => it.kind === 'user' || it.kind === 'relayed' || it.kind === 'telegram',
  );
  const lastItem = shownItems.at(-1);
  // After the lead's first answer, once: first jobs to try and the "Tell me more about you" card
  // (F-12: not after every reply). Counted over the whole chat, not the conversation: a new one
  // does not bring them back; it has the greeting and its first suggestions instead.
  const tellMe = useHashParam('profile') === '1';
  const userCount = thread.filter((it) => it.kind === 'user').length;
  const firstUser = current.findIndex((it) => it.kind === 'user');
  const answeredOnce =
    firstUser >= 0 &&
    current.slice(firstUser + 1).some((it) => it.kind === 'agent' && !it.streaming);
  const showFirstSteps =
    !!agent?.isOrchestrator &&
    !fresh &&
    !noModel &&
    (tellMe ||
      (answeredOnce && userCount === 1 && lastItem?.kind !== 'error' && !openQuestion && !working));
  // Without a model the greeting carries the way out (audit 2.4), else a bar above the composer.
  const greetingId =
    noModel && lastItem?.kind === 'agent' && !lastItem.streaming ? lastItem.id : null;

  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** New items below while the chat is scrolled up (F-3): counted by id, not by chunk. */
  const [jumpCount, setJumpCount] = useState(0);
  /** The ids the user has seen at the bottom (or that were there when scrolling up). */
  const seenIds = useRef<Set<string>>(new Set(thread.map((i) => i.id)));
  const threadIds = useRef<readonly ChatItem[]>(thread);
  useLayoutEffect(() => {
    threadIds.current = thread;
  }, [thread]);
  const markAllSeen = useCallback(() => {
    seenIds.current = new Set(threadIds.current.map((i) => i.id));
    setJumpCount(0);
  }, []);
  /** The open question whose card is out of sight (then the bar above the composer shows). */
  const [hiddenQuestion, setHiddenQuestion] = useState<string | null>(null);
  const reduce = useStill();
  const fromBottom = useRef<number | null>(null);

  // Older messages are worth loading where they would show: not behind the conversations that a
  // "New conversation" closed (the Conversations key reads those).
  const canLoadOlder = olderLeft && !view.boundary && !viewing;
  const loadEarlier = useCallback(
    (how: { keepPlace: boolean; loud: boolean }) => {
      if (chatHistoryOf(useApp.getState(), agentId).loading) return;
      const el = scroller.current;
      // The page comes in above: what the user is looking at stays in place.
      if (el && how.keepPlace && !pinned.current)
        fromBottom.current = el.scrollHeight - el.scrollTop;
      // Everything the page brings is older than the newest event known now.
      const newest = useApp.getState().events.at(-1)?.id ?? '';
      if (newest > quietBefore.current) quietBefore.current = newest;
      loadChatOlder(agentId).catch((err: unknown) => {
        fromBottom.current = null;
        if (how.loud) notify(errorText(err), 'error');
      });
    },
    [agentId],
  );

  // A chat whose history the pages of the whole hub do not hold loads its own when it opens.
  useEffect(() => {
    const s = useApp.getState();
    if (s.chats[agentId] || !chatHistoryOf(s, agentId).hasOlder) return;
    loadEarlier({ keepPlace: false, loud: false });
  }, [agentId, loadEarlier]);

  const firstId = thread[0]?.id ?? '';
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || fromBottom.current === null) return;
    el.scrollTop = el.scrollHeight - fromBottom.current;
    // Kept until the page is in: the older rows may come a render before the end of the load.
    if (!loadingOlder) fromBottom.current = null;
  }, [firstId, loadingOlder]);

  const last = thread.at(-1);
  // Not the length: a page of older history above is not news at the bottom.
  const lastKey = last
    ? `${last.id}:${(last as { text?: string }).text?.length ?? 0}:${working}`
    : `${working}`;
  // The user's own message just sent: it comes into view even when scrolled up (W-21).
  const ownSend = last?.kind === 'user' && last.pending === true ? last.id : null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (ownSend) pinned.current = true;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
      markAllSeen();
      return;
    }
    // Scrolled up: only items that were not there count as new, never a chunk of a reply already
    // seen or the monster starting to work (F-3); a page of older history is not news either.
    let n = 0;
    for (const it of thread)
      if (
        !seenIds.current.has(it.id) &&
        !still.has(it.id) &&
        it.kind !== 'user' &&
        it.kind !== 'reset'
      )
        n++;
    setJumpCount(n);
  }, [lastKey, ownSend, thread, still, markAllSeen]);

  // Whatever grows after the first layout (a card, a picture, the bar above the composer) keeps
  // a chat that sits at the bottom at the very bottom (V-2).
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // A new conversation starts in sight (the greeting from its top), with nothing "new" to jump to.
  const boundaryId = view.boundary?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !boundaryId) return;
    pinned.current = true;
    markAllSeen();
    el.scrollTop = fresh ? 0 : el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a conversation starts
  }, [boundaryId, fresh]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      pinned.current = near;
      if (near) markAllSeen();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [markAllSeen]);

  // Scrolled up to the top: the earlier messages come by themselves (the key above says so too).
  useEffect(() => {
    const el = scroller.current;
    if (!el || !canLoadOlder) return;
    const onScroll = () => {
      if (el.scrollTop < 160 && el.scrollHeight > el.clientHeight)
        loadEarlier({ keepPlace: true, loud: false });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [canLoadOlder, loadEarlier]);

  // The height of the dock (the composer and what sits on it): the messages scroll under it, so
  // the card of the open question is out of sight when it is behind the dock, not just at 120 px.
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setDockHeight(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Whether the card of the open question is on screen (else the bar above the composer).
  const questionId = openQuestion?.id ?? null;
  const shownCount = shownItems.length;
  useEffect(() => {
    const root = scroller.current;
    if (!root || !questionId) return;
    const card = root.querySelector(`[data-question="${CSS.escape(questionId)}"]`);
    if (!card) return;
    const io = new IntersectionObserver(
      ([entry]) => setHiddenQuestion(entry && entry.intersectionRatio < 0.35 ? questionId : null),
      { root, threshold: [0, 0.35, 1], rootMargin: `0px 0px -${dockHeight}px 0px` },
    );
    io.observe(card);
    return () => io.disconnect();
  }, [questionId, shownCount, dockHeight]);
  const questionHidden = !!questionId && hiddenQuestion === questionId;

  // Sounds (lib/sound.ts, only if on): a new question in this chat, the monster done.
  const rang = useRef<string | null>(questionId);
  useEffect(() => {
    if (!questionId || rang.current === questionId) return;
    rang.current = questionId;
    if (Date.now() - openQuestionTs < FRESH_QUESTION_MS) playSound('question');
  }, [questionId, openQuestionTs]);
  const prevMood = useRef(live.mood);
  useEffect(() => {
    if (live.mood === 'done' && prevMood.current !== 'done') playSound('done');
    prevMood.current = live.mood;
  }, [live.mood]);

  const showQuestion = () => {
    const card = scroller.current?.querySelector<HTMLElement>(
      `[data-question="${CSS.escape(questionId ?? '')}"]`,
    );
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    card.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  };

  // What is on screen in a visible tab has been seen.
  const lastId = last && !last.id.startsWith('pending-') ? last.id : '';
  useEffect(() => {
    if (!lastId) return;
    const seen = () => {
      if (document.visibilityState === 'visible') markSeen(agentId, lastId);
    };
    seen();
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [agentId, lastId]);

  const jump = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  };

  const greetingAction = useMemo(
    () => (
      <div className="mt-2.5 mb-0.5" data-testid="no-model">
        <ConnectModel />
      </div>
    ),
    [],
  );

  // The same set while it holds the same ids: a chunk of a reply does not render every turn again.
  const answeredKey = [...answeredIds(shownItems)].join('\n');
  const answeredSet = useMemo(
    () => new Set(answeredKey ? answeredKey.split('\n') : []),
    [answeredKey],
  );
  const busyNow = live.mood !== 'idle' && live.mood !== 'done';
  const asking = !!openQuestion;
  const replyBase = useMemo<ReplyBase>(
    () => ({
      question: asking,
      working: busyNow || streaming || !!busyWith,
      halted,
      noModel,
      offline,
    }),
    [asking, busyNow, streaming, busyWith, halted, noModel, offline],
  );
  // The work shows in a live strip: no "at work" bubble at the bottom too.
  const liveAll = useApp((s) => s.live);
  const stripAtWork = useMemo(
    () => blocks.some((b) => b.kind === 'turn' && turnAlive(b, liveAll)),
    [blocks, liveAll],
  );
  const rise = useCallback((item: ChatItem) => rises(item, still), [still]);

  // What can be done with a bubble: copy always, again and edit on the user's own messages.
  const lastUserId = useMemo(
    () => shownItems.findLast((it) => it.kind === 'user')?.id ?? null,
    [shownItems],
  );
  const canResend = !noModel && !offline;
  const bubbleTools = useMemo<BubbleTools>(
    () => ({
      lastUserId,
      canResend,
      again: (text, files) => {
        sendMessage(text, isLead ? undefined : agentId, files).catch((err: unknown) =>
          notify(errorText(err), 'error'),
        );
      },
      edit: (text) => prefillComposer(text),
    }),
    [lastUserId, canResend, isLead, agentId],
  );
  // The user's messages that wait in the run for the monster's next step ("Will read it after
  // this step"): only worth reading the log for while the monster works.
  const queued = useMemo(
    () =>
      busyMood(live.mood) || streaming
        ? queuedMessages(events, agentId, orchestrator?.id ?? '')
        : NO_QUEUED,
    [events, agentId, orchestrator?.id, live.mood, streaming],
  );

  // "This conversation is getting long" (F-5): in words above the composer, for everyone.
  const level = useContextLevel(agentId);
  const noteKey = `${agentId}:${view.boundary?.id ?? 'first'}:${level}`;
  const [notesAway, setNotesAway] = useState<ReadonlySet<string>>(new Set());
  const showNote =
    (level === 'long' || level === 'full') &&
    !fresh &&
    !noModel &&
    !viewing &&
    !notesAway.has(noteKey) &&
    !noteDismissed(noteKey);
  const startOver = useCallback(() => {
    startNewConversation(agentId).catch((err: unknown) => notify(errorText(err), 'error'));
  }, [agentId]);

  // F-8: screen readers hear the finished replies and the new questions, not the whole transcript.
  const announcement = useAnnouncement(thread, still);

  if (!agent) return null;
  const busy = live.mood !== 'idle' && live.mood !== 'done';
  const waitingForYou = !!openQuestion && !halted;
  // The buttons of a drawn block: only on the last word of the chat (nothing from the user after
  // it), with the monster idle and no question open.
  const answered = answeredSet;
  const status = waitingForYou
    ? t.statusWaiting
    : noModel && !busy
      ? t.statusNoModel
      : capitalize(statusText(live));
  const quiet = !waitingForYou && !(noModel && !busy) && !busy;
  const roleText = agent.isOrchestrator ? t.roleLead(agents.length - 1) : agent.role;

  // Files dragged from the computer onto the chat: they go to the composer (D-075).
  const dragging = (e: DragEvent) => !noModel && e.dataTransfer.types.includes('Files');
  return (
    <section
      aria-labelledby="chat-title"
      className="relative flex min-h-0 min-w-0 flex-col"
      data-testid="chat-panel"
      data-agent={agent.id}
      onDragEnter={(e) => {
        if (!dragging(e)) return;
        e.preventDefault();
        dragDepth.current++;
        setDropping(true);
      }}
      onDragOver={(e) => {
        if (!dragging(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!dragging(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropping(false);
      }}
      onDrop={(e) => {
        if (!dragging(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDropping(false);
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length > 0) attachToComposer(dropped);
      }}
    >
      {dropping && (
        <div
          aria-hidden
          data-testid="drop-zone"
          className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-[14px] border-2 border-dashed border-signal-ink bg-panel/90"
        >
          <p className="label text-ink">{t.drop}</p>
        </div>
      )}
      <ToolbarContent>
        {/*
          In the top rail the chat has only its keys: the name and the state are
          for screen readers here, the monster's monitor shows them (docs/design.md).
        */}
        {rail && <ToolbarTitle>{rail.title}</ToolbarTitle>}
        <div className="sr-only">
          {rail ? (
            <h2 id="chat-title">{t.chatWith(agent.name)}</h2>
          ) : (
            <h1 id="chat-title">{agent.name}</h1>
          )}
          <p data-testid="chat-status">
            {quiet ? (
              <>
                {agent.isOrchestrator ? t.lead : agent.role} · {capitalize(statusText(live))}
              </>
            ) : (
              status
            )}
          </p>
        </div>
        <ToolbarActions>{rail?.keys}</ToolbarActions>
      </ToolbarContent>

      <ChatMonitor
        agent={agent}
        live={live}
        roleText={roleText}
        asking={waitingForYou}
        halted={halted}
        noModel={noModel}
        canStartOver={
          !viewing && !(thread.length === 0 || (!!view.boundary && view.current.length === 0))
        }
        viewing={viewing}
        currentSince={view.boundary?.ts ?? thread[0]?.ts ?? null}
        onViewConversation={(c) => {
          // Either way the chat starts at its end, where the latest words are.
          pinned.current = true;
          setViewing(c);
        }}
      />
      {viewing && <EarlierBand conversation={viewing} onBack={() => setViewing(null)} />}

      <div
        ref={scroller}
        data-testid="chat-scroller"
        // scroll-pt: whatever the chat scrolls to (a question, the first message) stops below the monitor's fade, never under it.
        className="scroll-soft relative min-h-0 flex-1 scroll-pt-10 overflow-y-auto"
      >
        {/* The messages fade under the monitor's edge instead of being cut. */}
        <div
          aria-hidden
          className="pointer-events-none sticky top-0 z-10 -mb-5 h-5 bg-linear-to-b from-panel to-transparent"
        />
        <BubbleToolsContext.Provider value={bubbleTools}>
          <QueuedContext.Provider value={queued}>
            <ActiveKeypad.Provider value={waitingForYou ? (openQuestion?.id ?? null) : null}>
              <div className="mx-auto flex min-h-full w-full max-w-[824px] flex-col px-4 sm:px-8">
                <p
                  ref={announcement}
                  className="sr-only"
                  aria-live="polite"
                  role="status"
                  data-testid="chat-announce"
                />
                <div ref={content} className="flex flex-1 flex-col">
                  {viewing ? (
                    <PastConversation key={viewing.id} agent={agent} conversation={viewing} />
                  ) : (
                    <>
                      {canLoadOlder && (thread.length > 0 || !loadingOlder) && (
                        <OlderKey
                          loading={loadingOlder}
                          onLoad={() => loadEarlier({ keepPlace: true, loud: true })}
                        />
                      )}
                      {fresh && view.boundary && (
                        <div className="pt-4">
                          <ResetRow item={view.boundary} />
                        </div>
                      )}
                      {fresh && working && !noModel ? (
                        // At work with an empty chat (a task from another monster): no
                        // greeting, no first suggestions, only the work bubble below.
                        <p
                          className="flex flex-1 items-center justify-center py-10 text-center text-body text-ink-muted"
                          data-testid="fresh-working"
                        >
                          {busyWith
                            ? t.freshAutomation(agent.name)
                            : agent.isOrchestrator
                              ? t.freshLead(agent.name)
                              : t.freshMember(agent.name)}
                        </p>
                      ) : fresh && thread.length === 0 && loadingOlder ? (
                        // Its history is on the way: not the greeting of a chat that never spoke.
                        <p
                          className="flex flex-1 items-center justify-center py-10 text-center text-body text-ink-muted"
                          data-testid="chat-history-loading"
                          role="status"
                        >
                          {t.loadingEarlier}
                        </p>
                      ) : fresh ? (
                        <Greeting agent={agent} noModel={noModel}>
                          {noModel ? (
                            <div data-testid="no-model">
                              <ConnectModel />
                            </div>
                          ) : (
                            <Suggestions agent={agent} />
                          )}
                        </Greeting>
                      ) : (
                        <Rows
                          blocks={blocks}
                          chat={agent.id}
                          rise={rise}
                          greetingId={greetingId}
                          greetingAction={greetingAction}
                          replyBase={replyBase}
                          answered={answered}
                          sendReply={sendReply}
                        />
                      )}
                      {!fresh && lastItem?.kind === 'error' && !working && !streaming ? (
                        <ErrorActions key={lastItem.id} item={lastItem} />
                      ) : (
                        // Nothing from you yet (the lead's first greeting, a new conversation with a
                        // question carried over): the first things to ask. Never after a reply (F-12).
                        !fresh &&
                        !userWrote &&
                        !noModel &&
                        !openQuestion &&
                        !working &&
                        !streaming && (
                          <div className="pb-5">
                            <Suggestions agent={agent} />
                          </div>
                        )
                      )}
                      {showFirstSteps && !streaming && (
                        <div className="pb-5">
                          <FirstSteps forceOpen={tellMe} />
                        </div>
                      )}
                      {working && !busyWith && !stripAtWork && <WorkingRow agent={agent} />}
                    </>
                  )}
                </div>
                {/* The composer floats on the messages, which scroll under it. */}
                <div
                  ref={dock}
                  className="composer-dock sticky bottom-0 z-10 -mx-1 px-1 pt-3 pb-3 sm:pb-4"
                  data-testid="composer-dock"
                >
                  {jumpCount > 0 && (
                    <button
                      type="button"
                      onClick={jump}
                      data-testid="new-messages"
                      className="popover rise-in label absolute -top-11 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center gap-2 rounded-[10px] px-3.5 text-ink"
                    >
                      <ArrowDown size={14} weight="bold" aria-hidden />{' '}
                      {chatStrings().strip.newCount(jumpCount)}
                    </button>
                  )}
                  {busyWith && (
                    <p
                      className="mb-3 flex items-center justify-center gap-x-2.5 gap-y-1 text-center text-footnote text-ink-muted max-sm:flex-wrap"
                      data-testid="automation-busy"
                      role="status"
                    >
                      <span aria-hidden className="led" data-tone="signal" />
                      <span>{automationBusyText(busyWith.name)}</span>
                      <a
                        href={automationPath(busyWith.automationId, { giro: busyWith.giro })}
                        className="font-medium whitespace-nowrap text-signal-ink hover:underline"
                      >
                        {t.seeRun}
                      </a>
                    </p>
                  )}
                  {showNote && (level === 'long' || level === 'full') && (
                    <ContextNote
                      level={level}
                      onNew={startOver}
                      onDismiss={() => {
                        dismissNote(noteKey);
                        setNotesAway((set) => new Set(set).add(noteKey));
                      }}
                    />
                  )}
                  {viewing && (
                    <p
                      className="mb-3 text-center text-footnote text-ink-muted"
                      data-testid="earlier-hint"
                    >
                      {chatStrings().conversations.hint}
                    </p>
                  )}
                  {noModel && !greetingId && !fresh && (
                    <p
                      className="mb-3 flex items-center justify-center gap-2 text-footnote text-ink-muted"
                      data-testid="no-model"
                    >
                      {t.needsModel}
                      <a href={MODELS_PATH} className="font-medium text-signal-ink hover:underline">
                        {t.connectModel}
                      </a>
                    </p>
                  )}
                  <Composer
                    agent={agent}
                    question={waitingForYou ? composerQuestion : null}
                    noModel={noModel}
                    working={(streaming || working) && !halted}
                    canStartOver={
                      !viewing &&
                      !(thread.length === 0 || (!!view.boundary && view.current.length === 0))
                    }
                    questionHidden={questionHidden}
                    onShowQuestion={showQuestion}
                    readOnly={!!viewing}
                  />
                </div>
              </div>
            </ActiveKeypad.Provider>
          </QueuedContext.Provider>
        </BubbleToolsContext.Provider>
      </div>
    </section>
  );
}
