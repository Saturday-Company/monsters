import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, holdMock, releaseMock, test } from './fixtures.ts';

/*
 * A long chat (docs/design.md, "The chat"; stream J): past `VIRTUAL_FROM` rows the transcript
 * renders only the rows near the screen (VirtualList.tsx), and still opens at the bottom, keeps
 * the place when a page of earlier messages comes in above, follows a reply that streams at the
 * bottom, brings a far question's card in with "Show", and counts what is new while scrolled
 * up. `?mockChat=N` seeds N turns of mixed content into Titan's chat. Plus the small leftovers
 * of wave H: "Again" on the user's last message of a turn, the long press, the 32 px links.
 */

const STORE = '/src/store/app.ts';
let fed = 0;

/** Events of the core, after everything the demo has (their ids sort last). */
function feed(page: Page, events: Record<string, unknown>[]) {
  return page.evaluate(
    async ({ src, events }) => {
      const { ingest } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
      ingest(events as unknown as Parameters<(typeof AppStore)['ingest']>[0]);
    },
    {
      src: STORE,
      events: events.map((e) => ({
        id: `7ZZZZZZZZZ${String(++fed).padStart(16, '0')}`,
        ts: Date.now(),
        parentId: null,
        ...e,
      })),
    },
  );
}

/** The scroller's numbers. */
const where = (page: Page) =>
  page.getByTestId('chat-scroller').evaluate((el) => ({
    top: el.scrollTop,
    fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    rows: el.querySelectorAll('[data-testid="chat-list"] > li').length,
    size: Number(
      el.querySelector('[data-testid="chat-list"] > li')?.getAttribute('aria-setsize') ?? 0,
    ),
  }));

/** The first turn that starts on screen, and where it sits (a day's separator may go). */
const firstSeen = (page: Page) =>
  page.getByTestId('chat-scroller').evaluate((el) => {
    const edge = el.getBoundingClientRect().top;
    for (const li of el.querySelectorAll<HTMLElement>('[data-testid="chat-list"] > li')) {
      const r = li.getBoundingClientRect();
      if (li.dataset['vkind'] === 'turn' && r.top >= edge)
        return { key: li.dataset['vkey'] ?? '', y: r.top };
    }
    return null;
  });

const LONG = '/?mock=demo&mockChat=400#/?chat=titan';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('a long chat renders only the rows near the screen', () => {
  test('it opens at the bottom with a bounded DOM', async ({ page }) => {
    await page.goto(LONG);
    await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
    await expect(page.locator('[data-testid="chat-list"] [data-question]')).toBeVisible();
    const w = await where(page);
    expect(w.fromBottom).toBeLessThan(4);
    expect(w.rows).toBeLessThan(40);
    expect(w.size).toBeGreaterThan(w.rows);
    const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
    expect(nodes).toBeLessThan(2500);
  });

  test('scrolling to the top loads earlier messages and keeps the place', async ({ page }) => {
    await page.goto(LONG);
    await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
    // The chat's first page of its own history is in when the earlier messages key shows.
    await expect(page.getByTestId('older-messages')).toHaveText('Earlier messages');
    const before = (await where(page)).size;
    // The page waits in the mock until the place is noted.
    await holdMock(page);
    await page.getByTestId('chat-scroller').evaluate((el) => (el.scrollTop = 0));
    await expect(page.getByTestId('older-messages')).toHaveText(/Loading/);
    await page.waitForTimeout(300);
    const seen = await firstSeen(page);
    expect(seen).not.toBeNull();
    await releaseMock(page);
    await expect
      .poll(async () => (await where(page)).size, { timeout: 10_000 })
      .toBeGreaterThan(before);
    await page.waitForTimeout(300);
    // The row the user was reading has not moved, with the earlier rows above it.
    const row = page.locator(`[data-testid="chat-list"] > li[data-vkey="${seen!.key}"]`);
    const after = await row.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.y - seen!.y)).toBeLessThan(8);
    expect((await where(page)).top).toBeGreaterThan(1000);
  });

  test('a reply streaming at the bottom keeps the chat at the bottom', async ({ page }) => {
    await page.goto(LONG);
    await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
    const run = 'r-long-stream';
    await feed(page, [
      {
        agent: 'user',
        runId: run,
        type: 'message',
        data: { role: 'user', text: 'Summarise the week.', to: 'titan', channel: 'ui' },
      },
    ]);
    for (let i = 0; i < 8; i++) {
      await feed(page, [
        {
          agent: 'titan',
          runId: run,
          type: 'message',
          data: {
            role: 'agent',
            text: `Line ${i} of a long reply, with enough words to wrap in the bubble.\n\n`,
            partial: true,
          },
        },
      ]);
      await page.waitForTimeout(120);
      expect((await where(page)).fromBottom).toBeLessThan(4);
    }
    await expect(page.getByTestId('agent-bubble').last()).toContainText('Line 7 of a long reply');
    await expect(page.getByTestId('agent-bubble').last()).toBeInViewport();
  });

  test('"Show" on the question bar brings a far card in and focuses it', async ({ page }) => {
    await page.goto(LONG);
    await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
    const scroller = page.getByTestId('chat-scroller');
    // Far up: the card's row is not even rendered.
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight / 3));
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="chat-list"] [data-question]')).toHaveCount(0);
    await page.getByTestId('question-bar-show').click();
    const card = page.locator('[data-testid="chat-list"] [data-question]');
    await expect(card).toBeInViewport();
    await expect(card.locator('button').first()).toBeFocused();
    await expect(page.getByTestId('question-bar-show')).toHaveCount(0);
  });

  test('To review brings a far question of the chat in', async ({ page }) => {
    await page.goto(LONG);
    await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
    await page.getByTestId('chat-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight / 3));
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="chat-list"] [data-question]')).toHaveCount(0);
    await page.getByTestId('review-toggle').click();
    await page
      .getByTestId('pending-question')
      .filter({ hasText: 'What tone should we give the posts?' })
      .click();
    await expect(page.locator('[data-testid="chat-list"] [data-question]')).toBeInViewport();
  });

  test('scrolled far up, a new reply counts as new and the jump goes to it', async ({ page }) => {
    await page.goto(LONG);
    await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
    const scroller = page.getByTestId('chat-scroller');
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
    await page.waitForTimeout(300);
    await feed(page, [
      {
        agent: 'titan',
        runId: 'r-long-new',
        type: 'message',
        data: { role: 'agent', text: 'Something new at the bottom.' },
      },
    ]);
    const jump = page.getByTestId('new-messages');
    await expect(jump).toHaveText('1 new message');
    await jump.click();
    await expect(
      page.getByTestId('chat-list').getByText('Something new at the bottom.'),
    ).toBeInViewport();
    await expect(jump).toHaveCount(0);
  });
});

