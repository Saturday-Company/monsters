import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * No dead ends (wave B, stream B2) on the mock core: a read that fails says so with "Try again"
 * in every module of Settings (U2-25, U2-27); a row of Attività that waits for a choice carries
 * "Review" (V-8); a deleted file and a discarded draft can be brought back for ten seconds
 * (U2-32); the empty Files and Attività say what to do (U2-34).
 */

type Mock = {
  failRequests: (match: string, times?: number) => void;
  clearFailures: () => void;
  handle(method: string, path: string, body?: unknown): { status: number; body: unknown };
};

const fail = (page: Page, match: string) =>
  page.evaluate(
    (m) => (window as unknown as { __monstersMock: Mock }).__monstersMock.failRequests(m),
    match,
  );
const mend = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __monstersMock: Mock }).__monstersMock.clearFailures(),
  );

/** Opens the page where the read will fail: the app is loaded first, the failure set, then the move. */
async function openFailing(page: Page, hash: string, match: string) {
  await page.goto('/?mock=demo#/note');
  await expect(page.getByTestId('vault-view')).toBeVisible();
  await fail(page, match);
  await page.evaluate((h) => (window.location.hash = h), hash);
}

const MODULES: { name: string; hash: string; match: string; said: string; shown: string }[] = [
  {
    name: 'the spending cap',
    hash: '#/impostazioni?sezione=tetto',
    match: 'GET /api/settings/spend',
    said: 'Couldn’t load the spending cap.',
    shown: 'Spending cap',
  },
  {
    name: 'the permissions',
    hash: '#/impostazioni?sezione=permessi',
    match: 'GET /api/permissions',
    said: 'Couldn’t load the permissions.',
    shown: 'Permissions',
  },
  {
    name: 'the apps',
    hash: '#/impostazioni?sezione=collegamenti',
    match: 'GET /api/mcp-servers',
    said: 'Couldn’t load your apps.',
    shown: 'Advanced: add an app by address',
  },
  {
    name: 'the squad',
    hash: '#/impostazioni?sezione=squadra',
    match: 'GET /api/team',
    said: 'Couldn’t load the squad.',
    shown: 'Add a monster',
  },
  {
    name: 'the monsters’ decisions',
    hash: '#/impostazioni?sezione=istinto',
    match: 'GET /api/settings/instinct',
    said: 'Couldn’t load the monsters’ decisions.',
    shown: 'Monsters’ decisions',
  },
  {
    name: 'the scorecard',
    hash: '#/impostazioni?sezione=pagella',
    match: 'GET /api/instinct/scorecard',
    said: 'Couldn’t load the monsters’ scorecard.',
    shown: 'Monster scorecard',
  },
];

for (const m of MODULES) {
  test(`Settings: ${m.name} that cannot be read says so, and "Try again" reads it again (U2-27)`, async ({
    page,
  }) => {
    await openFailing(page, m.hash, m.match);
    const notice = page.getByTestId('load-failed');
    await expect(notice).toContainText(m.said);
    // Neutral voice: the app does not say "I".
    await expect(notice).not.toContainText('I can’t');
    // Still down: asking again shows the same line, not a blank page.
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(notice).toContainText(m.said);
    await mend(page);
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('load-failed')).toHaveCount(0);
    await expect(page.getByText(m.shown, { exact: false }).first()).toBeVisible();
  });
}

test('Settings: the safety net of a job says so too, inside its row', async ({ page }) => {
  await openFailing(page, '#/impostazioni?sezione=limiti', 'GET /api/settings/limits');
  const row = page.getByTestId('limits-row');
  await expect(row.getByTestId('load-failed')).toContainText('Couldn’t load the safety net.');
  await mend(page);
  await row.getByRole('button', { name: 'Try again' }).click();
  await expect(row.getByTestId('load-failed')).toHaveCount(0);
});

test('Project: the spending and the notes that cannot be read offer "Try again"', async ({
  page,
}) => {
  await openFailing(
    page,
    '#/progetto?id=social-di-saturday&sezione=spesa',
    'GET /api/projects/social-di-saturday/spend',
  );
  await expect(page.getByTestId('load-failed')).toContainText(
    'Couldn’t load the project’s spending.',
  );
  await mend(page);
  await page.getByTestId('load-failed').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('project-spend')).toBeVisible();

  await fail(page, 'GET /api/vault/notes');
  await page.evaluate(
    () => (window.location.hash = '#/progetto?id=social-di-saturday&sezione=note'),
  );
  await expect(page.getByTestId('project-notes').getByTestId('load-failed')).toContainText(
    'Couldn’t load the notes.',
  );
  await mend(page);
  await page.getByTestId('project-notes').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('project-notes').getByTestId('load-failed')).toHaveCount(0);
});

test('Attività: a tool paused until you accept it has "Review", which leads to where you decide (V-8)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/log');
  const row = page
    .getByTestId('event-row')
    .filter({ hasText: 'GitHub changed the “create_issue” tool' });
  await expect(row).toBeVisible();
  await row.getByTestId('review-row').click();
  await expect(page).toHaveURL(/#\/settings\?section=paused$/);
});

