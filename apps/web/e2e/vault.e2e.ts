import { test as base, type Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/* Notes (M2.8, D-056) against the mock core: search, read, links, graph, trash, history. */

/** Dev-only hook of the graph (GraphView.tsx): screen position of a note. */
interface GraphHook {
  pointOf: (path: string) => { x: number; y: number } | null;
}

const title = (page: Page) => page.locator('#vault-note-title');

async function openVault(page: Page, hash = '#/note') {
  await page.goto(`/?mock=demo${hash}`);
  await expect(page.getByTestId('vault-view')).toBeVisible();
}

test('search, open a note, follow a wikilink and a backlink', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('vault-search').fill('tram');
  const results = page.getByTestId('vault-results');
  await expect(results.getByRole('link', { name: /^Tram 28/ })).toBeVisible();
  await expect(results.getByRole('link', { name: /^Lisbon, weekend tips/ })).toBeVisible();
  await results.getByRole('link', { name: /^Tram 28/ }).click();
  await expect(title(page)).toHaveText('Tram 28');
  await expect(page).toHaveURL(/#\/note\?nota=Resources%2FTram%2028\.md$/);

  // Wikilink in the text.
  await page
    .getByTestId('vault-note-body')
    .getByRole('link', { name: 'Lisbon, weekend tips' })
    .click();
  await expect(title(page)).toHaveText('Lisbon, weekend tips');

  // Backlinks: who links here (not the monsters' own notes).
  const backlinks = page.getByTestId('vault-backlinks');
  await expect(backlinks.getByRole('link')).toHaveCount(3);
  await backlinks.getByRole('link', { name: /Post drafts/ }).click();
  await expect(title(page)).toHaveText('Post drafts');

  // Back in the browser history goes to the previous note.
  await page.goBack();
  await expect(title(page)).toHaveText('Lisbon, weekend tips');
});

test('the list: Recenti, then closed folders; the monsters’ notes on request', async ({ page }) => {
  await openVault(page);
  const list = page.getByTestId('vault-list');
  await expect(page.getByTestId('vault-recent').getByTestId('vault-note-link')).toHaveCount(5);
  // Folders start closed (the note on screen opens its own).
  const resources = list
    .getByTestId('vault-folder-group')
    .filter({ has: page.locator('summary', { hasText: /^Resources\d+$/ }) });
  await expect(resources).not.toHaveAttribute('open', '');
  await resources.locator('summary').click();
  await expect(resources.getByRole('link', { name: /^Tram 28/ })).toBeVisible();
  // A clean preview: no Markdown marks.
  await expect(list.getByTestId('vault-note-link').first()).not.toContainText('[[');
  await expect(list).not.toContainText('**');

  await expect(list.getByRole('link', { name: /^MEMORY/ })).toHaveCount(0);
  await page.getByTestId('vault-filters-toggle').click();
  await page.getByRole('switch', { name: 'Show the monsters’ notes' }).click();
  await expect(list.getByRole('link', { name: /^MEMORY/ }).first()).toBeVisible();
});

test('a note named as a link (from the chat) opens, and the address becomes its path', async ({
  page,
}) => {
  await openVault(page, '#/note?nota=Tram%2028');
  await expect(title(page)).toHaveText('Tram 28');
  await expect(page).toHaveURL(/#\/note\?nota=Resources%2FTram%2028\.md$/);
});

test('tags filter the list; private notes are marked', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('vault-filters-toggle').click();
  await page
    .getByRole('group', { name: 'Filter by tag' })
    .getByRole('button', { name: /#food/ })
    .click();
  const list = page.getByTestId('vault-list');
  await expect(list.getByTestId('vault-note-link')).toHaveCount(2);
  await expect(list.getByRole('link', { name: /Carbonara/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear the filters' }).click();

  await page.getByTestId('vault-folder').selectOption('Areas/Finance');
  const budget = list.getByRole('link', { name: /October budget/ });
  await expect(budget.getByTestId('private-mark')).toBeVisible();
  await budget.click();
  await expect(page.getByTestId('vault-reader').getByTestId('private-mark')).toContainText(
    'Private',
  );
});

test('note content is never raw HTML and bad links are dropped', async ({ page }) => {
  await openVault(page, '#/note?nota=Inbox%2FQuick%20idea.md');
  const body = page.getByTestId('vault-note-body');
  await expect(body).toContainText('<script>alert(1)</script>');
  await expect(body.locator('script')).toHaveCount(0);
  await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(body.getByTestId('vault-link-missing')).toHaveText('Note to write');
  await body.getByTestId('vault-embed').click();
  await expect(title(page)).toHaveText('Tram 28');
});

test('graph: the search stands out in it', async ({ page }) => {
  await openVault(page, '#/note?vista=grafo');
  await page.getByTestId('vault-search').fill('tram');
  await expect(
    page.getByTestId('vault-results').getByTestId('vault-note-link').first(),
  ).toBeVisible();
  await expect(page.getByText(/The (note found is|\d+ notes found are) highlighted/)).toBeVisible();
});

test('graph: a click on a node opens the note, keyboard too', async ({ page }) => {
  await openVault(page, '#/note?vista=grafo');
  const graph = page.getByTestId('vault-graph');
  await expect(graph.locator('canvas')).toBeVisible();
  // Wait until the layout has settled (the point stops moving).
  let last = { x: 0, y: 0 };
  await expect
    .poll(
      async () => {
        const p = await page.evaluate(() => {
          const hook = (window as unknown as { __monstersGraph?: GraphHook }).__monstersGraph;
          return hook?.pointOf('People/Sara.md') ?? null;
        });
        if (!p) return false;
        const still = Math.hypot(p.x - last.x, p.y - last.y) < 0.5;
        last = p;
        return still;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe(true);
  await page.mouse.click(last.x, last.y);
  await expect(title(page)).toHaveText('Sara');

  await page.getByTestId('vault-graph-toggle').click();
  const canvas = page.getByTestId('vault-graph').locator('canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  const selection = page.getByTestId('graph-selection');
  await expect(selection).toContainText('link');
  const name = ((await selection.textContent()) ?? '').replace(/, \d+ links?.*$/, '');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText(name);
});

test('trash: restore a note where it was', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('vault-trash-link').click();
  await expect(page).toHaveURL(/#\/note\?vista=cestino$/);
  const item = page.getByTestId('vault-trash-item').filter({ hasText: 'Shopping list' });
  await expect(item).toContainText('Was in Resources');
  await expect(item).toContainText('deleted by Dione');
  await item.getByTestId('vault-trash-restore').click();
  await expect(page.getByRole('status').filter({ hasText: 'is back where it was' })).toBeVisible();
  await expect(title(page)).toHaveText('Shopping list');

  // And back to the trash from the reader.
  await page.getByTestId('vault-trash').click();
  await page.getByTestId('vault-trash-confirm').click();
  await expect(page.getByTestId('vault-trash-view')).toBeVisible();
  await expect(
    page.getByTestId('vault-trash-item').filter({ hasText: 'Shopping list' }),
  ).toBeVisible();
});

test('history: one action per version; undo and redo live in the note’s Attività', async ({
  page,
}) => {
  await openVault(page, '#/note?nota=Journal%2F2026-10-14.md');
  await expect(page.getByTestId('vault-note-body')).toContainText('Enceladus tidied up');
  await page.getByTestId('vault-history-toggle').click();
  const entries = page.getByTestId('vault-history-entry');
  await expect(entries).toHaveCount(2);
  // One action: back to a version. The changes and the version id under "Dettagli".
  await expect(entries.first().getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(entries.first().getByTestId('vault-restore-version')).toHaveCount(0);
  await expect(entries.last().getByTestId('vault-restore-version')).toHaveText(
    'Go back to this version',
  );
  await entries.first().getByRole('button', { name: 'Details' }).click();
  await expect(entries.first().getByTestId('vault-diff')).toContainText(
    '+- Enceladus tidied up the journal.',
  );
  // The version id is git's: in the tooltip of the date, not in the text (audit UI-24).
  await expect(entries.first()).not.toContainText(/Version [0-9a-f]{7}/);
  await expect(entries.first().getByTestId('vault-diff')).not.toContainText('@@');
  // Out of the history in words, not only with the pressed clock (UI-44).
  await page.getByTestId('vault-history-close').click();
  await expect(page.getByTestId('vault-history')).toBeHidden();
  await expect(page.getByTestId('vault-note-body')).toBeVisible();

  // Undo the change from the note's Attività; Rifai from the row; undo again.
  await page.getByTestId('vault-activity').click();
  await expect(page).toHaveURL(/#\/log\?nota=Journal%2F2026-10-14\.md$/);
  const row = page.getByTestId('event-row').filter({ hasText: 'edited the note 2026-10-14' });
  await row.getByTestId('undo').click();
  await expect(page.getByRole('status').filter({ hasText: 'Change undone' })).toBeVisible();
  await expect(row.getByTestId('undo-done')).toContainText('Undone');
  await row.getByTestId('redo').click();
  await expect(page.getByRole('status').filter({ hasText: 'Change redone' })).toBeVisible();
  await row.getByTestId('undo').click();
  await expect(row.getByTestId('undo-done')).toContainText('Undone');
  await page.getByRole('link', { name: 'Open the note' }).click();
  await expect(page.getByTestId('vault-note-body')).not.toContainText('Enceladus tidied up');
  // Every undo and redo is a new version on top.
  await page.getByTestId('vault-history-toggle').click();
  await expect(entries).toHaveCount(5);

  // Back to the first version.
  await entries.last().getByTestId('vault-restore-version').click();
  await expect(page.getByRole('status').filter({ hasText: 'back to that version' })).toBeVisible();
});

test('undo with later changes: the conflict is explained, undo anyway', async ({ page }) => {
  await openVault(page, '#/note?nota=Resources%2FLisbon%2C%20weekend%20tips.md');
  await page.getByTestId('vault-edit').click();
  await page.getByTestId('vault-editor').fill('# Lisbon\n\nChanged afterwards.\n');
  await page.getByTestId('vault-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.getByTestId('vault-activity').click();
  const created = page.getByTestId('event-row').filter({ hasText: 'Rhea created the note' });
  await created.getByTestId('undo').click();
  await expect(created.getByTestId('undo-conflict')).toContainText('changed after');
  await created.getByTestId('undo-force').click();
  await expect(created.getByTestId('undo-done')).toContainText('Undone');
});

test('edit a note: saved as the user, in the history', async ({ page }) => {
  await openVault(page, '#/note?nota=Areas%2FHealth%2FRunning.md');
  await page.getByTestId('vault-edit').click();
  const editor = page.getByTestId('vault-editor');
  await expect(editor).toHaveValue(/10 km under an hour/);
  await editor.fill(
    '# Running\n\nGoal: 10 km under an hour by December.\n\n- Tuesday intervals.\n',
  );
  await page.getByTestId('vault-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page.getByTestId('vault-note-body')).toContainText('Tuesday intervals');
  await page.getByTestId('vault-history-toggle').click();
  await expect(page.getByTestId('vault-history-entry').first()).toContainText('You');
});

test('new note: title, an existing folder and text, as the user, never over another', async ({
  page,
}) => {
  await openVault(page);
  await page.getByTestId('vault-new').click();
  await expect(page).toHaveURL(/#\/note\?vista=nuova$/);
  const form = page.getByTestId('vault-new-note');
  // The folders are the existing ones; Inbox first if there is one.
  const folder = form.getByTestId('vault-new-folder');
  await expect(folder).toHaveValue('Inbox');
  await expect(folder.locator('option', { hasText: 'Areas › Health' })).toHaveCount(1);
  const save = form.getByTestId('vault-new-save');
  await expect(save).toBeDisabled();
  await form.getByTestId('vault-new-title').fill('Porto: ideas');
  await expect(form.getByRole('alert')).toContainText('can’t contain');
  await expect(save).toBeDisabled();

  await form.getByTestId('vault-new-title').fill('Porto');
  await folder.selectOption('Resources');
  await form.getByTestId('vault-new-text').fill('# Porto\n\nVino e [[Tram 28]].\n');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Note created' })).toBeVisible();
  await expect(page).toHaveURL(/#\/note\?nota=Resources%2FPorto\.md$/);
  await expect(title(page)).toHaveText('Porto');
  await expect(
    page.getByTestId('vault-note-body').getByRole('link', { name: 'Tram 28' }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId('vault-list')
      .getByRole('link', { name: /^Porto/ })
      .first(),
  ).toBeVisible();
  await page.getByTestId('vault-history-toggle').click();
  await expect(page.getByTestId('vault-history-entry').first()).toContainText('You');

  // The same name again: refused, the draft stays.
  await page.getByTestId('vault-new').click();
  await form.getByTestId('vault-new-title').fill('Porto');
  await form.getByTestId('vault-new-folder').selectOption('Resources');
  await form.getByTestId('vault-new-text').fill('Other text');
  await form.getByTestId('vault-new-save').click();
  await expect(form.getByRole('alert')).toHaveText('There’s already a note with this name.');
  await expect(form.getByTestId('vault-new-text')).toHaveValue('Other text');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/#\/note$/);

  // In Attività, as a change of the user (same page: the mock lives in memory).
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(page.getByText(/Porto/).first()).toBeVisible();
});

test('new note in a new folder', async ({ page }) => {
  await openVault(page, '#/note?vista=nuova');
  const form = page.getByTestId('vault-new-note');
  await form.getByTestId('vault-new-title').fill('Lisbon 2027');
  await form.getByTestId('vault-new-folder').selectOption({ label: 'New folder…' });
  const save = form.getByTestId('vault-new-save');
  await expect(save).toBeDisabled();
  await form.getByTestId('vault-new-folder-name').fill('Trips?');
  await expect(form.getByRole('alert')).toContainText('can’t contain');
  await form.getByTestId('vault-new-folder-name').fill('Trips');
  await expect(form).toContainText('To link another note, type [[');
  await save.click();
  await expect(page).toHaveURL(/#\/note\?nota=Trips%2FLisbon%202027\.md$/);
  await expect(title(page)).toHaveText('Lisbon 2027');
});

test('edit: a change made meanwhile is never overwritten without asking', async ({ page }) => {
  const path = 'Areas/Health/Running.md';
  const agentEdit = (actionId: string) =>
    page.evaluate(
      ([p, id]) => {
        const mock = (
          window as unknown as {
            __monstersMock: { append: (e: unknown) => unknown };
          }
        ).__monstersMock;
        mock.append({
          agent: 'dione',
          type: 'vault_change',
          data: { action: 'edit', path: p, actionId: id },
        });
      },
      [path, actionId] as const,
    );
  await openVault(page, `#/note?nota=${encodeURIComponent(path)}`);
  await page.getByTestId('vault-edit').click();
  const editor = page.getByTestId('vault-editor');
  const draft = '# Running\n\nMy draft.\n';
  await editor.fill(draft);

  // Dione edits the note while the editor is open: the draft stays, saving waits for a choice.
  await agentEdit('act_e2e_meanwhile_1');
  const conflict = page.getByTestId('vault-edit-conflict');
  await expect(conflict).toContainText('The note changed while you were editing it');
  await expect(editor).toHaveValue(draft);
  await expect(page.getByTestId('vault-save')).toBeDisabled();
  await conflict.getByRole('button', { name: 'See the differences' }).click();
  await expect(conflict.getByTestId('vault-diff')).toContainText('+- Added by dione.');
  await conflict.getByRole('button', { name: 'Overwrite with my version' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page.getByTestId('vault-note-body')).toContainText('My draft');
  await expect(page.getByTestId('vault-note-body')).not.toContainText('Added by dione');

  // Again, and this time the draft is dropped: Dione's change stays.
  await page.getByTestId('vault-edit').click();
  await editor.fill('# Running\n\nAnother draft.\n');
  await agentEdit('act_e2e_meanwhile_2');
  await conflict.getByRole('button', { name: 'Discard my edit' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('vault-note-body')).toContainText('Added by dione');
  await expect(page.getByTestId('vault-note-body')).not.toContainText('Another draft');
});

// Not the fixture of the other tests: the missing file is logged in the console on purpose.
base(
  'a page whose file does not load: a plain message, a reload when asked, no loop',
  async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);
    const missing = '**/src/components/vault/VaultView.tsx*';
    await page.route(missing, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto('/?mock=demo#/note');
    const fallback = page.getByTestId('error-boundary');
    await expect(fallback).toContainText('There’s a new version of Monsters');
    // Only the page is replaced: the sidebar and the toolbar (with the stop) are still there.
    const sidebar = page.getByTestId('sidebar');
    await expect(page.getByTestId('kill')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /^Titan,/ })).toBeVisible();
    await sidebar.getByRole('link', { name: /^Titan,/ }).click();
    await expect(fallback).toBeHidden();
    await sidebar.getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(fallback).toBeVisible();

    // Reloading while the file is still missing: said plainly, and no reload by itself.
    await fallback.getByRole('button', { name: 'Reload the page' }).click();
    await expect(fallback).toContainText('This part won’t load');
    await expect(fallback.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(loads).toBe(2);

    // The file is back (the new build): one more reload and the page works.
    await page.unroute(missing);
    await fallback.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('vault-view')).toBeVisible();
    expect(loads).toBe(3);
  },
);

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('list, then the note, then back', async ({ page }) => {
    await openVault(page);
    await page
      .getByTestId('vault-list')
      .getByRole('link', { name: /^Tram 28/ })
      .first()
      .click();
    await expect(title(page)).toHaveText('Tram 28');
    await expect(page.getByTestId('vault-list')).toBeHidden();
    // One back on screen (audit UI-19): the rail's, which says where it goes.
    const back = page.getByTestId('toolbar-back');
    await expect(back).toHaveText('Notes');
    await expect(
      page.getByTestId('vault-reader').getByRole('button', { name: 'Notes' }),
    ).toHaveCount(0);
    // The actions say their name under the icon.
    await expect(page.getByTestId('vault-history-toggle')).toContainText('History');
    await back.click();
    await expect(page.getByTestId('vault-list')).toBeVisible();
    // At the list the rail's back goes home again.
    await expect(page.getByTestId('toolbar-back')).toHaveText('Back');
  });

  test('the graph, then back to the list from the rail', async ({ page }) => {
    await openVault(page);
    await page.getByTestId('vault-graph-toggle').click();
    await expect(page.getByTestId('vault-graph-screen')).toBeVisible();
    await page.getByTestId('toolbar-back').click();
    await expect(page.getByTestId('vault-list')).toBeVisible();
  });
});

test('the filters panel keeps every control inside its card, even with long tags', async ({
  page,
}) => {
  await openVault(page);
  await page.getByTestId('vault-filters-toggle').click();
  const card = page.getByTestId('vault-filters');
  const mode = card.getByRole('radiogroup', { name: 'Type of search' });
  await expect(mode).toBeVisible();
  const tags = card.getByRole('group', { name: 'Filter by tag' });
  await tags.evaluate((g) => {
    const chip = g.firstElementChild!.cloneNode(true) as HTMLElement;
    chip.querySelector('span')!.textContent = `#${'x'.repeat(80)}`;
    g.appendChild(chip);
  });
  const box = (await card.boundingBox())!;
  for (const t of [mode, card.getByTestId('vault-folder'), tags.getByRole('button').last()]) {
    const b = (await t.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
  }
});
