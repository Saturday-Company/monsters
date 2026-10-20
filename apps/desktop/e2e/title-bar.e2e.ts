import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { clickMenu, launch, onCore, quit, tempRoot } from './helpers.ts';

/*
 * The integrated title bar (D-056): on Windows and Linux the system buttons are a Window
 * Controls Overlay over the page, 52 px tall, coloured from the system theme and then from
 * the page (`setTitleBarColors`, only from the core's page, only #rrggbb); on macOS the
 * traffic lights over the page. With MONSTERS_E2E_SHOTS=<folder>, pictures of the whole
 * window (the overlay is drawn by the app, not by the page: page screenshots do not show it).
 */

const SHOTS = process.env['MONSTERS_E2E_SHOTS'];
const overlay = process.platform === 'linux' || process.platform === 'win32';

let dirs: ReturnType<typeof tempRoot>;
test.beforeAll(() => {
  dirs = tempRoot();
});
test.afterAll(() => dirs.cleanup());

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The window `title` from the app's side: its bounds on screen. */
function boundsOf(app: ElectronApplication, title: string): Promise<Bounds> {
  return app.evaluate(({ BrowserWindow }, t) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === t);
    if (!w) throw new Error(`no window ${t}`);
    return w.getBounds();
  }, title);
}

/** Picture of one window from the virtual screen (Linux under Xvfb). */
async function windowShot(app: ElectronApplication, title: string, name: string): Promise<void> {
  const display = process.env['DISPLAY'];
  if (!SHOTS || !display || process.platform !== 'linux') return;
  mkdirSync(SHOTS, { recursive: true });
  // Let the compositor paint the last change.
  await new Promise((r) => setTimeout(r, 400));
  const b = await boundsOf(app, title);
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  spawnSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'x11grab',
    '-video_size',
    `${b.width}x${b.height}`,
    '-i',
    `${display}+${x},${y}`,
    '-frames:v',
    '1',
    join(SHOTS, name),
  ]);
}

/** Records the overlay colours the app sets on the window `title`. */
async function spyOverlay(app: ElectronApplication, title: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, t) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === t);
    if (!w) throw new Error(`no window ${t}`);
    const g = globalThis as { __overlay?: unknown[] };
    g.__overlay = [];
    const original = w.setTitleBarOverlay.bind(w);
    w.setTitleBarOverlay = (options) => {
      g.__overlay?.push(options);
      original(options);
    };
  }, title);
}

function overlayCalls(app: ElectronApplication): Promise<unknown[]> {
  return app.evaluate(() => (globalThis as { __overlay?: unknown[] }).__overlay ?? []);
}

function setColors(page: Page, colors: unknown): Promise<void> {
  return page.evaluate((c) => {
    const d = (window as unknown as { monstersDesktop: { setTitleBarColors(c: unknown): void } })
      .monstersDesktop;
    d.setTitleBarColors(c);
  }, colors);
}

interface Wco {
  chrome: string;
  visible: boolean;
  rect: Bounds | null;
  innerWidth: number;
}

function wco(page: Page): Promise<Wco> {
  return page.evaluate(() => {
    const o = (
      navigator as {
        windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect };
      }
    ).windowControlsOverlay;
    const r = o?.visible ? o.getTitlebarAreaRect() : null;
    return {
      chrome:
        (window as unknown as { monstersDesktop?: { chrome: string } }).monstersDesktop?.chrome ??
        '',
      visible: !!o?.visible,
      rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      innerWidth: window.innerWidth,
    };
  });
}