test('Attività: a draft that waits to be confirmed has "Review", which opens "To review"', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/log');
  const row = page
    .getByTestId('event-row')
    .filter({ hasText: 'Saturday website' })
    .filter({ has: page.getByTestId('review-row') })
    .first();
  await expect(row).toBeVisible();
  await row.getByTestId('review-row').click();
  await expect(
    page
      .getByTestId('review-sheet')
      .getByTestId('draft-card')
      .filter({ hasText: 'Saturday website' }),
  ).toBeVisible();
});

test('Files: a deleted file comes back with Undo within ten seconds (U2-32)', async ({ page }) => {
  await page.goto('/?mock=demo#/file');
  const tiles = page.getByTestId('file-tile');
  await expect(tiles).toHaveCount(9);
  const pdf = tiles.filter({ hasText: 'Lisbon quote.pdf' });
  const del = pdf.getByTestId('file-delete');
  await del.click();
  await del.click();
  await expect(tiles).toHaveCount(8);
  const notice = page.getByText('I deleted Lisbon quote.pdf.');
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Lisbon quote.pdf is back.')).toBeVisible();
  await expect(tiles).toHaveCount(9);
  await expect(tiles.filter({ hasText: 'Lisbon quote.pdf' })).toHaveCount(1);
});

test('Files: nothing yet says how to start, with a way into the lead’s chat (U2-34)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/file');
  await expect(page.getByTestId('file-tile').first()).toBeVisible();
  // Every file gone: the core answers an empty list from now on.
  await page.evaluate(() => {
    const mock = (window as unknown as { __monstersMock: Mock }).__monstersMock;
    const original = mock.handle.bind(mock);
    mock.handle = (method, path, body) =>
      method === 'GET' && /^\/api\/files(\?|$)/.test(path)
        ? { status: 200, body: { files: [] } }
        : original(method, path, body);
  });
  // A search and its clearing read the list again.
  await page.getByTestId('files-search').fill('zzz');
  await page.getByTestId('files-search').fill('');
  const empty = page.getByTestId('files-empty');
  await expect(empty).toContainText('No files yet');
  await empty.getByTestId('files-attach').click();
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
});

test('Attività: nothing yet says what to try, with a way into the lead’s chat (U2-34)', async ({
  page,
}) => {
  await page.goto('/?mock=team');
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByLabel('Setup code').fill('424242');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('sidebar').waitFor();
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(page.getByText('No actions with an effect yet.')).toBeVisible();
  await expect(page.getByTestId('log-empty-hint')).toContainText('Ask the lead for something');
  await page.getByTestId('log-ask-lead').click();
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
});

test('Files: a chat attachment whose metadata cannot be read says so and reads again (W-36)', async ({
  page,
}) => {
  // Not through the File view: it would leave the metadata in the cache.
  await page.goto('/?mock=demo#/note');
  await expect(page.getByTestId('vault-view')).toBeVisible();
  await fail(page, 'GET /api/files');
  await page.evaluate(() => (window.location.hash = '#/?chat=dione'));
  const unread = page.getByTestId('file-unread').first();
  await expect(unread).toBeVisible();
  await mend(page);
  // Each chip asks again for itself.
  const keys = page.getByTestId('file-unread').getByRole('button', { name: 'Try again' });
  for (let left = await keys.count(); left > 0; left--) await keys.first().click();
  await expect(page.getByTestId('file-unread')).toHaveCount(0);
  await expect(page.getByTestId('file-chip').filter({ hasText: 'Weekly menu.html' })).toBeVisible();
});

test('Draft discard: Undo brings the draft back; left alone it goes through after ten seconds (U2-32)', async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=cartella');
  const list = page.getByTestId('project-docs-drafts');
  await expect(list.getByTestId('draft-card')).toHaveCount(2);
  const calypso = list.getByTestId('draft-card').filter({ hasText: 'AGENTS.md' });

  // Discard, then Undo: the card is back and nothing was told to the core.
  await calypso.getByTestId('draft-discard').click();
  await expect(list.getByTestId('draft-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(list.getByTestId('draft-card')).toHaveCount(2);
  await page.clock.fastForward(15_000);
  await expect(list.getByTestId('draft-card')).toHaveCount(2);

  // Discard and leave it: after ten seconds the core drops the draft for good.
  await calypso.getByTestId('draft-discard').click();
  await expect(list.getByTestId('draft-card')).toHaveCount(1);
  await page.clock.fastForward(11_000);
  await expect(list.getByTestId('draft-card')).toHaveCount(1);
  await page.evaluate(
    () => (window.location.hash = '#/progetto?id=social-di-saturday&sezione=squadra'),
  );
  await page.evaluate(
    () => (window.location.hash = '#/progetto?id=social-di-saturday&sezione=cartella'),
  );
  await expect(page.getByTestId('project-docs-drafts').getByTestId('draft-card')).toHaveCount(1);
});
