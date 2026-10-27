import { ArrowCounterClockwise, PencilSimple } from '@phosphor-icons/react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn, formatTime } from '../../lib/utils.ts';
import { CopyKey } from '../ui/CopyKey.tsx';
import { chatStrings } from './chat.strings.ts';

/*
 * What can be done with a message (docs/design.md, "The chat"): a small bar of keys on the corner
 * of a bubble with its time, shown under the pointer or with the focus inside (desktop) and on a
 * tap on the bubble (touch, where there is no hover). Copy on every bubble; "Again" on the
 * user's messages (sends the same message once more); "Edit" on the user's last one (puts it
 * back in the writing field). Keys are 32 px with their name as tooltip and accessible name.
 */

/** What the chat lets its bubbles do besides copying. */
export interface BubbleTools {
  /** The user's latest message in this chat: the only one that can be edited. */
  lastUserId: string | null;
  /** A message can be sent now (a model is connected, the app reaches the core). */
  canResend: boolean;
  again: (text: string, files?: readonly string[]) => void;
  edit: (text: string) => void;
}

export const BubbleToolsContext = createContext<BubbleTools | null>(null);

/** The ids of the user's messages that wait in a run for the monster's next step (store/queued.ts). */
export const QueuedContext = createContext<ReadonlySet<string>>(new Set());

const KEY =
  'key-ghost inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-ink disabled:opacity-50';

/**
 * A bubble with its bar of keys. `text` is what Copy takes; `again` and `edit` only for the
 * user's own messages. `side` is the side the bubble speaks from (the bar hangs by its right
 * corner either way: a monster's strip is short and on the left, so the bar covers it less).
 */
export function BubbleFrame({
  ts,
  text,
  side,
  again,
  edit,
  streaming = false,
  className,
  children,
}: {
  ts: number;
  text: string;
  side: 'start' | 'end';
  /** The reply is still being written: no bar until it is whole. */
  streaming?: boolean;
  again?: (() => void) | undefined;
  edit?: (() => void) | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const s = chatStrings().panel;
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  // A tap elsewhere puts the bar away again.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!frame.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const time = formatTime(ts);
  if (streaming) return <div className={cn('w-fit max-w-full min-w-0', className)}>{children}</div>;
  return (
    <div
      ref={frame}
      className={cn('bubble-frame relative w-fit max-w-full min-w-0', className)}
      data-open={open ? '' : undefined}
      onPointerUp={(e) => {
        // Touch only: a mouse click selects text, the pointer already shows the bar.
        if (e.pointerType !== 'touch') return;
        if ((e.target as Element).closest('a, button, input, textarea, [role="toolbar"]')) return;
        setOpen((o) => !o);
      }}
    >
      {children}
      <div
        role="toolbar"
        aria-label={s.messageActions}
        data-testid="bubble-tools"
        data-side={side}
        className="bubble-tools popover"
      >
        <span className="bubble-time" data-testid="bubble-time">
          {time}
        </span>
        <CopyKey text={text} label={s.copy} testId="copy-message" className="size-8" />
        {again && (
          <button
            type="button"
            onClick={again}
            aria-label={s.again}
            title={s.againTitle}
            data-testid="message-again"
            className={KEY}
          >
            <ArrowCounterClockwise size={16} aria-hidden />
          </button>
        )}
        {edit && (
          <button
            type="button"
            onClick={edit}
            aria-label={s.edit}
            title={s.editTitle}
            data-testid="message-edit"
            className={KEY}
          >
            <PencilSimple size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/** The bubble's tools for one of the user's messages. */
export function useUserTools(
  id: string,
  text: string,
  files: readonly string[] | undefined,
  pending: boolean,
): { again?: () => void; edit?: () => void } {
  const tools = useContext(BubbleToolsContext);
  if (!tools || pending || !text.trim()) return {};
  return {
    ...(tools.canResend ? { again: () => tools.again(text, files) } : {}),
    ...(tools.lastUserId === id ? { edit: () => tools.edit(text) } : {}),
  };
}