test('overlay of the system buttons: 52 px, colours from the system and from the page', async () => {
  const { app, page } = await launch(dirs.home, dirs.userData(1), {
    MONSTERS_DESKTOP_THEME: 'light',
  });
  try {
    await onCore(page);
    const info = await wco(page);
    if (!overlay) {
      expect(info.chrome).toBe(process.platform === 'darwin' ? 'inset' : 'frame');
      return;
    }
    expect(info.chrome).toBe('overlay');
    expect(info.visible).toBe(true);
    // The page may use the whole top row except the buttons on the right.
    expect(info.rect?.x).toBe(0);
    expect(info.rect?.y).toBe(0);
    expect(info.rect?.height).toBe(52);
    expect(info.rect!.width).toBeLessThan(info.innerWidth);
    expect(info.rect!.width).toBeGreaterThan(info.innerWidth - 240);
    await windowShot(app, 'Monsters', 'barra-chiara.png');

    await spyOverlay(app, 'Monsters');
    // The web UI sends its theme's colours (e.g. dark chosen in the Settings).
    await setColors(page, { background: '#1C1C1E', symbol: '#f5f5f7' });
    await expect
      .poll(() => overlayCalls(app))
      .toEqual([{ color: '#1c1c1e', symbolColor: '#f5f5f7' }]);
    await windowShot(app, 'Monsters', 'barra-pagina-scura.png');
    // Anything but #rrggbb is refused.
    for (const bad of [
      { background: 'red', symbol: '#000000' },
      { background: '#ffffff00', symbol: '#000000' },
      { background: '#ffffff' },
      'nope',
    ]) {
      await setColors(page, bad);
    }
    await setColors(page, { background: '#ffffff', symbol: '#1d1d1f' });
    await expect
      .poll(() => overlayCalls(app))
      .toEqual([
        { color: '#1c1c1e', symbolColor: '#f5f5f7' },
        { color: '#ffffff', symbolColor: '#1d1d1f' },
      ]);

    // A wider window: the buttons follow the right edge, the row stays 52 px. (Maximize and
    // the double click on the bar need a window manager, which Xvfb does not have.)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'Monsters')
        ?.setSize(1500, 900);
    });
    const buttons = info.innerWidth - info.rect!.width;
    await expect
      .poll(async () => {
        const r = await wco(page);
        return [r.innerWidth, r.rect?.width, r.rect?.height];
      })
      .toEqual([1500, 1500 - buttons, 52]);

    // The connections window has the same bar, with its header as the drag area.
    await clickMenu(app, 'monsters-connections');
    await expect.poll(() => app.windows().length).toBe(2);
    const conn = app.windows().find((p) => p !== page)!;
    await expect(conn.locator('html')).toHaveAttribute('data-chrome', 'overlay');
    const c = await wco(conn);
    expect(c.visible).toBe(true);
    expect(c.rect?.height).toBe(52);
    const header = await conn.locator('.titlebar').evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      region: getComputedStyle(el).getPropertyValue('-webkit-app-region'),
    }));
    expect(header).toEqual({ height: 52, region: 'drag' });
    await expect(conn.locator('article[data-choice="local"]')).toBeVisible();
    await windowShot(app, 'Connessioni · Monsters', 'connessioni-chiara.png');
  } finally {
    await quit(app);
  }
});

test('status page: system colours, and it cannot set the overlay', async () => {
  test.skip(!overlay, 'Window Controls Overlay only on Windows and Linux');
  const { app, page } = await launch(dirs.home, dirs.userData(2), {
    MONSTERS_DESKTOP_THEME: 'dark',
    MONSTERS_DESKTOP_CORE: join(dirs.root, 'nessun-motore.js'),
  });
  try {
    await expect(page.locator('main[data-status="missing"]')).toBeVisible({ timeout: 30_000 });
    const info = await wco(page);
    expect(info).toMatchObject({ chrome: 'overlay', visible: true });
    expect(info.rect?.height).toBe(52);
    await spyOverlay(app, 'Monsters');
    await setColors(page, { background: '#ff0000', symbol: '#00ff00' });
    // The data: page is not the core: nothing reaches the overlay.
    await page.waitForTimeout(500);
    expect(await overlayCalls(app)).toEqual([]);
    // Playwright emulates a light `prefers-color-scheme` on its pages: dark, as the system.
    await page.emulateMedia({ colorScheme: 'dark' });
    await windowShot(app, 'Monsters', 'stato-scuro.png');
    await clickMenu(app, 'monsters-connections');
    await expect.poll(() => app.windows().length).toBe(2);
    const conn = app.windows().find((p) => p !== page)!;
    await conn.emulateMedia({ colorScheme: 'dark' });
    await expect(conn.locator('article[data-choice="local"]')).toBeVisible();
    await windowShot(app, 'Connessioni · Monsters', 'connessioni-scura.png');
  } finally {
    await quit(app);
  }
});

