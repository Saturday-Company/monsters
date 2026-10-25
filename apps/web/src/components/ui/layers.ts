import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/*
 * The layers of the interface that sit over the page (the palette, a dialog, a
 * sheet, the right-hand pane, a cover that is armed): one stack, one keyboard
 * handler. Escape closes only the layer on top; a modal layer keeps Tab inside
 * itself, takes the focus when it opens and gives it back to what opened it
 * when it closes. Before this, every layer listened to Escape on its own, so
 * one key closed all of them at once (review of 25/10, W-16, W-17).
 *
 * A layer that handles Escape inside a field (a list, a zoom, an armed key)
 * calls `preventDefault()` on the event: the handler below leaves such a key
 * alone.
 *
 * The top bar stays outside every trap: "Ferma" is always visible and reachable
 * (ARCHITECTURE §8), also with the keys (⌘. / Ctrl+. puts the focus on it from
 * anywhere). A native `showModal()` or `inert` on the page would take it away.
 */

/** What stays reachable while a modal layer is open: the top bar and the message bar. */
const OUTSIDE_THE_TRAP = '[data-testid="toolbar"], [data-layer-exempt]';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface Layer {
  /** The element the layer is made of (for the trap); null until it is on screen. */
  el: () => HTMLElement | null;
  escape: () => void;
  trap: boolean;
}

const stack: Layer[] = [];

/** The controls of an element that a keyboard user can reach with Tab, in order. */
export function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      !el.closest('[inert], [hidden]') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.getClientRects().length > 0,
  );
}

function outside(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OUTSIDE_THE_TRAP) !== null;
}

function onKeyDown(e: KeyboardEvent): void {
  const top = stack.at(-1);
  if (!top) return;
  if (e.key === 'Escape') {
    if (e.defaultPrevented || e.isComposing) return;
    e.preventDefault();
    top.escape();
    return;
  }
  if (e.key !== 'Tab' || !top.trap || e.defaultPrevented) return;
  const root = top.el();
  if (!root || outside(e.target)) return;
  const items = tabbablesIn(root);
  const at = document.activeElement;
  if (items.length === 0) {
    e.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = items[0]!;
  const last = items.at(-1)!;
  if (!(at instanceof Node) || !root.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (e.shiftKey && (at === first || at === root)) {
    e.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

/** A click or a programmatic focus on the page behind a modal layer comes back inside it. */
function onFocusIn(e: FocusEvent): void {
  const top = stack.at(-1);
  if (!top?.trap) return;
  const root = top.el();
  if (!root || !(e.target instanceof Node) || root.contains(e.target) || outside(e.target)) return;
  (tabbablesIn(root)[0] ?? root).focus({ preventScroll: true });
}

function push(layer: Layer): () => void {
  if (stack.length === 0) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('focusin', onFocusIn);
  }
  // A modal layer is always above the ones next to the page, whichever opened first.
  const firstModal = layer.trap ? -1 : stack.findIndex((l) => l.trap);
  if (firstModal >= 0) stack.splice(firstModal, 0, layer);
  else stack.push(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('focusin', onFocusIn);
    }
  };
}

/** Whether a layer is open (a test of the shell, and the keys that must not act under one). */
export function hasOpenLayer(): boolean {
  return stack.length > 0;
}

export interface LayerOptions {
  /** Whether the layer is on screen. Default: true (the component is mounted only while open). */
  open?: boolean;
  /** Called by Escape when this layer is the one on top. */
  onEscape: () => void;
  /** The element of the layer. Needed for the trap, the first focus and the focus given back. */
  ref?: RefObject<HTMLElement | null>;
  /** A modal layer keeps Tab (and the focus) inside it. Sheets next to the chat are not modal. */
  trap?: boolean;
  /**
   * What takes the focus when the layer opens: an element, `'first'` (the first control, or the
   * one marked `data-autofocus`), or `false` to leave the focus where it is.
   */
  initialFocus?: RefObject<HTMLElement | null> | 'first' | false;
}

/**
 * Puts a layer on the stack while it is open: Escape closes only the top one, a modal layer traps
 * Tab, takes the focus on opening and gives it back to the opener on closing (unless the user
 * has already moved on to something else).
 */
export function useLayer({
  open = true,
  onEscape,
  ref,
  trap = false,
  initialFocus = false,
}: LayerOptions): void {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });
  const focus = useRef(initialFocus);
  useEffect(() => {
    focus.current = initialFocus;
  });

  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const pop = push({
      el: () => ref?.current ?? null,
      escape: () => escape.current(),
      trap,
    });
    const root = ref?.current ?? null;
    const want = focus.current;
    if (want && root) {
      const target =
        want === 'first'
          ? (root.querySelector<HTMLElement>('[data-autofocus]') ?? tabbablesIn(root)[0] ?? root)
          : want.current;
      target?.focus({ preventScroll: true });
    }
    return () => {
      pop();
      // Back to what opened the layer, unless the user went somewhere else meanwhile.
      const now = document.activeElement;
      const lost = !now || now === document.body || (root !== null && root.contains(now));
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, ref, trap]);
}
