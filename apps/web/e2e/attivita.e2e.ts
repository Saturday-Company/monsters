import { expect, test } from './fixtures.ts';

/* Attività after the visual review (D-066): the segment, "Rispondi", the phone's drawer. */

test('a question still open in Attività: "Rispondi" opens its chat', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  const row = page.getByTestId('event-row').filter({ hasText: 'Titan asked you a question' });
  await expect(row).toBeVisible();
  await row.getByTestId('answer-question').click();
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
  await expect(page.getByTestId('question-card').first()).toHaveAttribute('data-status', 'open');
});

test('the filters line up: "Chi" and the keys start on the same top edge', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  const who = await page.getByTestId('activity-who').boundingBox();
  const types = await page
    .getByRole('group', { name: 'Filter by type' })
    .getByRole('button')
    .first()
    .boundingBox();
  expect(who && types).toBeTruthy();
  expect(Math.abs(who!.y - types!.y)).toBeLessThanOrEqual(1);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('one "Filtri" key opens a drawer with who, the types and the period', async ({ page }) => {
    await page.goto('/?mock=demo#/log');
    await expect(page.getByTestId('activity-who')).toBeHidden();
    await page.getByRole('button', { name: /^Filters/ }).click();
    const drawer = page.getByTestId('activity-more');
    await expect(drawer.getByTestId('activity-who')).toBeVisible();
    await drawer.getByRole('button', { name: 'Errors' }).click();
    // The count of the filters on is on the key.
    await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
    for (const text of await page.getByTestId('event-row').allInnerTexts())
      expect(text).toMatch(/ERRORS/i);
    await drawer.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('button', { name: /^Filters/ })).not.toContainText('1');
  });

  test('a note named by date never breaks on its dash', async ({ page }) => {
    await page.goto('/?mock=demo#/log');
    const date = page
      .getByTestId('event-row')
      .filter({ hasText: 'the note 2026-10-14' })
      .locator('span.whitespace-nowrap', { hasText: '2026-10-14' });
    await expect(date).toBeVisible();
    const box = await date.boundingBox();
    // One line of text, not two.
    expect(box!.height).toBeLessThan(30);
  });
});