/** The theme from the app's side: themeSource, and the background of the window `title`. */
function appTheme(app: ElectronApplication, title: string) {
  return app.evaluate(({ BrowserWindow, nativeTheme }, t) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === t);
    return {
      source: nativeTheme.themeSource,
      dark: nativeTheme.shouldUseDarkColors,
      background: w?.getBackgroundColor().toLowerCase() ?? null,
    };
  }, title);
}

/** The chassis an app page paints, with Playwright's colour scheme emulation turned off. */
async function pageChassis(page: Page): Promise<string> {
  await page.emulateMedia({ colorScheme: null });
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

const DARK = { hex: '#151514', rgb: 'rgb(21, 21, 20)' };
const LIGHT = { hex: '#e3e1db', rgb: 'rgb(227, 225, 219)' };

function storedTheme(userData: string): unknown {
  const file = JSON.parse(readFileSync(join(userData, 'connections.json'), 'utf8')) as {
    theme?: unknown;
  };
  return file.theme ?? null;
}

test('the theme of the Settings: the app pages follow it, also after a restart (D-091)', async () => {
  const userData = dirs.userData(3);
  // A light system (the tests' stand-in for it).
  let { app, page } = await launch(dirs.home, userData, { MONSTERS_DESKTOP_THEME: 'light' });
  try {
    await onCore(page);
    await expect.poll(() => appTheme(app, 'Monsters')).toMatchObject({ dark: false });
    // "Scuro" in the Settings: the web UI sends its choice when it starts.
    await page.evaluate(() =>
      localStorage.setItem('monsters-prefs', JSON.stringify({ theme: 'dark' })),
    );
    await page.reload();
    await onCore(page);
    await expect
      .poll(() => appTheme(app, 'Monsters'))
      .toEqual({ source: 'dark', dark: true, background: DARK.hex });
    // Only system / light / dark: anything else leaves the theme as it is.
    await page.evaluate(() =>
      (
        window as unknown as { monstersDesktop: { setTheme(c: unknown): void } }
      ).monstersDesktop.setTheme('#ffffff'),
    );
    await clickMenu(app, 'monsters-connections');
    await expect.poll(() => app.windows().length).toBe(2);
    const conn = app.windows().find((p) => p !== page)!;
    await expect(conn.locator('article[data-choice="local"]')).toBeVisible();
    expect(await pageChassis(conn)).toBe(DARK.rgb);
    expect((await appTheme(app, 'Connessioni · Monsters')).background).toBe(DARK.hex);
    expect((await appTheme(app, 'Monsters')).source).toBe('dark');
    expect(storedTheme(userData)).toBe('dark');
  } finally {
    await quit(app);
  }

  // Next start, the system still light, no core to show: the status page is dark from the
  // start, and so is the connections window.
  ({ app, page } = await launch(dirs.home, userData, {
    MONSTERS_DESKTOP_THEME: 'light',
    MONSTERS_DESKTOP_CORE: join(dirs.root, 'nessun-motore.js'),
  }));
  try {
    await expect(page.locator('main[data-status="missing"]')).toBeVisible({ timeout: 30_000 });
    expect(await appTheme(app, 'Monsters')).toEqual({
      source: 'dark',
      dark: true,
      background: DARK.hex,
    });
    expect(await pageChassis(page)).toBe(DARK.rgb);
    await windowShot(app, 'Monsters', 'stato-tema-scuro.png');
    await clickMenu(app, 'monsters-connections');
    await expect.poll(() => app.windows().length).toBe(2);
    const conn = app.windows().find((p) => p !== page)!;
    await expect(conn.locator('article[data-choice="local"]')).toBeVisible();
    expect(await pageChassis(conn)).toBe(DARK.rgb);
  } finally {
    await quit(app);
  }

  // "Sistema" again: the app follows the system (light) and forgets the choice.
  ({ app, page } = await launch(dirs.home, userData, { MONSTERS_DESKTOP_THEME: 'light' }));
  try {
    await onCore(page);
    await page.evaluate(() =>
      localStorage.setItem('monsters-prefs', JSON.stringify({ theme: 'system' })),
    );
    await page.reload();
    await onCore(page);
    await expect
      .poll(() => appTheme(app, 'Monsters'))
      .toEqual({ source: 'light', dark: false, background: LIGHT.hex });
    expect(await pageChassis(page)).not.toBe(DARK.rgb);
    expect(storedTheme(userData)).toBeNull();
  } finally {
    await quit(app);
  }
});
