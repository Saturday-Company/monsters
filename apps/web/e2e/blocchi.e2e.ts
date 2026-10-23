import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, expectNoSideScroll, holdMock, releaseMock, test } from './fixtures.ts';

/*
 * Drawn blocks in the chat (D-162): a reply with a ```ui fence of OpenUI Lang shows a table, key
 * numbers and charts (our own SVG); a block that does not parse shows its text and says so.
 * Buttons are suggested replies: a tap sends the label as the user's message, once. `SCREENSHOTS=1
 * SCREENSHOTS_DIR=<folder>` also writes the pictures, light and dark, 1440 and 390 px.
 */

const STORE = '/src/store/app.ts';
const OUT = `${(process.env['SCREENSHOTS_DIR'] ?? '/tmp/blocchi-ui').replace(/\/$/, '')}/`;
const shots = !!process.env['SCREENSHOTS'];

let fed = 0;

/**
 * An id that sorts by time like the core's own (the store orders the log by id): for a reply that
 * must stay before the events that come after it, such as the message a tap sends. The default
 * ids sort last of all, which suits the replies that are only looked at.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function idAt(ts: number, n: number): string {
  let time = '';
  for (let t = ts, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = `${CROCKFORD[t % 32]}${time}`;
  return `${time}${String(n).padStart(16, '0')}`;
}

const reply = (
  page: Page,
  text: string,
  opts: { partial?: boolean; run?: string; ordered?: boolean } = {},
) => {
  const id = ++fed;
  const ts = Date.now();
  return page.evaluate(
    async ({ src, text, id, ts, partial, run }) => {
      const { ingest } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
      ingest([
        {
          id,
          ts,
          runId: run ?? `r-blocks-${id}`,
          parentId: null,
          agent: 'titan',
          type: 'message',
          data: { role: 'agent', text, ...(partial ? { partial: true } : {}) },
        },
      ] as Parameters<(typeof AppStore)['ingest']>[0]);
    },
    {
      src: STORE,
      text,
      id: opts.ordered ? idAt(ts, id) : `7ZZZZZZZZZ${String(id).padStart(16, '0')}`,
      ts,
      partial: !!opts.partial,
      run: opts.run,
    },
  );
};

const NUMBERS = `Here is how the month went.

\`\`\`ui
root = Block([stats, table, bars, trend, split])
stats = Stats([Stat("Revenue", "€48.2k", "+12%", "up"), Stat("Orders", "1,284", "-3%", "down"), Stat("Refunds", "17", "same as March", "flat")])
table = Table(["Product", "Units", "Revenue"], [["Espresso beans", 420, 5880], ["Filter pack", 311, 3421.5], ["Burr grinder", 38, 4560]], "Top sellers")
bars = BarChart(["Jan", "Feb", "Mar", "Apr"], [{label: "2025", values: [12, 18, 15, 22]}, {label: "2026", values: [14, 21, 19, 27]}], "Sales by month", "k€")
trend = LineChart(["W1", "W2", "W3", "W4", "W5", "W6"], [{label: "Visits", values: [320, 410, 380, 520, 610, 580]}, {label: "Signups", values: [24, 31, 29, 44, 52, 47]}], "Traffic")
split = Donut([{label: "Online", value: 58}, {label: "Shop", value: 31}, {label: "Wholesale", value: 11}], "Channels", "%")
\`\`\`

Online is growing fastest.`;

const PLAN = `Two ways to go, and what to do next.

\`\`\`ui
root = Block([cmp, steps, todo, when, note, card])
cmp = Compare([Option("Plan A", ["Cheaper at first", "Fixed price for two years"], "Good if you stay", false), Option("Plan B", ["Includes support", "Cancel any month", "Faster setup"], "Best for a small team", true)], "Hosting offers")
steps = Steps([Step("Sign the contract", "Both parties", "done"), Step("Move the data", "About two days", "doing"), Step("Switch the domain", "Friday morning", "todo")], "Migration")
todo = Checklist([{text: "Back up the old site", done: true}, {text: "Tell the clients", done: false}], "Before Friday")
when = Timeline([{date: "Mon 3", label: "Kick-off", detail: "Call at 10:00"}, {date: "Fri 7", label: "Go live"}], "Dates")
note = Callout("Prices are before VAT.", "warning")
card = Card("Decision", "Go with Plan B unless the budget changes.", "Open")
\`\`\``;

const NEXT = `Metricool fits best; here is where we can go from here.

\`\`\`ui
root = Block([note, next])
note = Callout("Metricool covers scheduling and reports for the three networks.", "info")
next = Buttons([Button("Approfondisci Metricool", true), Button("Prepara la nota con i passi"), Button("Confronta anche Buffer")])
\`\`\``;

const BROKEN = `Here you go.

\`\`\`ui
this is not a block at all
\`\`\``;

test.use({ viewport: { width: 1440, height: 900 } });

/** The demo opens with a question of Titan: stopping and resuming closes it (as in flows.e2e.ts). */
async function expireDemoQuestion(page: Page): Promise<void> {
  await expect(page.getByTestId('question-card').first()).toHaveAttribute('data-status', 'open');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('question-card').first()).toHaveAttribute('data-status', 'expired');
}

