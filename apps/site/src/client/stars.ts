/*
 * The live star count: the build's value is already on the page; the browser asks the GitHub API
 * (anonymous, cached for an hour) and updates the LED and the big number. Any failure keeps
 * what is there.
 */
import {
  formatStars,
  formatStarsLong,
  readStarCache,
  starsFromRepo,
  writeStarCache,
} from '../lib/stars.ts';
import type { ClientData } from './main.ts';
import { safeStorage } from './util.ts';

const API = 'https://api.github.com/repos/Saturday-Company/monsters';

function show(count: number, data: ClientData | null): void {
  document.querySelectorAll('[data-stars]').forEach((el) => (el.textContent = formatStars(count)));
  document.querySelectorAll<HTMLElement>('[data-stars-big]').forEach((el) => {
    el.textContent = formatStarsLong(count, el.dataset['locale'] ?? 'en');
    el.classList.remove('oss__stars--none');
  });
  document.querySelectorAll<HTMLElement>('[data-stars-soon]').forEach((el) => (el.hidden = true));
  if (data)
    document
      .querySelectorAll('[data-stars-sr]')
      .forEach(
        (el) => (el.textContent = `, ${data.t.starsLabel.replace(/^[^:]*:\s*/, '')} ${count}`),
      );
}

export function initStars(data: ClientData | null): void {
  // No count at build time means the repository was not public then: asking now would only
  // log a 404 in the console. The next build (after it opens) turns the live counter on.
  if (!data || data.stars === null) return;
  const storage = safeStorage();
  const now = Date.now();
  const cached = readStarCache(storage, now);
  if (cached) {
    show(cached.count, data);
    return;
  }
  // Ask when the browser is idle: the counter never competes with the first paint.
  const ask = () => {
    fetch(API, { headers: { accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        const count = starsFromRepo(body);
        if (count === null) return;
        writeStarCache(storage, count, Date.now());
        show(count, data);
      })
      .catch(() => undefined);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(ask, { timeout: 4000 });
  else setTimeout(ask, 1500);
}
