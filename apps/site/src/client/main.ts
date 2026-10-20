/*
 * The live parts of the page. Everything is progressive: without this script the page is
 * complete and readable (prerendered monsters, plain links). Heavy parts load on demand: the
 * generator (it needs the monster kit) when it comes near the viewport, the arcade on its key.
 */
import type { Sprite } from '../lib/sprites.ts';
import type { Strings } from '../i18n/strings.ts';
import { initBoot } from './boot.ts';
import { initDownloads } from './download.ts';
import { initHero } from './hero.ts';
import { initKill } from './kill.ts';
import { initManifesto } from './manifesto.ts';
import { initStars } from './stars.ts';
import { initTerminal } from './terminal.ts';
import { initEgg } from './egg.ts';
import { initLogPane } from './logpane.ts';
import { initVault } from './vault.ts';
import { initWins } from './wins.ts';
import { dmesg, onVisible, reducedMotion } from './util.ts';

export interface ClientData {
  lang: 'en' | 'it';
  stars: number | null;
  repo: string;
  roster: string[];
  titan: Sprite;
  timelines: Record<string, readonly (readonly [number, number])[]>;
  invaders: Sprite[];
  t: {
    generator: Strings['generator'];
    invaders: Strings['invaders'];
    kill: { pull: string; release: string };
    downloadFor: string;
    os: Record<'linux' | 'mac' | 'windows', string>;
    starsLabel: string;
    palette: Strings['palette'];
    win: { min: string; max: string };
  };
}

function readData(): ClientData | null {
  try {
    const el = document.getElementById('site-data');
    return el?.textContent ? (JSON.parse(el.textContent) as ClientData) : null;
  } catch {
    return null;
  }
}

const data = readData();

initBoot();
initKill();
initStars(data);
initDownloads(data);
initManifesto();
initTerminal();
if (data) initHero(data.titan, data.timelines);
if (data) initEgg(data);
initWins();
initLogPane();
initVault();
dmesg(
  `page: lang=${data?.lang ?? '?'} dpr=${window.devicePixelRatio || 1} motion=${reducedMotion() ? 'reduced' : 'full'}`,
);

// Section headings power on when they scroll in (a 6-frame flicker), once.
const powered = document.querySelectorAll<HTMLElement>('.power');
if (reducedMotion() || !('IntersectionObserver' in window)) {
  powered.forEach((el) => el.classList.add('on'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add('on');
          io.unobserve(e.target);
        }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  powered.forEach((el) => io.observe(el));
}

// Copy keys.
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const src = btn.parentElement?.querySelector('[data-copy-src]')?.textContent ?? '';
    const label = btn.textContent ?? '';
    void navigator.clipboard?.writeText(src.trim()).then(
      () => {
        btn.textContent = btn.dataset['copied'] ?? label;
        setTimeout(() => (btn.textContent = label), 1600);
      },
      () => undefined,
    );
  });
});

// The generator: the kit is loaded the first time the section gets close (or on `summon`).
const gen = document.querySelector<HTMLElement>('[data-gen]');
let genReady: Promise<void> | null = null;
const loadGenerator = (): Promise<void> => {
  if (!gen || !data) return Promise.resolve();
  genReady ??= import('./generator.ts').then((m) => {
    m.initGenerator(gen, data.t.generator);
    dmesg('generator: monster kit loaded');
  });
  return genReady;
};
if (gen && data) {
  const wanted = new URLSearchParams(location.search).has('name');
  if (wanted) void loadGenerator();
  else onVisible(gen, () => void loadGenerator(), '600px');
}

// The command palette: `/` or Ctrl+K (Cmd+K) outside a text field, or the key in the bar.
const pal = document.querySelector<HTMLDialogElement>('[data-palette]');
if (pal && data) {
  let palette: { open(from: Element | null): void } | null = null;
  const open = async (from: Element | null) => {
    if (!palette) {
      const m = await import('./palette.ts');
      palette = m.createPalette(pal, {
        t: data.t.palette,
        repo: data.repo,
        roster: data.roster,
        loadGenerator,
      });
    }
    palette.open(from);
  };
  document
    .querySelectorAll('[data-pal-open]')
    .forEach((b) => b.addEventListener('click', () => void open(b)));
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    const typing =
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const ctrlK = e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey);
    const slash = e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!ctrlK && !slash) return;
    if (pal.open || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    void open(document.activeElement);
  });
}
