import { createSocket } from 'node:dgram';
import type { Page } from '@playwright/test';
import { STUN_PROBE_PORT } from '../src/lib/mock/files-data.ts';
import type * as VaultApi from '../src/components/vault/api.ts';
import type * as PreviewStore from '../src/store/preview.ts';
import type { MockCore } from '../src/lib/mock/core.ts';
import { expect, showTechnicalDetails, test } from './fixtures.ts';

/*
 * The right-hand pane (D-075) on the mock core with `?anteprima=1`: Titan's
 * answer carries an image, a PDF link, a note link and a remote image; it
 * showed a page with `preview_show`; its screenshot is in "Dietro le quinte".
 * Anteprima by kind, the strip, the tabs (Dietro le quinte, Consumi), the
 * width that stays, Esc, ⌘J, the phone, the sandbox of the HTML pages, what a
 * monster shows while you look (and while you don't), Ferma never covered.
 * `SCREENSHOTS=<folder>` writes the pane by kind, light and dark, wide and on
 * a phone.
 */

const SHOTS = process.env['SCREENSHOTS'];
const SCENE = '/?mock=demo&anteprima=1#/?chat=titan';

const dock = (page: Page) => page.getByTestId('right-dock');
const STORE = '/src/store/preview.ts';

const open = (page: Page, item: PreviewStore.PreviewState['items'][number]) =>
  page.evaluate(
    async ([src, it]) => {
      const { openPreview } = (await import(/* @vite-ignore */ src)) as typeof PreviewStore;
      openPreview(it);
    },
    [STORE, item] as const,
  );