test('"Again" only on the user’s last message of a turn', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  const run = 'r-again';
  // Two messages in one run: the second joined the work of the first.
  await feed(page, [
    {
      agent: 'user',
      runId: run,
      type: 'message',
      data: { role: 'user', text: 'First request', to: 'titan', channel: 'ui' },
    },
    { agent: 'titan', runId: run, type: 'message', data: { role: 'agent', text: 'On it.' } },
    {
      agent: 'user',
      runId: run,
      type: 'message',
      data: { role: 'user', text: 'And one more thing', to: 'titan', channel: 'ui' },
    },
  ]);
  const frame = (text: string) =>
    page.locator('.bubble-frame').filter({ has: page.getByText(text, { exact: true }) });
  await frame('First request').hover();
  await expect(frame('First request').getByTestId('copy-message')).toBeVisible();
  await expect(frame('First request').getByTestId('message-again')).toHaveCount(0);
  await frame('And one more thing').hover();
  await expect(frame('And one more thing').getByTestId('message-again')).toBeVisible();
});

test('the links of note names in a chat have a 32 px target', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  // A note named in a reply (a chip), and a note in the open strip of the turn that touched it.
  await feed(page, [
    {
      agent: 'titan',
      runId: 'r-notes',
      type: 'message',
      data: { role: 'agent', text: 'Saved in [[Lisbon tips]].' },
    },
  ]);
  const chip = page.getByTestId('note-chip').last();
  await expect(chip).toBeVisible();
  const target = (el: Element) =>
    Math.max(el.getBoundingClientRect().height, parseFloat(getComputedStyle(el, '::after').height));
  expect(await chip.evaluate(target)).toBeGreaterThanOrEqual(32);
  const strips = page.locator('[data-testid="work-strip"]');
  const count = await strips.count();
  for (let i = 0; i < count; i++) {
    const strip = strips.nth(i);
    if ((await strip.getAttribute('data-open')) !== 'true')
      await strip.locator('button[aria-expanded]').first().click();
    const notes = strip.getByTestId('receipt-note');
    if ((await notes.count()) === 0) continue;
    expect(await notes.first().evaluate(target)).toBeGreaterThanOrEqual(32);
    return;
  }
  throw new Error('no strip with a note in the demo');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a long press on a bubble opens its keys', async ({ page }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await expect(page.getByTestId('chat-list')).toBeVisible();
    const frame = page
      .locator('.bubble-frame')
      .filter({ has: page.getByTestId('agent-bubble') })
      .first();
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.getByTestId('bubble-tools')).toBeHidden();
    const bubble = frame.getByTestId('agent-bubble');
    const box = (await bubble.boundingBox())!;
    const at = { clientX: box.x + 24, clientY: box.y + 20, pointerType: 'touch', bubbles: true };
    await bubble.dispatchEvent('pointerdown', at);
    await page.waitForTimeout(550);
    await expect(frame.getByTestId('bubble-tools')).toBeVisible();
    // Lifting the finger leaves it open (a short tap would have toggled it).
    await bubble.dispatchEvent('pointerup', at);
    await expect(frame.getByTestId('bubble-tools')).toBeVisible();
    // A finger that moves is a scroll, not a long press.
    await page.getByTestId('composer-input').tap();
    await expect(frame.getByTestId('bubble-tools')).toBeHidden();
    await bubble.dispatchEvent('pointerdown', at);
    await bubble.dispatchEvent('pointermove', { ...at, clientY: at.clientY + 40 });
    await page.waitForTimeout(550);
    await expect(frame.getByTestId('bubble-tools')).toBeHidden();
  });
});
