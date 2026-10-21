import { fileURLToPath } from 'node:url';
import { test } from './fixtures.ts';

/*
 * Visual check of the polish pass: `SCREENSHOTS=1 pnpm exec playwright test
 * rifinitura` writes the chats, the chat with Markdown and the action log (after
 * a stop), in light and dark, at 1440 and 390 px, into screenshots/rifinitura/.
 */

const OUT = fileURLToPath(new URL('../screenshots/rifinitura/', import.meta.url));
const enabled = !!process.env['SCREENSHOTS'];

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`rifinitura ${size.name} ${theme}`, () => {
      test.skip(!enabled, 'set SCREENSHOTS=1 to write the screenshots');
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });

      test('chats, chat with Markdown, log', async ({ page }) => {
        const shot = (what: string) =>
          page.screenshot({
            path: `${OUT}${what}-${theme}-${size.name}.png`,
            animations: 'disabled',
          });
        await page.goto('/?mock=demo&mockSpeed=0.2#/?chat=titan');
        await page.getByTestId('question-card').waitFor();
        await page.waitForTimeout(300);
        await shot('chat');

        await page
          .getByTestId('question-card')
          .getByRole('button', { name: /^Friendly/ })
          .click();
        const bubble = page
          .getByTestId('agent-bubble')
          .filter({ hasText: 'All done!' })
          .and(page.locator('[data-streaming="false"]'));
        await bubble.waitFor({ timeout: 15_000 });
        await page.waitForTimeout(500);
        await bubble.evaluate((el) => el.scrollIntoView({ block: 'end' }));
        await page.waitForTimeout(200);
        await shot('chat-markdown');

        await page.evaluate(() => {
          window.location.hash = '#/?chat=dione';
        });
        await page.getByRole('button', { name: 'Behind the scenes of Dione' }).first().click();
        await page.getByTestId('agent-terminal').waitFor();
        await page.waitForTimeout(400);
        await shot('terminale');
        await page.keyboard.press('Escape');

        await page.getByTestId('kill').click();
        await page.getByTestId('kill').click();
        await page.getByTestId('halt-banner').waitFor();
        await page.waitForTimeout(300);
        await shot('fermi');

        // Same session (the mock lives in the page): the log includes the stop.
        await page.evaluate(() => {
          window.location.hash = '#/log';
        });
        await page.getByTestId('event-row').first().waitFor();
        await page.waitForTimeout(300);
        await shot('log');

        await page
          .getByTestId('event-row')
          .filter({ hasText: 'Rhea created the note' })
          .getByRole('button', { name: 'Details' })
          .click();
        await page.waitForTimeout(200);
        await page
          .getByTestId('event-row')
          .filter({ hasText: 'Rhea created the note' })
          .evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        await shot('log-dettagli');
      });
    });
  }
}
