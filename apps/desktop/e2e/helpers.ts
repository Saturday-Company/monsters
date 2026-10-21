import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { electronArgs, electronBinary } from '../scripts/electron-env.ts';
import { checkNotOnUserBus, processTree } from '../scripts/test-session.ts';

export const APP_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const BUNDLE = join(APP_DIR, '..', '..', 'packages', 'cli', 'dist-bundle', 'monsters.js');

export const EMAIL = 'giulio@esempio.it';
export const PASSWORD = 'una-password-lunga';

/** A temporary folder with the data directory and the app's user data folders. */
export function tempRoot(): {
  root: string;
  home: string;
  userData: (n: number) => string;
  cleanup(): void;
} {
  const root = mkdtempSync(join(tmpdir(), 'monsters-desktop-e2e-'));
  return {
    root,
    home: join(root, 'home'),
    userData: (n) => join(root, `user-data-${n}`),
    cleanup: () => {
      if (process.env['MONSTERS_E2E_KEEP'] === '1') console.warn(`kept ${root}`);
      else rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Environment of the app in the tests: never the user's keychain, no model download. */
export function appEnv(home: string, userData: string, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('MONSTERS_') && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  return {
    ...env,
    MONSTERS_HOME: home,
    MONSTERS_DESKTOP_USER_DATA: userData,
    MONSTERS_SECRETS: 'file',
    MONSTERS_EMBEDDINGS: 'off',
    MONSTERS_TELEGRAM: 'off',
    // The suite asserts Italian texts: the app is English first (D-153), so it asks for Italian;
    // a test of the English app passes `MONSTERS_LANG: 'en'` in `extra`.
    MONSTERS_LANG: 'it',
    ...extra,
  };
}

/**
 * Starts the app. A user data folder without connections.json is a first start: the window
 * asks where the monsters work (audit UX 1.2) and, unless `choose: false`, the helper answers
 * "Su questo computer" with Enter, the default.
 */
export async function launch(
  home: string,
  userData: string,
  extra: Record<string, string> = {},
  opts: { choose?: boolean; args?: string[] } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const firstStart = !existsSync(join(userData, 'connections.json'));
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: [APP_DIR, ...electronArgs(), ...(opts.args ?? [])],
    env: appEnv(home, userData, extra),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  if (firstStart && opts.choose !== false) await chooseThisComputer(page);
  return { app, page };
}

/** The first-start page: "Su questo computer" has the focus, Enter picks it. */
export async function chooseThisComputer(page: Page): Promise<void> {
  const welcome = page.locator('main[data-status="welcome"]');
  const local = welcome.locator('button[data-action="local"]');
  await expect(local).toBeFocused({ timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(welcome).toHaveCount(0, { timeout: 30_000 });
}

/** Waits until the window shows the core (not the status page). */
export async function onCore(page: Page): Promise<string> {
  await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  return new URL(page.url()).origin;
}

export function lockPid(home: string): number | null {
  try {
    return (JSON.parse(readFileSync(join(home, 'core.lock'), 'utf8')) as { pid: number }).pid;
  } catch {
    return null;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Calls the core from the page (session cookie of the window). */
export function api<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => {
    const res = await fetch(p);
    return (await res.json()) as T;
  }, path);
}

/** Clicks a menu item of the application menu as the user would (its click handler). */
export function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  return app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`no menu item ${itemId}`);
    // MenuItem.click(event?, window?, webContents?) runs the item's handler.
    (item.click as () => void)();
  }, id);
}

/** Replaces `shell.openExternal` with a recorder; read the calls with `openedUrls`. */
export async function stubOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as { __opened?: string[] };
    g.__opened = [];
    shell.openExternal = (url: string) => {
      g.__opened?.push(url);
      return Promise.resolve();
    };
  });
}

export function openedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []);
}

/**
 * No process of the app on the session bus of the person at this PC: the tray icon and the
 * notifications stay in the private bus of scripts/e2e.ts (C6). Returns what it saw, or null
 * when the run is not isolated (headed, or not Linux).
 */
export function checkUserBus(app: ElectronApplication): string | null {
  const userBus = process.env['MONSTERS_E2E_USER_BUS'];
  const own = process.env['DBUS_SESSION_BUS_ADDRESS'];
  const pid = app.process().pid;
  if (process.platform !== 'linux' || !userBus || !own || own === userBus || !pid) return null;
  return checkNotOnUserBus(processTree([pid]), { bus: own }, userBus);
}

/** Quits through the menu (as "Esci") and waits for the process to end. */
export async function quit(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 30_000 });
  await clickMenu(app, 'monsters-quit').catch(() => {});
  await closed;
}
