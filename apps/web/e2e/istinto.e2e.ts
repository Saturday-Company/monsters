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

const list = (page: Page) => page.getByRole('navigation', { name: 'Chat dei mostri' });
const row = (page: Page, name: string) =>
  list(page).getByRole('link', { name: new RegExp(`^${name},`) });

test('Istinto: who decides, what it does, and the key the core asks for', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=istinto');
  const section = page.getByTestId('instinct-section');
  await expect(section.getByRole('heading', { name: 'Decisioni dei mostri' })).toBeInViewport();
  // Plain words only: none of the jargon of the core.
  await expect(section).not.toContainText(/system 1|gate|shadow|soglia/i);
  const about = page.getByTestId('instinct-engine-about');
  await expect(about).toContainText('te le chiedono sempre');

  // The description of the engine follows the choice (UI-13).
  await section.getByRole('radio', { name: 'Modello piccolo' }).click();
  await expect(section.getByRole('radio', { name: 'Modello piccolo' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(about).toContainText('Usa uno dei tuoi modelli');

  // A use with a lever: off, and back on.
  await section.getByRole('button', { name: /Cosa fa/ }).click();
  const memory = page.getByTestId('instinct-use-memory');
  const lever = memory.getByRole('switch', { name: 'Ricorda solo quello che serve' });
  await expect(lever).toHaveAttribute('aria-checked', 'true');
  await lever.click();
  await expect(memory).toHaveAttribute('data-mode', 'off');
  await expect(lever).toHaveAttribute('aria-checked', 'false');
  await lever.click();
  await expect(memory).toHaveAttribute('data-mode', 'on');
  // The trial only takes notes; what needs Jev says so.
  const shortcut = page.getByTestId('instinct-use-shortcut');
  await expect(shortcut).toContainText('In prova');
  await expect(shortcut).toHaveAttribute('data-mode', 'shadow');
  await expect(page.getByTestId('instinct-use-route_hint')).toContainText(
    'Serve il modello esperto',
  );

  // Jev without a key: the core answers 409 no_key, the module asks for the key in words.
  await section.getByRole('radio', { name: 'Un modello esperto (TypeSafe)' }).click();
  await expect(page.getByTestId('no-key')).toContainText('serve prima la chiave di TypeSafe');
  const field = page.getByLabel('Chiave di TypeSafe');
  await expect(field).toBeFocused();
  await expect(about).toContainText('serve una chiave di TypeSafe');
  await field.fill('ts_live_1234567890abcdef');
  await page.getByRole('button', { name: 'Salva la chiave' }).click();
  await expect(page.getByTestId('typesafe-key-status')).toContainText('Attiva');
  await expect(
    section.getByRole('radio', { name: 'Un modello esperto (TypeSafe)' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('instinct-use-route_hint')).not.toContainText(
    'Serve il modello esperto',
  );

  // What leaves the computer, small, under the module.
  await page.getByTestId('instinct-privacy').locator('summary').click();
  await expect(page.getByTestId('instinct-privacy')).toContainText(
    'mai il contenuto delle tue note',
  );
});

test('the pagella of the monsters says honestly what it is waiting for', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=pagella');
  const card = page.getByTestId('scorecard');
  await expect(card.getByRole('heading', { name: 'Pagella dei mostri' })).toBeInViewport();
  await expect(page.getByTestId('scorecard-row-rhea')).toContainText('10 finiti davvero');
  await expect(page.getByTestId('scorecard-row-rhea')).toContainText('gratis a lavoro riuscito');
  await expect(card).toContainText('Servono almeno 20 lavori controllati');
});

test('the receipt of a job, and "Annulla tutto il lavoro" in two presses', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const receipt = page.getByTestId('receipt').first();
  await expect(receipt).toHaveAttribute('data-open', 'true');
  await expect(receipt.getByTestId('receipt-request')).toContainText('riassumi la riunione');
  const jobs = receipt.getByTestId('receipt-delegation');
  await expect(jobs).toHaveCount(2);
  await expect(jobs.first()).toContainText('finito davvero');
  await expect(jobs.last()).toContainText('in dubbio');
  await expect(
    receipt.getByTestId('receipt-criterion').filter({ hasText: 'guida' }),
  ).toHaveAttribute('data-ok', 'false');
  await expect(receipt.getByTestId('receipt-note')).toHaveText('Riassunto riunione con Bruno');
  await expect(receipt).toContainText('Un testo con ordini ai mostri tolto');
  await expect(receipt.getByTestId('receipt-cost')).toContainText('passi');

  const undo = receipt.getByTestId('receipt-undo');
  await undo.click();
  await expect(undo).toHaveAttribute('data-state', 'armed');
  await expect(undo).toHaveAccessibleName('Premi di nuovo per annullare tutto il lavoro');
  await expect(undo).toContainText('Di nuovo');
  await undo.click();
  await expect(receipt.getByTestId('receipt-undone')).toContainText('Annullato · 3 modifiche');
  await expect(receipt.getByTestId('receipt-undo')).toHaveCount(0);
  await expect(receipt.getByTestId('receipt-summary')).toHaveText('Lavoro annullato');
  // The lines of the instinct in the chat: who does it, and what it said of a task.
  await expect(
    page.getByTestId('instinct-line').filter({ hasText: 'Ci pensa Dione' }),
  ).toBeVisible();
  await expect(page.getByTestId('task-check').filter({ hasText: 'in dubbio' })).toBeVisible();
});

test('Attività: an order removed is important, the hint of the instinct is under Tutto', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/log');
  const rows = page.getByTestId('event-row');
  await expect(
    rows.filter({ hasText: 'Ho tolto da una pagina web (guida-lisbona.example)' }),
  ).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Ci pensa Dione' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Tutto' }).click();
  const hint = rows.filter({ hasText: 'Ci pensa Dione' });
  await expect(hint).toHaveCount(1);
  await expect(hint).toContainText('Decisioni dei mostri');
  await expect(
    rows.filter({ hasText: 'non aveva finito il lavoro: ho chiesto di completarlo' }),
  ).toHaveCount(1);
});

test('a monster going round in circles looks confused and says it changes its way', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=enceladus');
  await expect(row(page, 'Enceladus')).toContainText('Sta cambiando strada');
  await expect(row(page, 'Enceladus').locator('svg[data-dots]')).toHaveAttribute(
    'data-expression',
    'confused',
  );
  const monitor = page.getByTestId('chat-monitor');
  await expect(monitor).toHaveAttribute('data-confused', 'true');
  await expect(page.getByTestId('monitor-confused')).toHaveText(/sta cambiando strada/i);
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
  const composer = page.getByRole('combobox', { name: 'Messaggio' });
  await composer.fill('Pubblica il primo post su Instagram');
  await composer.press('Enter');
  const card = page.getByTestId('question-card').filter({ hasText: 'Procedo?' });
  await expect(card).toContainText('Dione vuole pubblicare il post');
  await card.getByRole('button', { name: /Sì, procedi/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  // The same page (the mock core lives in it): Attività by its link.
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'Hai detto sì: Dione può pubblicare' }),
  ).toHaveCount(1);
});
