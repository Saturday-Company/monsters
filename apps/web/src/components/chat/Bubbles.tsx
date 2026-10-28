import { dotPalette } from '@monsters/monster-kit';
import { TelegramLogo } from '@phosphor-icons/react';
import { useContext, useMemo, type ReactNode } from 'react';
import { cn, formatTime } from '../../lib/utils.ts';
import { dropHeld, flushHeld, useApp } from '../../store/app.ts';
import { capitalize, telegramWhere, type ChatItem } from '../../store/derive.ts';
import { useAgent, useResolvedTheme } from '../../store/hooks.ts';
import type { TurnAttachment } from '../../store/turn.ts';
import { bubbleColors } from '../../theme/bubbles.ts';
import { THEMES } from '../../theme/tokens.ts';
import { FileById } from '../files/FileChip.tsx';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { PreviewRow } from '../preview/PreviewRow.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { chatStrings } from './chat.strings.ts';
import { behindTheScenes } from './ChatMonitor.tsx';
import { BubbleFrame, QueuedContext, useUserTools } from './BubbleTools.tsx';
import { UiReplyContext, type ReplyGate, type UiReply } from './ui-block/reply.ts';

/*
 * The bubbles of a chat (docs/design.md, "The chat"): a monster's reply under its small screen,
 * in its tint, with the files its turn made inside; a message another monster or someone on
 * Telegram wrote here; yours, on the right.
 */

/** Width of the avatar column (the 34 px screen and its gap): questions align to the bubbles. */
export const AVATAR_COL = 'pl-[44px] max-[479px]:pl-0';

/*
 * On a phone (under 480 px) the monsters' bubbles use the whole width: the avatar sits above the
 * first bubble of a group instead of beside it, so a table or a drawn block has room.
 */

