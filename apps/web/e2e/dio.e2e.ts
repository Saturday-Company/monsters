import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The god's bar (docs/design.md, "La barra del Dio", D-101): at the head of
 * the sidebar, the colours of every monster run on a black screen, faster
 * when they work, still when stopped or with "Riduci movimento"; the god's
 * name and its line; a press opens its chat. `DIO_SHOTS=<dir>` writes the
 * screenshots of the states, desktop and phone, light and dark.
 */

const SHOTS = process.env['DIO_SHOTS'];

/** What the canvas shows now. */
const frame = (page: Page) =>
  page.getByTestId('god-marquee').evaluate((c) => (c as HTMLCanvasElement).toDataURL());

/** Lit dots on the canvas, and how many different colours they have. */
const lights = (page: Page) =>
  page.getByTestId('god-marquee').evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    const hues = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (a < 200 || Math.max(r, g, b) < 90) continue;
      lit++;
      hues.add(`${r >> 5},${g >> 5},${b >> 5}`);
    }
    return { lit, colours: hues.size };
  });

async function stop(page: Page) {
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('halt-banner')).toBeVisible();
}

test('the bar heads the sidebar: the god, what it does, the colours of the team running', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/note');
  const bar = page.getByTestId('god-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('god-name')).toHaveText('Titan');
  await expect(page.getByTestId('god-line')).toHaveText('Aspetta una tua risposta');

  // Above the search and the squad.
  const barBox = (await bar.boundingBox())!;
  const searchBox = (await page.getByTestId('search-key').boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(searchBox.y);
  // A black screen in both themes.
  const bg = () => bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const light = await bg();
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(['rgb(13, 13, 12)', 'rgb(5, 5, 5)']).toContain(light);
  expect(['rgb(13, 13, 12)', 'rgb(5, 5, 5)']).toContain(await bg());

  // The demo has monsters at work: the colours run, by steps.
  await expect(bar).toHaveAttribute('data-state', 'working');
  await expect(bar).toHaveAttribute('data-motion', 'running');
  expect(Number(await bar.getAttribute('data-speed'))).toBeGreaterThan(2);
  const lit = await lights(page);
  expect(lit.lit).toBeGreaterThan(100);
  expect(lit.colours).toBeGreaterThanOrEqual(5);
  const a = await frame(page);
  await expect.poll(() => frame(page), { timeout: 3000 }).not.toBe(a);

  // A hidden tab draws nothing; back on screen, it runs again.
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (h ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  const hidden = await frame(page);
  await page.waitForTimeout(600);
  expect(await frame(page)).toBe(hidden);
  await setHidden(false);
  await expect.poll(() => frame(page), { timeout: 3000 }).not.toBe(hidden);

  // A press opens the god's chat.
  await bar.click();
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
  await expect(page.getByTestId('chat-monitor')).toContainText('Titan');
});

test('stopped: the colours stand still and dim, the bar says it; after Riprendi they drift', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  const bar = page.getByTestId('god-bar');
  await expect(bar).toHaveAttribute('data-state', 'working');
  await stop(page);
  await expect(bar).toHaveAttribute('data-state', 'halted');
  await expect(bar).toHaveAttribute('data-motion', 'still');
  await expect(page.getByTestId('god-label')).toHaveText('Fermi');
  await expect(page.getByTestId('god-line')).toHaveText('I mostri sono fermi');
  const a = await frame(page);
  await page.waitForTimeout(600);
  expect(await frame(page)).toBe(a);

  await page.getByTestId('resume').click();
  await expect(bar).toHaveAttribute('data-state', 'idle');
  await expect(bar).toHaveAttribute('data-speed', '1.5');
  // The demo has the Squadra personale and the project "Social di Saturday" (D-100).
  await expect(page.getByTestId('god-line')).toHaveText('A capo di tutte le squadre');
  await expect(page.getByTestId('god-label')).toHaveText('8 con Titan');
});

test('Riduci movimento: a still arrangement of every colour, no steps', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mock=demo');
  const bar = page.getByTestId('god-bar');
  await expect(bar).toHaveAttribute('data-state', 'working');
  await expect(bar).toHaveAttribute('data-motion', 'still');
  await expect(bar).toHaveAttribute('data-speed', '0');
  const lit = await lights(page);
  expect(lit.colours).toBeGreaterThanOrEqual(5);
  const a = await frame(page);
  await page.waitForTimeout(700);
  expect(await frame(page)).toBe(a);
  // Nothing of the bar loops in CSS either (the monster rests on its first frame).
  const loops = await bar.evaluate((el) =>
    el
      .getAnimations({ subtree: true })
      .filter(
        (x) => x.playState === 'running' && x.effect?.getComputedTiming().iterations === Infinity,
      )
      .map((x) => (x as CSSAnimation).animationName),
  );
  expect(loops).toEqual([]);
});

test('phone: the bar is the head of the home, no horizontal scroll, it opens the chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?mock=demo');
  const bar = page.getByTestId('god-bar');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The canvas follows the width of the screen.
  const canvas = await page
    .getByTestId('god-marquee')
    .evaluate((c) => c.getBoundingClientRect().width);
  expect(canvas).toBeGreaterThan(box.width - 40);
  await bar.click();
  await expect(page.getByTestId('chat-monitor')).toContainText('Titan');
});

test('screenshots of the god bar', async ({ page }) => {
  test.skip(!SHOTS, 'DIO_SHOTS=<dir> writes them');
  const shoot = async (name: string, el = false) => {
    await page.waitForTimeout(400);
    if (el) await page.getByTestId('god-bar').screenshot({ path: `${SHOTS}/${name}.png` });
    else await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=demo&squadra=7');
    await expect(page.getByTestId('god-bar')).toHaveAttribute('data-state', 'working');
    await shoot(`desktop-${theme}-lavoro`);
    await shoot(`barra-${theme}-lavoro`, true);
    await stop(page);
    await shoot(`desktop-${theme}-fermi`);
    await page.getByTestId('resume').click();
    await expect(page.getByTestId('god-bar')).toHaveAttribute('data-state', 'idle');
    await shoot(`desktop-${theme}-riposo`);
    await shoot(`barra-${theme}-riposo`, true);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('god-bar')).toHaveAttribute('data-state', 'working');
  await shoot('telefono-dark-lavoro');
  await stop(page);
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('god-bar')).toHaveAttribute('data-state', 'idle');
  await shoot('telefono-dark-riposo');
});
