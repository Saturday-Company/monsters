import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, showTechnicalDetails, test } from './fixtures.ts';

/*
 * The writing field and the monitor of the chat (docs/design.md, "The chat"): Stop in the place
 * of Send, the message that waits for the next step, the question bar docked on the composer,
 * the `/` and `@` menus, what can be done with a message, the context note and the
 * conversations of a chat.
 */

const STORE = '/src/store/app.ts';
let fed = 0;

/** Events as the stream brings them, after everything the demo has (their ids sort last). */
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

const mock = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ({ fn, args }) =>
      (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
        '__monstersMock'
      ]![fn]!(...args) as T,
    { fn, args },
  );

/** Answers the demo's open question with words: Titan goes on working. */
async function startWork(page: Page) {
  const input = page.getByTestId('composer-input');
  await input.fill('Plan the week for the newsletter');
  await input.press('Enter');
  await expect(page.getByTestId('composer-stop')).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test('Stop takes the place of Send while the monster works, and ends only its work (F-1)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const send = page.getByTestId('composer-send');
  await expect(send).toBeVisible();
  await expect(page.getByTestId('composer-stop')).toHaveCount(0);
  await startWork(page);
  const stop = page.getByTestId('composer-stop');
  // Same place as Send, red words; with nothing written there is no Send beside it.
  await expect(stop).toHaveAccessibleName('Stop Titan');
  await expect(stop).toHaveText('Stop');
  await expect(send).toHaveCount(0);
  // With words in the field both are there: the message waits for the monster's next step.
  const input = page.getByTestId('composer-input');
  await input.fill('and keep it short');
  await expect(stop).toBeVisible();
  await expect(send).toBeVisible();
  await expect(send).toHaveAccessibleName('Send: it will be read after this step');
  await input.fill('');
  // Esc in the field does not stop (too easy to hit): the key does.
  await input.press('Escape');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(send).toBeVisible();
  // The strip of the turn says who stopped it, in its closed sentence.
  await expect(
    page.getByTestId('receipt-summary').filter({ hasText: 'You stopped Titan' }),
  ).toHaveCount(1);
});

test('Ctrl+Shift+Backspace stops the work from the keyboard', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await startWork(page);
  await page.getByTestId('composer-input').focus();
  await page.keyboard.press('Control+Shift+Backspace');
  await expect(page.getByTestId('composer-stop')).toHaveCount(0);
  await expect(
    page.getByTestId('receipt-summary').filter({ hasText: 'You stopped Titan' }),
  ).toHaveCount(1);
});

test('a message written while the monster works says it will be read after this step', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  const run = 'r-queued-e2e';
  const usage = {
    agent: 'titan',
    runId: run,
    type: 'provider_usage',
    data: { provider: 'openrouter', model: 'm', inputTokens: 10, outputTokens: 10 },
  };
  await feed(page, [
    {
      agent: 'user',
      runId: run,
      type: 'message',
      data: { role: 'user', text: 'Check the tram', to: 'titan' },
    },
    { agent: 'titan', runId: run, type: 'run', data: { status: 'started' } },
    {
      agent: 'titan',
      runId: run,
      type: 'tool_call',
      data: { callId: 'a', tool: 'web_search', input: { query: 'tram 28' } },
    },
    {
      agent: 'user',
      runId: run,
      type: 'message',
      data: { role: 'user', text: 'and the metro too', to: 'titan' },
    },
  ]);
  const second = page.getByTestId('user-bubble').filter({ hasText: 'and the metro too' });
  await expect(second).toHaveAttribute('data-queued', 'true');
  const note = page.getByTestId('queued-note');
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText('Will read it after this step');
  // The step under way ends: not read yet. The next thing the monster does has read it.
  await feed(page, [usage]);
  await expect(note).toHaveCount(1);
  await feed(page, [
    {
      agent: 'titan',
      runId: run,
      type: 'tool_call',
      data: { callId: 'b', tool: 'web_search', input: { query: 'metro' } },
    },
  ]);
  await expect(note).toHaveCount(0);
  await expect(second).not.toHaveAttribute('data-queued', 'true');
});

