import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { clickMenu, launch, onCore, quit, tempRoot } from './helpers.ts';

/*
 * "Apri all'accesso" (D-095) on Linux: the autostart file in a temporary XDG_CONFIG_HOME (never
 * the real ~/.config), turned on from the web UI's bridge and off from the menu; a start with
 * `--hidden` keeps the window hidden until "Apri Monsters".
 */

test.skip(process.platform !== 'linux', 'the XDG autostart file is Linux only');

let dirs: ReturnType<typeof tempRoot>;
test.beforeAll(() => {
  dirs = tempRoot();
});
test.afterAll(() => dirs.cleanup());

interface Bridge {
  monstersDesktop: {
    loginItem(): Promise<unknown>;
    setLoginItem(enabled: boolean): Promise<unknown>;
  };
}

const menuChecked = (app: ElectronApplication) =>
  app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('monsters-login-item')?.checked,
  );

const windowVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.getTitle().startsWith('Monsters') && w.isVisible()),
  );

const pushedStates = (page: Page) =>
  page.evaluate(() => (globalThis as { __loginItem?: unknown[] }).__loginItem ?? []);

test('on from the Settings bridge, off from the menu; a start at login stays hidden', async () => {
  const config = join(dirs.root, 'config');
  const file = join(config, 'autostart', 'monsters.desktop');
  const env = {
    XDG_CONFIG_HOME: config,
    // The development app is not "installed": the tests say which executable to start.
    MONSTERS_DESKTOP_AUTOSTART_EXEC: '/opt/Monsters App/monsters',
  };
  const userData = dirs.userData(1);
  let { app, page } = await launch(dirs.home, userData, env);
  try {
    await onCore(page);
    expect(
      await page.evaluate(() => (window as unknown as Bridge).monstersDesktop.loginItem()),
    ).toEqual({ supported: true, enabled: false });
    expect(existsSync(file)).toBe(false);
    expect(await menuChecked(app)).toBe(false);

    await page.evaluate(() => {
      const g = globalThis as unknown as { __loginItem: unknown[] } & {
        monstersDesktop: { onLoginItemChange(l: (s: unknown) => void): () => void };
      };
      g.__loginItem = [];
      g.monstersDesktop.onLoginItemChange((s) => g.__loginItem.push(s));
    });
    expect(
      await page.evaluate(() => (window as unknown as Bridge).monstersDesktop.setLoginItem(true)),
    ).toEqual({ supported: true, enabled: true });
    expect(readFileSync(file, 'utf8')).toContain('Exec="/opt/Monsters App/monsters" --hidden');
    await expect.poll(() => menuChecked(app)).toBe(true);

    // "Apri all'accesso" in the menu again: off, and the page hears it.
    await clickMenu(app, 'monsters-login-item');
    await expect.poll(() => existsSync(file)).toBe(false);
    await expect.poll(() => pushedStates(page)).toEqual([{ supported: true, enabled: false }]);
    expect(await menuChecked(app)).toBe(false);
  } finally {
    await quit(app);
  }

  // Started at login: the core starts, the window stays hidden until "Apri Monsters".
  ({ app, page } = await launch(dirs.home, userData, env, { args: ['--hidden'] }));
  try {
    await onCore(page);
    expect(await windowVisible(app)).toBe(false);
    await clickMenu(app, 'monsters-open');
    await expect.poll(() => windowVisible(app)).toBe(true);
  } finally {
    await quit(app);
  }
});
