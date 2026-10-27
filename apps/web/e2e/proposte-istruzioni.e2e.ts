import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Proposals for CLAUDE.md and AGENTS.md of a project's folder (D-113) on the
 * mock core: the demo has Iapetus' change to CLAUDE.md of "Social di
 * Saturday" (ready) and Calypso's to AGENTS.md (written after a web page, the
 * file changed since: it cannot be applied). `MONSTERS_E2E_SHOTS=<folder>`
 * saves the screenshots.
 */

const SHOTS = process.env['MONSTERS_E2E_SHOTS'];

test('Proposte per le istruzioni: the diff in Da rivedere, Applica; a stale one cannot be applied', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await page.getByTestId('review-toggle').click();
  const cards = page.locator('[data-testid="draft-card"][data-kind="docs"]');
  await expect(cards).toHaveCount(2);

  // In words first (F-14): the sentence, the reason; the file and the diff are behind "Show changes".
  const iapetus = cards.filter({
    hasText: 'Iapetus wants to change the instructions of Saturday Social',
  });
  await expect(iapetus).toContainText('Iapetus proposes a change to the instructions');
  await expect(iapetus.getByTestId('docs-diff')).toHaveCount(0);
  await iapetus.getByTestId('docs-changes-toggle').click();
  await expect(iapetus).toContainText('CLAUDE.md');
  // The path reads ~/…; the whole one is for screen readers and the tooltip.
  await expect(iapetus.getByTestId('path').locator('span[aria-hidden="true"]')).toHaveText(
    '~/Projects/social-saturday',
  );
  await expect(iapetus).toContainText('/home/andrea/Projects/social-saturday');
  const diff = iapetus.getByTestId('docs-diff');
  await expect(diff).toContainText('+- Every post has 3 to 5 hashtags, always #saturdaycompany.');
  await expect(diff).toContainText('-- Every post has at most 5 hashtags.');
  await expect(iapetus.getByTestId('docs-tainted')).toHaveCount(0);
  await expect(iapetus.getByTestId('draft-edit')).toHaveCount(0);

  // The warnings are never behind the key.
  const calypso = cards.filter({
    hasText: 'Calypso wants to change the instructions of Saturday Social',
  });
  await expect(calypso.getByTestId('docs-tainted')).toContainText(
    'Proposed after reading third-party text (web page: a social media agency’s blog)',
  );
  await expect(calypso.getByTestId('docs-stale')).toContainText('The file changed');
  await expect(calypso.getByTestId('draft-confirm')).toBeDisabled();
  await expect(calypso.getByTestId('draft-discard')).toHaveText('Leave it');
  if (SHOTS) {
    await iapetus.screenshot({ path: `${SHOTS}/istruzioni-scheda-chiaro.png` });
    await calypso.screenshot({ path: `${SHOTS}/istruzioni-scheda-vecchia-chiaro.png` });
  }

  await iapetus.getByTestId('draft-confirm').click();
  await expect(page.getByText('I updated the instructions: Saturday Social.')).toBeVisible();
  await expect(cards).toHaveCount(1);
});

test('Proposte per le istruzioni: on the project page, in its Settings, and left aside', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=cartella');
  const list = page.getByTestId('project-docs-drafts');
  await expect(list.getByTestId('draft-card')).toHaveCount(2);
  await list.getByTestId('docs-changes-toggle').first().click();
  await expect(list.getByTestId('docs-diff').first()).toBeVisible();
  // No side scroll on the phone, the diff scrolls inside its screen.
  await expectNoSideScroll(page, 390);
  if (SHOTS) {
    await list
      .getByTestId('draft-card')
      .first()
      .screenshot({
        path: `${SHOTS}/istruzioni-progetto-scuro.png`,
      });
  }

  const calypso = list.getByTestId('draft-card').filter({ hasText: 'Calypso wants' });
  await calypso.getByTestId('draft-discard').click();
  await expect(
    page.getByText(
      'I left the proposal alone: the instructions stay as they were (Saturday Social).',
    ),
  ).toBeVisible();
  await expect(list.getByTestId('draft-card')).toHaveCount(1);
});
