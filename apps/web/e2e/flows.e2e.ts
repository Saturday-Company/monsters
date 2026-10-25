import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import type { Page } from '@playwright/test';
import {
  expect,
  holdMock,
  openGeneralAdvanced,
  releaseMock,
  stepMockUntil,
  test,
} from './fixtures.ts';

/* Main flows of the UI against the mock core (`?mock=…`). */

/**
 * The demo starts with a question open in Titan's chat, and with a question
 * open what is typed answers it (audit 3.5): a stop and a resume let it expire,
 * so the next message is a new request.
 */
async function expireDemoQuestion(page: Page): Promise<void> {
  await expect(page.getByTestId('question-card').first()).toHaveAttribute('data-status', 'open');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('question-card').first()).toHaveAttribute('data-status', 'expired');
  await expect(page.getByTestId('composer-input')).toHaveAttribute('placeholder', /^Message Titan/);
}

test('setup with the one-time code, logout and login', async ({ page }) => {
  await page.goto('/?mock=1');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

  await page.getByLabel('Email').fill('giulio@example.com');
  await page.getByLabel('Password').fill('short');
  await page.getByLabel('Setup code').fill('111111');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/at least 8 characters/)).toBeVisible();

  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('That code isn’t right');

  await page.getByLabel('Setup code').fill(MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await expect(page).toHaveURL(/#\/benvenuto$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill('giulio@example.com');
  await page.getByLabel('Password').fill('wrong-one!!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong email or password');

  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // No team yet: back to the first start.
  await expect(page.getByTestId('onboarding')).toBeVisible();
});

test('sending a message shows the reply while it streams', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.6');
  await expireDemoQuestion(page);
  const input = page.getByTestId('composer-input');
  await input.fill('Prepare me 3 posts about the weekend in Lisbon');
  // The reply comes out one step at a time, so its streaming state cannot
  // come and go between two checks on a slow machine.
  await holdMock(page);
  await input.press('Enter');

  const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Got it!' });
  const streaming = bubble.and(page.locator('[data-streaming="true"]'));
  await stepMockUntil(page, () => streaming.isVisible());
  await expect(page.getByTestId('user-bubble').last()).toHaveText(
    'Prepare me 3 posts about the weekend in Lisbon',
  );
  // Still held: the reply is partial and stays so.
  await expect(streaming).toBeVisible();
  await expect(bubble).not.toHaveText(/then let you know/);

  await releaseMock(page);
  await expect(bubble).toHaveAttribute('data-streaming', 'false');
  await expect(bubble).toHaveText(/I’ll ask Rhea to gather a few tips on Lisbon/);
  await expect(page.getByTestId('delegation').filter({ hasText: 'finished' }).last()).toBeVisible({
    timeout: 15_000,
  });
});

