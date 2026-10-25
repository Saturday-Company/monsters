import { expect, test } from './fixtures.ts';

/*
 * D-072 on the mock core: "Cambia il token" on a connection with a token
 * (gallery and "Apps") keeps who uses it; the sign-in with the core
 * on another computer, when the page of return does not open, is finished by
 * pasting its address.
 */

const URL = '/?mock=demo#/impostazioni?sezione=collegamenti';

test('gallery: "Cambia il token" replaces the token and keeps who uses it', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-github').click();
  const panel = page.getByTestId('gallery-panel-github');
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  const pressed = async () =>
    Promise.all(
      ['Titan', 'Rhea', 'Dione'].map((name) =>
        panel.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'),
      ),
    );
  const before = await pressed();

  await panel.getByTestId('mcp-change-token').click();
  const form = panel.getByTestId('mcp-token-form');
  await expect(form.getByRole('link', { name: 'Create the key' })).toHaveAttribute(
    'href',
    /github\.com/,
  );
  await form.getByRole('button', { name: 'Save and test' }).click();
  await expect(form.getByRole('alert')).toContainText('Paste the new key here');
  await form.getByLabel(/key/i).fill('ghp_NUOVO_SEGRETO_5678');
  await form.getByRole('button', { name: 'Save and test' }).click();
  await expect(page.getByText('GitHub key changed.')).toBeVisible();
  await expect(panel.getByTestId('mcp-token-form')).toHaveCount(0);
  // Tried at once with the new token; still connected, same monsters.
  await expect(panel.getByTestId('mcp-tools')).toContainText('Works');
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  expect(await pressed()).toEqual(before);
  await expect(page.locator('body')).not.toContainText('SEGRETO');
});

test('Apps: "Change the token" of an app added by address, with a secret', async ({ page }) => {
  await page.goto(URL);
  const section = page.getByTestId('mcp-settings');
  await section.getByRole('button', { name: /Advanced: add an app by address/ }).click();
  const form = section.getByTestId('mcp-add-form');
  await form.getByLabel('Name').fill('calendario');
  await form.getByLabel('Command').fill('npx -y @esempio/mcp-calendario');
  await form.getByLabel('Variables (optional)').fill('API_KEY=segreto-123');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  const card = section.getByTestId('mcp-server-calendario');
  await card.getByRole('button', { expanded: false }).first().click();
  const dione = card.getByRole('button', { name: 'Dione', exact: true });
  const before = await dione.getAttribute('aria-pressed');

  await card.getByTestId('mcp-change-token').click();
  await card.getByLabel('New value for API_KEY').fill('segreto-NUOVO-456');
  await card.getByRole('button', { name: 'Save and test' }).click();
  await expect(page.getByText('calendario key changed.')).toBeVisible();
  await expect(card.getByTestId('mcp-tools')).toContainText('Works');
  await expect(dione).toHaveAttribute('aria-pressed', before ?? 'true');
  await card.getByRole('button', { name: 'Details' }).click();
  await expect(card.getByTestId('mcp-details')).toContainText('API_KEY (values hidden)');
  await expect(page.locator('body')).not.toContainText('NUOVO-456');
});

test('the sign-in with the core on another computer: paste the page of return', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockRemote=1#/impostazioni?sezione=collegamenti');
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-waiting')).toBeVisible();
  // The core said the page will not open: the field is already there.
  const paste = panel.getByTestId('oauth-paste');
  const field = paste.getByLabel('Address of the return page');
  await expect(field).toBeVisible();
  await field.fill('https://www.notion.so/qualcosa');
  await paste.getByRole('button', { name: 'Finish signing in' }).click();
  await expect(paste.getByRole('alert')).toContainText('That’s not the address of the return page');
  await field.fill('http://127.0.0.1:4747/api/mcp-oauth/callback?code=abc&state=xyz');
  await paste.getByRole('button', { name: 'Finish signing in' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await expect(panel.getByTestId('mcp-tools')).toContainText('Works');
});

test('without the paste hint, the way out is one click away while waiting', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await (await popup).close();
  const toggle = panel.getByRole('button', { name: 'Return page won’t open?' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // The mock browser comes back by itself: connected, the way out goes away.
  await expect(panel.getByTestId('gallery-state')).toHaveText('Connected');
  await expect(panel.getByTestId('oauth-paste')).toHaveCount(0);
});
