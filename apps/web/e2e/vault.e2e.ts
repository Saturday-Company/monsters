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
  await expect(results.getByRole('link', { name: /^Lisbona, spunti/ })).toBeVisible();
  await results.getByRole('link', { name: /^Tram 28/ }).click();
  await expect(title(page)).toHaveText('Tram 28');
  await expect(page).toHaveURL(/#\/note\?nota=Risorse%2FTram%2028\.md$/);

  // Wikilink in the text.
  await page
    .getByTestId('vault-note-body')
    .getByRole('link', { name: 'Lisbona, spunti per il weekend' })
    .click();
  await expect(title(page)).toHaveText('Lisbona, spunti per il weekend');

  // Backlinks: who links here (not the monsters' own notes).
  const backlinks = page.getByTestId('vault-backlinks');
  await expect(backlinks.getByRole('link')).toHaveCount(3);
  await backlinks.getByRole('link', { name: /Bozze dei post/ }).click();
  await expect(title(page)).toHaveText('Bozze dei post');

  // Back in the browser history goes to the previous note.
  await page.goBack();
  await expect(title(page)).toHaveText('Lisbona, spunti per il weekend');
});

test('the list: Recenti, then closed folders; the monsters’ notes on request', async ({ page }) => {
  await openVault(page);
  const list = page.getByTestId('vault-list');
  await expect(page.getByTestId('vault-recent').getByTestId('vault-note-link')).toHaveCount(5);
  // Folders start closed (the note on screen opens its own).
  const risorse = list
    .getByTestId('vault-folder-group')
    .filter({ has: page.locator('summary', { hasText: /^Risorse\d+$/ }) });
  await expect(risorse).not.toHaveAttribute('open', '');
  await risorse.locator('summary').click();
  await expect(risorse.getByRole('link', { name: /^Tram 28/ })).toBeVisible();
  // A clean preview: no Markdown marks.
  await expect(list.getByTestId('vault-note-link').first()).not.toContainText('[[');
  await expect(list).not.toContainText('**');

  await expect(list.getByRole('link', { name: /^MEMORY/ })).toHaveCount(0);
  await page.getByTestId('vault-filters-toggle').click();
  await page.getByRole('switch', { name: 'Mostra le note dei mostri' }).click();
  await expect(list.getByRole('link', { name: /^MEMORY/ }).first()).toBeVisible();
});

