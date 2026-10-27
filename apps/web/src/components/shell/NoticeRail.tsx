import { X } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '../../lib/utils.ts';
import { dismissNotice, useApp, type Notice } from '../../store/app.ts';
import { noticePlaceFor, setNoticePlace, type NoticePlace } from '../../store/notice-rail.ts';
import { useLayer } from '../ui/layers.ts';
import { shellStrings } from './shell.strings.ts';
import { NoticeIcon, useNoticeLife } from './StatusLayer.tsx';

/*
 * The message of the shell inside the top rail (docs/design.md, "The top rail"), on a desktop
 * (900 px and more): in the free space between the view's title and keys and the Inbox key, in one
 * line, so the page never moves and nothing is covered (not Stop, not the Inbox, not the status
 * display). What fits depends on that space:
 *
 *   - a chip (240 px or more): the light of its kind, the sentence cut with an ellipsis (the whole
 *     of it is the tooltip and what a screen reader reads), its key and ✕; with more messages in
 *     line a "+N" tile that opens the list;
 *   - a key (104 px or more): the light and "1 notice", which opens a popover with the messages;
 *   - the light alone (36 px or more);
 *   - otherwise the band under the rail (`NoticeBar`).
 */

/** The air between the message and the Inbox key. */
const GAP = 12;
/** The gap between the pieces of the view's own keys (`gap-3` of the rail). */
const PIECE_GAP = 12;

/**
 * The width a view's title loses to its ellipsis, so its whole length is what the view needs: a
 * title that was cut to make room for the message would otherwise count as smaller, and give the
 * message even more room. A title only for screen readers (the chat's) is not drawn: it needs none.
 */
function hiddenText(el: HTMLElement): number {
  let lost = 0;
  for (const t of [el, ...el.querySelectorAll<HTMLElement>('h1, .truncate')]) {
    if (!t.matches('h1, .truncate') || getComputedStyle(t).position === 'absolute') continue;
    lost += Math.max(0, t.scrollWidth - t.clientWidth);
  }
  return lost;
}

/** How wide the rail's free space is, in px, for the message: what the view's title and keys leave. */
function freeRoom(middle: HTMLElement, own: HTMLElement): number {
  const style = getComputedStyle(middle);
  const inner =
    middle.clientWidth -
    parseFloat(style.paddingLeft || '0') -
    parseFloat(style.paddingRight || '0');
  const slot = middle.firstElementChild as HTMLElement | null;
  let natural: number;
  if (slot && slot.children.length > 0) {
    const kids = [...slot.children] as HTMLElement[];
    natural =
      kids.reduce((sum, k) => sum + k.offsetWidth + hiddenText(k), 0) +
      PIECE_GAP * (kids.length - 1);
  } else {
    // No view keys yet: the page's name stands in for the title.
    natural = middle.querySelector('p')?.scrollWidth ?? 0;
  }
  // What the rail gives the message now is what the view does not need, whatever the message
  // currently takes (its own width, with its gap, is part of the sum).
  return Math.floor(inner + own.offsetWidth - natural - GAP);
}

/** The tone of the chip: red for an error, ink for the rest (like the card of a phone). */
const toneOf = (n: Notice) => (n.tone === 'error' ? 'bg-stop text-on-stop' : 'bg-ink text-panel');

/** One message in a line: its light, the sentence, the key, "+N" and ✕. */
function NoticeChip({
  notice,
  more,
  open,
  onToggle,
  hold,
  max,
}: {
  notice: Notice;
  more: number;
  open: boolean;
  onToggle: () => void;
  hold: boolean;
  max: number;
}) {
  const { handlers, close, sticky } = useNoticeLife(notice, hold);
  const s = shellStrings();
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      data-testid="notice"
      data-sticky={sticky || undefined}
      title={notice.text}
      style={{ maxWidth: max }}
      {...handlers}
      className={cn(
        'rise-in pointer-events-auto flex h-8 min-w-0 items-center gap-2 rounded-[8px] pr-1 pl-2.5 text-footnote font-medium',
        toneOf(notice),
      )}
    >
      <NoticeIcon tone={notice.tone} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{notice.text}</span>
      {notice.action && (
        <button
          type="button"
          onClick={() => {
            close();
            notice.action?.run();
          }}
          className="inline-flex h-6 shrink-0 items-center rounded-full px-2 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          data-testid="notice-action"
        >
          {notice.action.label}
        </button>
      )}
      {more > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={s.notices.more(more)}
          title={s.notices.more(more)}
          data-testid="notice-more"
          className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[4px] px-1 font-mono text-micro leading-none tabular-nums shadow-[inset_0_0_0_1px_currentColor] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          +{more}
        </button>
      )}
      <button
        type="button"
        onClick={close}
        aria-label={s.close}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <X size={14} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

