/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/preserve-manual-memoization --
   a virtual list renders from what it measured in the DOM (heights kept in refs, so a measurement
   does not render again) and moves the chat's scroller, which ChatPanel owns and lends by context. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import {
  FIRST_GUESS,
  offsets,
  spanFor,
  spanFromEnd,
  spanServes,
  VIRTUAL_FROM,
  withRow,
  type Span,
} from './virtual.ts';

/*
 * The transcript renders only the rows near the screen once a chat is long (docs/design.md, "The
 * chat"; stream J): above `VIRTUAL_FROM` rows, about one screen above and one below what is
 * visible, the rest stands in as padding of the list, as tall as the rows were when they were
 * last on screen (measured with a ResizeObserver) or as tall as their kind usually is. A short
 * chat renders whole, as before.
 *
 * What stays true: the chat sticks to the bottom while a reply streams (the window follows the
 * end), a page of earlier messages keeps the row the user looks at in place, a row that grows
 * above the screen does not push what the user reads (the scroll moves with it; the browser's own
 * scroll anchoring is off then, it is not in every engine), the row that holds the focus stays
 * rendered, and `reveal` brings a far row in (the question bar's "Show", an anchor). The rows
 * are in DOM order, with their place in the list for screen readers. Find-in-page only sees the
 * rendered rows.
 */

/** The scroller of the chat and whether it sits at the bottom (ChatPanel owns both). */
export interface ChatScroll {
  scroller: RefObject<HTMLDivElement | null>;
  pinned: RefObject<boolean>;
}

export const ChatScrollContext = createContext<ChatScroll | null>(null);

/** What the chat can ask of its transcript. */
export interface VirtualControl {
  /**
   * Renders the row of `key` and calls `then` with its element, `far` when the row was not
   * rendered (then the caller should jump, not glide, to it). False when there is no such row.
   */
  reveal(key: string, then: (row: HTMLElement, far: boolean) => void): boolean;
  /** The list renders only part of its rows and keeps the reading place itself (see `anchor`). */
  keepsPlace(): boolean;
}

/** The list's own padding, top and bottom (the space the rows' paddings do not give). */
const PAD_TOP = 8;
const PAD_BOTTOM = 20;

/** The first element inside `row` that starts at or below `edge`, down the first visible branch. */
function firstOnScreen(row: Element, edge: number): Element | null {
  let node = row;
  for (let depth = 0; depth < 16; depth++) {
    let next: Element | null = null;
    for (const c of node.children) {
      const r = c.getBoundingClientRect();
      if (r.height > 0 && r.bottom > edge) {
        next = c;
        break;
      }
    }
    if (!next) return null;
    if (next.getBoundingClientRect().top >= edge) return next;
    node = next;
  }
  return null;
}

/** A rendered row by its key. */
function find(ol: HTMLElement, key: string): HTMLElement | null {
  return ol.querySelector<HTMLElement>(`:scope > [data-vkey="${CSS.escape(key)}"]`);
}

interface RowLike {
  key: string;
  kind: string;
}

