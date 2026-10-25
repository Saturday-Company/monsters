import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The layers over the page (review of 25/10, wave B3): one Escape closes only the layer on top
 * (W-16), the modal ones keep the focus and give it back (W-17), a toast with a key stays and
 * the keyboard reaches it (W-18), the arrow keys move a radio group (W-31). The kill switch
 * stays reachable under a modal layer (ARCHITECTURE §8).
 */

interface AppModule {
  notify(
    text: string,
    tone?: 'info' | 'error' | 'success',
    extra?: { ms?: number; fromEvent?: boolean; action?: { label: string; run: () => void } },
  ): void;
}

/** Shows a toast through the app's own store (the dev server serves the same module instance). */
async function notify(
  page: Page,
  text: string,
  options: {
    tone?: 'info' | 'error' | 'success';
    ms?: number;
    action?: string;
    news?: boolean;
  } = {},
) {
  await page.evaluate(
    async ([t, o]) => {
      const path = '/src/store/app.ts';
      const app = (await import(/* @vite-ignore */ path)) as AppModule;
      const w = window as unknown as { __used?: string[] };
      w.__used ??= [];
      const action = o.action;
      app.notify(t, o.tone ?? 'info', {
        ...(o.ms ? { ms: o.ms } : {}),
        ...(o.news ? { fromEvent: true } : {}),
        ...(action ? { action: { label: action, run: () => w.__used?.push(action) } } : {}),
      });
    },
    [text, options] as const,
  );
}

/** Closes the notices the demo shows on its own (a tool in pause), so the test starts clean. */
async function clearNotices(page: Page) {
  const close = page.getByTestId('notice').getByRole('button', { name: 'Close' });
  await close.waitFor({ timeout: 4000 }).catch(() => {});
  for (let i = 0; i < 5 && (await close.isVisible()); i++) {
    await close.click();
    await page.waitForTimeout(200);
  }
}

const insideOf = (page: Page, testId: string) =>
  page.evaluate((id) => !!document.activeElement?.closest(`[data-testid="${id}"]`), testId);

test('one Escape closes only the top layer: the palette over "To review" (W-16, W-17)', async ({
  page,
}) => {
  // Narrower than 1280 px "To review" is a sheet on the right, not a column.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/?mock=demo#/?chat=titan');
  const toggle = page.getByTestId('review-toggle');
  await toggle.click();
  const sheet = page.getByTestId('review-sheet');
  await expect(sheet).toBeVisible();
  // The focus went into the sheet.
  await expect.poll(() => insideOf(page, 'review-sheet')).toBe(true);

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByTestId('palette');
  await expect(palette).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();

  // First Escape: only the palette goes; the sheet under it stays, and the focus is back in it.
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect.poll(() => insideOf(page, 'review-sheet')).toBe(true);

  // Second Escape closes the sheet, and the focus returns to the key that opened it.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('the palette keeps the focus inside, gives it back, and leaves the kill switch reachable (W-17)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.focus();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();

  // Tab does not leave the palette, forwards or backwards.
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await insideOf(page, 'palette'), key).toBe(true);
  }

  // Ferma stays out of the trap: its key takes the focus, and Escape on it only closes its cover.
  await page.keyboard.press('ControlOrMeta+.');
  const kill = page.getByTestId('kill');
  await expect(kill).toHaveAttribute('data-state', 'armed');
  await expect(kill).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(kill).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('palette')).toBeVisible();

  // Back in the palette, Escape closes it and the writing field has the focus again.
  await page.getByTestId('palette-input').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();
  await expect(input).toBeFocused();
});

