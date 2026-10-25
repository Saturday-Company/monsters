import { expect, expectNoSideScroll, holdMock, releaseMock, test } from './fixtures.ts';

/*
 * Settings → Apps and Telegram → Apps (D-063), on the mock core: the gallery
 * of apps (a search and the first six, wave C), a sign-in in the browser (the mock comes
 * back by itself), a token pasted once, an app that is not connectable yet, the phone width.
 * `MCP_SHOTS=<dir>` also writes screenshots at 1440 and 390 px, light and dark.
 */

const URL = '/?mock=demo#/impostazioni?sezione=collegamenti';
const SHOTS = process.env['MCP_SHOTS'];

test('gallery: the first six as keys, connected first, all of them on request', async ({
  page,
}) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await expect(gallery.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible();
  // The keys of the grid; the browser and the Advanced row are rows of the same group below it.
  const keys = gallery.getByRole('list', { name: 'Apps' }).getByRole('listitem');
  await expect(keys).toHaveCount(6);
  // The demo's GitHub is connected: first. By common use after it: Notion, Linear.
  await expect(keys.first()).toContainText('GitHub');
  await expect(keys.first()).toContainText('Connected');
  await expect(keys.nth(1)).toContainText('Notion');
  await expect(keys.nth(2)).toContainText('Linear');
  // What is still to connect says one word, "Connect"; what is connected, "Connected".
  await expect(keys.nth(1).getByTestId('gallery-state')).toHaveText('Connect');
  // Saturday's own apps are in the list, not among the first six.
  await expect(gallery.getByTestId('gallery-anteiku')).toHaveCount(0);
  await gallery.getByRole('button', { name: /Show all/ }).click();
  await expect(gallery.getByTestId('gallery-anteiku')).toBeVisible();
  await expect(gallery.getByTestId('gallery-witdesk')).toBeVisible();
  expect(await keys.count()).toBeGreaterThanOrEqual(20);
  // Not connectable yet: last, with the reason in the panel and no "Collega".
  await expect(keys.last()).toContainText('Soon');
  await gallery.getByTestId('gallery-slack').click();
  const panel = page.getByTestId('gallery-panel-slack');
  await expect(panel.getByTestId('gallery-soon')).toContainText('apps approved one by one');
  await expect(panel.getByRole('button', { name: 'Connect' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(gallery.getByTestId('gallery-slack')).toBeFocused();
});

test('gallery: sign in to Notion in the browser, test, disconnect', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  await expect(panel).toContainText('Notion’s page opens');
  // Who uses it: everyone by default.
  for (const name of ['Titan', 'Rhea', 'Dione']) {
    await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-waiting')).toContainText('Finish signing in');
  // The mock "browser" comes back: connected, and tried at once.
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await expect(panel.getByTestId('mcp-tools')).toContainText('Works');
  await page.keyboard.press('Escape');
  await expect(gallery.getByTestId('gallery-notion')).toContainText('Connected');
  // Not in the list of other programs: it lives in the gallery.
  await expect(page.getByTestId('mcp-server-notion')).toHaveCount(0);

  await gallery.getByTestId('gallery-notion').click();
  await panel.getByRole('button', { name: 'Disconnect' }).click();
  await panel.getByRole('button', { name: 'Yes, disconnect' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Not connected');

  await page.goto('/?mock=demo#/log');
  await expect(page.getByText('You signed in for the app “notion”').first()).toBeVisible();
  await expect(page.getByText('You removed the app “notion”').first()).toBeVisible();
});

test('gallery: a search finds any app, the not-yet ones too, and says when nothing matches', async ({
  page,
}) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  const search = gallery.getByRole('searchbox', { name: 'Search apps' });
  const keys = gallery.getByRole('list', { name: 'Apps' }).getByRole('listitem');
  // By name, without accents or case; the "Show all" button gives way to the results.
  await search.fill('SLACK');
  await expect(keys).toHaveCount(1);
  await expect(keys.first()).toContainText('Soon');
  await expect(gallery.getByRole('button', { name: /Show all/ })).toHaveCount(0);
  // By what it does or its category, with several words.
  await search.fill('issues github');
  await expect(keys).toHaveCount(1);
  await expect(keys.first()).toContainText('GitHub');
  await search.fill('payments');
  await expect(keys.first()).toContainText('Stripe');
  // Nothing: a line that says where an unlisted app goes.
  await search.fill('zzzz');
  await expect(keys).toHaveCount(0);
  await expect(gallery.getByTestId('gallery-no-match')).toContainText('No app matches “zzzz”');
  await expect(gallery.getByTestId('gallery-no-match')).toContainText(
    'Advanced: add an app by address',
  );
  // Emptied, the first six are back.
  await search.fill('');
  await expect(keys).toHaveCount(6);
  await expect(gallery.getByRole('button', { name: /Show all/ })).toBeVisible();
});

test('gallery: the jargon waits for Advanced (U2-7, U2-24)', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await expect(gallery).not.toContainText('MCP server');
  await expect(gallery).not.toContainText('OAuth');
  // The custom form is one closed Advanced row; "MCP" appears only there.
  const advanced = gallery.getByTestId('mcp-add-advanced');
  await expect(advanced).toHaveAttribute('data-advanced', 'true');
  await expect(page.getByTestId('mcp-add-form')).toHaveCount(0);
  await advanced.getByRole('button', { name: /Advanced: add an app by address/ }).click();
  await expect(page.getByTestId('mcp-add-form')).toBeVisible();
  // A connected app's panel says "Signed in. Your login stays on this computer.", without OAuth.
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await panel.getByRole('button', { name: 'Details' }).click();
  await expect(panel.getByTestId('mcp-details')).toContainText(
    'Signed in. Your login stays on this computer.',
  );
  await expect(panel).not.toContainText('OAuth');
});

test('gallery: Anteiku asks the company first, then the sign-in (D-075)', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  // Saturday's products are not among the first six: the search finds them (D-081, wave C).
  await expect(gallery.getByTestId('gallery-anteiku')).toHaveCount(0);
  await gallery.getByTestId('gallery-search').fill('anteiku');
  await expect(gallery.getByRole('list', { name: 'Apps' }).getByRole('listitem')).toHaveCount(1);
  await gallery.getByTestId('gallery-anteiku').click();
  const panel = page.getByTestId('gallery-panel-anteiku');
  await expect(panel.getByLabel('Your company')).toBeVisible();
  await expect(panel).toContainText('.anteiku.it');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByRole('alert')).toContainText('Type your company’s name');
  await panel.getByTestId('gallery-tenant').fill('sat urday');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByRole('alert')).toContainText('only the part before .anteiku.it');
  // The address copied from the browser is fine too.
  await panel.getByTestId('gallery-tenant').fill('https://Acme.anteiku.it/oggi');
  await expect(panel.getByTestId('gallery-tenant-url')).toHaveText('https://acme.anteiku.it/mcp');
  await panel.getByTestId('gallery-tenant').fill('acme');
  await expect(panel.getByTestId('gallery-tenant-url')).toHaveText('https://acme.anteiku.it/mcp');
  // The token way links to the company's own page.
  await panel.getByRole('radio', { name: 'Personal token' }).click();
  await expect(panel.getByRole('link', { name: 'Create the token' })).toHaveAttribute(
    'href',
    'https://acme.anteiku.it/sistema/connessioni',
  );
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/anteiku-token.png`, animations: 'disabled' });
  }
  await panel.getByRole('radio', { name: 'Sign in to Anteiku' }).click();
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/anteiku-azienda.png`, animations: 'disabled' });
  }
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await panel.getByRole('button', { name: 'Details' }).click();
  await expect(panel).toContainText('https://acme.anteiku.it/mcp');
  await page.keyboard.press('Escape');
  await expect(gallery.getByTestId('gallery-anteiku')).toContainText('Connected');

  // WitDesk: the admin must turn the connectors on first.
  await gallery.getByTestId('gallery-search').fill('witdesk');
  await gallery.getByTestId('gallery-witdesk').click();
  const witdesk = page.getByTestId('gallery-panel-witdesk');
  await expect(witdesk).toContainText('Banco → Impostazioni → Collegamenti');
  await expect(witdesk.getByRole('button', { name: 'Connect' })).toBeVisible();
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
  // Past the first six keys.
  await gallery.getByRole('button', { name: /Show all/ }).click();
  await gallery.getByTestId('gallery-stripe').click();
  const panel = page.getByTestId('gallery-panel-stripe');
  // Two ways: the sign-in first, the key on request.
  await panel.getByRole('radio', { name: 'Key for agents' }).click();
  const create = panel.getByRole('link', { name: 'Create the token' });
  await expect(create).toHaveAttribute('href', 'https://dashboard.stripe.com/apikeys');
  await expect(create).toHaveAttribute('target', '_blank');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByRole('alert')).toContainText('Paste the token you created');

  for (const name of ['Titan', 'Rhea', 'Enceladus', 'Mimas']) {
    await panel.getByRole('button', { name, exact: true }).click();
  }
  await panel.getByLabel('Key for agents').fill('rk_live_SEGRETO_1234');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Stripe connected.')).toBeVisible();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await expect(panel.getByTestId('mcp-tools')).toContainText('Works');
  await expect(panel.getByRole('button', { name: 'Dione', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('button', { name: 'Rhea', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await panel.getByRole('button', { name: 'Details' }).click();
  await expect(panel).toContainText('Authorization (value hidden)');
  await expect(page.locator('body')).not.toContainText('SEGRETO');
});

test('gallery: Blender says what to install and that it runs code (D-092)', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByRole('button', { name: /Show all/ }).click();
  await gallery.getByTestId('gallery-blender').click();
  const panel = page.getByTestId('gallery-panel-blender');
  await expect(panel.getByTestId('gallery-launcher')).toContainText('uvx, which is part of uv');
  await expect(panel.getByRole('link', { name: 'install uv' })).toHaveAttribute(
    'href',
    'https://docs.astral.sh/uv/getting-started/installation/',
  );
  await expect(panel).toContainText('Blender 5.1+ open with the MCP add-on');
  await expect(panel).toContainText('goes through the brake');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await panel.getByRole('button', { name: 'Details' }).click();
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
  await expectNoSideScroll(page);
  await gallery.getByTestId('gallery-linear').click();
  const panel = page.getByTestId('gallery-panel-linear');
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(panel.getByRole('button', { name: 'Connect' })).toBeVisible();
});

test('gallery: with the Claude plan, Figma and Slack connect through Claude (D-069)', async ({
  page,
}) => {
  // The Claude plan first (Impostazioni → Modelli), as the user does.
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Connect another model' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
  const card = page.getByTestId('models-connected').getByTestId('subscription-claude');
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card).toContainText('Ready');

  await page.evaluate(() => (location.hash = '#/impostazioni?sezione=collegamenti'));
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByRole('button', { name: /Show all/ }).click();
  const figmaKey = gallery.getByTestId('gallery-figma');
  // On the card it is one word, whatever the way; the panel says "through Claude".
  await expect(figmaKey.getByTestId('gallery-state')).toHaveText('Connect');
  await expect(figmaKey.getByTestId('gallery-state')).toHaveAttribute('data-state', 'claude');
  await expect(
    gallery.getByTestId('gallery-claude-design').getByTestId('gallery-state'),
  ).toHaveText('Connect');
  await figmaKey.click();
  await expect(page.getByTestId('gallery-panel-figma').getByTestId('gallery-state')).toHaveText(
    'Connect through Claude',
  );
  const panel = page.getByTestId('gallery-panel-figma');
  const body = panel.getByTestId('claude-connect');
  await expect(body).toContainText('the monsters that work with Claude use it');
  await expect(body.getByRole('link', { name: 'Open Claude’s connectors' })).toHaveAttribute(
    'href',
    'https://claude.ai/settings/connectors',
  );
  await body.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await expect(body.getByRole('button', { name: 'Check again' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(figmaKey).toContainText('Connected');

  // Slack is on the account but asks to sign in again: the two ways, in words.
  await gallery.getByTestId('gallery-slack').click();
  const slack = page.getByTestId('gallery-panel-slack');
  await slack.getByTestId('claude-connect').getByRole('button', { name: 'Connect' }).click();
  await expect(slack.getByTestId('claude-todo')).toContainText('sign in again');
  await expect(slack.getByTestId('claude-todo')).toContainText(
    'claude mcp login "claude.ai Slack"',
  );
  const shots = process.env['MCP_SHOTS'];
  if (shots) await slack.screenshot({ path: `${shots}/galleria-tramite-claude.png` });
  await slack.getByRole('button', { name: 'Disconnect' }).click();
  await slack.getByRole('button', { name: 'Yes, disconnect' }).click();
  await expect(slack.getByTestId('gallery-state')).toHaveText('Connect through Claude');
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
        await gallery.getByRole('button', { name: /Show all/ }).click();
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
        await panel.getByRole('radio', { name: 'API key' }).click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${name}-pannello.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
        await gallery.getByTestId('gallery-github').click();
        await page
          .getByTestId('gallery-panel-github')
          .getByRole('button', { name: 'Test' })
          .click();
        await expect(page.getByTestId('mcp-tools')).toBeVisible();
        await page.screenshot({ path: `${name}-collegato.png`, animations: 'disabled' });
      });
    });
  }
}

test('gallery: "who uses it" clicked twice in a row keeps both choices (W-13)', async ({
  page,
}) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');

  // The first answer is still on its way when the second click comes.
  await holdMock(page);
  await panel.getByRole('button', { name: 'Titan', exact: true }).click();
  await panel.getByRole('button', { name: 'Rhea', exact: true }).click();
  await releaseMock(page);
  for (const [name, on] of [
    ['Titan', 'false'],
    ['Rhea', 'false'],
    ['Dione', 'true'],
  ] as const) {
    await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      on,
    );
  }
});
