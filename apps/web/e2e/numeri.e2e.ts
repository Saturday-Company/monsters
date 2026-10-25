import { expect, test } from './fixtures.ts';

/*
 * Numbers typed in a field are read by the language of the app (review W-3): in English "1,000"
 * is a thousand, not one, and what cannot be read for sure is refused with a field error instead
 * of being truncated.
 */

test.use({ viewport: { width: 1440, height: 900 } });

test('a spending cap typed "1,000" is saved as 1000, not 1', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=tetto');
  await page.getByTestId('spend-caps-month').fill('1,000');
  await page.getByTestId('spend-caps-save').click();
  await expect(page.getByText('Spending cap saved.')).toBeVisible();
  await expect(page.getByTestId('spend-caps-month')).toHaveValue('1000');
});

test('a cap that could be read two ways is refused on its field', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=tetto');
  await page.getByTestId('spend-caps-month').fill('1.000');
  await page.getByTestId('spend-caps-save').click();
  await expect(page.getByTestId('spend-section').getByRole('alert')).toContainText(
    'Type an amount in euros',
  );
  await expect(page.getByTestId('spend-caps-month')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('spend-caps-day')).not.toHaveAttribute('aria-invalid', 'true');
});

test('a run limit typed "2,000" steps is saved as 2000', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=limiti');
  await expect(page.getByTestId('limits-form')).toBeVisible();
  await page.getByTestId('limits-steps').fill('2,000');
  await page.getByTestId('limits-tokens').fill('200,000');
  await page.getByTestId('limits-save').click();
  await expect(page.getByText('Limits saved. New jobs use them.')).toBeVisible();
  await expect(page.getByTestId('limits-steps')).toHaveValue('2000');
  await expect(page.getByTestId('limits-tokens')).toHaveValue('200000');
});

test('a run limit that is malformed is refused, nothing is saved', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=limiti');
  await expect(page.getByTestId('limits-form')).toBeVisible();
  await page.getByTestId('limits-steps').fill('1,00,0');
  await page.getByTestId('limits-save').click();
  await expect(page.getByTestId('limits-error')).toContainText('Steps per job');
  await expect(page.getByTestId('limits-steps')).toHaveAttribute('aria-invalid', 'true');
});
