import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, test } from './fixtures.ts';

/*
 * The window of docs/design.md (D-062, "Strumento"): the top rail across the
 * window, the sidebar and the content module, Ferma with its light, the status
 * display, and the contract with the desktop app (chrome, colours of the
 * overlay buttons).
 */

test('sidebar: monsters, Note, Attività and Impostazioni; the toolbar names the page', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar.getByRole('navigation', { name: 'Monsters’ chats' })).toBeVisible();
  const toolbar = page.getByTestId('toolbar');
  // Wide window, no chat in the address: the orchestrator's chat.
  await expect(toolbar.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();

  for (const [label, heading] of [
    ['Automations', 'Automations'],
    ['Notes', 'Notes'],
    ['Activity', 'Activity'],
    ['Settings', 'Settings'],
  ] as const) {
    await sidebar.getByRole('link', { name: label, exact: true }).click();
    await expect(toolbar.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  // One rail, 52 px, across the whole window; the sidebar and the module under it.
  const bars = await page.locator('[data-titlebar]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, Math.round(r.width), Math.round(r.height)];
    }),
  );
  expect(bars).toEqual([[0, 0, page.viewportSize()!.width, 52]]);
  const module = await page.locator('[data-content-card]').boundingBox();
  expect(module!.x).toBe(300);
  expect(module!.y).toBe(52);
  expect(Math.round(module!.x + module!.width)).toBe(page.viewportSize()!.width);
  // Shortcuts of the sidebar: ⌘2 / Ctrl+2 Automazioni, 3 Note, 4 File, 5 Attività, 1 the team leader.
  await page.keyboard.press('ControlOrMeta+2');
  await expect(toolbar.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+3');
  await expect(toolbar.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+4');
  await expect(toolbar.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+5');
  await expect(toolbar.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+1');
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
  // The god's bar is its chat in the sidebar (D-102): chosen, with the shortcut for ARIA.
  await expect(page.getByTestId('god-bar')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('god-bar')).toHaveAttribute('aria-keyshortcuts', /\+1$/);
});

test('Ferma: its light is on while a monster works, blinks only when armed (D-084)', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?mock=demo');
  const kill = page.getByTestId('kill');
  const light = kill.getByTestId('kill-light');
  // In the demo Rhea is at work.
  await expect(kill).toHaveAttribute('data-working', 'true');
  await expect(light).toHaveAttribute('data-tone', 'signal');
  // Work is a state, not a call: the light is steady (only what waits for the user blinks).
  await expect(light).not.toHaveAttribute('data-blink', /.*/);
  await expect(kill).toHaveAccessibleName('Stop all monsters');
  // Rhea's work ends: nobody works any more.
  await page.evaluate(async (src) => {
    const { useApp } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
    const live = { ...useApp.getState().live };
    for (const id of Object.keys(live)) live[id] = { mood: 'idle', since: 0 };
    useApp.setState({ live });
  }, '/src/store/app.ts');
  await expect(kill).not.toHaveAttribute('data-working', 'true');
  await expect(light).not.toHaveAttribute('data-blink', /.*/);
  await expect(light).not.toHaveAttribute('data-tone', /.*/);
  // Two presses: the cover, then the lever; one more brings them back.
  await kill.click();
  await expect(kill).toHaveAttribute('data-state', 'armed');
  // Armed, it waits for the second press: now it blinks.
  await expect(light).toHaveAttribute('data-blink', '');
  await kill.click();
  const resume = page.getByTestId('resume');
  await expect(resume).toHaveAttribute('data-state', 'halted');
  await expect(resume).toHaveAccessibleName('Resume');
  await expect(resume.getByTestId('kill-light')).toHaveAttribute('data-tone', 'stop');
  await expect(page.getByTestId('status-display')).toHaveAttribute('data-state', 'halted');
  await resume.click();
  await expect(page.getByTestId('kill')).toHaveAttribute('data-state', 'idle');
});

test('status display: the open question first, a click opens its chat', async ({ page }) => {
  await page.goto('/?mock=demo#/note');
  const display = page.getByTestId('status-display');
  await expect(display).toHaveAttribute('data-state', 'questions');
  await expect(display).toHaveAccessibleName(/^Squad status: Titan asks/);
  await display.click();
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
});

test('desktop app: overlay chrome, and the colours of its buttons follow the theme', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: { background: string; symbol: string }[] = [];
    (window as unknown as { titleBarCalls: typeof calls }).titleBarCalls = calls;
    (window as unknown as { monstersDesktop: unknown }).monstersDesktop = {
      isDesktop: true,
      version: '0.0.0-test',
      platform: 'linux',
      chrome: 'overlay',
      setupCode: () => Promise.resolve(null),
      openExternal: () => Promise.resolve(true),
      setTitleBarColors: (c: { background: string; symbol: string }) => calls.push(c),
    };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?mock=demo#/impostazioni?sezione=aspetto');
  await expect(page.locator('html')).toHaveAttribute('data-chrome', 'overlay');
  const calls = () =>
    page.evaluate(
      () => (window as unknown as { titleBarCalls: { background: string }[] }).titleBarCalls,
    );
  // The chassis of the rail, with the ink of the theme.
  await expect.poll(calls).toEqual([{ background: '#e3e1db', symbol: '#1a1a18' }]);

  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect.poll(calls).toEqual([
    { background: '#e3e1db', symbol: '#1a1a18' },
    { background: '#151514', symbol: '#ecebe5' },
  ]);

  // The rail drags the window, its controls do not.
  const region = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue('-webkit-app-region').replace('none', ''),
      );
  expect(await region('[data-testid="toolbar"]')).toBe('drag');
  expect(await region('[data-testid="kill"]')).toBe('no-drag');
});

