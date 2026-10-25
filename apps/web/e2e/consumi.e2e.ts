import type { Page } from '@playwright/test';
import { expect, showTechnicalDetails, test } from './fixtures.ts';

/*
 * Consumi (D-075) on the mock core: the CONTESTO key on the monster's monitor
 * (lineette and percentage), the panel it opens (a sentence in words, the plan,
 * today and this month; with the technical details on, a "Details" drawer with
 * the context by part and the tokens of this conversation, D-181), live updates
 * from the stream, a monster on the Claude plan, "Riduci movimento".
 * `SCREENSHOTS=<folder>` writes the preview and the panel in light and dark,
 * wide and on a phone.
 */

const SHOTS = process.env['SCREENSHOTS'];

const key = (page: Page) => page.getByTestId('chat-monitor').getByTestId('context-key');

async function send(page: Page, text: string) {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
}

test('the preview on the monitor and the panel it opens', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(key(page).getByTestId('context-amount')).toHaveText(/^\d+%$/);
  await expect(key(page)).toHaveAccessibleName(
    /^Context and usage of Titan: \d+% of the model’s window$/,
  );
  // 20 lineette, some lit by part, the rest free.
  const bar = key(page).getByTestId('context-bar');
  await expect(bar.locator('i')).toHaveCount(20);
  await expect(bar.locator('i[data-part]').first()).toBeAttached();

  await key(page).click();
  const sheet = page.getByTestId('usage-sheet');
  await expect(sheet.getByRole('heading', { name: 'Usage of Titan' })).toBeVisible();
  // The first line is in words: the share of the model's memory and what the conversation cost.
  const amount = (await key(page).getByTestId('context-amount').textContent())!;
  await expect(sheet.getByTestId('usage-sentence')).toHaveText(
    `This conversation uses ${amount} of the model’s memory; it cost less than €0.01.`,
  );
  await expect(sheet.getByTestId('context-bar')).toBeVisible();
  await expect(sheet.getByTestId('usage-day')).toContainText('of €10');
  // Technical details are off: no tokens, no cache, no parts of the context, no "Details".
  await expect(sheet.getByTestId('usage-details')).toHaveCount(0);
  await expect(sheet.getByTestId('usage-legend')).toHaveCount(0);
  await expect(sheet.getByTestId('usage-session')).toHaveCount(0);
  await expect(sheet).not.toContainText(/tokens|cache/i);
  // The caps live in Settings → Modelli; on a wide window the pane stays beside them.
  await sheet.getByTestId('usage-caps-link').click();
  await expect(page).toHaveURL(/settings\?section=spend-cap/);
  await expect(sheet).toBeVisible();

  // Esc closes it; the terminal takes its place on the right.
  await page.goto('/?mock=demo#/?chat=titan');
  await key(page).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await key(page).click();
  // (Under the sheet on this width: the terminal opens as from the instrumentation line.)
  await page.evaluate(async (src) => {
    const { openTerminal } = (await import(/* @vite-ignore */ src)) as {
      openTerminal: (id: string) => void;
    };
    openTerminal('titan');
  }, '/src/store/app.ts');
  await expect(page.getByTestId('agent-terminal')).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test('technical details on: a "Details" drawer holds the parts of the context and the tokens', async ({
  page,
}) => {
  await showTechnicalDetails(page);
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(key(page).getByTestId('context-amount')).toHaveText(/^\d+%$/);
  await key(page).click();
  const sheet = page.getByTestId('usage-sheet');
  // Closed at first: the sentence is still the first thing, the breakdown is one click away.
  await expect(sheet.getByTestId('usage-sentence')).toBeVisible();
  const toggle = sheet.getByTestId('usage-details-toggle');
  await expect(toggle).toHaveText('Details');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet.getByTestId('usage-legend')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const legend = sheet.getByTestId('usage-legend');
  for (const part of ['Instructions', 'Tools', 'Conversation', 'Current message'])
    await expect(legend).toContainText(part);
  await expect(sheet.getByTestId('usage-context')).toContainText('65,536 tokens');
  await expect(sheet.getByTestId('usage-context')).toContainText('75% · compacts here');
  await expect(sheet.getByTestId('usage-session')).toContainText('Calls');
  await expect(sheet.getByTestId('usage-session')).toContainText('Tokens in');
  await expect(sheet.getByTestId('usage-cost')).toContainText(/\$/);
  await toggle.click();
  await expect(sheet.getByTestId('usage-legend')).toHaveCount(0);
});

test('live: a new step of the monster moves the preview and the open panel', async ({ page }) => {
  await showTechnicalDetails(page);
  await page.goto('/?mock=demo&mockSpeed=0.3#/?chat=dione');
  // Dione's own chat has no model step yet (her work this morning was for Titan).
  const amount = key(page).getByTestId('context-amount');
  await expect(amount).toHaveText('0%');
  await key(page).click();
  const sheet = page.getByTestId('usage-sheet');
  await expect(sheet.getByTestId('usage-sentence')).toContainText('No steps');
  await send(page, 'Can you rewrite my bio in a lighter tone?');
  await expect(amount).toHaveText(/^\d+%$/, { timeout: 15_000 });
  await expect(sheet.getByTestId('usage-sentence')).toContainText(
    /uses \d+% of the model’s memory/,
  );
  await sheet.getByTestId('usage-details-toggle').click();
  await expect(sheet.getByTestId('usage-legend')).toContainText('Tool results', {
    timeout: 15_000,
  });
  await expect(sheet.getByTestId('usage-session')).toContainText('Calls');
  await expect(sheet.getByTestId('usage-in')).not.toHaveText('0');
});

test('a monster on the Claude plan: its base apart, no money', async ({ page }) => {
  await showTechnicalDetails(page);
  await page.goto('/?mock=demo&mockSpeed=0.3#/?chat=mimas');
  await expect(key(page)).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __monstersMock: { useSubscription(id: string): void } }
    ).__monstersMock.useSubscription('mimas'),
  );
  await send(page, 'Hi Mimas, where are we on the accounts?');
  await expect(key(page).getByTestId('context-amount')).toHaveText(/^\d+%$/, { timeout: 15_000 });
  await key(page).click();
  const sheet = page.getByTestId('usage-sheet');
  // In words first: the memory, then that it runs on the plan and how much of it is used.
  await expect(sheet.getByTestId('usage-sentence')).toContainText(
    /uses \d+% of the model’s memory\. It runs on your Claude plan, so it costs nothing extra\./,
  );
  await expect(sheet.getByTestId('usage-plan-sentence')).toContainText(
    'Your Claude plan: Week is 63% used (resets',
  );
  await expect(sheet.getByTestId('usage-subscription')).toContainText('Mimas works on your plan');
  await sheet.getByTestId('usage-details-toggle').click();
  await expect(sheet.getByTestId('usage-legend')).toContainText('Claude Code base', {
    timeout: 15_000,
  });
  await expect(sheet.getByTestId('usage-context')).toContainText('1,000,000 tokens');
  await expect(sheet.getByTestId('usage-cost')).toContainText('included in your plan');
  await expect(sheet.getByTestId('usage-session')).toContainText('Cache read');
  // "Tokens in" is the fresh input; what came from the cache is said apart (D-169).
  await expect(sheet.getByTestId('usage-in-cache')).toContainText(/^\+ [\d,]+ from cache$/);
});

