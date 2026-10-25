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
    name: 'Test.pdf',
    mime: 'application/pdf',
    size: 900,
    kind: 'pdf',
    source: 'agent',
    agent: 'titan',
    path: 'File/2026-10/Test.pdf',
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
      body: pdf([['Monsters test', '', 'A line of text.'], ['Second page']]),
    });
  });

  await test.step('setup with the one-time code from the setup-code file', async () => {
    const res = await page.goto('/');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Setup code').fill('AAAA-BBBB-CCCC');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('That code isn’t right');

    const code = readFileSync(codeFile, 'utf8').trim();
    await page.getByLabel('Setup code').fill(code);
    await page.getByRole('button', { name: 'Create account' }).click();
    // The team already exists in this home, so the onboarding is skipped.
    await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
    // The code works once: the core deletes the file.
    expect(existsSync(codeFile)).toBe(false);
  });

  await test.step('settings from the core, logout and login', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Models' }).click();
    // No OpenRouter key: it waits among the models to connect (open when nothing is).
    await expect(page.getByTestId('models-connected')).toBeVisible();
    if ((await page.getByTestId('models-add').count()) === 0) {
      await page.getByRole('button', { name: 'Connect another model' }).click();
    }
    await expect(page.getByTestId('key-status')).toHaveAttribute('data-set', 'no');
    await page.getByRole('tab', { name: 'General' }).click();
    await expect(page.getByTestId('vault-path')).toHaveText(join(HOME, 'Monsters Note'));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Wrong email or password');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Titan,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Rhea,/ })).toBeVisible();
  });

  await test.step('a message: delegation to Rhea and a question with options', async () => {
    const input = page.getByRole('combobox', { name: 'Message' });
    await input.fill('Find me three facts about Enceladus');
    await input.press('Enter');
    await expect(page.getByTestId('user-bubble').last()).toHaveText(
      'Find me three facts about Enceladus',
    );
    await expect(
      page.getByTestId('agent-bubble').filter({ hasText: 'I’ll ask Rhea' }),
    ).toBeVisible();
    await expect(page.getByTestId('delegation').filter({ hasText: 'Enceladus' })).toBeVisible();

    const card = page.getByTestId('question-card').first();
    await expect(card).toContainText('Shall I save the three facts in a note?');
    await expect(card).toHaveAttribute('data-status', 'open');
    await card.getByRole('button', { name: /^Yes, in a note/ }).click();
    await expect(card).toHaveAttribute('data-status', 'answered');
    await expect(card).toContainText('You chose: Yes, in a note');
  });

  await test.step('the reply streams in', async () => {
    const streaming = page.locator('[data-testid="agent-bubble"][data-streaming="true"]');
    await expect(streaming).toContainText('Done!');
    const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Done! Rhea found' });
    await expect(bubble).toHaveAttribute('data-streaming', 'false');
    // The wikilink shows as a note chip, without the brackets.
    await expect(bubble).toHaveText(FINAL_REPLY.replace('[[Enceladus]]', 'Enceladus'));
    await expect(bubble.getByTestId('note-chip')).toHaveText('Enceladus');
    expect(existsSync(join(HOME, 'Monsters Note', `${NOTE_PATH}.md`))).toBe(true);
  });

  await test.step('the delegation in Rhea’s terminal', async () => {
    // The delegation in Titan's chat opens the terminal of who did the work.
    await page.getByTestId('delegation').filter({ hasText: 'Enceladus' }).first().click();
    const term = page.getByTestId('agent-terminal');
    await expect(term.getByRole('heading', { name: 'Behind the scenes of Rhea' })).toBeVisible();
    const log = term.getByTestId('terminal-log');
    await expect(log).toContainText('Find three facts about Enceladus with a source');
    await expect(
      term.getByTestId('tool-line').filter({ hasText: /Enceladus main facts/ }),
    ).toBeVisible();
    await expect(log).toContainText('Three facts about Enceladus');
    await page.keyboard.press('Escape');
    await expect(term).toBeHidden();
  });

  await test.step('Anteprima under the core’s CSP: the note of the reply', async () => {
    // The note opens in the right-hand pane, read from the real vault (D-075).
    const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Done! Rhea found' });
    await bubble.getByTestId('note-chip').click();
    const dock = page.getByTestId('right-dock');
    await expect(dock.getByTestId('preview-title')).toHaveText('Enceladus');
    await expect(dock.getByTestId('vault-note-body')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(dock).toHaveCount(0);
  });

  await test.step('undo the note from the action log, still undone after a reload', async () => {
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
    await page
      .getByRole('group', { name: 'Filter by type' })
      .getByRole('button', { name: 'Note changes' })
      .click();
    const row = page
      .getByTestId('event-row')
      .filter({ hasText: 'Titan created the note Enceladus' });
    await row.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Change undone' })).toBeVisible();
    await expect(row).toContainText('Undone');
    expect(existsSync(join(HOME, 'Monsters Note', `${NOTE_PATH}.md`))).toBe(false);

    await page.reload();
    await page
      .getByRole('group', { name: 'Filter by type' })
      .getByRole('button', { name: 'Note changes' })
      .click();
    const after = page
      .getByTestId('event-row')
      .filter({ hasText: 'Titan created the note Enceladus' });
    await expect(after).toContainText('Undone');
    await expect(after.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(after.getByRole('button', { name: 'Redo' })).toBeVisible();
  });

  await test.step('notes view: trash, search, edit, history and undo on the real vault', async () => {
    const file = join(HOME, 'Monsters Note', `${NOTE_PATH}.md`);
    const title = page.locator('#vault-note-title');
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();

    // The note whose creation was undone above is in the trash: restore it.
    await page.getByTestId('vault-trash-link').click();
    const item = page.getByTestId('vault-trash-item').filter({ hasText: 'Enceladus' });
    await expect(item).toContainText('Was in Resources › Research');
    await expect(item).toContainText('removed by undoing its creation');
    await item.getByTestId('vault-trash-restore').click();
    await expect(title).toHaveText('Enceladus');
    expect(existsSync(file)).toBe(true);

    await page.getByTestId('vault-search').fill('Enceladus');
    await expect(
      page.getByTestId('vault-results').getByRole('link', { name: /^Enceladus/ }),
    ).toBeVisible();

    // Edit from the UI: a `user` action, the properties stay.
    await page.getByTestId('vault-edit').click();
    await page.getByTestId('vault-editor').fill('# Enceladus\n\nEdited from the interface.\n');
    await page.getByTestId('vault-save').click();
    await expect(page.getByTestId('vault-note-body')).toContainText('Edited from the interface');
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain('Edited from the interface');
    expect(saved).toMatch(/^---\n[\s\S]*author: titan[\s\S]*---\n/);

    // History: the save is the newest version, by the user.
    await page.getByTestId('vault-history-toggle').click();
    const newest = page.getByTestId('vault-history-entry').first();
    await expect(newest).toContainText('You');
    await newest.getByRole('button', { name: 'Details' }).click();
    await expect(newest.getByTestId('vault-diff')).toContainText('+Edited from the interface.');
    // Undo it from the note's Attività.
    await page.getByTestId('vault-activity').click();
    const edit = page.getByTestId('event-row').filter({ hasText: 'You edited the note' }).first();
    await edit.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Change undone' })).toBeVisible();
    expect(readFileSync(file, 'utf8')).not.toContain('Edited from the interface');
    // Rifai: undoing the undo brings the edit back.
    await edit.getByRole('button', { name: 'Redo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Change redone' })).toBeVisible();
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('Edited from the interface');

    // The graph draws the vault.
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByTestId('vault-graph-toggle').click();
    await expect(page.getByTestId('vault-graph').locator('canvas')).toBeVisible();
  });

  await test.step('kill switch during a run, then resume', async () => {
    await page
      .getByTestId('sidebar')
      .getByRole('link', { name: /^Titan,/ })
      .click();
    const input = page.getByRole('combobox', { name: 'Message' });
    await input.fill('Write me a long poem');
    await input.press('Enter');
    await expect(page.getByRole('link', { name: /^Titan, working/ })).toBeVisible();

    await page.getByTestId('kill').click();
    await page.getByTestId('kill').click();
    await expect(page.getByTestId('halt-banner')).toContainText('The monsters are stopped');
    // Writing stays possible: the message leaves when the monsters resume (D-060).
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute('placeholder', /Resume/);
    await expect(page.getByRole('link', { name: /^Titan, paused/ })).toBeVisible();

    // "Riprendi e continua": the core starts the poem again, the chat says so in a
    // status line and not as a message typed again (D-072).
    const bubbles = await page.getByTestId('user-bubble').count();
    await expect(page.getByTestId('halt-banner')).toContainText('the work of Titan');
    await page.getByTestId('halt-continue').click();
    await expect(page.getByTestId('halt-banner')).toBeHidden();
    await expect(page.getByTestId('system-row').last()).toContainText(
      'Picked the stopped work back up: “Write me a long poem”',
    );
    await expect(
      page.getByTestId('agent-bubble').filter({ hasText: 'Here I am again' }),
    ).toHaveAttribute('data-streaming', 'false');
    await expect(page.getByTestId('user-bubble')).toHaveCount(bubbles);
    await expect(input).toBeEnabled();
  });

  await test.step('a PDF in Anteprima, drawn by pdf.js under the core’s CSP', async () => {
    const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Here I am again' });
    await bubble.getByTestId('file-link').click();
    const dock = page.getByTestId('right-dock');
    await expect(dock.getByTestId('preview-title')).toHaveText('Test.pdf');
    await expect(dock.getByTestId('preview-pdf-page')).toHaveCount(2);
    await expect(dock.getByTestId('preview-pdf-pages')).toHaveText('Page 1 / 2');
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
    await expect(page.getByRole('link', { name: /^Titan, (done|available)/ })).toBeVisible();
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.getByTestId('conversation-divider')).toBeVisible();
    await expect(page.getByTestId('user-bubble')).toHaveCount(0);
    await expect(page.getByTestId('agent-bubble')).toHaveCount(0);

    // The boundary lives in the core's log: still there after a reload.
    await page.reload();
    await expect(page.getByTestId('conversation-divider')).toBeVisible();
    await expect(page.getByTestId('agent-bubble')).toHaveCount(0);
    await page.getByTestId('earlier-toggle').click();
    await expect(
      page.getByTestId('agent-bubble').filter({ hasText: 'Here I am again' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(
      page.getByTestId('event-row').filter({ hasText: 'You started a new conversation' }),
    ).toBeVisible();
  });

  await test.step('permissions: the terminal off for one monster, saved in settings.json', async () => {
    await page.goto('/#/impostazioni?sezione=permessi');
    const rhea = page.getByTestId('agent-permissions-rhea');
    await rhea.getByRole('button', { expanded: false }).click();
    // On by default (D-159): one monster without it.
    await expect(rhea.getByTestId('permissions-summary')).toContainText('terminal');
    await rhea.getByRole('switch', { name: 'Terminal' }).click();
    await expect(rhea.getByTestId('permissions-summary')).not.toContainText('terminal');
    await rhea.getByLabel('Add a folder: computer folders').fill(HOME);
    await rhea.getByRole('button', { name: 'Add' }).click();
    await expect(rhea.getByRole('alert')).toContainText('Monsters data folder');
    const settings = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')) as {
      permissions: { agents: Record<string, { shell: boolean }> };
    };
    expect(settings.permissions.agents['rhea']?.shell).toBe(false);
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(
      page.getByTestId('event-row').filter({ hasText: 'You changed Rhea’s permissions' }),
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
      .setInputFiles([{ name: 'tiny-square.png', mimeType: 'image/png', buffer: png }]);
    const chip = page.getByTestId('composer-attachments').getByTestId('file-chip');
    await expect(chip).toHaveAttribute('data-state', 'ready');
    // The notes folder of a test core is `<home>/Monsters Note`.
    expect(existsSync(join(HOME, 'Monsters Note', 'File', '.gitignore'))).toBe(true);
    await chip.getByRole('button', { name: 'Remove tiny-square.png' }).click();
    await page.keyboard.press('ControlOrMeta+4');
    const tile = page.getByTestId('file-tile').filter({ hasText: 'tiny-square.png' });
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
    await page
      .getByTestId('project-form')
      .getByRole('button', { name: /More options/ })
      .click();
    await page
      .getByTestId('project-form')
      .getByRole('radiogroup', { name: 'The project’s folder' })
      .getByRole('radio', { name: 'A new one' })
      .click();
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

    await page.getByRole('tab', { name: 'Squad' }).click();
    await expect(page.getByTestId('project-member')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByTestId('project-folder-path')).toHaveText(folder);
    const stop = page.getByTestId('project-stop');
    await stop.click();
    await stop.click();
    await expect(page.getByText('Nobody was working in Newsletter')).toBeVisible();
    await expect(page.getByTestId('halt-banner')).toHaveCount(0);

    await page.getByTestId('project-archive').getByRole('button', { name: 'Archive' }).click();
    await page.getByTestId('project-archive').getByRole('button', { name: 'Yes, archive' }).click();
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
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    const fallback = page.getByTestId('error-boundary');
    await expect(fallback).toContainText('There’s a new version of Monsters');
    // One message only (the prompt of vite:preloadError stays hidden), the top bar still works.
    await expect(page.getByTestId('update-prompt')).toHaveCount(0);
    await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Titan,/ })).toBeVisible();

    await page.unroute(missing);
    await fallback.getByRole('button', { name: 'Reload the page' }).click();
    await expect(page.getByTestId('vault-view')).toBeVisible();
    // The missing file and the error caught by the boundary are logged on purpose.
    const expected = /status of 404|dynamically imported module|VaultView/;
    for (let i = consoleErrors.length - 1; i >= 0; i--)
      if (expected.test(consoleErrors[i]!)) consoleErrors.splice(i, 1);
  });
});
