import { expect, test } from './fixtures.ts';

/*
 * A background refresh that fails (the core busy or restarting) must not unmount the forms of
 * Settings and wipe a key or a token being typed (review W-5): the tab keeps what it has, says
 * so in a line with "Try again", and only a first load that fails shows the failed state.
 */

type Mock = { failRequests: (match: string, times?: number) => void; clearFailures: () => void };

test('Models: a refresh that fails keeps the key being typed and offers to try again', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const connected = page.getByTestId('models-connected');
  await connected.getByRole('button', { name: 'Add a model' }).click();
  // The accounts with a key of their own wait in a closed drawer under the plans.
  await page.getByTestId('models-add-more').getByRole('button').first().click();
  const anthropic = page.getByTestId('providers').getByTestId('provider-row-anthropic');
  await anthropic.getByRole('button', { name: 'Add the key' }).click();
  const key = anthropic.getByLabel('Anthropic key');
  await key.fill('sk-ant-test-half-typed');

  // The page comes back into view: the plans are read again, and the core says no.
  await page.evaluate(() => {
    (window as unknown as { __monstersMock: Mock }).__monstersMock.failRequests(
      'GET /api/subscriptions',
    );
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const stale = page.getByTestId('models-stale');
  await expect(stale).toContainText('Couldn’t refresh the models');
  await expect(key).toHaveValue('sk-ant-test-half-typed');

  // Try again, with the core back: the line goes and the key is still there.
  await page.evaluate(() =>
    (window as unknown as { __monstersMock: Mock }).__monstersMock.clearFailures(),
  );
  await stale.getByRole('button', { name: 'Try again' }).click();
  await expect(stale).toHaveCount(0);
  await expect(key).toHaveValue('sk-ant-test-half-typed');
});

test('Models: the first load that fails shows the failed state, with a way to try again', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/note');
  await expect(page.getByTestId('vault-view')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __monstersMock: Mock }).__monstersMock.failRequests(
      'GET /api/providers',
    );
  });
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await expect(page.getByText('Couldn’t load the models')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __monstersMock: Mock }).__monstersMock.clearFailures(),
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('models-connected')).toBeVisible();
});

test('Telegram: a refresh that fails keeps the token form and what is typed in it', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const section = page.getByTestId('telegram-settings');
  await section.getByRole('button', { name: 'Remove Giulio' }).click();
  await section.getByRole('button', { name: 'Disconnect the bot' }).click();
  await section.getByRole('button', { name: 'Yes, disconnect' }).click();
  await section.getByRole('button', { name: 'Connect a bot' }).click();
  const token = section.getByLabel('Bot code');
  await token.fill('123456789:AAHhalfpasted');

  // An event of a bot reads the state again; the core fails that read once.
  await page.evaluate(() => {
    const mock = (window as unknown as { __monstersMock: Mock & { append: (e: unknown) => void } })
      .__monstersMock;
    mock.failRequests('GET /api/telegram', 1);
    mock.append({
      agent: 'system',
      type: 'channel',
      data: { channel: 'telegram', action: 'bot_added', bot: 'tgb_e2e', name: '@e2e_bot' },
    });
  });
  const stale = page.getByTestId('telegram-stale');
  await expect(stale).toContainText('Couldn’t refresh Telegram');
  await expect(token).toHaveValue('123456789:AAHhalfpasted');
  await stale.getByRole('button', { name: 'Try again' }).click();
  await expect(stale).toHaveCount(0);
  await expect(token).toHaveValue('123456789:AAHhalfpasted');
});
