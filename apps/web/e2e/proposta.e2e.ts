import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * A new monster proposed by the capo squadra (D-075) on the mock core: the card
 * in the chat, "Crea" (the API of Settings → Squadra), "Cambia" (the same form
 * filled in) and "Lascia stare". `PROPOSAL_SHOTS=<folder>` saves screenshots.
 */

const SHOTS = process.env['PROPOSAL_SHOTS'];

async function propose(page: Page) {
  // A team that already exists, with an empty chat: the account first.
  await page.goto('/?mock=team&mockSpeed=0.3');
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByLabel('Setup code').fill('424242');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('sidebar').waitFor();
  await page.evaluate(() => (window.location.hash = '#/?chat=titan'));
  const input = page.getByTestId('composer-input');
  await input.fill('Create a monster that keeps my ideas in order');
  await input.press('Enter');
  const card = page.getByTestId('proposal-card');
  await expect(card).toHaveAttribute('data-status', 'proposed');
  return card;
}

test('the capo proposes a monster; "Crea" adds it and the card leads to its chat', async ({
  page,
}) => {
  const card = await propose(page);
  await expect(card).toContainText('proposes a new monster');
  await expect(card).toContainText('Lyra');
  await expect(card).toContainText('keeps ideas in order');
  const details = card.getByTestId('proposal-details');
  await expect(details).toContainText('NOTES');
  await expect(details).toContainText('writes in Idee/');
  await expect(details).toContainText('same as Titan');
  // Every rule that "Crea" writes in its AGENTS.md is on the card (D-079).
  await expect(card.getByTestId('proposal-duties').getByRole('listitem')).toHaveText([
    'One note per idea, with links to the nearby notes.',
  ]);
  await expect(details).toContainText('no terminal or files');
  await expect(details).toContainText('Services');
  // Not in the team before the tap.
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Lyra,/ })).toHaveCount(0);
  if (SHOTS) {
    await expect(page.getByText('create her with one tap')).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/proposta-${theme}.png`, animations: 'disabled' });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }

  await card.getByTestId('proposal-create').click();
  await expect(card).toHaveAttribute('data-status', 'created');
  await expect(card).toContainText('Created: Lyra');
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Lyra,/ })).toBeVisible();
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/proposta-creata.png` });
  await card.getByTestId('proposal-open-chat').click();
  await expect(page).toHaveURL(/chat=lyra/);
});

test('"Cambia" opens the form of Settings → Squadra with the draft', async ({ page }) => {
  const card = await propose(page);
  await card.getByTestId('proposal-change').click();
  const form = page.getByTestId('team-draft');
  await expect(form).toBeVisible();
  await expect(form).toContainText('Your lead proposed it');
  await expect(form.getByLabel('Name')).toHaveValue('Lyra');
  await expect(form.getByLabel('Role, in one line')).toHaveValue('keeps ideas in order');
  await expect(form.getByLabel('Where it writes in the notes')).toHaveValue('Idee');
  await form.getByLabel('Name').fill('Vega');
  await form.getByRole('button', { name: 'Add to the squad' }).click();
  await expect(page.getByText('Vega is on the squad')).toBeVisible();
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Vega,/ })).toBeVisible();
  // Back in the chat, the card says what happened, with the name chosen in the form.
  await page.goBack();
  const again = page.getByTestId('proposal-card');
  await expect(again).toHaveAttribute('data-status', 'created');
  await expect(again).toContainText('Created: Vega');
});

test('"Lascia stare" closes the card without creating anything', async ({ page }) => {
  const card = await propose(page);
  await card.getByTestId('proposal-discard').click();
  await expect(card).toHaveAttribute('data-status', 'discarded');
  await expect(card).toContainText('Left alone');
  await expect(card.getByTestId('proposal-create')).toHaveCount(0);
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Lyra,/ })).toHaveCount(0);
});