test.describe('the question bar on the composer (F-4)', () => {
  test.use({ viewport: { width: 1024, height: 560 } });

  /** The demo's notice takes a strip of a low window: it is closed first. */
  const open = async (page: Page) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await page
      .getByTestId('notice')
      .getByRole('button', { name: 'Close' })
      .click({ timeout: 3000 })
      .catch(() => {});
    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    return card;
  };
  const scrollTop = (page: Page) =>
    page.getByTestId('chat-scroller').evaluate((el) => {
      el.scrollTop = 0;
    });

  test('shows the question with its keys and Show only while the card is out of sight', async ({
    page,
  }) => {
    const card = await open(page);
    const bar = page.getByTestId('question-bar');
    await expect(bar).toHaveCount(0);
    await scrollTop(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('question-bar-text')).toContainText(
      'Titan asks: Rhea found 5 tips on Lisbon. What tone should we give the posts?',
    );
    // On the composer, never over it or over the field: the bar ends where the field begins.
    const barBox = (await bar.boundingBox())!;
    const wellBox = (await page.locator('.composer-well').boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(wellBox.y + 0.5);
    const dockBox = (await page.getByTestId('composer-dock').boundingBox())!;
    expect(barBox.y).toBeGreaterThanOrEqual(dockBox.y - 0.5);
    // Keys A, B, C of at least 32 px; Show brings the card back and the bar goes.
    for (const letter of ['A', 'B', 'C']) {
      const key = bar.getByTestId(`question-bar-key-${letter}`);
      await expect(key).toBeVisible();
      expect((await key.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    }
    await bar.getByTestId('question-bar-show').click();
    await expect(card).toBeInViewport({ ratio: 0.5 });
    await expect(bar).toHaveCount(0);
  });

  test('its keys answer like the keypad', async ({ page }) => {
    const card = await open(page);
    await scrollTop(page);
    const bar = page.getByTestId('question-bar');
    await bar.getByTestId('question-bar-key-B').click();
    await expect(card).toHaveAttribute('data-status', 'answered');
    await expect(card).toContainText('You chose: Ironic');
    await expect(bar).toHaveCount(0);
  });

  test('one element for the answer in progress: no second line above the field', async ({
    page,
  }) => {
    await open(page);
    // The card in view: the bar is only the "Answering…" line, in the same element.
    const bar = page.getByTestId('question-bar');
    await expect(bar).toHaveCount(0);
    await page.getByTestId('composer-input').fill('A bit poetic');
    await expect(bar).toHaveCount(1);
    await expect(bar.getByTestId('composer-answering')).toContainText('Answering Titan’s question');
    // With the card out of sight too: still one bar, with the line and Show, not the keys.
    await scrollTop(page);
    await expect(bar).toHaveCount(1);
    await expect(bar.getByTestId('composer-answering')).toBeVisible();
    await expect(bar.getByTestId('question-bar-show')).toBeVisible();
    await expect(bar.getByTestId('question-bar-key-A')).toHaveCount(0);
  });
});

test('"/" opens the commands, "@" the monsters without the chat’s own', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const input = page.getByTestId('composer-input');
  await input.fill('/');
  const menu = page.getByTestId('slash-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(3);
  await expect(page.getByTestId('slash-newConversation')).toContainText('/new');
  await expect(page.getByTestId('slash-behind')).toContainText('/behind');
  await expect(page.getByTestId('slash-attach')).toContainText('/attach');
  // /stop only while the monster works; a command being typed is not an answer to the question.
  await expect(page.getByTestId('slash-stop')).toHaveCount(0);
  await expect(page.getByTestId('composer-answering')).toHaveCount(0);
  await input.fill('/ne');
  await expect(menu.getByRole('option')).toHaveCount(1);
  // Esc closes the menu and keeps the text.
  await input.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveValue('/ne');
  // A command by name, in English or Italian, and from the list.
  await input.fill('/behind');
  await input.press('Enter');
  await expect(page.getByTestId('agent-terminal')).toBeVisible();
  await expect(input).toHaveValue('');
  await page.keyboard.press('Escape');

  await input.fill('/nuova');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  // No dialog to confirm: the conversation starts over at once, the earlier ones stay in the list.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('chat-list')).toContainText('New conversation');
  await expect(input).toHaveValue('');

  await input.fill('@');
  const mentions = page.getByTestId('mention-list');
  await expect(mentions).toBeVisible();
  await expect(mentions.getByRole('option', { name: /Rhea/ })).toBeVisible();
  await expect(mentions.getByRole('option', { name: /Titan/ })).toHaveCount(0);
  await input.fill('@zz');
  await expect(mentions).toHaveCount(0);
  await expect(page.getByTestId('no-monster')).toHaveText('No monster called “zz”');
  await input.fill('@Rh');
  await expect(mentions.getByRole('option')).toHaveCount(1);
  await expect(page.getByTestId('no-monster')).toHaveCount(0);
});

test('/stop is in the commands while the monster works', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await startWork(page);
  const input = page.getByTestId('composer-input');
  await input.fill('/st');
  await expect(page.getByTestId('slash-stop')).toBeVisible();
  await input.press('Enter');
  await expect(page.getByTestId('composer-stop')).toHaveCount(0);
  await expect(
    page.getByTestId('receipt-summary').filter({ hasText: 'You stopped Titan' }),
  ).toHaveCount(1);
});

test('a message has its time and its keys under the pointer: copy, again, edit', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?mock=demo#/?chat=titan');
  const bubbles = page.getByTestId('user-bubble');
  await expect(bubbles.first()).toBeVisible();
  const last = bubbles.last();
  const frames = page.locator('.bubble-frame').filter({ has: page.getByTestId('user-bubble') });
  const tools = frames.last().getByTestId('bubble-tools');
  await expect(tools).toBeHidden();
  await last.scrollIntoViewIfNeeded();
  await last.hover();
  await expect(tools).toBeVisible();
  await expect(tools.getByTestId('bubble-time')).toHaveText(/^\d{1,2}:\d{2}/);
  // Keys of at least 32 px, named for tooltips and screen readers.
  for (const name of ['Copy', 'Again', 'Edit']) {
    const key = tools.getByRole('button', { name });
    expect((await key.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  const text = (await last.textContent())!.trim();
  await tools.getByRole('button', { name: 'Copy' }).click();
  await expect(tools.getByTestId('copy-message')).toHaveAttribute('data-copied', '');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  // Edit puts it back in the field; only the user's last message has it.
  await tools.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('composer-input')).toHaveValue(text);
  const first = frames.first();
  await bubbles.first().hover();
  await expect(first.getByRole('button', { name: 'Again' })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  // Again sends the same words once more.
  const before = await bubbles.count();
  await page.getByTestId('composer-input').fill('');
  await last.hover();
  await tools.getByRole('button', { name: 'Again' }).click();
  await expect(bubbles).toHaveCount(before + 1);
  await expect(bubbles.last()).toHaveText(text);
  // A monster's bubble copies its words too, but has no Again or Edit.
  const agentBubble = page.getByTestId('agent-bubble').first();
  const agentFrame = page
    .locator('.bubble-frame')
    .filter({ has: page.getByTestId('agent-bubble') })
    .first();
  await agentBubble.scrollIntoViewIfNeeded();
  await agentBubble.hover();
  await expect(agentFrame.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(agentFrame.getByRole('button', { name: 'Again' })).toHaveCount(0);
});

test('a code block says its language and has a Copy key', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await feed(page, [
    {
      agent: 'user',
      runId: 'r-code-e2e',
      type: 'message',
      data: { role: 'user', text: 'A script, please', to: 'titan' },
    },
    { agent: 'titan', runId: 'r-code-e2e', type: 'run', data: { status: 'started' } },
    {
      agent: 'titan',
      runId: 'r-code-e2e',
      type: 'message',
      data: {
        role: 'agent',
        text: 'Here:\n\n```bash\nfor f in *.md; do\n  echo "$f"\ndone\n```\n',
      },
    },
    { agent: 'titan', runId: 'r-code-e2e', type: 'run', data: { status: 'completed' } },
  ]);
  const block = page.getByTestId('code-block').last();
  await expect(block.getByTestId('code-lang')).toHaveText('bash');
  const key = block.getByTestId('copy-code');
  await expect(key).toHaveAccessibleName('Copy the code');
  expect(Math.round((await key.boundingBox())!.height)).toBeGreaterThanOrEqual(32);
  await key.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'for f in *.md; do\n  echo "$f"\ndone',
  );
});

test('the time shows at the head of a turn after 5 minutes of silence (F-10)', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  const gaps = page.getByTestId('time-gap');
  const base = await gaps.count();
  const turn = (n: number, at: number) => [
    {
      agent: 'user',
      runId: `r-gap-${n}`,
      ts: at,
      type: 'message',
      data: { role: 'user', text: `Question ${n}`, to: 'titan' },
    },
    { agent: 'titan', runId: `r-gap-${n}`, ts: at + 100, type: 'run', data: { status: 'started' } },
    {
      agent: 'titan',
      runId: `r-gap-${n}`,
      ts: at + 200,
      type: 'message',
      data: { role: 'agent', text: `Answer ${n}` },
    },
    {
      agent: 'titan',
      runId: `r-gap-${n}`,
      ts: at + 300,
      type: 'run',
      data: { status: 'completed' },
    },
  ];
  const t0 = Date.now();
  // Three minutes later: no time. Nine minutes after that: the time of the new turn.
  await feed(page, [...turn(1, t0), ...turn(2, t0 + 3 * 60_000)]);
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Question 2' })).toBeVisible();
  const afterNear = await gaps.count();
  await feed(page, turn(3, t0 + 12 * 60_000));
  await expect(page.getByTestId('user-bubble').filter({ hasText: 'Question 3' })).toBeVisible();
  expect(await gaps.count()).toBe(afterNear + 1);
  expect(afterNear - base).toBeLessThanOrEqual(1);
});

test('the monitor: the context meter only with the technical details, no sum of the run', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const monitor = page.getByTestId('chat-monitor');
  await expect(monitor).toBeVisible();
  await expect(monitor.getByTestId('context-key')).toHaveCount(0);
  await expect(page.getByTestId('chat-summary')).toHaveCount(0);
  // Keys of 40 px: the ones of the monitor and the conversations.
  for (const id of ['behind-the-scenes', 'conversations-key']) {
    expect((await monitor.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(40);
  }
});

test('with the technical details on, the context meter is back on the monitor', async ({
  page,
}) => {
  await showTechnicalDetails(page);
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-monitor').getByTestId('context-key')).toBeVisible();
  await expect(page.getByTestId('chat-summary')).toHaveCount(0);
});

test('a long conversation says so above the composer, in words, and can be put away', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(page.getByTestId('context-note')).toHaveCount(0);
  await mock(page, 'fillContext', 'titan', 0.65);
  const note = page.getByTestId('context-note');
  await expect(note).toHaveAttribute('data-level', 'long');
  await expect(note).toContainText(
    'This conversation is getting long — a new one keeps answers sharp.',
  );
  // Above the composer, not in the monitor.
  expect(await page.getByTestId('chat-monitor').getByTestId('context-note').count()).toBe(0);
  await expect(page.getByTestId('composer-dock').getByTestId('context-note')).toBeVisible();
  // Put away for this conversation: it stays away when the chat is opened again.
  await note.getByTestId('context-note-dismiss').click();
  await expect(note).toHaveCount(0);
  await page.goto('/?mock=demo#/?chat=rhea');
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'rhea');
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'titan');
  // Past the compaction mark the older messages are summarized: another, stronger sentence.
  await mock(page, 'fillContext', 'titan', 0.8);
  await expect(note).toHaveAttribute('data-level', 'full');
  await expect(note).toContainText('Older messages are summarized');
  await note.getByTestId('context-note-new').click();
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId('chat-list')).toContainText('New conversation');
});

