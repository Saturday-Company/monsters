/*
 * The hero's log pane: the prerendered request is replayed with the times of now, one event
 * every ~600ms, then a pause and the same request again (new run, same story). The kill switch
 * writes a real `kill` event and an aborted run; resume writes `resume` and the replay goes on.
 * Reduced motion: the static lines stay as built.
 */
import { clock, summarize } from '../lib/eventfmt.ts';
import { isKilled, onKill, onVisible, reducedMotion } from './util.ts';

const STEP = 620;
const PAUSE = 4200;
const KEEP = 40;

interface Line {
  agent: string;
  type: string;
  body: string;
}

export function initLogPane(): void {
  const list = document.querySelector<HTMLOListElement>('[data-log]');
  if (!list || reducedMotion()) return;
  const script: Line[] = Array.from(list.querySelectorAll('li')).map((li) => ({
    agent: li.querySelector('b')?.textContent?.trim() ?? '',
    type: li.querySelector('i')?.textContent?.trim() ?? '',
    body: li.querySelector('span')?.textContent ?? '',
  }));
  if (!script.length) return;

  // The prerendered run happened "a moment ago" in the reader's own clock.
  const stamps = Array.from(list.querySelectorAll<HTMLElement>('li[data-ts]'));
  const last = Number(stamps.at(-1)?.dataset['ts'] ?? 0);
  const shift = Date.now() - 3000 - last;
  for (const li of stamps) {
    const time = li.querySelector('time');
    if (time) time.textContent = clock(Number(li.dataset['ts']) + shift);
  }

  const print = (l: Line, cls = '') => {
    const li = document.createElement('li');
    li.className = `ev ev--${l.type} ${cls}`;
    const time = document.createElement('time');
    time.textContent = clock(Date.now());
    const b = document.createElement('b');
    b.className = `ag ag--${l.agent}`;
    b.textContent = l.agent.padEnd(6);
    const i = document.createElement('i');
    i.textContent = l.type.padEnd(14);
    const span = document.createElement('span');
    span.textContent = l.body;
    li.append(time, ' ', b, ' ', i, ' ', span);
    list.append(li);
    while (list.children.length > KEEP) list.firstElementChild?.remove();
  };

  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const next = () => {
    timer = null;
    if (isKilled()) return;
    const l = script[i];
    if (!l) {
      i = 0;
      timer = setTimeout(next, PAUSE);
      return;
    }
    print(l, 'is-new');
    i++;
    timer = setTimeout(next, STEP + (l.type === 'delegation' ? 500 : 0));
  };

  onVisible(list, () => (timer = setTimeout(next, STEP)), '0px');

  onKill((killed) => {
    if (killed) {
      if (timer) clearTimeout(timer);
      timer = null;
      const running = i > 0 && i < script.length;
      print(
        {
          agent: 'system',
          type: 'kill',
          body: summarize({
            type: 'kill',
            data: { scope: 'global', by: 'ui', runsAborted: running ? 1 : 0 },
          }),
        },
        'is-kill',
      );
      if (running) print({ agent: 'titan', type: 'run', body: 'aborted' }, 'is-kill');
      i = 0;
    } else {
      print({
        agent: 'system',
        type: 'resume',
        body: summarize({ type: 'resume', data: { by: 'ui' } }),
      });
      if (!timer) timer = setTimeout(next, STEP);
    }
  });
}
