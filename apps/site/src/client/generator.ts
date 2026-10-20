/*
 * The live generator: a name in, a monster out (genomeFromName, renderDots: the real kit, loaded
 * on demand), its genome as JSON, `?name=` to share it, the SVG to download. The SVG carries the
 * kit's frame CSS, so it blinks on its own.
 */
import {
  dotCss,
  genomeFromName,
  renderDots,
  type Expression,
  type MonsterGenome,
} from '@monsters/monster-kit';
import type { Strings } from '../i18n/strings.ts';
import { genomeJsonHtml } from '../lib/genome-json.ts';
import { bytesOf, crc32, xxd } from '../lib/hexdump.ts';
import { toBase64 } from '../lib/manifesto.ts';
import { isKilled, onKill } from './util.ts';

const MOONS = [
  'Phoebe',
  'Iapetus',
  'Janus',
  'Epimetheus',
  'Pandora',
  'Prometheus',
  'Atlas',
  'Pan',
  'Daphnis',
  'Helene',
  'Calypso',
  'Telesto',
  'Methone',
  'Pallene',
  'Ymir',
  'Kiviuq',
  'Siarnaq',
  'Tarvos',
  'Ijiraq',
  'Paaliaq',
];

export function initGenerator(root: HTMLElement, t: Strings['generator']): void {
  const input = root.querySelector<HTMLInputElement>('[data-gen-input]');
  const out = root.querySelector<HTMLElement>('[data-gen-out]');
  const json = root.querySelector<HTMLElement>('[data-gen-json]');
  const seed = root.querySelector('[data-gen-seed]');
  const label = root.querySelector('[data-gen-label]');
  const toast = root.querySelector('[data-gen-toast]');
  const hexOut = root.querySelector('[data-gen-hex]');
  const b64Out = root.querySelector('[data-gen-b64]');
  const crcOut = root.querySelector('[data-gen-crc]');
  const sizeOut = root.querySelector('[data-gen-bytes]');
  const title = root.querySelector('#genome .win__title');
  const exprKeys = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-expr]'));
  if (!input || !out || !json) return;

  let expression: Expression = 'idle';
  let genome: MonsterGenome = genomeFromName(input.value || t.defaultName);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const say = (msg: string) => {
    if (!toast) return;
    toast.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.textContent = ''), 2200);
  };

  const name = () => input.value.trim() || t.defaultName;

  const render = () => {
    const shown: Expression = isKilled() ? 'sleep' : expression;
    out.innerHTML = renderDots(genome, { expression: shown, size: 420, idPrefix: 'gen' });
    out.setAttribute('aria-label', t.alt.replace('{name}', name()));
    json.innerHTML = genomeJsonHtml(genome);
    const text = JSON.stringify(genome, null, 2);
    const bytes = bytesOf(text);
    if (hexOut) hexOut.textContent = xxd(bytes).join('\n');
    if (b64Out) b64Out.textContent = toBase64(text);
    if (crcOut) crcOut.textContent = crc32(bytes);
    if (sizeOut) sizeOut.textContent = String(bytes.length);
    if (title) title.textContent = `${genome.id}/${t.genome}`;
    if (seed) seed.textContent = `seed ${genome.seed}`;
    if (label) label.textContent = name().toUpperCase().slice(0, 18);
  };

  const fromName = (push = true) => {
    genome = genomeFromName(name());
    render();
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('name', name());
      history.replaceState(null, '', url);
    }
  };

  input.addEventListener('input', () => fromName());
  root.querySelector('[data-gen-form]')?.addEventListener('submit', (e) => e.preventDefault());

  for (const key of exprKeys) {
    key.addEventListener('click', () => {
      expression = (key.dataset['expr'] as Expression | undefined) ?? 'idle';
      exprKeys.forEach((k) => k.setAttribute('aria-pressed', String(k === key)));
      render();
    });
  }

  root.querySelector('[data-gen-random]')?.addEventListener('click', () => {
    const pick = MOONS[Math.floor(Math.random() * MOONS.length)] ?? 'Phoebe';
    const n = `${pick}-${Math.floor(Math.random() * 900 + 100)}`;
    input.value = n;
    fromName();
  });

  root.querySelector('[data-gen-copy]')?.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('name', name());
    url.hash = 'generator';
    void navigator.clipboard?.writeText(url.toString()).then(
      () => say(t.copied),
      () => undefined,
    );
  });

  root.querySelector('[data-gen-svg]')?.addEventListener('click', () => {
    const svg = renderDots(genome, {
      expression,
      size: 340,
      screen: true,
      title: name(),
      idPrefix: 'm',
    }).replace(/(<svg[^>]*>)/, `$1<style>${dotCss}</style>`);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${genome.id}.svg`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  onKill(() => render());

  const wanted = new URLSearchParams(location.search).get('name');
  if (wanted) {
    input.value = wanted.slice(0, 40);
    fromName(false);
  } else render();
}
