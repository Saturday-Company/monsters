/*
 * The menu of the bar on small screens: a button that opens the links the bar has no room for.
 * aria-expanded follows the panel, Escape closes it and gives the focus back to the button, and
 * so do a click outside, a click on a link and a window wide enough to show the links again.
 */

export function initMenu(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const panel = document.querySelector<HTMLElement>('[data-menu]');
  if (!button || !panel) return;

  const set = (open: boolean, focus: 'button' | 'first' | null = null): void => {
    panel.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    if (focus === 'button') button.focus();
    // The first link that is shown: on a wide screen Download stays in the bar and is hidden here.
    if (focus === 'first')
      [...panel.querySelectorAll<HTMLElement>('a')]
        .find((a) => a.getClientRects().length > 0)
        ?.focus();
  };
  const isOpen = (): boolean => panel.classList.contains('is-open');

  // `detail` is 0 for a key press: send the keyboard to the first link, as a menu should.
  button.addEventListener('click', (e) =>
    set(!isOpen(), !isOpen() && e.detail === 0 ? 'first' : null),
  );
  panel.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      set(false, 'button');
    }
  });
  document.addEventListener('click', (e) => {
    if (isOpen() && !(e.target as Element).closest('.bar')) set(false);
  });
  // Leaving the panel with Tab closes it: the focus must not sit behind a hidden panel.
  panel.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (isOpen() && next && !panel.contains(next) && next !== button) set(false);
  });
  matchMedia('(min-width: 1321px)').addEventListener('change', (e) => {
    if (e.matches) set(false);
  });
}
