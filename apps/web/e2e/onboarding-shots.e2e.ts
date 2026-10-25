import { fileURLToPath } from 'node:url';
import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import { answerNames, connectOpenRouter, createAccount } from './onboarding-helpers.ts';

/*
 * Visual check of the first start: `SCREENSHOTS=1 pnpm exec playwright test
 * onboarding-shots` writes every main step, light and dark, at 1440 and 390 px,
 * into apps/web/screenshots/onboarding/ (or `ONBOARDING_SHOTS=<dir>`).
 */

const OUT = process.env['ONBOARDING_SHOTS']
  ? `${process.env['ONBOARDING_SHOTS'].replace(/\/+$/, '')}/`
  : fileURLToPath(new URL('../screenshots/onboarding/', import.meta.url));
const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${size.name} ${theme}`, () => {
      test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write the screenshots');
      test.use({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });

      test('onboarding steps', async ({ page }) => {
        test.setTimeout(90_000);
        const shot = async (what: string) => {
          await page.waitForTimeout(400);
          await page.screenshot({
            path: `${OUT}${what}-${theme}-${size.name}.png`,
            animations: 'disabled',
            fullPage: false,
          });
        };
        await page.goto('/?mock=1');
        await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
        await shot('0-registrazione');
        await page.getByRole('button', { name: 'Create account' }).click();
        await shot('0-registrazione-errori');
        await createAccount(page, MOCK_SETUP_CODE);
        await page.getByRole('button', { name: 'Sign out' }).click();
        await page.getByRole('button', { name: 'I forgot my password' }).click();
        await shot('0-accesso-password');
        await page.getByLabel('Email').fill('giulio@esempio.it');
        await page.getByLabel('Password').fill('una-password-lunga');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByTestId('onboarding')).toBeVisible();
        await shot('1-modello');
        await page.getByRole('button', { name: 'Other ways' }).click();
        await page.getByLabel('Your key', { exact: true }).fill('sk-ant-api03-prova');
        await page.getByRole('button', { name: 'Verify and save' }).last().click();
        await expect(page.getByTestId('key-offer')).toBeVisible();
        await shot('1-modello-altri-modi');
        await page.getByRole('button', { name: 'Other ways' }).click();
        await page.getByRole('radio', { name: /ChatGPT plan/ }).click();
        await shot('1-modello-chatgpt');
        await page.getByRole('radio', { name: /Claude plan/ }).click();
        await page.getByRole('button', { name: 'Use Claude Code' }).click();
        await expect(page.getByTestId('claude-terminal-hint')).toBeVisible();
        await shot('1-modello-claude');
        await connectOpenRouter(page);

        await answerNames(page, {
          shot: async (name) => {
            await shot(`2-${name}`);
          },
        });
        await expect(page.getByTestId('member')).toHaveCount(2);
        await shot('3-squadra');
        await page.getByRole('button', { name: 'Edit Rhea' }).click();
        await page.getByRole('button', { name: 'Rename Rhea' }).click();
        await page.getByLabel('New name for Rhea').fill('Calendar');
        await shot('4-squadra-modifica');
        await page.getByRole('button', { name: 'Save the name' }).click();
        await page.getByRole('button', { name: 'Looks good' }).click();
        await expect(page.getByTestId('welcome')).toBeVisible();
        await shot('5-nascita');
        await page.getByRole('button', { name: /^Message / }).click();
        await expect(page.getByTestId('chat-panel')).toBeVisible();
        await shot('6-chat');
        // The first answer of the lead brings the card and the row of first jobs.
        const input = page.getByRole('combobox', { name: 'Message' });
        await input.fill('hello');
        await input.press('Enter');
        await expect(page.getByText('What tone should we give the posts?')).toBeVisible({
          timeout: 20_000,
        });
        await input.fill('A');
        await input.press('Enter');
        await expect(page.getByTestId('tell-more-invite')).toBeVisible({ timeout: 40_000 });
        await shot('7-chat-invito');
        await page.getByRole('button', { name: 'Tell me more', exact: true }).click();
        await expect(page.getByTestId('tell-more')).toBeVisible();
        await shot('8-chat-dimmi-di-piu');
      });
    });
  }
}
