import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * "Segnali" (waves F and I, outside the chat): one Inbox key with one number that is the same in
 * every view and at every width (F-2), the news as the Inbox's second tab, notices at the top and
 * never over the writing field or the bottom bar (F-5), a regular grid in the sidebar foot (F-13),
 * a single solid orange key in Activity, the unlit digits of the clock almost off, and the drafts
 * told in words (F-14).
 */

const SEEN = 'monsters-news-seen';

async function countOf(page: Page): Promise<string> {
  const count = page.getByTestId('toolbar').getByTestId('review-count');
  await expect(count).toBeVisible();
  return (await count.innerText()).trim();
}

const VIEWS = [
  { name: 'home, 1440', width: 1440, height: 900, hash: '' },
  { name: 'home, 1280 (the column fits)', width: 1280, height: 800, hash: '' },
  { name: 'Settings, 1440', width: 1440, height: 900, hash: '#/impostazioni' },
  { name: 'Notes, 1024 (a sheet)', width: 1024, height: 768, hash: '#/note' },
  { name: 'phone home, 390', width: 390, height: 844, hash: '' },
  { name: 'phone inside a chat, 390', width: 390, height: 844, hash: '#/?chat=titan' },
] as const;

test('the Inbox number is the same in every view and at every width (F-2)', async ({ page }) => {
  const seen = new Map<string, string>();
  for (const v of VIEWS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.goto(`/?mock=demo${v.hash}`);
    seen.set(v.name, await countOf(page));
  }
  // The demo has 3 drafts, 1 open question of a chat and 1 paused tool.
  expect(Object.fromEntries(seen)).toEqual(Object.fromEntries(VIEWS.map((v) => [v.name, '5'])));
});

test('opening the column does not change the number: nothing counts as "seen" (F-2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  const before = await countOf(page);
  await page.getByTestId('review-toggle').click();
  await expect(page.getByTestId('activity-panel')).toBeVisible();
  expect(await countOf(page)).toBe(before);
  // Even after a reload, with the notes touched on screen: the same number.
  await page.reload();
  await expect(page.getByTestId('note-row').first()).toBeVisible();
  expect(await countOf(page)).toBe(before);
});

test('the number is what "To review" lists: drafts, questions of the chats, paused tools; notes never count', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?mock=demo');
  const count = Number(await countOf(page));
  await page.getByTestId('review-toggle').click();
  const sheet = page.getByTestId('review-sheet');
  await expect(sheet.getByTestId('draft-card').first()).toBeVisible();
  const listed =
    (await sheet.getByTestId('draft-card').count()) +
    (await sheet.getByTestId('pending-question').count()) +
    (await sheet.locator('[data-testid="paused-tools"] li').count());
  expect(listed).toBe(count);
  // The notes touched are there, with their Undo, but not in the number.
  expect(await sheet.getByTestId('note-row').count()).toBeGreaterThan(0);
});

