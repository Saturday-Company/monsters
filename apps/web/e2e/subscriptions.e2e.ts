import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * Settings → Modelli, the plans (M2.7) on the mock core: "Continue with
 * ChatGPT" with the first-use modal and the "Using ChatGPT plan" indicator by
 * the composer; Abbonamento Claude with the terminal instructions only (no
 * login, no logo); Codex installed on request. A plan once on moves to "Con
 * cosa pensano i mostri". `SUBS_SHOTS=<dir>` also writes light and dark shots.
 */

/** Settings → Modelli with the list of what can still be connected open. */
async function openModels(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Connect another model' }).click();
  await expect(page.getByTestId('models-add')).toBeVisible();
}

const SHOTS = process.env['SUBS_SHOTS'];

async function signInChatGPT(page: Page) {
  const card = page.getByTestId('subscription-chatgpt');
  await expect(card.getByText('Use your ChatGPT plan', { exact: true })).toBeVisible();
  await expect(card).toContainText(
    'Complete eligible AI requests in this app with usage included in your ChatGPT plan or credits balance.',
  );
  // The sign-in opens the system browser: a popup here, closed at once.
  const popup = page.waitForEvent('popup');
  await card.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await (await popup).close();
  const modal = page.getByTestId('chatgpt-welcome');
  await expect(
    modal.getByRole('heading', { name: 'You’re using your ChatGPT plan' }),
  ).toBeVisible();
  await expect(modal).toContainText('Eligible usage in this app uses your ChatGPT plan.');
  return modal;
}

test('ChatGPT: continue with ChatGPT, first-use modal, a monster on the plan', async ({ page }) => {
  await openModels(page);
  await expect(
    page.getByRole('heading', { name: 'A subscription you already have' }),
  ).toBeVisible();
  // Subscriptions are not in the list of keys.
  await expect(page.getByTestId('provider-row-chatgpt')).toHaveCount(0);

  const modal = await signInChatGPT(page);
  await modal.getByRole('button', { name: 'Got it' }).click();
  await expect(modal).toBeHidden();
  const card = page.getByTestId('models-connected').getByTestId('subscription-chatgpt');
  await expect(card).toContainText('Connected as giulio@example.com');
  await expect(card.getByTestId('manage-usage')).toHaveAttribute(
    'href',
    'https://chatgpt.com/settings/usage',
  );

  // Titan on the ChatGPT plan.
  // Everybody shares one model at first (D-066): one chain per monster on request.
  await page.getByTestId('chains-per-monster').click();
  const titan = page.getByTestId('agent-chain-titan');
  await titan.getByLabel('Service 1 of Titan', { exact: true }).selectOption('chatgpt');
  await expect(titan.getByLabel('Model 1 of Titan', { exact: true })).toHaveValue('gpt-test');
  await expect(page.getByText('Titan’s models saved.')).toBeVisible();
});

test('ChatGPT plan indicator next to the composer', async ({ page }) => {
  await openModels(page);
  const modal = await signInChatGPT(page);
  await modal.getByRole('button', { name: 'Got it' }).click();
  // Everybody shares one model at first (D-066): one chain per monster on request.
  await page.getByTestId('chains-per-monster').click();
  const titan = page.getByTestId('agent-chain-titan');
  await titan.getByLabel('Service 1 of Titan', { exact: true }).selectOption('chatgpt');
  await expect(page.getByText('Titan’s models saved.')).toBeVisible();
  // Same page, same mock core: back to the dashboard through the app.
  await page.evaluate(() => (window.location.hash = '#/'));
  const indicator = page.getByTestId('chatgpt-plan-indicator');
  await expect(indicator).toContainText('Using ChatGPT plan');
  await expect(indicator.getByRole('link', { name: 'Manage usage' })).toHaveAttribute(
    'href',
    'https://chatgpt.com/settings/usage',
  );
  if (SHOTS) {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      await page
        .getByTestId('composer')
        .screenshot({ path: `${SHOTS}/composer-chatgpt-${theme}.png` });
    }
  }
});

test('Abbonamento Claude: plain label, terminal instructions, no login of ours', async ({
  page,
}) => {
  await openModels(page);
  const offer = page.getByTestId('subscription-claude');
  await expect(offer.getByText('Claude subscription', { exact: true })).toBeVisible();
  await expect(offer).toContainText('It uses Claude Code on the computer where Monsters runs');
  // No logo and no login button: the login is the user's, in a terminal.
  await expect(offer.locator('img, svg[role="img"]')).toHaveCount(0);
  await expect(offer.getByRole('button', { name: /accedi|login|sign in|continue/i })).toHaveCount(
    0,
  );

  await offer.getByRole('button', { name: 'Connect' }).click();
  // Turned on: among what the monsters think with, waiting for the login.
  const card = page.getByTestId('models-connected').getByTestId('subscription-claude');
  await expect(card).toContainText('Claude Code sign-in is missing');
  await expect(card.getByRole('button', { name: /accedi|login|sign in|continue/i })).toHaveCount(0);
  const hint = card.getByTestId('claude-terminal-hint');
  await expect(hint).toContainText('Open a terminal and run');
  await expect(hint.locator('code').first()).toHaveText('claude');
  if (SHOTS) {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      await page
        .getByTestId('models-connected')
        .screenshot({ path: `${SHOTS}/abbonamenti-claude-istruzioni-${theme}.png` });
    }
  }
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card).toContainText('Ready: the monsters you choose work with Claude Code');
  await expect(card.getByTestId('claude-terminal-hint')).toHaveCount(0);
});

test('Codex: needs ChatGPT, installed only on request', async ({ page }) => {
  await openModels(page);
  const codex = page.getByTestId('subscription-codex');
  await expect(codex).toContainText('Codex (for coding)');
  await expect(codex).toContainText('Connect ChatGPT first');
  await expect(codex.getByRole('button', { name: /Connect/ })).toHaveCount(0);
  const modal = await signInChatGPT(page);
  if (SHOTS) {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/chatgpt-modale-${theme}.png` });
    }
  }
  await modal.getByRole('button', { name: 'Got it' }).click();
  await expect(codex).toContainText('Apache-2.0');
  await codex.getByRole('button', { name: 'Install and connect' }).click();
  await expect(
    page.getByTestId('models-connected').getByTestId('subscription-codex'),
  ).toContainText('Ready: it uses your ChatGPT plan.');
  if (SHOTS) {
    await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
    await page
      .getByTestId('subscription-claude')
      .getByRole('button', { name: 'Check again' })
      .click();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      await page
        .getByTestId('models-connected')
        .screenshot({ path: `${SHOTS}/abbonamenti-attivi-${theme}.png` });
    }
  }
});
