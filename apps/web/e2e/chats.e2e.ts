import type { Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, test } from './fixtures.ts';

/*
 * The chats (home): one chat per monster on the left, the open one on the
 * right. The monsters stay in place in their rows, alive but never walking;
 * what needs the user stands out; the keyboard and a phone work too.
 */

/** The app's own store module: Vite serves the page the same instance the app uses. */
const STORE = '/src/store/app.ts';

/** Feeds events to the store as the stream would, with ids after everything in the log. */
let fed = 0;
const feed = (
  page: Page,
  events: { agent: string; type: string; data: unknown; runId?: string }[],
) =>
  page.evaluate(
    async ({ src, events, from }) => {
      const { ingest } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
      ingest(
        events.map((e, i) => ({
          id: `7ZZZZZZZZZ${String(from + i).padStart(16, '0')}`,
          ts: Date.now(),
          runId: 'r-test',
          parentId: null,
          ...e,
        })) as Parameters<(typeof AppStore)['ingest']>[0],
      );
    },
    { src: STORE, events, from: (fed += events.length) - events.length },
  );

const list = (page: Page) => page.getByRole('navigation', { name: 'Monsters’ chats' });
const row = (page: Page, name: string) =>
  list(page).getByRole('link', { name: new RegExp(`^${name},`) });
/** The god's chat is its bar at the head of the sidebar, not a row (D-102). */
const god = (page: Page) => page.getByTestId('god-bar');

test.use({ viewport: { width: 1440, height: 900 } });

test('one chat per monster, in the team order, the orchestrator open', async ({ page }) => {
  await page.goto('/?mock=demo&squadra=7');
  const rows = list(page).getByTestId('chat-row');
  // The orchestrator is its bar (D-102); then the Squadra personale, then the project of the
  // demo with its lead first (D-100).
  await expect(rows).toHaveCount(9);
  await expect(god(page)).toHaveAccessibleName(/^Titan, /);
  await expect(god(page)).toHaveAttribute('href', '#/?chat=titan');
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-agent')))).toEqual([
    'rhea',
    'dione',
    'tethys',
    'enceladus',
    'hyperion',
    'mimas',
    'iapetus',
    'calypso',
    'pandora',
  ]);
  await expect(god(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();

  // The open question stands out on the row of the chat it belongs to.
  await expect(god(page)).toHaveAttribute('data-waiting', 'true');
  await expect(god(page).getByTestId('god-question')).toHaveText('1');
  // A monster at work says what it does under its name; one in trouble says so.
  await expect(row(page, 'Rhea')).toContainText('Searching “tram 28 weekend schedule”');
  await expect(row(page, 'Mimas')).toContainText('The expenses sheet');
  // The direct chat with Dione keeps to itself.
  await expect(row(page, 'Dione')).toContainText('Great light!');
  await row(page, 'Dione').click();
  await expect(page).toHaveURL(/#\/\?chat=dione$/);
  await expect(page.getByTestId('user-bubble')).toHaveText([
    'Dione, can you write me a short bio for Instagram?',
    'Use this photo for Saturday’s post, and show me the menu on a page.',
  ]);
  await expect(page.getByTestId('question-card')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    'Message Dione… (@ for another monster)',
  );
});

test('a message in another chat shows up as unread, and is read once opened', async ({ page }) => {
  await page.goto('/?mock=demo');
  await expect(row(page, 'Enceladus')).toBeVisible();
  // The chats view sets the read baseline when it mounts (lazy chunk): wait for it first.
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(row(page, 'Enceladus').getByTestId('chat-row-unread')).toHaveCount(0);
  await feed(page, [
    {
      agent: 'enceladus',
      runId: 'r-ence',
      type: 'message',
      data: { role: 'agent', text: 'I tidied up today’s diary.' },
    },
  ]);
  await expect(row(page, 'Enceladus').getByTestId('chat-row-unread')).toHaveText('1');
  await expect(row(page, 'Enceladus')).toHaveAccessibleName(/1 unread/);
  await expect(row(page, 'Enceladus')).toContainText('I tidied up today’s diary.');
  await row(page, 'Enceladus').click();
  await expect(page.getByTestId('agent-bubble')).toContainText(['I tidied up today’s diary']);
  await expect(row(page, 'Enceladus').getByTestId('chat-row-unread')).toHaveCount(0);
  // Still read after a look elsewhere and a reload.
  await god(page).click();
  await page.reload();
  await expect(row(page, 'Enceladus').getByTestId('chat-row-unread')).toHaveCount(0);
});

test('a monster at work: thinking in its row, a working line at the bottom of its chat', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=rhea');
  const avatar = row(page, 'Rhea').locator('svg[data-dots]');
  await expect(avatar).toHaveAttribute('data-expression', 'think');
  await expect(page.getByTestId('working-row')).toContainText(
    'Searching “tram 28 weekend schedule”',
  );
  await expect(page.getByTestId('chat-status')).toContainText('Working');
  // Rhea's chat shows the tasks Titan passed her and their results, not Titan's conversation.
  const tasks = page.getByTestId('received-task');
  // The demo's Lisbon task (the finished job of the morning comes before it, D-068).
  const lisbon = tasks.filter({ hasText: 'tips on Lisbon' });
  await expect(lisbon).toContainText('Titan asked Rhea: ');
  await expect(lisbon).toHaveAttribute('data-status', 'completed');
  await expect(lisbon).toContainText('5 tips saved');
  await expect(tasks.last()).toContainText('Working…');
  await expect(page.getByTestId('user-bubble')).toHaveCount(0);
});