test('an image of the chat: fitted, real size with Esc back, Esc closes', async ({ page }) => {
  await page.goto(SCENE);
  await page.getByTestId('chat-image').click();
  await expect(dock(page)).toBeVisible();
  await expect(dock(page).getByTestId('dock-tab-preview')).toHaveAttribute('aria-selected', 'true');
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Autumn menu.png');
  await expect(dock(page).getByTestId('preview-line')).toContainText(/Image · 47 KB · by Dione/i);
  const area = dock(page).getByTestId('preview-image-area');
  await expect(area).toHaveAttribute('data-zoom', 'fit');
  await expect(dock(page).getByTestId('preview-zoom')).toContainText(/Fitted · \d+% · 960×640/i);
  // The checkerboard is under the image only, the image is decoded.
  await expect
    .poll(() =>
      dock(page)
        .getByTestId('preview-image')
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBe(960);
  await dock(page).getByTestId('preview-image-fit').click();
  await expect(area).toHaveAttribute('data-zoom', 'real');
  await expect(dock(page).getByTestId('preview-zoom')).toContainText('100%');
  const scrolls = await area.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  // Dragging pans the image.
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(area).toHaveAttribute('data-zoom', 'real');
  // Esc leaves the zoom first, then closes the pane.
  await page.keyboard.press('Escape');
  await expect(area).toHaveAttribute('data-zoom', 'fit');
  await page.keyboard.press('Escape');
  await expect(dock(page)).toHaveCount(0);
});

test('a PDF, a note and a page of the chat; the strip keeps them', async ({ page }) => {
  await page.goto(SCENE);
  await page.getByTestId('file-link').filter({ hasText: 'Lisbon quote' }).click();
  const pdf = dock(page).getByTestId('preview-pdf');
  await expect(pdf.getByTestId('preview-pdf-page')).toHaveCount(2);
  await expect(dock(page).getByTestId('preview-pdf-pages')).toHaveText('Page 1 / 2');
  // The page is painted (some dark ink on the white canvas).
  await expect
    .poll(() =>
      pdf
        .locator('canvas')
        .first()
        .evaluate((c: HTMLCanvasElement) => {
          const ctx = c.getContext('2d');
          if (!ctx || c.width === 0) return 0;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          for (let i = 0; i < d.length; i += 16) if (d[i]! < 100) dark++;
          return dark;
        }),
    )
    .toBeGreaterThan(50);

  await page.getByTestId('note-chip').filter({ hasText: 'Tram 28' }).click();
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Tram 28');
  await expect(dock(page).getByTestId('preview-body')).toHaveAttribute('data-renderer', 'note');
  await expect(dock(page).getByTestId('vault-note-body')).toContainText('Alfama');
  // A link inside the note opens that note here too.
  await dock(page).getByTestId('vault-link').first().click();
  await expect(dock(page).getByTestId('preview-title')).toHaveText(/Lisbon/);

  await page.getByTestId('preview-row').click();
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Weekly menu.html');
  const strip = dock(page).getByTestId('preview-strip');
  await expect(strip.getByTestId('preview-chip')).toHaveCount(4);
  // The same item again is not added twice: it is selected.
  await page.getByTestId('file-link').filter({ hasText: 'Lisbon quote' }).click();
  await expect(strip.getByTestId('preview-chip')).toHaveCount(4);
  await expect(strip.locator('[data-active]')).toContainText('Lisbon quote.pdf');
  // ✕ on a chip closes that item; the last ✕ closes the pane.
  for (let n = 3; n >= 0; n--) {
    await strip.getByTestId('preview-chip-close').first().click();
    if (n > 0) await expect(strip.getByTestId('preview-chip')).toHaveCount(n);
  }
  await expect(dock(page)).toHaveCount(0);
});

test('a note made after the first preview resolves in the links of the next one (W-38)', async ({
  page,
}) => {
  await page.goto(SCENE);
  await open(page, { kind: 'note', path: 'Inbox/Quick idea.md' });
  const body = dock(page).getByTestId('vault-note-body');
  await expect(body.getByTestId('vault-link-missing')).toHaveText('Note to write');
  // Someone writes the note the link names; the vault tells the app.
  await page.evaluate(async (src) => {
    const { vaultApi } = (await import(/* @vite-ignore */ src)) as typeof VaultApi;
    await vaultApi.create('Inbox', 'Note to write', 'Written afterwards.');
  }, '/src/components/vault/api.ts');
  await open(page, { kind: 'note', path: 'Resources/Tram 28.md' });
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Tram 28');
  await open(page, { kind: 'note', path: 'Inbox/Quick idea.md' });
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Quick idea');
  await expect(body.getByTestId('vault-link-missing')).toHaveCount(0);
  await expect(body.getByRole('link', { name: 'Note to write' })).toBeVisible();
});

test('text, CSV, JSON, code and other files', async ({ page }) => {
  await page.goto(SCENE);
  await open(page, { kind: 'file', fileId: 'f-spese' });
  const table = dock(page).getByTestId('preview-table');
  await expect(table.locator('th')).toHaveText(['Date', 'Item', 'Category', 'Amount']);
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table).toContainText('Gift for Dione; flowers');
  await dock(page).getByRole('radio', { name: 'Text' }).click();
  await expect(dock(page).getByTestId('preview-code')).toContainText('2026-10-01;Studio rent');

  await open(page, { kind: 'file', fileId: 'f-impostazioni' });
  const json = dock(page).getByTestId('preview-code');
  await expect(json.locator('> span')).toHaveCount(18);
  await expect(json.locator('> span').nth(1)).toHaveText('  "theme": "dark",');
  await expect(json.locator('.t-str').first()).toBeVisible();

  await open(page, { kind: 'file', fileId: 'f-conta-parole' });
  const code = dock(page).getByTestId('preview-code');
  await expect(code.locator('.t-com').first()).toHaveText('# Count the words of a text file');
  await expect(code.locator('.t-key').first()).toHaveText('import');

  await open(page, { kind: 'file', fileId: 'f-foto-viaggio' });
  await expect(dock(page).getByTestId('preview-other')).toContainText('Trip photos.zip');
  await expect(dock(page).getByTestId('preview-other')).toContainText('18 MB');
  const download = dock(page).getByTestId('preview-download');
  await expect(download).toHaveAttribute('download', 'Trip photos.zip');
  // No bridge in a browser: nothing to open with the system.
  await expect(dock(page).getByTestId('preview-open-system')).toHaveCount(0);

  await open(page, { kind: 'file', fileId: 'non-esiste' });
  await expect(dock(page).getByTestId('preview-missing')).toHaveText('This file is gone.');
});