test('in a browser nothing is reserved for window controls', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(page.locator('html')).not.toHaveAttribute('data-chrome', /.*/);
  const pad = await page.getByTestId('toolbar').evaluate((el) => getComputedStyle(el).paddingRight);
  expect(pad).toBe('12px');
  // No computer to choose in a browser.
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('computer-switcher')).toHaveCount(0);
});

test('overlay chrome: the rail leaves room for the system buttons, all chassis', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { monstersDesktop: unknown }).monstersDesktop = {
      isDesktop: true,
      version: '0.0.0-test',
      platform: 'linux',
      chrome: 'overlay',
      setupCode: () => Promise.resolve(null),
      openExternal: () => Promise.resolve(true),
    };
  });
  await page.goto('/?mock=demo');
  const rail = await page.getByTestId('toolbar').boundingBox();
  const width = page.viewportSize()!.width;
  expect(rail).toEqual({ x: 0, y: 0, width, height: 52 });
  // The rail is chassis under the buttons, like the overlay Electron paints.
  expect(
    await page.getByTestId('toolbar').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const box = await page.locator('[data-content-card]').boundingBox();
  expect(box!.y).toBe(52);
  expect(Math.round(box!.x + box!.width)).toBe(width);
});

test('macOS: room for the traffic lights before the wordmark', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { monstersDesktop: unknown }).monstersDesktop = {
      isDesktop: true,
      version: '0.0.0-test',
      platform: 'darwin',
      chrome: 'inset',
      setupCode: () => Promise.resolve(null),
      openExternal: () => Promise.resolve(true),
    };
  });
  await page.goto('/?mock=demo');
  const mark = await page.getByRole('img', { name: 'Monsters' }).boundingBox();
  expect(mark!.x).toBeGreaterThanOrEqual(76);
  expect(mark!.x).toBeLessThan(100);
});

/** A desktop bridge with the calls of the computer switcher (D-059); `push` changes the target. */
async function fakeTargetBridge(page: Page, first: { kind: string; name: string; state: string }) {
  await page.addInitScript((target) => {
    const w = window as unknown as {
      monstersDesktop: unknown;
      opened: number;
      pushTarget: (t: unknown) => void;
    };
    let listener: ((t: unknown) => void) | null = null;
    w.opened = 0;
    w.pushTarget = (t) => listener?.(t);
    w.monstersDesktop = {
      isDesktop: true,
      version: '0.0.0-test',
      platform: 'linux',
      chrome: 'overlay',
      setupCode: () => Promise.resolve(null),
      openExternal: () => Promise.resolve(true),
      openConnections: () => {
        w.opened++;
      },
      target: () => Promise.resolve(target),
      onTargetChange: (l: (t: unknown) => void) => {
        listener = l;
        return () => {
          listener = null;
        };
      },
    };
  }, first);
}

test('desktop app: the computer switcher shows where the monsters work and opens Connessioni', async ({
  page,
}) => {
  await fakeTargetBridge(page, { kind: 'local', name: 'This computer', state: 'ready' });
  await page.goto('/?mock=demo');
  const sw = page.getByTestId('computer-switcher');
  await expect(sw).toBeVisible();
  await expect(sw).toHaveText(/This computer/);
  await expect(sw).toHaveAccessibleName('Computer: This computer, ready. Switch computer');
  await expect(sw.getByTestId('computer-dot')).toHaveAttribute('data-tone', 'ready');

  await sw.click();
  expect(await page.evaluate(() => (window as unknown as { opened: number }).opened)).toBe(1);

  // The app reconnects to another computer: name, dot and words follow.
  await page.evaluate(() =>
    (window as unknown as { pushTarget: (t: unknown) => void }).pushTarget({
      kind: 'remote',
      name: 'Home PC',
      state: 'reconnecting',
    }),
  );
  await expect(sw).toHaveText(/Home PC · reconnecting…/);
  await expect(sw.getByTestId('computer-dot')).toHaveAttribute('data-tone', 'busy');
  await page.evaluate(() =>
    (window as unknown as { pushTarget: (t: unknown) => void }).pushTarget({
      kind: 'remote',
      name: 'Home PC',
      state: 'offline',
    }),
  );
  await expect(sw.getByTestId('computer-dot')).toHaveAttribute('data-tone', 'off');
  await expect(sw).toHaveText(/unreachable/);
});

test('desktop app without the calls (older app): no switcher', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { monstersDesktop: unknown }).monstersDesktop = {
      isDesktop: true,
      version: '0.0.0-test',
      platform: 'linux',
      chrome: 'overlay',
      setupCode: () => Promise.resolve(null),
      openExternal: () => Promise.resolve(true),
    };
  });
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('computer-switcher')).toHaveCount(0);
});