test('the conversations of a chat: a list on the monitor and each one read-only', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const key = page.getByTestId('conversations-key');
  await expect(key).toHaveAccessibleName('Conversations');
  await key.click();
  const popover = page.getByTestId('conversations-list');
  await expect(popover).toBeVisible();
  // The current one on top; then the earlier ones, newest first, with their title and size.
  await expect(popover.getByTestId('conversation-current')).toContainText('Current conversation');
  const items = popover.getByTestId('conversation-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText(
    'Remind me what we decided for the Saturday newsletter',
  );
  await expect(items.first()).toContainText('1 message');
  await expect(items.last()).toContainText('Can you plan a weekend in Porto for two?');
  await expect(items.last()).toContainText('2 messages');
  for (const item of await items.all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  // Esc closes the list; the key opens it again.
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await key.click();
  await items.last().click();
  await expect(popover).toHaveCount(0);
  // The earlier conversation shows in the chat, with a band and the way back; nothing can be written.
  const band = page.getByTestId('earlier-band');
  await expect(band).toContainText('Earlier conversation · ');
  await expect(page.getByTestId('user-bubble').first()).toContainText('Porto');
  await expect(page.getByTestId('user-bubble')).toHaveCount(2);
  await expect(page.getByTestId('agent-bubble').first()).toContainText('direct flight');
  await expect(page.getByTestId('composer-input')).toBeDisabled();
  await expect(page.getByTestId('composer-input')).toHaveAttribute(
    'placeholder',
    'Earlier conversation · read only',
  );
  await expect(page.getByTestId('composer-send')).toBeDisabled();
  await expect(page.getByTestId('earlier-hint')).toBeVisible();
  // The buttons that act (Again, Edit) are not there; Copy is.
  const bubble = page.getByTestId('user-bubble').first();
  await bubble.hover();
  const frame = page
    .locator('.bubble-frame')
    .filter({ has: page.getByTestId('user-bubble') })
    .first();
  await expect(frame.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Again' })).toHaveCount(0);
  // Back to the current one.
  await band.getByTestId('earlier-back').click();
  await expect(band).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await expect(page.getByTestId('earlier-conversation')).toHaveCount(0);
  // Another chat has its own list.
  await page.goto('/?mock=demo#/?chat=dione');
  await page.getByTestId('conversations-key').click();
  await expect(page.getByTestId('conversation-item')).toHaveCount(1);
  await expect(page.getByTestId('conversation-item')).toContainText('three captions');
});

test.describe('a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the monsters’ bubbles take the whole width, with the avatar above (F-11)', async ({
    page,
  }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    const list = page.getByTestId('chat-list');
    await expect(list).toBeVisible();
    const column = (await list.boundingBox())!;
    const bubble = page.getByTestId('agent-bubble').first();
    await bubble.scrollIntoViewIfNeeded();
    const box = (await bubble.boundingBox())!;
    // No avatar indent: the bubble starts where the column does and fills it.
    expect(box.x - column.x).toBeLessThan(2);
    expect(box.width).toBeGreaterThan(column.width - 4);
    // The time is not under a pointer here: a tap on the bubble shows it, and its keys.
    const frame = page
      .locator('.bubble-frame')
      .filter({ has: page.getByTestId('agent-bubble') })
      .first();
    await expect(frame.getByTestId('bubble-tools')).toBeHidden();
    await bubble.tap({ position: { x: 24, y: 24 } });
    await expect(frame.getByTestId('bubble-tools')).toBeVisible();
    await expect(frame.getByTestId('bubble-time')).toHaveText(/^\d{1,2}:\d{2}/);
    // A tap elsewhere puts it away.
    await page.getByTestId('composer-input').tap();
    await expect(frame.getByTestId('bubble-tools')).toBeHidden();
  });

  test('rows of the chat are at least 32 px tall and the monitor keys 40', async ({ page }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await expect(page.getByTestId('chat-list')).toBeVisible();
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll(
        '[data-testid="chat-list"] button, [data-testid="chat-list"] [role="button"], [data-testid="chat-monitor"] button',
      )) {
        const r = el.getBoundingClientRect();
        const hidden = getComputedStyle(el).visibility === 'hidden' || !!el.closest('.sr-only');
        if (r.width === 0 || r.height === 0 || hidden) continue;
        const monitor = !!el.closest('[data-testid="chat-monitor"]');
        if (r.height < (monitor ? 40 : 32) - 0.5)
          out.push(`${el.getAttribute('data-testid') ?? el.tagName}: ${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});
