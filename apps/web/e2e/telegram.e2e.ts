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
  await expect(section.getByLabel('Codice del bot')).toHaveCount(0);
  await section.getByRole('button', { name: 'Collega un bot' }).click();
}

async function connect(page: Page) {
  const section = await openTelegram(page);
  await openTokenForm(section);
  await section.getByLabel('Codice del bot').fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
  await section.getByRole('button', { name: 'Collega il bot' }).click();
  await expect(section.getByTestId('telegram-status')).toContainText('@MonstersDemoBot');
  return section;
}

test('settings: connect the bot, pair an account, quiet night, remove', async ({ page }) => {
  const section = await openTelegram(page);
  await expect(section.getByTestId('telegram-status')).toHaveAttribute('data-status', 'off');

  // A malformed token is caught in the page, a refused one by the core.
  await openTokenForm(section);
  const field = section.getByLabel('Codice del bot');
  await field.fill('ciao');
  await section.getByRole('button', { name: 'Collega il bot' }).click();
  await expect(section.getByRole('alert')).toContainText('non sembra un token di Telegram');
  await field.fill('123456789:AAH000000wrongTokenForTheMock_abcdefgh');
  await section.getByRole('button', { name: 'Collega il bot' }).click();
  await expect(section.getByRole('alert')).toContainText('Telegram non riconosce');

  await field.fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
  await section.getByRole('button', { name: 'Collega il bot' }).click();
  await expect(page.getByText('Bot @MonstersDemoBot collegato.')).toBeVisible();
  // The token is never shown again.
  await expect(section.getByLabel('Codice del bot')).toHaveCount(0);

  // Pairing starts by itself: a code to send to the bot, then the account appears.
  const code = section.getByTestId('telegram-pairing-code');
  await expect(code).toHaveText(/^\/start [A-Z2-9]{8}$/);
  await expect(section.getByRole('link', { name: 'Apri in Telegram' })).toHaveAttribute(
    'href',
    /^https:\/\/t\.me\/MonstersDemoBot\?start=[A-Z2-9]{8}$/,
  );
  await expect(section.getByText(/Scade tra \d+:\d\d/)).toBeVisible();
  // "Mi collego…" first, then the page reads the state again by itself.
  await expect(section.getByTestId('telegram-status')).toHaveAttribute('data-status', 'online');
  await expect(page.getByText('Account collegato: Giulio.')).toBeVisible({ timeout: 8000 });
  await expect(section.getByTestId('telegram-pairing')).toHaveCount(0);
  await expect(section.getByTestId('telegram-user')).toHaveCount(1);
  await expect(section.getByTestId('telegram-user')).toContainText('Giulio · @giulio');

  // Quiet night: hours appear when it is on.
  const quiet = section.getByRole('switch', { name: 'Silenzioso di notte' });
  await expect(quiet).toHaveAttribute('aria-checked', 'false');
  await quiet.click();
  await expect(quiet).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByLabel('Dalle', { exact: true })).toHaveValue('22:00');
  await section.getByLabel('fino alle', { exact: true }).fill('07:30');
  await expect(section.getByLabel('fino alle', { exact: true })).toHaveValue('07:30');
  const done = section.getByRole('switch', { name: 'Lavoro finito' });
  await done.click();
  await expect(done).toHaveAttribute('aria-checked', 'false');

  // Remove the account; then the bot.
  await section.getByRole('button', { name: 'Togli Giulio' }).click();
  await expect(section.getByTestId('telegram-user')).toHaveCount(0);
  await section.getByRole('button', { name: 'Scollega il bot' }).click();
  await section.getByRole('button', { name: 'Sì, scollega' }).click();
  await expect(section.getByRole('button', { name: 'Collega un bot' })).toBeVisible();

  // Everything is in the log.
  await page.goto('/?mock=demo#/log');
  await expect(
    page.getByText('Giulio non può più comandare i mostri da Telegram').first(),
  ).toBeVisible();
});

test('settings: a pairing code can be cancelled', async ({ page }) => {
  const section = await connect(page);
  await section.getByRole('button', { name: 'Collega un account' }).click();
  await expect(section.getByTestId('telegram-pairing-code')).toBeVisible();
  await section.getByRole('button', { name: 'Annulla' }).click();
  await expect(section.getByTestId('telegram-pairing')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Collega un account' })).toBeVisible();
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
      await expect(section.getByLabel('Codice del bot')).toBeVisible();
      // The sections above load on their own: scroll once they are there.
      await expect(page.getByTestId('agent-permissions-rhea')).toBeVisible();
      await page.waitForTimeout(500);
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/telegram-token-${theme}.png`,
        animations: 'disabled',
      });

      await connect(page);
      await section.getByRole('button', { name: 'Collega un account' }).click();
      await expect(section.getByTestId('telegram-pairing-code')).toBeVisible();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/telegram-codice-${theme}.png`,
        animations: 'disabled',
      });

      await expect(section.getByTestId('telegram-user')).toHaveCount(1, { timeout: 8000 });
      await section.getByRole('switch', { name: 'Silenzioso di notte' }).click();
      await expect(section.getByLabel('Dalle', { exact: true })).toBeVisible();
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
