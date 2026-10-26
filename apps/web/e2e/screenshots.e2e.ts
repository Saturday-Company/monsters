import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { SHOT_LANG, test } from './fixtures.ts';

/*
 * Visual check: `pnpm --filter @monsters/web screenshots` writes the chats,
 * the chat with an open question, the terminal and the log, in light and dark,
 * at 1440 and 390 px, into apps/web/screenshots/.
 */

const OUT = process.env['SCREENSHOTS_DIR']
  ? `${process.env['SCREENSHOTS_DIR'].replace(/\/$/, '')}/`
  : fileURLToPath(new URL('../screenshots/', import.meta.url));
const shot2 = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}${name}.png`, animations: 'disabled' });
const enabled = !!process.env['SCREENSHOTS'];

/** Closes the demo's notices (a tool in pause), which come one at a time and cover the chat. */
async function closeNotices(page: Page) {
  const close = page.getByRole('button', {
    name: SHOT_LANG === 'it' ? 'Chiudi' : 'Close',
    exact: true,
  });
  for (let i = 0; i < 5 && (await close.count()); i++) {
    await close.first().click();
    await page.waitForTimeout(200);
  }
}

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name} ${theme}`, () => {
      test.skip(!enabled, 'set SCREENSHOTS=1 to write the screenshots');
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });

      test('chats, chat, terminal, log', async ({ page }) => {
        const shot = (what: string) =>
          page.screenshot({
            path: `${OUT}${what}-${theme}-${size.name}.png`,
            animations: 'disabled',
          });
        await page.goto('/?mock=demo');
        await page.getByTestId('chat-row').first().waitFor();
        await page.waitForTimeout(400);
        await shot('chat-elenco');

        await page.goto('/?mock=demo#/?chat=titan');
        await page.getByTestId('question-card').waitFor();
        await closeNotices(page);

        await page
          .getByTestId('question-card')
          .evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(200);
        await shot('chat-domanda');

        await page.evaluate(() => (window.location.hash = '#/?chat=rhea'));
        const behind =
          SHOT_LANG === 'it' ? 'Dietro le quinte di Rhea' : 'Behind the scenes of Rhea';
        await page.getByRole('button', { name: behind }).first().click();
        await page.getByTestId('agent-terminal').waitFor();
        await page.getByTestId('tool-line').first().click();
        await page.waitForTimeout(400);
        await shot('terminale');
        await page.keyboard.press('Escape');

        await page.goto('/?mock=demo#/log');
        await page.getByTestId('event-row').first().waitFor();
        await page.waitForTimeout(300);
        await shot('log');

        // A chat: on a phone the home is the sidebar, without the banner.
        await page.goto('/?mock=demo#/?chat=titan');
        await page.getByTestId('kill').click();
        await page.getByTestId('kill').click();
        await page.getByTestId('halt-banner').waitFor();
        await page.waitForTimeout(400);
        await shot('fermo');
      });

      test('notes: list and note, graph, history, trash', async ({ page }) => {
        const shot = (what: string) => shot2(page, `${what}-${theme}-${size.name}`);
        await page.goto('/?mock=demo#/note');
        await page.getByTestId('vault-list').getByTestId('vault-note-link').first().waitFor();
        await page.waitForTimeout(300);
        await shot('note-elenco');

        await page.goto('/?mock=demo#/note?nota=Resources%2FLisbon%2C%20weekend%20tips.md');
        await page.getByTestId('vault-related').getByRole('link').first().waitFor();
        await page.waitForTimeout(300);
        await shot('note-lettura');

        await page.getByTestId('vault-history-toggle').click();
        await page
          .getByTestId('vault-history-entry')
          .first()
          .getByRole('button', { name: 'Details' })
          .click();
        await page.getByTestId('vault-diff').first().waitFor();
        await page.waitForTimeout(300);
        await shot('note-cronologia');

        await page.goto('/?mock=demo#/note?vista=grafo');
        await page.getByTestId('vault-graph').locator('canvas').waitFor();
        await page.waitForTimeout(2500);
        await shot('note-grafo');

        await page.goto('/?mock=demo#/note?vista=cestino');
        await page.getByTestId('vault-trash-item').first().waitFor();
        await page.waitForTimeout(300);
        await shot('note-cestino');
      });

      test('empty chat after setup', async ({ page }) => {
        // A team that already exists: the onboarding hands over to the chats.
        await page.goto('/?mock=team');
        await page.getByLabel('Email').fill('giulio@example.com');
        await page.getByLabel('Password').fill('a-long-password');
        await page.getByLabel('Setup code').fill('424242');
        await page.getByRole('button', { name: 'Create account' }).click();
        await page.getByTestId('sidebar').waitFor();
        await page.evaluate(() => (window.location.hash = '#/?chat=titan'));
        await page.getByText('Tell me what you need').waitFor();
        await page.waitForTimeout(400);
        await shot2(page, `vuota-${theme}-${size.name}`);
      });

      test('chat bubbles after an answer', async ({ page }) => {
        await page.goto('/?mock=demo&mockSpeed=0.2#/?chat=titan');
        await page
          .getByTestId('question-card')
          .getByRole('button', { name: SHOT_LANG === 'it' ? /^Amichevole/ : /^Friendly/ })
          .click();
        await page
          .getByTestId('agent-bubble')
          .filter({ hasText: SHOT_LANG === 'it' ? 'Ecco fatto!' : 'All done!' })
          .and(page.locator('[data-streaming="false"]'))
          .waitFor();
        await closeNotices(page);
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `${OUT}chat-risposta-${theme}-${size.name}.png`,
          animations: 'disabled',
        });
      });

      test('chat at work, settings, onboarding', async ({ page }) => {
        const shot = (what: string) => shot2(page, `${what}-${theme}-${size.name}`);
        await page.goto('/?mock=demo&vita=1#/?chat=titan');
        await page.getByTestId('chat-panel').waitFor();
        await page.waitForTimeout(2500);
        await shot('chat-lavoro');

        await page.goto('/?mock=demo#/impostazioni');
        await page.getByRole('tab', { name: 'Squad' }).waitFor();
        await page.waitForTimeout(400);
        await shot('impostazioni');
        await page.getByRole('tab', { name: 'General' }).click();
        await page.waitForTimeout(300);
        await shot('impostazioni-generale');

        await page.goto('/?mock=1');
        await page.getByLabel('Email').fill('giulio@example.com');
        await page.getByLabel('Password').fill('a-long-password');
        await page.getByLabel('Setup code').fill('424242');
        await page.getByRole('button', { name: 'Create account' }).click();
        await page.getByTestId('onboarding').waitFor();
        await page.waitForTimeout(600);
        await shot('onboarding');
      });

      test('setup', async ({ page }) => {
        await page.goto('/?mock=1');
        await page.getByRole('heading', { name: 'Create your account' }).waitFor();
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${OUT}setup-${theme}-${size.name}.png`,
          animations: 'disabled',
        });
      });
    });
  }
}
