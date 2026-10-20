/*
 * The terminal windows of the page: [_] folds the body, [□] widens the window across the
 * section, [x] "kills the process" (a line with a reopen key stays), tabs switch panels with the
 * arrow keys, and on wide screens with a mouse the title bar drags the window around (double
 * click puts it back). Plus the small live bits that live in windows: the tmux clock, the
 * neofetch uptime and the ASCII scrollbars.
 */
import { dmesg, isKilled, onKill, reducedMotion } from './util.ts';

const canDrag = (): boolean =>
  matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;

function controls(win: HTMLElement): void {
  const title = win.querySelector('.win__title')?.textContent ?? 'window';
  const min = win.querySelector<HTMLButtonElement>('[data-win-min]');
  const max = win.querySelector<HTMLButtonElement>('[data-win-max]');
  const close = win.querySelector<HTMLButtonElement>('[data-win-close]');
  const exited = win.querySelector<HTMLElement>('.win__exited');
  const reopen = win.querySelector<HTMLButtonElement>('[data-win-reopen]');

  min?.addEventListener('click', () => {
    const folded = win.classList.toggle('is-min');
    min.setAttribute('aria-expanded', String(!folded));
    dmesg(`win: ${title} ${folded ? 'minimized' : 'restored'}`);
  });
  max?.addEventListener('click', () => {
    const on = win.classList.toggle('is-max');
    max.setAttribute('aria-pressed', String(on));
    win.style.translate = '';
  });
  close?.addEventListener('click', () => {
    win.classList.add('is-closed');
    if (exited) exited.hidden = false;
    reopen?.focus();
    dmesg(`win: ${title}: process exited with code 0`);
  });
  reopen?.addEventListener('click', () => {
    win.classList.remove('is-closed');
    if (exited) exited.hidden = true;
    close?.focus();
  });
}

function tabs(win: HTMLElement): void {
  const list = Array.from(win.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (!list.length) return;
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of list) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      if (panel) panel.toggleAttribute('data-inactive', !on);
    }
    if (focus) tab.focus();
  };
  list.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'Home') select(list[0]!, true);
      else if (e.key === 'End') select(list[list.length - 1]!, true);
      else if (d) select(list[(i + d + list.length) % list.length]!, true);
      else return;
      e.preventDefault();
    });
  });
}

let zTop = 1;

function drag(win: HTMLElement): void {
  const bar = win.querySelector<HTMLElement>('.win__bar');
  if (!bar) return;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  let moving = false;
  const offset = () => {
    const [x = '0', y = '0'] = (win.style.translate || '0px 0px').split(' ');
    return [parseFloat(x) || 0, parseFloat(y) || 0] as const;
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!canDrag() || win.classList.contains('is-max')) return;
    if ((e.target as HTMLElement).closest('button')) return;
    moving = true;
    [ox, oy] = offset();
    sx = e.clientX;
    sy = e.clientY;
    bar.setPointerCapture(e.pointerId);
    win.classList.add('is-drag');
    win.style.zIndex = String(++zTop);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!moving) return;
    const x = Math.max(-600, Math.min(600, ox + e.clientX - sx));
    const y = Math.max(-400, Math.min(400, oy + e.clientY - sy));
    win.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  });
  const end = () => {
    if (!moving) return;
    moving = false;
    win.classList.remove('is-drag');
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => {
    win.style.translate = '';
  });
}

/** A scrollbar drawn in characters, next to a scrolling block: ▲, track, thumb, ▼. */
function asciiScroll(box: HTMLElement): void {
  const view = box.querySelector<HTMLElement>('[data-ascroll-view]');
  const bar = box.querySelector<HTMLElement>('[data-ascroll-bar]');
  if (!view || !bar) return;
  const paint = () => {
    const rows = Math.max(4, Math.floor((view.clientHeight - 28) / 17) - 2);
    const total = view.scrollHeight;
    const shown = view.clientHeight;
    if (total <= shown + 2) {
      bar.textContent = '';
      return;
    }
    const size = Math.max(1, Math.round((rows * shown) / total));
    const max = total - shown;
    const at = Math.round(((rows - size) * view.scrollTop) / max);
    let s = '▲\n';
    for (let i = 0; i < rows; i++) s += i >= at && i < at + size ? '█\n' : '░\n';
    bar.textContent = `${s}▼`;
  };
  view.addEventListener('scroll', paint, { passive: true });
  new ResizeObserver(paint).observe(view);
  paint();
}

function clock(): void {
  const el = document.querySelector('[data-clock]');
  if (!el) return;
  const tick = () => {
    el.textContent = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  };
  tick();
  setInterval(tick, 15_000);
}

function uptime(): void {
  const el = document.querySelector('[data-uptime]');
  if (!el) return;
  const t0 = performance.now();
  const tick = () => {
    const s = Math.floor((performance.now() - t0) / 1000);
    el.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };
  tick();
  setInterval(tick, 1000);
}

export function initWins(): void {
  const wins = Array.from(document.querySelectorAll<HTMLElement>('[data-win]'));
  for (const w of wins) {
    controls(w);
    tabs(w);
    if (w.hasAttribute('data-drag')) drag(w);
  }
  document.querySelectorAll<HTMLElement>('[data-ascroll]').forEach(asciiScroll);
  clock();
  uptime();
  dmesg(`wins: ${wins.length} windows, drag ${canDrag() ? 'on' : 'off'}`);
  onKill((k) => dmesg(k ? 'kill: scope=global by=ui' : 'resume: by=ui'));
  if (isKilled()) dmesg('kill: switch already pulled');
  if (reducedMotion()) dmesg('motion: reduced, animations off');
}
