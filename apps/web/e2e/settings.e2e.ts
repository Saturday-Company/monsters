import { expect, test } from './fixtures.ts';

/* Settings in tabs: links to one tab (old names too), keyboard, screen-reader wiring, phones. */

test('settings open on Squadra, and a link opens another tab', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni');
  const tablist = page.getByRole('tablist', { name: 'Sezioni delle impostazioni' });
  await expect(tablist.getByRole('tab')).toHaveText([
    'Squadra',
    'Modelli',
    'Permessi',
    'Collegamenti',
    'Generale',
  ]);
  const squadra = page.getByRole('tab', { name: 'Squadra' });
  await expect(squadra).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: 'Squadra' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAccessibleDescription(/Chi c’è nella tua squadra/);
  await expect(panel.getByRole('heading', { name: 'La squadra' })).toBeVisible();
  // Only the open tab is on screen.
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const models = page.getByRole('tabpanel', { name: 'Modelli' });
  await expect(models).toHaveAccessibleDescription(/Con cosa pensano i mostri/);
  await expect(models.getByRole('heading', { name: 'Con cosa pensano i mostri' })).toBeVisible();

  await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
  await expect(page.getByRole('tab', { name: 'Permessi' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const perms = page.getByRole('tabpanel', { name: 'Permessi' });
  // One idea (D-066): what they always ask comes first, then what each may do; the engine is advanced.
  await expect(perms).toHaveAccessibleDescription(/cosa ti chiedono sempre/);
  const ask = perms.getByTestId('team-ask-always');
  await expect(ask).toContainText('Pubblicare, scrivere ad altri');
  await expect(perms.getByRole('heading', { name: 'Cosa possono fare i mostri' })).toBeVisible();
  const askBox = await ask.boundingBox();
  const whatBox = await perms.getByTestId('permissions-settings').boundingBox();
  expect(askBox!.y).toBeLessThan(whatBox!.y);
  // The ways in from outside are not permissions: they have their own tab.
  await expect(perms.getByRole('heading', { name: 'Telegram' })).toHaveCount(0);
  // Who takes the quick decisions is the team's instinct, in Squadra (D-068): no "Avanzate".
  await expect(perms.getByRole('button', { name: 'Avanzate' })).toHaveCount(0);
  await expect(perms.getByRole('heading', { name: 'Decisioni dei mostri' })).toHaveCount(0);
  await perms.getByTestId('ask-always-instinct-link').click();
  await expect(page.getByRole('tab', { name: 'Squadra' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Decisioni dei mostri' })).toBeInViewport();

  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const links = page.getByRole('tabpanel', { name: 'Collegamenti' });
  await expect(links).toHaveAccessibleDescription(/Telegram, la ricerca sul web, altri programmi/);
  await expect(links.getByRole('heading', { name: 'Telegram' })).toBeVisible();
  await expect(links.getByRole('heading', { name: 'Ricerca sul web' })).toBeVisible();
  await expect(links.getByRole('heading', { name: 'Altri programmi' })).toBeVisible();

  // An unknown tab falls back on the first one.
  await page.goto('/?mock=demo#/impostazioni?sezione=boh');
  await expect(squadra).toHaveAttribute('aria-selected', 'true');
});

test('the old tab names and parts open the tab that holds them now', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=telegram');
  await expect(page.getByRole('tab', { name: 'Collegamenti' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // The link becomes the tab's own, and the part comes into view.
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=collegamenti$/);
  await expect(page.getByRole('heading', { name: 'Telegram' })).toBeInViewport();

  for (const old of ['aspetto', 'account']) {
    await page.goto(`/?mock=demo#/impostazioni?sezione=${old}`);
    await expect(page.getByRole('tab', { name: 'Generale' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/#\/impostazioni\?sezione=generale$/);
  }
  await expect(page.getByRole('switch', { name: 'Riduci movimento' })).toBeVisible();
});

test('one model for the whole team, or one per monster', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const chains = page.getByTestId('chains');
  // Everybody uses the same model in the demo: one editor, in words.
  await expect(chains.getByTestId('team-chain')).toBeVisible();
  await expect(chains.getByLabel('Modello 1 di tutti i mostri', { exact: true })).toHaveValue(
    'Gratuito, scelto da OpenRouter',
  );
  await expect(chains.getByTestId('model-id').first()).toHaveText('openrouter/free');
  // A single model is not a chain: nothing to move or take away.
  await expect(chains.getByRole('button', { name: /^Sposta su/ })).toBeHidden();
  await chains.getByTestId('chains-per-monster').click();
  await expect(chains.getByTestId('agent-chain-titan')).toBeVisible();
  await expect(chains.getByTestId('team-chain')).toHaveCount(0);
});

test('the arrows move between tabs, the URL follows, Back leaves the page', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  await page.getByRole('link', { name: 'Impostazioni' }).click();
  // The sidebar lights Impostazioni and nothing else (no chat, not Note or Attività).
  await expect(page.getByRole('link', { name: 'Impostazioni' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('sidebar').locator('[aria-current="page"]')).toHaveCount(1);
  const squadra = page.getByRole('tab', { name: 'Squadra' });
  await expect(squadra).toHaveAttribute('aria-selected', 'true');

  // Roving tabindex: Tab reaches the selected tab only.
  await squadra.focus();
  await expect(page.getByRole('tab', { name: 'Modelli' })).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowRight');
  const modelli = page.getByRole('tab', { name: 'Modelli' });
  await expect(modelli).toBeFocused();
  await expect(modelli).toHaveAttribute('aria-selected', 'true');
  await expect(modelli).toHaveAttribute('tabindex', '0');
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=modelli$/);

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Generale' })).toBeFocused();
  await expect(page.getByTestId('vault-path')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(squadra).toBeFocused();
  await expect(page).toHaveURL(/#\/impostazioni$/);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Generale' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Tab from the selected tab goes into its panel.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'Generale' })).toBeFocused();

  // Switching tabs adds no history: Back goes to the page before the settings.
  await page.goBack();
  await expect(page).toHaveURL(/#\/log$/);
});

test('a half-typed key survives a look at another tab', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const openrouter = page.getByTestId('provider-row-openrouter');
  // The new key only after "Cambia chiave".
  await expect(page.getByLabel('Nuova chiave')).toHaveCount(0);
  await openrouter.getByRole('button', { name: 'Cambia', exact: true }).click();
  await openrouter.getByRole('button', { name: 'Cambia chiave' }).click();
  await page.getByLabel('Nuova chiave').fill('sk-or-v1-mezza');
  await page.getByRole('tab', { name: 'Generale' }).click();
  await expect(page.getByRole('radio', { name: 'Scuro' })).toBeVisible();
  await page.getByRole('tab', { name: 'Modelli' }).click();
  await expect(page.getByLabel('Nuova chiave')).toHaveValue('sk-or-v1-mezza');
});

test.describe('narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the five tabs fit, none is cut', async ({ page }) => {
    await page.goto('/?mock=demo#/impostazioni?sezione=generale');
    const generale = page.getByRole('tab', { name: 'Generale' });
    await expect(generale).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Squadra', 'Modelli', 'Permessi', 'Collegamenti', 'Generale']) {
      await expect(page.getByRole('tab', { name })).toBeInViewport({ ratio: 1 });
    }
    // No sideways scroll of the page itself.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('tab', { name: 'Collegamenti' }).click();
    await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible();
  });
});
