import type { Page } from '@playwright/test';
import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import { answerNames, connectOpenRouter, createAccount } from './onboarding-helpers.ts';

/*
 * After the express first start: the "Tell me more about you" card and the row of first
 * jobs in the lead's chat, once it has answered. Mock core (`?mock=1`).
 */

/** The whole first start, then the first message and its answer. */
async function firstAnswer(page: Page): Promise<void> {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await connectOpenRouter(page);
  await answerNames(page);
  await page.getByRole('button', { name: 'Looks good' }).click();
  await page.getByRole('button', { name: /^Message / }).click();
  // Before any message: the greeting and its three first ideas, no card yet.
  await expect(page.getByTestId('suggestions')).toBeVisible();
  await expect(page.getByTestId('first-steps')).toHaveCount(0);
  const input = page.getByTestId('composer-input');
  await input.fill('hello');
  await input.press('Enter');
  // The mock's lead asks a question before it answers; the card waits for the answer, as it
  // would not interrupt a question on a real core.
  await expect(page.getByText('What tone should we give the posts?')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('first-steps')).toHaveCount(0);
  await input.fill('A');
  await input.press('Enter');
  await expect(page.getByTestId('first-steps')).toBeVisible({ timeout: 40_000 });
}

test('after the first answer: first jobs in one row, and a skippable card', async ({ page }) => {
  test.setTimeout(90_000);
  await firstAnswer(page);

  // The three chips of the greeting are gone; one compact row of other first jobs is there
  // (the key to open the card is in it once the card is closed).
  await expect(page.getByTestId('suggestions')).toHaveCount(0);
  const jobs = page.getByTestId('first-jobs');
  await expect(jobs.getByRole('button')).toHaveText([
    'Summarize my latest notes',
    'Draft a reply to…',
    'Make a plan for…',
  ]);
  await jobs.getByRole('button', { name: 'Draft a reply to…' }).click();
  await expect(page.getByTestId('composer-input')).toHaveValue('Draft a reply to ');

  // The card comes as a short invitation that leaves the answer in sight; "Tell me more" opens it
  // with the fields the old questions had: work, what eats your time, what they always ask,
  // tone, writing language.
  const invite = page.getByTestId('tell-more-invite');
  await expect(invite).toContainText('Tell me more about you');
  await expect(page.getByTestId('tell-more')).toHaveCount(0);
  await invite.getByRole('button', { name: 'Tell me more' }).click();
  await expect(invite).toHaveCount(0);
  const card = page.getByTestId('tell-more');
  await expect(card.getByRole('heading', { name: 'Tell me more about you' })).toBeVisible();
  await expect(card.getByRole('group', { name: 'Your work' }).getByRole('button')).toHaveCount(7);
  await expect(card.getByRole('group', { name: 'What eats your time' })).toBeVisible();
  await expect(card.getByRole('radiogroup', { name: 'Tone' }).getByRole('radio')).toHaveCount(4);
  await expect(
    card.getByRole('radiogroup', { name: 'Monsters’ writing language' }).getByRole('radio'),
  ).toHaveCount(5);
  // "Also ask me before" is a list (V-11): the four always-asked kinds, the one that can be
  // added, and a free text.
  const ask = card.getByTestId('tell-more-ask');
  await expect(
    ask.getByRole('list', { name: 'Always asked first' }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(ask.getByRole('button', { name: /a goal/ })).toBeVisible();
  await expect(ask.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    /before touching my work files/,
  );
  // What eats your time follows the work chosen.
  await expect(card.getByRole('button', { name: 'Fixing bugs' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Software development' }).click();
  await expect(card.getByRole('button', { name: 'Fixing bugs' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Planning content' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Software development' }).click();
  await card.getByRole('button', { name: 'Social media and content' }).click();
  await card.getByLabel('In your own words (if you like)').fill('I follow three restaurants');
  await card.getByRole('button', { name: 'Online research' }).click();
  await card.getByRole('button', { name: /a goal/ }).click();
  await card.getByRole('radio', { name: 'Direct' }).click();
  await card.getByRole('button', { name: 'Save' }).click();

  // Saved to the profile: the card goes, the way to the settings stays, and the tone is there.
  await expect(card).toHaveCount(0);
  const saved = page.getByTestId('tell-more-saved');
  await expect(saved).toContainText('Saved');
  await expect(jobs.getByRole('button', { name: 'Tell me more about you' })).toHaveCount(0);
  await saved.getByRole('link', { name: 'Settings → Squad → You' }).click();
  await expect(page.getByTestId('team-you').getByRole('combobox').first()).toBeVisible();
  await expect(page.getByTestId('team-you').getByRole('combobox').first()).toHaveValue('diretto');
});

test('"Not now" answers the card empty; the row brings it back', async ({ page }) => {
  test.setTimeout(90_000);
  await firstAnswer(page);
  const invite = page.getByTestId('tell-more-invite');
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Not now' }).click();
  await expect(invite).toHaveCount(0);
  // Still one key away, in the row; it opens the form itself.
  const card = page.getByTestId('tell-more');
  await expect(card).toHaveCount(0);
  const again = page
    .getByTestId('first-jobs')
    .getByRole('button', { name: 'Tell me more about you' });
  await again.click();
  await expect(card).toBeVisible();
  // Closing it a second time changes nothing.
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  await expect(again).toBeVisible();
});

test('the card has a link of its own, and only the lead’s chat has it', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  // The demo has told the monsters already: no card by itself…
  await expect(page.getByTestId('tell-more')).toHaveCount(0);
  // …but the link opens it (a settings page or a message can point here).
  await page.goto('/?mock=demo#/?chat=titan&profilo=1');
  await expect(page.getByTestId('tell-more')).toBeVisible();
  // A member's chat never shows it.
  await page.goto('/?mock=demo#/?chat=rhea&profilo=1');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect(page.getByTestId('tell-more')).toHaveCount(0);
});

test.describe('a German browser', () => {
  test.use({ locale: 'de-DE' });

  test('writes in German unless told otherwise; the card says so', async ({ page }) => {
    test.setTimeout(90_000);
    // The app has no German words (D-153): it speaks English, the monsters write in German.
    await firstAnswer(page);
    await page
      .getByTestId('tell-more-invite')
      .getByRole('button', { name: 'Tell me more' })
      .click();
    const card = page.getByTestId('tell-more');
    await expect(
      card.getByRole('radiogroup', { name: 'Monsters’ writing language' }).getByRole('radio', {
        name: 'Deutsch',
      }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
