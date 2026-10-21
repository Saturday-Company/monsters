import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * Settings → Telegram (M2.6), on the mock core: the token checked before it is
 * saved, an account added with a one-time code (the mock pairs "Giulio" a
 * moment after the code appears), removed, and the quiet night.
 * `TELEGRAM_SHOTS=<dir>` also writes screenshots in light and dark.
 */

async function openTelegram(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const section = page.getByTestId('telegram-settings');
  await expect(section.getByRole('heading', { name: 'Telegram' })).toBeVisible();
  return section;
}

/** The token form opens from "Collega un bot". */
async function openTokenForm(section: Locator) {
  await expect(section.getByLabel('Bot code')).toHaveCount(0);
  await section.getByRole('button', { name: 'Connect a bot' }).click();
}

async function connect(page: Page) {
  const section = await openTelegram(page);
  await openTokenForm(section);
  await section.getByLabel('Bot code').fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
  await section.getByRole('button', { name: 'Connect the bot' }).click();
  await expect(section.getByTestId('telegram-status')).toContainText('@MonstersDemoBot');
  return section;
}

test('settings: connect the bot, pair an account, quiet night, remove', async ({ page }) => {
  const section = await openTelegram(page);
  await expect(section.getByTestId('telegram-status')).toHaveAttribute('data-status', 'off');

  // A malformed token is caught in the page, a refused one by the core.
  await openTokenForm(section);
  const field = section.getByLabel('Bot code');
  await field.fill('ciao');
  await section.getByRole('button', { name: 'Connect the bot' }).click();
  await expect(section.getByRole('alert')).toContainText('doesn’t look like a Telegram token');
  await field.fill('123456789:AAH000000wrongTokenForTheMock_abcdefgh');
  await section.getByRole('button', { name: 'Connect the bot' }).click();
  await expect(section.getByRole('alert')).toContainText('Telegram doesn’t recognise');

  await field.fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
  await section.getByRole('button', { name: 'Connect the bot' }).click();
  await expect(page.getByText('Bot @MonstersDemoBot connected.')).toBeVisible();
  // The token is never shown again.
  await expect(section.getByLabel('Bot code')).toHaveCount(0);

  // Pairing starts by itself: a code to send to the bot, then the account appears.
  const code = section.getByTestId('telegram-pairing-code');
  await expect(code).toHaveText(/^\/start [A-Z2-9]{8}$/);
  await expect(section.getByRole('link', { name: 'Open in Telegram' })).toHaveAttribute(
    'href',
    /^https:\/\/t\.me\/MonstersDemoBot\?start=[A-Z2-9]{8}$/,
  );
  await expect(section.getByText(/Expires in \d+:\d\d/)).toBeVisible();
  // "Mi collego…" first, then the page reads the state again by itself.
  await expect(section.getByTestId('telegram-status')).toHaveAttribute('data-status', 'online');
  await expect(page.getByText('Account connected: Giulio.')).toBeVisible({ timeout: 8000 });
  await expect(section.getByTestId('telegram-pairing')).toHaveCount(0);
  await expect(section.getByTestId('telegram-user')).toHaveCount(1);
  await expect(section.getByTestId('telegram-user')).toContainText('Giulio · @giulio');

  // Quiet night: hours appear when it is on.
  const quiet = section.getByRole('switch', { name: 'Quiet at night' });
  await expect(quiet).toHaveAttribute('aria-checked', 'false');
  await quiet.click();
  await expect(quiet).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByLabel('From', { exact: true })).toHaveValue('22:00');
  await section.getByLabel('until', { exact: true }).fill('07:30');
  await expect(section.getByLabel('until', { exact: true })).toHaveValue('07:30');
  const done = section.getByRole('switch', { name: 'Work finished' });
  await done.click();
  await expect(done).toHaveAttribute('aria-checked', 'false');

  // Remove the account; then the bot.
  await section.getByRole('button', { name: 'Remove Giulio' }).click();
  await expect(section.getByTestId('telegram-user')).toHaveCount(0);
  await section.getByRole('button', { name: 'Disconnect the bot' }).click();
  await section.getByRole('button', { name: 'Yes, disconnect' }).click();
  await expect(section.getByRole('button', { name: 'Connect a bot' })).toBeVisible();

  // Everything is in the log.
  await page.goto('/?mock=demo#/log');
  await expect(
    page.getByText('Giulio can no longer control the monsters from Telegram').first(),
  ).toBeVisible();
});

test('settings: a pairing code can be cancelled', async ({ page }) => {
  const section = await connect(page);
  await section.getByRole('button', { name: 'Connect an account' }).click();
  await expect(section.getByTestId('telegram-pairing-code')).toBeVisible();
  await section.getByRole('button', { name: 'Cancel' }).click();
  await expect(section.getByTestId('telegram-pairing')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Connect an account' })).toBeVisible();
});

const SHOTS = process.env['TELEGRAM_SHOTS'];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`telegram screenshot ${theme}`, () => {
    test.skip(!SHOTS, 'set TELEGRAM_SHOTS=<dir> to write the screenshots');
    test.use({
      colorScheme: theme,
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 1000 },
    });

    test('telegram settings', async ({ page }) => {
      const section = await openTelegram(page);
      await openTokenForm(section);
      await expect(section.getByLabel('Bot code')).toBeVisible();
      // The sections above load on their own: scroll once they are there.
      await expect(page.getByTestId('mcp-settings')).toBeVisible();
      await page.waitForTimeout(500);
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/telegram-token-${theme}.png`,
        animations: 'disabled',
      });

      await page.reload();
      await connect(page);
      await section.getByRole('button', { name: 'Connect an account' }).click();
      await expect(section.getByTestId('telegram-pairing-code')).toBeVisible();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/telegram-codice-${theme}.png`,
        animations: 'disabled',
      });

      await expect(section.getByTestId('telegram-user')).toHaveCount(1, { timeout: 8000 });
      await section.getByRole('switch', { name: 'Quiet at night' }).click();
      await expect(section.getByLabel('From', { exact: true })).toBeVisible();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/telegram-collegato-${theme}.png`,
        animations: 'disabled',
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/telegram-collegato-${theme}-390.png`,
        animations: 'disabled',
      });
    });
  });
}
