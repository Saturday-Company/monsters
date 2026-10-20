import { expect, test } from './fixtures.ts';

/*
 * D-072 on the mock core: "Cambia il token" on a connection with a token
 * (gallery and "Altri programmi") keeps who uses it; the sign-in with the core
 * on another computer, when the page of return does not open, is finished by
 * pasting its address.
 */

const URL = '/?mock=demo#/impostazioni?sezione=collegamenti';

test('gallery: "Cambia il token" replaces the token and keeps who uses it', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-github').click();
  const panel = page.getByTestId('gallery-panel-github');
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  const pressed = async () =>
    Promise.all(
      ['Titan', 'Rhea', 'Dione'].map((name) =>
        panel.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'),
      ),
    );
  const before = await pressed();

  await panel.getByTestId('mcp-change-token').click();
  const form = panel.getByTestId('mcp-token-form');
  await expect(form.getByRole('link', { name: 'Crea il token' })).toHaveAttribute(
    'href',
    /github\.com/,
  );
  await form.getByRole('button', { name: 'Salva e prova' }).click();
  await expect(form.getByRole('alert')).toContainText('Incolla qui il token nuovo');
  await form.getByLabel(/token/i).fill('ghp_NUOVO_SEGRETO_5678');
  await form.getByRole('button', { name: 'Salva e prova' }).click();
  await expect(page.getByText('Token di GitHub cambiato.')).toBeVisible();
  await expect(panel.getByTestId('mcp-token-form')).toHaveCount(0);
  // Tried at once with the new token; still connected, same monsters.
  await expect(panel.getByTestId('mcp-tools')).toContainText('Funziona');
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  expect(await pressed()).toEqual(before);
  await expect(page.locator('body')).not.toContainText('SEGRETO');
});

test('"Altri programmi": "Cambia il token" of a program with a secret', async ({ page }) => {
  await page.goto(URL);
  const section = page.getByTestId('mcp-settings');
  await section.getByRole('button', { name: 'Aggiungi un programma' }).click();
  const form = section.getByTestId('mcp-add-form');
  await form.getByLabel('Nome').fill('calendario');
  await form.getByLabel('Comando').fill('npx -y @esempio/mcp-calendario');
  await form.getByLabel('Variabili (facoltative)').fill('API_KEY=segreto-123');
  await form.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  const card = section.getByTestId('mcp-server-calendario');
  await card.getByRole('button', { expanded: false }).first().click();
  const dione = card.getByRole('button', { name: 'Dione', exact: true });
  const before = await dione.getAttribute('aria-pressed');

  await card.getByTestId('mcp-change-token').click();
  await card.getByLabel('Nuovo valore di API_KEY').fill('segreto-NUOVO-456');
  await card.getByRole('button', { name: 'Salva e prova' }).click();
  await expect(page.getByText('Token di calendario cambiato.')).toBeVisible();
  await expect(card.getByTestId('mcp-tools')).toContainText('Funziona');
  await expect(dione).toHaveAttribute('aria-pressed', before ?? 'true');
  await card.getByRole('button', { name: 'Dettagli' }).click();
  await expect(card.getByTestId('mcp-details')).toContainText('API_KEY (valori nascosti)');
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
  await panel.getByRole('button', { name: 'Collega' }).click();
  await (await popup).close();
  await expect(panel.getByTestId('gallery-waiting')).toBeVisible();
  // The core said the page will not open: the field is already there.
  const paste = panel.getByTestId('oauth-paste');
  const field = paste.getByLabel('Indirizzo della pagina di ritorno');
  await expect(field).toBeVisible();
  await field.fill('https://www.notion.so/qualcosa');
  await paste.getByRole('button', { name: 'Completa l’accesso' }).click();
  await expect(paste.getByRole('alert')).toContainText('Non è l’indirizzo della pagina di ritorno');
  await field.fill('http://127.0.0.1:4747/api/mcp-oauth/callback?code=abc&state=xyz');
  await paste.getByRole('button', { name: 'Completa l’accesso' }).click();
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await expect(panel.getByTestId('mcp-tools')).toContainText('Funziona');
});

test('without the paste hint, the way out is one click away while waiting', async ({ page }) => {
  await page.goto(URL);
  const gallery = page.getByTestId('mcp-gallery');
  await gallery.getByTestId('gallery-notion').click();
  const panel = page.getByTestId('gallery-panel-notion');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Collega' }).click();
  await (await popup).close();
  const toggle = panel.getByRole('button', { name: 'La pagina di ritorno non si apre?' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // The mock browser comes back by itself: connected, the way out goes away.
  await expect(panel.getByTestId('gallery-state')).toHaveText('Collegato');
  await expect(panel.getByTestId('oauth-paste')).toHaveCount(0);
});
