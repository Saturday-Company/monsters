import { expect, test } from './fixtures.ts';

/*
 * The polish of the instrument after the visual review (D-066): Back on a
 * phone closes the sheet first, Ferma loses nothing, the palette of ⌘K finds
 * monsters, notes and messages, "Da rivedere" is there on every window.
 */

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Indietro with "Dietro le quinte" open closes the sheet only (UI-01)', async ({ page }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await page.getByTestId('behind-the-scenes').click();
    await expect(page.getByTestId('agent-terminal')).toBeVisible();
    await page.getByTestId('toolbar-back').click();
    await expect(page.getByTestId('agent-terminal')).toHaveCount(0);
    // Still in Titan's chat: the second Back goes home.
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page).toHaveURL(/chat=titan/);
    await page.getByTestId('toolbar-back').click();
    await expect(page.getByTestId('chat-panel')).toHaveCount(0);
    await expect(page.getByTestId('agent-terminal')).toHaveCount(0);
  });

  test('another chat closes the sheet of the terminal', async ({ page }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await page.getByTestId('behind-the-scenes').click();
    await expect(page.getByTestId('agent-terminal')).toBeVisible();
    await page.evaluate(() => (window.location.hash = '#/?chat=dione'));
    await expect(page.getByTestId('agent-terminal')).toHaveCount(0);
  });

  test('"Da rivedere" opens as a sheet, Indietro closes it (UI-05)', async ({ page }) => {
    await page.goto('/?mock=demo#/?chat=titan');
    await page.getByTestId('review-toggle').click();
    const sheet = page.getByTestId('review-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('pending-question')).toBeVisible();
    await page.getByTestId('toolbar-back').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('chat-panel')).toBeVisible();
  });
});

test('below 1280 px "Da rivedere" is a sheet, with the number of what waits (UI-05)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/?mock=demo#/?chat=titan');
  const key = page.getByTestId('review-toggle');
  await expect(key).toBeVisible();
  await expect(key.getByTestId('review-count')).toHaveText(/^[1-9]/);
  await key.click();
  await expect(page.getByTestId('review-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('review-sheet')).toHaveCount(0);
});

test('Ferma keeps the question: in the band, then "Chiedimelo di nuovo" (UI-02)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  const card = page.getByTestId('question-card').first();
  await expect(card).toHaveAttribute('data-status', 'open');
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  const band = page.getByTestId('halt-banner');
  await expect(band.getByTestId('halt-left')).toContainText('Titan’s question');
  // The band names whose messages start again with "Riprendi e continua".
  await expect(band.getByTestId('halt-again')).toContainText('the message for Titan');
  // Never the tick of "done" on a question nobody answered.
  await expect(card).toHaveAttribute('data-status', 'expired');
  await expect(card.getByTestId('question-expired')).toContainText('you stopped the monsters');
  // While stopped the band does it; plain "Riprendi" restarts nothing by itself.
  await expect(card.getByTestId('ask-again')).toHaveCount(0);
  await band.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(band).toHaveCount(0);
  const bubbles = await page.getByTestId('user-bubble').count();
  await card.getByTestId('ask-again').click();
  // The request starts again as a status line, not as a message typed again (D-072).
  await expect(page.getByTestId('system-row').last()).toContainText(
    'Picked the stopped work back up',
  );
  await expect(page.getByTestId('user-bubble')).toHaveCount(bubbles);
  await expect(card.getByTestId('ask-again')).toHaveCount(0);
});

test('"Riprendi e continua" starts the stopped request again, without a new bubble (D-072)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('question-card').first()).toBeVisible();
  const before = await page.getByTestId('user-bubble').count();
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await page.getByTestId('halt-continue').click();
  await expect(page.getByTestId('halt-banner')).toHaveCount(0);
  await expect(page.getByTestId('system-row').last()).toContainText(
    'Picked the stopped work back up: “Hi Titan!',
  );
  // The work starts again (Titan answers), and the user's messages are the same.
  const answers = await page.getByTestId('agent-bubble').count();
  await expect
    .poll(() => page.getByTestId('agent-bubble').count(), { timeout: 15_000 })
    .toBeGreaterThan(answers);
  await expect(page.getByTestId('user-bubble')).toHaveCount(before);
});

test('the palette finds notes and messages, and runs commands (UI-03, UX 2)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/?chat=titan');
  await page.getByTestId('search-key').click();
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await input.fill('lis');
  const palette = page.getByTestId('palette');
  await expect(palette.getByRole('group', { name: 'Notes' })).toContainText('Lisbon, weekend tips');
  await expect(palette.getByRole('group', { name: 'Messages' })).toContainText('Lisbon');
  // Arrows and Enter: the first note opens in Note.
  await input.press('Enter');
  await expect(page).toHaveURL(/#\/notes\?note=/);
  await expect(palette).toHaveCount(0);

  // A command: the theme, from anywhere.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('dark theme');
  await page.getByTestId('palette-input').press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Esc closes; the sidebar was never filtered (the four of the team under the god's bar and
  // the three of the project).
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('zzz');
  await expect(page.getByTestId('palette')).toContainText('Nothing for “zzz”');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('chat-row')).toHaveCount(7);
});

test('"Ferma tutti i mostri" in the palette lifts the cover, never stops by itself', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette-input').fill('stop');
  await page.getByTestId('palette-input').press('Enter');
  await expect(page.getByTestId('kill')).toHaveAttribute('data-state', 'armed');
  await expect(page.getByTestId('halt-banner')).toHaveCount(0);
});

test('an error at the end of a chat offers Riprova and Dietro le quinte (UI-14)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=mimas');
  const actions = page.getByTestId('error-actions');
  await expect(actions).toBeVisible();
  await expect(page.getByTestId('suggestions')).toHaveCount(0);
  await actions.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('user-bubble').last()).toContainText(
    'Try again: “Update the expenses sheet”',
  );
});

test('the answer line waits for words and can be turned off (UI-15)', async ({ page }) => {
  await page.goto('/?mock=demo#/?chat=titan');
  await expect(page.getByTestId('question-card').first()).toBeVisible();
  const input = page.getByTestId('composer-input');
  await input.fill('@');
  await expect(page.getByTestId('composer-answering')).toHaveCount(0);
  await input.fill('Let’s go friendly');
  await expect(page.getByTestId('composer-answering')).toContainText('Answering');
});
