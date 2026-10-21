import { expect, expectNoSideScroll, test } from './fixtures.ts';

/* Settings in tabs: links to one tab (old names too), keyboard, screen-reader wiring, phones. */

test('settings open on Squadra, and a link opens another tab', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni');
  const tablist = page.getByRole('tablist', { name: 'Settings sections' });
  await expect(tablist.getByRole('tab')).toHaveText([
    'Squad',
    'Models',
    'Permissions',
    'Connections',
    'General',
  ]);
  const squadra = page.getByRole('tab', { name: 'Squad' });
  await expect(squadra).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: 'Squad' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAccessibleDescription(/Who’s on your squad/);
  await expect(panel.getByRole('heading', { name: 'The squad' })).toBeVisible();
  // Only the open tab is on screen.
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const models = page.getByRole('tabpanel', { name: 'Models' });
  await expect(models).toHaveAccessibleDescription(/What the monsters think with/);
  await expect(models.getByRole('heading', { name: 'What the monsters think with' })).toBeVisible();

  await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
  await expect(page.getByRole('tab', { name: 'Permissions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const perms = page.getByRole('tabpanel', { name: 'Permissions' });
  // One idea (D-066): what they always ask comes first, then what each may do; the engine is advanced.
  await expect(perms).toHaveAccessibleDescription(/what they always ask you first/);
  const ask = perms.getByTestId('team-ask-always');
  await expect(ask).toContainText('Publishing, writing to others');
  await expect(perms.getByRole('heading', { name: 'What the monsters can do' })).toBeVisible();
  const askBox = await ask.boundingBox();
  const whatBox = await perms.getByTestId('permissions-settings').boundingBox();
  expect(askBox!.y).toBeLessThan(whatBox!.y);
  // The ways in from outside are not permissions: they have their own tab.
  await expect(perms.getByRole('heading', { name: 'Telegram' })).toHaveCount(0);
  // Who takes the quick decisions is the team's instinct, in Squadra (D-068): no "Avanzate".
  await expect(perms.getByRole('button', { name: 'Advanced' })).toHaveCount(0);
  await expect(perms.getByRole('heading', { name: 'Monsters’ decisions' })).toHaveCount(0);
  await perms.getByTestId('ask-always-instinct-link').click();
  await expect(page.getByRole('tab', { name: 'Squad' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Monsters’ decisions' })).toBeInViewport();

  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const links = page.getByRole('tabpanel', { name: 'Connections' });
  await expect(links).toHaveAccessibleDescription(/Telegram, web search, other apps/);
  await expect(links.getByRole('heading', { name: 'Telegram' })).toBeVisible();
  await expect(links.getByRole('heading', { name: 'Web search' })).toBeVisible();
  await expect(links.getByRole('heading', { name: 'Other apps' })).toBeVisible();

  // An unknown tab falls back on the first one.
  await page.goto('/?mock=demo#/impostazioni?sezione=boh');
  await expect(squadra).toHaveAttribute('aria-selected', 'true');
});

test('the old tab names and parts open the tab that holds them now', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=telegram');
  await expect(page.getByRole('tab', { name: 'Connections' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // The link becomes the tab's own, and the part comes into view.
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=collegamenti$/);
  await expect(page.getByRole('heading', { name: 'Telegram' })).toBeInViewport();

  for (const old of ['aspetto', 'account']) {
    await page.goto(`/?mock=demo#/impostazioni?sezione=${old}`);
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/#\/impostazioni\?sezione=generale$/);
  }
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeVisible();
});

test('one model for the whole team, or one per monster', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const chains = page.getByTestId('chains');
  // Everybody uses the same model in the demo: one editor, in words.
  await expect(chains.getByTestId('team-chain')).toBeVisible();
  await expect(chains.getByLabel('Model 1 of all the monsters', { exact: true })).toHaveValue(
    'Free, picked by OpenRouter',
  );
  await expect(chains.getByTestId('model-id').first()).toHaveText('openrouter/free');
  // A single model is not a chain: nothing to move or take away.
  await expect(chains.getByRole('button', { name: /^Move model/ })).toBeHidden();
  await chains.getByTestId('chains-per-monster').click();
  await expect(chains.getByTestId('agent-chain-titan')).toBeVisible();
  await expect(chains.getByTestId('team-chain')).toHaveCount(0);
});

test('the arrows move between tabs, the URL follows, Back leaves the page', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  await page.getByRole('link', { name: 'Settings' }).click();
  // The sidebar lights Impostazioni and nothing else (no chat, not Note or Attività).
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('sidebar').locator('[aria-current="page"]')).toHaveCount(1);
  const squadra = page.getByRole('tab', { name: 'Squad' });
  await expect(squadra).toHaveAttribute('aria-selected', 'true');

  // Roving tabindex: Tab reaches the selected tab only.
  await squadra.focus();
  await expect(page.getByRole('tab', { name: 'Models' })).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowRight');
  const modelli = page.getByRole('tab', { name: 'Models' });
  await expect(modelli).toBeFocused();
  await expect(modelli).toHaveAttribute('aria-selected', 'true');
  await expect(modelli).toHaveAttribute('tabindex', '0');
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=modelli$/);

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'General' })).toBeFocused();
  await expect(page.getByTestId('vault-path')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(squadra).toBeFocused();
  await expect(page).toHaveURL(/#\/impostazioni$/);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');

  // Tab from the selected tab goes into its panel.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'General' })).toBeFocused();

  // Switching tabs adds no history: Back goes to the page before the settings.
  await page.goBack();
  await expect(page).toHaveURL(/#\/log$/);
});

test('a half-typed key survives a look at another tab', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const openrouter = page.getByTestId('provider-row-openrouter');
  // The new key only after "Cambia chiave".
  await expect(page.getByLabel('New key')).toHaveCount(0);
  await openrouter.getByRole('button', { name: 'Change', exact: true }).click();
  await openrouter.getByRole('button', { name: 'Change key' }).click();
  await page.getByLabel('New key').fill('sk-or-v1-mezza');
  await page.getByRole('tab', { name: 'General' }).click();
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
  await page.getByRole('tab', { name: 'Models' }).click();
  await expect(page.getByLabel('New key')).toHaveValue('sk-or-v1-mezza');
});

test.describe('narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the five tabs fit, none is cut', async ({ page }) => {
    await page.goto('/?mock=demo#/impostazioni?sezione=generale');
    const generale = page.getByRole('tab', { name: 'General' });
    await expect(generale).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Squad', 'Models', 'Permissions', 'Connections', 'General']) {
      await expect(page.getByRole('tab', { name })).toBeInViewport({ ratio: 1 });
    }
    // No sideways scroll of the page itself.
    await expectNoSideScroll(page);
    await page.getByRole('tab', { name: 'Connections' }).click();
    await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible();
  });
});
