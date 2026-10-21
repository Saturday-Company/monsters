import { fileURLToPath } from 'node:url';
import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import { answerQuestions, connectOpenRouter, createAccount } from './onboarding-helpers.ts';

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
        await page.getByRole('radio', { name: /Claude subscription/ }).click();
        await page.getByRole('button', { name: 'Use Claude Code' }).click();
        await expect(page.getByTestId('claude-terminal-hint')).toBeVisible();
        await shot('1-modello-claude');
        await connectOpenRouter(page);

        await answerQuestions(page, {
          shot: async (name) => {
            const n = { 'domanda-nomi': '3', 'domanda-lavoro': '4', 'domanda-regole': '5' }[name];
            await shot(`${n}-${name}`);
          },
        });
        await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'permissions');
        await shot('6-permessi');
        await page.getByRole('button', { name: /Looks good, continue/ }).click();
        await expect(page.getByTestId('member')).toHaveCount(3);
        await shot('7-squadra');
        await page.getByRole('button', { name: 'Rename Tethys' }).click();
        await page.getByLabel('New name for Tethys').fill('Calendar');
        await shot('8-squadra-rinomina');
        await page.getByRole('button', { name: 'Save the name' }).click();
        await page.getByRole('button', { name: /Confirm the squad/ }).click();
        await expect(page.getByTestId('welcome')).toBeVisible();
        await shot('9-nascita');
        await page.getByRole('button', { name: /^Message / }).click();
        await expect(page.getByTestId('chat-panel')).toBeVisible();
        await shot('10-chat');
      });
    });
  }
}
