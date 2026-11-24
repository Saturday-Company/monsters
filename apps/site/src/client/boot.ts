/*
 * The BIOS screen: CSS runs it (about 0.7 s, see global.css), this only lets a key or a click skip it
 * and cleans up. The inline script of the layout decides whether it shows at all.
 */

export function initBoot(): void {
  const html = document.documentElement;
  if (!html.classList.contains('booting')) return;
  const boot = document.getElementById('boot');
  const done = () => {
    html.classList.remove('booting');
    window.removeEventListener('keydown', done, true);
    boot?.removeEventListener('pointerdown', done);
  };
  window.addEventListener('keydown', done, true);
  boot?.addEventListener('pointerdown', done);
  boot?.addEventListener('animationend', (e) => {
    if (e.target === boot) done();
  });
  // Belt and braces: never keep the page behind the boot screen.
  setTimeout(done, 900);
}