test('answering a question with options', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  const card = page.getByTestId('question-card').first();
  await expect(card).toContainText('What tone should we give the posts?');
  await expect(card.getByRole('button', { name: /Friendly.*Recommended/ })).toBeVisible();
  // The options only: words of one's own go in the composer (one field, not two).
  await expect(card.getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('composer-input')).toHaveAttribute(
    'placeholder',
    'Message Titan, or type A, B or C and press Enter',
  );
  await expect(page.getByTestId('chat-status')).toContainText('Waiting for your answer');

  await card.getByRole('button', { name: /^Ironic/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('You chose: Ironic');
  await expect(page.getByTestId('agent-bubble').filter({ hasText: 'ironic tone' })).toBeVisible({
    timeout: 15_000,
  });
});

test('agent messages render Markdown and note chips open the note in Anteprima', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockSpeed=0.2');
  await page
    .getByTestId('question-card')
    .getByRole('button', { name: /^Friendly/ })
    .click();
  const bubble = page
    .getByTestId('agent-bubble')
    .filter({ hasText: 'All done!' })
    .and(page.locator('[data-streaming="false"]'));
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  await expect(bubble.getByRole('heading', { name: 'The drafts' })).toBeVisible();
  await expect(bubble.getByRole('table')).toBeVisible();
  await expect(bubble.locator('strong').first()).toHaveText('Tram 28 at dawn');
  await expect(bubble).not.toContainText('**');
  await expect(bubble).not.toContainText('[[');
  const site = bubble.getByRole('link', { name: /tourism website/ });
  await expect(site).toHaveAttribute('target', '_blank');
  await expect(site).toHaveAttribute('rel', 'noopener noreferrer');

  // The note opens beside the chat (D-075); "Apri nelle Note" goes to Notes.
  await bubble.getByTestId('note-chip').filter({ hasText: 'Post drafts' }).click();
  const dock = page.getByTestId('right-dock');
  await expect(dock.getByTestId('preview-title')).toHaveText('Post drafts');
  await dock.getByTestId('preview-open-notes').click();
  await expect(page).toHaveURL(/#\/note\?nota=Projects%2FSocial%2FPost(%20|\+)drafts/);
  await expect(page.getByRole('heading', { name: 'Post drafts' }).first()).toBeVisible();
});

test('agents’ memories stay out of the recent notes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  // The "Activity" column is off by default, and remembered once on.
  await expect(page.getByTestId('activity-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'To review' }).click();
  await expect(page.getByTestId('note-row').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('activity-panel')).toBeVisible();
  await expect(page.getByTestId('note-row').filter({ hasText: 'MEMORY' })).toHaveCount(0);
  // A row like the others, with its time (audit UI-38).
  await expect(page.getByTestId('memory-line')).toHaveText(
    /^Rhea updated their notes·\s(just now|\d+ min ago)$/,
  );
});

test('answering with free text, from the composer', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  const card = page.getByTestId('question-card').first();
  const input = page.getByTestId('composer-input');
  await input.fill('A bit poetic');
  await expect(page.getByTestId('composer-answering')).toContainText('Answering Titan’s question');
  await page.getByRole('button', { name: 'Send the answer' }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('You answered: A bit poetic');
  await expect(input).toHaveAttribute('placeholder', /^Message Titan…/);
});

test('an open question out of sight: a bar above the composer brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 420 });
  await page.goto('/?mock=demo');
  // The notice of the demo takes a strip of this low window: it is closed first.
  await page
    .getByTestId('notice')
    .getByRole('button', { name: 'Close' })
    .click({ timeout: 3000 })
    .catch(() => {});
  const card = page.getByTestId('question-card').first();
  await expect(card).toBeVisible();
  // Rows of the demo that arrive after the question can push it out of this low window: in
  // view first, then out of sight.
  await card.scrollIntoViewIfNeeded();
  const bar = page.getByTestId('question-bar');
  await expect(bar).toHaveCount(0);
  await page
    .locator('[data-testid="chat-panel"] .scroll-soft')
    .first()
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await expect(bar).toContainText('Titan is waiting for your answer');
  await bar.click();
  await expect(card).toBeInViewport({ ratio: 0.5 });
  await expect(bar).toHaveCount(0);
});

test('answering an open question (no options)', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  await expireDemoQuestion(page);
  const input = page.getByTestId('composer-input');
  await input.fill('Prepare the posts about the autumn menu');
  await input.press('Enter');
  const card = page.getByTestId('question-card').filter({ hasText: 'Which dishes' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('list', { name: 'Options' })).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveCount(0); // the answer goes in the composer
  await expect(input).toHaveAttribute('placeholder', 'Answer Titan');
  await input.fill('Ribollita and wild boar pappardelle');
  await input.press('Enter');
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('You answered: Ribollita and wild boar pappardelle');
  await expect(
    page
      .getByTestId('agent-bubble')
      .filter({ hasText: 'I’ll prepare the drafts with these dishes' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('opening the terminal of an agent', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.getByRole('link', { name: /^Rhea,/ }).click();
  await expect(page.getByRole('heading', { name: 'Rhea', level: 1 })).toBeVisible();
  await page.getByTestId('behind-the-scenes').click();
  const term = page.getByTestId('agent-terminal');
  await expect(term.getByRole('heading', { name: 'Behind the scenes of Rhea' })).toBeVisible();
  await expect(term.getByTestId('terminal-log')).toContainText(
    'I’ll start with the official guides',
  );

  const tool = term.getByTestId('tool-line').first();
  await tool.click();
  await expect(tool).toHaveAttribute('aria-expanded', 'true');
  await expect(term.getByText('Data sent', { exact: true }).first()).toBeVisible();

  await term.getByRole('radio', { name: 'Errors' }).click();
  await expect(term.getByTestId('terminal-log')).toContainText('Timed out after 15 s');
  await expect(term.getByTestId('terminal-log')).not.toContainText(
    'I’ll start with the official guides',
  );

  await page.keyboard.press('Escape');
  await expect(term).toBeHidden();
});

test('undoing a vault change from Attività, then Rifai from the toast', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: 'Filter by type' })
    .getByRole('button', { name: 'Note changes' })
    .click();
  const row = page.getByTestId('event-row').filter({ hasText: 'Rhea created the note Lisbon' });
  await row.getByRole('button', { name: 'Undo' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Change undone' });
  await expect(toast).toBeVisible();
  await expect(row).toContainText('Undone');
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'You undid a change to' }),
  ).toBeVisible();

  // Rifai, from the toast: the note is back and the row offers Annulla again.
  await toast.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Change redone' })).toBeVisible();
  await expect(row.getByTestId('undo')).toBeVisible();
  await expect(row).not.toContainText('Undone');
  await page.goto('/?mock=demo#/note?nota=Resources%2FLisbon%2C%20weekend%20tips.md');
  await expect(page.locator('#vault-note-title')).toHaveText('Lisbon, weekend tips');
});

test('Attività shows the important actions; "Tutto" and the filters', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  const rows = page.getByTestId('event-row');
  const shown = page.getByRole('radiogroup', { name: 'What to show' });
  await expect(shown.getByRole('radio', { name: 'Important' })).toBeChecked();
  await expect(rows.filter({ hasText: 'Rhea created the note Lisbon' })).toBeVisible();
  // Replies and jobs only with "Tutto" (or their type under "Altri filtri").
  await expect(rows.filter({ hasText: 'Rhea replied' })).toHaveCount(0);
  await shown.getByRole('radio', { name: 'Everything' }).click();
  await expect(rows.filter({ hasText: 'Rhea replied' }).first()).toBeVisible();
  await shown.getByRole('radio', { name: 'Important' }).click();
  await page.getByRole('button', { name: /^More filters/ }).click();
  await page
    .getByRole('group', { name: 'Other types' })
    .getByRole('button', { name: 'Monsters’ jobs' })
    .click();
  await expect(rows.filter({ hasText: 'Mimas started a job' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Rhea created the note' })).toHaveCount(0);
  // Who: one monster at a time.
  await page
    .getByRole('group', { name: 'Other types' })
    .getByRole('button', { name: 'Monsters’ jobs' })
    .click();
  await page.getByTestId('activity-who').selectOption('mimas');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).toMatch(/Mimas/);
});

test('new conversation: clean chat, open question still answerable, old one on request', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockSpeed=0.2');
  const old = page.getByTestId('user-bubble').filter({ hasText: 'Can you prepare 3 posts' });
  await expect(old).toBeVisible();
  const card = page
    .getByTestId('question-card')
    .filter({ hasText: 'What tone should we give the posts?' });
  await expect(card).toHaveAttribute('data-status', 'open');

  const fresh = page.getByRole('button', { name: 'New conversation' });
  await fresh.click();
  await expect(page.getByTestId('conversation-divider')).toBeVisible();
  await expect(page.getByTestId('user-bubble')).toHaveCount(0);
  await expect(page.getByTestId('agent-bubble')).toHaveCount(0);
  // Nothing new yet: no point in starting over again.
  await expect(fresh).toBeDisabled();
  // The question of before is still there, and can be answered.
  await expect(page.getByText('Still waiting from the previous conversation')).toBeVisible();
  await card.getByRole('button', { name: /^Friendly/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  const posts = page.getByTestId('agent-bubble').filter({ hasText: 'friendly tone' });
  await expect(posts).toHaveAttribute('data-streaming', 'false', { timeout: 15_000 });

  // The previous conversation is one click away.
  const toggle = page.getByTestId('earlier-toggle');
  await expect(toggle).toContainText('Show the previous conversations');
  await toggle.click();
  await expect(old).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(old).toBeHidden();

  // `/nuova` in the composer does the same (once the work in progress has ended).
  await expect(fresh).toBeEnabled();
  const input = page.getByTestId('composer-input');
  await expect(async () => {
    await input.fill('/new');
    await input.press('Enter');
    await expect(page.getByTestId('agent-bubble')).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(page.getByTestId('greeting')).toContainText(/I’m Titan\./i);
  await expect(page.getByTestId('earlier-toggle')).toContainText('Show the previous conversations');

  // The action log keeps everything.
  await page.evaluate(() => {
    window.location.hash = '#/log';
  });
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'You started a new conversation' }),
  ).toHaveCount(2);
});

test('kill switch and resume', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('kill')).toHaveAttribute('data-state', 'armed');
  await expect(page.getByTestId('kill')).toContainText('Again');
  await expect(page.getByTestId('kill')).toHaveAttribute('title', /press again to stop/i);
  await page.getByTestId('kill').click();

  await expect(page.getByTestId('halt-banner')).toContainText('The monsters are stopped');
  await expect(page.getByRole('link', { name: /^Rhea, paused/ })).toBeVisible();
  // The field stays on: what is written waits for "Riprendi".
  const input = page.getByTestId('composer-input');
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute(
    'placeholder',
    'Go ahead and write: the message goes out when you press Resume',
  );
  await input.fill('When you’re back, prepare me the shopping list');
  await input.press('Enter');
  const held = page.getByTestId('user-bubble').filter({ hasText: 'shopping list' });
  await expect(held).toHaveAttribute('data-held', 'true');
  await expect(page.getByTestId('held-note')).toContainText('Goes out when you press Resume');

  // "Riprendi" is in the banner too, and the held message goes.
  await page
    .getByTestId('halt-banner')
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  await expect(page.getByTestId('halt-banner')).toBeHidden();
  await expect(page.getByTestId('held-note')).toHaveCount(0);
  await expect(held).not.toHaveAttribute('data-held', 'true');
  await expect(page.getByTestId('kill')).toBeVisible();
});

