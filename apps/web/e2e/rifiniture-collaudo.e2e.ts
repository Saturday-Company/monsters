import { expect, test } from './fixtures.ts';

/*
 * Fixes of the final test (collaudo of 19/10) on the mock core: the card of a proposed project
 * stays inside its column, the chain of caps wraps in pairs and warns about a cap above the one
 * that holds it, "Si riparte" is not the preview of every chat. `SCREENSHOTS=<folder>` writes
 * the screens.
 */

const SHOTS = process.env['SCREENSHOTS'];
const SIZES = [
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
];

for (const size of SIZES) {
  test.describe(`${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the card of a proposed project does not leave its column', async ({ page }) => {
      await page.goto('/?mock=demo');
      await page.getByTestId('review-toggle').click();
      const card = page.getByTestId('draft-card').filter({ hasText: 'Sito di Saturday' });
      await expect(card.getByTestId('draft-plan-folder')).toBeVisible();
      const sheet = await page.getByTestId('review-drafts').boundingBox();
      for (const id of ['draft-plan-folder', 'draft-plan-summary', 'draft-title'] as const) {
        const box = await card.getByTestId(id).boundingBox();
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(sheet!.x + sheet!.width);
      }
      const whole = await card.boundingBox();
      expect(whole!.x + whole!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/da-rivedere-${size.name}.png` });
    });

    test('the chain of caps keeps each "≤" with what follows and warns about a high cap', async ({
      page,
    }) => {
      await page.goto('/?mock=demo#/impostazioni?sezione=tetto');
      await page.getByTestId('spend-caps-day').fill('3');
      await page.getByTestId('spend-caps-save').click();
      await expect(page.getByTestId('spend-day-display')).toContainText('/ 3 €');
      await page
        .getByTestId('spend-agents')
        .getByRole('button', { name: /Per mostro/ })
        .click();
      const rhea = page.getByTestId('spend-agent-rhea');
      await rhea.getByTestId('spend-caps-rhea-day').fill('9');
      await rhea.getByTestId('spend-caps-rhea-save').click();
      const chain = page.getByTestId('spend-chain');
      await expect(chain.getByTestId('spend-chain-warning')).toContainText(
        'più alto del tetto della squadra: scatta prima quello',
      );
      // A "≤" is never alone at the end of a line: it sits on the same row as its link.
      const rows = await chain.locator('span[aria-hidden]:text("≤")').evaluateAll((signs) =>
        signs.map((s) => {
          const next = s.nextElementSibling!.getBoundingClientRect();
          const me = s.getBoundingClientRect();
          return Math.abs(next.top - me.top) < next.height;
        }),
      );
      expect(rows.length).toBe(2);
      expect(rows.every(Boolean)).toBe(true);
      await chain.scrollIntoViewIfNeeded();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/tetti-${size.name}.png` });
    });
  });
}

test('after "Riprendi" only a chat that took a job up again says so', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('kill')).toBeVisible();
  await expect(page.getByTestId('chat-row').first()).toBeVisible();
  await expect(
    page.getByTestId('chat-row').filter({ hasText: 'Si riparte: i mostri sono di nuovo liberi' }),
  ).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dopo-riprendi-1440.png` });
});
