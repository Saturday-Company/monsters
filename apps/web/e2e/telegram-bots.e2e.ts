import type { Locator, Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Bots dedicated to one monster (D-107) in Settings → Collegamenti → Telegram,
 * on the mock core: a bot added with its token and its monster (the list shows
 * each monster with its project, never the God), its @username, the group it
 * was added to and Livio's `/join` approved, then the bot removed. In the
 * monster's chat a message from the group is Livio's, "da Telegram · Saturday
 * Team". `TELEGRAM_BOTS_SHOTS=<folder>` saves the screenshots (desktop light,
 * phone dark).
 */

const SHOTS = process.env['TELEGRAM_BOTS_SHOTS'];
const TOKEN = '7212345677:AAHanotherBotTokenForTheMockCore_abcd';

async function closeNotice(page: Page) {
  // The demo's notice (a tool in pause) would cover the page.
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.count()) {
    await close.first().click();
    await expect(close).toHaveCount(0);
  }
}

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return;
  await closeNotice(page);
  // The part to show at the top of the view, under the toolbar.
  if (target) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function noSideScroll(page: Page, width: number) {
  await expectNoSideScroll(page, width);
}

async function openBots(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const bots = page.getByTestId('telegram-bots');
  await expect(bots.getByRole('heading', { name: 'Bots dedicated to a monster' })).toBeVisible();
  return bots;
}

