import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, SHOT_LANG, test } from './fixtures.ts';

/* "Novità": the key beside "Da rivedere", the sheet with the changelog, the light for what is new. */

const SEEN = 'monsters-news-seen';
const OUT = fileURLToPath(new URL('../../../docs/schermate/', import.meta.url));

async function seed(page: Page, value: string | null) {
  await page.addInitScript(
    ({ key, v }) => {
      if (v === null) return;
      if (!window.sessionStorage.getItem('__seeded')) {
        window.localStorage.setItem(key, v);
        window.sessionStorage.setItem('__seeded', '1');
      }
    },
    { key: SEEN, v: value },
  );
}

test('first run: no light, and the version in use is stored', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('news-toggle')).toBeVisible();
  await expect(page.getByTestId('news-led')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((k) => window.localStorage.getItem(k), SEEN))
    .toMatch(/^\d+\.\d+\.\d+/);
});

test('an older version seen: the light is on; opening the sheet turns it off', async ({ page }) => {
  await seed(page, '0.0.1');
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('news-led')).toBeVisible();
  await page.getByTestId('news-toggle').click();
  const sheet = page.getByTestId('news-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'What’s new', level: 2 })).toBeVisible();
  await expect(page.getByTestId('news-using')).toContainText('You’re using ');
  const current = sheet.locator('[data-current]');
  await expect(current).toHaveCount(1);
  await expect(current.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('news-led')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('older versions are collapsed and open on click', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.getByTestId('news-toggle').click();
  const versions = page.getByTestId('news-version');
  test.skip((await versions.count()) < 2, 'the changelog has one version');
  const older = versions.nth(1).getByRole('button').first();
  await expect(older).toHaveAttribute('aria-expanded', 'false');
  await older.click();
  await expect(older).toHaveAttribute('aria-expanded', 'true');
});

test('the palette opens Novità', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await page.getByTestId('composer-input').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('What’s new');
  await page.getByTestId('palette-item').first().click();
  await expect(page.getByTestId('news-sheet')).toBeVisible();
});

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`screenshot ${size.name} ${theme}`, () => {
      test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write the screenshots');
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      test('Novità', async ({ page }) => {
        await seed(page, '0.0.1');
        await page.goto('/?mock=demo#/?chat=titan');
        await expect(page.getByTestId('news-led')).toBeVisible();
        await page.screenshot({
          path: `${OUT}novita-chiave-${theme}-${size.name}-${SHOT_LANG}.png`,
          animations: 'disabled',
        });
        await page.getByTestId('news-toggle').click();
        await expect(page.getByTestId('news-sheet')).toBeVisible();
        await page.screenshot({
          path: `${OUT}novita-${theme}-${size.name}-${SHOT_LANG}.png`,
          animations: 'disabled',
        });
      });
    });
  }
}