test('a note named as a link (from the chat) opens, and the address becomes its path', async ({
  page,
}) => {
  await openVault(page, '#/note?nota=Tram%2028');
  await expect(title(page)).toHaveText('Tram 28');
  await expect(page).toHaveURL(/#\/note\?nota=Risorse%2FTram%2028\.md$/);
});

test('tags filter the list; private notes are marked', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('vault-filters-toggle').click();
  await page
    .getByRole('group', { name: 'Filtra per tag' })
    .getByRole('button', { name: /#cibo/ })
    .click();
  const list = page.getByTestId('vault-list');
  await expect(list.getByTestId('vault-note-link')).toHaveCount(2);
  await expect(list.getByRole('link', { name: /Carbonara/ })).toBeVisible();
  await page.getByRole('button', { name: 'Togli i filtri' }).click();

  await page.getByTestId('vault-folder').selectOption('Aree/Finanze');
  const budget = list.getByRole('link', { name: /Budget di ottobre/ });
  await expect(budget.getByTestId('private-mark')).toBeVisible();
  await budget.click();
  await expect(page.getByTestId('vault-reader').getByTestId('private-mark')).toContainText(
    'Privata',
  );
});

test('note content is never raw HTML and bad links are dropped', async ({ page }) => {
  await openVault(page, '#/note?nota=Inbox%2FIdea%20veloce.md');
  const body = page.getByTestId('vault-note-body');
  await expect(body).toContainText('<script>alert(1)</script>');
  await expect(body.locator('script')).toHaveCount(0);
  await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(body.getByTestId('vault-link-missing')).toHaveText('Nota da scrivere');
  await body.getByTestId('vault-embed').click();
  await expect(title(page)).toHaveText('Tram 28');
});

test('graph: the search stands out in it', async ({ page }) => {
  await openVault(page, '#/note?vista=grafo');
  await page.getByTestId('vault-search').fill('tram');
  await expect(
    page.getByTestId('vault-results').getByTestId('vault-note-link').first(),
  ).toBeVisible();
  await expect(page.getByText(/In evidenza (la nota trovata|le \d+ note trovate)/)).toBeVisible();
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
          return hook?.pointOf('Persone/Sara.md') ?? null;
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
  await expect(selection).toContainText('collegament');
  const name = ((await selection.textContent()) ?? '').replace(/, \d+ collegament.*$/, '');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText(name);
});

test('trash: restore a note where it was', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('vault-trash-link').click();
  await expect(page).toHaveURL(/#\/note\?vista=cestino$/);
  const item = page.getByTestId('vault-trash-item').filter({ hasText: 'Lista della spesa' });
  await expect(item).toContainText('Era in Risorse');
  await expect(item).toContainText('cancellata da Dione');
  await item.getByTestId('vault-trash-restore').click();
  await expect(
    page.getByRole('status').filter({ hasText: 'è tornata al suo posto' }),
  ).toBeVisible();
  await expect(title(page)).toHaveText('Lista della spesa');

  // And back to the trash from the reader.
  await page.getByTestId('vault-trash').click();
  await page.getByTestId('vault-trash-confirm').click();
  await expect(page.getByTestId('vault-trash-view')).toBeVisible();
  await expect(
    page.getByTestId('vault-trash-item').filter({ hasText: 'Lista della spesa' }),
  ).toBeVisible();
});

test('history: one action per version; undo and redo live in the note’s Attività', async ({
  page,
}) => {
  await openVault(page, '#/note?nota=Diario%2F2026-10-14.md');
  await expect(page.getByTestId('vault-note-body')).toContainText('Encelado ha riordinato');
  await page.getByTestId('vault-history-toggle').click();
  const entries = page.getByTestId('vault-history-entry');
  await expect(entries).toHaveCount(2);
  // One action: back to a version. The changes and the version id under "Dettagli".
  await expect(entries.first().getByRole('button', { name: 'Annulla' })).toHaveCount(0);
  await expect(entries.first().getByTestId('vault-restore-version')).toHaveCount(0);
  await expect(entries.last().getByTestId('vault-restore-version')).toHaveText(
    'Torna a questa versione',
  );
  await entries.first().getByRole('button', { name: 'Dettagli' }).click();
  await expect(entries.first().getByTestId('vault-diff')).toContainText(
    '+- Encelado ha riordinato il diario.',
  );
  // The version id is git's: in the tooltip of the date, not in the text (audit UI-24).
  await expect(entries.first()).not.toContainText(/Versione [0-9a-f]{7}/);
  await expect(entries.first().getByTestId('vault-diff')).not.toContainText('@@');
  // Out of the history in words, not only with the pressed clock (UI-44).
  await page.getByTestId('vault-history-close').click();
  await expect(page.getByTestId('vault-history')).toBeHidden();
  await expect(page.getByTestId('vault-note-body')).toBeVisible();

  // Undo the change from the note's Attività; Rifai from the row; undo again.
  await page.getByTestId('vault-activity').click();
  await expect(page).toHaveURL(/#\/log\?nota=Diario%2F2026-10-14\.md$/);
  const row = page.getByTestId('event-row').filter({ hasText: 'ha modificato la nota 2026-10-14' });
  await row.getByTestId('undo').click();
  await expect(page.getByRole('status').filter({ hasText: 'Modifica annullata' })).toBeVisible();
  await expect(row.getByTestId('undo-done')).toContainText('Annullata');
  await row.getByTestId('redo').click();
  await expect(page.getByRole('status').filter({ hasText: 'Modifica rifatta' })).toBeVisible();
  await row.getByTestId('undo').click();
  await expect(row.getByTestId('undo-done')).toContainText('Annullata');
  await page.getByRole('link', { name: 'Apri la nota' }).click();
  await expect(page.getByTestId('vault-note-body')).not.toContainText('Encelado ha riordinato');
  // Every undo and redo is a new version on top.
  await page.getByTestId('vault-history-toggle').click();
  await expect(entries).toHaveCount(5);

  // Back to the first version.
  await entries.last().getByTestId('vault-restore-version').click();
  await expect(
    page.getByRole('status').filter({ hasText: 'tornata a quella versione' }),
  ).toBeVisible();
});

test('undo with later changes: the conflict is explained, undo anyway', async ({ page }) => {
  await openVault(page, '#/note?nota=Risorse%2FLisbona%2C%20spunti%20per%20il%20weekend.md');
  await page.getByTestId('vault-edit').click();
  await page.getByTestId('vault-editor').fill('# Lisbona\n\nCambiata dopo.\n');
  await page.getByTestId('vault-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Salvata' })).toBeVisible();
  await page.getByTestId('vault-activity').click();
  const created = page.getByTestId('event-row').filter({ hasText: 'Rhea ha creato la nota' });
  await created.getByTestId('undo').click();
  await expect(created.getByTestId('undo-conflict')).toContainText('è cambiata dopo');
  await created.getByTestId('undo-force').click();
  await expect(created.getByTestId('undo-done')).toContainText('Annullata');
});

test('edit a note: saved as the user, in the history', async ({ page }) => {
  await openVault(page, '#/note?nota=Aree%2FSalute%2FCorsa.md');
  await page.getByTestId('vault-edit').click();
  const editor = page.getByTestId('vault-editor');
  await expect(editor).toHaveValue(/10 km sotto l'ora/);
  await editor.fill(
    "# Corsa\n\nObiettivo: 10 km sotto l'ora entro dicembre.\n\n- Martedì ripetute.\n",
  );
  await page.getByTestId('vault-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Salvata' })).toBeVisible();
  await expect(page.getByTestId('vault-note-body')).toContainText('Martedì ripetute');
  await page.getByTestId('vault-history-toggle').click();
  await expect(page.getByTestId('vault-history-entry').first()).toContainText('Tu');
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
  await expect(folder.locator('option', { hasText: 'Aree › Salute' })).toHaveCount(1);
  const save = form.getByTestId('vault-new-save');
  await expect(save).toBeDisabled();
  await form.getByTestId('vault-new-title').fill('Porto: idee');
  await expect(form.getByRole('alert')).toContainText('non può contenere');
  await expect(save).toBeDisabled();

  await form.getByTestId('vault-new-title').fill('Porto');
  await folder.selectOption('Risorse');
  await form.getByTestId('vault-new-text').fill('# Porto\n\nVino e [[Tram 28]].\n');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Nota creata' })).toBeVisible();
  await expect(page).toHaveURL(/#\/note\?nota=Risorse%2FPorto\.md$/);
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
  await expect(page.getByTestId('vault-history-entry').first()).toContainText('Tu');

  // The same name again: refused, the draft stays.
  await page.getByTestId('vault-new').click();
  await form.getByTestId('vault-new-title').fill('Porto');
  await form.getByTestId('vault-new-folder').selectOption('Risorse');
  await form.getByTestId('vault-new-text').fill('Altro testo');
  await form.getByTestId('vault-new-save').click();
  await expect(form.getByRole('alert')).toHaveText('C’è già una nota con questo nome.');
  await expect(form.getByTestId('vault-new-text')).toHaveValue('Altro testo');
  await form.getByRole('button', { name: 'Annulla' }).click();
  await expect(page).toHaveURL(/#\/note$/);

  // In Attività, as a change of the user (same page: the mock lives in memory).
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(page.getByText(/Porto/).first()).toBeVisible();
});

test('new note in a new folder', async ({ page }) => {
  await openVault(page, '#/note?vista=nuova');
  const form = page.getByTestId('vault-new-note');
  await form.getByTestId('vault-new-title').fill('Lisbona 2027');
  await form.getByTestId('vault-new-folder').selectOption({ label: 'Nuova cartella…' });
  const save = form.getByTestId('vault-new-save');
  await expect(save).toBeDisabled();
  await form.getByTestId('vault-new-folder-name').fill('Viaggi?');
  await expect(form.getByRole('alert')).toContainText('non può contenere');
  await form.getByTestId('vault-new-folder-name').fill('Viaggi');
  await expect(form).toContainText('Per collegare un’altra nota scrivi [[');
  await save.click();
  await expect(page).toHaveURL(/#\/note\?nota=Viaggi%2FLisbona%202027\.md$/);
  await expect(title(page)).toHaveText('Lisbona 2027');
});

test('edit: a change made meanwhile is never overwritten without asking', async ({ page }) => {
  const path = 'Aree/Salute/Corsa.md';
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
  const draft = '# Corsa\n\nLa mia bozza.\n';
  await editor.fill(draft);

  // Dione edits the note while the editor is open: the draft stays, saving waits for a choice.
  await agentEdit('act_e2e_meanwhile_1');
  const conflict = page.getByTestId('vault-edit-conflict');
  await expect(conflict).toContainText('La nota è cambiata mentre la modificavi');
  await expect(editor).toHaveValue(draft);
  await expect(page.getByTestId('vault-save')).toBeDisabled();
  await conflict.getByRole('button', { name: 'Vedi le differenze' }).click();
  await expect(conflict.getByTestId('vault-diff')).toContainText('+- Aggiunto da dione.');
  await conflict.getByRole('button', { name: 'Sovrascrivi con la mia versione' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Salvata' })).toBeVisible();
  await expect(page.getByTestId('vault-note-body')).toContainText('La mia bozza');
  await expect(page.getByTestId('vault-note-body')).not.toContainText('Aggiunto da dione');

  // Again, and this time the draft is dropped: Dione's change stays.
  await page.getByTestId('vault-edit').click();
  await editor.fill('# Corsa\n\nUn’altra bozza.\n');
  await agentEdit('act_e2e_meanwhile_2');
  await conflict.getByRole('button', { name: 'Scarta la mia modifica' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('vault-note-body')).toContainText('Aggiunto da dione');
  await expect(page.getByTestId('vault-note-body')).not.toContainText('Un’altra bozza');
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
    await expect(fallback).toContainText('C’è una versione nuova di Monsters');
    // Only the page is replaced: the sidebar and the toolbar (with the stop) are still there.
    const sidebar = page.getByTestId('sidebar');
    await expect(page.getByTestId('kill')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /^Titan,/ })).toBeVisible();
    await sidebar.getByRole('link', { name: /^Titan,/ }).click();
    await expect(fallback).toBeHidden();
    await sidebar.getByRole('link', { name: 'Note', exact: true }).click();
    await expect(fallback).toBeVisible();

    // Reloading while the file is still missing: said plainly, and no reload by itself.
    await fallback.getByRole('button', { name: 'Ricarica la pagina' }).click();
    await expect(fallback).toContainText('Questa parte non si carica');
    await expect(fallback.getByRole('button', { name: 'Riprova' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(loads).toBe(2);

    // The file is back (the new build): one more reload and the page works.
    await page.unroute(missing);
    await fallback.getByRole('button', { name: 'Riprova' }).click();
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
    await expect(back).toHaveText('Note');
    await expect(
      page.getByTestId('vault-reader').getByRole('button', { name: 'Note' }),
    ).toHaveCount(0);
    // The actions say their name under the icon.
    await expect(page.getByTestId('vault-history-toggle')).toContainText('Cronologia');
    await back.click();
    await expect(page.getByTestId('vault-list')).toBeVisible();
    // At the list the rail's back goes home again.
    await expect(page.getByTestId('toolbar-back')).toHaveText('Indietro');
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
  const mode = card.getByRole('radiogroup', { name: 'Tipo di ricerca' });
  await expect(mode).toBeVisible();
  const tags = card.getByRole('group', { name: 'Filtra per tag' });
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