export function AgentBubble({
  item,
  first,
  attachments,
  action,
  reply,
  sendReply,
}: {
  item: Extract<ChatItem, { kind: 'agent' }>;
  /** First bubble of a run of the same monster: the avatar goes here. */
  first: boolean;
  /** The files the turn made: inside its last bubble (F-7). */
  attachments?: readonly TurnAttachment[] | undefined;
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
    <div className="pr-8 max-[479px]:pr-0 sm:pr-16">
      {first && item.via && (
        <p className={cn(AVATAR_COL, 'label mb-1 text-ink-muted')} data-testid="agent-via">
          {item.via}
        </p>
      )}
      <div className="flex items-start gap-2.5 max-[479px]:flex-col max-[479px]:gap-1.5">
        <div className={cn('w-[34px] shrink-0', !first && 'max-[479px]:hidden')}>
          {first && agent && (
            <button
              type="button"
              onClick={() => openTerminalAt(agent.id, item.runId)}
              aria-label={behindTheScenes(agent.name)}
              title={s.behindTitle}
              className="flex h-8 items-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
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
        <BubbleFrame
          ts={item.ts}
          text={item.text}
          side="start"
          className="max-[479px]:w-full"
          streaming={item.streaming}
        >
          <div
            data-testid="agent-bubble"
            data-streaming={item.streaming ? 'true' : 'false'}
            className="bubble bubble-agent w-fit max-w-full min-w-0 px-4 py-2.5 text-large leading-[1.55] break-words max-[479px]:w-full"
            style={{ background: c.bg, color: c.fg }}
          >
            <UiReplyContext.Provider value={uiReply}>
              <Markdown text={item.text} codeBg={c.codeBg} streaming={item.streaming} />
            </UiReplyContext.Provider>
            {attachments && attachments.length > 0 && <Attachments items={attachments} />}
            {action}
          </div>
        </BubbleFrame>
      </div>
    </div>
  );
}

/**
 * A message another monster wrote here for the user (the orchestrator's
 * `project_send` in a lead's chat, D-102): on the monsters' side, under the
 * small screen of who wrote it and in its tint, with "DA TITAN" above. The
 * user did not type it.
 */
export function RelayedBubble({
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
    <div className="pr-8 max-[479px]:pr-0 sm:pr-16" data-testid="relayed" data-from={item.from}>
      {first && (
        <p className={cn(AVATAR_COL, 'label mb-1 text-ink-muted')} aria-hidden>
          {s.from(name)}
        </p>
      )}
      <div className="flex items-start gap-2.5 max-[479px]:flex-col max-[479px]:gap-1.5">
        <div className={cn('w-[34px] shrink-0', !first && 'max-[479px]:hidden')}>
          {first && from && (
            <MonsterScreen genome={from.genome} mood="idle" width={34} height={30} pad={2} />
          )}
        </div>
        <span className="sr-only">
          {s.from(name)}, {formatTime(item.ts)}:
        </span>
        <BubbleFrame ts={item.ts} text={item.text} side="start" className="max-[479px]:w-full">
          <div
            data-testid="relayed-bubble"
            title={s.writtenBy(name, formatTime(item.ts))}
            className="bubble bubble-agent w-fit max-w-full min-w-0 px-4 py-2.5 text-large leading-[1.55] break-words max-[479px]:w-full"
            style={{ background: c.bg, color: c.fg }}
          >
            <Markdown text={item.text} codeBg={c.codeBg} />
          </div>
        </BubbleFrame>
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
export function TelegramBubble({
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
      className="pr-8 max-[479px]:pr-0 sm:pr-16"
      data-testid="telegram-message"
      data-sender={item.sender.id}
      data-owner={item.owner ? 'true' : undefined}
    >
      {first && (
        <p className={cn(AVATAR_COL, 'label mb-1 text-ink-muted')} aria-hidden>
          {who} · {where}
        </p>
      )}
      <div className="flex items-start gap-2.5 max-[479px]:flex-col max-[479px]:gap-1.5">
        <div className={cn('w-[34px] shrink-0', !first && 'max-[479px]:hidden')}>
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
        <BubbleFrame ts={item.ts} text={item.text} side="start" className="max-[479px]:w-full">
          <div
            data-testid="telegram-bubble"
            title={`${who} · ${where}`}
            className="bubble bubble-agent w-fit max-w-full min-w-0 bg-raised px-4 py-2.5 text-large leading-[1.55] whitespace-pre-wrap break-words text-ink max-[479px]:w-full"
          >
            {item.text}
          </div>
        </BubbleFrame>
      </div>
    </div>
  );
}

export function UserBubble({ item }: { item: Extract<ChatItem, { kind: 'user' }> }) {
  const s = chatStrings().panel;
  const files = item.attachments ?? [];
  const queued = useContext(QueuedContext).has(item.id);
  const tools = useUserTools(item.id, item.text, item.attachments, item.pending === true);
  const halted = useApp((st) => st.halted);
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
        <BubbleFrame ts={item.ts} text={item.text} side="end" {...tools}>
          <div
            data-testid="user-bubble"
            data-held={item.held ? 'true' : undefined}
            data-queued={queued ? 'true' : undefined}
            className={cn(
              'bubble bubble-user w-fit max-w-full px-4 py-2.5 text-large leading-[1.55] whitespace-pre-wrap break-words',
              item.pending && 'opacity-70',
            )}
          >
            {item.text}
          </div>
        </BubbleFrame>
      )}
      {item.held ? (
        <p className="mt-1.5 pr-1 text-caption text-ink-muted" data-testid="held-note">
          {item.failed && !halted ? (
            <>
              {s.notSent}
              <button
                type="button"
                onClick={() => void flushHeld()}
                className="font-medium text-signal-ink hover:underline"
              >
                {s.sendNow}
              </button>
              {' · '}
            </>
          ) : (
            s.heldBefore
          )}
          <button
            type="button"
            onClick={() => dropHeld(item.id)}
            className="font-medium text-signal-ink hover:underline"
          >
            {s.dontSend}
          </button>
        </p>
      ) : item.pending ? (
        <p className="label mt-1.5 pr-1 text-ink-muted">{s.sending}</p>
      ) : (
        queued && (
          <p className="mt-1.5 pr-1 text-caption text-ink-muted" data-testid="queued-note">
            {s.queued}
          </p>
        )
      )}
    </div>
  );
}

/** Above a question carried over from a previous conversation. */
export function CarriedCaption({ questionId }: { questionId: string }) {
  const open = useApp((s) => s.questions[questionId]?.status === 'open');
  const t = chatStrings().panel;
  return <p className="label pl-1 text-ink-muted">{open ? t.carriedOpen : t.carried}</p>;
}

/**
 * The files a turn made, inside its reply (F-7): an image as a picture, the rest as chips, what a
 * monster showed in the preview as the card that opens it.
 */
export function Attachments({ items }: { items: readonly TurnAttachment[] }) {
  const s = chatStrings().strip;
  return (
    <ul
      aria-label={s.files(items.length)}
      data-testid="turn-attachments"
      className="mt-2.5 mb-1 flex flex-wrap gap-2"
    >
      {items.map((it) => (
        <li key={it.id} className="max-w-full min-w-0" data-testid="file-row">
          {it.kind === 'file' ? (
            <FileById id={it.file.id} image={it.file.kind === 'image'} />
          ) : (
            <PreviewRow item={it} />
          )}
        </li>
      ))}
    </ul>
  );
}
