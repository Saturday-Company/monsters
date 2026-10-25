import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The choice of the model (D-093, wave C3) on the mock core. Up front, for the whole squad: "Main
 * model" and "If it doesn't answer, use" (a select of the account's models with one line each and
 * "Other…", a searchable list for OpenRouter). In Advanced: one chain per monster, "Automatic"
 * on the Claude plan (for the whole team with each monster on its own base), the tiers Quick /
 * Balanced / Thorough, and the receipt that says which model and why.
 */

/** Settings → Modelli with the Claude plan connected. */
async function withClaude(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Add a model' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByTestId('models-connected').getByTestId('subscription-claude'),
  ).toBeVisible();
}

/** Advanced open (closed until asked for). */
async function openAdvanced(page: Page) {
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  await expect(page.getByTestId('chains-list')).toBeVisible();
}

test('the Claude models are a select with what each one is, and "Other…"', async ({ page }) => {
  await withClaude(page);
  await openAdvanced(page);
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByLabel('Account 1 of Rhea', { exact: true }).selectOption('claude-agent');
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
  // Half a name is not saved, however long the pause (W-19): only Enter or leaving the field.
  await other.fill('claude-opus-');
  await page.waitForTimeout(1200);
  await expect(page.getByText('Rhea’s models saved.')).toHaveCount(0);
  await other.fill('claude-opus-5-5');
  await expect(model).toHaveValue('__other__');
  await other.press('Enter');
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();
  await expect(rhea.getByText('Saving…')).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await openAdvanced(page);
  const saved = page.getByTestId('agent-chain-rhea');
  await expect(saved.getByTestId('model-other')).toHaveValue('claude-opus-5-5');
});

test('OpenRouter: a list that searches as you type, the whole list when it opens', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const squad = page.getByTestId('squad-main');
  const field = squad.getByLabel('Main model', { exact: true });
  // Until the list of OpenRouter has come the field is a plain one: the search starts with the list.
  await expect(squad.getByRole('combobox', { name: 'Main model' })).toBeVisible();
  // The field says the model as people say it, the id is the detail below (U-8).
  await expect(field).toHaveValue('Free, picked by OpenRouter');
  await expect(squad.getByTestId('model-id')).toHaveText('openrouter/free');
  await field.click();
  const list = squad.getByRole('listbox');
  // The current model does not filter the list: every model shows.
  await expect(list.getByRole('option')).toHaveCount(3);
  await field.fill('gemini');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('paid, not enabled');
  await field.fill('gpt-oss');
  await field.press('Enter');
  await expect(field).not.toHaveValue('openai/gpt-oss-120b:free');
  await expect(squad.getByTestId('model-id')).toHaveText('openai/gpt-oss-120b:free');
  await expect(list).toHaveCount(0);
  await expect(page.getByText('Squad models saved.')).toBeVisible();

  // A Backspace on the readable name, then away: the model stays the id it was (review 19/10).
  await field.press('End');
  await field.press('Backspace');
  await expect(list).toBeVisible();
  await field.blur();
  await expect(squad.getByTestId('model-id')).toHaveText('openai/gpt-oss-120b:free');
  await expect(squad.getByTestId('model-unknown')).toHaveCount(0);
});

test('main model and fallback: one account with models of its own, a fallback added and taken away', async ({
  page,
}) => {
  await withClaude(page);
  const main = page.getByTestId('squad-main');
  const fallback = page.getByTestId('squad-fallback');
  // Two accounts on: the account is asked about, and the main model is one of its own.
  await main.getByLabel('Account of the main model', { exact: true }).selectOption('claude-agent');
  await expect(main.getByLabel('Main model', { exact: true })).toHaveValue('sonnet');
  await expect(page.getByText('Squad models saved.')).toBeVisible();

  // No fallback yet: one button. It starts on the other account.
  await expect(fallback.getByLabel('Fallback model', { exact: true })).toHaveCount(0);
  await fallback.getByRole('button', { name: 'Add a fallback' }).click();
  await expect(fallback.getByLabel('Account of the fallback model', { exact: true })).toHaveValue(
    'openrouter',
  );
  await expect(fallback.getByLabel('Fallback model', { exact: true })).toHaveValue(
    'Free, picked by OpenRouter',
  );

  // Read again from the core, the same for every monster: Advanced shows the chain of the squad.
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await expect(
    page.getByTestId('squad-fallback').getByLabel('Fallback model', { exact: true }),
  ).toBeVisible();
  await openAdvanced(page);
  const team = page.getByTestId('team-chain');
  await expect(team.getByLabel('Model 1 of all the monsters', { exact: true })).toHaveValue(
    'sonnet',
  );
  await expect(team.getByLabel('Model 2 of all the monsters', { exact: true })).toHaveValue(
    'Free, picked by OpenRouter',
  );

  // Taken away: back to one model.
  await page
    .getByTestId('squad-fallback')
    .getByRole('button', { name: 'Remove the fallback' })
    .click();
  await expect(
    page.getByTestId('squad-fallback').getByRole('button', { name: 'Add a fallback' }),
  ).toBeVisible();
  await expect(team.getByLabel('Model 2 of all the monsters', { exact: true })).toHaveCount(0);
});