export function VirtualList<R extends RowLike>({
  rows,
  render,
  rowClass,
  control,
  onWindow,
  testId,
}: {
  rows: readonly R[];
  /** The content of a row (its `<li>` is the list's). */
  render: (row: R) => ReactNode;
  rowClass: (row: R) => string | undefined;
  control?: RefObject<VirtualControl | null> | undefined;
  /** After a render that changed which rows are in the DOM. */
  onWindow?: (() => void) | undefined;
  testId?: string;
}) {
  const scroll = useContext(ChatScrollContext);
  const list = useRef<HTMLOListElement>(null);
  /** Heights measured on screen, and the first guess of the rows never measured (it stays). */
  const sizes = useRef(new Map<string, number>());
  const guesses = useRef(new Map<string, number>());
  const kinds = useRef(new Map<string, { sum: number; n: number }>());
  const heightOf = useCallback((r: RowLike): number => {
    const known = sizes.current.get(r.key) ?? guesses.current.get(r.key);
    if (known !== undefined) return known;
    const k = kinds.current.get(r.kind);
    const guess = k && k.n > 0 ? k.sum / k.n : (FIRST_GUESS[r.kind] ?? 100);
    guesses.current.set(r.key, guess);
    return guess;
  }, []);

  /** The rendered rows by their keys (indices move when a page comes in above). */
  const [win, setWin] = useState<{ start: string; end: string } | null>(null);
  /** The window follows the end of the list (a new row at the bottom joins it). */
  const atEnd = useRef(true);
  /** What the last render committed. */
  const committed = useRef<{ rows: readonly R[]; span: Span }>({
    rows: [],
    span: { start: 0, end: -1 },
  });
  /**
   * What the user reads at the top of the screen, and where its top was in the scroller's
   * content: the first element inside the first visible row that starts on screen (as the
   * browser's own scroll anchoring picks), then the first rows. After a change above it (a page
   * of earlier messages, rows measured for the first time, a picture that loaded) the scroll
   * moves by as much as the first of them still there did (a day's separator may go when the
   * page brings more of that day).
   */
  const anchor = useRef<{ el: Element | null; key: string; y: number }[]>([]);

  const n = rows.length;
  const virtual = n > VIRTUAL_FROM;
  const index = useMemo(() => {
    if (!virtual) return null;
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.key, i));
    return m;
  }, [rows, virtual]);

  let span: Span = { start: 0, end: n - 1 };
  let top = 0;
  let bottom = 0;
  if (virtual && index) {
    let s = win ? index.get(win.start) : undefined;
    let e = win ? index.get(win.end) : undefined;
    if (s === undefined || e === undefined || s > e) {
      // The rows rendered last time that are still here (all of them, when the list was short
      // until now; a separator may have gone when a page came in above).
      const prev = committed.current;
      s = e = undefined;
      for (let i = prev.span.start; i <= prev.span.end; i++) {
        const at = index.get(prev.rows[i]?.key ?? '');
        if (at === undefined) continue;
        s ??= at;
        e = at;
      }
    }
    if (s !== undefined && e !== undefined && s <= e) span = { start: s, end: e };
    else {
      const view = scroll?.scroller.current?.clientHeight || window.innerHeight || 900;
      span = spanFromEnd(rows.map(heightOf), view * 2);
    }
    if (atEnd.current) span = { start: span.start, end: n - 1 };
    for (let i = 0; i < span.start; i++) top += heightOf(rows[i]!);
    for (let i = span.end + 1; i < n; i++) bottom += heightOf(rows[i]!);
  }

  /** Notes what is at the top of the screen and where (see `anchor`). */
  const noteAnchor = useCallback(() => {
    const sc = scroll?.scroller.current;
    const ol = list.current;
    anchor.current = [];
    if (!sc || !ol) return;
    const edge = sc.getBoundingClientRect().top;
    const at = (el: Element) => el.getBoundingClientRect().top - edge + sc.scrollTop;
    for (const li of ol.children) {
      const r = li.getBoundingClientRect();
      const key = (li as HTMLElement).dataset['vkey'];
      if (r.bottom <= edge + 1 || !key) continue;
      if (anchor.current.length === 0) {
        const deep = r.top >= edge ? null : firstOnScreen(li, edge);
        if (deep) anchor.current.push({ el: deep, key, y: at(deep) });
      }
      anchor.current.push({ el: null, key, y: r.top - edge + sc.scrollTop });
      if (anchor.current.length >= 4) return;
    }
  }, [scroll]);

  /** After a change of layout: the scroll moves by as much as the anchor did (not pinned). */
  const keepPlace = useCallback(() => {
    const sc = scroll?.scroller.current;
    const ol = list.current;
    if (!sc || !ol || scroll?.pinned.current) return;
    for (const a of anchor.current) {
      const el = a.el?.isConnected ? a.el : a.el ? null : find(ol, a.key);
      if (!el) continue;
      const y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      if (Math.abs(y - a.y) > 0.5) sc.scrollTop += y - a.y;
      return;
    }
  }, [scroll]);

  /** Measures what the window should be now and renders it, if it changed. */
  const update = useCallback(() => {
    const sc = scroll?.scroller.current;
    const ol = list.current;
    const { rows: all, span: cur } = committed.current;
    if (!sc || !ol || all.length <= VIRTUAL_FROM) return;
    noteAnchor();
    const off = offsets(all.map(heightOf));
    const view = sc.clientHeight;
    const listTop =
      ol.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + PAD_TOP;
    const y = sc.scrollTop - listTop;
    if (spanServes(off, cur, y, y + view, view)) return;
    let next = spanFor(off, y, y + view, view);
    const focused = document.activeElement?.closest<HTMLElement>('[data-vkey]');
    if (focused && ol.contains(focused))
      next = withRow(
        next,
        all.findIndex((r) => r.key === focused.dataset['vkey']),
      );
    if (next.start === cur.start && next.end === cur.end) return;
    atEnd.current = next.end === all.length - 1;
    const start = all[next.start]!.key;
    const end = all[next.end]!.key;
    flushSync(() => setWin({ start, end }));
  }, [scroll, heightOf, noteAnchor]);

  // A row that changed size: measured, and what the user reads stays where it is.
  const onResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const many = committed.current.rows.length > VIRTUAL_FROM;
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.dataset['vkey'];
        if (!key || !el.isConnected) continue;
        const h = entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height;
        const old = sizes.current.get(key) ?? guesses.current.get(key);
        if (!sizes.current.has(key)) {
          const kind = el.dataset['vkind'] ?? '';
          const k = kinds.current.get(kind) ?? { sum: 0, n: 0 };
          kinds.current.set(kind, { sum: k.sum + h, n: k.n + 1 });
        }
        sizes.current.set(key, h);
        if (old !== undefined && Math.abs(h - old) >= 0.5) changed = true;
      }
      if (changed && many) {
        keepPlace();
        noteAnchor();
        requestAnimationFrame(update);
      }
    },
    [update, keepPlace, noteAnchor],
  );
  const observer = useRef<ResizeObserver | null>(null);
  const observe = useCallback(
    (el: HTMLLIElement | null) => {
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = (observer.current ??= new ResizeObserver(onResize));
      ro.observe(el);
      return () => ro.unobserve(el);
    },
    [onResize],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  useLayoutEffect(() => {
    const prev = committed.current;
    const sc = scroll?.scroller.current;
    const ol = list.current;
    // Off before anything reads the layout: the browser would anchor too (not every engine does).
    if (sc) sc.style.overflowAnchor = virtual ? 'none' : '';
    if (sc && ol) {
      // What changed above what the user reads moves the scroll with it.
      if (virtual) keepPlace();
      // The rendered rows, measured now: the ResizeObserver then reports only later changes.
      for (const li of ol.children) {
        const key = (li as HTMLElement).dataset['vkey'];
        if (!key) continue;
        const h = li.getBoundingClientRect().height;
        if (!sizes.current.has(key)) {
          const kind = (li as HTMLElement).dataset['vkind'] ?? '';
          const k = kinds.current.get(kind) ?? { sum: 0, n: 0 };
          kinds.current.set(kind, { sum: k.sum + h, n: k.n + 1 });
        }
        sizes.current.set(key, h);
      }
      noteAnchor();
    }
    const moved =
      prev.rows[prev.span.start]?.key !== rows[span.start]?.key ||
      prev.rows[prev.span.end]?.key !== rows[span.end]?.key;
    committed.current = { rows, span };
    atEnd.current = span.end === n - 1;
    if (moved) onWindow?.();
  });

  // New rows, or a page of older ones: the window is measured again once the scroll has settled.
  useEffect(() => {
    if (!virtual) return;
    const id = requestAnimationFrame(update);
    return () => cancelAnimationFrame(id);
  }, [rows, virtual, update]);

  useEffect(() => {
    const sc = scroll?.scroller.current;
    if (!sc) return;
    sc.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
    ro?.observe(sc);
    return () => {
      sc.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [scroll, update]);

  useEffect(() => {
    if (!control) return;
    control.current = {
      keepsPlace: () => committed.current.rows.length > VIRTUAL_FROM,
      reveal(key, then) {
        const { rows: all, span: cur } = committed.current;
        const i = all.findIndex((r) => r.key === key);
        if (i < 0) return false;
        const ol = list.current;
        const here = ol && i >= cur.start && i <= cur.end ? find(ol, key) : null;
        if (here) {
          then(here, false);
          return true;
        }
        const sc = scroll?.scroller.current;
        const view = sc?.clientHeight || window.innerHeight || 900;
        const off = offsets(all.map(heightOf));
        const next = spanFor(off, off[i]!, off[i]! + view, view);
        atEnd.current = next.end === all.length - 1;
        if (scroll) scroll.pinned.current = false;
        const start = all[next.start]!.key;
        const end = all[next.end]!.key;
        // A jump: nothing above the new rows is the user's reading place.
        anchor.current = [];
        flushSync(() => setWin({ start, end }));
        const el = ol ? find(ol, key) : null;
        if (el) then(el, true);
        return !!el;
      },
    };
    return () => {
      control.current = null;
    };
  }, [control, scroll, heightOf]);

  const shown = rows.slice(span.start, span.end + 1);
  return (
    <ol
      ref={list}
      className="flex flex-col"
      style={{ paddingTop: PAD_TOP + top, paddingBottom: PAD_BOTTOM + bottom }}
      data-testid={testId}
      data-virtual={virtual ? 'true' : undefined}
    >
      {shown.map((r, k) => (
        <li
          key={r.key}
          ref={observe}
          data-vkey={r.key}
          data-vkind={r.kind}
          className={rowClass(r)}
          {...(virtual ? { 'aria-setsize': n, 'aria-posinset': span.start + k + 1 } : {})}
        >
          {render(r)}
        </li>
      ))}
    </ol>
  );
}
