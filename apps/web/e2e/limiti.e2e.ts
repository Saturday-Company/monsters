import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Utilizzo del piano (D-111) on the mock core: the block under the Claude and
 * ChatGPT plans in Settings → Modelli and the one in the Consumi panel of a
 * monster on the plan. `LIMITI_SHOTS=<folder>` writes light and dark shots, wide
 * and on a phone.
 */

const SHOTS = process.env['LIMITI_SHOTS'];

async function connectClaude(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Add a model' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
  const card = page.getByTestId('models-connected').getByTestId('subscription-claude');
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card).toContainText('Ready: the monsters you choose work with Claude Code');
  return card;
}

test('Claude plan: session, week and Opus week under the plan, with when they reset', async ({
  page,
}) => {
  const card = await connectClaude(page);
  const block = card.getByTestId('plan-limits-claude');
  await expect(block).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Plan usage' })).toBeVisible();

  const session = block.getByTestId('plan-window-five_hour');
  await expect(session).toContainText('Session');
  await expect(session.getByTestId('plan-percent')).toHaveText('9%');
  await expect(session.getByTestId('plan-reset')).toHaveText(/^resets in 1 h (3[01]|32) min$/);
  await expect(session.locator('i')).toHaveCount(20);
  await expect(session).toHaveAttribute('data-tone', 'ok');

  const week = block.getByTestId('plan-window-seven_day');
  await expect(week).toContainText('Week');
  await expect(week.getByTestId('plan-percent')).toHaveText('63%');
  await expect(week.getByTestId('plan-reset')).toHaveText(/^resets Wed 4:00 PM$/);

  const opus = block.getByTestId('plan-window-seven_day_opus');
  await expect(opus).toContainText('Opus week');
  await expect(opus.getByTestId('plan-percent')).toHaveText('41%');

  await expect(block.getByTestId('plan-updated')).toContainText(/^Updated (19|20|21) min ago\./);
  await expect(block.getByTestId('plan-updated')).toContainText(
    'It updates only when a monster works on this plan.',
  );
  // The meter says it without colour too.
  await expect(session).toHaveAttribute('role', 'meter');
  await expect(session).toHaveAccessibleName('Session: 9% used');

  if (SHOTS) {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      await card.screenshot({ path: `${SHOTS}/modelli-claude-${theme}.png` });
    }
  }
});

test('ChatGPT plan: the two windows named by their length, the week warns at 81%', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Add a model' }).click();
  const popup = page.waitForEvent('popup');
  await page
    .getByTestId('subscription-chatgpt')
    .getByRole('button', { name: 'Continue with ChatGPT' })
    .click();
  await (await popup).close();
  await page.getByTestId('chatgpt-welcome').getByRole('button', { name: 'Got it' }).click();

  const block = page.getByTestId('models-connected').getByTestId('plan-limits-chatgpt');
  await expect(block).toBeVisible();
  const short = block.getByTestId('plan-window-primary');
  await expect(short).toContainText('5 hours');
  await expect(short.getByTestId('plan-percent')).toHaveText('24%');
  await expect(short).toHaveAttribute('data-tone', 'ok');
  const week = block.getByTestId('plan-window-secondary');
  await expect(week).toContainText('Week');
  await expect(week.getByTestId('plan-percent')).toHaveText('81%');
  await expect(week).toHaveAttribute('data-tone', 'warn');
  await expect(week).toContainText('running low');
  await expect(week.getByTestId('plan-reset')).toHaveText(
    /^resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d\d (AM|PM)$/,
  );
  if (SHOTS) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page
      .getByTestId('models-connected')
      .getByTestId('subscription-chatgpt')
      .screenshot({ path: `${SHOTS}/modelli-chatgpt-light.png` });
  }
});

test('Consumi of a monster on the Claude plan carries the same block', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.3#/?chat=mimas');
  const key = page.getByTestId('chat-monitor').getByTestId('context-key');
  await expect(key).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __monstersMock: { useSubscription(id: string): void } }
    ).__monstersMock.useSubscription('mimas'),
  );
  const input = page.getByTestId('composer-input');
  await input.fill('Hi Mimas, where are we on the accounts?');
  await input.press('Enter');
  await expect(key.getByTestId('context-amount')).toHaveText(/^\d+%$/, { timeout: 15_000 });
  await key.click();
  const sheet = page.getByTestId('usage-sheet');
  const plan = sheet.getByTestId('usage-plan');
  await expect(plan).toContainText('Plan usage · Claude', { timeout: 15_000 });
  await expect(plan.getByTestId('plan-window-five_hour')).toContainText('Session');
  await expect(plan.getByTestId('plan-window-seven_day').getByTestId('plan-percent')).toHaveText(
    '63%',
  );
  await expect(plan.getByTestId('plan-window-seven_day_opus')).toContainText('Opus week');
  await expect(plan.getByTestId('plan-updated')).toContainText('Updated');
  if (SHOTS) {
    await page.waitForTimeout(300);
    await plan.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/consumi-piano.png`, animations: 'disabled' });
  }
});

test('a monster on a free model has no plan block', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const key = page.getByTestId('chat-monitor').getByTestId('context-key');
  await expect(key.getByTestId('context-amount')).toHaveText(/^\d+%$/);
  await key.click();
  await expect(page.getByTestId('usage-sheet').getByTestId('usage-spend')).toBeVisible();
  await expect(page.getByTestId('usage-plan')).toHaveCount(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the block fits a phone, light and dark', async ({ page }) => {
    const card = await connectClaude(page);
    const block = card.getByTestId('plan-limits-claude');
    await expect(block).toBeVisible();
    await expectNoSideScroll(page);
    const box = (await block.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    if (SHOTS) {
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.waitForTimeout(250);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/modelli-claude-telefono-${theme}.png` });
      }
    }
  });
});
