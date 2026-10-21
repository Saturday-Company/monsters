import { expect, expectNoSideScroll, test } from './fixtures.ts';

/* Settings → Collegamenti → Ricerca a pagamento (D-071): the paid search on OpenRouter. */

test('paid search: off with free models, one lever on, the engine, and back off', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const group = page.getByTestId('paid-search');
  await expect(group.getByRole('heading', { name: 'Ricerca a pagamento' })).toBeVisible();
  const row = page.getByTestId('paid-search-row');
  // Untouched, it follows "Usa anche modelli a pagamento" (off): free search, cost said.
  await expect(row).toHaveAttribute('data-on', 'no');
  await expect(page.getByTestId('paid-search-status')).toContainText('DuckDuckGo e Wikipedia');
  await expect(page.getByTestId('paid-search-status')).toContainText('(1,1 $) ogni 1.000');
  await expect(group.getByRole('radiogroup')).toHaveCount(0);

  const lever = row.getByRole('switch', { name: 'Ricerca a pagamento' });
  await lever.click();
  await expect(row).toHaveAttribute('data-on', 'yes');
  await expect(row).toHaveAttribute('data-active', 'yes');
  await expect(page.getByText('Ricerca a pagamento accesa, da subito.')).toBeVisible();
  await expect(page.getByTestId('paid-search-status')).toContainText('cercano con OpenRouter');

  const engines = group.getByRole('radiogroup', { name: 'Motore della ricerca a pagamento' });
  await expect(engines.getByRole('radio', { name: /Economica/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await engines.getByRole('radio', { name: /Precisa/ }).click();
  await expect(engines.getByRole('radio', { name: /Precisa/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('paid-search-status')).toContainText('(7,1 $) ogni 1.000');

  // The free-search group above says where the searches go now.
  await expect(page.getByTestId('brave-key-status')).toContainText('cercano con OpenRouter');

  await page.getByTestId('paid-search-row').getByRole('switch').click();
  await expect(page.getByTestId('paid-search-row')).toHaveAttribute('data-on', 'no');
  await expect(page.getByTestId('paid-search-status')).toContainText('Spenta');
});

test('paid search fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const row = page.getByTestId('paid-search-row');
  await row.getByRole('switch').click();
  await expect(row).toHaveAttribute('data-on', 'yes');
  await expectNoSideScroll(page);
});
