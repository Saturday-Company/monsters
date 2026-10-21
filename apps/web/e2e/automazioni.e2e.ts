import type { Page } from '@playwright/test';
import {
  expect,
  expectNoSideScroll,
  holdMock,
  releaseMock,
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
  const close = page.getByRole('button', { name: 'Chiudi', exact: true });
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
  const links = sidebar.getByRole('navigation', { name: 'Sezioni' }).getByRole('link');
  await expect(links.first()).toHaveAccessibleName('Automazioni');
  await expect(links.nth(1)).toHaveAccessibleName('Note');
  await links.first().click();
  await expect(page).toHaveURL(/#\/automazioni$/);
  const toolbar = page.locator('[data-titlebar]');
  await expect(toolbar.getByRole('heading', { name: 'Automazioni', level: 1 })).toBeVisible();

  const squad = page.getByTestId('automation-squad');
  await expect(squad).toHaveCount(1);
  await expect(squad.getByRole('heading')).toHaveText('Social di Saturday · 1');
  const row = page.getByTestId('automation-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Post della settimana');
  await expect(row).toContainText('ogni domenica alle 23:00 · Iapetus con Calypso e Pandora');
  await expect(row.getByTestId('run-state')).toHaveAttribute('data-state', 'completed');
  await expect(row.getByTestId('automation-next')).toContainText(/^Prossimo: dom /);
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(row.getByTestId('crew-screen').first()).toBeVisible();
  await shot(page, 'automazioni-elenco-chiaro');

  await row.getByRole('link').click();
  await expect(page).toHaveURL(/#\/automazioni\?automazione=post-della-settimana$/);
  const detail = page.getByTestId('automation-detail');
  await expect(detail.getByTestId('automation-name')).toHaveText('Post della settimana');
  await expect(detail.getByTestId('automation-objective')).toContainText(
    'Prepara i post della pagina di Saturday',
  );
  await expect(detail.getByTestId('automation-next-runs').getByRole('listitem')).toHaveCount(3);
  const crew = detail.getByTestId('automation-crew');
  await expect(crew.getByRole('listitem')).toHaveCount(3);
  await expect(crew.getByRole('listitem').first()).toContainText('IapetusCapo');
  await expect(detail.getByTestId('automation-results')).toContainText(
    'Progetti/Social di Saturday/Post',
  );
  await expect(detail.getByTestId('automation-results')).toContainText('nell’app e su Telegram');
  const giri = detail.getByTestId('giro-row');
  await expect(giri).toHaveCount(2);
  await expect(giri.first()).toHaveAttribute('data-state', 'completed');
  await expect(giri.first()).toContainText('all’ora prevista');
  await expect(giri.first()).toContainText(/4 passi · 16\.480 token · gratis/i);

  await giri.first().getByRole('link').click();
  await expect(page).toHaveURL(/&giro=run_auto_/);
  const giro = page.getByTestId('giro-view');
  await expect(giro).toHaveAttribute('data-state', 'completed');
  await expect(giro.getByTestId('giro-objective')).toContainText(
    '[Automazione «Post della settimana»',
  );
  await expect(giro.getByTestId('giro-final')).toContainText('i post della settimana');
  // The wikilink of the answer is a note chip (Markdown).
  await expect(giro.getByTestId('giro-final').getByTestId('note-chip')).toHaveCount(1);
  await expect(giro.getByTestId('giro-note')).toHaveCount(1);
  await expect(giro.getByTestId('giro-note')).toHaveAttribute('href', /#\/note\?nota=Progetti/);
  // Iapetus, Calypso (who worked for it) and Iapetus's answer.
  await expect(giro.getByTestId('giro-message')).toHaveCount(3);
  await expect(giro.getByTestId('giro-message').nth(1)).toContainText('Calypso · per il capo');
  await page.getByRole('link', { name: 'Torna a «Post della settimana»' }).click();
  await expect(detail).toBeVisible();
});

test('Automazioni: the giri are not in the chat of the capo', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=iapetus');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(page.getByTestId('chat-panel')).not.toContainText(
    '[Automazione «Post della settimana»',
  );
  await expect(page.getByTestId('chat-panel')).not.toContainText('Passo il piano e i testi');
});

