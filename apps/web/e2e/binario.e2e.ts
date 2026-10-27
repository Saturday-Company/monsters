import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * The shell of wave B1: "To review" and "What's new" (one Inbox key since wave I) in the rail of every page (U2-28), the foot of
 * the sidebar that leaves the chats their room (V-7), the phone's rail with words (V-9), the clock
 * written as the chat writes it (V-4), a page that says it is loading (V-6) and the unreachable
 * screen that tries again by itself (W-27).
 */

const SEEN = 'monsters-news-seen';

/** The rows of the chat list that are wholly inside its scroll box. */
async function visibleRows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nav = document.querySelector('[data-testid="chat-list-nav"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid="chat-row"]')]
      .filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top >= nav.top - 1 && b.bottom <= nav.bottom + 1;
      })
      .map((r) => r.getAttribute('data-agent') ?? r.textContent ?? '');
  });
}

for (const [route, heading] of [
  ['#/impostazioni', 'Settings'],
  ['#/note', 'Notes'],
  ['#/file', 'Files'],
  ['#/log', 'Activity'],
  ['#/automazioni', 'Automations'],
] as const) {
  test(`"To review" with its count is in the rail of ${heading} and opens the sheet (U2-28)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?mock=demo${route}`);
    const rail = page.getByTestId('toolbar');
    await expect(rail.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    const key = rail.getByTestId('review-toggle');
    await expect(key).toHaveCount(1);
    await expect(key.getByTestId('review-count')).toHaveText(/^[1-9]/);
    await expect(key).toHaveAttribute('aria-pressed', 'false');
    // Not a column that is not there: on these pages the key opens the sheet.
    await key.click();
    await expect(page.getByTestId('review-sheet')).toBeVisible();
    await expect(key).toHaveAttribute('aria-pressed', 'true');
    await key.click();
    await expect(page.getByTestId('review-sheet')).toBeHidden();
  });
}

test('the chat keeps "To review" as a column on a wide window, once, in the rail (U2-28)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  const key = page.getByTestId('toolbar').getByTestId('review-toggle');
  await expect(key).toHaveCount(1);
  await expect(page.getByTestId('review-toggle')).toHaveCount(1);
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('review-sheet')).toHaveCount(0);
  // On another page the column is not there, so the key does not say it is down.
  await page.evaluate(() => (window.location.hash = '#/impostazioni'));
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(key).toHaveAttribute('aria-pressed', 'false');
});

test('the news light of the Inbox is on only for news not yet seen (U2-28, V-9)', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    if (!window.sessionStorage.getItem('__seeded')) {
      window.localStorage.setItem(key, '0.0.1');
      window.sessionStorage.setItem('__seeded', '1');
    }
  }, SEEN);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/impostazioni');
  const inbox = page.getByTestId('toolbar').getByTestId('review-toggle');
  // One key for everything that arrives: the news are a light on it, not a key of their own.
  await expect(page.getByTestId('news-toggle')).toHaveCount(0);
  await expect(inbox).toHaveAttribute('data-fresh', '');
  await expect(inbox.getByTestId('news-led')).toBeVisible();
  await inbox.click();
  await page.getByRole('tab', { name: 'News' }).click();
  await expect(page.getByTestId('news-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  // Seen: the light goes out and the key keeps its word and its number.
  await expect(inbox).not.toHaveAttribute('data-fresh', /.*/);
  await expect(inbox.getByTestId('news-led')).toHaveCount(0);
  await expect(inbox).toContainText('Inbox');
  // Below 1100 px the word gives way to the icon; the key is still the only one.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByTestId('toolbar').getByTestId('review-toggle')).toHaveCount(1);
});

