import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * The safety net, the limits of each job (D-064, C2) on the mock core: a closed row under the
 * spending cap in Settings → Models. Opened, three keys (Careful / Normal / Generous, or "Custom"
 * when the values match none); the steps, tokens, cost (in euros) and delegations one by one sit in
 * the Advanced drawer "Exact limits", for the models paid per use and, apart, for the plans. Change
 * a value, see it kept when the row is opened again, restore the defaults. (The core keeping them
 * across a restart is a core test; the presets as values are a unit test of the shared package.)
 */

/** `LIMITI_LAVORO_SHOTS=<folder>` writes light and dark shots of the open row, wide and on a phone. */
const SHOTS = process.env['LIMITI_LAVORO_SHOTS'];

/** The mock core's rate of the spending cap ($1 = €0.86): the default job cost of $0.50 is €0.43. */
const RATE = 0.86;

interface MockHooks {
  __monstersMock: { handle(method: string, path: string, body: unknown): { body: unknown } };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await expect(page.getByTestId('spend-section')).toBeVisible();
});

const toggle = (page: Page) =>
  page.getByTestId('limits-toggle').locator('button[aria-expanded]').first();
const exactToggle = (page: Page) => page.getByTestId('limits-exact').getByRole('button').first();
const presets = (page: Page) => page.getByTestId('limits-presets');
const openExact = async (page: Page) => {
  await exactToggle(page).click();
  await expect(page.getByTestId('limits-form')).toBeVisible();
};
/** The limits as the core keeps them (the cost in dollars). */
const coreLimits = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as MockHooks).__monstersMock.handle('GET', '/api/settings/limits', {})
        .body,
  ) as Promise<{ limits: { maxRunCostUsd: number; maxRunSteps: number } }>;