test('a page of a monster stays in its sandbox', async ({ page, consoleErrors }) => {
  // WebRTC sends UDP whatever the CSP says (review of 16/10, D-085): nothing may arrive here.
  const udp = createSocket('udp4');
  const stun: number[] = [];
  udp.on('message', (m) => stun.push(m.length));
  await new Promise<void>((r) => udp.bind(STUN_PROBE_PORT, '127.0.0.1', r));
  await page.goto(SCENE);
  const url = page.url();
  await open(page, { kind: 'file', fileId: 'f-sandbox-prova' });
  const frame = dock(page).getByTestId('preview-html');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  const inner = page.frameLocator('[data-testid="preview-html"]');
  await expect(inner.locator('body')).toHaveAttribute('data-results', /"done":"yes"/, {
    timeout: 10_000,
  });
  const results = JSON.parse(
    (await inner.locator('body').getAttribute('data-results')) ?? '{}',
  ) as Record<string, string>;
  expect(results).toEqual({
    origin: 'null',
    cookie: 'blocked',
    localStorage: 'blocked',
    parent: 'blocked',
    topNavigation: 'blocked',
    popup: 'blocked',
    fetchCore: 'blocked',
    fetchNet: 'blocked',
    imageNet: 'blocked',
    webrtc: 'blocked',
    frameHtml: 'blocked',
    frameElement: 'blocked',
    frameStatic: 'blocked',
    done: 'yes',
  });
  await page.waitForTimeout(1_000);
  udp.close();
  expect(stun).toEqual([]);
  // The window is where it was, nothing new opened.
  expect(page.url()).toBe(url);
  expect(page.context().pages()).toHaveLength(1);
  // The browser says what it blocked: expected here, and only that.
  const blocked =
    /sandbox|Content Security Policy|Refused to connect|allow-popups|allow-top-navigation/;
  expect(consoleErrors.filter((e) => !blocked.test(e))).toEqual([]);
  consoleErrors.length = 0;

  // The menu page runs its own script inside the box.
  await open(page, { kind: 'file', fileId: 'f-pagina-menu' });
  const menu = page.frameLocator('[data-testid="preview-html"]');
  await expect(async () => {
    await menu.getByRole('button', { name: 'Like' }).click();
    await expect(menu.locator('#count')).toHaveText(/^(One vote|\d+ votes)\.$/, { timeout: 500 });
  }).toPass();
  await expect(dock(page).getByTestId('preview-sandbox-note')).toContainText('no network');
});

test('a page made after reading the web never opens by itself, even in the chat on screen', async ({
  page,
}) => {
  await page.goto(SCENE);
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await page.evaluate(() => {
    const mock = (window as unknown as { __monstersMock: MockCore }).__monstersMock;
    mock.append({
      agent: 'titan',
      runId: 'run_seed_preview',
      type: 'preview',
      data: {
        item: { kind: 'file', fileId: 'f-pagina-inerte' },
        name: 'Prices found.html',
        fileKind: 'html',
        inert: true,
      },
    });
  });
  await expect(
    page.getByTestId('preview-row').filter({ hasText: 'Prices found.html' }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  await expect(dock(page)).toHaveCount(0);
});

test('a page made after reading the web: no scripts until the user turns them on', async ({
  page,
  consoleErrors,
}) => {
  await page.goto(SCENE);
  await open(page, { kind: 'file', fileId: 'f-pagina-inerte' });
  const inner = page.frameLocator('[data-testid="preview-html"]');
  await expect(inner.getByRole('heading', { name: 'Prices found' })).toBeVisible();
  await expect(inner.locator('#state')).toHaveText('Scripts off.');
  const note = dock(page).getByTestId('preview-inert');
  await expect(note).toContainText(
    'Page with scripts turned off: it was made after reading external content.',
  );
  await dock(page).getByTestId('preview-allow-scripts').click();
  // A second click, after the warning.
  await expect(note).toContainText('If you don’t trust');
  await expect(inner.locator('#state')).toHaveText('Scripts off.');
  await dock(page).getByTestId('preview-allow-scripts').click();
  await expect(note).toHaveCount(0);
  await expect(page.frameLocator('[data-testid="preview-html"]').locator('#state')).toHaveText(
    'Scripts on.',
  );
  // While the scripts were off the browser said so (also for the probes of Playwright): only that.
  expect(consoleErrors.filter((e) => !/Blocked script execution/.test(e))).toEqual([]);
  consoleErrors.length = 0;
});

test('a remote image loads only when asked, without a referrer', async ({ page }) => {
  const asked: { referer: string | undefined }[] = [];
  await page.route('https://upload.wikimedia.org/**', async (route) => {
    asked.push({ referer: route.request().headers()['referer'] });
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#4a8"/></svg>',
    });
  });
  await page.goto(SCENE);
  const card = page.getByTestId('remote-image-card');
  await expect(card).toContainText('The view from Graça');
  await expect(card).toContainText('upload.wikimedia.org');
  // The whole address, not only the site (D-085).
  await expect(card.getByTestId('remote-image-url')).toHaveText(
    'https://upload.wikimedia.org/wikipedia/commons/a/a3/Lisboa_-_Miradouro_da_Gra%C3%A7a.jpg',
  );
  await page.waitForTimeout(500);
  expect(asked).toHaveLength(0);
  await card.getByTestId('remote-image-show').click();
  await expect(page.getByTestId('remote-image').locator('img')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]!.referer).toBeUndefined();
});

