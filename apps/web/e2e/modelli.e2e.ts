import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The choice of the model (D-093) on the mock core: a select of the service's
 * models with one line each and "Altro…", a searchable list for OpenRouter,
 * "Automatica" on the Claude plan (per monster, and for the whole team with
 * each monster on its own base), the receipt that says which model and why.
 */

/** Settings → Modelli with the Claude plan connected. */
async function withClaude(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Connect another model' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByTestId('models-connected').getByTestId('subscription-claude'),
  ).toBeVisible();
}

test('the Claude models are a select with what each one is, and "Altro…"', async ({ page }) => {
  await withClaude(page);
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByLabel('Service 1 of Rhea', { exact: true }).selectOption('claude-agent');
  const model = rhea.getByLabel('Model 1 of Rhea', { exact: true });
  // Sonnet by default; the whole list is there whatever is chosen (no datalist filtering).
  await expect(model).toHaveValue('sonnet');
  await expect(model.locator('option')).toHaveText([
    'Haiku · fast',
    'Sonnet · balanced',
    'Opus · the most capable',
    'Other…',
  ]);
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();
  await model.selectOption('opus');
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();

  // A name that is not in the list.
  await model.selectOption({ label: 'Other…' });
  const other = rhea.getByTestId('model-other');
  await expect(other).toBeFocused();
  await other.fill('claude-opus-5-5');
  await expect(model).toHaveValue('__other__');
  // Saved by itself a moment after the last change.
  await page.waitForTimeout(1200);
  await expect(rhea.getByText('Saving…')).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  const saved = page.getByTestId('agent-chain-rhea');
  await expect(saved.getByTestId('model-other')).toHaveValue('claude-opus-5-5');
});

test('OpenRouter: a list that searches as you type, the whole list when it opens', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const team = page.getByTestId('team-chain');
  const field = team.getByLabel('Model 1 of all the monsters', { exact: true });
  // The field says the model as people say it, the id is the detail below (U-8).
  await expect(field).toHaveValue('Free, picked by OpenRouter');
  await expect(team.getByTestId('model-id')).toHaveText('openrouter/free');
  await field.click();
  const list = team.getByRole('listbox');
  // The current model does not filter the list: every model shows.
  await expect(list.getByRole('option')).toHaveCount(3);
  await field.fill('gemini');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('paid, not enabled');
  await field.fill('gpt-oss');
  await field.press('Enter');
  await expect(field).not.toHaveValue('openai/gpt-oss-120b:free');
  await expect(team.getByTestId('model-id')).toHaveText('openai/gpt-oss-120b:free');
  await expect(list).toHaveCount(0);
  await expect(page.getByText('Squad models saved.')).toBeVisible();

  // A Backspace on the readable name, then away: the model stays the id it was (review 19/10).
  await field.press('End');
  await field.press('Backspace');
  await expect(list).toBeVisible();
  await field.blur();
  await expect(team.getByTestId('model-id')).toHaveText('openai/gpt-oss-120b:free');
  await expect(team.getByTestId('model-unknown')).toHaveCount(0);
});

test('"Automatica": for the whole team each monster on its base, then one per monster', async ({
  page,
}) => {
  await withClaude(page);
  const team = page.getByTestId('team-chain');
  await team.getByRole('switch', { name: 'Automatic model choice for all the monsters' }).click();
  await expect(team.getByTestId('auto-team')).toContainText(
    'Each monster starts from its own base',
  );
  await expect(page.getByText('Squad models saved.')).toBeVisible();

  // One per monster: everyone from Media, the capo squadra too (D-110): Sonnet, Opus Alto when hard.
  await page.getByTestId('chains-per-monster').click();
  const titan = page.getByTestId('agent-chain-titan');
  const rhea = page.getByTestId('agent-chain-rhea');
  await expect(titan).toHaveAttribute('data-auto', 'medium');
  await expect(titan.getByTestId('auto-line')).toHaveText(
    'Usually Sonnet (medium effort) · hard → Opus (high effort)',
  );
  await expect(rhea).toHaveAttribute('data-auto', 'medium');
  await expect(rhea.getByTestId('auto-line')).toHaveText(
    'Usually Sonnet (medium effort) · hard → Opus (high effort)',
  );

  // Rhea on Leggera: kept by the core, shown as "Automatica" again after a visit elsewhere.
  await rhea.getByRole('radio', { name: 'Light' }).click();
  await expect(rhea.getByTestId('auto-line')).toHaveText(
    'Usually Haiku · hard → Sonnet (medium effort)',
  );
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  // Everybody in "Automatica" is one choice: one editor again, one per monster on request.
  await expect(page.getByTestId('team-chain')).toHaveAttribute('data-auto', 'medium');
  await page.getByTestId('chains-per-monster').click();
  await expect(page.getByTestId('agent-chain-rhea')).toHaveAttribute('data-auto', 'light');

  // Off: the chain it had, to change by hand, with the tier of each link in words.
  const again = page.getByTestId('agent-chain-rhea');
  await again.getByRole('switch', { name: 'Automatic model choice for Rhea' }).click();
  await expect(again).toHaveAttribute('data-auto', 'off');
  await expect(again.getByLabel('Model 1 of Rhea', { exact: true })).toHaveValue('haiku');
  await expect(again.getByTestId('link-tier')).toHaveText([
    'For simple requests',
    'For hard requests',
  ]);
});

test('the receipt says which model worked and why', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const receipt = page.getByTestId('receipt').first();
  await expect(receipt).toHaveAttribute('data-open', 'true');
  await expect(receipt.getByTestId('receipt-model').first()).toHaveText(
    'Titan · Hard → llama 3.3 70b',
  );
});