test('the row is closed, under the spending cap, and opens to three keys; the exact fields are behind a drawer', async ({
  page,
}) => {
  const row = page.getByTestId('limits-row');
  await expect(row).toContainText('Safety net');
  await expect(row).toContainText('A safety net against a job that runs away.');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('limits-presets')).toHaveCount(0);

  await toggle(page).click();
  const group = presets(page).getByRole('radiogroup', {
    name: 'How much a job may do before it stops',
  });
  await expect(group.getByRole('radio')).toHaveText(['Careful', 'Normal', 'Generous']);
  await expect(group.getByRole('radio', { name: 'Normal' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Euros only, never the dollars of the core; no tokens nor steps on the first layer.
  const hint = page.getByTestId('limits-preset-hint');
  await expect(hint).toContainText(`about €${(0.5 * RATE).toFixed(2)} of paid models`);
  await expect(hint).toContainText('Claude and ChatGPT plans keep their own limits.');
  await expect(row).not.toContainText('$');
  await expect(row).not.toContainText('Tokens');
  await expect(row).not.toContainText('Steps');
  await expect(page.getByTestId('limits-custom')).toHaveCount(0);

  // The drawer is Advanced, closed, with the fields inside.
  await expect(page.getByTestId('limits-exact')).toHaveAttribute('data-advanced', 'true');
  await expect(exactToggle(page)).toContainText('Exact limits');
  await expect(exactToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('limits-form')).toHaveCount(0);

  await openExact(page);
  const form = page.getByTestId('limits-form');
  await expect(form.getByTestId('limits-steps')).toHaveValue('150');
  await expect(form.getByTestId('limits-tokens')).toHaveValue('1500000');
  await expect(form.getByTestId('limits-agent-tokens')).toHaveValue('400000');
  // The cost of a job in euros, as the spending cap counts it.
  await expect(form.getByTestId('limits-cost')).toHaveValue('0.43');
  await expect(form.getByText('Cost per job (€)')).toBeVisible();
  await expect(form.getByTestId('limits-delegations')).toHaveValue('12');
  await expect(form.getByTestId('limits-plan-steps')).toHaveValue('400');
  await expect(form.getByTestId('limits-plan-tokens')).toHaveValue('5000000');
  await expect(form.getByTestId('limits-plan-agent-tokens')).toHaveValue('1500000');
  await expect(form.getByTestId('limits-plan')).toContainText(
    'Claude Code, Codex and the ChatGPT plan',
  );
  await expect(page.getByTestId('limits-save')).toBeDisabled();
  await expect(page.getByTestId('limits-reset')).toBeDisabled();
  await expectNoSideScroll(page);

  if (SHOTS) {
    for (const [name, size] of [
      ['wide', { width: 1280, height: 1100 }],
      ['phone', { width: 390, height: 1400 }],
    ] as const) {
      await page.setViewportSize(size);
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.waitForTimeout(250);
        await page
          .getByTestId('limits-row')
          .screenshot({ path: `${SHOTS}/limiti-lavoro-${name}-${theme}.png` });
      }
    }
  }
});

test('the keys set the limits at once: Careful, Generous, back to Normal; the plan caps stay', async ({
  page,
}) => {
  await toggle(page).click();
  const key = (name: string) => presets(page).getByRole('radio', { name });

  await key('Careful').click();
  await expect(page.getByText('Careful safety net. New jobs use it.')).toBeVisible();
  await expect(key('Careful')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('limits-preset-hint')).toContainText('Stops a job early');
  // Half of the usual cost, in euros: $0.25 at the cap's rate.
  await expect(page.getByTestId('limits-preset-hint')).toContainText(/about €0\.2[12] of paid/);
  expect((await coreLimits(page)).limits.maxRunCostUsd).toBe(0.25);
  await openExact(page);
  await expect(page.getByTestId('limits-steps')).toHaveValue('75');
  await expect(page.getByTestId('limits-tokens')).toHaveValue('750000');
  await expect(page.getByTestId('limits-agent-tokens')).toHaveValue('200000');
  await expect(page.getByTestId('limits-delegations')).toHaveValue('6');
  await expect(page.getByTestId('limits-plan-steps')).toHaveValue('400');

  await key('Generous').click();
  await expect(key('Generous')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('limits-steps')).toHaveValue('450');
  await expect(page.getByTestId('limits-tokens')).toHaveValue('4500000');
  await expect(page.getByTestId('limits-delegations')).toHaveValue('36');
  await expect(page.getByTestId('limits-plan-steps')).toHaveValue('400');
  expect((await coreLimits(page)).limits.maxRunCostUsd).toBe(1.5);

  await key('Normal').click();
  await expect(key('Normal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('limits-steps')).toHaveValue('150');
  await expect(page.getByTestId('limits-cost')).toHaveValue('0.43');
  await expect(page.getByTestId('limits-reset')).toBeDisabled();
});

test('a value of your own shows Custom; a key brings it back; the plan caps are part of it', async ({
  page,
}) => {
  await toggle(page).click();
  await openExact(page);
  await page.getByTestId('limits-plan-steps').fill('800');
  // Euros are typed and read back in euros; the core keeps dollars.
  await page.getByTestId('limits-cost').fill('1,29');
  await expect(page.getByTestId('limits-save')).toBeEnabled();
  await page.getByTestId('limits-save').click();
  await expect(page.getByText('Limits saved. New jobs use them.')).toBeVisible();
  await expect(page.getByTestId('limits-save')).toBeDisabled();
  await expect(page.getByTestId('limits-reset')).toBeEnabled();
  expect((await coreLimits(page)).limits.maxRunCostUsd).toBe(1.5);

  // None of the keys is pressed, and the row says Custom.
  await expect(page.getByTestId('limits-custom')).toHaveText('Custom');
  await expect(page.getByTestId('limits-preset-hint')).toContainText('Your own values');
  await expect(presets(page).locator('[aria-checked="true"]')).toHaveCount(0);

  // Closed and opened again: the form reads the core, which kept them.
  await toggle(page).click();
  await expect(page.getByTestId('limits-presets')).toHaveCount(0);
  await toggle(page).click();
  await expect(page.getByTestId('limits-custom')).toBeVisible();
  await openExact(page);
  await expect(page.getByTestId('limits-plan-steps')).toHaveValue('800');
  await expect(page.getByTestId('limits-cost')).toHaveValue('1.29');
  await expect(page.getByTestId('limits-steps')).toHaveValue('150');
  // The default stays on view under each field, the cost's in euros too.
  await expect(page.getByTestId('limits-plan')).toContainText('Default: 400');
  await expect(page.getByTestId('limits-api')).toContainText('Default: 0.43');

  // A key replaces everything, the plan caps included.
  await presets(page).getByRole('radio', { name: 'Normal' }).click();
  await expect(page.getByTestId('limits-custom')).toHaveCount(0);
  await expect(page.getByTestId('limits-plan-steps')).toHaveValue('400');
  await expect(page.getByTestId('limits-cost')).toHaveValue('0.43');
  expect((await coreLimits(page)).limits.maxRunCostUsd).toBe(0.5);

  // "Restore the defaults" does the same from a custom value.
  await page.getByTestId('limits-steps').fill('151');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-custom')).toBeVisible();
  await page.getByTestId('limits-reset').click();
  await expect(page.getByText('Limits back to the defaults.')).toBeVisible();
  await expect(page.getByTestId('limits-steps')).toHaveValue('150');
  await expect(page.getByTestId('limits-custom')).toHaveCount(0);
  await expect(presets(page).getByRole('radio', { name: 'Normal' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('limits-reset')).toBeDisabled();
});

test('a number out of range is refused with the field and the range, nothing is saved', async ({
  page,
}) => {
  await toggle(page).click();
  await openExact(page);
  await page.getByTestId('limits-tokens').fill('12');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-error')).toContainText('Tokens per job: type a number');
  await expect(page.getByTestId('limits-tokens')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('limits-tokens').fill('2000000');
  await page.getByTestId('limits-steps').fill('');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-error')).toContainText('Steps per job: type a number');
  // The cost's range is in euros too.
  await page.getByTestId('limits-steps').fill('150');
  await page.getByTestId('limits-cost').fill('9000');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-error')).toContainText(
    'Cost per job (€): type a number between 0.01 and 8,600.',
  );
  expect((await coreLimits(page)).limits.maxRunSteps).toBe(150);
});

test('a link to the section opens the row and its exact limits', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=limiti');
  await expect(page.getByTestId('limits-form')).toBeVisible();
  await expect(presets(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(exactToggle(page)).toHaveAttribute('aria-expanded', 'true');
});

test('in Italian: Rete di sicurezza, Prudente / Normale / Largo, euros', async ({ page }) => {
  await page.goto('/?mock=demo&lang=it#/impostazioni?sezione=modelli');
  await expect(page.getByTestId('spend-section')).toBeVisible();
  const row = page.getByTestId('limits-row');
  await expect(row).toContainText('Rete di sicurezza');
  await toggle(page).click();
  await expect(presets(page).getByRole('radio')).toHaveText(['Prudente', 'Normale', 'Largo']);
  await expect(page.getByTestId('limits-preset-hint')).toContainText('circa 0,43 €');
  await presets(page).getByRole('radio', { name: 'Largo' }).click();
  await expect(page.getByText('Rete di sicurezza «Largo». I nuovi lavori la usano.')).toBeVisible();
  await openExact(page);
  await expect(page.getByTestId('limits-cost')).toHaveValue('1,29');
  await expect(row).toContainText('Costo per lavoro (€)');
  await page.getByTestId('limits-cost').fill('1,3');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-custom')).toHaveText('Personalizzato');
});
