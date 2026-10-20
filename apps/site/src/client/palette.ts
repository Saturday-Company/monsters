/*
 * The command palette in the browser: a native modal <dialog> (focus stays inside, Esc
 * closes), a prompt with history (↑ ↓) and Tab completion, and the actions of
 * src/lib/palette.ts performed on the page. Loaded on the first `/`, Ctrl+K or bar key.
 */
import { complete, runCommand, type PaletteAction, type PaletteStrings } from '../lib/palette.ts';
import { setKilled } from './kill.ts';
import { dmesg, isKilled, reducedMotion } from './util.ts';

export interface PaletteDeps {
  t: PaletteStrings & { hint: string };
  repo: string;
  roster: readonly string[];
  loadGenerator: () => Promise<void>;
}

export function createPalette(dialog: HTMLDialogElement, deps: PaletteDeps) {
  const out = dialog.querySelector<HTMLElement>('[data-pal-out]')!;
  const form = dialog.querySelector<HTMLFormElement>('[data-pal-form]')!;
  const input = dialog.querySelector<HTMLInputElement>('[data-pal-in]')!;
  const history: string[] = [];
  let at = 0;
  let opener: Element | null = null;

  const line = (text: string, cls = '') => {
    const p = document.createElement('p');
    p.className = `pal__l ${cls}`;
    p.textContent = text;
    out.append(p);
    while (out.children.length > 80) out.firstElementChild?.remove();
    out.scrollTop = out.scrollHeight;
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const heading = el?.querySelector<HTMLElement>('h2, h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  };

  const act = async (a: PaletteAction) => {
    switch (a.kind) {
      case 'clear':
        out.replaceChildren();
        return;
      case 'exit':
        dialog.close();
        return;
      case 'kill':
        setKilled(true);
        return;
      case 'resume':
        setKilled(false);
        return;
      case 'open':
        window.open(a.url, '_blank', 'noopener');
        return;
      case 'lang':
        location.href = a.lang === 'it' ? '/it/' : '/';
        return;
      case 'goto':
        dialog.close();
        scrollTo(a.target);
        return;
      case 'download': {
        dialog.close();
        const sec = document.getElementById('download');
        sec?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
        document.querySelector<HTMLElement>('[data-dl-main-key]')?.focus({ preventScroll: true });
        return;
      }
      case 'invaders':
        dialog.close();
        document.querySelector<HTMLButtonElement>('[data-arcade-open]')?.click();
        return;
      case 'summon': {
        await deps.loadGenerator();
        const gen = document.querySelector<HTMLInputElement>('[data-gen-input]');
        dialog.close();
        if (gen) {
          gen.value = a.name;
          gen.dispatchEvent(new Event('input', { bubbles: true }));
          document
            .getElementById('generator')
            ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
          gen.focus({ preventScroll: true });
        }
        dmesg(`palette: summon ${a.name}`);
        return;
      }
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = input.value;
    input.value = '';
    line(`$ ${typed}`, 'pal__l--in');
    if (typed.trim()) {
      history.push(typed);
      at = history.length;
    }
    const res = runCommand(typed, deps.t, {
      killed: isKilled(),
      repo: deps.repo,
      roster: deps.roster,
    });
    for (const l of res.out) line(l, res.error ? 'pal__l--err' : '');
    if (res.action) void act(res.action);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const options = complete(input.value);
      if (options.length === 1) input.value = `${options[0]} `;
      else if (options.length > 1) line(options.join('  '), 'pal__l--dim');
      if (options.length || input.value) e.preventDefault();
    } else if (e.key === 'ArrowUp' && history.length) {
      at = Math.max(0, at - 1);
      input.value = history[at] ?? '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && history.length) {
      at = Math.min(history.length, at + 1);
      input.value = history[at] ?? '';
      e.preventDefault();
    } else if (e.key === 'l' && e.ctrlKey) {
      out.replaceChildren();
      e.preventDefault();
    }
  });

  dialog.querySelector('[data-pal-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
  });

  let greeted = false;
  return {
    open(from: Element | null) {
      if (dialog.open) return;
      opener = from;
      dialog.showModal();
      if (!greeted) {
        greeted = true;
        line(deps.t.hint, 'pal__l--dim');
        dmesg('palette: opened');
      }
      input.focus();
    },
  };
}
