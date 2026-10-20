import { expect, test } from './fixtures.ts';

/*
 * Settings → Permessi → Altri programmi (MCP, M2.5), on the mock core: add a
 * program, test it (its tools), choose who uses it, remove it; turn the
 * browser on. Addresses and commands stay under "Dettagli".
 * `MCP_SHOTS=<dir>` also writes screenshots in light and dark.
 */

test('settings: add an MCP server, test it, choose the monsters, remove it', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const section = page.getByTestId('mcp-settings');
  await expect(section.getByRole('heading', { name: 'Altri programmi' })).toBeVisible();
  await expect(section).toContainText('MCP');
  // The demo has GitHub already, from the gallery (D-063): not in the list of other programs.
  await expect(section.getByTestId('gallery-github')).toContainText('Collegato');
  await expect(section.getByTestId('mcp-server-github')).toHaveCount(0);
  // The browser is off.
  await expect(section.getByRole('switch', { name: 'Browser', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await section.getByRole('button', { name: 'Aggiungi un programma' }).click();
  const form = section.getByTestId('mcp-add-form');
  // Checked in the page first.
  await form.getByLabel('Nome').fill('Note Vecchie');
  await form.getByRole('button', { name: 'Aggiungi' }).click();
  await expect(form.getByText('Lettere minuscole, cifre e trattini')).toBeVisible();
  await expect(form.getByText('Scrivi il comando.')).toBeVisible();

  await form.getByLabel('Nome').fill('calendario');
  await form
    .getByLabel('Comando')
    .fill('npx -y "@esempio/mcp-calendario" --cartella "/home/demo/I miei calendari"');
  await form.getByLabel('Variabili (facoltative)').fill('API_KEY=segreto-123');
  // Only Dione uses it.
  for (const name of ['Rhea', 'Enceladus', 'Mimas']) {
    const chip = form.getByRole('button', { name, exact: true });
    if ((await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
  }
  await form.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByText('Programma “calendario” aggiunto.')).toBeVisible();

  const card = section.getByTestId('mcp-server-calendario');
  await expect(card).toContainText('Programma sul computer');
  // The command is a detail: not in the row, under "Dettagli" once open.
  await expect(card).not.toContainText('npx -y');
  await card.getByRole('button', { expanded: false }).click();
  await expect(card.getByTestId('mcp-details')).toHaveCount(0);
  await card.getByRole('button', { name: 'Dettagli' }).click();
  const details = card.getByTestId('mcp-details');
  await expect(details).toContainText('npx -y @esempio/mcp-calendario --cartella');
  await expect(details).toContainText('"/home/demo/I miei calendari"');
  await expect(details).toContainText('API_KEY (valori nascosti)');
  await expect(card).not.toContainText('segreto-123');
  await expect(card.getByRole('button', { name: 'Dione' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('button', { name: 'Rhea' })).toHaveAttribute('aria-pressed', 'false');

  // Test: the tools of the server.
  await card.getByRole('button', { name: 'Prova' }).click();
  await expect(card.getByTestId('mcp-tools')).toContainText('Funziona');
  await expect(card.getByTestId('mcp-tools')).toContainText('search_issues');
  await expect(card.getByTestId('mcp-status')).toHaveText('Acceso');

  // Rhea too, saved at once.
  await card.getByRole('button', { name: 'Rhea' }).click();
  await expect(card.getByRole('button', { name: 'Rhea' })).toHaveAttribute('aria-pressed', 'true');

  // Remove, with a confirmation.
  await card.getByRole('button', { name: 'Togli' }).click();
  await card.getByRole('button', { name: 'Sì, togli' }).click();
  await expect(section.getByTestId('mcp-server-calendario')).toHaveCount(0);

  // Every change is in the log.
  await page.goto('/?mock=demo#/log');
  await expect(page.getByText('Hai aggiunto il programma “calendario”').first()).toBeVisible();
  await expect(page.getByText('Hai tolto il programma “calendario”').first()).toBeVisible();
});

test('settings: a server that does not start says why', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const section = page.getByTestId('mcp-settings');
  await section.getByRole('button', { name: 'Aggiungi un programma' }).click();
  const form = section.getByTestId('mcp-add-form');
  await form.getByLabel('Nome').fill('rotto');
  await form.getByLabel('Comando').fill('programma-che-non-esiste');
  await form.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  const card = section.getByTestId('mcp-server-rotto');
  await card.getByRole('button', { expanded: false }).click();
  await card.getByRole('button', { name: 'Prova' }).click();
  await expect(card.getByTestId('mcp-test-error')).toContainText('Non trovo il programma');
});

test('settings: turn the browser on for the monsters with the web', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
  const browser = page.getByTestId('mcp-browser');
  await browser.getByRole('switch', { name: 'Browser', exact: true }).click();
  await expect(page.getByText('Browser acceso.')).toBeVisible();
  await expect(browser.getByTestId('mcp-status')).toHaveText('Pronto');
  await browser.getByRole('button', { name: 'Dettagli' }).click();
  await expect(browser.getByTestId('mcp-details')).toContainText('@playwright/mcp@');
  await expect(browser.getByTestId('mcp-details')).toContainText('/browser/profile');
  await browser.getByRole('button', { name: 'Prova' }).click();
  await expect(browser.getByTestId('mcp-tools')).toContainText('browser_navigate');
  await browser.getByRole('switch', { name: 'Mostra la finestra del browser' }).click();
  await expect(
    browser.getByRole('switch', { name: 'Mostra la finestra del browser' }),
  ).toHaveAttribute('aria-checked', 'true');
  await browser.getByRole('switch', { name: 'Browser', exact: true }).click();
  await expect(page.getByText('Browser spento.')).toBeVisible();
});

const SHOTS = process.env['MCP_SHOTS'];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`mcp screenshot ${theme}`, () => {
    test.skip(!SHOTS, 'set MCP_SHOTS=<dir> to write the screenshots');
    test.use({
      colorScheme: theme,
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 1100 },
    });

    test('other programs section', async ({ page }) => {
      await page.goto('/?mock=demo#/impostazioni?sezione=collegamenti');
      const section = page.getByTestId('mcp-settings');
      const browser = page.getByTestId('mcp-browser');
      await browser.getByRole('switch', { name: 'Browser', exact: true }).click();
      await expect(browser.getByTestId('mcp-status')).toBeVisible();
      await browser.getByRole('button', { name: 'Prova' }).click();
      await expect(browser.getByTestId('mcp-tools')).toBeVisible();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/mcp-${theme}.png`, animations: 'disabled' });

      await section.getByRole('button', { name: 'Aggiungi un programma' }).click();
      const form = section.getByTestId('mcp-add-form');
      await form.getByLabel('Nome').fill('calendario');
      await form.getByLabel('Comando').fill('npx -y @esempio/mcp-calendario');
      await form.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/mcp-aggiungi-${theme}.png`, animations: 'disabled' });

      await page.setViewportSize({ width: 390, height: 844 });
      await browser.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/mcp-${theme}-390.png`, animations: 'disabled' });
    });
  });
}
