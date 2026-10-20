/* The easter egg: the Konami code, the backtick or the "Insert coin" key open the arcade. */
import { KONAMI, sequenceMatcher } from '../lib/stamp.ts';
import type { ClientData } from './main.ts';

export function initEgg(data: ClientData): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-arcade]');
  if (!dialog) return;
  let game: { start(): void; stop(): void } | null = null;
  const open = async () => {
    if (dialog.open) return;
    const { createInvaders } = await import('./invaders.ts');
    game ??= createInvaders(dialog, data);
    dialog.showModal();
    game.start();
  };
  dialog.addEventListener('close', () => game?.stop());
  dialog.querySelector('[data-arcade-close]')?.addEventListener('click', () => dialog.close());
  document.querySelector('[data-arcade-open]')?.addEventListener('click', () => void open());

  const konami = sequenceMatcher(KONAMI);
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (konami(e.key) || (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
      e.preventDefault();
      void open();
    }
  });
}
