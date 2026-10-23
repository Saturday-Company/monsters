import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * Drawn blocks in the chat (D-162): a reply with a ```ui fence of OpenUI Lang shows a table, key
 * numbers and charts (our own SVG); a block that does not parse shows its text and says so.
 * `SCREENSHOTS=1 SCREENSHOTS_DIR=<folder>` also writes them, light and dark, 1440 and 390 px.
 */

const STORE = '/src/store/app.ts';
const OUT = `${(process.env['SCREENSHOTS_DIR'] ?? '/tmp/blocchi-ui').replace(/\/$/, '')}/`;
const shots = !!process.env['SCREENSHOTS'];

let fed = 0;
const reply = (page: Page, text: string, opts: { partial?: boolean; run?: string } = {}) =>
  page.evaluate(
    async ({ src, text, id, partial, run }) => {
      const { ingest } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
      ingest([
        {
          id: `7ZZZZZZZZZ${String(id).padStart(16, '0')}`,
          ts: Date.now(),
          runId: run ?? `r-blocks-${id}`,
          parentId: null,
          agent: 'titan',
          type: 'message',
          data: { role: 'agent', text, ...(partial ? { partial: true } : {}) },
        },
      ] as Parameters<(typeof AppStore)['ingest']>[0]);
    },
    { src: STORE, text, id: ++fed, partial: !!opts.partial, run: opts.run },
  );

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

const BROKEN = `Here you go.

\`\`\`ui
this is not a block at all
\`\`\``;

test.use({ viewport: { width: 1440, height: 900 } });

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
        for (const [name, text] of [
          ['numbers', NUMBERS],
          ['plan', PLAN],
          ['broken', BROKEN],
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
