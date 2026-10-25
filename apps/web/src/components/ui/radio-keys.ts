import { useEffect } from 'react';

/*
 * The arrow keys of every radio group of the app (review of 25/10, W-31). The groups are made
 * of plain buttons with `role="radio"` inside a `role="radiogroup"` (Segmented, the chips of the
 * first run, the filters of the terminal, the forms), and a button ignores the arrows. One
 * handler on the window gives all of them the keys of the WAI-ARIA pattern instead of one
 * handler in each place: arrows (and Home / End) move the focus to the next radio and choose it,
 * wrapping around at the ends.
 */

/** The radio to move to for a key, among the radios of one group; null for any other key. */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target;
  if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') return;
  const group = target.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (r) => !r.matches(':disabled, [aria-disabled="true"]'),
  );
  const next = radioKeyTarget(e.key, radios.indexOf(target), radios.length);
  if (next === null || radios.indexOf(target) < 0) return;
  e.preventDefault();
  const to = radios[next]!;
  to.focus();
  // Like a native radio: moving to it chooses it.
  if (to !== target && to.getAttribute('aria-checked') !== 'true') to.click();
}

/** Mounted once, high in the tree (NoticeRoot). */
export function useRadioGroupKeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