test('keyboard: arrows move between chats, Ctrl/Cmd+K finds a monster in the palette', async ({
  page,
}) => {
  await page.goto('/?mock=demo&squadra=7');
  await god(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Rhea')).toBeFocused();
  await expect(page).toHaveURL(/chat=rhea$/);
  await page.keyboard.press('End');
  // The last row is the last monster of the last squad (the demo's project).
  await expect(row(page, 'Pandora')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Pandora', level: 1 })).toBeVisible();
  await page.keyboard.press('Home');
  // The first stop of the arrows is the god's bar, above the squads (D-102).
  await expect(god(page)).toBeFocused();
  await expect(page).toHaveURL(/chat=titan$/);
  await expect(god(page)).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Rhea')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(god(page)).toBeFocused();
  // Only the open chat is in the tab order.
  await expect(
    page.locator('[data-testid="chat-row"][tabindex="0"], [data-testid="god-bar"][tabindex="0"]'),
  ).toHaveCount(1);
  await expect(god(page)).toHaveAttribute('tabindex', '0');

  await page.getByRole('combobox', { name: 'Message' }).focus();
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByTestId('palette-input');
  await expect(search).toBeFocused();
  await search.fill('in order');
  // Enceladus, by role ("Keeps the notes in order"), first among the results.
  await expect(page.getByTestId('palette-item').first()).toContainText('Enceladus');
  await search.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Enceladus', level: 1 })).toBeVisible();
  // The team in the sidebar is never filtered: every monster stays in place.
  await expect(list(page).getByTestId('chat-row')).toHaveCount(9);
});

test('a question asked while working for the orchestrator: in both chats, badge in one', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  await expect(god(page)).toBeVisible();
  // The demo's tram delegation is Titan's run; Rhea asks something there.
  await feed(page, [
    {
      agent: 'rhea',
      runId: 'run_seed_tram',
      type: 'question',
      data: {
        questionId: 'q-tram',
        question: 'Tram 28 or 12?',
        options: [],
        blocking: true,
      },
    },
  ]);
  const card = page.getByTestId('question-card').filter({ hasText: 'Tram 28 or 12?' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Rhea asks you');
  await expect(god(page).getByTestId('god-question')).toHaveText('2');
  await expect(row(page, 'Rhea')).toContainText('Waiting for your answer');
  await expect(row(page, 'Rhea').getByTestId('chat-row-question')).toHaveCount(0);
  await row(page, 'Rhea').click();
  await expect(card).toBeVisible();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the list, then a chat, then back to the list', async ({ page }) => {
    await page.goto('/?mock=demo');
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId('chat-panel')).toHaveCount(0);
    await god(page).click();
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByTestId('question-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(list(page)).toBeVisible();
    await expect(page).not.toHaveURL(/chat=/);
    // Back from a chat opened from the list is the list too.
    await row(page, 'Dione').click();
    await expect(page.getByRole('heading', { name: 'Dione', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(list(page)).toBeVisible();
  });
});

test('"Riduci movimento" stops the idle animations of the monsters, and is remembered', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=rhea');
  // Every strip lives by frames: Rhea at work thinks, Dione at rest blinks (docs/design.md);
  // Enceladus goes round in circles in the demo: confused (D-068).
  const frames = (name: string) =>
    row(page, name)
      .locator('svg[data-dots] [data-frame]')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
  await expect.poll(() => frames('Rhea')).toMatch(/^dk-think/);
  await expect.poll(() => frames('Dione')).toMatch(/^dk-idle/);
  await expect.poll(() => frames('Enceladus')).toMatch(/^dk-confused/);
  // In place: the rows never move, nothing walks.
  await expect(page.locator('[data-gait]')).toHaveCount(0);

  await page.goto('/?mock=demo#/impostazioni?sezione=aspetto');
  const toggle = page.getByRole('switch', { name: 'Reduce motion' });
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.goto('/?mock=demo#/?chat=rhea');
  await expect(god(page)).toBeVisible();
  const names = await page
    .locator('svg[data-dots] [data-frame]')
    .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).animationName))]);
  expect(names).toEqual(['none']);
  const meter = await page
    .getByTestId('working-row')
    .locator('.meter > i')
    .nth(2)
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(meter).toBe('none');
});