test('changing the main model keeps the other links of the chain', async ({ page }) => {
  await withClaude(page);
  await openAdvanced(page);
  const team = page.getByTestId('team-chain');
  await team.getByRole('button', { name: 'Add an alternative' }).click();
  await team.getByRole('button', { name: 'Add an alternative' }).click();
  await expect(team.getByLabel('Model 3 of all the monsters', { exact: true })).toBeVisible();
  await expect(page.getByText('Squad models saved.')).toBeVisible();

  // The simple view shows two and says there is one more; changing the main one leaves it alone.
  const squad = page.getByTestId('squad-models');
  await expect(squad.getByTestId('squad-more')).toContainText('One more alternative');
  await squad.getByLabel('Account of the main model', { exact: true }).selectOption('claude-agent');
  await expect(team.getByLabel('Account 1 of all the monsters', { exact: true })).toHaveValue(
    'claude-agent',
  );
  await expect(team.getByLabel('Model 3 of all the monsters', { exact: true })).toBeVisible();
  await expect(squad.getByTestId('squad-more')).toContainText('One more alternative');
});

test('monsters with different chains: the simple view says so and opens Advanced', async ({
  page,
}) => {
  await withClaude(page);
  await openAdvanced(page);
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByLabel('Account 1 of Rhea', { exact: true }).selectOption('claude-agent');
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();

  // Never a lie: no main model of "everyone" while Rhea has another one.
  const squad = page.getByTestId('squad-models');
  await expect(squad.getByLabel('Main model', { exact: true })).toHaveCount(0);
  await expect(squad).toContainText('Different for some monsters');
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  await expect(page.getByTestId('chains-list')).toHaveCount(0);
  await squad.getByRole('button', { name: 'Change in Advanced' }).click();
  await expect(page.getByTestId('chains-list')).toBeVisible();
  await expect(page.getByTestId('agent-chain-rhea')).toBeVisible();
});

