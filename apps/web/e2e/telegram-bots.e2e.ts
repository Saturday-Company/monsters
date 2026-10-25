import type { Locator, Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Bots dedicated to one monster (D-107), the "Group bots (advanced)" row of Settings → Apps and
 * Telegram → Telegram (wave C), on the mock core: a bot added with its token and its monster (the list shows
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

/** Opens a bot's row when it is closed (a row with a request waiting opens by itself). */
async function openBot(bot: Locator) {
  const toggle = bot.locator('button[aria-expanded]').first();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** The "Group bots (advanced)" row: closed until asked for, unless a request waits in it. */
function advancedRow(bots: Locator) {
  return bots.getByTestId('telegram-bots-advanced');
}

async function openAdvanced(bots: Locator) {
  const toggle = advancedRow(bots).getByRole('button', { name: /^Group bots \(advanced\)/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function openBots(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const bots = page.getByTestId('telegram-bots');
  await expect(advancedRow(bots)).toHaveAttribute('data-advanced', 'true');
  await openAdvanced(bots);
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
    await form
      .getByLabel('Bot code (from BotFather)')
      .fill('7212345677:AAH000000wrongTokenForTheMock_ab');
    await select.selectOption({ label: 'Pandora · Saturday Social' });
    await form.getByLabel('Messages per day (optional)').fill('150');
    await shot(page, '01-aggiungi-bot-chiaro', form);
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(form.getByRole('alert')).toContainText('Telegram doesn’t recognize');
    await form.getByLabel('Bot code (from BotFather)').fill(TOKEN);
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(page.getByText('Bot @PandoraSaturdayBot connected to Pandora.')).toBeVisible();

    const bot = bots.locator('[data-testid="telegram-bot"][data-bot="7212345677"]');
    await expect(bot.getByTestId('telegram-bot-username')).toHaveText('@PandoraSaturdayBot');
    await expect(bot.getByTestId('telegram-bot-status')).toContainText('Connected');
    await openBot(bot);
    await expect(bot.getByTestId('telegram-bot-today')).toHaveText('Messages today: 0 of 150');
    await expect(bot).toContainText('No groups yet');

    // The same token again: already in use.
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    await form.getByLabel('Bot code (from BotFather)').fill(TOKEN);
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
    ).toContainText(['Giulio', 'Livio']);
    await expect(bot).not.toContainText(/\d to approve/);

    // Someone added by id.
    await bot.getByLabel('Add with the Telegram ID').fill('5550009');
    await bot.getByRole('button', { name: 'Add', exact: true }).click();
    // Giulio (the paired account, always there), Livio and the one just added.
    await expect(bot.getByTestId('telegram-bot-person')).toHaveCount(3);
    await shot(page, '03-approvati-chiaro', bot);

    // Removed: the bot is gone, Calypso's stays.
    await openBot(bot);
    await bot.getByRole('button', { name: 'Remove bot' }).click();
    await bot.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByText('@PandoraSaturdayBot no longer answers')).toBeVisible();
    await expect(bots.getByTestId('telegram-bot')).toHaveCount(1);
  });

  test('a missing monster and a bad limit are said under their own field, not under the code (W-33)', async ({
    page,
  }) => {
    const bots = await openBots(page);
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    const token = form.getByLabel('Bot code (from BotFather)');
    const select = form.getByLabel('The monster that answers');
    const limit = form.getByLabel('Messages per day (optional)');
    await token.fill(TOKEN);
    await limit.fill('99999');
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    const alerts = form.getByRole('alert');
    await expect(alerts).toHaveCount(2);
    await expect(alerts.nth(0)).toHaveText('Choose the monster that answers from this bot.');
    await expect(alerts.nth(1)).toContainText('whole number between 1 and 10000');
    await expect(select).toHaveAttribute('aria-invalid', 'true');
    await expect(limit).toHaveAttribute('aria-invalid', 'true');
    await expect(token).not.toHaveAttribute('aria-invalid', 'true');
    // Each error sits in its own field and is its description.
    await expect(select.locator('xpath=..')).toContainText('Choose the monster');
    await expect(token.locator('xpath=..')).not.toContainText('Choose the monster');
    await expect(select).toHaveAccessibleDescription(
      'Choose the monster that answers from this bot.',
    );
    // Fixing the field and sending again clears them.
    await select.selectOption({ label: 'Pandora · Saturday Social' });
    await limit.fill('150');
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(page.getByText('Bot @PandoraSaturdayBot connected to Pandora.')).toBeVisible();
  });

  test('the group bots are one closed Advanced row; the long explanations wait behind "How groups work"', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
    const bots = page.getByTestId('telegram-bots');
    // Closed: one row with its name and what is in it; no bot, no form, no explanation.
    const row = advancedRow(bots);
    await expect(row).toContainText('Group bots (advanced)');
    await expect(row).toContainText('1 bot');
    await expect(bots.getByTestId('telegram-bot')).toHaveCount(0);
    await expect(bots.getByRole('button', { name: 'Add a bot for a monster' })).toHaveCount(0);
    await expect(page.getByText('How groups work')).toHaveCount(0);

    await openAdvanced(bots);
    // What is never approved in groups: behind "How groups work", closed.
    const never = bots.getByText(/are never approved in the group/);
    await expect(never).toBeHidden();
    await bots.getByText('How groups work').click();
    await expect(never).toBeVisible();

    // Without a dedicated bot: the row says what it is for, and there is the way to add one.
    await openBot(bots.getByTestId('telegram-bot'));
    await bots.getByRole('button', { name: 'Remove bot' }).click();
    await bots.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(bots.getByTestId('telegram-bot')).toHaveCount(0);
    await expect(bots.getByRole('heading')).toHaveCount(0);
    await expect(row).toContainText('A bot of its own for a monster, to put in a Telegram group.');
    const add = bots.getByRole('button', { name: 'Add a bot for a monster' });
    await expect(add).toBeVisible();

    // Starting to add brings the form.
    await add.click();
    await expect(bots.getByTestId('telegram-bot-form')).toBeVisible();
    await bots.getByRole('button', { name: 'Cancel' }).click();
    await expect(bots.getByTestId('telegram-bot-form')).toHaveCount(0);
  });

  test('a bot is one closed row; a request waiting for approval shows its count and opens the row', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const bots = await openBots(page);
    // Calypso's bot has nothing waiting: one row with the handle, the monster and the status.
    const calypso = bots.getByTestId('telegram-bot');
    const toggle = calypso.locator('button[aria-expanded]').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('@CalypsoSaturdayBot');
    await expect(toggle).toContainText('Calypso · Saturday Social');
    await expect(toggle).toContainText('Connected');
    await expect(calypso.getByTestId('telegram-bot-pending')).toHaveCount(0);
    await expect(calypso.getByTestId('telegram-bot-tools')).toHaveCount(0);
    await expect(calypso.getByTestId('telegram-bot-today')).toHaveCount(0);
    await toggle.click();
    await expect(calypso.getByTestId('telegram-bot-tools')).toBeVisible();
    await expect(calypso.getByTestId('telegram-bot-today')).toBeVisible();
    await toggle.click();
    await expect(calypso.getByTestId('telegram-bot-tools')).toHaveCount(0);

    // A new bot starts closed; when the group and Livio's /join arrive it opens by itself,
    // with the count on the row.
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await form.getByLabel('Bot code (from BotFather)').fill(TOKEN);
    await form
      .getByLabel('The monster that answers')
      .selectOption({ label: 'Pandora · Saturday Social' });
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    const bot = bots.locator('[data-testid="telegram-bot"][data-bot="7212345677"]');
    const botToggle = bot.locator('button[aria-expanded]').first();
    await expect(botToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(botToggle).toHaveAttribute('aria-expanded', 'true', { timeout: 8000 });
    await expect(bot.getByTestId('telegram-bot-pending')).toHaveText('2 to approve');
    await expect(bot.getByTestId('telegram-bot-chat')).toHaveAttribute('data-status', 'pending');
    // Calypso's stays closed.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('a request that arrives while the Advanced row is closed opens it and shows its count', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const bots = await openBots(page);
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await form.getByLabel('Bot code (from BotFather)').fill(TOKEN);
    await form
      .getByLabel('The monster that answers')
      .selectOption({ label: 'Pandora · Saturday Social' });
    await form.getByRole('button', { name: 'Connect the bot' }).click();
    await expect(page.getByText('Bot @PandoraSaturdayBot connected to Pandora.')).toBeVisible();
    // Close the row before the group and the /join arrive: they open it by themselves.
    const toggle = advancedRow(bots).getByRole('button', { name: /^Group bots \(advanced\)/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 8000 });
    await expect(bots.getByTestId('telegram-bots-pending')).toHaveText('2 to approve');
  });

  test('the people of a bot work with fewer tools; on again bot by bot, after a warning (D-114)', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const bots = await openBots(page);
    const bot = bots.getByTestId('telegram-bot').first();
    await openBot(bot);
    // The entry says the state in a line; the explanation is the confirm's (U2-4).
    await expect(bot.getByTestId('telegram-bot-risk')).toHaveCount(0);
    const tools = bot.getByTestId('telegram-bot-tools');
    const lever = tools.getByRole('switch');
    await expect(lever).toHaveAttribute('aria-checked', 'false');
    await expect(tools).toContainText('Off: people you admit work with fewer tools.');
    await expect(tools).not.toContainText('no commands or file changes');
    await lever.click();
    // Not on at the first press: a clear warning first, with what they cannot do today.
    const confirm = tools.getByTestId('telegram-bot-tools-confirm');
    await expect(confirm).toContainText('as if they were you');
    await expect(confirm).toContainText('connected apps');
    await expect(confirm).toContainText('no commands or file changes');
    await expect(lever).toHaveAttribute('aria-checked', 'false');
    await shot(page, '07-strumenti-per-gli-altri-chiaro', bot);
    await tools.getByRole('button', { name: 'Yes, turn on' }).click();
    await expect(lever).toHaveAttribute('aria-checked', 'true');
    await expect(tools).toContainText('On: people you admit use everything Calypso can do');
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
    // The demo's main bot is connected already, with Giulio: start from a bot not connected yet.
    await section.getByRole('button', { name: 'Remove Giulio' }).click();
    await section.getByRole('button', { name: 'Disconnect the bot' }).click();
    await section.getByRole('button', { name: 'Yes, disconnect' }).click();
    await section.getByRole('button', { name: 'Connect a bot' }).click();
    await section.getByLabel('Bot code').fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
    await section.getByRole('button', { name: 'Connect the bot' }).click();
    await section.getByRole('button', { name: 'Connect an account' }).click();
    await expect(page.getByText('Account connected: Giulio.')).toBeVisible({ timeout: 8000 });
    await openAdvanced(section.getByTestId('telegram-bots'));
    const bot = section.getByTestId('telegram-bot');
    await openBot(bot);
    const owner = bot.locator('[data-testid="telegram-bot-person"][data-owner="true"]');
    await expect(owner).toContainText('Giulio');
    await expect(owner.getByRole('button')).toHaveCount(0);
    // The main bot's token is not a dedicated bot's.
    const bots = section.getByTestId('telegram-bots');
    await bots.getByRole('button', { name: 'Add a bot for a monster' }).click();
    const form = bots.getByTestId('telegram-bot-form');
    await form
      .getByLabel('Bot code (from BotFather)')
      .fill('123456789:AAHdemoTokenForTheMockCore_abcdefgh');
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
    await form.getByLabel('Bot code (from BotFather)').fill(TOKEN);
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
