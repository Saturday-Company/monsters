import { dotPalette } from '@monsters/monster-kit';
import {
  ArrowClockwise,
  Coins,
  ArrowDown,
  CaretUp,
  ClockCounterClockwise,
  Plugs,
  TelegramLogo,
  TerminalWindow,
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
} from 'react';
import {
  chatHistoryOf,
  dropHeld,
  errorText,
  loadChatOlder,
  notify,
  retryRun,
  sendMessage,
  useApp,
} from '../../store/app.ts';
import {
  automationBusyText,
  automationWork,
  capitalize,
  CONFUSED_TEXT,
  conversationLine,
  countMessages,
  groupDelegations,
  instrumentationLine,
  questionsClosedAt,
  retryOf,
  runOwners,
  runStatsIndex,
  splitConversation,
  sumRuns,
  telegramWhere,
  type ChatItem,
  type RunStats,
} from '../../store/derive.ts';
import {
  statusText,
  useAgent,
  useAgents,
  useConnection,
  useLive,
  useNameOf,
  useResolvedTheme,
  waitsForUser,
  type AgentView,
} from '../../store/hooks.ts';
import { usePrefs } from '../../store/prefs.ts';
import { markSeen } from '../../store/reads.ts';
import { accentInk, bubbleColors } from '../../theme/bubbles.ts';
import { THEMES } from '../../theme/tokens.ts';
import { playSound } from '../../lib/sound.ts';
import { cn, dayKey, formatDay, formatTime } from '../../lib/utils.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { ToolbarActions, ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { Markdown } from '../ui/Markdown.tsx';
import { Meter } from '../ui/Meter.tsx';
import {
  DelegationGroup,
  DelegationRow,
  ErrorRow,
  FileRow,
  InstinctRow,
  ReportRow,
  ResetRow,
  SystemRow,
} from './ChatEvents.tsx';
import { chatStrings } from './chat.strings.ts';
import { ReceiptBlock } from './Receipt.tsx';
import { behindTheScenes, ChatMonitor } from './ChatMonitor.tsx';
import { Composer, prefillComposer, type ComposerQuestion } from './Composer.tsx';
import { FirstSteps } from './FirstSteps.tsx';
import { Greeting } from './Greeting.tsx';
import {
  answeredIds,
  replyGate,
  UiReplyContext,
  type ReplyGate,
  type UiReply,
} from './ui-block/reply.ts';
import { ActiveKeypad, QuestionCard } from './QuestionCard.tsx';
import { PreviewRow } from '../preview/PreviewRow.tsx';
import { ProposalCard } from './ProposalCard.tsx';
import { MODELS_PATH, useNoModel } from './useModel.ts';
import { FileById } from '../files/FileChip.tsx';
import { attachToComposer } from './attachments.ts';
import { automationPath, SPEND_CAP_PATH, useHashParam } from '../../lib/router.ts';
import './chat.css';

/*
 * One chat (docs/design.md, "La chat"): the monster's monitor on top, fixed;
 * below a reading column of 760 px with the bubbles grouped by sender under one
 * small screen, the instrumentation line under each turn of the monster, the
 * events among monsters as labels between seams, a question as a keypad. The
 * messages scroll under the composer, set into the panel at the bottom.
 */

/** A pause this long between two messages of the same day shows the time again. */
const GAP_MS = 30 * 60_000;

/** Width of the avatar column (the 34 px screen and its gap): questions align to the bubbles. */
const AVATAR_COL = 'pl-[44px]';

/** A question this recent, when it shows up in the open chat, rings (if the sounds are on). */
const FRESH_QUESTION_MS = 15_000;