test('"Automatic": for the whole team each monster on its base, then one per monster', async ({
  page,
}) => {
  await withClaude(page);
  await openAdvanced(page);
  const team = page.getByTestId('team-chain');
  await team.getByRole('switch', { name: 'Automatic model choice for all the monsters' }).click();
  await expect(team.getByTestId('auto-team')).toContainText(
    'Your lead and the monsters that work on the computer start from Thorough',
  );
  await expect(page.getByText('Squad models saved.')).toBeVisible();
  // Up front it is not a model to pick: it says it is chosen for each request.
  await expect(page.getByTestId('squad-models')).toContainText('Chosen for each request');

  // One per monster: everyone Balanced, the squad lead too (D-110): Sonnet, Opus when thorough.
  await page.getByTestId('chains-per-monster').click();
  const titan = page.getByTestId('agent-chain-titan');
  const rhea = page.getByTestId('agent-chain-rhea');
  await expect(titan).toHaveAttribute('data-auto', 'medium');
  await expect(titan.getByTestId('auto-line')).toHaveText(
    'Usually Sonnet (medium effort) · thorough → Opus (high effort)',
  );
  await expect(rhea).toHaveAttribute('data-auto', 'medium');
  await expect(rhea.getByTestId('auto-line')).toHaveText(
    'Usually Sonnet (medium effort) · thorough → Opus (high effort)',
  );
  // "Automatic" needs the expert model, which is off in the demo: the row says so, with the way.
  const needs = titan.getByTestId('auto-needs-expert');
  await expect(needs).toContainText('Needs the expert model');
  await expect(needs.getByTestId('auto-expert-link')).toHaveAttribute(
    'href',
    '#/impostazioni?sezione=istinto',
  );

  // Rhea on Quick: kept by the core, shown as "Automatic" again after a visit elsewhere.
  await rhea.getByRole('radio', { name: 'Quick' }).click();
  await expect(rhea.getByTestId('auto-line')).toHaveText(
    'Usually Haiku · thorough → Sonnet (medium effort)',
  );
  await expect(page.getByText('Rhea’s models saved.')).toBeVisible();
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await openAdvanced(page);
  // Everybody in "Automatic" is one choice: one editor again, one per monster on request.
  await expect(page.getByTestId('team-chain')).toHaveAttribute('data-auto', 'medium');
  await page.getByTestId('chains-per-monster').click();
  await expect(page.getByTestId('agent-chain-rhea')).toHaveAttribute('data-auto', 'light');

  // Off: the chain it had, to change by hand, with the tier of each link in words.
  const again = page.getByTestId('agent-chain-rhea');
  await again.getByRole('switch', { name: 'Automatic model choice for Rhea' }).click();
  await expect(again).toHaveAttribute('data-auto', 'off');
  await expect(again.getByLabel('Model 1 of Rhea', { exact: true })).toHaveValue('haiku');
  await expect(again.getByTestId('link-tier')).toHaveText([
    'For quick requests',
    'For thorough requests',
  ]);
});

test('"Automatic" with the expert model on: no "Needs" row', async ({ page }) => {
  await withClaude(page);
  // The expert model (a TypeSafe key) on, set on the mock core as Squad → Advanced would.
  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        __monstersMock: { handle: (m: string, p: string, b: unknown) => unknown };
      }
    ).__monstersMock;
    mock.handle('PUT', '/api/settings/typesafe-key', { key: 'ts-0123456789abcdef' });
    mock.handle('PUT', '/api/settings/instinct', { engine: 'jev' });
  });
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await openAdvanced(page);
  const team = page.getByTestId('team-chain');
  await team.getByRole('switch', { name: 'Automatic model choice for all the monsters' }).click();
  await expect(team.getByTestId('auto-team')).toBeVisible();
  // The core was asked and the expert model is on: no "Needs" row, only the plan-limit line.
  await expect(team.getByTestId('auto-expert')).toHaveAttribute('data-state', 'ready');
  await expect(team.getByTestId('auto-needs-expert')).toHaveCount(0);
  await expect(team).toContainText('If Opus reaches the plan’s limit');
});

test('the receipt says which model worked and why', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const receipt = page.getByTestId('receipt').first();
  await expect(receipt).toHaveAttribute('data-open', 'true');
  await expect(receipt.getByTestId('receipt-model').first()).toHaveText(
    'Titan · Hard → llama 3.3 70b',
  );
});

test('"Same for everyone" with one monster refused: what was saved shows, and the refused one is named', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  const squad = page.getByTestId('squad-main');
  await expect(squad).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __monstersMock: { failRequests: (m: string) => void } }
    ).__monstersMock.failRequests('PUT /api/agents/rhea/models'),
  );
  const field = squad.getByLabel('Main model', { exact: true });
  // Typed before the list of OpenRouter has come, "gpt-oss" would be taken as the exact model
  // name: that was the flake under load. The search starts with the list.
  await expect(squad.getByRole('combobox', { name: 'Main model' })).toBeVisible();
  await field.fill('gpt-oss');
  await field.press('Enter');
  // The others took it; Rhea did not, and the page says so: different for some monsters.
  await expect(
    page.getByRole('alert').filter({ hasText: 'but not for Rhea' }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('squad-models')).toContainText('Different for some monsters');
  await expect(page.getByTestId('squad-main')).toHaveCount(0);
  await openAdvanced(page);
  await expect(page.getByTestId('team-chain')).toHaveCount(0);
  await expect(page.getByTestId('agent-chain-dione').getByTestId('model-id')).toHaveText(
    'openai/gpt-oss-120b:free',
  );
  await expect(page.getByTestId('agent-chain-rhea').getByTestId('model-id')).toHaveText(
    'openrouter/free',
  );
});