test('the monitor of the monster, the instrumentation line and "Dietro le quinte" on that turn', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  const monitor = page.getByTestId('chat-monitor');
  await expect(monitor).toContainText('Titan');
  await expect(monitor).toContainText('waiting for your answer');
  // The conversation also holds the finished job of the morning, whose instinct cost a little.
  await expect(page.getByTestId('chat-summary')).toContainText(/\d+ tools · .*(free|\$)/i);
  // Under the turn: what the run did, from its events.
  const line = page.getByTestId('instrumentation').last();
  await expect(line).toContainText(
    'Titan › Delegation · Web search · Web page · Note written · free',
  );
  await line.click();
  const term = page.getByTestId('agent-terminal');
  await expect(term.getByRole('heading', { name: 'Behind the scenes of Titan' })).toBeVisible();
  await expect(term.locator('[data-focus]').first()).toContainText('work started');
  await page.keyboard.press('Escape');
  await expect(term).toHaveCount(0);

  // Off in the settings, off in the chat.
  await page.evaluate(async (src) => {
    const { setPrefs } = (await import(/* @vite-ignore */ src)) as {
      setPrefs: (p: { showDetails: boolean }) => void;
    };
    setPrefs({ showDetails: false });
  }, '/src/store/prefs.ts');
  await expect(page.getByTestId('instrumentation')).toHaveCount(0);
  await expect(page.getByTestId('chat-summary')).toHaveCount(0);
});

