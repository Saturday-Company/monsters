import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import { answerQuestions, createAccount } from './onboarding-helpers.ts';

/*
 * Sign-in and first start after the UX audit (section 2) on the mock core:
 * every proposal that changed a behaviour has its check here.
 */

test('sign-in: the forgotten password explains the two ways back (D-057, 2.13)', async ({
  page,
}) => {
  await page.goto('/?mock=1');
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByRole('button', { name: 'Create account' }).click();
  // The missing code: where to find it, without assuming a terminal.
  await expect(page.getByText('Enter the setup code')).toContainText('monsters start');
  await page.getByLabel('Setup code').fill(MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  // Signing out is a small key on the rail, not among the steps (2.14, UI-39).
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const forgot = page.getByRole('button', { name: 'I forgot my password' });
  await expect(forgot).toHaveAttribute('aria-expanded', 'false');
  await forgot.click();
  const help = page.getByTestId('forgot-password');
  await expect(help).toContainText('you’ll be signed in without a password');
  await expect(help.locator('code')).toHaveText('monsters password');
});

test('one connected model is enough, whatever card is open (2.2, 2.16)', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  // Before its name is chosen the guide is "il tuo primo mostro".
  await expect(page.getByText('Your first monster')).toBeVisible();
  const go = page.getByTestId('access-continue');
  const says = page.getByTestId('guide-says');
  await page.getByRole('radio', { name: /ChatGPT plan/ }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await (await popup).close();
  await page.getByTestId('chatgpt-welcome').getByRole('button', { name: 'Got it' }).click();
  await expect(says).toContainText('your ChatGPT plan');
  // Nothing left for later once a model is connected (audit UI-18).
  await expect(page.getByRole('button', { name: 'I’ll do it later' })).toHaveCount(0);
  // Looking at another card does not lose the plan.
  await page.getByRole('radio', { name: /Free models/ }).click();
  await expect(go).toBeEnabled();
  await expect(says).toContainText('Done! Now I think with your ChatGPT plan');
  await go.click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await expect(page.getByText('Your first monster')).toBeVisible();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Giulio');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.locator('[data-question="lavoro"]')).toBeVisible();
  await expect(page.getByText('Titan · your lead')).toBeVisible();
});

test('a key of another provider is recognised and used (2.5)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('radio', { name: /Free models/ }).click();
  await page.getByLabel('Your OpenRouter key').fill('sk-ant-api03-prova-prova');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  const offer = page.getByTestId('key-offer');
  await expect(offer).toContainText('This is a Anthropic key: shall I use it for the monsters?');
  await offer.getByRole('button', { name: 'Yes, use it' }).click();
  await expect(page.getByTestId('other-ways').getByTestId('access-connected')).toContainText(
    'Anthropic key verified',
  );
  await expect(page.getByTestId('guide-says')).toContainText('Anthropic');
  await page.getByTestId('access-continue').click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await answerQuestions(page);
  await page.getByRole('button', { name: /Looks good, continue/ }).click();
  await page.getByRole('button', { name: /Confirm the squad/ }).click();
  await page.getByRole('button', { name: /^Message / }).click();
  await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
  // The team moved to the Anthropic key: a model is connected.
  await expect(page.getByTestId('no-model')).toHaveCount(0);
});

test('"Lo faccio dopo" leaves the model step to do (2.3)', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'I’ll do it later' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  const first = page.getByRole('navigation', { name: 'Progress' }).getByRole('listitem').first();
  await expect(first).toHaveAttribute('data-done', 'no');
  await expect(first).toHaveAttribute('data-todo', 'yes');
  await expect(first).toContainText('to do');
});

test.describe('who writes software', () => {
  test.use({ locale: 'de-DE' });

  test('chips of the work, terminal on, language of the system (2.7, 2.9, 2.11, 2.12)', async ({
    page,
  }) => {
    // German browser: the app speaks only English and Italian, so it falls back to English (D-153).
    await page.goto('/?mock=1');
    await createAccount(page, MOCK_SETUP_CODE);
    await page.getByRole('button', { name: 'I’ll do it later' }).click();
    await page.getByRole('textbox', { name: 'Your name' }).fill('Giulio');
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.locator('[data-question="lavoro"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fixing bugs' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Software development' }).click();
    await expect(page.getByRole('button', { name: 'Fixing bugs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Understanding new code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Planning content' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Writing tests' }).click();
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.locator('[data-question="regole"]')).toBeVisible();
    await expect(page.getByTestId('guide-says')).toContainText('Two more things');
    await expect(page.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'permissions');
    await expect(page.getByRole('switch', { name: 'Terminal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('without administrator rights')).toBeVisible();
  });
});