function AgentBubble({
  item,
  first,
  instr,
  action,
  reply,
  sendReply,
}: {
  item: Extract<ChatItem, { kind: 'agent' }>;
  /** First bubble of a run of the same monster: the avatar goes here. */
  first: boolean;
  /** The instrumentation line of the turn, under its last bubble. */
  instr: string | null;
  /** Something to do, inside the bubble (the greeting without a model). */
  action?: ReactNode;
  /** Whether the buttons of a drawn block here can be pressed (D-162), and how they send. */
  reply: ReplyGate;
  sendReply: (label: string) => Promise<void>;
}) {
  const agent = useAgent(item.agent);
  const uiReply = useMemo<UiReply>(() => ({ gate: reply, send: sendReply }), [reply, sendReply]);
  const theme = useResolvedTheme();
  const s = chatStrings().panel;
  const lit = useMemo(
    () => (agent ? dotPalette(agent.genome).lit : THEMES[theme].screenMuted),
    [agent, theme],
  );
  const c = bubbleColors(lit, theme);
  return (
    <div className="pr-8 sm:pr-16">
      {first && item.via && (
        <p className={cn(AVATAR_COL, 'label mb-1 text-ink-muted')} data-testid="agent-via">
          {item.via}
        </p>
      )}
      <div className="flex items-start gap-2.5">
        <div className="w-[34px] shrink-0">
          {first && agent && (
            <button
              type="button"
              onClick={() => openTerminalAt(agent.id, item.runId)}
              aria-label={behindTheScenes(agent.name)}
              title={s.behindTitle}
              className="block rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
            >
              <MonsterScreen
                genome={agent.genome}
                mood={item.streaming ? 'talking' : 'idle'}
                width={34}
                height={30}
                pad={2}
                animated={item.streaming}
              />
            </button>
          )}
        </div>
        <span className="sr-only">
          {agent?.name ?? item.agent}, {formatTime(item.ts)}:
        </span>
        <div
          data-testid="agent-bubble"
          data-streaming={item.streaming ? 'true' : 'false'}
          title={formatTime(item.ts)}
          className="bubble bubble-agent w-fit max-w-full min-w-0 px-4 py-2.5 text-large leading-[1.55] break-words"
          style={{ background: c.bg, color: c.fg }}
        >
          <UiReplyContext.Provider value={uiReply}>
            <Markdown text={item.text} codeBg={c.codeBg} streaming={item.streaming} />
          </UiReplyContext.Provider>
          {action}
        </div>
      </div>
      {instr && agent && (
        <div className={cn(AVATAR_COL, 'mt-1.5')}>
          <button
            type="button"
            className="instr"
            onClick={() => openTerminalAt(agent.id, item.runId)}
            title={s.turnTitle}
            data-testid="instrumentation"
          >
            {instr}
            <span aria-hidden className="instr-go">
              {' ↗'}
            </span>
            <span className="sr-only">{s.turnSr}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A message another monster wrote here for the user (the orchestrator's
 * `project_send` in a lead's chat, D-102): on the monsters' side, under the
 * small screen of who wrote it and in its tint, with "DA TITAN" above. The
 * user did not type it.
 */
function RelayedBubble({
  item,
  first,
}: {
  item: Extract<ChatItem, { kind: 'relayed' }>;
  first: boolean;
}) {
  const from = useAgent(item.from);
  const theme = useResolvedTheme();
  const s = chatStrings().panel;
  const lit = useMemo(
    () => (from ? dotPalette(from.genome).lit : THEMES[theme].screenMuted),
    [from, theme],
  );
  const c = bubbleColors(lit, theme);
  const name = from?.name ?? capitalize(item.from);
  return (
    <div className="pr-8 sm:pr-16" data-testid="relayed" data-from={item.from}>
      {first && (
        <p className={cn(AVATAR_COL, 'label mb-1 text-ink-muted')} aria-hidden>
          {s.from(name)}
        </p>
      )}
      <div className="flex items-start gap-2.5">
        <div className="w-[34px] shrink-0">
          {first && from && (
            <MonsterScreen genome={from.genome} mood="idle" width={34} height={30} pad={2} />
          )}
        </div>
        <span className="sr-only">
          {s.from(name)}, {formatTime(item.ts)}:
        </span>
        <div
          data-testid="relayed-bubble"
          title={s.writtenBy(name, formatTime(item.ts))}
          className="bubble bubble-agent w-fit max-w-full min-w-0 px-4 py-2.5 text-large leading-[1.55] break-words"
          style={{ background: c.bg, color: c.fg }}
        >
          <Markdown text={item.text} codeBg={c.codeBg} />
        </div>
      </div>
    </div>
  );
}

/**
 * A message written to the monster's own bot on Telegram (D-107): on the
 * monsters' side, neutral (`--raised`), under a Telegram mark, with the sender
 * and "da Telegram · <gruppo>" above. Never the user's ink bubble: it was
 * written there, by someone in the group.
 */
function TelegramBubble({
  item,
  first,
}: {
  item: Extract<ChatItem, { kind: 'telegram' }>;
  first: boolean;
}) {
  const where = telegramWhere(item);
  const who = item.owner ? `${item.sender.name}${chatStrings().panel.youSuffix}` : item.sender.name;
  return (
    <div
      className="pr-8 sm:pr-16"
      data-testid="telegram-message"
      data-sender={item.sender.id}
      data-owner={item.owner ? 'true' : undefined}
    >
      {first && (
        <p className={cn(AVATAR_COL, 'label mb-1 text-ink-muted')} aria-hidden>
          {who} · {where}
        </p>
      )}
      <div className="flex items-start gap-2.5">
        <div className="w-[34px] shrink-0">
          {first && (
            <span
              className="well flex h-[30px] w-[34px] items-center justify-center rounded-[8px] text-ink-muted"
              aria-hidden
            >
              <TelegramLogo size={18} />
            </span>
          )}
        </div>
        <span className="sr-only">
          {who}, {where}, {formatTime(item.ts)}:
        </span>
        <div
          data-testid="telegram-bubble"
          title={`${who} · ${where} · ${formatTime(item.ts)}`}
          className="bubble bubble-agent w-fit max-w-full min-w-0 bg-raised px-4 py-2.5 text-large leading-[1.55] whitespace-pre-wrap break-words text-ink"
        >
          {item.text}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ item }: { item: Extract<ChatItem, { kind: 'user' }> }) {
  const s = chatStrings().panel;
  const files = item.attachments ?? [];
  return (
    <div className="flex flex-col items-end pl-12 sm:pl-24">
      <span className="sr-only">{s.you(formatTime(item.ts))}</span>
      {files.length > 0 && (
        <ul
          aria-label={s.attachments(files.length)}
          data-testid="bubble-attachments"
          className={cn('mb-1.5 flex flex-wrap justify-end gap-2', item.pending && 'opacity-70')}
        >
          {files.map((id) => (
            <li key={id} className="min-w-0">
              <FileById id={id} image />
            </li>
          ))}
        </ul>
      )}
      {(item.text.trim() || files.length === 0) && (
        <div
          data-testid="user-bubble"
          data-held={item.held ? 'true' : undefined}
          title={formatTime(item.ts)}
          className={cn(
            'bubble bubble-user w-fit max-w-full px-4 py-2.5 text-large leading-[1.55] whitespace-pre-wrap break-words',
            item.pending && 'opacity-70',
          )}
        >
          {item.text}
        </div>
      )}
      {item.held ? (
        <p className="mt-1.5 pr-1 text-caption text-ink-muted" data-testid="held-note">
          {s.heldBefore}
          <button
            type="button"
            onClick={() => dropHeld(item.id)}
            className="font-medium text-signal-ink hover:underline"
          >
            {s.dontSend}
          </button>
        </p>
      ) : (
        item.pending && <p className="label mt-1.5 pr-1 text-ink-muted">{s.sending}</p>
      )}
    </div>
  );
}

/** Above a question carried over from a previous conversation. */
function CarriedCaption({ questionId }: { questionId: string }) {
  const open = useApp((s) => s.questions[questionId]?.status === 'open');
  const t = chatStrings().panel;
  return <p className="label pl-1 text-ink-muted">{open ? t.carriedOpen : t.carried}</p>;
}

/** Shows or hides the conversations before the latest "New conversation". */
function EarlierToggle({
  open,
  messages,
  onToggle,
}: {
  open: boolean;
  messages: number;
  onToggle: () => void;
}) {
  const s = chatStrings().panel;
  return (
    <div className="flex justify-center px-4 pt-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="earlier-toggle"
        className="h-9 gap-1.5 px-3 text-footnote font-medium"
      >
        {open ? (
          <>
            <CaretUp size={15} weight="bold" aria-hidden /> {s.earlierHide}
          </>
        ) : (
          <>
            <ClockCounterClockwise size={17} aria-hidden /> {s.earlierShow}
            {messages > 0 && (
              <span className="font-normal text-ink-muted">{s.earlierCount(messages)}</span>
            )}
          </>
        )}
      </Button>
    </div>
  );
}

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

interface Shown {
  item: ChatItem;
  /** An open question of a previous conversation, shown in the current one. */
  carried: boolean;
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
  instr,
  action,
  latest,
  reply,
  sendReply,
}: Shown & {
  chat: string;
  /** First bubble of its run of bubbles. */
  first: boolean;
  instr: string | null;
  action?: ReactNode;
  /** The latest receipt of the chat (it opens by itself). */
  latest: boolean;
  reply: ReplyGate;
  sendReply: (label: string) => Promise<void>;
}) {
  return (
    <>
      {item.kind === 'agent' && (
        <AgentBubble
          item={item}
          first={first}
          instr={instr}
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
      {item.kind === 'receipt' && (
        <div className="sm:pl-[44px]">
          <ReceiptBlock item={item} latest={latest} />
        </div>
      )}
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

/** The rows of the chat: days and pauses as separators, runs of bubbles, folded events. */
function Rows({
  shown,
  chat,
  present,
  actionFor,
  instrFor,
  replyFor,
  sendReply,
}: {
  shown: Shown[];
  chat: string;
  /** The ids on screen when the chat opened. */
  present: Pick<ReadonlySet<string>, 'has'>;
  actionFor: (id: string) => ReactNode;
  instrFor: (item: ChatItem) => string | null;
  /** Whether the buttons of a drawn block in this message can be pressed now. */
  replyFor: (item: ChatItem) => ReplyGate;
  sendReply: (label: string) => Promise<void>;
}) {
  // What needs a look stays in sight: the task you are asked in this chat, one the instinct
  // doubted or that failed, an instinct line that warns. The rest folds when it comes in a row.
  const grouped = groupDelegations(
    shown,
    (s) => s.item,
    undefined,
    (item) =>
      item.kind === 'delegation'
        ? !(chat === item.to && item.from !== item.to) &&
          !item.checks?.length &&
          item.status !== 'failed'
        : item.kind === 'instinct' && item.tone === null,
  );
  const nodes: ReactNode[] = [];
  const latestReceipt = shown.findLast((s) => s.item.kind === 'receipt')?.item.id;
  let prevItem: ChatItem | undefined;
  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i]!;
    const first = g.kind === 'one' ? g.row.item : g.rows[0]!.item;
    const newDay = !prevItem || dayKey(prevItem.ts) !== dayKey(first.ts);
    const gap = !newDay && !!prevItem && first.kind !== 'reset' && first.ts - prevItem.ts > GAP_MS;
    if (newDay)
      nodes.push(
        <li key={`day-${first.id}`} className="mt-2 first:mt-0">
          <DaySeparator ts={first.ts} />
        </li>,
      );
    else if (gap)
      nodes.push(
        <li key={`gap-${first.id}`} className="mt-4">
          <p className="label text-center text-ink-muted">{formatTime(first.ts)}</p>
        </li>,
      );
    if (g.kind === 'group') {
      nodes.push(
        // The key of its first row: a row that becomes a group stays the same element (no rise-in again).
        <li key={g.id} className={cn('mt-4', rises(first, present) && 'rise-in')}>
          <DelegationGroup items={g.rows.map((r) => r.item)} chat={chat} />
        </li>,
      );
      prevItem = g.rows.at(-1)!.item;
      continue;
    }
    const { item, carried } = g.row;
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
          rises(item, present) && 'rise-in',
        )}
      >
        <Row
          item={item}
          carried={carried}
          chat={chat}
          first={!continues}
          instr={instrFor(item)}
          action={actionFor(item.id)}
          latest={item.id === latestReceipt}
          reply={replyFor(item)}
          sendReply={sendReply}
        />
      </li>,
    );
    prevItem = item;
  }
  return (
    <ol className="flex flex-col pt-2 pb-5" data-testid="chat-list">
      {nodes}
    </ol>
  );
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

/** Above the composer while the open question is out of sight: one tap brings it back. */
function QuestionBar({ name, onShow }: { name: string; onShow: () => void }) {
  const s = chatStrings().panel;
  return (
    <button
      type="button"
      onClick={onShow}
      data-testid="question-bar"
      className="popover rise-in mx-auto mb-3 flex h-10 items-center justify-center gap-2.5 rounded-[10px] px-4 text-footnote text-ink-muted"
    >
      <span aria-hidden className="led" data-tone="signal" data-blink="" />
      <span>
        <span className="font-semibold text-ink">{name}</span>
        {s.waitingForYou}
      </span>
      <span className="label text-signal-ink">{s.show}</span>
    </button>
  );
}

/** The runs of one monster's current conversation (the sum on its monitor). */
function conversationRuns(
  stats: ReadonlyMap<string, RunStats>,
  owners: ReadonlyMap<string, string>,
  agentId: string,
  since: number,
): RunStats[] {
  const out: RunStats[] = [];
  for (const s of stats.values())
    if (s.firstTs >= since && owners.get(s.runId) === agentId) out.push(s);
  return out;
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
  const showDetails = usePrefs((p) => p.showDetails);
  const noModel = useNoModel();
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
  const owners = useMemo(() => runOwners(events), [events]);
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
  // Previous conversations stay folded; a newer "New conversation" folds them again.
  const [earlierOpenFor, setEarlierOpenFor] = useState<string | null>(null);
  const showEarlier = !!view.boundary && earlierOpenFor === view.boundary.id;
  const shown: Shown[] =
    !view.boundary || showEarlier
      ? thread.map((item) => ({ item, carried: false }))
      : [
          ...view.carried.map((item) => ({ item, carried: true })),
          { item: view.boundary, carried: false },
          ...view.current.map((item) => ({ item, carried: false })),
        ];
  const fresh =
    thread.length === 0 ||
    (!!view.boundary && !showEarlier && view.current.length === 0 && view.carried.length === 0);
  const streaming = thread.some((it) => it.kind === 'agent' && it.streaming);
  // Working, or waiting for another monster; a question for the user is its own card.
  const working =
    !streaming &&
    !waitsForUser(live) &&
    (live.mood === 'working' || live.mood === 'talking' || live.mood === 'waiting');

  // The open question of this chat the composer answers (the oldest, as a queue).
  let openQuestion: (typeof questions)[string] | null = null;
  let openQuestionTs = 0;
  for (const s of shown) {
    if (s.item.kind !== 'question') continue;
    const q = questions[s.item.questionId];
    if (q?.status === 'open') {
      openQuestion = q;
      openQuestionTs = s.item.ts;
      break;
    }
  }
  const composerQuestion: ComposerQuestion | null = openQuestion
    ? {
        id: openQuestion.id,
        from: nameOf(openQuestion.from),
        options: openQuestion.options.length,
        picks: openQuestion.options,
        blocking: openQuestion.blocking,
      }
    : null;

  // Nothing from the user yet in this conversation: a few first things to ask.
  const current = view.boundary && !showEarlier ? view.current : thread;
  // A message another monster wrote here for the user counts as the start (`project_send`).
  const userWrote = current.some(
    (it) => it.kind === 'user' || it.kind === 'relayed' || it.kind === 'telegram',
  );
  const lastItem = shown.at(-1)?.item;
  // After the lead's first answer: first jobs to try and the "Tell me more about you" card.
  const tellMe = useHashParam('profilo') === '1';
  // Counted over the whole chat, not the conversation: a new one does not bring the first jobs back.
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
      (answeredOnce && userCount <= 3 && lastItem?.kind !== 'error' && !openQuestion && !working));
  // Without a model the greeting carries the way out (audit 2.4), else a bar above the composer.
  const greetingId =
    noModel && lastItem?.kind === 'agent' && !lastItem.streaming ? lastItem.id : null;

  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  /** The open question whose card is out of sight (then the bar above the composer shows). */
  const [hiddenQuestion, setHiddenQuestion] = useState<string | null>(null);
  const reduce = useStill();
  const fromBottom = useRef<number | null>(null);

  const toggleEarlier = () => {
    const el = scroller.current;
    // Unfolding adds content above: keep what the user is looking at in place.
    if (el) fromBottom.current = el.scrollHeight - el.scrollTop;
    setEarlierOpenFor(showEarlier ? null : (view.boundary?.id ?? null));
  };

  // Older messages are worth loading where they would show: not behind folded conversations.
  const canLoadOlder = olderLeft && (!view.boundary || showEarlier);
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
  }, [showEarlier, firstId, loadingOlder]);

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
    // (the scroll to the bottom then takes the "New messages" key away)
    if (ownSend) pinned.current = true;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else setShowJump(true);
  }, [lastKey, ownSend]);

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
    setShowJump(false);
    el.scrollTop = fresh ? 0 : el.scrollHeight;
  }, [boundaryId, fresh]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      pinned.current = near;
      if (near) setShowJump(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

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

  // Whether the card of the open question is on screen (else the bar above the composer).
  const questionId = openQuestion?.id ?? null;
  const shownCount = shown.length;
  useEffect(() => {
    const root = scroller.current;
    if (!root || !questionId) return;
    const card = root.querySelector(`[data-question="${CSS.escape(questionId)}"]`);
    if (!card) return;
    // The composer floats over the bottom of the scroller.
    const io = new IntersectionObserver(
      ([entry]) => setHiddenQuestion(entry && entry.intersectionRatio < 0.35 ? questionId : null),
      { root, threshold: [0, 0.35, 1], rootMargin: '0px 0px -120px 0px' },
    );
    io.observe(card);
    return () => io.disconnect();
  }, [questionId, shownCount]);
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

  const actionFor = (id: string) =>
    id === greetingId ? (
      <div className="mt-2.5 mb-0.5" data-testid="no-model">
        <ConnectModel />
      </div>
    ) : null;

  // The instrumentation line goes under the last bubble of each turn (run) shown.
  const lastOfRun = new Map<string, string>();
  for (const s of shown)
    if (s.item.kind === 'agent' && s.item.runId) lastOfRun.set(s.item.runId, s.item.id);
  const instrFor = (item: ChatItem): string | null => {
    if (!showDetails || item.kind !== 'agent' || item.streaming || !item.runId) return null;
    if (lastOfRun.get(item.runId) !== item.id) return null;
    return instrumentationLine(stats.get(item.runId), nameOf(item.agent), item.agent);
  };

  const since = view.boundary?.ts ?? 0;
  const summary = useMemo(
    () =>
      showDetails
        ? conversationLine(sumRuns(conversationRuns(stats, owners, agentId, since)))
        : null,
    [showDetails, stats, owners, agentId, since],
  );

  if (!agent) return null;
  const busy = live.mood !== 'idle' && live.mood !== 'done';
  const waitingForYou = !!openQuestion && !halted;
  // The buttons of a drawn block: only on the last word of the chat (nothing from the user after
  // it), with the monster idle and no question open.
  const answered = answeredIds(shown.map((s) => s.item));
  const replyFor = (item: ChatItem): ReplyGate =>
    item.kind === 'agent'
      ? replyGate({
          streaming: item.streaming,
          answered: answered.has(item.id),
          question: !!openQuestion,
          working: busy || streaming || !!busyWith,
          halted,
          noModel,
          offline,
        })
      : 'open';
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
        summary={summary}
        canStartOver={!(thread.length === 0 || (!!view.boundary && view.current.length === 0))}
      />

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
        <ActiveKeypad.Provider value={waitingForYou ? (openQuestion?.id ?? null) : null}>
          <div className="mx-auto flex min-h-full w-full max-w-[824px] flex-col px-4 sm:px-8">
            <div
              ref={content}
              className="flex flex-1 flex-col"
              aria-live="polite"
              aria-relevant="additions"
              // A reply that is still being written is not read in pieces: the region waits (busy)
              // and gives the finished message when the stream ends (W-26).
              aria-busy={loadingOlder || streaming || undefined}
            >
              {canLoadOlder && (thread.length > 0 || !loadingOlder) && (
                <OlderKey
                  loading={loadingOlder}
                  onLoad={() => loadEarlier({ keepPlace: true, loud: true })}
                />
              )}
              {view.boundary && view.earlier.length > 0 && (
                <EarlierToggle
                  open={showEarlier}
                  messages={countMessages(view.earlier)}
                  onToggle={toggleEarlier}
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
                  shown={shown}
                  chat={agent.id}
                  present={still}
                  actionFor={actionFor}
                  instrFor={instrFor}
                  replyFor={replyFor}
                  sendReply={sendReply}
                />
              )}
              {!fresh && lastItem?.kind === 'error' && !working && !streaming ? (
                <ErrorActions key={lastItem.id} item={lastItem} />
              ) : (
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
              {working && !busyWith && <WorkingRow agent={agent} />}
            </div>
            {/* The composer floats on the messages, which scroll under it. */}
            <div className="composer-dock sticky bottom-0 z-10 -mx-1 px-1 pt-3 pb-3 sm:pb-4">
              {showJump && (
                <button
                  type="button"
                  onClick={jump}
                  className="popover rise-in label absolute -top-11 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center gap-2 rounded-[10px] px-3.5 text-ink"
                >
                  <ArrowDown size={14} weight="bold" aria-hidden /> {t.newMessages}
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
              {waitingForYou && questionHidden && composerQuestion && (
                <QuestionBar name={composerQuestion.from} onShow={showQuestion} />
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
              />
            </div>
          </div>
        </ActiveKeypad.Provider>
      </div>
    </section>
  );
}
