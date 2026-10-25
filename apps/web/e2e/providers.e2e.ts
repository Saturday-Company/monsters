import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * Settings → Modelli (M2.2, wave C3) on the mock core: what is connected first, "Add a model" for
 * the rest (the plans and OpenRouter in view, the other accounts and the local servers in a
 * closed drawer); add a key (refused, then verified), connect a local server, choose the models
 * of a monster in Advanced (saved by itself).
 */

/** Advanced open, with one chain per monster. */
async function openChains(page: Page) {
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  await page.getByTestId('chains-per-monster').click();
}

test('providers: add a key, connect Ollama, choose the models of a monster', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const connected = page.getByTestId('models-connected');
  // An account, not a "service": the title says whose it is.
  await expect(connected.getByTestId('provider-row-openrouter')).toContainText(
    'OpenRouter account',
  );
  // The accounts not connected yet wait behind one button, and a drawer inside it.
  await expect(page.getByTestId('models-add')).toHaveCount(0);
  await connected.getByRole('button', { name: 'Add a model' }).click();
  await expect(page.getByTestId('models-add')).toBeVisible();
  await expect(page.getByTestId('providers')).toHaveCount(0);
  await page.getByTestId('models-add-more').getByRole('button').first().click();
  const section = page.getByTestId('providers');

  const anthropic = section.getByTestId('provider-row-anthropic');
  await expect(anthropic).toHaveAttribute('data-configured', 'no');
  await expect(anthropic).toContainText('Anthropic account');
  await anthropic.getByRole('button', { name: 'Add the key' }).click();
  // A paid provider says so before the key is saved.
  await expect(anthropic.getByTestId('paid-notice')).toContainText('Paid');
  const key = anthropic.getByLabel('Anthropic key');
  await key.fill('sk-ant-wrong-0123456789');
  await anthropic.getByRole('button', { name: 'Verify and save' }).click();
  await expect(anthropic.getByRole('alert')).toHaveText('Anthropic doesn’t recognize this key.');
  await key.fill('sk-ant-api03-0123456789abcdef');
  await anthropic.getByRole('button', { name: 'Verify and save' }).click();
  await expect(page.getByText('Anthropic key verified and saved.')).toBeVisible();
  // Now it is among what the monsters think with.
  const anthropicOn = connected.getByTestId('provider-row-anthropic');
  await expect(anthropicOn).toHaveAttribute('data-configured', 'yes');
  await expect(anthropicOn.getByText('Key active.')).toBeVisible();
  await expect(section.getByTestId('provider-row-anthropic')).toHaveCount(0);

  const ollama = section.getByTestId('provider-row-ollama');
  await ollama.getByRole('button', { name: 'Connect' }).click();
  const address = ollama.getByLabel('Ollama address');
  await address.fill('http://127.0.0.1:9999');
  await ollama.getByRole('button', { name: 'Connect' }).click();
  await expect(ollama.getByRole('alert')).toContainText('is it running?');
  await address.fill('http://127.0.0.1:11434');
  await ollama.getByRole('button', { name: 'Connect' }).click();
  await expect(connected.getByTestId('provider-row-ollama')).toHaveAttribute(
    'data-configured',
    'yes',
  );

  // Rhea: Anthropic first, the free router as fallback.
  // Everybody shares one model at first (D-066): one chain per monster, in Advanced.
  await openChains(page);
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByRole('button', { name: 'Add an alternative' }).click();
  await rhea.getByLabel('Account 1 of Rhea', { exact: true }).selectOption('anthropic');
  await expect(rhea.getByLabel('Model 1 of Rhea', { exact: true })).toHaveValue(
    'claude-sonnet-test',
  );
  await rhea.getByLabel('Model 1 of Rhea', { exact: true }).selectOption('claude-haiku-test');
  await rhea.getByLabel('Account 2 of Rhea', { exact: true }).selectOption('openrouter');
  await expect(rhea.getByLabel('Model 2 of Rhea', { exact: true })).toHaveValue(
    'Free, picked by OpenRouter',
  );
  await expect(rhea.getByTestId('paid-notice')).toBeVisible();
  // No save button: the chain saves itself a moment after the last change.
  await expect(rhea.getByRole('button', { name: /Save/ })).toHaveCount(0);
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();
  // What the core has now, read again from it (same mock core: through the app, no reload).
  await page.evaluate(() => (window.location.hash = '#/'));
  await expect(page.getByTestId('agent-chain-rhea')).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  const saved = page.getByTestId('agent-chain-rhea');
  await expect(saved.getByLabel('Model 1 of Rhea', { exact: true })).toHaveValue(
    'claude-haiku-test',
  );
  await expect(saved.getByLabel('Model 2 of Rhea', { exact: true })).toHaveValue(
    'Free, picked by OpenRouter',
  );

  // Removing the key (confirmed in place): Rhea's chain still names Anthropic, not connected.
  const anthropicRow = page.getByTestId('provider-row-anthropic');
  await anthropicRow.getByRole('button', { name: 'Disconnect' }).click();
  await anthropicRow.getByRole('button', { name: 'Yes, disconnect' }).click();
  await expect(page.getByText('Anthropic account disconnected.')).toBeVisible();
  await expect(
    page.getByTestId('models-connected').getByTestId('provider-row-anthropic'),
  ).toHaveCount(0);
  await expect(saved.getByLabel('Account 1 of Rhea', { exact: true })).toContainText(
    'Anthropic account (not connected)',
  );
});

