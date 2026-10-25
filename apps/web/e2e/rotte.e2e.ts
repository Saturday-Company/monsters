import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The routes are English, and the Italian ones of before still work: saved links,
 * notifications already delivered, Telegram messages and notes carry them. Each case opens an
 * old link, checks the page lands where the new one does, and that the address bar shows the new
 * form. The unit test `routes.test.ts` covers every name; here the pages themselves.
 */

const selected = (page: Page, name: string) =>
  expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');

test('Settings: an old link opens the same tab as the new one', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
  await selected(page, 'Permissions');
  await expect(page).toHaveURL(/#\/settings\?section=permissions$/);

  await page.goto('/?mock=demo#/settings?section=permissions');
  await selected(page, 'Permissions');

  // A name that is a part of a tab (the old Telegram tab): the tab that holds it, then its own link.
  await page.goto('/?mock=demo#/impostazioni?sezione=telegram');
  await selected(page, 'Apps and Telegram');
  await expect(page).toHaveURL(/#\/settings\?section=apps$/);
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  await selected(page, 'Apps and Telegram');
  await expect(page).toHaveURL(/#\/settings\?section=apps$/);
});

test('Settings: an old link typed into a page already open works too', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await selected(page, 'Models');
  await page.evaluate(() => (window.location.hash = '#/settings?section=general'));
  await selected(page, 'General');
});

test('a project page: old tabs, old names of Settings and the new-project form', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=squadra');
  await expect(page.getByTestId('project-member')).toHaveCount(3);
  await expect(page).toHaveURL(/#\/project\?id=social-di-saturday&section=squad$/);

  // The old name of a part of Settings opens Settings, at that part.
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=spesa');
  await selected(page, 'Settings');
  await expect(page.getByTestId('project-folder-path')).toBeVisible();
  await expect(page).toHaveURL(/#\/project\?id=social-di-saturday&section=settings$/);

  await page.goto('/?mock=demo#/project?id=social-di-saturday&section=notes');
  await selected(page, 'Notes');

  await page.goto('/?mock=demo#/progetto?vista=nuovo');
  await expect(page.getByTestId('project-form')).toBeVisible();
  await expect(page).toHaveURL(/#\/project\?view=new$/);
});

test('Automations: the old path, key and view open the form', async ({ page }) => {
  await page.goto('/?mock=demo#/automazioni?vista=nuova');
  await expect(page.getByTestId('automation-form')).toBeVisible();
  await expect(page).toHaveURL(/#\/automations\?view=new$/);

  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  await expect(page.getByRole('heading', { name: 'Weekly posts' }).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/automations\?automation=post-della-settimana$/);
});

test('Notes: the old note key, the trash and the new-note form', async ({ page }) => {
  await page.goto('/?mock=demo#/note?nota=Resources%2FTram%2028.md');
  await expect(page.locator('#vault-note-title')).toHaveText('Tram 28');
  await expect(page).toHaveURL(/#\/notes\?note=Resources%2FTram%2028\.md$/);

  await page.goto('/?mock=demo#/note?vista=cestino');
  await expect(page.getByTestId('vault-trash-item').first()).toBeVisible();
  await expect(page).toHaveURL(/#\/notes\?view=trash$/);

  await page.goto('/?mock=demo#/notes?view=new');
  await expect(page.getByTestId('vault-new-note')).toBeVisible();
});

test('Activity and Files: the old key of a note and the old path', async ({ page }) => {
  await page.goto('/?mock=demo#/log?nota=Journal%2F2026-10-14.md');
  await expect(page.getByTestId('event-row').first()).toBeVisible();
  await expect(page).toHaveURL(/#\/log\?note=Journal%2F2026-10-14\.md$/);

  await page.goto('/?mock=demo#/file');
  await expect(page).toHaveURL(/#\/files$/);
  await expect(page.getByTestId('files-view')).toBeVisible();
});

test('a link in a message opens in place, written either way', async ({ page }) => {
  await page.goto('/?mock=demo');
  // The sidebar and the pages write the new form only.
  const links = page.getByTestId('sidebar').getByRole('link');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => h.startsWith('#/'))).not.toEqual([]);
  for (const href of hrefs.filter((h) => h.startsWith('#/')))
    expect(href).not.toMatch(
      /benvenuto|impostazioni|automazioni|progetto|\/note\b|\/file\b|sezione|vista=/,
    );
});
