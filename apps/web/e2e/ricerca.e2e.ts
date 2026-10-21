import { expect, expectNoSideScroll, test } from './fixtures.ts';

/* Settings → Collegamenti → Ricerca a pagamento (D-071): the paid search on OpenRouter. */

test('paid search: off with free models, one lever on, the engine, and back off', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const group = page.getByTestId('paid-search');
  await expect(group.getByRole('heading', { name: 'Paid search' })).toBeVisible();
  const row = page.getByTestId('paid-search-row');
  // Untouched, it follows "Usa anche modelli a pagamento" (off): free search, cost said.
  await expect(row).toHaveAttribute('data-on', 'no');
  await expect(page.getByTestId('paid-search-status')).toContainText('DuckDuckGo and Wikipedia');
  await expect(page.getByTestId('paid-search-status')).toContainText('($1.1) per 1,000');
  await expect(group.getByRole('radiogroup')).toHaveCount(0);

  const lever = row.getByRole('switch', { name: 'Paid search' });
  await lever.click();
  await expect(row).toHaveAttribute('data-on', 'yes');
  await expect(row).toHaveAttribute('data-active', 'yes');
  await expect(page.getByText('Paid search on, right away.')).toBeVisible();
  await expect(page.getByTestId('paid-search-status')).toContainText('search with OpenRouter');

  const engines = group.getByRole('radiogroup', { name: 'Paid search engine' });
  await expect(engines.getByRole('radio', { name: /Cheap/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await engines.getByRole('radio', { name: /Precise/ }).click();
  await expect(engines.getByRole('radio', { name: /Precise/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('paid-search-status')).toContainText('($7.1) per 1,000');

  // The free-search group above says where the searches go now.
  await expect(page.getByTestId('brave-key-status')).toContainText('search with OpenRouter');

  await page.getByTestId('paid-search-row').getByRole('switch').click();
  await expect(page.getByTestId('paid-search-row')).toHaveAttribute('data-on', 'no');
  await expect(page.getByTestId('paid-search-status')).toContainText('Off');
});

test('paid search fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const row = page.getByTestId('paid-search-row');
  await row.getByRole('switch').click();
  await expect(row).toHaveAttribute('data-on', 'yes');
  await expectNoSideScroll(page);
});
