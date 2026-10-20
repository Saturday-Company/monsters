import type { Locator, Page } from '@playwright/test';
import type * as AppStore from '../src/store/app.ts';
import { expect, test } from './fixtures.ts';

/*
 * Ferma is always visible and clickable (the project brief, ARCHITECTURE §8):
 * on every page, with the agent terminal, the ChatGPT modal or the @-mention
 * list open, in light and dark, on a wide screen and on a phone. "Covered" is
 * checked with `elementFromPoint` at the centre of the button.
 * `KILL_SHOTS=<dir>` also writes a shot of the terminal case.
 */

const SHOTS = process.env['KILL_SHOTS'];

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;

/** Visible, inside the viewport, on top at its centre, then clickable (cover up and down). */
async function expectKillReachable(page: Page, where: string) {
  const kill = page.getByTestId('kill');
  await expect(kill, `${where}: visible`).toBeVisible();
  await expect(kill, `${where}: in the viewport`).toBeInViewport({ ratio: 1 });
  const onTop = await kill.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      ok: !!hit && el.contains(hit),
      hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)}` : 'none',
    };
  });
  expect(onTop.ok, `${where}: covered by ${onTop.hit}`).toBe(true);
  // A real click, with Playwright's own hit-target check: the cover lifts; Escape closes it.
  await kill.click({ timeout: 3000 });
  await expect(kill, `${where}: armed`).toHaveAttribute('data-state', 'armed');
  await expect(kill).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(kill).toHaveAttribute('data-state', 'idle');
  await expect(kill).toBeVisible();
}

/** The app's own store module: Vite serves the page the same instance the app uses. */
const STORE = '/src/store/app.ts';

/** Opens Rhea's terminal through the store, over whatever page is on screen. */
const openRheaTerminal = (page: Page) =>
  page.evaluate(async (src) => {
    const { openTerminal } = (await import(/* @vite-ignore */ src)) as typeof AppStore;
    openTerminal('rhea');
  }, STORE);

async function openChatGPTModal(page: Page) {
  // Settings → Modelli, with the list of what can still be connected open.
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await page.getByRole('button', { name: 'Collega un altro modello' }).click();
  const card = page.getByTestId('subscription-chatgpt');
  const popup = page.waitForEvent('popup');
  await card.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await (await popup).close();
  const modal = page.getByTestId('chatgpt-welcome');
  await expect(modal.getByRole('heading', { name: /ChatGPT plan/ })).toBeVisible();
  return modal;
}

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`kill switch reachable everywhere (${size.name} px, ${theme})`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });

      // The chat list (the home of a phone).
      await page.goto('/?mock=demo');
      await expect(page.getByTestId('chat-row').first()).toBeVisible();
      await expectKillReachable(page, 'chat list');

      // The orchestrator's chat with the open question of the demo.
      await page.getByRole('link', { name: /^Titan,/ }).click();
      await expect(page.getByTestId('question-card').first()).toBeVisible();
      await expectKillReachable(page, 'chat with a question');

      // @-mention list of the composer.
      const input = page.getByRole('combobox', { name: 'Messaggio' });
      await input.fill('@');
      await expect(page.getByRole('option').first()).toBeVisible();
      await expectKillReachable(page, 'mention list');
      await input.fill('');

      // Agent terminal over the chat.
      await page.getByRole('button', { name: 'Dietro le quinte di Titan' }).first().click();
      const term = page.getByTestId('agent-terminal');
      await expect(term.getByRole('heading', { name: 'Dietro le quinte di Titan' })).toBeVisible();
      if (SHOTS) {
        await page.waitForTimeout(600); // the sheet fades in
        await page.screenshot({ path: `${SHOTS}/terminale-${size.name}-${theme}.png` });
      }
      await expectKillReachable(page, 'terminal');
      // The terminal stays open after using the kill switch, and still closes.
      await expect(term).toBeVisible();
      await page.getByTestId('dock-close').click();
      await expect(term).toBeHidden();

      // Log, notes (list, a note, graph, new, trash), each also with the terminal open.
      const views: [string, string, (p: Page) => Locator][] = [
        ['log', '#/log', (p) => p.getByRole('heading', { name: 'Attività', exact: true })],
        ['notes', '#/note', (p) => p.getByTestId('vault-view')],
        ['a note', '#/note?nota=Risorse%2FTram%2028.md', (p) => p.locator('#vault-note-title')],
        ['graph', '#/note?vista=grafo', (p) => p.getByTestId('vault-view')],
        ['new note', '#/note?vista=nuova', (p) => p.getByTestId('vault-view')],
        ['trash', '#/note?vista=cestino', (p) => p.getByTestId('vault-view')],
        ['settings', '#/impostazioni', (p) => p.getByRole('heading', { name: 'La squadra' })],
      ];
      for (const [where, hash, ready] of views) {
        await page.evaluate((h) => (window.location.hash = h), hash);
        await expect(ready(page)).toBeVisible();
        await expectKillReachable(page, where);
        await openRheaTerminal(page);
        await expect(term).toBeVisible();
        await expectKillReachable(page, `terminal over ${where}`);
        await page.getByTestId('dock-close').click();
        await expect(term).toBeHidden();
      }

      // The ChatGPT first-use modal.
      const modal = await openChatGPTModal(page);
      if (SHOTS) {
        await page.waitForTimeout(600); // the sheet fades in
        await page.screenshot({ path: `${SHOTS}/modale-${size.name}-${theme}.png` });
      }
      await expectKillReachable(page, 'ChatGPT modal');
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'Got it' }).click();
      await expect(modal).toBeHidden();

      // Stopped: "Riprendi" takes its place, as reachable, with the terminal open.
      await page.evaluate(() => (window.location.hash = '#/'));
      // The home: the orchestrator's chat, or the sidebar on a phone.
      await expect(page.getByTestId('chat-row').first()).toBeVisible();
      await openRheaTerminal(page);
      await expect(term).toBeVisible();
      await page.getByTestId('kill').click();
      await page.getByTestId('kill').click();
      const resume = page.getByTestId('resume');
      await expect(resume).toBeInViewport({ ratio: 1 });
      await resume.click();
      await expect(page.getByTestId('kill')).toBeVisible();
    });
  }
}