test('the foot of the sidebar leaves the chats their room: the project monsters show at 1440×900 (V-7)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('chat-list-nav')).toBeVisible();
  const rows = await visibleRows(page);
  // Four monsters of the personal squad fitted before; now the project's ones are in sight too.
  expect(rows.length).toBeGreaterThanOrEqual(6);
  expect(rows).toContain('iapetus');
  const foot = (await page.getByTestId('sidebar-foot').boundingBox())!;
  expect(foot.height).toBeLessThan(140);
  // Every section is still a link with its name, its shortcut and its words.
  const tiles = page.getByTestId('sidebar-tiles');
  for (const name of ['Automations', 'Notes', 'Files', 'Activity', 'Settings']) {
    const link = tiles.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('aria-keyshortcuts', /(Control|Meta)\+./);
    await expect(link).toContainText(name);
  }
  await tiles.getByRole('link', { name: 'Notes', exact: true }).click();
  await expect(page.getByTestId('toolbar').getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(tiles.getByRole('link', { name: 'Notes', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('at 1280×720 the foot is one row of icons with names, and the squads keep the rest (V-7)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?mock=demo');
  const foot = (await page.getByTestId('sidebar-foot').boundingBox())!;
  expect(foot.height).toBeLessThan(80);
  const tiles = page.getByTestId('sidebar-tiles').getByRole('link');
  await expect(tiles).toHaveCount(5);
  await expect(tiles.nth(3)).toHaveAccessibleName('Activity');
  await expect(tiles.nth(0)).toHaveAccessibleName('Automations');
  await expect(tiles.nth(0)).toHaveAttribute('title', /Automations \((Ctrl 2|⌘2)\)/);
  const rows = await visibleRows(page);
  expect(rows.length).toBeGreaterThanOrEqual(4);
});

test('phone: Stop says its word, "To review" its count, the status is a light with a number (V-9)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/impostazioni');
  const rail = page.getByTestId('toolbar');
  await expect(rail.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const kill = rail.getByTestId('kill');
  await expect(kill).toContainText('Stop');
  await expect(kill).toBeInViewport({ ratio: 1 });
  // The word is drawn, not only named: it takes room on screen.
  const word = await kill.locator('.label').first().boundingBox();
  expect(word!.width).toBeGreaterThan(20);
  await expect(rail.getByTestId('review-toggle').getByTestId('review-count')).toHaveText(/^[1-9]/);
  const status = rail.getByTestId('status-display');
  await expect(status).toHaveAttribute('data-state', 'questions');
  await expect(status).toContainText('1');
  await expect(status).toHaveAccessibleName(/Titan asks/);
  // The title of the page still has room for its word.
  const title = rail.getByRole('heading', { name: 'Settings', level: 1 });
  expect((await title.boundingBox())!.width).toBeGreaterThan(60);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expectNoSideScroll(page);
  // At home, in the demo with its "demo" tag, the keys fit too.
  await page.evaluate(() => (window.location.hash = '#/'));
  await expect(rail.getByTestId('kill')).toBeInViewport({ ratio: 1 });
  await expectNoSideScroll(page);
  // A phone held sideways has room for the words of the status.
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.getByTestId('status-display')).toContainText(/1 question/i);
  await expectNoSideScroll(page);
});

test('the clock of the display is written as the chat writes the time (V-4)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T17:27:00Z') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  const status = page.getByTestId('status-display');
  // Rome is UTC+1 on that day: 18:27, which in English is 6:27 PM.
  await expect(status).toContainText('6');
  await expect(status).toContainText('27');
  await expect(status).toContainText('PM');
  await expect(status).not.toContainText('18:27');
  // Said once, in the key's name; the unlit digits are not read.
  await expect(status).toHaveAccessibleName(/6:27 PM/);
  await expect(status).not.toHaveAccessibleName(/88/);
  const unlit = status.getByText('88:88');
  await expect(unlit).toHaveCount(1);
  expect(await unlit.evaluate((el) => !!el.closest('[aria-hidden="true"]'))).toBe(true);
});

test('a page that is still loading says so, quietly, after a moment (V-6)', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('toolbar')).toBeVisible();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/SettingsView\.tsx/, async (route) => {
    await held;
    await route.continue();
  });
  await page.evaluate(() => (window.location.hash = '#/impostazioni'));
  const loading = page.getByTestId('page-loading');
  await expect(loading).toBeVisible();
  await expect(loading.getByRole('status')).toHaveText('Loading…');
  release();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test('the unreachable screen tries again by itself, and "Try again" answers (W-27)', async ({
  page,
  consoleErrors,
}) => {
  let calls = 0;
  let gate: Promise<void> | null = null;
  await page.route('**/api/setup-status', async (route) => {
    calls++;
    if (gate) await gate;
    await route.abort();
  });
  await page.clock.install();
  await page.goto('/');
  const screen = page.getByTestId('unreachable-device');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('unreachable-auto')).toHaveText('I’ll keep trying on my own.');
  // After the first pause, and then after a longer one, it asks again without being touched.
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(2_500);
  await expect.poll(() => calls).toBe(2);
  await page.clock.runFor(1_000);
  await expect(page.getByTestId('unreachable-retry')).toHaveText('Try again');
  await page.clock.runFor(4_500);
  await expect.poll(() => calls).toBe(3);
  await page.clock.runFor(1_000);
  // The key now: pending while the attempt is out, then back.
  let open: () => void = () => {};
  gate = new Promise<void>((resolve) => (open = resolve));
  const retry = page.getByTestId('unreachable-retry');
  await retry.click();
  await expect(retry).toHaveText('Trying again…');
  await expect(retry).toBeDisabled();
  open();
  gate = null;
  await page.clock.runFor(1_000);
  await expect(retry).toHaveText('Try again');
  await expect(retry).toBeEnabled();
  // The browser logs every request that fails: expected here.
  consoleErrors.length = 0;
});
