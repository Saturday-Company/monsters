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

/**
 * The names screen, the only question of the express first start: yours, and the lead's
 * (already "Titan"). Ends on the squad screen.
 */
export async function answerNames(
  page: Page,
  opts: { user?: string; orchestrator?: string; shot?: (name: string) => Promise<void> } = {},
): Promise<void> {
  await question(page, 'nomi');
  await page.getByRole('textbox', { name: 'Your name' }).fill(opts.user ?? 'Giulio');
  if (opts.orchestrator)
    await page.getByRole('textbox', { name: 'Your lead’s name' }).fill(opts.orchestrator);
  await opts.shot?.('nomi');
  await next(page);
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'team');
}

/**
 * Records every screen the first start shows (`data-step` of the module) and every click of the
 * user from now on, in the page: `startedAt` is read back with `walked`.
 */
export async function watchWalk(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __walk: { steps: string[]; clicks: number } };
    const root = document.querySelector('[data-testid="onboarding"]');
    w.__walk = { steps: root ? [root.getAttribute('data-step') ?? ''] : [], clicks: 0 };
    document.addEventListener(
      'click',
      (e) => {
        if (e.isTrusted) w.__walk.clicks++;
      },
      true,
    );
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="onboarding"]');
      const step = el?.getAttribute('data-step');
      if (step && w.__walk.steps.at(-1) !== step) w.__walk.steps.push(step);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}

/** The screens seen and the clicks made since `watchWalk`. */
export async function walked(page: Page): Promise<{ steps: string[]; clicks: number }> {
  return page.evaluate(
    () => (window as unknown as { __walk: { steps: string[]; clicks: number } }).__walk,
  );
}