test('kill switch: "Riprendi" in place of the stop', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('halt-banner')).toBeHidden();
  await expect(page.getByTestId('kill')).toBeVisible();
});

test('the lifted cover closes again: Escape, or by itself after 5 s', async ({ page }) => {
  await page.goto('/?mock=demo');
  const kill = page.getByTestId('kill');
  await kill.click();
  await expect(kill).toHaveAttribute('data-state', 'armed');
  await page.keyboard.press('Escape');
  await expect(kill).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('halt-banner')).toBeHidden();
  // ⌘. / Ctrl+. lifts it from the keyboard, and it closes alone.
  await page.keyboard.press('ControlOrMeta+.');
  await expect(kill).toHaveAttribute('data-state', 'armed');
  await expect(kill).toBeFocused();
  await expect(kill).toHaveAttribute('data-state', 'idle', { timeout: 7000 });
  await expect(page.getByTestId('halt-banner')).toBeHidden();
});

test('@mention talks to another agent', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  const input = page.getByTestId('composer-input');
  await input.fill('@Rh');
  await expect(page.getByRole('option', { name: /Rhea/ })).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('@Rhea ');
  await input.pressSequentially('did you see my notes?');
  await expect(page.getByText('in their chat')).toBeVisible();
  await input.press('Enter');
  // The message goes to Rhea's chat, and the UI follows it there.
  await expect(page).toHaveURL(/#\/\?chat=rhea$/);
  await expect(page.getByRole('heading', { name: 'Rhea', level: 1 })).toBeVisible();
  await expect(page.getByTestId('user-bubble').last()).toHaveText('@Rhea did you see my notes?');
  await expect(page.getByTestId('agent-bubble').filter({ hasText: 'Hi! I’m Rhea' })).toBeVisible({
    timeout: 10_000,
  });
});

