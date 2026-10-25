import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, lockPid, onCore, quit, tempRoot } from './helpers.ts';

/*
 * The first start of the app (audit UX 1.2): no connections.json, the window asks "Dove
 * lavorano i tuoi mostri?" and no core starts before the answer. "Su un altro mio computer"
 * opens the connections form (checks of the address, "Prova", Esc); "Su questo computer"
 * starts the local core. With MONSTERS_E2E_SHOTS=<folder>, pictures of the new pages in the
 * light and dark themes.
 */

const SHOTS = process.env['MONSTERS_E2E_SHOTS'];

let dirs: ReturnType<typeof tempRoot>;
test.beforeAll(() => {
  dirs = tempRoot();
});
test.afterAll(() => dirs.cleanup());

/** A picture in both themes (Playwright emulates the colour scheme of its pages). */
async function shots(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(SHOTS, `${name}-${scheme === 'light' ? 'chiaro' : 'scuro'}.png`),
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function connectionsWindow(app: ElectronApplication, main: Page): Promise<Page> {
  await expect.poll(() => app.windows().length).toBe(2);
  const conn = app.windows().find((p) => p !== main)!;
  await expect(conn).toHaveTitle('Computer · Monsters');
  return conn;
}

test('first start: the choice comes first, no core before it, then this computer', async () => {
  // ssh pointed at an empty config: never the user's ~/.ssh.
  const sshConfig = join(dirs.root, 'ssh_config');
  mkdirSync(dirs.root, { recursive: true });
  writeFileSync(sshConfig, '');
  const { app, page } = await launch(
    dirs.home,
    dirs.userData(1),
    {
      MONSTERS_DESKTOP_SSH_CONFIG: sshConfig,
      MONSTERS_DESKTOP_SSH_KNOWN_HOSTS: '',
      SSH_AUTH_SOCK: '',
    },
    { choose: false },
  );
  try {
    const welcome = page.locator('main[data-status="welcome"]');
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading')).toHaveText('Dove lavorano i tuoi mostri?');
    await expect(page.getByRole('button', { name: /Su questo computer/ })).toBeFocused();
    await shots(page, 'primo-avvio');
    // Nothing started: no core, no lock, no connections.json yet.
    await page.waitForTimeout(1500);
    expect(lockPid(dirs.home)).toBeNull();
    expect(existsSync(join(dirs.home, 'server.json'))).toBe(false);
    expect(existsSync(join(dirs.userData(1), 'connections.json'))).toBe(false);

    // "Su un altro mio computer": the connections window with the form, on "Computer".
    await page.getByRole('button', { name: /Su un altro mio computer/ }).click();
    const conn = await connectionsWindow(app, page);
    const host = conn.getByLabel('Computer', { exact: true });
    await expect(host).toBeFocused();
    // Nothing is in use yet: every row offers "Usa".
    await expect(conn.locator('[data-testid="current-status"]')).toHaveCount(0);
    await shots(conn, 'connessioni-modulo');

    // The name of the connection typed as the address: a warning while typing.
    await host.fill('Casa');
    await conn.getByLabel('Nome', { exact: true }).fill('Casa');
    await expect(conn.locator('#warn-host')).toHaveText(/sembra il nome della connessione/);
    await shots(conn, 'connessioni-avviso-nome');

    // An address that does not exist: "Prova" names it, the destination does not change.
    await host.fill('pc-che-non-esiste.invalid');
    await conn.getByLabel('Nome', { exact: true }).fill('');
    await expect(conn.locator('#warn-host')).toHaveText('');
    await conn.getByRole('button', { name: 'Prova' }).click();
    await expect(conn.locator('#test-result')).toHaveText(
      /^Non trovo «pc-che-non-esiste\.invalid» in rete\. Controlla l’indirizzo/,
      { timeout: 30_000 },
    );
    await expect(host).toHaveClass(/highlight/);
    await shots(conn, 'connessioni-prova-fallita');
    await expect(welcome).toBeVisible();

    // Saving it: the unknown address is said once; a second "Salva" keeps it.
    await conn.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(conn.locator('#warn-host')).toHaveText(
      /^Non trovo «pc-che-non-esiste\.invalid» in rete\./,
    );
    await conn.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(conn.locator('article[data-choice] h2')).toHaveText([
      'Questo computer',
      'pc-che-non-esiste.invalid',
    ]);
    // Esc with unsaved changes asks for a second Esc.
    await conn.getByRole('button', { name: 'Aggiungi un computer' }).click();
    await host.fill('altro.lan');
    await conn.keyboard.press('Escape');
    await expect(conn.locator('#form')).toBeVisible();
    await expect(conn.locator('#form-error')).toHaveText(/premi di nuovo Esc/);
    await conn.keyboard.press('Escape');
    await expect(conn.locator('#form')).toBeHidden();
    await expect(conn.getByRole('button', { name: 'Aggiungi un computer' })).toBeFocused();
    await conn.close();

    // Still nothing started; then "Su questo computer".
    expect(lockPid(dirs.home)).toBeNull();
    await page.getByRole('button', { name: /Su questo computer/ }).click();
    await onCore(page);
    expect(lockPid(dirs.home)).not.toBeNull();
    await expect(page.getByTestId('setup-code-from-app')).toBeVisible();
  } finally {
    await quit(app);
  }
  // The choice is remembered: the next start goes straight to this computer.
  const again = await launch(dirs.home, dirs.userData(1), {}, { choose: false });
  try {
    await onCore(again.page);
  } finally {
    await quit(again.app);
  }
});

test('the status pages of the local core: "Computer…" while starting', async () => {
  const { app, page } = await launch(dirs.home, dirs.userData(2), {
    MONSTERS_DESKTOP_CORE: join(dirs.root, 'nessun-core.js'),
  });
  try {
    const missing = page.locator('main[data-status="missing"]');
    await expect(missing).toBeVisible({ timeout: 30_000 });
    // From the sources: the developer's hint is there (never in a package).
    await expect(page.getByText(/pnpm build:core/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Computer…' })).toBeVisible();
    await shots(page, 'stato-manca');
    await page.getByRole('button', { name: 'Computer…' }).click();
    await connectionsWindow(app, page);
  } finally {
    await quit(app);
  }
});

test('English first: the first-start page and the menus follow the language', async () => {
  const { app, page } = await launch(
    dirs.home,
    dirs.userData(3),
    { MONSTERS_LANG: 'en' },
    { choose: false },
  );
  try {
    await expect(page.locator('main[data-status="welcome"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading')).toHaveText('Where do your monsters work?');
    await expect(page.getByRole('button', { name: /On this computer/ })).toBeFocused();
    const labels = await app.evaluate(({ Menu }) =>
      ['monsters-open', 'monsters-kill', 'monsters-resume', 'monsters-quit'].map(
        (id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.label ?? null,
      ),
    );
    expect(labels).toEqual(['Open Monsters', 'Stop everything', 'Resume', 'Quit Monsters']);
    // Nothing started: the choice is still to be made.
    expect(lockPid(dirs.home)).toBeNull();
  } finally {
    await quit(app);
  }
});
