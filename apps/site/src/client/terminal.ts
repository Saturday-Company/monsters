/*
 * The terminal session plays line by line when it scrolls into view: one line per frame group,
 * with the pauses written in the markup. The kill switch freezes it where it is.
 */
import { isKilled, onKill, onVisible, reducedMotion } from './util.ts';

const LINE = 110;

export function initTerminal(): void {
  const body = document.querySelector<HTMLElement>('[data-term]');
  if (!body || reducedMotion()) return;
  const lines = Array.from(body.querySelectorAll<HTMLElement>('.ln'));
  body.classList.add('armed');
  let i = 0;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const next = () => {
    timer = null;
    if (isKilled()) return;
    const line = lines[i];
    if (!line) return;
    line.classList.add('on');
    i++;
    timer = setTimeout(next, LINE + Number(line.dataset['pause'] ?? 0));
  };
  onVisible(
    body,
    () => {
      started = true;
      next();
    },
    '0px 0px -20% 0px',
  );
  onKill((killed) => {
    if (!killed && started && !timer) next();
  });
}