test('settings: theme, OpenRouter and Brave keys', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni');
  await page.getByRole('tab', { name: 'General' }).click();
  const chassis = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chassis'));
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await chassis()).toBe('#151514');
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await chassis()).toBe('#e3e1db');
  // No transparency to reduce any more (D-062); sounds and technical details are off, in "Advanced".
  await expect(page.getByRole('switch', { name: 'Reduce transparency' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Sounds' })).toHaveCount(0);
  await openGeneralAdvanced(page);
  const sounds = page.getByRole('switch', { name: 'Sounds' });
  await expect(sounds).toHaveAttribute('aria-checked', 'false');
  await sounds.click();
  await expect(sounds).toHaveAttribute('aria-checked', 'true');
  await sounds.click();
  await expect(page.getByRole('switch', { name: 'Show technical details' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await page.getByRole('tab', { name: 'Models' }).click();
  const openrouter = page.getByTestId('provider-row-openrouter');
  await openrouter.getByRole('button', { name: 'Change key' }).click();
  const key = page.getByLabel('New key');
  await key.fill('wrong-key');
  await openrouter.getByRole('button', { name: 'Verify and save' }).click();
  await expect(openrouter.getByRole('alert')).toBeVisible();
  await key.fill('sk-or-v1-0123456789abcdef');
  await openrouter.getByRole('button', { name: 'Verify and save' }).click();
  await expect(page.getByText('Key saved.')).toBeVisible();
  await expect(openrouter.getByTestId('key-status')).toContainText('Monsters (mock)');

  await page.getByRole('tab', { name: 'Apps and Telegram' }).click();
  await expect(page.getByTestId('brave-key-status')).toHaveAttribute('data-set', 'no');
  await page.getByRole('button', { name: 'Add the Brave key' }).click();
  await page.getByLabel('Brave Search key').fill('BSA0123456789abcdef');
  await page.getByRole('button', { name: 'Save the Brave key' }).click();
  await expect(page.getByTestId('brave-key-status')).toHaveAttribute('data-set', 'yes');
});

test('the kit animates the monsters, reduced motion keeps them still', async ({ page }) => {
  await page.goto('/?mock=demo');
  // The kit's stylesheet is in the page once, however many monsters there are.
  await expect(page.locator('style#monsters-kit-css')).toHaveCount(1);
  // Frames by steps on `visibility` (dotCss): thinking, blinking, talking…
  const frame = page.locator('.monster[data-animated="on"] svg[data-dots] [data-frame]').first();
  await expect(frame).toBeAttached();
  await expect
    .poll(() => frame.evaluate((el) => getComputedStyle(el).animationName))
    .toMatch(/^dk-/);
  // Still avatars (old messages) hold their first frame.
  const still = page.locator('.monster[data-animated="off"] svg[data-dots] [data-frame]').first();
  expect(await still.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await frame.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('light by construction: no blur, no permanent will-change, no filter on monsters', async ({
  page,
}) => {
  // docs/design.md, "Leggero per costruzione": solid colours, no `backdrop-filter`
  // anywhere, no `filter` on the monsters, no permanent `will-change`.
  const audit = () =>
    page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const cs = getComputedStyle(el);
        const name = `${el.tagName.toLowerCase()}.${String(el.className)}`.slice(0, 80);
        if (cs.willChange && cs.willChange !== 'auto') bad.push(`will-change: ${name}`);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') bad.push(`blur: ${name}`);
        if (el.closest('.monster') && cs.filter !== 'none') bad.push(`filter: ${name}`);
      }
      return bad;
    });
  for (const hash of [
    '#/',
    '#/?chat=rhea',
    '#/note',
    '#/note?vista=grafo',
    '#/log',
    '#/impostazioni',
  ]) {
    await page.goto(`/?mock=demo${hash}`);
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await audit(), hash).toEqual([]);
  }
  // Stopped: the monsters sleep at half light, still without filters.
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('halt-banner')).toBeVisible();
  expect(await audit(), 'stopped').toEqual([]);
  await expect(page.locator('.wallpaper, .glass-pane, [data-glass]')).toHaveCount(0);
  // The palette and the "Da rivedere" sheet: raised material, no veil, no blur (D-066).
  await page.evaluate(() => (window.location.hash = '#/?chat=titan'));
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  expect(await audit(), 'palette').toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByTestId('review-toggle').click();
  await expect(page.getByTestId('review-sheet')).toBeVisible();
  expect(await audit(), 'review sheet').toEqual([]);
});

test('a question that waits with no run behind it (D-078): card, status, answer', async ({
  page,
}) => {
  // The display says who asks from 1440 px; below that its short form (R2).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo&mockSpeed=0.4');
  await expireDemoQuestion(page);
  const input = page.getByTestId('composer-input');
  await input.fill('Prepare the lunch flyer');
  await input.press('Enter');
  const card = page.getByTestId('question-card').filter({ hasText: 'What format' });
  // The turn ended: the card stays open, parked, and everything says the monster waits for you.
  await expect(card).toHaveAttribute('data-parked', 'true', { timeout: 15_000 });
  await expect(card).toHaveAttribute('data-status', 'open');
  await expect(card.getByTestId('question-parked')).toContainText('picks up again when you answer');
  await expect(page.getByTestId('chat-status')).toContainText('Waiting for your answer');
  const display = page.getByTestId('status-display');
  await expect(display).toHaveAttribute('data-state', 'questions');
  await expect(display).toContainText('Titan asks');

  await card.getByRole('button', { name: /^Tabletop A5/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('You chose: Tabletop A5');
  await expect(card.getByTestId('question-parked')).toHaveCount(0);
  await expect(page.getByTestId('agent-bubble').filter({ hasText: 'Tabletop A5' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('chat-status')).not.toContainText('Waiting for your answer');
  await expect(display).not.toHaveAttribute('data-state', 'questions');
});
