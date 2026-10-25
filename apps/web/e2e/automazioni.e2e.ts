import type { Page } from '@playwright/test';
import {
  expect,
  expectNoSideScroll,
  holdMock,
  releaseMock,
  setTechnicalDetails,
  stepMockUntil,
  test,
} from './fixtures.ts';

/*
 * The Automazioni section (plan of 17/10 §3 B3, D-094) on the mock core: the
 * demo has Giulio's example, "Post della settimana" in the project "Social di
 * Saturday" (its lead Iapetus with Calypso and Pandora, every Sunday at 23:00)
 * with the giri of the last two Sundays. `MONSTERS_E2E_SHOTS=<folder>` saves the screenshots of the design
 * review (desktop and phone, light and dark).
 */

const SHOTS = process.env['MONSTERS_E2E_SHOTS'];

async function closeNotice(page: Page) {
  // The demo's notice (a tool in pause) would cover the page.
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.count()) {
    await close.first().click();
    await expect(close).toHaveCount(0);
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await closeNotice(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

interface MockHooks {
  __monstersMock: {
    automations: {
      propose(input: { name: string; lead: string; participants?: string[] }): string;
    };
    handle(method: string, path: string, body: unknown): unknown;
  };
}

test('Automazioni: from the sidebar, the list by squad, the detail and a giro', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  const sidebar = page.getByTestId('sidebar');
  // Above Note, with its shortcut.
  const links = sidebar.getByRole('navigation', { name: 'Sections' }).getByRole('link');
  await expect(links.first()).toHaveAccessibleName('Automations');
  await expect(links.nth(1)).toHaveAccessibleName('Notes');
  await links.first().click();
  await expect(page).toHaveURL(/#\/automazioni$/);
  const toolbar = page.locator('[data-titlebar]');
  await expect(toolbar.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible();

  const squad = page.getByTestId('automation-squad');
  await expect(squad).toHaveCount(1);
  await expect(squad.getByRole('heading')).toHaveText('Saturday Social · 1');
  const row = page.getByTestId('automation-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Weekly posts');
  await expect(row).toContainText('every Sunday at 11:00 PM · Iapetus with Calypso and Pandora');
  await expect(row.getByTestId('run-state')).toHaveAttribute('data-state', 'completed');
  await expect(row.getByTestId('automation-next')).toContainText(/^Next: Sun, /);
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(row.getByTestId('crew-screen').first()).toBeVisible();
  await shot(page, 'automazioni-elenco-chiaro');

  await row.getByRole('link').click();
  await expect(page).toHaveURL(/#\/automazioni\?automazione=post-della-settimana$/);
  const detail = page.getByTestId('automation-detail');
  await expect(detail.getByTestId('automation-name')).toHaveText('Weekly posts');
  await expect(detail.getByTestId('automation-objective')).toContainText(
    'Prepare the posts of the Saturday page',
  );
  await expect(detail.getByTestId('automation-next-runs').getByRole('listitem')).toHaveCount(3);
  const crew = detail.getByTestId('automation-crew');
  await expect(crew.getByRole('listitem')).toHaveCount(3);
  await expect(crew.getByRole('listitem').first()).toContainText('IapetusLead');
  await expect(detail.getByTestId('automation-results')).toContainText(
    'Projects/Saturday Social/Posts',
  );
  await expect(detail.getByTestId('automation-results')).toContainText(
    'in the app and on Telegram',
  );
  const giri = detail.getByTestId('giro-row');
  await expect(giri).toHaveCount(2);
  await expect(giri.first()).toHaveAttribute('data-state', 'completed');
  await expect(giri.first()).toContainText('on schedule');
  // The tokens are technical details: off by default (D-181), here when they are turned on.
  await expect(giri.first()).toContainText(/4 steps · free/i);
  await expect(giri.first()).not.toContainText('tokens');
  await setTechnicalDetails(page, true);
  await expect(giri.first()).toContainText(/4 steps · 16,480 tokens · free/i);

  await giri.first().getByRole('link').click();
  await expect(page).toHaveURL(/&giro=run_auto_/);
  const giro = page.getByTestId('giro-view');
  await expect(giro).toHaveAttribute('data-state', 'completed');
  await expect(giro.getByTestId('giro-objective')).toContainText('[Automation “Weekly posts”');
  await expect(giro.getByTestId('giro-final')).toContainText('the posts for the week');
  // The wikilink of the answer is a note chip (Markdown).
  await expect(giro.getByTestId('giro-final').getByTestId('note-chip')).toHaveCount(1);
  await expect(giro.getByTestId('giro-note')).toHaveCount(1);
  await expect(giro.getByTestId('giro-note')).toHaveAttribute('href', /#\/note\?nota=Projects/);
  // Iapetus, Calypso (who worked for it) and Iapetus's answer.
  await expect(giro.getByTestId('giro-message')).toHaveCount(3);
  await expect(giro.getByTestId('giro-message').nth(1)).toContainText('Calypso · for the lead');
  await page.getByRole('link', { name: 'Back to “Weekly posts”' }).click();
  await expect(detail).toBeVisible();
});

test('Automazioni: the giri are not in the chat of the capo', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=iapetus');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(page.getByTestId('chat-panel')).not.toContainText('[Automation “Weekly posts”');
  await expect(page.getByTestId('chat-panel')).not.toContainText('I’ll hand the plan and the copy');
});

test('Automazioni: a new one with a preset, the advanced rule and its next giri', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni');
  await page.getByTestId('automation-new').click();
  const form = page.getByTestId('automation-form');
  await expect(form.getByRole('heading', { name: 'New automation' })).toBeVisible();
  // Nothing written: the form says what is missing.
  await page.getByTestId('form-save').click();
  await expect(form).toContainText('Give the automation a name.');
  await page.getByTestId('form-name').fill('Friday summary');
  await page.getByTestId('form-objective').fill('Give me a summary of the week’s notes.');

  const preset = form.getByRole('radiogroup', { name: 'When it runs' });
  const preview = page.getByTestId('form-schedule-text');
  await preset.getByRole('radio', { name: 'Every day' }).click();
  await page.getByTestId('form-time').fill('08:30');
  await expect(preview).toHaveText('every day at 8:30 AM');
  await expect(page.getByTestId('form-next-runs').getByRole('listitem')).toHaveCount(3);
  await preset.getByRole('radio', { name: 'Advanced' }).click();
  await expect(page.getByTestId('form-cron')).toHaveValue('30 8 * * *');
  await page.getByTestId('form-cron').fill('0 9 1 * *');
  await expect(preview).toHaveText('on the 1st of every month at 9:00 AM');
  await page.getByTestId('form-cron').fill('0 9 1 *');
  await expect(page.getByTestId('form-schedule-preview')).toContainText('Invalid rule');
  await preset.getByRole('radio', { name: 'Every week' }).click();
  // Monday is chosen: Friday too, at 18:00.
  await form.getByRole('button', { name: 'Friday' }).click();
  await page.getByTestId('form-time').fill('18:00');
  await expect(preview).toHaveText('every Monday and Friday at 6:00 PM');
  // Who takes part, the notes folder, the notices and the cap are behind "More options".
  await expect(page.getByTestId('pick-enceladus')).toHaveCount(0);
  await expect(page.getByTestId('form-folder')).toHaveCount(0);
  await expect(page.getByTestId('form-cap-eur')).toHaveCount(0);
  await expect(form.getByRole('heading', { name: 'Who does it' })).toHaveCount(0);
  const more = page.getByTestId('form-more');
  await expect(more.getByRole('button', { name: /More options/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await more.getByRole('button', { name: /More options/ }).click();
  await expect(more).toContainText('Nobody picked: the lead decides who helps.');
  await page.getByTestId('pick-enceladus').first().click();
  await expect(page.getByTestId('pick-enceladus').first()).toHaveAttribute('aria-checked', 'true');
  await form.getByRole('group', { name: 'Taking part' }).getByTestId('pick-rhea').click();
  await page.getByTestId('form-folder').fill('Summaries');
  // One cap, in euros; steps and tokens are in its Advanced drawer. Empty: the Safety net applies.
  await expect(more).toContainText('Cap per automation run (€)');
  await expect(more).toContainText('Empty: each run follows the Safety net of Settings → Models.');
  await expect(page.getByTestId('form-advanced')).toHaveAttribute('data-advanced', 'true');
  await expect(page.getByTestId('form-cap-steps')).toHaveCount(0);
  await expect(page.getByTestId('form-cap-tokens')).toHaveCount(0);
  await shot(page, 'automazioni-nuova-chiaro');
  await page.getByTestId('form-save').click();

  await expect(page).toHaveURL(/automazione=friday-summary$/);
  const detail = page.getByTestId('automation-detail');
  await expect(detail.getByTestId('automation-name')).toHaveText('Friday summary');
  await expect(detail.getByTestId('automation-monitor')).toContainText(
    'every Monday and Friday at 6:00 PM',
  );
  await expect(detail.getByTestId('automation-crew').getByRole('listitem')).toHaveCount(2);
  await expect(detail.getByTestId('automation-giri')).toContainText('No runs yet.');
  // No cap typed: the run follows the limits of every job.
  await expect(detail).toContainText('The one of every job (Settings → Models).');
  await page.locator('[data-titlebar]').getByRole('heading', { name: 'Automations' }).isVisible();
  await page.getByTestId('sidebar').getByRole('link', { name: 'Automations' }).click();
  await expect(page.getByTestId('automation-row')).toHaveCount(2);
});

test('Automazioni: a new one with just the basics asks for nothing else', async ({ page }) => {
  await page.goto('/?mock=demo#/automazioni');
  await page.getByTestId('automation-new').click();
  const form = page.getByTestId('automation-form');
  // Basic: name, goal, when. The rest is one closed row, with the lead deciding who takes part.
  await expect(form.getByTestId('form-name')).toBeVisible();
  await expect(form.getByTestId('form-objective')).toBeVisible();
  await expect(form.getByRole('radiogroup', { name: 'When it runs' })).toBeVisible();
  const more = page.getByTestId('form-more');
  await expect(more).toContainText('Who takes part, notes folder, notices and a cap per run.');
  await expect(more.getByRole('button', { name: /More options/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByTestId('form-cap-eur')).toHaveCount(0);
  await expect(form).not.toContainText('Tokens');
  await expect(form).not.toContainText('Amount of work');
  await page.getByTestId('form-name').fill('Quiet check');
  await page.getByTestId('form-objective').fill('Look for anything that needs me.');
  await page.getByTestId('form-save').click();
  await expect(page).toHaveURL(/automazione=quiet-check$/);
  await expect(page.getByTestId('automation-detail')).toContainText(
    'The one of every job (Settings → Models).',
  );
});

test('Automazioni: one cap in euros, steps and tokens in Advanced; a change opens the row on its values', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  await page.getByRole('button', { name: 'Edit' }).click();
  const form = page.getByTestId('automation-form');
  // The automation has a cap (60 steps, €2): the closed rows open on them.
  const more = page.getByTestId('form-more');
  await expect(more.getByRole('button', { name: /More options/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByTestId('form-cap-eur')).toHaveValue('2');
  const advanced = page.getByTestId('form-advanced');
  await expect(advanced.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByTestId('form-cap-steps')).toHaveValue('60');
  await expect(page.getByTestId('form-cap-tokens')).toHaveValue('');

  // A cap out of range is said where it is, and nothing is saved.
  await page.getByTestId('form-cap-eur').fill('5000');
  await page.getByTestId('form-save').click();
  await expect(form).toContainText('Euros from 0.01 to 1,000');
  await expect(page.getByTestId('form-cap-eur')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('form-cap-eur').fill('3,5');
  await page.getByTestId('form-cap-tokens').fill('300000');
  await page.getByTestId('form-save').click();
  const detail = page.getByTestId('automation-detail');
  await expect(detail).toContainText('€3.5 per run');
  await expect(detail).toContainText('300,000');
});

test('Automazioni: a closed row with a mistake in it opens when saving', async ({ page }) => {
  await page.goto('/?mock=demo#/automazioni');
  await page.getByTestId('automation-new').click();
  await page.getByTestId('form-name').fill('Careful one');
  await page.getByTestId('form-objective').fill('Check.');
  // The folder is typed in the open row, which is then closed again: the mistake reopens it.
  const more = page.getByTestId('form-more');
  await more.getByRole('button', { name: /More options/ }).click();
  await page.getByTestId('form-folder').fill('../outside');
  await more.getByRole('button', { name: /More options/ }).click();
  await expect(page.getByTestId('form-folder')).toHaveCount(0);
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('form-folder')).toBeVisible();
  await expect(page.getByTestId('form-folder')).toHaveAttribute('aria-invalid', 'true');
});

test('Automazioni: pause, Esegui ora, the chat of the busy capo, 409 when stopped', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  const detail = page.getByTestId('automation-detail');
  await expect(detail).toHaveAttribute('data-status', 'active');
  await detail.getByRole('button', { name: 'Pause' }).click();
  await expect(detail).toHaveAttribute('data-status', 'paused');
  await expect(detail.getByTestId('automation-monitor')).not.toContainText('next run');
  await detail.getByRole('button', { name: 'Resume' }).click();
  await expect(detail).toHaveAttribute('data-status', 'active');

  await holdMock(page);
  await detail.getByTestId('automation-run-now').click();
  const giro = page.getByTestId('giro-view');
  await stepMockUntil(page, () => giro.isVisible());
  await expect(giro).toHaveAttribute('data-state', 'running');
  await expect(giro.getByTestId('giro-objective')).toContainText('run now');
  // The capo works on the giro: its chat says so, and where to look.
  await page.evaluate(() => {
    window.location.hash = '#/?chat=iapetus';
  });
  await stepMockUntil(page, () => page.getByTestId('automation-busy').isVisible());
  await expect(page.getByTestId('automation-busy')).toContainText(
    'Running the automation “Weekly posts”: your message goes out as soon as it’s done',
  );
  await expect(page.getByTestId('working-row')).toHaveCount(0);
  await shot(page, 'automazioni-chat-occupato-chiaro');
  await releaseMock(page);
  await expect(page.getByTestId('automation-busy')).toHaveCount(0, { timeout: 15_000 });

  // Stopped: "Esegui ora" says why it does not start, and how to go on.
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  await page.evaluate(() =>
    (window as unknown as MockHooks).__monstersMock.handle('POST', '/api/kill', {}),
  );
  await expect(page.getByTestId('halt-banner')).toBeVisible();
  await page.getByTestId('automation-run-now').click();
  const problem = page.getByTestId('run-now-problem');
  await expect(problem).toContainText('The monsters are stopped');
  await problem.getByRole('button', { name: 'Resume the monsters' }).click();
  await expect(page.getByTestId('halt-banner')).toHaveCount(0);
});

test('Automazioni: a draft of a monster waits for "Conferma"; delete asks in the page', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni');
  await expect(page.getByTestId('automation-row')).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as MockHooks).__monstersMock.automations.propose({
      name: 'Notes summary',
      lead: 'enceladus',
    }),
  );
  // The `automation_change` of the stream reads the list again.
  const draft = page.getByTestId('automation-row').filter({ hasText: 'Notes summary' });
  await expect(draft).toHaveAttribute('data-status', 'draft');
  await expect(draft).toContainText('Draft');
  await expect(draft.getByRole('switch')).toHaveCount(0);
  await draft.getByRole('link').click();
  const banner = page.getByTestId('draft-banner');
  await expect(banner).toContainText('Draft: confirm');
  await expect(banner).toContainText('Enceladus suggested it.');
  await expect(page.getByTestId('automation-run-now')).toHaveCount(0);
  await shot(page, 'automazioni-bozza-chiaro');
  await banner.getByRole('button', { name: 'Confirm' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('automation-detail')).toHaveAttribute('data-status', 'active');
  await expect(page.getByTestId('automation-run-now')).toBeVisible();

  // Delete: a confirmation in the page, not a dialog of the browser.
  page.on('dialog', () => {
    throw new Error('no browser dialogs');
  });
  await page.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toContainText('Delete “Notes summary”?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/#\/automazioni$/);
  await expect(page.getByTestId('automation-row')).toHaveCount(1);
});

test('Automazioni on a phone: each level full screen, the rail goes one level up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo');
  await page.getByTestId('sidebar').getByRole('link', { name: 'Automations' }).click();
  await expect(page.getByTestId('automation-row')).toBeVisible();
  await expectNoSideScroll(page, 390);
  await page.getByTestId('automation-row').getByRole('link').click();
  const back = page.getByTestId('toolbar-back');
  await expect(back).toHaveText('Automations');
  await page.getByTestId('giro-row').first().getByRole('link').click();
  await expect(page.getByTestId('giro-view')).toBeVisible();
  await expect(page.getByTestId('giro-final').getByTestId('note-chip')).toHaveCount(1);
  await expect(back).toHaveText('Runs');
  await shot(page, 'automazioni-giro-telefono-chiaro');
  await back.click();
  await expect(page.getByTestId('automation-detail')).toBeVisible();
  await back.click();
  await expect(page.getByTestId('automation-row')).toBeVisible();
});

for (const scheme of ['dark', 'light'] as const) {
  test(`Automazioni: the detail in ${scheme}, desktop and phone`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
    await expect(page.getByTestId('giro-row')).toHaveCount(2);
    await shot(page, `automazioni-dettaglio-${scheme === 'dark' ? 'scuro' : 'chiaro'}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('automation-detail')).toBeVisible();
    await expectNoSideScroll(page, 390);
    await shot(page, `automazioni-dettaglio-telefono-${scheme === 'dark' ? 'scuro' : 'chiaro'}`);
  });
}

test('Automazioni: an open question of a giro is answered on its page (collaudo of 17/10)', async ({
  page,
}) => {
  // On a real core a capo asked "Cosa vuoi che esca questa settimana?" during
  // a giro: the page said "Rispondi qui sotto, nel campo dei messaggi" and had
  // no field, and a message in the capo's chat does not answer a giro (D-094).
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  const detail = page.getByTestId('automation-detail');
  await expect(detail).toHaveAttribute('data-status', 'active');
  await holdMock(page);
  await detail.getByTestId('automation-run-now').click();
  const giro = page.getByTestId('giro-view');
  await stepMockUntil(page, () => giro.isVisible());
  await expect(page).toHaveURL(/&giro=/);
  const runId = /giro=([^&]+)/.exec(page.url())![1]!;
  await page.evaluate((run) => {
    const mock = (
      window as unknown as {
        __monstersMock: {
          ask(
            a: string,
            r: string,
            q: string,
            o: unknown[],
            rec: undefined,
            then: () => void,
          ): void;
        };
      }
    ).__monstersMock;
    mock.ask('iapetus', run, 'What do you want out this week?', [], undefined, () => {});
  }, runId);
  const card = giro.getByTestId('giro-questions').getByTestId('question-card');
  await stepMockUntil(page, () => card.isVisible());
  await expect(card).toHaveAttribute('data-status', 'open');
  await expect(card).toContainText('Write your answer below.');
  await expect(card).not.toContainText('in the message field');
  const input = card.getByTestId('question-answer-input');
  await input.fill('Three posts: the launch, the studio, a tip.');
  await card.getByRole('button', { name: 'Answer' }).click();
  await stepMockUntil(
    page,
    async () => (await card.getByTestId('question-answer-input').count()) === 0,
  );
  await releaseMock(page);
});
