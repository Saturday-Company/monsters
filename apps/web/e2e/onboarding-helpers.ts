import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/* Steps of the first start, shared by the mock and the real-core tests. */

export async function createAccount(page: Page, code: string): Promise<void> {
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByLabel('Setup code').fill(code);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
}

export async function question(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-testid="question"][data-question="${id}"]`)).toBeVisible();
}

export async function next(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Next/ }).click();
}

/**
 * The model step with the OpenRouter key (mock: any `sk-or-…` key is accepted):
 * "Verifica e continua" checks it and moves on to the next step by itself.
 */
export async function connectOpenRouter(page: Page, key = 'sk-or-v1-prova-prova'): Promise<void> {
  await page.getByRole('radio', { name: /Free models/ }).click();
  await page.getByLabel('Your OpenRouter key').fill(key);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
}

/** The three screens of "Su di te" before the permissions: names, work, rules and tone. */
export async function answerQuestions(
  page: Page,
  opts: { user?: string; orchestrator?: string; shot?: (name: string) => Promise<void> } = {},
): Promise<void> {
  await question(page, 'nomi');
  await page.getByRole('textbox', { name: 'Your name' }).fill(opts.user ?? 'Giulio');
  if (opts.orchestrator)
    await page.getByRole('textbox', { name: 'Your lead’s name' }).fill(opts.orchestrator);
  await opts.shot?.('domanda-nomi');
  await next(page);

  await question(page, 'lavoro');
  await page.getByRole('button', { name: 'Social media and content' }).click();
  await page.getByLabel('In your own words (if you like)').fill('I follow three restaurants');
  await page.getByRole('button', { name: 'Online research' }).click();
  await page.getByRole('button', { name: 'Planning content' }).click();
  await opts.shot?.('domanda-lavoro');
  await next(page);

  await question(page, 'regole');
  // Publish, contact, spend and delete are always asked: a fact, not chips (audit 2.8).
  await expect(page.getByTestId('ask-always-fixed')).toContainText('we always ask you first');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Direct' }).click();
  await opts.shot?.('domanda-regole');
  await next(page);
}
