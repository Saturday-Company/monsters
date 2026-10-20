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
  await page.getByRole('button', { name: 'Collega un altro modello' }).click();
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
  await expect(page.getByRole('heading', { name: 'Un abbonamento che hai già' })).toBeVisible();
  // Subscriptions are not in the list of keys.
  await expect(page.getByTestId('provider-row-chatgpt')).toHaveCount(0);

  const modal = await signInChatGPT(page);
  await modal.getByRole('button', { name: 'Got it' }).click();
  await expect(modal).toBeHidden();
  const card = page.getByTestId('models-connected').getByTestId('subscription-chatgpt');
  await expect(card).toContainText('Collegato come giulio@example.com');
  await expect(card.getByTestId('manage-usage')).toHaveAttribute(
    'href',
    'https://chatgpt.com/settings/usage',
  );

  // Titan on the ChatGPT plan.
  // Everybody shares one model at first (D-066): one chain per monster on request.
  await page.getByTestId('chains-per-monster').click();
  const titan = page.getByTestId('agent-chain-titan');
  await titan.getByLabel('Servizio 1 di Titan', { exact: true }).selectOption('chatgpt');
  await expect(titan.getByLabel('Modello 1 di Titan', { exact: true })).toHaveValue('gpt-test');
  await expect(page.getByText('Modelli di Titan salvati.')).toBeVisible();
});

test('ChatGPT plan indicator next to the composer', async ({ page }) => {
  await openModels(page);
  const modal = await signInChatGPT(page);
  await modal.getByRole('button', { name: 'Got it' }).click();
  // Everybody shares one model at first (D-066): one chain per monster on request.
  await page.getByTestId('chains-per-monster').click();
  const titan = page.getByTestId('agent-chain-titan');
  await titan.getByLabel('Servizio 1 di Titan', { exact: true }).selectOption('chatgpt');
  await expect(page.getByText('Modelli di Titan salvati.')).toBeVisible();
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
  await expect(offer.getByText('Abbonamento Claude', { exact: true })).toBeVisible();
  await expect(offer).toContainText('Usa Claude Code sul computer dove gira Monsters');
  // No logo and no login button: the login is the user's, in a terminal.
  await expect(offer.locator('img, svg[role="img"]')).toHaveCount(0);
  await expect(offer.getByRole('button', { name: /accedi|login|sign in|continue/i })).toHaveCount(
    0,
  );

  await offer.getByRole('button', { name: 'Collega' }).click();
  // Turned on: among what the monsters think with, waiting for the login.
  const card = page.getByTestId('models-connected').getByTestId('subscription-claude');
  await expect(card).toContainText('Manca l’accesso a Claude Code');
  await expect(card.getByRole('button', { name: /accedi|login|sign in|continue/i })).toHaveCount(0);
  const hint = card.getByTestId('claude-terminal-hint');
  await expect(hint).toContainText('Apri un terminale ed esegui');
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
  await card.getByRole('button', { name: 'Ricontrolla' }).click();
  await expect(card).toContainText('Pronto: i mostri che scegli lavorano con Claude Code');
  await expect(card.getByTestId('claude-terminal-hint')).toHaveCount(0);
});

test('Codex: needs ChatGPT, installed only on request', async ({ page }) => {
  await openModels(page);
  const codex = page.getByTestId('subscription-codex');
  await expect(codex).toContainText('Codex (per programmare)');
  await expect(codex).toContainText('Collega prima ChatGPT');
  await expect(codex.getByRole('button', { name: /Collega/ })).toHaveCount(0);
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
  await codex.getByRole('button', { name: 'Installa e collega' }).click();
  await expect(
    page.getByTestId('models-connected').getByTestId('subscription-codex'),
  ).toContainText('Pronto: usa il tuo piano ChatGPT.');
  if (SHOTS) {
    await page.getByTestId('subscription-claude').getByRole('button', { name: 'Collega' }).click();
    await page
      .getByTestId('subscription-claude')
      .getByRole('button', { name: 'Ricontrolla' })
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
