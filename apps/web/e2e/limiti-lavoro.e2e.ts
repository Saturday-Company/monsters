import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Limits of each job (D-064) on the mock core: a closed row under the spending cap in
 * Settings → Models, with the steps, tokens and cost that stop a job that runs away, for the
 * models paid per use and for the subscriptions. Change a value, see it kept when the row is
 * opened again, restore the defaults. (The core keeping them across a restart is a core test.)
 */

/** `LIMITI_LAVORO_SHOTS=<folder>` writes light and dark shots of the open row, wide and on a phone. */
const SHOTS = process.env['LIMITI_LAVORO_SHOTS'];

test.beforeEach(async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await expect(page.getByTestId('spend-section')).toBeVisible();
});

const toggle = (page: Page) =>
  page.getByTestId('limits-toggle').locator('button[aria-expanded]').first();

test('the row is closed, under the spending cap, and opens to the fields with their defaults', async ({
  page,
}) => {
  const row = page.getByTestId('limits-row');
  await expect(row).toContainText('Limits of each job');
  await expect(row).toContainText('A safety net against a job that runs away.');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('limits-form')).toHaveCount(0);

  await toggle(page).click();
  const form = page.getByTestId('limits-form');
  await expect(form).toBeVisible();
  await expect(form).toContainText('protect your plan’s quota');
  await expect(form.getByTestId('limits-steps')).toHaveValue('150');
  await expect(form.getByTestId('limits-tokens')).toHaveValue('1500000');
  await expect(form.getByTestId('limits-agent-tokens')).toHaveValue('400000');
  await expect(form.getByTestId('limits-cost')).toHaveValue('0.5');
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

test('change a value, open the row again and it is kept; restore the defaults', async ({
  page,
}) => {
  await toggle(page).click();
  const steps = page.getByTestId('limits-plan-steps');
  await steps.fill('800');
  await page.getByTestId('limits-cost').fill('1,5');
  await expect(page.getByTestId('limits-save')).toBeEnabled();
  await page.getByTestId('limits-save').click();
  await expect(page.getByText('Limits saved. New jobs use them.')).toBeVisible();
  await expect(page.getByTestId('limits-save')).toBeDisabled();
  await expect(page.getByTestId('limits-reset')).toBeEnabled();

  // Closed and opened again: the form reads the core, which kept them.
  await toggle(page).click();
  await expect(page.getByTestId('limits-form')).toHaveCount(0);
  await toggle(page).click();
  await expect(page.getByTestId('limits-plan-steps')).toHaveValue('800');
  await expect(page.getByTestId('limits-cost')).toHaveValue('1.5');
  await expect(page.getByTestId('limits-steps')).toHaveValue('150');
  // The default stays on view under each field.
  await expect(page.getByTestId('limits-plan')).toContainText('Default: 400');

  await page.getByTestId('limits-reset').click();
  await expect(page.getByText('Limits back to the defaults.')).toBeVisible();
  await expect(page.getByTestId('limits-plan-steps')).toHaveValue('400');
  await expect(page.getByTestId('limits-cost')).toHaveValue('0.5');
  await expect(page.getByTestId('limits-reset')).toBeDisabled();
});

test('a number out of range is refused with the field and the range, nothing is saved', async ({
  page,
}) => {
  await toggle(page).click();
  await page.getByTestId('limits-tokens').fill('12');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-error')).toContainText('Tokens per job: type a number');
  await expect(page.getByTestId('limits-tokens')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('limits-tokens').fill('2000000');
  await page.getByTestId('limits-steps').fill('');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-error')).toContainText('Steps per job: type a number');
});

test('a link to the section opens the row', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=limiti');
  await expect(page.getByTestId('limits-form')).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
});
