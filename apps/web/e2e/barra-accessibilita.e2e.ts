import type { Page } from '@playwright/test';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * The leftovers of waves A and B on the web (stream R2): the top rail keeps the page's title
 * whatever else it carries (the status display gives way first), the Inbox has its word on a
 * phone's home, a short window draws the sidebar's strips denser, the page has its name as the
 * document's title and a way to skip the rail, the focus survives a switch of language, and a
 * draft card whose press went through does not stay disabled for ever (W-39).
 */

const SEEN = 'monsters-news-seen';

type Mock = { failRequests: (match: string) => void; clearFailures: () => void };

/** The rows of the chat list that are wholly inside its scroll box. */
async function visibleRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector('[data-testid="chat-list-nav"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid="chat-row"]')].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= nav.top - 1 && b.bottom <= nav.bottom + 1;
    }).length;
  });
}

/** Lights the news of the Inbox (a version not yet seen), as after an update. */
const lightNews = (page: Page) => page.addInitScript((k) => localStorage.setItem(k, '0.0.1'), SEEN);

const truncated = (page: Page) =>
  page
    .getByTestId('toolbar')
    .getByRole('heading', { level: 1 })
    .evaluate((el) => el.scrollWidth > el.clientWidth);

for (const [width, height] of [
  [1280, 800],
  [1280, 720],
  [1100, 800],
  [900, 800],
  [768, 800],
] as const) {
  for (const [route, heading] of [
    ['#/automazioni', 'Automations'],
    ['#/note', 'Notes'],
  ] as const) {
    test(`the rail keeps the title of ${heading} whole at ${width}×${height} with the Inbox’s news light on (R2)`, async ({
      page,
    }) => {
      await lightNews(page);
      await page.setViewportSize({ width, height });
      await page.goto(`/?mock=demo${route}`);
      const rail = page.getByTestId('toolbar');
      await expect(rail.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      if (width >= 1100)
        await expect(rail.getByTestId('review-toggle')).toHaveAttribute('data-fresh');
      expect(await truncated(page)).toBe(false);
      // The keys of the page are all still in the rail, and the rail does not run over.
      await expectNoSideScroll(page);
      const kill = await rail.getByTestId('kill').boundingBox();
      expect(kill!.x + kill!.width).toBeLessThanOrEqual(width);
    });
  }
}

test('the status display gives way before the title: words from 1440 px, short below, a light under 1000 (R2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/?mock=demo#/automazioni');
  const status = page.getByTestId('status-display');
  await expect(status).toContainText('Titan asks');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(status).toContainText(/1 question/i);
  await expect(status).not.toContainText('Titan asks');
  await page.setViewportSize({ width: 960, height: 800 });
  await expect(status).not.toContainText(/question/i);
  await expect(status).toHaveAccessibleName(/Titan asks/);
});

test('at 1280×720 the sidebar shows six monsters, a short window draws them denser (R2, D-178)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('chat-list-nav')).toBeVisible();
  // The demo opens with a notice; in the rail (900 px and more) it takes no room from the rows: look at both.
  const withNotice = await visibleRows(page);
  expect(withNotice).toBeGreaterThanOrEqual(5);
  await page.getByTestId('notice').getByRole('button').last().click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await expect.poll(() => visibleRows(page)).toBeGreaterThanOrEqual(6);
  const row = (await page.getByTestId('chat-row').first().boundingBox())!;
  expect(row.height).toBeLessThan(60);
  // A tall window keeps the roomy strips.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(async () => (await page.getByTestId('chat-row').first().boundingBox())!.height)
    .toBeGreaterThan(64);
});

test('phone home: the Inbox says its word; inside a page the tray and its count are enough (R2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/');
  const key = page.getByTestId('toolbar').getByTestId('review-toggle');
  await expect(key).toContainText('Inbox');
  await expect(key.getByTestId('review-count')).toBeVisible();
  const kill = page.getByTestId('toolbar').getByTestId('kill');
  await expect(kill).toBeInViewport({ ratio: 1 });
  await expectNoSideScroll(page);
  await page.evaluate(() => (window.location.hash = '#/impostazioni'));
  await expect(
    page.getByTestId('toolbar').getByRole('heading', { name: 'Settings' }),
  ).toBeVisible();
  await expect(key).not.toContainText('Inbox');
  // A wide phone has room for the word inside a page too.
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(key).toContainText('Inbox');
  await expectNoSideScroll(page);
});

test('the window is named after the page, and a skip link comes first (W-39)', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page).toHaveTitle('Titan · Monsters');
  await page.evaluate(() => (window.location.hash = '#/impostazioni'));
  await expect(page).toHaveTitle('Settings · Monsters');
  await page.evaluate(() => (window.location.hash = '#/automazioni'));
  await expect(page).toHaveTitle('Automations · Monsters');

  // First in the tab order, hidden until it has the focus; it leads to the page, not past it.
  await page.reload();
  await expect(page.getByTestId('toolbar')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByTestId('skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText('Skip to the content');
  await expect(skip).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();

  // In the chat it leads to the message box.
  await page.evaluate(() => (window.location.hash = '#/?chat=titan'));
  await page.reload();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText('Skip to the chat');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('composer-input')).toBeFocused();
});

test('the title and the skip link follow the language (W-39)', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=generale');
  await page
    .getByRole('radiogroup', { name: 'Language' })
    .getByRole('radio', { name: 'Italiano' })
    .click();
  await expect(page).toHaveTitle('Impostazioni · Monsters');
  await expect(page.getByTestId('skip-link')).toHaveText('Vai al contenuto');
});

test('a draft card whose press went through gets its keys back if the list does not refresh (W-39)', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=cartella');
  const card = page.getByTestId('draft-card').filter({ hasText: 'Iapetus proposes' });
  await expect(card).toBeVisible();
  // The drafts cannot be read again: the confirmed card stays where it is.
  await page.evaluate(() =>
    (window as unknown as { __monstersMock: Mock }).__monstersMock.failRequests('GET /api/drafts'),
  );
  await card.getByTestId('draft-confirm').click();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await expect(card.getByTestId('draft-confirm')).toBeDisabled();
  await page.clock.runFor(7000);
  await expect(card).not.toHaveAttribute('aria-busy', 'true');
  await expect(card.getByTestId('draft-confirm')).toBeEnabled();
});