test('a reply with a ui block draws the table, the key numbers and the charts', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await reply(page, NUMBERS);
  const block = page.getByTestId('ui-block').last();
  await expect(block).toBeVisible();
  // The prose around the block is still prose, and the source never shows.
  await expect(page.getByTestId('agent-bubble').last()).toContainText('Online is growing fastest.');
  await expect(page.getByTestId('agent-bubble').last()).not.toContainText('root = Block');

  const stats = block.getByTestId('ui-stat');
  await expect(stats).toHaveCount(3);
  await expect(stats.nth(0)).toContainText('€48.2k');
  await expect(stats.nth(1)).toContainText('-3%');
  await expect(stats.nth(1)).toContainText('(down)');

  const table = block.getByTestId('ui-table');
  await expect(table.getByRole('columnheader')).toHaveText(['Product', 'Units', 'Revenue']);
  await expect(table.locator('tbody tr')).toHaveCount(3);
  // Numbers are written the reader's way and sit on the right.
  await expect(table.locator('tbody tr').nth(1).getByRole('cell').nth(2)).toHaveText('3,421.5');
  await expect(table.locator('tbody tr').nth(1).getByRole('cell').nth(2)).toHaveCSS(
    'text-align',
    'right',
  );

  const bars = block.getByTestId('ui-bar-chart');
  await expect(bars.locator('svg[role="img"]')).toHaveAccessibleName(
    /^Bar chart: Sales by month\. 4 categories\./,
  );
  await expect(bars.getByTestId('ui-bar')).toHaveCount(8);
  await expect(bars.getByTestId('ui-legend')).toContainText('2026');
  await expect(bars.locator('title').first()).toHaveText('Jan · 2025: 12 k€');

  const line = block.getByTestId('ui-line-chart');
  await expect(line.locator('svg[role="img"]')).toHaveAccessibleName(/^Line chart: Traffic\./);
  await expect(line.getByTestId('ui-line')).toHaveCount(2);

  const donut = block.getByTestId('ui-donut');
  await expect(donut.getByTestId('ui-slice')).toHaveCount(3);
  await expect(donut.getByTestId('ui-legend')).toContainText('Wholesale');
  await expect(donut.getByTestId('ui-legend')).toContainText('58%');

  // The same page, at a phone's width: nothing pushes the window sideways, the charts scale.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
  const w = await bars
    .locator('svg[role="img"]')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(w).toBeLessThan(390);
  expect(w).toBeGreaterThan(150);
});

test('comparisons, steps, checklists, timelines, cards and callouts', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await reply(page, PLAN);
  const block = page.getByTestId('ui-block').last();
  const options = block.getByTestId('ui-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(1)).toHaveAttribute('data-best', 'true');
  await expect(options.nth(1)).toContainText('Recommended');
  await expect(options.nth(0)).not.toContainText('Recommended');
  const steps = block.getByTestId('ui-step');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAttribute('data-status', 'done');
  await expect(steps.nth(1)).toContainText('(In progress)');
  const todo = block.getByTestId('ui-checklist');
  await expect(todo.getByRole('checkbox')).toHaveCount(2);
  await expect(todo.getByRole('checkbox').first()).toBeChecked();
  await expect(todo.getByRole('checkbox').first()).toBeDisabled();
  await expect(block.getByTestId('ui-timeline')).toContainText('Go live');
  await expect(block.getByTestId('ui-callout')).toContainText('Prices are before VAT.');
  await expect(block.getByTestId('ui-card')).toContainText('Open');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
});

test('a block that does not parse shows its text and says so', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await reply(page, BROKEN);
  const fallback = page.getByTestId('ui-block-fallback').last();
  await expect(fallback).toContainText('this is not a block at all');
  await expect(fallback).toContainText('Couldn’t draw this block');
  await expect(page.getByTestId('ui-block')).toHaveCount(0);
});

