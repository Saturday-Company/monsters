import { appendFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test } from './fixtures.ts';

/*
 * Visual check of the instinct's UI (D-068): `SCREENSHOTS=1 SCREENSHOTS_DIR=…`
 * writes the Istinto module, the pagella, the receipt, the lines of the
 * instinct in Attività and in the chat, the confused monster and the brake's
 * card, in light and dark, at 1440 and 390 px. `FPS=1` measures the frames
 * per second with `?mock=demo&vita=1` on the chat with the receipt and on the
 * confused monster.
 */

const OUT = `${(process.env['SCREENSHOTS_DIR'] ?? '/tmp/istinto-ui').replace(/\/$/, '')}/`;
const shots = !!process.env['SCREENSHOTS'];
const fps = !!process.env['FPS'];

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

/**
 * Scrolls the nearest scrolling box (the settings panel, the chat, the tape)
 * so that `el` sits where asked: `scrollIntoView` would also move the window
 * frame, which never scrolls in the app.
 */
const scrollTo = (
  locator: ReturnType<Page['locator']>,
  where: 'start' | 'center' | 'end' = 'start',
) =>
  locator.first().evaluate((el, at) => {
    let box = el.parentElement;
    while (box) {
      const o = getComputedStyle(box).overflowY;
      if ((o === 'auto' || o === 'scroll') && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    if (!box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const top = r.top - b.top + box.scrollTop;
    box.scrollTop =
      at === 'start'
        ? top - 16
        : at === 'end'
          ? top + r.height - box.clientHeight + 120
          : top + r.height / 2 - box.clientHeight / 2;
  }, where);
const into = (page: Page, testId: string) => scrollTo(page.getByTestId(testId));

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name} ${theme}`, () => {
      test.skip(!shots, 'set SCREENSHOTS=1 to write the screenshots');
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const shot = (page: Page, what: string) =>
        page.screenshot({
          path: `${OUT}${what}-${theme}-${size.name}.png`,
          animations: 'disabled',
        });

      test('settings: istinto and pagella', async ({ page }) => {
        // The decisions and the scorecard are in Advanced: the link opens it.
        await page.goto('/?mock=demo#/impostazioni?sezione=istinto');
        await page.getByTestId('instinct-section').waitFor();
        await into(page, 'instinct-section');
        await page.waitForTimeout(200);
        await shot(page, '01-istinto');
        await page
          .getByTestId('instinct-uses')
          .getByRole('button', { name: /Choose one by one/ })
          .click();
        await page.waitForTimeout(150);
        await into(page, 'instinct-uses');
        await shot(page, '02-istinto-cosa-fa');
        await page
          .getByTestId('instinct-uses')
          .getByRole('button', { name: /Choose one by one/ })
          .click();
        await page.getByRole('radio', { name: 'Smarter' }).click();
        await page.getByTestId('no-key').waitFor();
        await into(page, 'instinct-section');
        await page.waitForTimeout(150);
        await shot(page, '03-istinto-senza-chiave');
        await page.getByTestId('instinct-privacy').locator('summary').click();
        await into(page, 'instinct-privacy');
        await page.waitForTimeout(150);
        await shot(page, '04-istinto-cosa-esce');
        await into(page, 'scorecard');
        await page.waitForTimeout(150);
        await shot(page, '05-pagella');
      });

      test('chat: receipt, undo, lines of the instinct', async ({ page }) => {
        await page.goto('/?mock=demo#/?chat=titan');
        await page.getByTestId('receipt').first().waitFor();
        await scrollTo(page.getByTestId('receipt'), 'end');
        await page.waitForTimeout(250);
        await shot(page, '06-ricevuta');
        await scrollTo(page.getByTestId('receipt'), 'start');
        await page.waitForTimeout(150);
        await shot(page, '07-ricevuta-inizio');
        await page.getByTestId('receipt-undo').click();
        await scrollTo(page.getByTestId('receipt-undo'), 'center');
        await page.waitForTimeout(100);
        await shot(page, '08-ricevuta-di-nuovo');
        await page.getByTestId('receipt-undo').click();
        await page.getByTestId('receipt-undone').waitFor();
        await scrollTo(page.getByTestId('receipt-undone'), 'center');
        await page.waitForTimeout(150);
        await shot(page, '09-ricevuta-annullata');
      });

      test('confused monster, terminal, attività, brake', async ({ page }) => {
        await page.goto('/?mock=demo#/?chat=enceladus');
        await page.getByTestId('monitor-confused').waitFor();
        await page.waitForTimeout(200);
        await shot(page, '10-mostro-confuso');
        await page.goto('/?mock=demo#/?chat=rhea');
        await page.getByRole('button', { name: 'Behind the scenes of Rhea' }).first().click();
        await page.getByTestId('agent-terminal').waitFor();
        await page.waitForTimeout(300);
        await scrollTo(
          page.getByTestId('agent-terminal').locator('li', { hasText: 'I removed' }),
          'center',
        );
        await page.waitForTimeout(150);
        await shot(page, '11-dietro-le-quinte');
        await page.keyboard.press('Escape');

        await page.goto('/?mock=demo#/log');
        await page.getByTestId('event-row').first().waitFor();
        await scrollTo(page.getByTestId('event-row').filter({ hasText: 'I removed' }), 'center');
        await page.waitForTimeout(150);
        await shot(page, '12-attivita-importanti');
        await page.getByRole('radio', { name: 'Everything' }).click();
        await scrollTo(
          page.getByTestId('event-row').filter({ hasText: 'Dione will handle it' }),
          'center',
        );
        await page.waitForTimeout(150);
        await shot(page, '13-attivita-tutto');

        await page.goto('/?mock=demo&mockSpeed=0.2#/?chat=dione');
        const composer = page.getByRole('combobox', { name: 'Message' });
        await composer.fill('Publish the first post on Instagram');
        await composer.press('Enter');
        const card = page.getByTestId('question-card').filter({ hasText: 'Go ahead?' });
        await card.waitFor();
        await scrollTo(card, 'center');
        await page.waitForTimeout(250);
        await shot(page, '14-freno-domanda');
      });
    });
  }
}

test.describe('fps', () => {
  test.skip(!fps, 'set FPS=1 to measure the frames per second');
  test.use({ viewport: { width: 1440, height: 900 } });

  const measure = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = (now: number) => {
            frames++;
            if (now - start < 5000) requestAnimationFrame(tick);
            else resolve((frames * 1000) / (now - start));
          };
          requestAnimationFrame(tick);
        }),
    );

  for (const [what, hash] of [
    ['chat with the receipt', '#/?chat=titan'],
    ['confused monster', '#/?chat=enceladus'],
  ] as const) {
    test(what, async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto(`/?mock=demo&vita=1${hash}`);
      await page.getByTestId('chat-panel').waitFor();
      if (hash.endsWith('titan')) {
        await scrollTo(page.getByTestId('receipt'), 'center');
      }
      await page.waitForTimeout(1500);
      const value = await measure(page);
      appendFileSync(`${OUT}fps.txt`, `${what}: ${value.toFixed(1)} fps\n`);
    });
  }
});
