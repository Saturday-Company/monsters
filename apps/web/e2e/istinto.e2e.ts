import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * The instinct in the UI (D-068): the Istinto module in Settings → Squadra
 * (engine, uses, the TypeSafe key the core asks for), the pagella, the receipt
 * of a job with "Annulla tutto il lavoro", the lines of the instinct in
 * Attività, the confused monster and the brake on the actions that leave the
 * computer.
 */

test.use({ viewport: { width: 1440, height: 900 } });

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

test('the receipt of a job, and "Annulla tutto il lavoro" in two presses', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const receipt = page.getByTestId('receipt').first();
  await expect(receipt).toHaveAttribute('data-open', 'true');
  await expect(receipt.getByTestId('receipt-request')).toContainText(
    'summarize yesterday’s meeting',
  );
  const jobs = receipt.getByTestId('receipt-delegation');
  await expect(jobs).toHaveCount(2);
  await expect(jobs.first()).toContainText('really finished');
  await expect(jobs.last()).toContainText('in doubt');
  await expect(
    receipt.getByTestId('receipt-criterion').filter({ hasText: 'guide' }),
  ).toHaveAttribute('data-ok', 'false');
  await expect(receipt.getByTestId('receipt-note')).toHaveText('Summary of the meeting with Bruno');
  await expect(receipt).toContainText('One text with orders for the monsters removed');
  await expect(receipt.getByTestId('receipt-cost')).toContainText('steps');

  const undo = receipt.getByTestId('receipt-undo');
  await undo.click();
  await expect(undo).toHaveAttribute('data-state', 'armed');
  await expect(undo).toHaveAccessibleName('Press again to undo the whole job');
  await expect(undo).toContainText('Again');
  await undo.click();
  await expect(receipt.getByTestId('receipt-undone')).toContainText('Undone · 3 changes');
  await expect(receipt.getByTestId('receipt-undo')).toHaveCount(0);
  await expect(receipt.getByTestId('receipt-summary')).toHaveText('Job undone');
  // The lines of the instinct in the chat: who does it, and what it said of a task.
  await expect(
    page.getByTestId('instinct-line').filter({ hasText: 'Dione will handle it' }),
  ).toBeVisible();
  await expect(page.getByTestId('task-check').filter({ hasText: 'in doubt' })).toBeVisible();
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