test('while it streams: a skeleton, then the partial block, never the source', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  const run = 'r-streaming';
  await reply(page, 'Numbers:\n\n```ui\nro', { partial: true, run });
  const bubble = page.getByTestId('agent-bubble').last();
  await expect(bubble).toHaveAttribute('data-streaming', 'true');
  await expect(bubble.getByTestId('ui-block-skeleton')).toBeVisible();
  await expect(bubble).not.toContainText('root');
  await reply(page, 'ot = Block([t])\nt = Table(["A", "B"], [["x", 1], ["y", 2]])\n', {
    partial: true,
    run,
  });
  await expect(bubble.getByTestId('ui-table')).toBeVisible();
  await expect(bubble.getByTestId('ui-block')).toHaveAttribute('data-streaming', 'true');
  await expect(bubble).not.toContainText('root');
  // The final message closes the fence; the drawing stays, drawn once.
  await reply(
    page,
    'Numbers:\n\n```ui\nroot = Block([t])\nt = Table(["A", "B"], [["x", 1], ["y", 2]])\n```',
    {
      run,
    },
  );
  await expect(bubble).toHaveAttribute('data-streaming', 'false');
  await expect(bubble.getByTestId('ui-table')).toHaveCount(1);
  await expect(bubble.getByTestId('ui-block-skeleton')).toHaveCount(0);
  await expect(bubble.getByTestId('ui-block')).not.toHaveAttribute('data-streaming', 'true');
});

test('the agent terminal draws blocks too, on its black screen', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await reply(page, NUMBERS, { run: 'r-terminal' });
  await expect(page.getByTestId('ui-block').last()).toBeVisible();
  await page
    .getByRole('button', { name: /^Behind the scenes of Titan/ })
    .last()
    .click();
  const term = page.getByTestId('agent-terminal');
  const block = term.getByTestId('ui-block');
  await expect(block).toBeVisible();
  await expect(block.getByTestId('ui-stat')).toHaveCount(3);
  await expect(term.locator('.ui-root[data-screen="true"]')).toHaveCount(1);
  if (shots) {
    mkdirSync(OUT, { recursive: true });
    await block.scrollIntoViewIfNeeded();
    await term.screenshot({ path: `${OUT}terminal.png` });
  }
});

test('buttons: a tap sends the visible label as the user’s message, once, and closes them', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await reply(page, NEXT, { ordered: true });
  const bubble = page.getByTestId('agent-bubble').last();
  const buttons = bubble.getByTestId('ui-button');
  await expect(buttons).toHaveText([
    'Approfondisci Metricool',
    'Prepara la nota con i passi',
    'Confronta anche Buffer',
  ]);
  await expect(buttons.nth(0)).toHaveClass(/key-primary/);
  await expect(buttons.nth(1)).not.toHaveClass(/key-primary/);
  // The monster still waits for the answer to its question: the composer answers that, not a tap.
  await expect(bubble.getByTestId('ui-buttons')).toHaveAttribute('data-gate', 'question');
  for (const b of await buttons.all()) await expect(b).toHaveAttribute('aria-disabled', 'true');
  await expect(buttons.first()).toHaveAttribute('title', 'Answer the question first');
  const sent = page.getByTestId('user-bubble');
  const before = await sent.count();
  await buttons.first().click({ force: true });
  await expect(sent).toHaveCount(before);

  await expireDemoQuestion(page);
  await expect(bubble.getByTestId('ui-buttons')).toHaveAttribute('data-gate', 'open');
  for (const b of await buttons.all()) await expect(b).not.toHaveAttribute('aria-disabled', 'true');
  await expect(buttons.nth(1)).toHaveAttribute('title', 'Sends: “Prepara la nota con i passi”');

  // Hold the mock's work: after the tap we look at the chat, not at what the monster does next.
  await holdMock(page);
  await buttons.nth(1).click();
  // Exactly the label, as a message of the user, shown like a typed one.
  await expect(sent.last()).toHaveText('Prepara la nota con i passi');
  await expect(sent).toHaveCount(before + 1);
  // Every button of the block closes, with the reason; a second tap sends nothing.
  await expect(bubble.getByTestId('ui-buttons')).toHaveAttribute('data-gate', 'answered');
  for (const b of await buttons.all()) {
    await expect(b).toHaveAttribute('aria-disabled', 'true');
    await expect(b).toHaveAttribute('title', 'You already replied after this message');
  }
  await buttons.first().click({ force: true });
  await expect(sent).toHaveCount(before + 1);
  await releaseMock(page);
  await expect(sent).toHaveCount(before + 1);
  await expect(bubble.getByTestId('ui-buttons')).toHaveAttribute('data-gate', 'answered');
});

