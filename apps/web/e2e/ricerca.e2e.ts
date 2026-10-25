import { expect, expectNoSideScroll, test } from './fixtures.ts';

/* Settings → Apps and Telegram → Web search, the paid search row (D-071): the paid search on OpenRouter. */

test('paid search: off with free models, one lever on, the engine, and back off', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  // One group: the free search (and the Brave key) first, the paid search second.
  const group = page.getByTestId('web-search');
  await expect(group.getByRole('heading', { name: 'Web search' })).toBeVisible();
  await expect(group.getByTestId('brave-key-status')).toContainText('DuckDuckGo');
  const row = group.getByTestId('paid-search-row');
  // Untouched, it follows "Usa anche modelli a pagamento" (off): free search, cost said.
  await expect(row).toHaveAttribute('data-on', 'no');
  await expect(page.getByTestId('paid-search-status')).toContainText('Off');
  await expect(page.getByTestId('paid-search-status')).toContainText('($1.1) per 1,000');
  await expect(group.getByRole('radiogroup')).toHaveCount(0);
  // Paid models are Models' to switch (C8): here, the reason and a link, not a second switch.
  await expect(page.getByTestId('paid-search-status')).toContainText('because paid models are off');
  await expect(
    row.getByTestId('paid-search-models').getByRole('link', { name: 'Models' }),
  ).toHaveAttribute('href', '#/impostazioni?sezione=modelli');

  const lever = row.getByRole('switch', { name: 'Paid search' });
  await lever.click();
  await expect(row).toHaveAttribute('data-on', 'yes');
  await expect(row).toHaveAttribute('data-active', 'yes');
  await expect(page.getByText('Paid search on, right away.')).toBeVisible();
  await expect(page.getByTestId('paid-search-status')).toContainText('more reliable results');

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

  // The free-search row above says where the searches go now.
  await expect(page.getByTestId('brave-key-status')).toContainText(
    'take over when paid search is off',
  );

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
