import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/* Steps of the first start, shared by the mock and the real-core tests. */

export async function createAccount(page: Page, code: string): Promise<void> {
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByLabel('Codice di avvio').fill(code);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
}

export async function question(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-testid="question"][data-question="${id}"]`)).toBeVisible();
}

export async function next(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Avanti/ }).click();
}

/**
 * The model step with the OpenRouter key (mock: any `sk-or-…` key is accepted):
 * "Verifica e continua" checks it and moves on to the next step by itself.
 */
export async function connectOpenRouter(page: Page, key = 'sk-or-v1-prova-prova'): Promise<void> {
  await page.getByRole('radio', { name: /Modelli gratuiti/ }).click();
  await page.getByLabel('La tua chiave di OpenRouter').fill(key);
  await page.getByRole('button', { name: 'Verifica e continua' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
}

/** The three screens of "Su di te" before the permissions: names, work, rules and tone. */
export async function answerQuestions(
  page: Page,
  opts: { user?: string; orchestrator?: string; shot?: (name: string) => Promise<void> } = {},
): Promise<void> {
  await question(page, 'nomi');
  await page.getByRole('textbox', { name: 'Il tuo nome' }).fill(opts.user ?? 'Giulio');
  if (opts.orchestrator)
    await page.getByRole('textbox', { name: 'Il nome del tuo capo' }).fill(opts.orchestrator);
  await opts.shot?.('domanda-nomi');
  await next(page);

  await question(page, 'lavoro');
  await page.getByRole('button', { name: 'Social e contenuti' }).click();
  await page.getByLabel('In parole tue (se vuoi)').fill('Seguo tre ristoranti');
  await page.getByRole('button', { name: 'Ricerche online' }).click();
  await page.getByRole('button', { name: 'Pianificare i contenuti' }).click();
  await opts.shot?.('domanda-lavoro');
  await next(page);

  await question(page, 'regole');
  // Publish, contact, spend and delete are always asked: a fact, not chips (audit 2.8).
  await expect(page.getByTestId('ask-always-fixed')).toContainText('te lo chiediamo sempre');
  await expect(page.getByRole('button', { name: 'Pubblicare', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Diretto' }).click();
  await opts.shot?.('domanda-regole');
  await next(page);
}
