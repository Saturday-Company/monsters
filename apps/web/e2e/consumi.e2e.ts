import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * Consumi (D-075) on the mock core: the CONTESTO key on the monster's monitor
 * (lineette and percentage), the panel it opens (context by part, this
 * conversation, today and this month), live updates from the stream, a
 * monster on the Claude plan, "Riduci movimento". `SCREENSHOTS=<folder>`
 * writes the preview and the panel in light and dark, wide and on a phone.
 */

const SHOTS = process.env['SCREENSHOTS'];

const key = (page: Page) => page.getByTestId('chat-monitor').getByTestId('context-key');

async function send(page: Page, text: string) {
  const input = page.getByRole('combobox', { name: 'Message' });
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
  await expect(sheet.getByTestId('usage-percent')).toHaveText(
    (await key(page).getByTestId('context-amount').textContent())!,
  );
  const legend = sheet.getByTestId('usage-legend');
  for (const part of ['Instructions', 'Tools', 'Conversation', 'Current message'])
    await expect(legend).toContainText(part);
  await expect(sheet.getByTestId('usage-context')).toContainText('65,536 tokens');
  await expect(sheet.getByTestId('usage-context')).toContainText('75% · compacts here');
  await expect(sheet.getByTestId('usage-session')).toContainText('Calls');
  await expect(sheet.getByTestId('usage-cost')).toContainText(/\$/);
  await expect(sheet.getByTestId('usage-day')).toContainText('of €10');
  // The caps live in Settings → Modelli; on a wide window the pane stays beside them.
  await sheet.getByTestId('usage-caps-link').click();
  await expect(page).toHaveURL(/impostazioni\?sezione=tetto/);
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

test('live: a new step of the monster moves the preview and the open panel', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.3#/?chat=dione');
  // Dione's own chat has no model step yet (her work this morning was for Titan).
  const amount = key(page).getByTestId('context-amount');
  await expect(amount).toHaveText('0%');
  await key(page).click();
  const sheet = page.getByTestId('usage-sheet');
  await expect(sheet.getByTestId('usage-context')).toContainText('No steps');
  await send(page, 'Can you rewrite my bio in a lighter tone?');
  await expect(amount).toHaveText(/^\d+%$/, { timeout: 15_000 });
  await expect(sheet.getByTestId('usage-percent')).toHaveText(/^\d+%$/);
  await expect(sheet.getByTestId('usage-legend')).toContainText('Tool results', {
    timeout: 15_000,
  });
  await expect(sheet.getByTestId('usage-session')).toContainText('Calls');
  await expect(sheet.getByTestId('usage-in')).not.toHaveText('0');
});

test('a monster on the Claude plan: its base apart, no money', async ({ page }) => {
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
  await expect(sheet.getByTestId('usage-legend')).toContainText('Claude Code base', {
    timeout: 15_000,
  });
  await expect(sheet.getByTestId('usage-context')).toContainText('1,000,000 tokens');
  await expect(sheet.getByTestId('usage-cost')).toContainText('included in the subscription');
  await expect(sheet.getByTestId('usage-subscription')).toContainText(
    'Mimas works on the subscription',
  );
  await expect(sheet.getByTestId('usage-session')).toContainText('Cache read');
  // "Tokens in" is the fresh input; what came from the cache is said apart (D-166).
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
        await page.getByTestId('usage-in').waitFor();
        await page.waitForTimeout(300);
        await shot('pannello');
        await page.getByTestId('usage-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(200);
        await shot('pannello-fondo');
      });
    });
  }
}
