import { expect, test } from './fixtures.ts';

/*
 * Settings → Collegamenti → App e servizi (D-063), on the mock core: the gallery
 * of services, a sign-in in the browser (the mock comes back by itself), a
 * token pasted once, a service that is not connectable yet, the phone width.
 * `MCP_SHOTS=<dir>` also writes screenshots at 1440 and 390 px, light and dark.
 */

const URL = '/?mock=demo#/impostazioni?sezione=collegamenti';
const SHOTS = process.env['MCP_SHOTS'];

test('gallery: services as keys, connected first, all of them on request', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await expect(gallery.getByRole('heading', { name: 'App e servizi' })).toBeVisible();
  const keys = gallery.getByRole('listitem');
  await expect(keys).toHaveCount(8);
  // The demo's GitHub is connected: first.
  await expect(keys.first()).toContainText('GitHub');
  await expect(keys.first()).toContainText('Collegato');
  await gallery.getByRole('button', { name: /Mostra tutti/ }).click();
  expect(await keys.count()).toBeGreaterThanOrEqual(20);
  // Not connectable yet: last, with the reason in the panel and no "Collega".
  await expect(keys.last()).toContainText('Presto');
  await gallery.getByTestId('gallery-slack').click();
  const panel = page.getByTestId('gallery-panel-slack');
  await expect(panel.getByTestId('gallery-soon')).toContainText('app approvate');
  await expect(panel.getByRole('button', { name: 'Collega' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(gallery.getByTestId('gallery-slack')).toBeFocused();
});

test('gallery: sign in to Notion in the browser, test, disconnect', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  await expect(panel).toContainText('Si apre la pagina di Notion');
  // Who uses it: everyone by default.
  for (const name of ['Titan', 'Rhea', 'Dione']) {
    await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-waiting')).toContainText('Completa l’accesso');
  // The mock "browser" comes back: connected, and tried at once.
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await expect(panel.getByTestId('mcp-tools')).toContainText('Funziona');
  await page.keyboard.press('Escape');
  await expect(gallery.getByTestId('gallery-notion')).toContainText('Collegato');
  // Not in the list of other programs: it lives in the gallery.
  await expect(page.getByTestId('mcp-server-notion')).toHaveCount(0);

  await gallery.getByTestId('gallery-notion').click();
  await panel.getByRole('button', { name: 'Scollega' }).click();
  await panel.getByRole('button', { name: 'Sì, scollega' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Da collegare');

  await page.goto('/?mock=demo#/log');
  await expect(
    page.getByText('Hai fatto l’accesso per il programma “notion”').first(),
  ).toBeVisible();
  await expect(page.getByText('Hai tolto il programma “notion”').first()).toBeVisible();
});

test('gallery: Anteiku asks the company first, then the sign-in (D-075)', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  // Saturday's products come first among the services to connect.
  const keys = gallery.getByRole('listitem');
  await expect(keys.nth(1)).toContainText('Anteiku');
  await expect(keys.nth(2)).toContainText('WitDesk');
  await gallery.getByTestId('gallery-anteiku').click();
  const panel = page.getByTestId('gallery-panel-anteiku');
  await expect(panel.getByLabel('La tua azienda')).toBeVisible();
  await expect(panel).toContainText('.anteiku.it');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await expect(panel.getByRole('alert')).toContainText('Scrivi il nome della tua azienda');
  await panel.getByTestId('gallery-tenant').fill('sat urday');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await expect(panel.getByRole('alert')).toContainText('solo la parte prima di .anteiku.it');
  // The address copied from the browser is fine too.
  await panel.getByTestId('gallery-tenant').fill('https://Acme.anteiku.it/oggi');
  await expect(panel.getByTestId('gallery-tenant-url')).toHaveText('https://acme.anteiku.it/mcp');
  await panel.getByTestId('gallery-tenant').fill('acme');
  await expect(panel.getByTestId('gallery-tenant-url')).toHaveText('https://acme.anteiku.it/mcp');
  // The token way links to the company's own page.
  await panel.getByRole('radio', { name: 'Token personale' }).click();
  await expect(panel.getByRole('link', { name: 'Crea il token' })).toHaveAttribute(
    'href',
    'https://acme.anteiku.it/sistema/connessioni',
  );
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/anteiku-token.png`, animations: 'disabled' });
  }
  await panel.getByRole('radio', { name: 'Accedi ad Anteiku' }).click();
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/anteiku-azienda.png`, animations: 'disabled' });
  }
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await panel.getByRole('button', { name: 'Dettagli' }).click();
  await expect(panel).toContainText('https://acme.anteiku.it/mcp');
  await page.keyboard.press('Escape');
  await expect(gallery.getByTestId('gallery-anteiku')).toContainText('Collegato');

  // WitDesk: the admin must turn the connectors on first.
  await gallery.getByTestId('gallery-witdesk').click();
  const witdesk = page.getByTestId('gallery-panel-witdesk');
  await expect(witdesk).toContainText('Banco → Impostazioni → Collegamenti');
  await expect(witdesk.getByRole('button', { name: 'Collega' })).toBeVisible();
  if (SHOTS) {
    await page.keyboard.press('Escape');
    await gallery.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/galleria-saturday.png`, animations: 'disabled' });
  }
});

test('gallery: Stripe with a key pasted once, used only by Dione', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  // Past the first eight keys since Anteiku and WitDesk lead (D-075).
  await gallery.getByRole('button', { name: /Mostra tutti/ }).click();
  await gallery.getByTestId('gallery-stripe').click();
  const panel = page.getByTestId('gallery-panel-stripe');
  // Two ways: the sign-in first, the key on request.
  await panel.getByRole('radio', { name: 'Chiave per agenti' }).click();
  const create = panel.getByRole('link', { name: 'Crea il token' });
  await expect(create).toHaveAttribute('href', 'https://dashboard.stripe.com/apikeys');
  await expect(create).toHaveAttribute('target', '_blank');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await expect(panel.getByRole('alert')).toContainText('Incolla qui il codice che hai creato');

  for (const name of ['Titan', 'Rhea', 'Enceladus', 'Mimas']) {
    await panel.getByRole('button', { name, exact: true }).click();
  }
  await panel.getByLabel('Chiave per agenti').fill('rk_live_SEGRETO_1234');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await expect(page.getByText('Stripe collegato.')).toBeVisible();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await expect(panel.getByTestId('mcp-tools')).toContainText('Funziona');
  await expect(panel.getByRole('button', { name: 'Dione', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('button', { name: 'Rhea', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await panel.getByRole('button', { name: 'Dettagli' }).click();
  await expect(panel).toContainText('Authorization (valore nascosto)');
  await expect(page.locator('body')).not.toContainText('SEGRETO');
});

test('gallery: Blender says what to install and that it runs code (D-092)', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByRole('button', { name: /Mostra tutti/ }).click();
  await gallery.getByTestId('gallery-blender').click();
  const panel = page.getByTestId('gallery-panel-blender');
  await expect(panel.getByTestId('gallery-launcher')).toContainText('uvx, che fa parte di uv');
  await expect(panel.getByRole('link', { name: 'installa uv' })).toHaveAttribute(
    'href',
    'https://docs.astral.sh/uv/getting-started/installation/',
  );
  await expect(panel).toContainText('Blender 5.1+ aperto con l’add-on MCP');
  await expect(panel).toContainText('passa dal freno');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await panel.getByRole('button', { name: 'Dettagli' }).click();
  // The official server, pinned to a commit: never the community package of PyPI.
  await expect(panel).toContainText(
    'uvx --exclude-newer 2026-10-18 --from git+https://projects.blender.org/lab/blender_mcp.git@2cea8d566dde07fbac28a61d698909d69724e853#subdirectory=mcp blender-mcp',
  );
});

test('gallery: on a phone, one column and the panel fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await expect(gallery.getByTestId('gallery-github')).toBeVisible();
  const [a, b] = await Promise.all([
    gallery.getByTestId('gallery-github').boundingBox(),
    gallery.getByTestId('gallery-notion').boundingBox(),
  ]);
  expect(a!.x).toBe(b!.x);
  expect(b!.y).toBeGreaterThan(a!.y);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await gallery.getByTestId('gallery-linear').click();
  const panel = page.getByTestId('gallery-panel-linear');
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(panel.getByRole('button', { name: 'Collega' })).toBeVisible();
});

test('gallery: with the Claude plan, Figma and Slack connect through Claude (D-069)', async ({
  page,
}) => {
  // The Claude plan first (Impostazioni → Modelli), as the user does.
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Collega un altro modello' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Collega' }).click();
  const card = page.getByTestId('models-connected').getByTestId('subscription-claude');
  await card.getByRole('button', { name: 'Ricontrolla' }).click();
  await expect(card).toContainText('Pronto');

  await page.evaluate(() => (location.hash = '#/impostazioni?sezione=collegamenti'));
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByRole('button', { name: /Mostra tutti/ }).click();
  const figmaKey = gallery.getByTestId('gallery-figma');
  await expect(figmaKey).toContainText('Collega tramite Claude');
  await expect(gallery.getByTestId('gallery-claude-design')).toContainText(
    'Collega tramite Claude',
  );
  await figmaKey.click();
  const panel = page.getByTestId('gallery-panel-figma');
  const body = panel.getByTestId('claude-connect');
  await expect(body).toContainText('lo usano i mostri che lavorano con Claude');
  await expect(body.getByRole('link', { name: 'Apri i connettori di Claude' })).toHaveAttribute(
    'href',
    'https://claude.ai/settings/connectors',
  );
  await body.getByRole('button', { name: 'Collega' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await expect(body.getByRole('button', { name: 'Ricontrolla' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(figmaKey).toContainText('Collegato');

  // Slack is on the account but asks to sign in again: the two ways, in words.
  await gallery.getByTestId('gallery-slack').click();
  const slack = page.getByTestId('gallery-panel-slack');
  await slack.getByTestId('claude-connect').getByRole('button', { name: 'Collega' }).click();
  await expect(slack.getByTestId('claude-todo')).toContainText('accedere di nuovo');
  await expect(slack.getByTestId('claude-todo')).toContainText(
    'claude mcp login "claude.ai Slack"',
  );
  const shots = process.env['MCP_SHOTS'];
  if (shots) await slack.screenshot({ path: `${shots}/galleria-tramite-claude.png` });
  await slack.getByRole('button', { name: 'Scollega' }).click();
  await slack.getByRole('button', { name: 'Sì, scollega' }).click();
  await expect(slack.getByTestId('gallery-state')).toHaveText('Collega tramite Claude');
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test.describe(`gallery screenshot ${theme} ${width}`, () => {
      test.skip(!SHOTS, 'set MCP_SHOTS=<dir> to write the screenshots');
      test.use({
        colorScheme: theme,
        reducedMotion: 'reduce',
        viewport: { width, height: width === 390 ? 844 : 900 },
      });

      test('gallery and a panel', async ({ page }) => {
        await page.goto(URL);
        const gallery = page.getByTestId('mcp-gallery');
        await gallery.getByRole('button', { name: /Mostra tutti/ }).click();
        await gallery.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(300);
        const name = `${SHOTS}/galleria-${theme}-${width}`;
        await page.screenshot({ path: `${name}.png`, animations: 'disabled' });
        // The end of the list: the services that are not connectable yet.
        await gallery
          .getByRole('listitem')
          .last()
          .evaluate((el) => el.scrollIntoView({ block: 'end' }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${name}-fine.png`, animations: 'disabled' });
        await gallery.getByTestId('gallery-linear').click();
        const panel = page.getByTestId('gallery-panel-linear');
        await panel.getByRole('radio', { name: 'Chiave API' }).click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${name}-pannello.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
        await gallery.getByTestId('gallery-github').click();
        await page
          .getByTestId('gallery-panel-github')
          .getByRole('button', { name: 'Prova' })
          .click();
        await expect(page.getByTestId('mcp-tools')).toBeVisible();
        await page.screenshot({ path: `${name}-collegato.png`, animations: 'disabled' });
      });
    });
  }
}