/** No room for the sentence: the light (and "1 notice") that opens the list. */
function NoticeKey({
  notice,
  total,
  open,
  onToggle,
  withWords,
  hold,
}: {
  notice: Notice;
  total: number;
  open: boolean;
  onToggle: () => void;
  withWords: boolean;
  hold: boolean;
}) {
  // The message keeps its life while it is only a key.
  const { sticky } = useNoticeLife(notice, hold);
  const s = shellStrings().notices;
  return (
    <>
      {/* A screen reader hears the sentence, not only that there is a key. */}
      <span role={notice.tone === 'error' ? 'alert' : 'status'} className="sr-only">
        {notice.text}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={s.count(total)}
        title={notice.text}
        data-testid="notice-key"
        data-sticky={sticky || undefined}
        className={cn(
          'rise-in pointer-events-auto inline-flex h-8 items-center gap-2 rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
          withWords ? 'px-2.5' : 'w-8 justify-center',
          toneOf(notice),
        )}
      >
        <span
          aria-hidden
          className="led"
          data-tone={notice.tone === 'error' ? 'stop' : 'signal'}
          data-blink={notice.tone === 'error' ? undefined : ''}
        />
        {withWords && (
          <span aria-hidden className="label whitespace-nowrap">
            {s.count(total)}
          </span>
        )}
      </button>
    </>
  );
}

/** The messages in line, whole: a small popover under the rail. */
function NoticePopover({ notices, onClose }: { notices: readonly Notice[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = shellStrings();
  useLayer({ ref, onEscape: onClose });
  // A press anywhere else closes it (the chip and the key toggle it themselves).
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (ref.current?.contains(t)) return;
      if (t.closest('[data-testid="notice"], [data-testid="notice-key"]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={s.notices.label}
      data-layer-exempt
      data-testid="notice-popover"
      className="raised drop-in pointer-events-auto fixed top-[56px] right-3 z-[60] grid max-h-[calc(100vh-72px)] w-[min(400px,calc(100vw-24px))] gap-0.5 overflow-y-auto rounded-[14px] p-2"
    >
      {notices.map((n) => {
        return (
          <div
            key={n.id}
            data-testid="notice-row"
            className="flex items-start gap-2.5 rounded-[10px] px-2 py-2"
          >
            <NoticeIcon
              tone={n.tone}
              size={18}
              className={cn('mt-0.5 shrink-0', n.tone === 'error' ? 'text-stop-ink' : 'text-ink')}
            />
            <p className="min-w-0 flex-1 text-body leading-snug break-words text-ink">{n.text}</p>
            {n.action && (
              <button
                type="button"
                onClick={() => {
                  dismissNotice(n.id);
                  n.action?.run();
                }}
                className="key inline-flex h-8 shrink-0 items-center rounded-[8px] px-3 text-footnote font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
              >
                {n.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismissNotice(n.id)}
              aria-label={s.close}
              className="key-ghost inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:text-ink"
            >
              <X size={14} weight="bold" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The place of the message in the rail, between the view's title and keys and the Inbox key. It
 * measures what the view leaves free and says (`useNoticePlace`) which form fits, so the band under
 * the rail is only drawn when this slot cannot hold the message.
 */
export function NoticeRailSlot({
  middleRef,
  wide,
}: {
  /** The rail's middle zone (the view's slot and the page's name): what it needs is not taken. */
  middleRef: RefObject<HTMLElement | null>;
  /** 900 px and more: below it the rail keeps to its own work and the band shows the message. */
  wide: boolean;
}) {
  const notice = useApp((s) => s.notice);
  const queue = useApp((s) => s.noticeQueue);
  const own = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY);
  const [open, setOpen] = useState(false);
  const place: NoticePlace = wide ? noticePlaceFor(room) : 'band';

  // Measured when the rail, the view's keys or the slot itself change size (an observer reports it
  // before the next paint, also the first time). The number does not depend on what the slot holds.
  useEffect(() => {
    const middle = middleRef.current;
    if (!wide || !middle) return;
    const measure = () => {
      if (own.current) setRoom(freeRoom(middle, own.current));
    };
    const resize = new ResizeObserver(measure);
    resize.observe(middle);
    if (own.current) resize.observe(own.current);
    const slot = middle.firstElementChild;
    const mutate = new MutationObserver(measure);
    if (slot) {
      resize.observe(slot);
      mutate.observe(slot, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
  }, [wide, middleRef]);
  useLayoutEffect(() => {
    setNoticePlace(place);
  }, [place]);
  useEffect(() => () => setNoticePlace('band'), []);
  // The list closes with the last message (so the next one does not arrive with it open).
  if (!notice && open) setOpen(false);

  const inRail = notice !== null && place !== 'band';
  const total = (notice ? 1 : 0) + queue.length;
  const close = () => setOpen(false);
  return (
    <>
      <div
        ref={own}
        aria-live="polite"
        data-layer-exempt
        data-testid="notice-slot"
        className={cn('flex shrink-0 items-center', !wide && 'hidden', inRail && 'pr-3')}
      >
        {inRail && place === 'chip' && (
          <NoticeChip
            key={notice.id}
            notice={notice}
            more={queue.length}
            open={open}
            onToggle={() => setOpen((o) => !o)}
            hold={open}
            max={Math.min(460, Math.max(room, 0))}
          />
        )}
        {inRail && place !== 'chip' && (
          <NoticeKey
            key={notice.id}
            notice={notice}
            total={total}
            open={open}
            onToggle={() => setOpen((o) => !o)}
            withWords={place === 'key'}
            hold={open}
          />
        )}
      </div>
      {inRail && open && <NoticePopover notices={[notice, ...queue]} onClose={close} />}
    </>
  );
}
