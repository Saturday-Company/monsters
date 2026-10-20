import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import type { Page } from '@playwright/test';
import { expect, holdMock, releaseMock, stepMockUntil, test } from './fixtures.ts';

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
  await expect(page.getByRole('combobox', { name: 'Messaggio' })).toHaveAttribute(
    'placeholder',
    /^Scrivi a Titan/,
  );
}

test('setup with the one-time code, logout and login', async ({ page }) => {
  await page.goto('/?mock=1');
  await expect(page.getByRole('heading', { name: 'Crea il tuo account' })).toBeVisible();

  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('corta');
  await page.getByLabel('Codice di avvio').fill('111111');
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByText(/almeno 8 caratteri/)).toBeVisible();

  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByRole('alert')).toContainText('Il codice non è giusto');

  await page.getByLabel('Codice di avvio').fill(MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await expect(page).toHaveURL(/#\/benvenuto$/);

  await page.getByRole('button', { name: 'Esci dall’account' }).click();
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();

  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('sbagliata!!');
  await page.getByRole('button', { name: 'Entra' }).click();
  await expect(page.getByRole('alert')).toContainText('Email o password non corrette');

  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByRole('button', { name: 'Entra' }).click();
  // No team yet: back to the first start.
  await expect(page.getByTestId('onboarding')).toBeVisible();
});

test('sending a message shows the reply while it streams', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.6');
  await expireDemoQuestion(page);
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await input.fill('Preparami 3 post sul weekend a Lisbona');
  // The reply comes out one step at a time, so its streaming state cannot
  // come and go between two checks on a slow machine.
  await holdMock(page);
  await input.press('Enter');

  const bubble = page.getByTestId('agent-bubble').filter({ hasText: 'Ricevuto!' });
  const streaming = bubble.and(page.locator('[data-streaming="true"]'));
  await stepMockUntil(page, () => streaming.isVisible());
  await expect(page.getByTestId('user-bubble').last()).toHaveText(
    'Preparami 3 post sul weekend a Lisbona',
  );
  // Still held: the reply is partial and stays so.
  await expect(streaming).toBeVisible();
  await expect(bubble).not.toHaveText(/poi ti faccio sapere/);

  await releaseMock(page);
  await expect(bubble).toHaveAttribute('data-streaming', 'false');
  await expect(bubble).toHaveText(/Chiedo a Rhea di raccogliere qualche spunto su Lisbona/);
  await expect(page.getByTestId('delegation').filter({ hasText: 'ha finito' }).last()).toBeVisible({
    timeout: 15_000,
  });
});

test('answering a question with options', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  const card = page.getByTestId('question-card').first();
  await expect(card).toContainText('Che tono diamo ai post?');
  await expect(card.getByRole('button', { name: /Amichevole.*Consigliata/ })).toBeVisible();
  // The options only: words of one's own go in the composer (one field, not two).
  await expect(card.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('combobox', { name: 'Messaggio' })).toHaveAttribute(
    'placeholder',
    'Scrivi a Titan, oppure premi A, B o C',
  );
  await expect(page.getByTestId('chat-status')).toContainText('Aspetta una tua risposta');

  await card.getByRole('button', { name: /^Ironico/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('Hai scelto: Ironico');
  await expect(page.getByTestId('agent-bubble').filter({ hasText: 'tono ironico' })).toBeVisible({
    timeout: 15_000,
  });
});

test('agent messages render Markdown and note chips open the note in Anteprima', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockSpeed=0.2');
  await page
    .getByTestId('question-card')
    .getByRole('button', { name: /^Amichevole/ })
    .click();
  const bubble = page
    .getByTestId('agent-bubble')
    .filter({ hasText: 'Ecco fatto!' })
    .and(page.locator('[data-streaming="false"]'));
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  await expect(bubble.getByRole('heading', { name: 'Le bozze' })).toBeVisible();
  await expect(bubble.getByRole('table')).toBeVisible();
  await expect(bubble.locator('strong').first()).toHaveText('Tram 28 all’alba');
  await expect(bubble).not.toContainText('**');
  await expect(bubble).not.toContainText('[[');
  const site = bubble.getByRole('link', { name: /sito del turismo/ });
  await expect(site).toHaveAttribute('target', '_blank');
  await expect(site).toHaveAttribute('rel', 'noopener noreferrer');

  // The note opens beside the chat (D-075); "Apri nelle Note" goes to Notes.
  await bubble.getByTestId('note-chip').filter({ hasText: 'Bozze dei post' }).click();
  const dock = page.getByTestId('right-dock');
  await expect(dock.getByTestId('preview-title')).toHaveText('Bozze dei post');
  await dock.getByTestId('preview-open-notes').click();
  await expect(page).toHaveURL(/#\/note\?nota=Progetti%2FSocial%2FBozze(%20|\+)dei(%20|\+)post/);
  await expect(page.getByRole('heading', { name: 'Bozze dei post' }).first()).toBeVisible();
});

test('agents’ memories stay out of the recent notes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  // The "Attività" column is off by default, and remembered once on.
  await expect(page.getByTestId('activity-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Da rivedere' }).click();
  await expect(page.getByTestId('note-row').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('activity-panel')).toBeVisible();
  await expect(page.getByTestId('note-row').filter({ hasText: 'MEMORY' })).toHaveCount(0);
  // A row like the others, with its time (audit UI-38).
  await expect(page.getByTestId('memory-line')).toHaveText(
    /^Rhea ha aggiornato i suoi appunti·\s(adesso|\d+ min fa)$/,
  );
});