test('"Riduci movimento": the lineette light up without frames', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const lit = key(page).locator('.ctx-bar > i[data-part]').first();
  await expect(lit).toBeAttached();
  expect(await lit.evaluate((el) => getComputedStyle(el).animationName)).toBe('light-on');
  await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduced'));
  expect(await lit.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-motion'));
  expect(await lit.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the key and the panel fit a phone', async ({ page }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await expect(key(page).getByTestId('context-amount')).toHaveText(/^\d+%$/);
    await key(page).click();
    const sheet = page.getByTestId('usage-sheet');
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    // Nothing wider than the screen.
    const overflow = await sheet
      .getByTestId('usage-body')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByTestId('dock-close').click();
    await expect(sheet).toHaveCount(0);
  });
});

for (const theme of ['light', 'dark'] as const) {
  for (const size of [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
  ]) {
    test.describe(`screenshots ${theme} ${size.name}`, () => {
      test.skip(!SHOTS, 'set SCREENSHOTS=<folder> to write the screenshots');
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });

      test('preview and panel', async ({ page }) => {
        const shot = (what: string) =>
          page.screenshot({
            path: `${SHOTS}/consumi-${what}-${theme}-${size.name}.png`,
            animations: 'disabled',
          });
        await page.goto('/?mock=demo#/?chat=titan');
        await expect(key(page).getByTestId('context-amount')).toHaveText(/^\d+%$/);
        await page.waitForTimeout(300);
        await shot('anteprima');
        await key(page).click();
        await page.getByTestId('usage-sentence').waitFor();
        await page.waitForTimeout(300);
        await shot('pannello');
        await page.getByTestId('usage-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(200);
        await shot('pannello-fondo');
      });
    });
  }
}
