import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The grammar of motion (docs/design.md, "Movimento", D-084): everything moves
 * by frames (`steps()`), only what waits for the user blinks, rows light up
 * under the pointer and never move, "Riduci movimento" leaves state changes.
 */

test.use({ viewport: { width: 1440, height: 900 } });

/** Every CSS animation and transition running now: name, timing, iterations. */
const running = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().map((a) => {
      const timing = a.effect?.getComputedTiming();
      const keyframes = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
      return {
        name:
          a instanceof CSSAnimation
            ? a.animationName
            : a instanceof CSSTransition
              ? `transition:${a.transitionProperty}`
              : 'script',
        easing: keyframes.map((k) => k.easing ?? 'linear').join(' '),
        infinite: timing?.iterations === Infinity,
        state: a.playState,
      };
    }),
  );

/** Allowed to loop: the attention light, the meters, the monsters' frames, the carets. */
const LOOPS = /^(led-blink|meter-[234]|caret-blink|dk-[a-z-]+\d*-\d+)$/;

test('everything that moves moves by frames; only lights, meters, monsters and carets loop', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  // Open and switch the pane on the right, so its movements are running too.
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByTestId('right-dock')).toBeVisible();
  await page.getByTestId('right-dock').getByTestId('dock-tab-usage').click();
  const all = await running(page);
  expect(all.length).toBeGreaterThan(0);
  for (const a of all) {
    if (a.name === 'script') continue;
    // A keyframe with no easing of its own is linear: the frames are in the keyframes (dk-*).
    expect(a.easing, a.name).toMatch(/^((steps\(\d+(, ?[a-z-]+)?\)|linear)\s?)+$/);
    if (a.infinite) expect(a.name).toMatch(LOOPS);
  }
});

test('a key sinks 2 px in two frames when pressed and is up at once when released', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=dione');
  await page.locator('#composer-input').fill('Ciao');
  const key = page.getByTestId('composer').getByRole('button', { name: 'Invia' });
  await expect(key).toBeEnabled();
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const up = await key.evaluate((el) => getComputedStyle(el).transitionDuration);
  // At rest nothing is set to travel: the release is instant.
  expect(up).toBe('0s');
  await page.mouse.down();
  const down = await key.evaluate((el) => {
    const s = getComputedStyle(el);
    return { d: s.transitionDuration, f: s.transitionTimingFunction };
  });
  expect(down.d).toMatch(/0\.08s/);
  expect(down.f).toMatch(/steps\(2/);
  await expect
    .poll(() => key.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42))
    .toBe(2);
  await page.mouse.up();
  expect(await key.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBe(0);
});

test('under the pointer a row takes the next tone of its surface; a bubble does not react', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const panel = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
  );
  const bg = (el: Element) => getComputedStyle(el).backgroundColor;
  const toRgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const row = page.getByTestId('chat-row').filter({ hasText: 'Dione' });
  expect(await row.evaluate(bg)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect.poll(() => row.evaluate(bg)).toBe(toRgb(panel));
  // Rows never move: no transform under the pointer.
  expect(await row.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  const bubble = page.getByTestId('agent-bubble').first();
  const before = await bubble.evaluate(bg);
  await bubble.hover();
  expect(await bubble.evaluate(bg)).toBe(before);
  expect(await bubble.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
});

test('the light of Ferma stays steady while monsters work and blinks only when armed', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  const kill = page.getByTestId('kill');
  await expect(kill).toHaveAttribute('data-working', 'true');
  const light = kill.getByTestId('kill-light');
  expect(await light.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await kill.click();
  await expect
    .poll(() => light.evaluate((el) => getComputedStyle(el).animationName))
    .toBe('led-blink');
});

test('"Riduci movimento": nothing travels, the states change at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByTestId('right-dock')).toBeVisible();
  await page.getByTestId('right-dock').getByTestId('dock-tab-terminal').click();
  await page.getByTestId('chat-row').filter({ hasText: 'Dione' }).hover();
  // A key still goes down when pressed, without travelling.
  const key = page.getByTestId('behind-the-scenes');
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(await key.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.mouse.up();
  // A frame later nothing is running: no loop, no tween, no frames of the monsters.
  await page.waitForTimeout(50);
  const left = (await running(page)).filter((a) => a.state === 'running');
  expect(left).toEqual([]);
});

test.describe('touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('no hover-only affordance: the keys of a file tile are always there', async ({ page }) => {
    await page.goto('/?mock=demo#/file');
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    const tile = page.getByTestId('file-tile').first();
    await expect(tile).toBeVisible();
    const keys = tile.getByRole('link', { name: /^Scarica/ });
    expect(await keys.evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe('1');
  });
});