test('the tabs: Dietro le quinte and Consumi in the pane, following the chat', async ({ page }) => {
  // CONTESTO, the meter on the monitor, is a technical detail.
  await showTechnicalDetails(page);
  await page.goto(SCENE);
  await page.getByTestId('behind-the-scenes').click();
  await expect(dock(page).getByTestId('dock-tab-terminal')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const term = dock(page).getByTestId('agent-terminal');
  await expect(term.getByRole('heading', { name: 'Behind the scenes of Titan' })).toBeVisible();
  // The screenshot of the browser opens in Anteprima.
  await term.getByTestId('term-file').click();
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Screenshot carris.pt.png');
  await expect(dock(page).getByTestId('preview-line')).toContainText(/by Rhea/i);

  await dock(page).getByTestId('dock-tab-usage').click();
  await expect(
    dock(page).getByTestId('usage-sheet').getByRole('heading', { name: 'Usage of Titan' }),
  ).toBeVisible();
  // Arrows move between the tabs.
  await dock(page).getByTestId('dock-tab-usage').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dock(page).getByTestId('dock-tab-terminal')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Another chat: the pane stays and shows that monster.
  await page.getByRole('link', { name: /^Rhea,/ }).click();
  await expect(term.getByRole('heading', { name: 'Behind the scenes of Rhea' })).toBeVisible();
  // CONTESTO selects Consumi, for Rhea.
  await page.getByTestId('chat-monitor').getByTestId('context-key').click();
  await expect(dock(page).getByRole('heading', { name: 'Usage of Rhea' })).toBeVisible();
  await expect(page.getByTestId('chat-monitor').getByTestId('context-key')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByTestId('dock-close').click();
  await expect(dock(page)).toHaveCount(0);
});

test('the width: dragged, by keys, remembered; the chat shrinks beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(SCENE);
  await page.getByTestId('chat-image').click();
  await expect(dock(page)).toBeVisible();
  // The pane slides in by frames (160 ms): measure where it lands, not where it passes.
  await expect
    .poll(() =>
      page
        .getByTestId('dock-frame')
        .evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length),
    )
    .toBe(0);
  const width = async () => Math.round((await dock(page).boundingBox())!.width);
  expect(await width()).toBe(520);
  const content = page.locator('[data-content-card]');
  const before = (await content.boundingBox())!;
  // Side by side: the chat ends where the pane begins, nothing over it.
  expect(before.x + before.width).toBeLessThanOrEqual((await dock(page).boundingBox())!.x);

  const grip = page.getByTestId('dock-grip');
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 100, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(620);
  expect((await content.boundingBox())!.width).toBeLessThan(before.width - 90);
  // Never past ~60% of the window or the chat's minimum, never under 380.
  await page.mouse.move(g.x - 100 + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x - 900, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBeLessThanOrEqual(Math.round(1440 * 0.6));
  await grip.focus();
  await page.keyboard.press('End');
  expect(await width()).toBe(380);
  await page.keyboard.press('ArrowLeft');
  expect(await width()).toBe(396);

  // Kept by this browser.
  await page.reload();
  await page.getByTestId('chat-image').click();
  await expect(dock(page)).toBeVisible();
  expect(await width()).toBe(396);
  // Double click: back to the default.
  await page.getByTestId('dock-grip').dblclick();
  expect(await width()).toBe(520);
});

test('⌘J / Ctrl J and the palette toggle the pane; the focus goes there when asked', async ({
  page,
}) => {
  await page.goto(SCENE);
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toBeFocused();
  await expect(dock(page).getByTestId('preview-empty')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(dock(page)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search a monster, a note, a command…').fill('pane');
  await page.getByRole('option', { name: /Right-hand pane/ }).click();
  await expect(dock(page)).toBeVisible();
});

test('a monster showing something: open beside its chat, a chip elsewhere', async ({ page }) => {
  await page.goto(SCENE);
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  const show = (agent: string, fileId: string, name: string) =>
    page.evaluate(
      ([a, f, n]) => {
        const mock = (window as unknown as { __monstersMock: MockCore }).__monstersMock;
        mock.append({
          agent: a,
          runId: `run_show_${f}`,
          type: 'run',
          data: { status: 'started', goal: 'Show' },
        });
        mock.append({
          agent: a,
          runId: `run_show_${f}`,
          type: 'preview',
          data: { item: { kind: 'file', fileId: f }, name: n, fileKind: 'pdf' },
        });
      },
      [agent, fileId, name] as const,
    );
  const input = page.getByTestId('composer-input');
  await input.focus();
  // Titan's chat is on screen: it opens, and the composer keeps the focus.
  await show('titan', 'f-preventivo', 'Lisbon quote.pdf');
  await expect(dock(page).getByTestId('preview-title')).toHaveText('Lisbon quote.pdf');
  await expect(input).toBeFocused();
  await page.getByTestId('dock-close').click();
  // Dione is not on screen: only the chip in her chat.
  await show('dione', 'f-spese', 'October expenses.csv');
  await page.waitForTimeout(400);
  await expect(dock(page)).toHaveCount(0);
  await page.getByRole('link', { name: /^Dione,/ }).click();
  const row = page.getByTestId('preview-row').filter({ hasText: 'October expenses.csv' });
  await expect(row).toContainText('Dione shows you');
  await row.click();
  await expect(dock(page).getByTestId('preview-title')).toHaveText('October expenses.csv');
  await expect(row).toContainText('In the preview');
});

test('"Da rivedere" makes room for the pane below 1600 px, and stays beside it above', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(SCENE);
  await page.getByTestId('review-toggle').click();
  const columnShown = () => page.locator('[data-testid="chats"] > :nth-child(2)');
  await expect(columnShown()).toBeVisible();
  await page.getByTestId('chat-image').click();
  await expect(dock(page)).toBeVisible();
  await expect(columnShown()).toHaveCount(0);
  await expect(page.getByTestId('review-toggle')).toHaveAttribute('aria-pressed', 'false');
  // The key brings the column back in the pane's place.
  await page.getByTestId('review-toggle').click();
  await expect(dock(page)).toHaveCount(0);
  await expect(columnShown()).toBeVisible();

  await page.setViewportSize({ width: 1700, height: 900 });
  await page.getByTestId('chat-image').click();
  await expect(dock(page)).toBeVisible();
  await expect(columnShown()).toBeVisible();
});

test('Ferma is never covered by the pane, as a sheet on a narrower window', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto(SCENE);
  await page.getByTestId('chat-image').click();
  await expect(page.getByTestId('dock-frame')).toHaveAttribute('data-mode', 'sheet');
  const kill = page.getByTestId('kill');
  await expect(kill).toBeInViewport({ ratio: 1 });
  const onTop = await kill.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(onTop).toBe(true);
  const top = (await dock(page).boundingBox())!.y;
  expect(top).toBeGreaterThanOrEqual(52);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });

  test('full screen under the rail, Indietro closes it, Ferma stays', async ({ page }) => {
    await page.goto(SCENE);
    await page.getByTestId('preview-row').click();
    const frame = page.getByTestId('dock-frame');
    await expect(frame).toHaveAttribute('data-mode', 'phone');
    const box = (await dock(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(box.y).toBeGreaterThanOrEqual(52);
    await expect(page.getByTestId('kill')).toBeInViewport({ ratio: 1 });
    // The three tabs fit, nothing wider than the screen.
    const overflow = await dock(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const tab of ['preview', 'terminal', 'usage'])
      await expect(dock(page).getByTestId(`dock-tab-${tab}`)).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('dock-grip')).toHaveCount(0);
    await page.getByTestId('toolbar-back').click();
    await expect(dock(page)).toHaveCount(0);
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    // A monster showing something does not cover the phone: the chip is enough.
    await page.evaluate(() => {
      const mock = (window as unknown as { __monstersMock: MockCore }).__monstersMock;
      mock.append({
        agent: 'titan',
        runId: 'run_seed_preview',
        type: 'preview',
        data: {
          item: { kind: 'file', fileId: 'f-spese' },
          name: 'October expenses.csv',
          fileKind: 'sheet',
        },
      });
    });
    await expect(
      page.getByTestId('preview-row').filter({ hasText: 'October expenses.csv' }),
    ).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
  });

  test('the browser’s Back closes the pane, not the app; the hash stays (D-086)', async ({
    page,
  }) => {
    await page.goto(SCENE);
    const hash = await page.evaluate(() => window.location.hash);
    const depth = await page.evaluate(() => window.history.length);
    await page.getByTestId('preview-row').click();
    await expect(dock(page)).toBeVisible();
    await page.goBack();
    await expect(dock(page)).toHaveCount(0);
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toBe(hash);

    // Closed with Indietro of the rail: the entry goes too, one Back would leave as before.
    await page.getByTestId('preview-row').click();
    await expect(dock(page)).toBeVisible();
    await page.getByTestId('toolbar-back').click();
    await expect(dock(page)).toHaveCount(0);
    // No entry piles up: the one of the pane replaced the one Back left ahead.
    expect(await page.evaluate(() => window.history.length)).toBe(depth + 1);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window.history.state as Record<string, unknown> | null)?.['monstersDock'],
        ),
      )
      .toBeUndefined();
    expect(await page.evaluate(() => window.location.hash)).toBe(hash);
  });
});