test('OpenRouter: paid models are off by default, shown as not usable until turned on', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  // The one home of "paid models": a row of its own under the main model and the fallback.
  const paid = page.getByTestId('openrouter-paid');
  await expect(paid).toHaveAttribute('data-on', 'no');
  await expect(paid).toContainText('only free models');
  await expect(page.getByTestId('squad-models')).toContainText('Also use paid models');

  // A paid model as the main one: marked as not usable, the chain cannot be saved.
  const squad = page.getByTestId('squad-models');
  const first = squad.getByLabel('Main model', { exact: true });
  await first.fill('google/gemini-2.5-flash-lite');
  // What is typed searches; leaving the field makes it the model (an exact id).
  await first.blur();
  const blocked = squad.getByTestId('paid-blocked');
  await expect(blocked).toContainText('google/gemini-2.5-flash-lite');
  await expect(blocked).toContainText('OpenRouter now uses only free models');
  await expect(blocked.getByTestId('paid-notice')).toContainText('Paid');
  // Not saved while blocked.
  await page.waitForTimeout(1200);
  await expect(page.getByText('Squad models saved.')).toHaveCount(0);

  // Turned on from the notice, after the cost note: the chain saves, the switch follows.
  await blocked.getByRole('button', { name: 'Also use paid models' }).click();
  await expect(squad.getByTestId('paid-blocked')).toHaveCount(0);
  await expect(squad.getByTestId('paid-notice')).toBeVisible();
  await expect(page.getByText('Squad models saved.')).toBeVisible();
  await expect(paid).toHaveAttribute('data-on', 'yes');

  // Off from the switch at once; on again only after confirming the cost note.
  const toggle = paid.getByRole('switch', { name: 'Also use paid models' });
  await toggle.click();
  await expect(paid).toHaveAttribute('data-on', 'no');
  await toggle.click();
  await expect(paid.getByTestId('paid-notice')).toBeVisible();
  await expect(paid).toHaveAttribute('data-on', 'no');
  await paid.getByRole('button', { name: 'Turn on paid models' }).click();
  await expect(paid).toHaveAttribute('data-on', 'yes');
});

test('OpenRouter: a paid model in a monster’s chain (Advanced) is blocked the same way', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await openChains(page);
  const rhea = page.getByTestId('agent-chain-rhea');
  const first = rhea.getByLabel('Model 1 of Rhea', { exact: true });
  await first.fill('google/gemini-2.5-flash-lite');
  await first.blur();
  const blocked = rhea.getByTestId('paid-blocked');
  await expect(blocked).toContainText('OpenRouter now uses only free models');
  await page.waitForTimeout(1200);
  await expect(page.getByText('Rhea’s models saved.')).toHaveCount(0);
  await blocked.getByRole('button', { name: 'Also use paid models' }).click();
  await expect(rhea.getByTestId('paid-blocked')).toHaveCount(0);
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();
  await expect(page.getByTestId('openrouter-paid')).toHaveAttribute('data-on', 'yes');
});
