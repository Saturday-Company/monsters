/*
 * The kill switch of the page: the lever (a toggle button, so it works with the keyboard) and
 * the resume key of the red banner. Pulled, it sets `data-killed` on <html>: CSS pauses every
 * animation and swaps every monster to its sleeping SVG; the canvases listen to the event.
 */
import { KILL_EVENT, isKilled } from './util.ts';

export function setKilled(killed: boolean): void {
  const html = document.documentElement;
  if (killed) html.dataset['killed'] = 'true';
  else delete html.dataset['killed'];
  document.querySelectorAll<HTMLButtonElement>('[data-kill-lever]').forEach((lever) => {
    lever.setAttribute('aria-pressed', String(killed));
    const label = killed ? lever.dataset['release'] : lever.dataset['pull'];
    if (label) lever.setAttribute('aria-label', label);
  });
  document.dispatchEvent(new CustomEvent(KILL_EVENT, { detail: killed }));
}

export function initKill(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-kill-lever]').forEach((lever) => {
    lever.addEventListener('click', () => {
      // Focus stays on the lever: pressing it again releases it (aria-pressed tells the state).
      setKilled(!isKilled());
    });
  });
  document.querySelector('[data-kill-resume]')?.addEventListener('click', () => {
    setKilled(false);
    document.querySelector<HTMLButtonElement>('[data-kill-lever]')?.focus({ preventScroll: true });
  });
}
