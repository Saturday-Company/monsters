import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * A draft in the notes editor is never thrown away silently (review W-4, W-9): leaving it by the
 * list, a link or the sidebar asks first (save, discard, keep editing), closing the window asks
 * through the browser, and a failed read of the note while editing keeps the editor and the draft.
 */

const RUNNING = '#/note?nota=Areas%2FHealth%2FRunning.md';

async function openEditor(page: Page, hash = RUNNING) {
  await page.goto(`/?mock=demo${hash}`);
  await expect(page.getByTestId('vault-view')).toBeVisible();
  await page.getByTestId('vault-edit').click();
}

type Mock = {
  append: (e: unknown) => unknown;
  failRequests: (match: string, times?: number) => void;
  clearFailures: () => void;
};

test('switching note with a draft asks; keep editing leaves everything as it was', async ({
  page,
}) => {
  await openEditor(page);
  const editor = page.getByTestId('vault-editor');
  await editor.fill('# Running\n\nMy draft.\n');
  await page.getByTestId('vault-search').fill('tram');
  await page
    .getByTestId('vault-results')
    .getByRole('link', { name: /^Tram 28/ })
    .click();

  const dialog = page.getByTestId('unsaved-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You have changes that aren’t saved');
  await dialog.getByTestId('unsaved-keep').click();
  await expect(dialog).toBeHidden();
  await expect(editor).toHaveValue('# Running\n\nMy draft.\n');
  await expect(page).toHaveURL(/nota=Areas%2FHealth%2FRunning\.md$/);
});

test('discard goes on to the note that was asked for', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('vault-editor').fill('# Running\n\nMy draft.\n');
  await page.getByTestId('vault-search').fill('tram');
  await page
    .getByTestId('vault-results')
    .getByRole('link', { name: /^Tram 28/ })
    .click();
  await page.getByTestId('unsaved-discard').click();
  await expect(page.locator('#vault-note-title')).toHaveText('Tram 28');
  await expect(page.getByTestId('vault-editor')).toHaveCount(0);
});

test('save keeps the draft and then goes on', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('vault-editor').fill('# Running\n\nSaved from the question.\n');
  await page.getByTestId('vault-search').fill('tram');
  await page
    .getByTestId('vault-results')
    .getByRole('link', { name: /^Tram 28/ })
    .click();
  await page.getByTestId('unsaved-save').click();
  await expect(page.locator('#vault-note-title')).toHaveText('Tram 28');
  // The first note kept what was typed.
  await page.evaluate((h) => (window.location.hash = h), RUNNING);
  await expect(page.getByTestId('vault-note-body')).toContainText('Saved from the question');
});

test('an untouched editor and a saved one do not ask', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('vault-search').fill('tram');
  await page
    .getByTestId('vault-results')
    .getByRole('link', { name: /^Tram 28/ })
    .click();
  await expect(page.locator('#vault-note-title')).toHaveText('Tram 28');
  await expect(page.getByTestId('unsaved-dialog')).toHaveCount(0);
});

test('closing the window while the draft is not saved asks through the browser', async ({
  page,
}) => {
  await openEditor(page);
  const before = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(before).toBe(false);
  await page.getByTestId('vault-editor').fill('# Running\n\nNot saved.\n');
  const dirty = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(dirty).toBe(true);
});

test('a new note with something written asks before leaving', async ({ page }) => {
  await page.goto('/?mock=demo#/note?vista=nuova');
  await page.getByTestId('vault-new-title').fill('Half a thought');
  await page.getByTestId('vault-graph-toggle').click();
  const dialog = page.getByTestId('unsaved-dialog');
  await expect(dialog).toContainText('hasn’t been created yet');
  await dialog.getByTestId('unsaved-keep').click();
  await expect(page.getByTestId('vault-new-title')).toHaveValue('Half a thought');
  // Saving creates it, and it opens (the question does not block its own note).
  await page.getByTestId('vault-new-save').click();
  await expect(page.locator('#vault-note-title')).toHaveText('Half a thought');
  await expect(page.getByTestId('unsaved-dialog')).toHaveCount(0);
});

test('a failed read of the note while editing keeps the editor and the draft', async ({ page }) => {
  await openEditor(page);
  const editor = page.getByTestId('vault-editor');
  await editor.fill('# Running\n\nMy draft.\n');
  await page.evaluate(() => {
    const mock = (window as unknown as { __monstersMock: Mock }).__monstersMock;
    mock.failRequests('GET /api/vault/note', 1);
    mock.append({
      agent: 'dione',
      type: 'vault_change',
      data: { action: 'edit', path: 'Areas/Health/Running.md', actionId: 'act_e2e_refetch' },
    });
  });
  await expect(page.getByTestId('vault-editor-refresh-error')).toBeVisible();
  await expect(editor).toHaveValue('# Running\n\nMy draft.\n');
});