test('"To review" and the news are one key with two tabs (wave I)', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!window.sessionStorage.getItem('__seeded')) {
      window.localStorage.setItem(key, '0.0.1');
      window.sessionStorage.setItem('__seeded', '1');
    }
  }, SEEN);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?mock=demo#/impostazioni');
  const rail = page.getByTestId('toolbar');
  // One key, no second key for the news; its name says both.
  await expect(rail.getByTestId('review-toggle')).toHaveCount(1);
  await expect(rail.getByTestId('news-toggle')).toHaveCount(0);
  await expect(rail.getByTestId('review-toggle')).toHaveAccessibleName(
    'Inbox, 5 to review, news you haven’t seen',
  );
  await expect(rail.getByTestId('news-led')).toBeVisible();
  await rail.getByTestId('review-toggle').click();
  const sheet = page.getByTestId('review-sheet');
  await expect(sheet.getByRole('heading', { name: 'Inbox', level: 2 })).toBeVisible();
  const tabs = sheet.getByRole('tab');
  await expect(tabs).toHaveText(['To review', /^News/]);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.getByTestId('news-tab-led')).toBeVisible();
  // The news tab: the changelog, and looking at it turns the light off everywhere.
  await tabs.nth(1).click();
  await expect(sheet.getByTestId('news-panel')).toBeVisible();
  await expect(sheet.getByTestId('news-using')).toContainText('You’re using ');
  await expect(sheet.getByTestId('news-tab-led')).toHaveCount(0);
  await expect(rail.getByTestId('news-led')).toHaveCount(0);
  await expect(rail.getByTestId('review-toggle')).toHaveAccessibleName('Inbox, 5 to review');
  await tabs.first().click();
  await expect(sheet.getByTestId('draft-card').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('the palette opens the Inbox on its tab: "To review" and "What’s new"', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?mock=demo#/?chat=titan');
  await page.getByTestId('composer-input').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('What’s new');
  await page.getByTestId('palette-item').first().click();
  const sheet = page.getByTestId('review-sheet');
  await expect(sheet.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.getByTestId('news-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('To review');
  await page.getByTestId('palette-item').first().click();
  await expect(sheet.getByRole('tab', { name: 'To review' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(sheet.getByTestId('draft-card').first()).toBeVisible();
});

test('phone: the Inbox key is one key with its word on the home, and Back closes its sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/');
  const key = page.getByTestId('toolbar').getByTestId('review-toggle');
  await expect(key).toContainText('Inbox');
  await expect(page.getByTestId('news-toggle')).toHaveCount(0);
  await expectNoSideScroll(page);
  // On the home its own close key closes the sheet; inside a page "Back" does, and nothing else.
  await key.click();
  await expect(page.getByTestId('review-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Close the Inbox' }).click();
  await expect(page.getByTestId('review-sheet')).toBeHidden();
  await page.evaluate(() => (window.location.hash = '#/impostazioni'));
  await key.click();
  await expect(page.getByTestId('review-sheet')).toBeVisible();
  await page.getByTestId('toolbar-back').click();
  await expect(page.getByTestId('review-sheet')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

type AppModule = {
  notify(
    text: string,
    tone: 'info' | 'error',
    extra: { fromEvent?: boolean; ms?: number; action?: { label: string; run: () => void } },
  ): void;
};

/** Queues two more messages behind the demo's own (through the app's store). */
async function queueMore(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/store/app.ts';
    const app = (await import(/* @vite-ignore */ path)) as AppModule;
    app.notify('The spending cap for today was reached: raise it to go on.', 'error', {
      fromEvent: true,
      ms: 600_000,
      action: { label: 'Raise the cap', run: () => {} },
    });
    app.notify('Rhea finished the report', 'info', {
      fromEvent: true,
      action: { label: 'Open', run: () => {} },
    });
  });
}

const apart = (a: { x: number; width: number }, b: { x: number; width: number }) =>
  a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5;

test('desktop: the notice lives inside the rail, in one line, and the page does not move', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('composer')).toBeVisible();
  // The demo opens with a notice of its own (a tool of GitHub was paused): the toast of the shell.
  const notice = page.getByTestId('notice');
  await expect(notice).toBeVisible();
  const n = (await notice.boundingBox())!;
  const rail = (await page.getByTestId('toolbar').boundingBox())!;
  // Inside the rail, whole, in a line (32 px) and with its tooltip and key.
  expect(n.y).toBeGreaterThanOrEqual(rail.y);
  expect(n.y + n.height).toBeLessThanOrEqual(rail.y + rail.height);
  expect(n.height).toBeLessThanOrEqual(34);
  await expect(notice).toHaveAttribute('title', /GitHub changed a tool/);
  await expect(notice.getByTestId('notice-action')).toHaveText('View');
  // Never over the Inbox, the status display or Stop.
  for (const id of ['review-toggle', 'status-display', 'kill']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(apart(n, b), `${id} is not covered by the notice`).toBe(true);
  }
  // The page starts where it always did, and there is no band.
  const card = (await page.locator('[data-content-card]').boundingBox())!;
  expect(card.y).toBe(52);
  await expect(page.getByTestId('notice-bar').getByTestId('notice')).toHaveCount(0);
  // Closing it moves nothing either.
  await notice.getByRole('button', { name: 'Close' }).click();
  await expect(notice).toHaveCount(0);
  expect((await page.locator('[data-content-card]').boundingBox())!.y).toBe(52);
});

test('desktop: with more notices in line the newest has a "+N" tile that opens them whole', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('notice')).toBeVisible();
  await queueMore(page);
  // The error comes first; the other two wait behind it.
  const notice = page.getByTestId('notice');
  await expect(notice).toContainText('The spending cap for today was reached');
  const more = notice.getByTestId('notice-more');
  await expect(more).toHaveText('+2');
  await expect(more).toHaveAccessibleName('2 more notices');
  await more.click();
  const pop = page.getByTestId('notice-popover');
  const rows = pop.getByTestId('notice-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('The spending cap for today was reached');
  await expect(pop).toContainText('GitHub changed a tool');
  await expect(pop).toContainText('Rhea finished the report');
  // Dismissing one from the list takes it out of the line; Escape closes only the list.
  await rows.nth(2).getByRole('button', { name: 'Close' }).click();
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(notice).toBeVisible();
  await expect(notice.getByTestId('notice-more')).toHaveText('+1');
});

test('desktop: without room for the sentence the rail keeps a light and "1 notice", with a popover', async ({
  page,
}) => {
  // Notes has its own keys, and at 1024 px they leave the message less than 240 px.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?mock=demo#/note');
  const key = page.getByTestId('notice-key');
  await expect(key).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await expect(key).toHaveAccessibleName('1 notice');
  await expect(key).toContainText('1 notice');
  const rail = (await page.getByTestId('toolbar').boundingBox())!;
  const k = (await key.boundingBox())!;
  expect(k.y + k.height).toBeLessThanOrEqual(rail.y + rail.height);
  // The title and the keys of the page keep their room.
  const title = page.getByTestId('toolbar').getByRole('heading', { name: 'Notes', level: 1 });
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expectNoSideScroll(page);
  await key.click();
  const pop = page.getByTestId('notice-popover');
  await expect(pop.getByTestId('notice-row')).toHaveCount(1);
  await expect(pop).toContainText('GitHub changed a tool: I’m keeping it paused until you decide.');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  // The key's own press goes through to the same list, and "Close" in it clears the notice.
  await key.click();
  await pop.getByRole('button', { name: 'Close' }).click();
  await expect(key).toHaveCount(0);
});

test('phone and narrow windows (under 900 px): the notice is a band under the rail', async ({
  page,
}) => {
  for (const [width, height] of [
    [390, 844],
    [899, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/?mock=demo#/?chat=titan');
    await expect(page.getByTestId('composer')).toBeVisible();
    const notice = page.getByTestId('notice');
    await expect(notice).toBeVisible();
    await expect(page.getByTestId('notice-bar').getByTestId('notice')).toHaveCount(1);
    const n = (await notice.boundingBox())!;
    const rail = (await page.getByTestId('toolbar').boundingBox())!;
    expect(n.y).toBeGreaterThanOrEqual(rail.y + rail.height - 1);
    const composer = (await page.getByTestId('composer').boundingBox())!;
    expect(n.y + n.height).toBeLessThanOrEqual(composer.y + 1);
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x + n.width).toBeLessThanOrEqual(width + 0.5);
    // In the flow: the page starts under it, so nothing of the page is covered.
    const card = (await page.locator('[data-content-card]').boundingBox())!;
    expect(card.y).toBeGreaterThanOrEqual(n.y + n.height - 1);
    await expect(page.getByTestId('kill')).toBeInViewport({ ratio: 1 });
  }
  // From 900 px it goes into the rail.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId('notice-bar').getByTestId('notice')).toHaveCount(0);
  await expect(
    page.getByTestId('toolbar').locator('[data-testid="notice"], [data-testid="notice-key"]'),
  ).toHaveCount(1);
});

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [390, 844],
] as const) {
  test(`the sidebar foot is a regular grid: every row is on the same columns (${width}×${height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?mock=demo#/');
    const tiles = page.getByTestId('sidebar-tiles').locator('a');
    await expect(tiles).toHaveCount(5);
    const boxes = await tiles.evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), w: Math.round(b.width), y: Math.round(b.y) };
      }),
    );
    // Same width everywhere, and the second row starts on the columns of the first.
    expect(new Set(boxes.map((b) => b.w)).size).toBe(1);
    expect(boxes[3]!.x).toBe(boxes[0]!.x);
    expect(boxes[4]!.x).toBe(boxes[1]!.x);
    expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes[1]!.y).toBe(boxes[0]!.y);
    expect(boxes[2]!.y).toBe(boxes[0]!.y);
  });
}

test('a very short window keeps one row of five icons', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/?mock=demo#/');
  const tiles = page.getByTestId('sidebar-tiles').locator('a');
  await expect(tiles).toHaveCount(5);
  const ys = await tiles.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().y)),
  );
  expect(new Set(ys).size).toBe(1);
});

test('Activity: one solid orange key, the other rows that wait have a normal key with the light', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/log');
  const keys = page.locator('[data-testid="review-row"], [data-testid="answer-question"]');
  await expect(keys.first()).toBeVisible();
  expect(await keys.count()).toBeGreaterThanOrEqual(3);
  const solid = page.locator(
    '[data-testid="review-row"].key-primary, [data-testid="answer-question"].key-primary',
  );
  await expect(solid).toHaveCount(1);
  // It is the first of the list (the newest that waits).
  const firstWaiting = page.locator('li').filter({ has: keys }).first();
  await expect(firstWaiting.locator('.key-primary')).toHaveCount(1);
  // The others keep the orange as a light, inside the key.
  const quiet = page.locator(
    '[data-testid="review-row"]:not(.key-primary), [data-testid="answer-question"]:not(.key-primary)',
  );
  expect(await quiet.count()).toBe((await keys.count()) - 1);
  for (let i = 0; i < (await quiet.count()); i++) {
    await expect(quiet.nth(i).locator('.led[data-tone="signal"]')).toHaveCount(1);
  }
});

test('the unlit digits of the clock are almost off (7%), the lit ones are not', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  const unlit = page.getByTestId('status-display').getByText('88:88');
  await expect(unlit).toBeVisible();
  const opacity = await unlit.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThanOrEqual(0.08);
});

test('a draft is told in words first; the diff is behind "Show changes", paths say ~ (F-14)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await page.getByTestId('review-toggle').click();
  const cards = page.locator('[data-testid="draft-card"][data-kind="docs"]');
  const card = cards.filter({ hasText: 'Iapetus wants to change the instructions' });
  await expect(card.getByTestId('draft-title')).toHaveText(
    'Iapetus wants to change the instructions of Saturday Social',
  );
  // The monster's own reason, in quotes; no diff and no file yet.
  await expect(card).toContainText('“I’m writing down how we name the files');
  await expect(card.getByTestId('docs-diff')).toHaveCount(0);
  const toggle = card.getByTestId('docs-changes-toggle');
  await expect(toggle).toHaveText(/^Show changes · \+\d+ −\d+$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveText('Hide changes');
  await expect(card.getByTestId('docs-diff')).toBeVisible();
  await expect(card).toContainText('CLAUDE.md');
  // The home folder is "~", never "/home/andrea/…" on screen; the full path is for screen readers.
  const shown = await card.getByTestId('path').locator('[aria-hidden="true"]').first().innerText();
  expect(shown.startsWith('~/')).toBe(true);
  expect(shown).not.toContain('/home/');
  // Warnings are never behind the key: the stale, third-party one shows them at once.
  const calypso = cards.filter({ hasText: 'Calypso wants to' });
  await expect(calypso.getByTestId('docs-stale')).toBeVisible();
  await expect(calypso.getByTestId('docs-tainted')).toBeVisible();
  await expect(calypso.getByTestId('docs-diff')).toHaveCount(0);
});
