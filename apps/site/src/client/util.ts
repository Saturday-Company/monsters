/* Small browser helpers shared by the live parts. */

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isKilled = (): boolean => document.documentElement.dataset['killed'] === 'true';

/** Fired on `document` when the kill switch is pulled (`detail: true`) or released. */
export const KILL_EVENT = 'monsters:kill';

export function onKill(fn: (killed: boolean) => void): void {
  document.addEventListener(KILL_EVENT, (e) => fn((e as CustomEvent<boolean>).detail));
}

/** Runs `fn` once, when `el` comes within `margin` of the viewport. */
export function onVisible(el: Element, fn: () => void, margin = '0px'): void {
  if (!('IntersectionObserver' in window)) {
    fn();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
}

/**
 * One line in the page's own kernel log (the dmesg window in the footer): what the page did,
 * with the seconds since navigation, like the real thing.
 */
export function dmesg(msg: string): void {
  const out = document.querySelector<HTMLElement>('[data-dmesg]');
  if (!out) return;
  const s = (performance.now() / 1000).toFixed(3).padStart(9, ' ');
  const lines = (out.textContent ?? '').split('\n');
  lines.push(`[${s}] ${msg}`);
  out.textContent = lines.slice(-24).join('\n');
}

export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
