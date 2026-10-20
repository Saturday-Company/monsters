import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { electronArgs, electronBinary } from '../scripts/electron-env.ts';
import {
  api,
  APP_DIR,
  appEnv,
  BUNDLE,
  checkUserBus,
  clickMenu,
  EMAIL,
  isAlive,
  launch,
  lockPid,
  onCore,
  openedUrls,
  PASSWORD,
  quit,
  stubOpenExternal,
  tempRoot,
} from './helpers.ts';

/*
 * The desktop app end to end (M3.1, D-045): the real core bundle in the app's utility
 * process, a temporary data directory shared by the tests of this file (in order: first
 * start, relaunch, menu, crash, CLI core), no model needed (the first start stops at the
 * key step of the onboarding).
 */

test.describe.configure({ mode: 'serial' });

let dirs: ReturnType<typeof tempRoot>;
test.beforeAll(() => {
  dirs = tempRoot();
});
test.afterAll(() => dirs.cleanup());

interface AuthEvent {
  type: string;
  data: { action?: string; channel?: string; by?: string };
}

test('first launch: account with the code from the app, onboarding, links to the browser', async () => {
  const { app, page } = await launch(dirs.home, dirs.userData(1));
  await onCore(page);
  // Tray and menus are up: nothing of the app on the user's session bus (C6).
  const bus = checkUserBus(app);
  if (bus) console.warn(bus);
  // The setup code comes from the app: only email and password to type.
  await expect(page.getByTestId('setup-code-from-app')).toBeVisible();
  await expect(page.getByLabel('Codice di avvio')).toHaveCount(0);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'key');

  // The page has the bridge and nothing of Node.
  const bridge = await page.evaluate(() => ({
    keys: Object.keys((window as { monstersDesktop?: object }).monstersDesktop ?? {}).sort(),
    require: typeof (window as { require?: unknown }).require,
    process: typeof (window as { process?: unknown }).process,
  }));
  expect(bridge).toEqual({
    keys: [
      'chrome',
      'isDesktop',
      'loginItem',
      'onLoginItemChange',
      'onTargetChange',
      'openConnections',
      'openExternal',
      'openFile',
      'pickFolder',
      'platform',
      'retryCore',
      'setLoginItem',
      'setTheme',
      'setTitleBarColors',
      'setupCode',
      'showFileInFolder',
      'statusAction',
      'target',
      'version',
    ],
    require: 'undefined',
    process: 'undefined',
  });

  // Where the window is connected, and "Connessioni…" from the web UI (audit UX 1.3).
  const target = await page.evaluate(() =>
    (
      window as unknown as { monstersDesktop: { target(): Promise<unknown> } }
    ).monstersDesktop.target(),
  );
  expect(target).toEqual({ kind: 'local', name: 'Questo computer', state: 'ready' });
  await page.evaluate(() =>
    (
      window as unknown as { monstersDesktop: { openConnections(): void } }
    ).monstersDesktop.openConnections(),
  );
  await expect.poll(() => app.windows().length).toBe(2);
  const conn = app.windows().find((p) => p !== page)!;
  await expect(
    conn.locator('article[data-choice="local"] [data-testid="current-status"]'),
  ).toHaveText('In uso');
  await conn.close();
  await expect.poll(() => app.windows().length).toBe(1);

  // Web links open in the system browser; nothing else leaves, no window is created.
  await stubOpenExternal(app);
  const origin = new URL(page.url()).origin;
  // The key link is behind the "Modelli gratuiti" choice of the onboarding (D-053).
  await page.getByRole('radio', { name: /Modelli gratuiti/ }).click();
  await page.getByRole('link', { name: /openrouter\.ai\/keys/ }).click();
  await expect.poll(() => openedUrls(app)).toEqual(['https://openrouter.ai/keys']);
  await page.evaluate(() => {
    window.open('file:///etc/passwd');
    window.open('http://127.0.0.1:1/');
  });
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { monstersDesktop: { openExternal(u: string): Promise<boolean> } }
      ).monstersDesktop.openExternal('javascript:alert(1)'),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    window.location.href = 'https://example.com/altrove';
  });
  await expect
    .poll(() => openedUrls(app))
    .toEqual(['https://openrouter.ai/keys', 'https://example.com/altrove']);
  expect(new URL(page.url()).origin).toBe(origin);
  expect(app.windows()).toHaveLength(1);

  const pid = lockPid(dirs.home);
  expect(pid).not.toBeNull();
  await quit(app);
  // "Esci" stops the core the app started.
  await expect.poll(() => isAlive(pid!)).toBe(false);
  expect(existsSync(join(dirs.home, 'core.lock'))).toBe(false);
  const log = readFileSync(join(dirs.home, 'logs', 'desktop.log'), 'utf8');
  expect(log).toContain('started core at');
  expect(log).toMatch(/core: stopped \(exit 0\)/);
  expect(log).not.toContain('no clean stop');
  expect(log).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
});

test('relaunch: logged in automatically, with a single-use token', async () => {
  // A fresh user data folder: no cookie left from the first launch.
  const { app, page } = await launch(dirs.home, dirs.userData(2));
  await onCore(page);
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entra' })).toHaveCount(0);
  expect(await api(page, '/api/me')).toEqual({
    email: EMAIL,
    via: 'session',
    owner: true,
    recent: true,
  });
  const { events } = await api<{ events: AuthEvent[] }>(page, '/api/events?type=auth&limit=50');
  const actions = events.map((e) => `${e.data.action}:${e.data.channel ?? ''}`);
  expect(actions).toContain('login_token_issued:desktop');
  expect(actions).toContain('login_token:desktop');
  await quit(app);
});