test.describe('dedicated bots, desktop light', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('add a bot for a monster, approve its group and a person, remove it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const bots = await openBots(page);
    // The demo has Calypso's bot in the group of Saturday already.
    await expect(bots.getByTestId('telegram-bot')).toHaveCount(1);
    await expect(bots.getByTestId('telegram-bot-username')).toHaveText('@CalypsoSaturdayBot');
    await expect(bots.getByTestId('telegram-bot-monster')).toHaveText('Calypso · Saturday Social');

    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await expect(form).toContainText('/setprivacy');
    await expect(form).toContainText('another assistant active in the group');
    const select = form.getByLabel('The monster that answers');
    // Each monster with its project, or the Personal squad; never the God.
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('Pandora · Saturday Social');
    expect(options).toContain('Rhea · Personal squad');
    expect(options.some((o) => o.startsWith('Titan'))).toBe(false);

    // A refused token, then the right one.
    await form.getByLabel('Bot code (token)').fill('7212345677:AAH000000wrongTokenForTheMock_ab');
    await select.selectOption({ label: 'Pandora · Saturday Social' });
    await form.getByLabel('Messages per day (optional)').fill('150');
    await shot(page, '01-aggiungi-bot-chiaro', form);
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(form.getByRole('alert')).toContainText('Telegram doesn’t recognize');
    await form.getByLabel('Bot code (token)').fill(TOKEN);
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(page.getByText('Bot @PandoraSaturdayBot connected to Pandora.')).toBeVisible();

    const bot = bots.locator('[data-testid="telegram-bot"][data-bot="7212345677"]');
    await expect(bot.getByTestId('telegram-bot-username')).toHaveText('@PandoraSaturdayBot');
    await expect(bot.getByTestId('telegram-bot-status')).toContainText('Connected');
    await expect(bot.getByTestId('telegram-bot-today')).toHaveText('Messages today: 0 of 150');
    await expect(bot).toContainText('No groups yet');

    // The same token again: already in use.
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    await form.getByLabel('Bot code (token)').fill(TOKEN);
    await form
      .getByLabel('The monster that answers')
      .selectOption({ label: 'Rhea · Personal squad' });
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(form.getByRole('alert')).toContainText('already connected');
    await form.getByRole('button', { name: 'Cancel' }).click();

    // Added to the group, and Livio wrote /join: both wait for the user.
    const group = bot.getByTestId('telegram-bot-chat');
    await expect(group).toHaveAttribute('data-status', 'pending', { timeout: 8000 });
    await expect(group).toContainText('Saturday Team');
    const livio = bot.locator('[data-testid="telegram-bot-person"][data-status="pending"]');
    await expect(livio).toContainText('Livio');
    await expect(bot).toContainText('2 to approve');
    await shot(page, '02-da-approvare-chiaro', bot);

    await bot.getByRole('button', { name: 'Approve Saturday Team' }).click();
    await expect(group).toHaveAttribute('data-status', 'approved');
    await bot.getByRole('button', { name: 'Approve Livio' }).click();
    await expect(
      bot.locator('[data-testid="telegram-bot-person"][data-status="approved"]'),
    ).toContainText('Livio');
    await expect(bot).not.toContainText(/\d to approve/);

    // Someone added by id.
    await bot.getByLabel('Add with the Telegram ID').fill('5550009');
    await bot.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(bot.getByTestId('telegram-bot-person')).toHaveCount(2);
    await shot(page, '03-approvati-chiaro', bot);

    // Removed: the bot is gone, Calypso's stays.
    await bot.getByRole('button', { name: 'Remove bot' }).click();
    await bot.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByText('@PandoraSaturdayBot no longer answers')).toBeVisible();
    await expect(bots.getByTestId('telegram-bot')).toHaveCount(1);
  });

  test('the people of a bot work with fewer tools; on again bot by bot, after a warning (D-114)', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const bots = await openBots(page);
    const bot = bots.getByTestId('telegram-bot').first();
    // Calypso works with other programs: the entry says what the people of the group cannot do.
    await expect(bot.getByTestId('telegram-bot-risk')).toContainText('Calypso has connected apps');
    const tools = bot.getByTestId('telegram-bot-tools');
    const lever = tools.getByRole('switch');
    await expect(lever).toHaveAttribute('aria-checked', 'false');
    await expect(tools).toContainText('no terminal or file changes');
    await lever.click();
    // Not on at the first press: a clear warning first.
    await expect(tools.getByTestId('telegram-bot-tools-confirm')).toContainText(
      'as if they were you',
    );
    await expect(lever).toHaveAttribute('aria-checked', 'false');
    await shot(page, '07-strumenti-per-gli-altri-chiaro', bot);
    await tools.getByRole('button', { name: 'Yes, turn on' }).click();
    await expect(lever).toHaveAttribute('aria-checked', 'true');
    await expect(tools).toContainText('On: people you admit use everything Calypso can do');
    await expect(bot.getByTestId('telegram-bot-risk')).toHaveCount(0);
    // Off again at once.
    await lever.click();
    await expect(lever).toHaveAttribute('aria-checked', 'false');

    // A new bot for the same monster: the form warns before it is added.
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await form
      .getByLabel('The monster that answers')
      .selectOption({ label: 'Calypso · Saturday Social' });
    await expect(form.getByTestId('telegram-bot-risk-new')).toContainText('People you admit');
  });

  test('the God is never offered, and the paired account is the owner', async ({ page }) => {
    const section = page.getByTestId('telegram-settings');
    await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
    await section.getByRole('button', { name: 'Connect a bot' }).click();
    await section.getByLabel('Bot code').fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
    await section.getByRole('button', { name: 'Connect the bot' }).click();
    await section.getByRole('button', { name: 'Connect an account' }).click();
    await expect(page.getByText('Account connected: Giulio.')).toBeVisible({ timeout: 8000 });
    const bot = section.getByTestId('telegram-bot');
    const owner = bot.locator('[data-testid="telegram-bot-person"][data-owner="true"]');
    await expect(owner).toContainText('Giulio');
    await expect(owner.getByRole('button')).toHaveCount(0);
    // The main bot's token is not a dedicated bot's.
    const bots = section.getByTestId('telegram-bots');
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await form.getByLabel('Bot code (token)').fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
    await form
      .getByLabel('The monster that answers')
      .selectOption({ label: 'Rhea · Personal squad' });
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(form.getByRole('alert')).toContainText('main bot’s');
  });

  test('a message from the group is the sender’s, in the monster’s chat', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?mock=demo#/?chat=calypso');
    const msg = page.getByTestId('telegram-message');
    await expect(msg).toHaveCount(1);
    await expect(msg).toContainText('Livio · from Telegram · Saturday Team');
    await expect(msg.getByTestId('telegram-bubble')).toHaveText(
      'Can you come up with three ideas for Monday’s post about the new menu?',
    );
    // Not the user's bubble; the answer went back to the group.
    await expect(page.getByTestId('user-bubble')).toHaveCount(0);
    await expect(page.getByTestId('agent-via')).toHaveText('on Telegram · Saturday Team');
    await shot(page, '04-chat-dal-gruppo-chiaro');
  });
});

test.describe('dedicated bots, phone dark', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the section and the chat in dark on a phone, with no sideways scroll', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const bots = await openBots(page);
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await form.getByLabel('Bot code (token)').fill(TOKEN);
    await form
      .getByLabel('The monster that answers')
      .selectOption({ label: 'Rhea · Personal squad' });
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    const bot = bots.locator('[data-testid="telegram-bot"][data-bot="7212345677"]');
    await expect(bot.getByTestId('telegram-bot-monster')).toHaveText('Rhea · Personal squad');
    await expect(bot.getByTestId('telegram-bot-chat')).toHaveAttribute('data-status', 'pending', {
      timeout: 8000,
    });
    await noSideScroll(page, 390);
    await bot.scrollIntoViewIfNeeded();
    await shot(page, '05-bot-telefono-scuro', bot);

    await page.goto('/?mock=demo#/?chat=calypso');
    await expect(page.getByTestId('telegram-message')).toContainText(
      'from Telegram · Saturday Team',
    );
    await noSideScroll(page, 390);
    await shot(page, '06-chat-telefono-scuro');
  });
});