test('answering with free text, from the composer', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  const card = page.getByTestId('question-card').first();
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await input.fill('Un po’ poetico');
  await expect(page.getByTestId('composer-answering')).toContainText(
    'Risposta alla domanda di Titan',
  );
  await page.getByRole('button', { name: 'Invia la risposta' }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('Hai risposto: Un po’ poetico');
  await expect(input).toHaveAttribute('placeholder', /^Scrivi a Titan…/);
});

test('an open question out of sight: a bar above the composer brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 420 });
  await page.goto('/?mock=demo');
  // The notice of the demo takes a strip of this low window: it is closed first.
  await page
    .getByTestId('notice')
    .getByRole('button', { name: 'Chiudi' })
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
  await expect(bar).toContainText('Titan aspetta una tua risposta');
  await bar.click();
  await expect(card).toBeInViewport({ ratio: 0.5 });
  await expect(bar).toHaveCount(0);
});

test('answering an open question (no options)', async ({ page }) => {
  await page.goto('/?mock=demo&mockSpeed=0.4');
  await expireDemoQuestion(page);
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await input.fill('Prepara i post sul menu autunnale');
  await input.press('Enter');
  const card = page.getByTestId('question-card').filter({ hasText: 'Quali piatti' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('list', { name: 'Opzioni' })).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveCount(0); // the answer goes in the composer
  await expect(input).toHaveAttribute('placeholder', 'Rispondi a Titan');
  await input.fill('Ribollita e pappardelle al cinghiale');
  await input.press('Enter');
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('Hai risposto: Ribollita e pappardelle al cinghiale');
  await expect(
    page.getByTestId('agent-bubble').filter({ hasText: 'Preparo le bozze con questi piatti' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('opening the terminal of an agent', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.getByRole('link', { name: /^Rhea,/ }).click();
  await expect(page.getByRole('heading', { name: 'Rhea', level: 1 })).toBeVisible();
  await page.getByTestId('behind-the-scenes').click();
  const term = page.getByTestId('agent-terminal');
  await expect(term.getByRole('heading', { name: 'Dietro le quinte di Rhea' })).toBeVisible();
  await expect(term.getByTestId('terminal-log')).toContainText('Comincio dalle guide ufficiali');

  const tool = term.getByTestId('tool-line').first();
  await tool.click();
  await expect(tool).toHaveAttribute('aria-expanded', 'true');
  await expect(term.getByText('Dati inviati', { exact: true }).first()).toBeVisible();

  await term.getByRole('radio', { name: 'Errori' }).click();
  await expect(term.getByTestId('terminal-log')).toContainText('Timeout dopo 15 s');
  await expect(term.getByTestId('terminal-log')).not.toContainText('Comincio dalle guide');

  await page.keyboard.press('Escape');
  await expect(term).toBeHidden();
});

test('undoing a vault change from Attività, then Rifai from the toast', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  await expect(page.getByRole('heading', { name: 'Attività', exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: 'Filtra per tipo' })
    .getByRole('button', { name: 'Modifiche alle note' })
    .click();
  const row = page.getByTestId('event-row').filter({ hasText: 'Rhea ha creato la nota Lisbona' });
  await row.getByRole('button', { name: 'Annulla' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Modifica annullata' });
  await expect(toast).toBeVisible();
  await expect(row).toContainText('Annullata');
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'Hai annullato una modifica a' }),
  ).toBeVisible();

  // Rifai, from the toast: the note is back and the row offers Annulla again.
  await toast.getByRole('button', { name: 'Rifai' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Modifica rifatta' })).toBeVisible();
  await expect(row.getByTestId('undo')).toBeVisible();
  await expect(row).not.toContainText('Annullata');
  await page.goto('/?mock=demo#/note?nota=Risorse%2FLisbona%2C%20spunti%20per%20il%20weekend.md');
  await expect(page.locator('#vault-note-title')).toHaveText('Lisbona, spunti per il weekend');
});

test('Attività shows the important actions; "Tutto" and the filters', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  const rows = page.getByTestId('event-row');
  const shown = page.getByRole('radiogroup', { name: 'Cosa mostrare' });
  await expect(shown.getByRole('radio', { name: 'Importanti' })).toBeChecked();
  await expect(rows.filter({ hasText: 'Rhea ha creato la nota Lisbona' })).toBeVisible();
  // Replies and jobs only with "Tutto" (or their type under "Altri filtri").
  await expect(rows.filter({ hasText: 'Rhea ha risposto' })).toHaveCount(0);
  await shown.getByRole('radio', { name: 'Tutto' }).click();
  await expect(rows.filter({ hasText: 'Rhea ha risposto' }).first()).toBeVisible();
  await shown.getByRole('radio', { name: 'Importanti' }).click();
  await page.getByRole('button', { name: /^Altri filtri/ }).click();
  await page
    .getByRole('group', { name: 'Altri tipi' })
    .getByRole('button', { name: 'Lavori dei mostri' })
    .click();
  await expect(rows.filter({ hasText: 'Mimas ha iniziato un lavoro' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Rhea ha creato la nota' })).toHaveCount(0);
  // Who: one monster at a time.
  await page
    .getByRole('group', { name: 'Altri tipi' })
    .getByRole('button', { name: 'Lavori dei mostri' })
    .click();
  await page.getByTestId('activity-who').selectOption('mimas');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).toMatch(/Mimas/);
});

test('new conversation: clean chat, open question still answerable, old one on request', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockSpeed=0.2');
  const old = page.getByTestId('user-bubble').filter({ hasText: 'Mi prepari 3 post' });
  await expect(old).toBeVisible();
  const card = page.getByTestId('question-card').filter({ hasText: 'Che tono diamo ai post?' });
  await expect(card).toHaveAttribute('data-status', 'open');

  const fresh = page.getByRole('button', { name: 'Nuova conversazione' });
  await fresh.click();
  await expect(page.getByTestId('conversation-divider')).toBeVisible();
  await expect(page.getByTestId('user-bubble')).toHaveCount(0);
  await expect(page.getByTestId('agent-bubble')).toHaveCount(0);
  // Nothing new yet: no point in starting over again.
  await expect(fresh).toBeDisabled();
  // The question of before is still there, and can be answered.
  await expect(page.getByText('Ancora in attesa dalla conversazione precedente')).toBeVisible();
  await card.getByRole('button', { name: /^Amichevole/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  const posts = page.getByTestId('agent-bubble').filter({ hasText: 'tono amichevole' });
  await expect(posts).toHaveAttribute('data-streaming', 'false', { timeout: 15_000 });

  // The previous conversation is one click away.
  const toggle = page.getByTestId('earlier-toggle');
  await expect(toggle).toContainText('Mostra le conversazioni precedenti');
  await toggle.click();
  await expect(old).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(old).toBeHidden();

  // `/nuova` in the composer does the same (once the work in progress has ended).
  await expect(fresh).toBeEnabled();
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await expect(async () => {
    await input.fill('/nuova');
    await input.press('Enter');
    await expect(page.getByTestId('agent-bubble')).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(page.getByTestId('greeting')).toContainText(/sono Titan\./i);
  await expect(page.getByTestId('earlier-toggle')).toContainText('Mostra le conversazioni');

  // The action log keeps everything.
  await page.evaluate(() => {
    window.location.hash = '#/log';
  });
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'Hai iniziato una nuova conversazione' }),
  ).toHaveCount(2);
});

test('kill switch and resume', async ({ page }) => {
  await page.goto('/?mock=demo');
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('kill')).toHaveAttribute('data-state', 'armed');
  await expect(page.getByTestId('kill')).toContainText('Di nuovo');
  await expect(page.getByTestId('kill')).toHaveAttribute('title', /premi di nuovo per fermare/i);
  await page.getByTestId('kill').click();

  await expect(page.getByTestId('halt-banner')).toContainText('I mostri sono fermi');
  await expect(page.getByRole('link', { name: /^Rhea, in pausa/ })).toBeVisible();
  // The field stays on: what is written waits for "Riprendi".
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute(
    'placeholder',
    'Scrivi: il messaggio parte quando premi Riprendi',
  );
  await input.fill('Quando ripartite, preparami la lista della spesa');
  await input.press('Enter');
  const held = page.getByTestId('user-bubble').filter({ hasText: 'lista della spesa' });
  await expect(held).toHaveAttribute('data-held', 'true');
  await expect(page.getByTestId('held-note')).toContainText('Parte quando premi Riprendi');

  // "Riprendi" is in the banner too, and the held message goes.
  await page
    .getByTestId('halt-banner')
    .getByRole('button', { name: 'Riprendi', exact: true })
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
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await input.fill('@Rh');
  await expect(page.getByRole('option', { name: /Rhea/ })).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('@Rhea ');
  await input.pressSequentially('hai visto le mie note?');
  await expect(page.getByText('nella sua chat')).toBeVisible();
  await input.press('Enter');
  // The message goes to Rhea's chat, and the UI follows it there.
  await expect(page).toHaveURL(/#\/\?chat=rhea$/);
  await expect(page.getByRole('heading', { name: 'Rhea', level: 1 })).toBeVisible();
  await expect(page.getByTestId('user-bubble').last()).toHaveText('@Rhea hai visto le mie note?');
  await expect(page.getByTestId('agent-bubble').filter({ hasText: 'Ciao! Sono Rhea' })).toBeVisible(
    { timeout: 10_000 },
  );
});

test('settings: theme, OpenRouter and Brave keys', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni');
  await page.getByRole('tab', { name: 'Generale' }).click();
  const chassis = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chassis'));
  await page.getByRole('radio', { name: 'Scuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await chassis()).toBe('#151514');
  await page.getByRole('radio', { name: 'Chiaro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await chassis()).toBe('#e3e1db');
  // No transparency to reduce any more (D-062); sounds off, technical details on.
  await expect(page.getByRole('switch', { name: 'Riduci trasparenza' })).toHaveCount(0);
  const sounds = page.getByRole('switch', { name: 'Suoni' });
  await expect(sounds).toHaveAttribute('aria-checked', 'false');
  await sounds.click();
  await expect(sounds).toHaveAttribute('aria-checked', 'true');
  await sounds.click();
  await expect(page.getByRole('switch', { name: 'Mostra i dettagli tecnici' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await page.getByRole('tab', { name: 'Modelli' }).click();
  const openrouter = page.getByTestId('provider-row-openrouter');
  await openrouter.getByRole('button', { name: 'Cambia', exact: true }).click();
  await openrouter.getByRole('button', { name: 'Cambia chiave' }).click();
  const key = page.getByLabel('Nuova chiave');
  await key.fill('chiave-sbagliata');
  await openrouter.getByRole('button', { name: 'Verifica e salva' }).click();
  await expect(openrouter.getByRole('alert')).toBeVisible();
  await key.fill('sk-or-v1-0123456789abcdef');
  await openrouter.getByRole('button', { name: 'Verifica e salva' }).click();
  await expect(page.getByText('Chiave salvata.')).toBeVisible();
  await expect(openrouter.getByTestId('key-status')).toContainText('Monsters (mock)');

  await page.getByRole('tab', { name: 'Collegamenti' }).click();
  await expect(page.getByTestId('brave-key-status')).toHaveAttribute('data-set', 'no');
  await page.getByRole('button', { name: 'Aggiungi la chiave di Brave' }).click();
  await page.getByLabel('Chiave di Brave Search').fill('BSA0123456789abcdef');
  await page.getByRole('button', { name: 'Salva la chiave di Brave' }).click();
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
  await page.goto('/?mock=demo&mockSpeed=0.4');
  await expireDemoQuestion(page);
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await input.fill('Prepara il volantino del pranzo');
  await input.press('Enter');
  const card = page.getByTestId('question-card').filter({ hasText: 'Che formato' });
  // The turn ended: the card stays open, parked, and everything says the monster waits for you.
  await expect(card).toHaveAttribute('data-parked', 'true', { timeout: 15_000 });
  await expect(card).toHaveAttribute('data-status', 'open');
  await expect(card.getByTestId('question-parked')).toContainText('riparte quando rispondi');
  await expect(page.getByTestId('chat-status')).toContainText('Aspetta una tua risposta');
  const display = page.getByTestId('status-display');
  await expect(display).toHaveAttribute('data-state', 'questions');
  await expect(display).toContainText('Titan chiede');

  await card.getByRole('button', { name: /^A5 da banco/ }).click();
  await expect(card).toHaveAttribute('data-status', 'answered');
  await expect(card).toContainText('Hai scelto: A5 da banco');
  await expect(card.getByTestId('question-parked')).toHaveCount(0);
  await expect(
    page.getByTestId('agent-bubble').filter({ hasText: 'preparo il volantino in A5 da banco' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-status')).not.toContainText('Aspetta una tua risposta');
  await expect(display).not.toHaveAttribute('data-state', 'questions');
});
