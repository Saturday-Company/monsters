import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The instinct in the UI (D-068): the Istinto module in Settings → Squadra
 * (engine, uses, the TypeSafe key the core asks for), the pagella, the receipt
 * of a job with "Annulla tutto il lavoro", the lines of the instinct in
 * Attività, the confused monster and the brake on the actions that leave the
 * computer.
 */

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

const list = (page: Page) => page.getByRole('navigation', { name: 'Monsters’ chats' });
const row = (page: Page, name: string) =>
  list(page).getByRole('link', { name: new RegExp(`^${name},`) });

test('Istinto: Basic or Smarter, one by one behind a drawer, and the key the core asks for', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=istinto');
  const section = page.getByTestId('instinct-section');
  await expect(section.getByRole('heading', { name: 'Monsters’ decisions' })).toBeInViewport();
  // Plain words only: none of the jargon of the core.
  await expect(section).not.toContainText(/system 1|gate|shadow|threshold/i);

  // One control in front: Basic is chosen; the expert model is named once, with its key.
  const quick = section.getByRole('radiogroup', { name: 'Quick decisions' });
  await expect(quick.getByRole('radio', { name: 'Basic' })).toHaveAttribute('aria-checked', 'true');
  const quickAbout = page.getByTestId('instinct-quick-about');
  await expect(quickAbout).toContainText('Simple rules decide');
  await expect(quickAbout).toContainText('Smarter needs a TypeSafe key');
  // Nothing of the twelve switches in front.
  await expect(section.getByRole('switch')).toHaveCount(0);
  await expect(section.getByRole('radio')).toHaveCount(2);

  // What always applies is a sentence with a link to where it is chosen, not a switch.
  const outbound = page.getByTestId('instinct-outbound');
  await expect(outbound).toContainText('publishing, writing to others, spending and deleting');
  await expect(section.getByRole('switch', { name: /leaves the computer/ })).toHaveCount(0);

  // "Choose one by one": who decides in three steps, and a lever for each use.
  const drawer = section.getByRole('button', { name: /Choose one by one/ });
  await expect(drawer).toContainText('11 of 11 on');
  await drawer.click();
  const about = page.getByTestId('instinct-engine-about');
  await expect(about).toContainText('always goes to you');
  // The description of the engine follows the choice (UI-13).
  await section.getByRole('radio', { name: 'Small model' }).click();
  await expect(section.getByRole('radio', { name: 'Small model' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(about).toContainText('Uses one of your models');
  // A small model is still "Basic" up front.
  await expect(quick.getByRole('radio', { name: 'Basic' })).toHaveAttribute('aria-checked', 'true');
  await expect(quickAbout).toContainText('A small model of yours');

  // A use with a lever: off, and back on.
  const memory = page.getByTestId('instinct-use-memory');
  const lever = memory.getByRole('switch', { name: 'Remembers only what’s useful' });
  await expect(lever).toHaveAttribute('aria-checked', 'true');
  await lever.click();
  await expect(memory).toHaveAttribute('data-mode', 'off');
  await expect(lever).toHaveAttribute('aria-checked', 'false');
  await lever.click();
  await expect(memory).toHaveAttribute('data-mode', 'on');
  // The trial that changed nothing and the brake that always applies have no lever.
  await expect(page.getByTestId('instinct-use-shortcut')).toHaveCount(0);
  await expect(page.getByTestId('instinct-use-outbound')).toHaveCount(0);
  await expect(page.getByTestId('instinct-use-route_hint')).toContainText('Needs the expert model');

  // Smarter without a key: the core answers 409 no_key, the module asks for the key in words.
  await quick.getByRole('radio', { name: 'Smarter' }).click();
  await expect(page.getByTestId('no-key')).toContainText('you need its key first');
  const field = page.getByLabel('Key for the expert model');
  await expect(field).toBeFocused();
  await expect(about).toContainText('needs its own key');
  await field.fill('ts_live_1234567890abcdef');
  await page.getByRole('button', { name: 'Save the key' }).click();
  await expect(page.getByTestId('typesafe-key-status')).toContainText('Active');
  await expect(quick.getByRole('radio', { name: 'Smarter' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(section.getByRole('radio', { name: 'The expert model' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('instinct-use-route_hint')).not.toContainText(
    'Needs the expert model',
  );

  // Back to Basic with one press.
  await quick.getByRole('radio', { name: 'Basic' }).click();
  await expect(section.getByRole('radio', { name: 'Rules only' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // What leaves the computer, small, under the module: the trial that does nothing is not listed.
  await page.getByTestId('instinct-privacy').locator('summary').click();
  await expect(page.getByTestId('instinct-privacy')).toContainText(
    'never the content of your notes',
  );
  await expect(page.getByTestId('instinct-privacy')).not.toContainText('Shortcut');
});

test('the "always asks" sentence leads to Permissions, where it is chosen', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=istinto');
  await page.getByTestId('instinct-outbound-link').click();
  await expect(page.getByRole('tab', { name: 'Permissions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('team-ask-always')).toBeVisible();
});

test('the scorecard of the monsters says honestly what it is waiting for', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=pagella');
  const card = page.getByTestId('scorecard');
  await expect(card.getByRole('heading', { name: 'Monster scorecard' })).toBeInViewport();
  await expect(page.getByTestId('scorecard-row-rhea')).toContainText('10 really finished');
  await expect(page.getByTestId('scorecard-row-dione')).toContainText('19 really finished');
  await expect(page.getByTestId('scorecard-row-rhea')).toContainText('free per successful job');
  await expect(card).toContainText('After 20 checked jobs');
});

test('the scorecard stays hidden until a model has the checked jobs it needs', async ({ page }) => {
  // An install with no job yet has nothing checked.
  await page.goto('/?mock=team');
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByLabel('Setup code').fill('424242');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('sidebar').waitFor();
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=pagella'));
  await expect(page.getByTestId('instinct-section')).toBeVisible();
  await expect(page.getByTestId('scorecard')).toHaveCount(0);
});

test('the receipt of a job is the strip of its turn, and "Undo the whole job" takes two presses', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const turn = page.locator('[data-testid="turn"][data-run="run_seed_meeting"]');
  await expect(turn.getByTestId('user-bubble')).toContainText('summarize yesterday’s meeting');
  // Closed, one sentence in the chat's tone; no black screen, no service lines in the column.
  const strip = turn.getByTestId('work-strip');
  await expect(strip).toHaveAttribute('data-open', 'false');
  await expect(strip.getByTestId('receipt-summary')).toHaveText(
    'Worked 1 min · asked Dione and Rhea · 1 note · $0.0001',
  );
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  await expect(page.getByTestId('delegation')).toHaveCount(0);
  // What needs a check stays under the reply: the doubt in orange, the orders removed in red.
  await expect(turn.getByTestId('turn-flag')).toHaveCount(2);
  await expect(turn.getByTestId('turn-flag').first()).toHaveAttribute('data-tone', 'warn');
  await expect(turn.getByTestId('turn-flag').first()).toContainText('in doubt');
  await expect(turn.getByTestId('turn-flag').last()).toHaveAttribute('data-tone', 'stop');

  await strip.getByRole('button', { name: /Worked 1 min/ }).click();
  await expect(strip).toHaveAttribute('data-open', 'true');
  const jobs = strip.getByTestId('receipt-delegation');
  await expect(jobs).toHaveCount(2);
  await expect(jobs.first()).toContainText('really finished');
  await expect(jobs.last()).toContainText('in doubt');
  await expect(strip.getByTestId('receipt-criterion').filter({ hasText: 'guide' })).toHaveAttribute(
    'data-ok',
    'false',
  );
  await expect(strip.getByTestId('receipt-note')).toHaveText('Summary of the meeting with Bruno');
  await expect(
    strip.getByTestId('instinct-line').filter({ hasText: 'I removed text' }),
  ).toBeVisible();
  await expect(strip.getByTestId('receipt-cost')).toContainText('steps');
  // The lines of the instinct: who does it, and what it said of a task.
  await expect(
    strip.getByTestId('instinct-line').filter({ hasText: 'Dione will handle it' }),
  ).toBeVisible();
  await expect(
    strip.getByTestId('task-check').filter({ hasText: 'hadn’t finished' }),
  ).toBeVisible();
  // Without the technical details, no model names (D-181).
  await expect(strip.getByTestId('receipt-model')).toHaveCount(0);

  const undo = strip.getByTestId('receipt-undo');
  await undo.click();
  await expect(undo).toHaveAttribute('data-state', 'armed');
  await expect(undo).toHaveAccessibleName('Press again to undo the whole job');
  await expect(undo).toContainText('Again');
  await undo.click();
  await expect(strip.getByTestId('receipt-undone')).toContainText('Undone · 3 changes');
  await expect(strip.getByTestId('receipt-undo')).toHaveCount(0);
  await expect(strip.getByTestId('receipt-summary')).toContainText('job undone');
});

test('a doubt of the check says which point is unclear, lists the notes and offers two keys', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const turn = page.locator('[data-testid="turn"][data-run="run_seed_meeting"]');
  const notice = turn.getByTestId('doubt-notice');
  await expect(notice).toContainText('Rhea’s work is in doubt');
  // The point the check was not sure of, quoted, and the note Rhea delivered.
  await expect(notice.getByTestId('doubt-points')).toHaveText(
    '“The restaurant’s address and website in the summary note”',
  );
  await expect(notice.getByTestId('note-chip')).toHaveCount(1);
  await expect(notice.getByTestId('note-chip')).toContainText('Summary of the meeting with Bruno');
  if (process.env['SCREENSHOTS']) {
    await notice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env['SCREENSHOTS']}/doubt-notice.png` });
  }

  // "Ask Titan to double-check" writes the request in the field and sends nothing.
  const input = page.getByTestId('composer-input');
  await expect(input).toHaveValue('');
  const bubbles = await page.getByTestId('user-bubble').count();
  await notice.getByTestId('doubt-ask').click();
  await expect(input).toHaveValue(
    /^Please double-check Rhea’s work on this point: “The restaurant’s address and website in the summary note”\. Read the notes it delivered/,
  );
  await expect(input).toBeFocused();
  await expect(page.getByTestId('user-bubble')).toHaveCount(bubbles);

  // A note chip opens it in the preview pane.
  await notice.getByTestId('note-chip').click();
  await expect(page.getByTestId('right-dock')).toBeVisible();

  // "Looks fine" closes the notice and this browser remembers it (the mock makes new ids on a
  // reload, so the memory is read from the storage).
  await notice.getByTestId('doubt-fine').click();
  await expect(notice).toHaveCount(0);
  await expect(turn.getByTestId('turn-flag')).toHaveCount(1);
  const kept = await page.evaluate(() => window.localStorage.getItem('monsters-doubts-ok'));
  expect(JSON.parse(kept ?? '[]')).toHaveLength(1);
});

test('Behind the scenes: a refused note write says why in plain words, the raw error stays below', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=rhea');
  await page.getByTestId('behind-the-scenes').click();
  const term = page.getByTestId('agent-terminal');
  const line = term.getByTestId('tool-line').filter({ hasText: 'Pitch deck' });
  // Closed: the sentence, not the code.
  await expect(term.getByTestId('terminal-log')).toContainText(
    'Rhea can’t edit this note: it only writes in Agenti/Rhea/ and in the notes it created.',
  );
  await expect(term.getByTestId('terminal-log')).not.toContainText('SETTING_OFF:');
  await line.click();
  const problem = term.getByTestId('tool-problem');
  await expect(problem).toContainText('Settings → Squad → Rhea → Where it writes in the notes');
  await expect(problem.getByTestId('tool-problem-settings')).toHaveText('Open Rhea’s settings');
  await expect(term.getByText('Technical error', { exact: true })).toBeVisible();
  await expect(term.getByTestId('terminal-log')).toContainText(
    'SETTING_OFF: rhea cannot write Sales/Pitch deck.md',
  );
  if (process.env['SCREENSHOTS']) {
    await term.locator('.term-pre').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env['SCREENSHOTS']}/setting-off-problem.png` });
  }
});

test('Attività: the details of a refused note write start with the plain problem', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/log');
  await page.getByRole('radio', { name: 'Everything' }).click();
  const row = page
    .getByTestId('event-row')
    .filter({ hasText: 'Rhea couldn’t finish writing a note' });
  await row.first().getByRole('button', { name: 'Details' }).click();
  const link = page.getByTestId('detail-link');
  await expect(link).toHaveText('Open Rhea’s settings');
  await expect(page.getByText('Technical error', { exact: true }).first()).toBeVisible();
});

test('Attività: an order removed is important, the hint of the instinct is under Tutto', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/log');
  const rows = page.getByTestId('event-row');
  await expect(
    rows.filter({
      hasText:
        'I removed text that gave orders to the monsters from a web page (lisbon-guide.example)',
    }),
  ).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Dione will handle it' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Everything' }).click();
  const hint = rows.filter({ hasText: 'Dione will handle it' });
  await expect(hint).toHaveCount(1);
  await expect(hint).toContainText('Monsters’ decisions');
  await expect(
    rows.filter({ hasText: 'hadn’t finished the job: I asked for it to be completed' }),
  ).toHaveCount(1);
});

test('a monster going round in circles looks confused and says it changes its way', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=enceladus');
  await expect(row(page, 'Enceladus')).toContainText('Is changing course');
  await expect(row(page, 'Enceladus').locator('svg[data-dots]')).toHaveAttribute(
    'data-expression',
    'confused',
  );
  const monitor = page.getByTestId('chat-monitor');
  await expect(monitor).toHaveAttribute('data-confused', 'true');
  await expect(page.getByTestId('monitor-confused')).toHaveText(/is changing course/i);
});

test('the confused face comes from the snapshot of the core, also on a new connection (D-072)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=enceladus');
  await expect(page.getByTestId('chat-monitor')).toHaveAttribute('data-confused', 'true');
  await page.reload();
  await expect(page.getByTestId('chat-monitor')).toHaveAttribute('data-confused', 'true');
});

test('the brake: an action that leaves the computer waits for a yes', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.2#/?chat=dione');
  const composer = page.getByTestId('composer-input');
  await composer.fill('Publish the first post on Instagram');
  await composer.press('Enter');
  const card = page.getByTestId('question-card').filter({ hasText: 'Go ahead?' });
  await expect(card).toContainText('Dione wants to publish the post');
  await card.getByRole('button', { name: /Yes, go ahead/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  // The same page (the mock core lives in it): Attività by its link.
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'You said yes: Dione can publish' }),
  ).toHaveCount(1);
});
