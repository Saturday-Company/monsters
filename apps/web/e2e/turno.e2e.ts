import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, test } from './fixtures.ts';

/*
 * The turn (docs/design.md, "The chat"; store/turn.ts): the request, the work in one strip, the
 * reply with its files; in the column only what must be read or asks for an action. Plus the
 * transcript fixes that come with it: "New messages" only for new items (F-3), a hidden live
 * region for the screen reader (F-8), the first suggestions only on an empty chat (F-12).
 */

const STORE = '/src/store/app.ts';
let fed = 0;

/** An event of the core, after everything the demo has (its id sorts last). */
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

const say = (text: string, extra: Record<string, unknown> = {}) => ({
  agent: 'titan',
  runId: 'r-turn-e2e',
  type: 'message',
  data: { role: 'agent', text, ...extra },
});

test.use({ viewport: { width: 1440, height: 900 } });

test('a turn reads as a conversation: the strip between the request and the reply', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const list = page.getByTestId('chat-list');
  await expect(list).toBeVisible();
  // No service lines between the seams in the column: the work is in each turn's strip.
  await expect(list.getByTestId('delegation')).toHaveCount(0);
  await expect(list.getByTestId('instinct-line')).toHaveCount(0);
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  const turn = list.locator('[data-testid="turn"][data-run="run_seed_lisbon"]');
  // In order: your request, the strip under the monster's screen, the reply with its file inside.
  const order = await turn.evaluate((el) =>
    [...el.querySelectorAll('[data-testid]')]
      .map((n) => n.getAttribute('data-testid'))
      .filter((id) =>
        ['user-bubble', 'work-strip', 'agent-bubble', 'turn-attachments', 'question-card'].includes(
          id ?? '',
        ),
      ),
  );
  expect(order).toEqual([
    'user-bubble',
    'work-strip',
    'agent-bubble',
    'turn-attachments',
    'question-card',
  ]);
  // The turn still at work lives at the bottom, without a second "at work" bubble.
  const live = list.locator('[data-testid="work-strip"][data-alive="true"]');
  await expect(live).toHaveCount(1);
  await expect(live.getByTestId('strip-now')).toHaveText(
    'Asking Rhea · Searching “tram 28 weekend schedule”',
  );
  await expect(page.getByTestId('working-row')).toHaveCount(0);
  // F-12: no first suggestions nor "Tell me more about you" after a reply.
  await expect(page.getByTestId('suggestions')).toHaveCount(0);
  await expect(page.getByTestId('first-steps')).toHaveCount(0);
});

test('a strip that ends closes by itself; one the user opened stays open (F-6)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await feed(page, [
    {
      agent: 'user',
      runId: 'r-turn-e2e',
      type: 'message',
      data: { role: 'user', text: 'Check the tram', to: 'titan' },
    },
    { agent: 'titan', runId: 'r-turn-e2e', type: 'run', data: { status: 'started' } },
    {
      agent: 'titan',
      runId: 'r-turn-e2e',
      type: 'tool_call',
      data: { callId: 'a', tool: 'web_search', input: { query: 'tram 28' } },
    },
  ]);
  const strip = page.locator('[data-testid="work-strip"][data-run="r-turn-e2e"]');
  await expect(strip).toHaveAttribute('data-alive', 'true');
  await expect(strip.getByTestId('strip-now')).toHaveText('Searching “tram 28”');
  await feed(page, [
    say('The tram runs every 12 minutes.'),
    { agent: 'titan', runId: 'r-turn-e2e', type: 'run', data: { status: 'completed' } },
  ]);
  await expect(strip).toHaveAttribute('data-alive', 'false');
  await expect(strip).toHaveAttribute('data-open', 'false');
  await expect(strip.getByTestId('receipt-summary')).toContainText('1 web search');
  // Every receipt of the chat is closed: none stays open over the others.
  await expect(page.locator('[data-testid="work-strip"][data-open="true"]')).toHaveCount(0);
  await strip.getByRole('button', { expanded: false }).click();
  await expect(strip).toHaveAttribute('data-open', 'true');
  await expect(strip.getByTestId('strip-step')).toContainText('Searched “tram 28”');
});

test('"New messages" only for new items, with their number (F-3)', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const scroller = page.getByTestId('chat-scroller');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await scroller.evaluate((el) => (el.scrollTop = 0));
  // The chat learns it is scrolled up from its scroll event, a frame later.
  await page.waitForTimeout(200);
  // A reply being written (a new item), then more chunks of it: one new message, not more.
  await feed(page, [say('First words', { partial: true })]);
  const jump = page.getByTestId('new-messages');
  await expect(jump).toHaveText('1 new message');
  await feed(page, [say(' and more words', { partial: true })]);
  await expect(jump).toHaveText('1 new message');
  // Back at the bottom it goes; a chunk of what was seen does not bring it back.
  await jump.click();
  await expect(jump).toHaveCount(0);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  // The chat learns it is scrolled up from its scroll event, a frame later.
  await page.waitForTimeout(200);
  await feed(page, [say(' and the end', { partial: true })]);
  await page.waitForTimeout(300);
  await expect(jump).toHaveCount(0);
});

test('the screen reader hears the finished replies, not the whole transcript (F-8)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  // The transcript is not a live region any more.
  await expect(page.locator('[data-testid="chat-scroller"] [aria-live]')).toHaveCount(1);
  const region = page.getByTestId('chat-announce');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText('');
  await feed(page, [say('Half a', { partial: true })]);
  await page.waitForTimeout(300);
  await expect(region).toHaveText('');
  await feed(page, [say('Half a reply, now whole.')]);
  await expect(region).toHaveText('Titan: Half a reply, now whole.');
});