test('Automazioni: a new one with a preset, the advanced rule and its next giri', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni');
  await page.getByTestId('automation-new').click();
  const form = page.getByTestId('automation-form');
  await expect(form.getByRole('heading', { name: 'Nuova automazione' })).toBeVisible();
  // Nothing written: the form says what is missing.
  await page.getByTestId('form-save').click();
  await expect(form).toContainText('Dai un nome all’automazione.');
  await page.getByTestId('form-name').fill('Riassunto del venerdì');
  await page.getByTestId('form-objective').fill('Fammi il riassunto delle note della settimana.');

  const preset = form.getByRole('radiogroup', { name: 'Quando gira' });
  const preview = page.getByTestId('form-schedule-text');
  await preset.getByRole('radio', { name: 'Ogni giorno' }).click();
  await page.getByTestId('form-time').fill('08:30');
  await expect(preview).toHaveText('ogni giorno alle 8:30');
  await expect(page.getByTestId('form-next-runs').getByRole('listitem')).toHaveCount(3);
  await preset.getByRole('radio', { name: 'Avanzato' }).click();
  await expect(page.getByTestId('form-cron')).toHaveValue('30 8 * * *');
  await page.getByTestId('form-cron').fill('0 9 1 * *');
  await expect(preview).toHaveText('il 1° di ogni mese alle 9:00');
  await page.getByTestId('form-cron').fill('0 9 1 *');
  await expect(page.getByTestId('form-schedule-preview')).toContainText('Regola non valida');
  await preset.getByRole('radio', { name: 'Ogni settimana' }).click();
  // Monday is chosen: Friday too, at 18:00.
  await form.getByRole('button', { name: 'venerdì' }).click();
  await page.getByTestId('form-time').fill('18:00');
  await expect(preview).toHaveText('ogni lunedì e venerdì alle 18:00');
  await page.getByTestId('pick-enceladus').first().click();
  await expect(page.getByTestId('pick-enceladus').first()).toHaveAttribute('aria-checked', 'true');
  await form.getByRole('group', { name: 'Partecipano' }).getByTestId('pick-rhea').click();
  await page.getByTestId('form-folder').fill('Riassunti');
  await shot(page, 'automazioni-nuova-chiaro');
  await page.getByTestId('form-save').click();

  await expect(page).toHaveURL(/automazione=riassunto-del-venerdi$/);
  const detail = page.getByTestId('automation-detail');
  await expect(detail.getByTestId('automation-name')).toHaveText('Riassunto del venerdì');
  await expect(detail.getByTestId('automation-monitor')).toContainText(
    'ogni lunedì e venerdì alle 18:00',
  );
  await expect(detail.getByTestId('automation-crew').getByRole('listitem')).toHaveCount(2);
  await expect(detail.getByTestId('automation-giri')).toContainText('Ancora nessun giro.');
  await page.locator('[data-titlebar]').getByRole('heading', { name: 'Automazioni' }).isVisible();
  await page.getByTestId('sidebar').getByRole('link', { name: 'Automazioni' }).click();
  await expect(page.getByTestId('automation-row')).toHaveCount(2);
});

test('Automazioni: pause, Esegui ora, the chat of the busy capo, 409 when stopped', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  const detail = page.getByTestId('automation-detail');
  await expect(detail).toHaveAttribute('data-status', 'active');
  await detail.getByRole('button', { name: 'Metti in pausa' }).click();
  await expect(detail).toHaveAttribute('data-status', 'paused');
  await expect(detail.getByTestId('automation-monitor')).not.toContainText('prossimo giro');
  await detail.getByRole('button', { name: 'Riprendi' }).click();
  await expect(detail).toHaveAttribute('data-status', 'active');

  await holdMock(page);
  await detail.getByTestId('automation-run-now').click();
  const giro = page.getByTestId('giro-view');
  await stepMockUntil(page, () => giro.isVisible());
  await expect(giro).toHaveAttribute('data-state', 'running');
  await expect(giro.getByTestId('giro-objective')).toContainText('eseguita ora');
  // The capo works on the giro: its chat says so, and where to look.
  await page.evaluate(() => {
    window.location.hash = '#/?chat=iapetus';
  });
  await stepMockUntil(page, () => page.getByTestId('automation-busy').isVisible());
  await expect(page.getByTestId('automation-busy')).toContainText(
    'Sta facendo l’automazione «Post della settimana»: il tuo messaggio parte appena finisce',
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
  await expect(problem).toContainText('I mostri sono fermi');
  await problem.getByRole('button', { name: 'Riprendi i mostri' }).click();
  await expect(page.getByTestId('halt-banner')).toHaveCount(0);
});