test('a toast with a key stays, waits in line and the keyboard reaches it (W-18)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const input = page.getByRole('combobox', { name: 'Message' });
  await expect(input).toBeVisible();
  await clearNotices(page);
  const notice = page.getByTestId('notice');

  // 400 ms would be gone long before this check: with a key it stays.
  await notify(page, 'Note deleted.', { ms: 400, action: 'Undo' });
  await expect(notice).toContainText('Note deleted.');
  await page.waitForTimeout(1500);
  await expect(notice).toContainText('Note deleted.');

  // News from the core with a key does not erase it: it waits behind it.
  await notify(page, 'Report ready.', { action: 'Open', news: true });
  await expect(notice).toContainText('Note deleted.');
  await expect(notice).not.toContainText('Report ready.');

  // From the writing field the shortcut puts the focus on its key; Enter uses it.
  await input.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Period');
  await expect(page.getByTestId('notice-action')).toBeFocused();
  await page.keyboard.press('Enter');
  const used = () => page.evaluate(() => (window as unknown as { __used?: string[] }).__used);
  expect(await used()).toEqual(['Undo']);

  // The news comes up and the focus went back to the field. It stays until it is used...
  await expect(notice).toContainText('Report ready.');
  await expect(input).toBeFocused();
  await page.waitForTimeout(1500);
  await expect(notice).toContainText('Report ready.');

  // ...what the user just did answers first, and the news comes back after it.
  await notify(page, 'Saved.', { tone: 'success' });
  await expect(notice).toContainText('Saved.');
  await expect(notice).toContainText('Report ready.', { timeout: 10_000 });
  await page.keyboard.press('ControlOrMeta+Shift+Period');
  await page.keyboard.press('Enter');
  expect(await used()).toEqual(['Undo', 'Open']);
  await expect(notice).toBeHidden();
  await expect(input).toBeFocused();
});

test('Escape on a focused toast dismisses it and gives the focus back (W-18)', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const input = page.getByRole('combobox', { name: 'Message' });
  await expect(input).toBeVisible();
  await clearNotices(page);
  await input.focus();
  await notify(page, 'Something to look at.', { tone: 'error', action: 'Open' });
  await expect(page.getByTestId('notice')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+Period');
  await expect(page.getByTestId('notice-action')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('notice')).toBeHidden();
  await expect(input).toBeFocused();
});

test('the arrow keys move a radio group and choose (W-31)', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=generale');
  const theme = page.getByRole('radiogroup', { name: 'Theme' });
  const light = theme.getByRole('radio', { name: 'Light' });
  const dark = theme.getByRole('radio', { name: 'Dark' });
  const system = theme.getByRole('radio', { name: 'System' });
  await light.click();
  await expect(light).toHaveAttribute('aria-checked', 'true');
  // Only the chosen key is a stop for Tab.
  await expect(light).toHaveAttribute('tabindex', '0');
  await expect(dark).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('ArrowRight');
  await expect(dark).toBeFocused();
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(system).toBeFocused();
  await expect(system).toHaveAttribute('aria-checked', 'true');
  // It wraps around.
  await page.keyboard.press('ArrowRight');
  await expect(light).toBeFocused();
  await expect(light).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(system).toBeFocused();
});

test('a confirmation in place: the safe choice has the focus, Escape and Cancel give it back (W-32)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  const del = page.getByRole('button', { name: 'Delete', exact: true });
  await del.click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toBeVisible();
  // The safe choice is the one with the focus.
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // Escape cancels the question only, and the focus is back on the key that asked.
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(del).toBeFocused();
  // The same with the button.
  await del.click();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(del).toBeFocused();
});

test('the @ list tells a screen reader which monster is chosen (W-30)', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const input = page.getByRole('combobox', { name: 'Message' });
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
  await input.fill('@');
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options.first()).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const first = await options.first().getAttribute('id');
  expect(first).toBeTruthy();
  await expect(input).toHaveAttribute('aria-activedescendant', first!);
  await page.keyboard.press('ArrowDown');
  const second = await options.nth(1).getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', second!);
  // Escape closes the list and nothing else.
  await page.keyboard.press('Escape');
  await expect(options.first()).toBeHidden();
  await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
});