test('the keypad: a sentence typed in the composer stays words, a letter picks with a moment to undo (V-1)', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  const card = page
    .getByTestId('question-card')
    .filter({ hasText: 'What tone should we give the posts?' });
  await expect(card).toHaveAttribute('data-keypad', 'on');
  const input = page.getByRole('combobox', { name: 'Message' });
  await expect(input).toHaveAttribute(
    'placeholder',
    'Message Titan, or type A, B or C and press Enter',
  );
  await expect(card).toContainText('Type A, B or C and press Enter, or write your answer below.');
  // The empty composer has the focus: "Can you also…" starts with C, and it is a sentence.
  await input.focus();
  await page.keyboard.type('Can you also');
  await expect(input).toHaveValue('Can you also');
  await expect(card).toHaveAttribute('data-status', 'open');
  await expect(card.getByTestId('answer-undo')).toHaveCount(0);

  // A letter alone and Enter picks that key; Esc takes it back before it leaves.
  await input.fill('b');
  await expect(page.getByTestId('composer-pick')).toHaveText('Press Enter to pick Ironic');
  await input.press('Enter');
  await expect(card.getByTestId('answer-undo')).toContainText('Sent: Ironic');
  await expect(input).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('answer-undo')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-status', 'open');

  // Outside the text fields the letter alone presses the key, and "Undo" is one Tab away.
  await input.blur();
  await page.keyboard.press('a');
  await expect(card.getByTestId('answer-undo')).toContainText('Sent: Friendly');
  await expect(card.getByRole('button', { name: 'Undo the answer' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card.getByTestId('answer-undo')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-status', 'open');
  await page.keyboard.press('b');
  await expect(card.getByTestId('answer-undo')).toContainText('Sent: Ironic');
  // Left alone, it goes after the moment.
  await expect(card).toHaveAttribute('data-status', 'answered', { timeout: 10_000 });
  await expect(card).toContainText('You chose: Ironic');
});

test('a chat loads its own history, beyond the newest page of the whole log (W-1)', async ({
  page,
}) => {
  // A long job of Enceladus after the demo: the newest page of the log is all its steps.
  await page.goto('/?mock=demo&mockNoise=500#/?chat=dione');
  const bubbles = [
    'Dione, can you write me a short bio for Instagram?',
    'Use this photo for Saturday’s post, and show me the menu on a page.',
  ];
  await expect(page.getByTestId('user-bubble')).toHaveText(bubbles);
  await expect(page.getByTestId('chat-panel')).toContainText('Slow travels, crooked photos');
  await page.reload();
  await expect(page.getByTestId('user-bubble')).toHaveText(bubbles);
  // The lead's chat too: the open question is back with its card.
  await god(page).click();
  await expect(
    page.getByTestId('question-card').filter({ hasText: 'What tone should we give the posts?' }),
  ).toHaveAttribute('data-status', 'open');
});

test('a chat opens at the very bottom, and a message sent while scrolled up comes into view (V-2, W-21)', async ({
  page,
}) => {
  // The lead's chat ends on the card of its open question: the chat grows after the first
  // layout, and its last lines stayed under the composer.
  await page.goto('/?mock=demo');
  const scroller = page.getByTestId('chat-scroller');
  const gap = () =>
    scroller.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
  await expect(page.getByTestId('question-card').first()).toBeVisible();
  await expect.poll(gap).toBeLessThanOrEqual(1);

  // Dione's chat: up to re-read something, then a message. It is not left off screen.
  await page.setViewportSize({ width: 1440, height: 600 });
  await row(page, 'Dione').click();
  await expect(page.getByTestId('user-bubble').first()).toBeVisible();
  await expect.poll(gap).toBeLessThanOrEqual(1);
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(gap).toBeGreaterThan(150);
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.fill('One more thing: keep it short');
  await input.press('Enter');
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: 'keep it short' }),
  ).toBeInViewport();
});

test('the draft of each chat stays through a chat switch and a reload, and goes once sent (W-7)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=dione');
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.fill('Half a thought for Dione');
  await row(page, 'Rhea').click();
  await expect(page).toHaveURL(/chat=rhea/);
  await expect(input).toHaveValue('');
  await input.fill('And one for Rhea');
  await row(page, 'Dione').click();
  await expect(input).toHaveValue('Half a thought for Dione');
  await page.reload();
  await expect(input).toHaveValue('Half a thought for Dione');
  await input.press('Enter');
  await expect(
    page.getByTestId('user-bubble').filter({ hasText: 'Half a thought for Dione' }),
  ).toBeVisible();
  await expect(input).toHaveValue('');
  await page.reload();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(input).toHaveValue('');
  await row(page, 'Rhea').click();
  await expect(input).toHaveValue('And one for Rhea');
});

test('a message written while the monsters are stopped is not lost in a reload (W-6)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=dione');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('halt-banner')).toBeVisible();
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.fill('When you’re back, a caption for the photo');
  await input.press('Enter');
  const held = page.getByTestId('user-bubble').filter({ hasText: 'a caption for the photo' });
  await expect(held).toHaveAttribute('data-held', 'true');
  // The page reloads (an update, a crash): the mock core starts again, running. The message
  // was kept, and goes now as promised.
  await page.reload();
  await expect(held).toBeVisible();
  await expect(held).not.toHaveAttribute('data-held', 'true');
  await expect(page.getByTestId('held-note')).toHaveCount(0);
  // Sent once: another reload does not send it again.
  await page.reload();
  await expect(held).toHaveCount(0);
});