test('buttons: shut while the reply streams, open when it is final', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expireDemoQuestion(page);
  const run = 'r-buttons-streaming';
  const head =
    'Next steps:\n\n```ui\nroot = Block([b])\nb = Buttons([Button("Approfondisci Metricool", true), ';
  await reply(page, `${head}Button("Prepara la nota"`, { partial: true, run, ordered: true });
  const bubble = page.getByTestId('agent-bubble').last();
  await expect(bubble).toHaveAttribute('data-streaming', 'true');
  const buttons = bubble.getByTestId('ui-button');
  await expect(buttons.first()).toHaveText('Approfondisci Metricool');
  for (const b of await buttons.all()) {
    await expect(b).toHaveAttribute('aria-disabled', 'true');
    await expect(b).toHaveAttribute('title', 'Wait for the reply to finish');
  }
  const sent = page.getByTestId('user-bubble');
  const before = await sent.count();
  await buttons.first().click({ force: true });
  await expect(sent).toHaveCount(before);
  await reply(page, `${head}Button("Prepara la nota")])\n\`\`\``, { run, ordered: true });
  await expect(bubble).toHaveAttribute('data-streaming', 'false');
  await expect(buttons).toHaveText(['Approfondisci Metricool', 'Prepara la nota']);
  for (const b of await buttons.all()) await expect(b).not.toHaveAttribute('aria-disabled', 'true');
});

test('buttons: a message typed by hand closes them too', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.6#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expireDemoQuestion(page);
  await reply(page, NEXT, { ordered: true });
  const buttons = page.getByTestId('agent-bubble').last().getByTestId('ui-button');
  await expect(buttons.first()).not.toHaveAttribute('aria-disabled', 'true');
  // A message typed by hand closes them too: the user spoke after this reply.
  await holdMock(page);
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.fill('Something else first');
  await input.press('Enter');
  await expect(page.getByTestId('user-bubble').last()).toHaveText('Something else first');
  await expect(buttons.first()).toHaveAttribute('aria-disabled', 'true');
  await releaseMock(page);
});

test('buttons: wrapped on a phone, not drawn on the agent terminal', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expireDemoQuestion(page);
  await reply(page, NEXT, { run: 'r-buttons-terminal', ordered: true });
  const bubble = page.getByTestId('agent-bubble').last();
  await expect(bubble.getByTestId('ui-button')).toHaveCount(3);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page);
  const box = await bubble.boundingBox();
  for (const b of await bubble.getByTestId('ui-button').all()) {
    const r = await b.boundingBox();
    expect(r!.x + r!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    expect(r!.height).toBeGreaterThanOrEqual(40);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page
    .getByRole('button', { name: /^Behind the scenes of Titan/ })
    .last()
    .click();
  const term = page.getByTestId('agent-terminal');
  await expect(term.getByTestId('ui-block')).toBeVisible();
  await expect(term).toContainText('Metricool covers scheduling');
  // No chat to send to there: the buttons are not drawn.
  await expect(term.getByTestId('ui-button')).toHaveCount(0);
});

test('other code blocks are untouched', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await reply(page, 'Run this:\n\n```bash\nls -la\n```');
  const bubble = page.getByTestId('agent-bubble').last();
  await expect(bubble.locator('pre code')).toHaveText('ls -la');
  await expect(bubble.getByTestId('ui-block')).toHaveCount(0);
});

if (shots) {
  for (const theme of ['light', 'dark'] as const) {
    for (const size of [
      { name: '1440', width: 1440, height: 900 },
      { name: '390', width: 390, height: 844 },
    ]) {
      test(`screenshots ${theme} ${size.name}`, async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await page.emulateMedia({ colorScheme: theme });
        // Tall, so the whole bubble is on screen for its picture.
        await page.setViewportSize({ width: size.width, height: 5200 });
        await page.goto('/?mock=demo#/?chat=titan');
        await expect(page.getByTestId('chat-panel')).toBeVisible();
        await expireDemoQuestion(page);
        for (const [name, text] of [
          ['numbers', NUMBERS],
          ['plan', PLAN],
          ['broken', BROKEN],
          ['buttons', NEXT],
        ] as const) {
          await reply(page, text);
          const bubble = page.getByTestId('agent-bubble').last();
          await expect(bubble).toContainText(text.split('\n')[0]!.slice(0, 12));
          await page
            .getByRole('button', { name: /close|dismiss/i })
            .first()
            .click({ timeout: 500 })
            .catch(() => {});
          await page.waitForTimeout(250);
          await bubble.screenshot({ path: `${OUT}${name}-${theme}-${size.name}.png` });
        }
      });
    }
  }
}
