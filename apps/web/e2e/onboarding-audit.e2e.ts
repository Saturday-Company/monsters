import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import { answerQuestions, createAccount } from './onboarding-helpers.ts';

/*
 * Sign-in and first start after the UX audit (section 2) on the mock core:
 * every proposal that changed a behaviour has its check here.
 */

test('sign-in: the forgotten password explains the two ways back (D-057, 2.13)', async ({
  page,
}) => {
  await page.goto('/?mock=1');
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByRole('button', { name: 'Crea account' }).click();
  // The missing code: where to find it, without assuming a terminal.
  await expect(page.getByText('Inserisci il codice di avvio')).toContainText('monsters start');
  await page.getByLabel('Codice di avvio').fill(MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByTestId('onboarding')).toBeVisible();
  // Signing out is a small key on the rail, not among the steps (2.14, UI-39).
  await page.getByRole('button', { name: 'Esci dall’account' }).click();
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  const forgot = page.getByRole('button', { name: 'Ho dimenticato la password' });
  await expect(forgot).toHaveAttribute('aria-expanded', 'false');
  await forgot.click();
  const help = page.getByTestId('forgot-password');
  await expect(help).toContainText('entri senza password');
  await expect(help.locator('code')).toHaveText('monsters password');
});

test('one connected model is enough, whatever card is open (2.2, 2.16)', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  // Before its name is chosen the guide is "il tuo primo mostro".
  await expect(page.getByText('Il tuo primo mostro')).toBeVisible();
  const go = page.getByTestId('access-continue');
  const says = page.getByTestId('guide-says');
  await page.getByRole('radio', { name: /Piano ChatGPT/ }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await (await popup).close();
  await page.getByTestId('chatgpt-welcome').getByRole('button', { name: 'Got it' }).click();
  await expect(says).toContainText('il tuo piano ChatGPT');
  // Nothing left for later once a model is connected (audit UI-18).
  await expect(page.getByRole('button', { name: 'Lo faccio dopo' })).toHaveCount(0);
  // Looking at another card does not lose the plan.
  await page.getByRole('radio', { name: /Modelli gratuiti/ }).click();
  await expect(go).toBeEnabled();
  await expect(says).toContainText('Fatto! Adesso penso con il tuo piano ChatGPT');
  await go.click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await expect(page.getByText('Il tuo primo mostro')).toBeVisible();
  await page.getByRole('textbox', { name: 'Il tuo nome' }).fill('Giulio');
  await page.getByRole('button', { name: /^Avanti/ }).click();
  await expect(page.locator('[data-question="lavoro"]')).toBeVisible();
  await expect(page.getByText('Titan · il tuo capo')).toBeVisible();
});

test('a key of another provider is recognised and used (2.5)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('radio', { name: /Modelli gratuiti/ }).click();
  await page.getByLabel('La tua chiave di OpenRouter').fill('sk-ant-api03-prova-prova');
  await page.getByRole('button', { name: 'Verifica e continua' }).click();
  const offer = page.getByTestId('key-offer');
  await expect(offer).toContainText('Questa è una chiave di Anthropic: la uso per i mostri?');
  await offer.getByRole('button', { name: 'Sì, usala' }).click();
  await expect(page.getByTestId('other-ways').getByTestId('access-connected')).toContainText(
    'Chiave di Anthropic verificata',
  );
  await expect(page.getByTestId('guide-says')).toContainText('i modelli di Anthropic');
  await page.getByTestId('access-continue').click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await answerQuestions(page);
  await page.getByRole('button', { name: /Va bene, continua/ }).click();
  await page.getByRole('button', { name: /Conferma la squadra/ }).click();
  await page.getByRole('button', { name: /^Scrivi ad? / }).click();
  await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
  // The team moved to the Anthropic key: a model is connected.
  await expect(page.getByTestId('no-model')).toHaveCount(0);
});

test('"Lo faccio dopo" leaves the model step to do (2.3)', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'Lo faccio dopo' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  const first = page.getByRole('navigation', { name: 'Avanzamento' }).getByRole('listitem').first();
  await expect(first).toHaveAttribute('data-done', 'no');
  await expect(first).toHaveAttribute('data-todo', 'yes');
  await expect(first).toContainText('da fare');
});

test.describe('who writes software', () => {
  test.use({ locale: 'de-DE' });

  test('chips of the work, terminal on, language of the system (2.7, 2.9, 2.11, 2.12)', async ({
    page,
  }) => {
    // German browser, Italian app: the app speaks only English and Italian (D-153).
    await page.goto('/?mock=1&lang=it');
    await createAccount(page, MOCK_SETUP_CODE);
    await page.getByRole('button', { name: 'Lo faccio dopo' }).click();
    await page.getByRole('textbox', { name: 'Il tuo nome' }).fill('Giulio');
    await page.getByRole('button', { name: /^Avanti/ }).click();
    await expect(page.locator('[data-question="lavoro"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correggere bug' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sviluppo software' }).click();
    await expect(page.getByRole('button', { name: 'Correggere bug' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capire codice nuovo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pianificare i contenuti' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Scrivere test' }).click();
    await page.getByRole('button', { name: /^Avanti/ }).click();
    await expect(page.locator('[data-question="regole"]')).toBeVisible();
    await expect(page.getByTestId('guide-says')).toContainText('Due cose ancora');
    await expect(page.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: /^Avanti/ }).click();
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'permissions');
    await expect(page.getByRole('switch', { name: 'Terminale' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('senza permessi di amministratore')).toBeVisible();
  });
});