test('"Riduci movimento": the pane comes and goes without frames', async ({ page }) => {
  await page.goto(SCENE);
  await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduced'));
  await page.getByTestId('chat-image').click();
  const frame = page.getByTestId('dock-frame');
  expect(await frame.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  // Gone at once, no way out to play.
  expect(await page.getByTestId('dock-frame').count()).toBe(0);
  await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'full'));
  await page.getByTestId('chat-image').click();
  expect(await frame.evaluate((el) => getComputedStyle(el).animationName)).toBe('slide-in');
  const timing = await frame.evaluate((el) => getComputedStyle(el).animationTimingFunction);
  expect(timing).toMatch(/steps\(4/);
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

      test('the pane by kind', async ({ page, consoleErrors }) => {
        const shot = async (what: string) => {
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${SHOTS}/anteprima-${what}-${theme}-${size.name}.png` });
        };
        await page.goto(SCENE);
        // The demo's toast (a tool in pause) would sit over the pane in every shot.
        await page.addStyleTag({ content: '[aria-live="polite"].fixed { display: none }' });
        await page.getByTestId('chat-image').click();
        await shot('immagine');
        await open(page, { kind: 'file', fileId: 'f-preventivo' });
        await expect(dock(page).getByTestId('preview-pdf-page').first()).toBeVisible();
        await shot('pdf');
        await open(page, { kind: 'note', path: 'Resources/Tram 28.md' });
        await expect(dock(page).getByTestId('vault-note-body')).toBeVisible();
        await shot('nota');
        await open(page, { kind: 'file', fileId: 'f-pagina-menu' });
        await expect(
          page.frameLocator('[data-testid="preview-html"]').getByText('Weekly menu'),
        ).toBeVisible();
        await shot('pagina');
        await open(page, { kind: 'file', fileId: 'f-conta-parole' });
        await shot('codice');
        await dock(page).getByTestId('dock-tab-terminal').click();
        await shot('dietro-le-quinte');
        await dock(page).getByTestId('dock-tab-usage').click();
        await expect(dock(page).getByTestId('usage-body')).toBeVisible();
        await shot('consumi');
        consoleErrors.length = 0;
      });
    });
  }
}