test('menu: "Ferma tutto" engages the kill switch, "Riprendi" lifts it', async () => {
  const { app, page } = await launch(dirs.home, dirs.userData(2));
  await onCore(page);
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await clickMenu(app, 'monsters-kill');
  await expect
    .poll(async () => (await api<{ halted: boolean }>(page, '/api/status')).halted)
    .toBe(true);
  const { events } = await api<{ events: AuthEvent[] }>(page, '/api/events?type=kill&limit=5');
  expect(events.at(-1)?.data.by).toBe('ui');
  await clickMenu(app, 'monsters-resume');
  await expect
    .poll(async () => (await api<{ halted: boolean }>(page, '/api/status')).halted)
    .toBe(false);
  // Labels of the items (the tray menu is built from the same items).
  const trayItems = await app.evaluate(({ Menu }) =>
    ['monsters-open', 'monsters-kill', 'monsters-resume', 'monsters-quit'].map(
      (id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.label ?? null,
    ),
  );
  expect(trayItems).toEqual(['Apri Monsters', 'Ferma tutto', 'Riprendi', 'Esci da Monsters']);

  // "Esci" twice in a row: the app still waits for the core to stop (C4).
  const logFile = join(dirs.home, 'logs', 'desktop.log');
  const stops = () => readFileSync(logFile, 'utf8').split('core: stopped (exit 0)').length;
  const before = stops();
  const pid = lockPid(dirs.home);
  const closed = app.waitForEvent('close', { timeout: 30_000 });
  await clickMenu(app, 'monsters-quit');
  await clickMenu(app, 'monsters-quit').catch(() => {});
  await closed;
  expect(stops()).toBe(before + 1);
  expect(isAlive(pid!)).toBe(false);
  expect(existsSync(join(dirs.home, 'core.lock'))).toBe(false);
});

test('core killed: the window says so, the core restarts, the session is still there', async () => {
  const { app, page } = await launch(dirs.home, dirs.userData(2));
  const origin = await onCore(page);
  await expect(page.getByTestId('onboarding')).toBeVisible();
  const pid = lockPid(dirs.home);
  expect(pid).not.toBeNull();
  process.kill(pid!, 'SIGKILL');
  await expect(page.locator('main[data-status="restarting"]')).toBeVisible();
  await expect(page.getByRole('heading')).toHaveText('Monsters si è fermato all’improvviso');
  await expect(page.getByText(/tentativo 1 di 5/)).toBeVisible();
  const newOrigin = await onCore(page);
  expect(newOrigin).not.toBe(origin);
  await expect(page.getByTestId('onboarding')).toBeVisible();
  expect(lockPid(dirs.home)).not.toBe(pid);
  expect(readFileSync(join(dirs.home, 'logs', 'desktop.log'), 'utf8')).toMatch(
    /exited unexpectedly/,
  );
  await quit(app);
});

test('a core started from the terminal: the app attaches, and leaves it running', async () => {
  const cli: ChildProcess = spawn(
    process.execPath,
    [BUNDLE, 'start', '--home', dirs.home, '--port', '0'],
    { env: appEnv(dirs.home, dirs.userData(3)), stdio: 'ignore' },
  );
  try {
    await expect.poll(() => existsSync(join(dirs.home, 'server.json'))).toBe(true);
    const info = JSON.parse(readFileSync(join(dirs.home, 'server.json'), 'utf8')) as {
      url: string;
      pid: number;
    };
    const { app, page } = await launch(dirs.home, dirs.userData(3));
    expect(await onCore(page)).toBe(info.url);
    // Logged in with a token minted through the CLI token.
    await expect(page.getByTestId('onboarding')).toBeVisible();
    expect(await api(page, '/api/me')).toEqual({
      email: EMAIL,
      via: 'session',
      owner: false,
      recent: false,
    });

    // A second launch only brings the first window forward.
    const second = spawnSync(electronBinary(), [APP_DIR, ...electronArgs()], {
      env: appEnv(dirs.home, dirs.userData(3)),
      timeout: 30_000,
    });
    expect(second.status).toBe(0);
    expect(app.windows()).toHaveLength(1);

    await quit(app);
    expect(isAlive(info.pid)).toBe(true);
    const health = await fetch(`${info.url}/api/health`);
    expect(health.ok).toBe(true);
  } finally {
    cli.kill('SIGTERM');
    await new Promise((r) => cli.once('exit', r));
  }
});

test('a data directory that cannot be written: the app says so and does not stay hidden', async () => {
  const root = tempRoot();
  try {
    const locked = join(root.root, 'locked');
    mkdirSync(locked, { mode: 0o500 });
    const app = await electron.launch({
      executablePath: electronBinary(),
      args: [APP_DIR, ...electronArgs()],
      env: appEnv(join(locked, 'home'), root.userData(1)),
      timeout: 60_000,
    });
    try {
      // start() failed: the single-instance lock is released (a new launch is not swallowed by
      // an invisible process), no window, an error dialog instead.
      await expect
        .poll(() => app.evaluate(({ app: a }) => a.hasSingleInstanceLock()), { timeout: 20_000 })
        .toBe(false);
      const windows = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      expect(windows).toBe(0);
    } finally {
      app.process().kill('SIGKILL');
    }
  } finally {
    root.cleanup();
  }
});