test('Automazioni: a draft of a monster waits for "Conferma"; delete asks in the page', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni');
  await expect(page.getByTestId('automation-row')).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as MockHooks).__monstersMock.automations.propose({
      name: 'Riassunto delle note',
      lead: 'enceladus',
    }),
  );
  // The `automation_change` of the stream reads the list again.
  const draft = page.getByTestId('automation-row').filter({ hasText: 'Riassunto delle note' });
  await expect(draft).toHaveAttribute('data-status', 'draft');
  await expect(draft).toContainText('Bozza');
  await expect(draft.getByRole('switch')).toHaveCount(0);
  await draft.getByRole('link').click();
  const banner = page.getByTestId('draft-banner');
  await expect(banner).toContainText('Bozza: conferma');
  await expect(banner).toContainText('L’ha proposta Enceladus.');
  await expect(page.getByTestId('automation-run-now')).toHaveCount(0);
  await shot(page, 'automazioni-bozza-chiaro');
  await banner.getByRole('button', { name: 'Conferma' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('automation-detail')).toHaveAttribute('data-status', 'active');
  await expect(page.getByTestId('automation-run-now')).toBeVisible();

  // Delete: a confirmation in the page, not a dialog of the browser.
  page.on('dialog', () => {
    throw new Error('no browser dialogs');
  });
  await page.getByRole('button', { name: 'Elimina' }).click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toContainText('Elimino «Riassunto delle note»?');
  await confirm.getByRole('button', { name: 'Annulla' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Elimina' }).click();
  await confirm.getByRole('button', { name: 'Elimina' }).click();
  await expect(page).toHaveURL(/#\/automazioni$/);
  await expect(page.getByTestId('automation-row')).toHaveCount(1);
});

test('Automazioni on a phone: each level full screen, the rail goes one level up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo');
  await page.getByTestId('sidebar').getByRole('link', { name: 'Automazioni' }).click();
  await expect(page.getByTestId('automation-row')).toBeVisible();
  await expectNoSideScroll(page, 390);
  await page.getByTestId('automation-row').getByRole('link').click();
  const back = page.getByTestId('toolbar-back');
  await expect(back).toHaveText('Automazioni');
  await page.getByTestId('giro-row').first().getByRole('link').click();
  await expect(page.getByTestId('giro-view')).toBeVisible();
  await expect(page.getByTestId('giro-final').getByTestId('note-chip')).toHaveCount(1);
  await expect(back).toHaveText('Giri');
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
    mock.ask('iapetus', run, 'Cosa vuoi che esca questa settimana?', [], undefined, () => {});
  }, runId);
  const card = giro.getByTestId('giro-questions').getByTestId('question-card');
  await stepMockUntil(page, () => card.isVisible());
  await expect(card).toHaveAttribute('data-status', 'open');
  await expect(card).toContainText('Scrivi la tua risposta qui sotto.');
  await expect(card).not.toContainText('nel campo dei messaggi');
  const input = card.getByTestId('question-answer-input');
  await input.fill('Tre post: il lancio, lo studio, un consiglio.');
  await card.getByRole('button', { name: 'Rispondi' }).click();
  await stepMockUntil(
    page,
    async () => (await card.getByTestId('question-answer-input').count()) === 0,
  );
  await releaseMock(page);
});
