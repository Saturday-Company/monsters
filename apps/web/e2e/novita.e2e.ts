import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, SHOT_LANG, test } from './fixtures.ts';

/*
 * "News" (the Inbox's second tab since wave I): the changelog, the light on the Inbox key for what
 * is new, the palette's "What's new".
 */

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

/** Opens the Inbox on its "News" tab with the key and the tab. */
async function openNews(page: Page) {
  await page.getByTestId('review-toggle').click();
  await page.getByRole('tab', { name: 'News' }).click();
  await expect(page.getByTestId('news-panel')).toBeVisible();
}

test('first run: no light, and the version in use is stored', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('review-toggle')).toBeVisible();
  await expect(page.getByTestId('news-led')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((k) => window.localStorage.getItem(k), SEEN))
    .toMatch(/^\d+\.\d+\.\d+/);
});

test('an older version seen: the light is on; opening the News tab turns it off', async ({
  page,
}) => {
  await seed(page, '0.0.1');
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('news-led')).toBeVisible();
  await openNews(page);
  const sheet = page.getByTestId('activity-panel');
  await expect(sheet.getByRole('heading', { name: 'Inbox', level: 2 })).toBeVisible();
  await expect(page.getByTestId('news-using')).toContainText('You’re using ');
  const current = sheet.locator('[data-current]');
  await expect(current).toHaveCount(1);
  await expect(current.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('news-led')).toHaveCount(0);
  await expect(page.getByTestId('news-tab-led')).toHaveCount(0);
});

test('older versions are collapsed and open on click', async ({ page }) => {
  await page.goto('/?mock=demo');
  await openNews(page);
  const versions = page.getByTestId('news-version');
  test.skip((await versions.count()) < 2, 'the changelog has one version');
  const older = versions.nth(1).getByRole('button').first();
  await expect(older).toHaveAttribute('aria-expanded', 'false');
  await older.click();
  await expect(older).toHaveAttribute('aria-expanded', 'true');
});

test('the palette opens What’s new, on the News tab of the Inbox', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await page.getByTestId('composer-input').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('What’s new');
  await page.getByTestId('palette-item').first().click();
  await expect(page.getByTestId('news-panel')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');
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
      test('News', async ({ page }) => {
        await seed(page, '0.0.1');
        await page.goto('/?mock=demo#/?chat=titan');
        await expect(page.getByTestId('news-led')).toBeVisible();
        await page.screenshot({
          path: `${OUT}novita-chiave-${theme}-${size.name}-${SHOT_LANG}.png`,
          animations: 'disabled',
        });
        await openNews(page);
        await page.screenshot({
          path: `${OUT}novita-${theme}-${size.name}-${SHOT_LANG}.png`,
          animations: 'disabled',
        });
      });
    });
  }
}
