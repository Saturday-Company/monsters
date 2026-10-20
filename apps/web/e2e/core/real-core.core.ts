import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { fileContentHeaders } from '../../../../packages/core/src/server/file-headers.ts';
import { pdf } from '../../scripts/mock-files.ts';
import { FINAL_REPLY, NOTE_PATH } from './scenario.ts';

/*
 * The UI served by a real core (see playwright.core.config.ts): setup with the
 * one-time code, login, a message with a streamed reply, a delegation, a question
 * with options, undo of a note, kill switch and “Riprendi e continua”.
 */

const HOME = process.env['MONSTERS_E2E_HOME']!;
const EMAIL = 'giulio@esempio.it';
const PASSWORD = 'una-password-lunga';

/** Fails on any error in the browser console (CSP violations included). */
const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // Expected answers of the API that the browser logs anyway: `/api/me`
        // before login and a wrong password (401), a wrong setup code (403), a
        // folder the core refuses to grant (400).
        if (/Failed to load resource: the server responded with a status of 40[013]/.test(text))
          return;
        errors.push(text);
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors, 'errors in the browser console').toEqual([]);
    },
    { auto: true },
  ],
});

test('setup, chat, delegation, question, undo, kill and resume against a real core', async ({
  page,
  consoleErrors,
}) => {
  const codeFile = join(HOME, 'setup-code');
  // A PDF of the core's files, served here as the files' route of wave 2 will (D-075):
  // the page, its CSP and the pdf.js worker are the build's, from the real core.
  const pdfMeta = {
    id: 'e2e-pdf',
    name: 'Prova.pdf',
    mime: 'application/pdf',
    size: 900,
    kind: 'pdf',
    source: 'agent',
    agent: 'titan',
    path: 'File/2026-10/Prova.pdf',
    hasThumb: false,
    hasText: false,
    createdAt: Date.now(),
  };
  // The chat asks the metadata of its files by id, together (D-086).
  await page.route(/\/api\/files\?ids=e2e-pdf$/, (route) =>
    route.fulfill({ json: { files: [pdfMeta] } }),
  );
  // In a browser the bytes of a file go with a ticket of the session in the URL (S-B13).
  const pdfUrls: string[] = [];
  await page.route(/\/api\/files\/e2e-pdf\/content(\?.*)?$/, (route) => {
    pdfUrls.push(route.request().url());
    return route.fulfill({
      status: 200,
      headers: { ...fileContentHeaders(pdfMeta), 'Content-Type': 'application/pdf' },
      body: pdf([['Prova di Monsters', '', 'Una riga di testo.'], ['Seconda pagina']]),
    });
  });

  await test.step('setup with the one-time code from the setup-code file', async () => {
    const res = await page.goto('/');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    await expect(page.getByRole('heading', { name: 'Crea il tuo account' })).toBeVisible();

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Codice di avvio').fill('AAAA-BBBB-CCCC');
    await page.getByRole('button', { name: 'Crea account' }).click();
    await expect(page.getByRole('alert')).toContainText('Il codice non è giusto');

    const code = readFileSync(codeFile, 'utf8').trim();
    await page.getByLabel('Codice di avvio').fill(code);
    await page.getByRole('button', { name: 'Crea account' }).click();
    // The team already exists in this home, so the onboarding is skipped.
    await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
    // The code works once: the core deletes the file.
    expect(existsSync(codeFile)).toBe(false);
  });

  await test.step('settings from the core, logout and login', async () => {
    await page.getByRole('link', { name: 'Impostazioni' }).click();
    await page.getByRole('tab', { name: 'Modelli' }).click();
    // No OpenRouter key: it waits among the models to connect (open when nothing is).
    await expect(page.getByTestId('models-connected')).toBeVisible();
    if ((await page.getByTestId('models-add').count()) === 0) {
      await page.getByRole('button', { name: 'Collega un altro modello' }).click();
    }
    await expect(page.getByTestId('key-status')).toHaveAttribute('data-set', 'no');
    await page.getByRole('tab', { name: 'Generale' }).click();
    await expect(page.getByTestId('vault-path')).toHaveText(join(HOME, 'Monsters Note'));
    await page.getByRole('button', { name: 'Esci' }).click();
    await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('password-sbagliata');
    await page.getByRole('button', { name: 'Entra' }).click();
    await expect(page.getByRole('alert')).toContainText('Email o password non corrette');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entra' }).click();
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Titan,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Rhea,/ })).toBeVisible();
  });

  await test.step('a message: delegation to Rhea and a question with options', async () => {
    const input = page.getByRole('combobox', { name: 'Messaggio' });
    await input.fill('Trovami tre fatti su Encelado');
    await input.press('Enter');
    await expect(page.getByTestId('user-bubble').last()).toHaveText(
      'Trovami tre fatti su Encelado',
    );
    await expect(
      page.getByTestId('agent-bubble').filter({ hasText: 'Chiedo a Rhea' }),
    ).toBeVisible();
    await expect(page.getByTestId('delegation').filter({ hasText: 'Encelado' })).toBeVisible();

    const card = page.getByTestId('question-card').first();
    await expect(card).toContainText('Salvo i tre fatti in una nota?');
    await expect(card).toHaveAttribute('data-status', 'open');
    await card.getByRole('button', { name: /^Sì, in una nota/ }).click();
    await expect(card).toHaveAttribute('data-status', 'answered');
    await expect(card).toContainText('Hai scelto: Sì, in una nota');
  });

  await test.step('the reply streams in', async () => {
    const streaming = page.locator('[data-testid="agent-bubble"][data-streaming="true"]');
    await expect(streaming).toContainText('Fatto!');
    const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Fatto! Rhea ha trovato' });
    await expect(bubble).toHaveAttribute('data-streaming', 'false');
    // The wikilink shows as a note chip, without the brackets.
    await expect(bubble).toHaveText(FINAL_REPLY.replace('[[Encelado]]', 'Encelado'));
    await expect(bubble.getByTestId('note-chip')).toHaveText('Encelado');
    expect(existsSync(join(HOME, 'Monsters Note', `${NOTE_PATH}.md`))).toBe(true);
  });

  await test.step('the delegation in Rhea’s terminal', async () => {
    // The delegation in Titan's chat opens the terminal of who did the work.
    await page.getByTestId('delegation').filter({ hasText: 'Encelado' }).first().click();
    const term = page.getByTestId('agent-terminal');
    await expect(term.getByRole('heading', { name: 'Dietro le quinte di Rhea' })).toBeVisible();
    const log = term.getByTestId('terminal-log');
    await expect(log).toContainText('Trova tre fatti su Encelado con una fonte');
    await expect(
      term.getByTestId('tool-line').filter({ hasText: /Encelado fatti principali/ }),
    ).toBeVisible();
    await expect(log).toContainText('Tre fatti su Encelado');
    await page.keyboard.press('Escape');
    await expect(term).toBeHidden();
  });

  await test.step('Anteprima under the core’s CSP: the note of the reply', async () => {
    // The note opens in the right-hand pane, read from the real vault (D-075).
    const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Fatto! Rhea ha trovato' });
    await bubble.getByTestId('note-chip').click();
    const dock = page.getByTestId('right-dock');
    await expect(dock.getByTestId('preview-title')).toHaveText('Encelado');
    await expect(dock.getByTestId('vault-note-body')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(dock).toHaveCount(0);
  });

  await test.step('undo the note from the action log, still undone after a reload', async () => {
    await page.getByRole('link', { name: 'Attività', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attività', exact: true })).toBeVisible();
    await page
      .getByRole('group', { name: 'Filtra per tipo' })
      .getByRole('button', { name: 'Modifiche alle note' })
      .click();
    const row = page
      .getByTestId('event-row')
      .filter({ hasText: 'Titan ha creato la nota Encelado' });
    await row.getByRole('button', { name: 'Annulla' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Modifica annullata' })).toBeVisible();
    await expect(row).toContainText('Annullata');
    expect(existsSync(join(HOME, 'Monsters Note', `${NOTE_PATH}.md`))).toBe(false);

    await page.reload();
    await page
      .getByRole('group', { name: 'Filtra per tipo' })
      .getByRole('button', { name: 'Modifiche alle note' })
      .click();
    const after = page
      .getByTestId('event-row')
      .filter({ hasText: 'Titan ha creato la nota Encelado' });
    await expect(after).toContainText('Annullata');
    await expect(after.getByRole('button', { name: 'Annulla' })).toHaveCount(0);
    await expect(after.getByRole('button', { name: 'Rifai' })).toBeVisible();
  });

  await test.step('notes view: trash, search, edit, history and undo on the real vault', async () => {
    const file = join(HOME, 'Monsters Note', `${NOTE_PATH}.md`);
    const title = page.locator('#vault-note-title');
    await page.getByRole('link', { name: 'Note', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();

    // The note whose creation was undone above is in the trash: restore it.
    await page.getByTestId('vault-trash-link').click();
    const item = page.getByTestId('vault-trash-item').filter({ hasText: 'Encelado' });
    await expect(item).toContainText('Era in Risorse › Ricerche');
    await expect(item).toContainText('tolta annullando la creazione');
    await item.getByTestId('vault-trash-restore').click();
    await expect(title).toHaveText('Encelado');
    expect(existsSync(file)).toBe(true);

    await page.getByTestId('vault-search').fill('Encelado');
    await expect(
      page.getByTestId('vault-results').getByRole('link', { name: /^Encelado/ }),
    ).toBeVisible();

    // Edit from the UI: a `user` action, the properties stay.
    await page.getByTestId('vault-edit').click();
    await page.getByTestId('vault-editor').fill('# Encelado\n\nModificata dall’interfaccia.\n');
    await page.getByTestId('vault-save').click();
    await expect(page.getByTestId('vault-note-body')).toContainText('Modificata dall’interfaccia');
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain('Modificata dall’interfaccia');
    expect(saved).toMatch(/^---\n[\s\S]*author: titan[\s\S]*---\n/);

    // History: the save is the newest version, by the user.
    await page.getByTestId('vault-history-toggle').click();
    const newest = page.getByTestId('vault-history-entry').first();
    await expect(newest).toContainText('Tu');
    await newest.getByRole('button', { name: 'Dettagli' }).click();
    await expect(newest.getByTestId('vault-diff')).toContainText('+Modificata dall’interfaccia.');
    // Undo it from the note's Attività.
    await page.getByTestId('vault-activity').click();
    const edit = page
      .getByTestId('event-row')
      .filter({ hasText: 'Hai modificato la nota' })
      .first();
    await edit.getByRole('button', { name: 'Annulla' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Modifica annullata' })).toBeVisible();
    expect(readFileSync(file, 'utf8')).not.toContain('Modificata dall’interfaccia');
    // Rifai: undoing the undo brings the edit back.
    await edit.getByRole('button', { name: 'Rifai' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Modifica rifatta' })).toBeVisible();
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('Modificata dall’interfaccia');

    // The graph draws the vault.
    await page.getByRole('link', { name: 'Note', exact: true }).click();
    await page.getByTestId('vault-graph-toggle').click();
    await expect(page.getByTestId('vault-graph').locator('canvas')).toBeVisible();
  });

  await test.step('kill switch during a run, then resume', async () => {
    await page
      .getByTestId('sidebar')
      .getByRole('link', { name: /^Titan,/ })
      .click();
    const input = page.getByRole('combobox', { name: 'Messaggio' });
    await input.fill('Scrivimi una poesia lunga');
    await input.press('Enter');
    await expect(page.getByRole('link', { name: /^Titan, al lavoro/ })).toBeVisible();

    await page.getByTestId('kill').click();
    await page.getByTestId('kill').click();
    await expect(page.getByTestId('halt-banner')).toContainText('I mostri sono fermi');
    // Writing stays possible: the message leaves when the monsters resume (D-060).
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute('placeholder', /Riprendi/);
    await expect(page.getByRole('link', { name: /^Titan, in pausa/ })).toBeVisible();

    // "Riprendi e continua": the core starts the poem again, the chat says so in a
    // status line and not as a message typed again (D-072).
    const bubbles = await page.getByTestId('user-bubble').count();
    await expect(page.getByTestId('halt-banner')).toContainText('il lavoro di Titan');
    await page.getByTestId('halt-continue').click();
    await expect(page.getByTestId('halt-banner')).toBeHidden();
    await expect(page.getByTestId('system-row').last()).toContainText(
      'Ripreso il lavoro fermato: «Scrivimi una poesia lunga»',
    );
    await expect(
      page.getByTestId('agent-bubble').filter({ hasText: 'Eccomi di nuovo' }),
    ).toHaveAttribute('data-streaming', 'false');
    await expect(page.getByTestId('user-bubble')).toHaveCount(bubbles);
    await expect(input).toBeEnabled();
  });

  await test.step('a PDF in Anteprima, drawn by pdf.js under the core’s CSP', async () => {
    const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Eccomi di nuovo' });
    await bubble.getByTestId('file-link').click();
    const dock = page.getByTestId('right-dock');
    await expect(dock.getByTestId('preview-title')).toHaveText('Prova.pdf');
    await expect(dock.getByTestId('preview-pdf-page')).toHaveCount(2);
    await expect(dock.getByTestId('preview-pdf-pages')).toHaveText('Pagina 1 / 2');
    expect(pdfUrls.length).toBeGreaterThan(0);
    for (const url of pdfUrls) expect(url).toMatch(/[?&]ticket=[\w-]{43}/);
    await expect
      .poll(() =>
        dock
          .locator('canvas')
          .first()
          .evaluate((c: HTMLCanvasElement) => {
            const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
            let dark = 0;
            if (d) for (let i = 0; i < d.length; i += 16) if (d[i]! < 100) dark++;
            return dark;
          }),
      )
      .toBeGreaterThan(50);
    await page.keyboard.press('Escape');
    await expect(dock).toHaveCount(0);
  });

  await test.step('new conversation: the chat starts over, the old one stays in the log', async () => {
    await expect(page.getByRole('link', { name: /^Titan, (ha finito|disponibile)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Nuova conversazione' }).click();
    await expect(page.getByTestId('conversation-divider')).toBeVisible();
    await expect(page.getByTestId('user-bubble')).toHaveCount(0);
    await expect(page.getByTestId('agent-bubble')).toHaveCount(0);

    // The boundary lives in the core's log: still there after a reload.
    await page.reload();
    await expect(page.getByTestId('conversation-divider')).toBeVisible();
    await expect(page.getByTestId('agent-bubble')).toHaveCount(0);
    await page.getByTestId('earlier-toggle').click();
    await expect(
      page.getByTestId('agent-bubble').filter({ hasText: 'Eccomi di nuovo' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Attività', exact: true }).click();
    await expect(
      page.getByTestId('event-row').filter({ hasText: 'Hai iniziato una nuova conversazione' }),
    ).toBeVisible();
  });

  await test.step('permissions: the terminal for one monster, saved in settings.json', async () => {
    await page.goto('/#/impostazioni?sezione=permessi');
    const rhea = page.getByTestId('agent-permissions-rhea');
    await rhea.getByRole('button', { expanded: false }).click();
    await rhea.getByRole('switch', { name: 'Terminale' }).click();
    await expect(rhea.getByTestId('permissions-summary')).toContainText('terminale');
    await rhea.getByLabel('Aggiungi una cartella a cartelle del computer').fill(HOME);
    await rhea.getByRole('button', { name: 'Aggiungi' }).click();
    await expect(rhea.getByRole('alert')).toContainText('dati di Monsters');
    const settings = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')) as {
      permissions: { agents: Record<string, { shell: boolean }> };
    };
    expect(settings.permissions.agents['rhea']?.shell).toBe(true);
    await page.getByRole('link', { name: 'Attività', exact: true }).click();
    await expect(
      page.getByTestId('event-row').filter({ hasText: 'Hai cambiato i permessi di Rhea' }),
    ).toBeVisible();
  });

  await test.step('a file: upload from the composer with its thumbnail, File section, delete', async () => {
    await page.goto('/#/');
    // A real 2×2 PNG: the browser makes the WebP thumbnail, the core keeps both under File/.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGM4AQYMEAoAQa4JYQOnncMAAAAASUVORK5CYII=',
      'base64',
    );
    await page
      .getByTestId('composer-file-input')
      .setInputFiles([{ name: 'quadratino.png', mimeType: 'image/png', buffer: png }]);
    const chip = page.getByTestId('composer-attachments').getByTestId('file-chip');
    await expect(chip).toHaveAttribute('data-state', 'ready');
    // The notes folder of a test core is `<home>/Monsters Note`.
    expect(existsSync(join(HOME, 'Monsters Note', 'File', '.gitignore'))).toBe(true);
    await chip.getByRole('button', { name: 'Togli quadratino.png' }).click();
    await page.keyboard.press('ControlOrMeta+4');
    const tile = page.getByTestId('file-tile').filter({ hasText: 'quadratino.png' });
    await expect(tile).toBeVisible();
    // The picture comes from the core (cookie, nosniff), never broken.
    await expect
      .poll(() => tile.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await tile.getByTestId('file-delete').click();
    await tile.getByTestId('file-delete').click();
    await expect(tile).toHaveCount(0);
  });

  await test.step('S-B13: a new tab finds the session in the open one; the cookie alone opens nothing', async () => {
    // A new tab of the same browser: no password, the open tab gives it the session's secret.
    const second = await page.context().newPage();
    await second.goto('/#/');
    await expect(second.getByTestId('chat-panel')).toBeVisible();
    await second.close();
    // The cookie as another service on 127.0.0.1 receives it: not enough for the API.
    const session = (await page.context().cookies()).find((c) => c.name === 'monsters_session');
    expect(session).toBeDefined();
    const origin = new URL(page.url()).origin;
    const me = await fetch(`${origin}/api/me`, {
      headers: { cookie: `monsters_session=${session!.value}` },
    });
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: 'session_secret_required' });
  });

  await test.step('a project: created from the sidebar with a new folder, its squad, Ferma progetto, archived and back', async () => {
    await page.goto('/#/');
    const folder = join(dirname(HOME), 'progetto-newsletter');
    await page.getByTestId('project-new').click();
    await page.getByTestId('project-name').fill('Newsletter');
    await page.getByTestId('project-form').getByRole('radio', { name: 'Una nuova' }).click();
    await page.getByTestId('project-path').fill(folder);
    await page.getByTestId('project-lead-name').fill('Atlas');
    await page.getByTestId('project-copies').getByTestId('pick-rhea').click();
    await page.getByTestId('project-create').click();
    await expect(page).toHaveURL(/#\/progetto\?id=newsletter$/);
    // The core made the folder and the lead; the copy has a name of its own.
    expect(existsSync(folder)).toBe(true);
    await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'atlas');
    const squad = page.locator('[data-testid="squad"][data-squad="newsletter"]');
    await expect(squad.getByTestId('chat-row')).toHaveCount(2);
    // D-122: a copy gets a free name of its own, not "Rhea · Newsletter" nor "Rhea".
    const copyRow = squad.getByTestId('chat-row').nth(1);
    await expect(copyRow).not.toContainText('Rhea');
    await expect(copyRow).not.toContainText('·');

    await page.getByRole('tab', { name: 'Squadra' }).click();
    await expect(page.getByTestId('project-member')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Cartella' }).click();
    await expect(page.getByTestId('project-folder-path')).toHaveText(folder);
    const stop = page.getByTestId('project-stop');
    await stop.click();
    await stop.click();
    await expect(page.getByText('Nel progetto Newsletter non lavorava nessuno')).toBeVisible();
    await expect(page.getByTestId('halt-banner')).toHaveCount(0);

    await page.getByTestId('project-archive').getByRole('button', { name: 'Archivia' }).click();
    await page.getByTestId('project-archive').getByRole('button', { name: 'Sì, archivia' }).click();
    await expect(page.getByTestId('project-archived-page')).toBeVisible();
    await expect(squad).toHaveCount(0);
    await page.getByTestId('project-restore').click();
    await expect(page.getByTestId('project-page')).toBeVisible();
    await expect(squad.getByTestId('chat-row')).toHaveCount(2);
  });

  await test.step('a page whose file is gone after an update: a plain message, reload when asked', async () => {
    const missing = '**/assets/VaultView-*.js';
    await page.route(missing, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto('/#/');
    await page.reload();
    await page.getByRole('link', { name: 'Note', exact: true }).click();
    const fallback = page.getByTestId('error-boundary');
    await expect(fallback).toContainText('C’è una versione nuova di Monsters');
    // One message only (the prompt of vite:preloadError stays hidden), the top bar still works.
    await expect(page.getByTestId('update-prompt')).toHaveCount(0);
    await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Titan,/ })).toBeVisible();

    await page.unroute(missing);
    await fallback.getByRole('button', { name: 'Ricarica la pagina' }).click();
    await expect(page.getByTestId('vault-view')).toBeVisible();
    // The missing file and the error caught by the boundary are logged on purpose.
    const expected = /status of 404|dynamically imported module|VaultView/;
    for (let i = consoleErrors.length - 1; i >= 0; i--)
      if (expected.test(consoleErrors[i]!)) consoleErrors.splice(i, 1);
  });
});
