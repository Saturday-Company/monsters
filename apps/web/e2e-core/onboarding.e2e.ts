import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../e2e/fixtures.ts';
import { answerQuestions, createAccount } from '../e2e/onboarding-helpers.ts';

/*
 * The whole first start against a real core (packages/core/test/e2e-server.ts):
 * account, questions, permissions, team proposal by a (fake) model with one
 * retry, edits, confirmation, files on disk, first chat.
 */

const HOME = process.env['MONSTERS_E2E_HOME']!;

test('first start against the real core', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Crea il tuo account' })).toBeVisible();
  const code = readFileSync(join(HOME, 'setup-code'), 'utf8').trim();
  await createAccount(page, code);

  // The fake provider counts as a configured model: no key step.
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await answerQuestions(page, { orchestrator: 'Atlas' });

  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'permissions');
  const vault = join(HOME, 'Monsters Note');
  const profile = readFileSync(join(vault, 'profilo.md'), 'utf8');
  expect(profile).toContain('type: profile');
  expect(profile).toContain('Seguo tre ristoranti');
  await page.getByRole('switch', { name: 'Il web' }).click();
  // The terminal; folders of the computer are granted later in the settings (D-053).
  await page.getByRole('switch', { name: 'Terminale' }).click();
  await page.getByRole('button', { name: /Va bene, continua/ }).click();

  // The model's first answer is not JSON: the core retries and gets the team.
  const members = page.getByTestId('member');
  await expect(members).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByText(/Proposta su misura/)).toBeVisible();
  await expect(page.getByText('web', { exact: true })).toHaveCount(0);

  const tethys = page.locator('[data-member="tethys"]');
  const before = await tethys.locator('svg').first().innerHTML();
  await page.getByRole('button', { name: 'Un altro aspetto per Tethys' }).click();
  await expect.poll(() => tethys.locator('svg').first().innerHTML()).not.toBe(before);
  await page.getByRole('button', { name: 'Rinomina Tethys' }).click();
  await page.getByLabel('Nuovo nome per Tethys').fill('Calendario');
  await page.getByRole('button', { name: 'Salva il nome' }).click();
  // Duties and folder are reviewed before the confirmation, and editable.
  const rhea = page.locator('[data-member="rhea"]');
  await page.getByRole('button', { name: 'Personalizza Rhea' }).click();
  await expect(page.getByLabel('Compiti di Rhea (uno per riga)')).toHaveValue(
    /Controlli sempre la data delle fonti\./,
  );
  await page.getByLabel('Cartella nelle note di Rhea').fill('Risorse/Food');
  await page.getByRole('button', { name: 'Salva compiti e cartella di Rhea' }).click();
  await expect(rhea.getByTestId('member-area')).toContainText('nelle note «Food»');
  await page.getByRole('button', { name: 'Togli Dione dalla squadra' }).click();
  await expect(members).toHaveCount(2);
  await page.getByRole('button', { name: /Conferma la squadra/ }).click();

  await expect(page.getByTestId('birth')).toBeVisible();
  await expect(page.getByTestId('welcome')).toContainText('Ciao Giulio! Sono Atlas');
  for (const id of ['atlas', 'rhea', 'calendario']) {
    expect(existsSync(join(HOME, 'agents', id, 'AGENTS.md'))).toBe(true);
  }
  expect(existsSync(join(HOME, 'agents', 'dione'))).toBe(false);
  const settings = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')) as {
    permissions: unknown;
  };
  expect(settings.permissions).toMatchObject({ web: false, shell: true, folders: [] });
  expect(readFileSync(join(HOME, 'agents', 'rhea', 'agent.yaml'), 'utf8')).toContain(
    'Risorse/Food/**',
  );
  expect(readFileSync(join(HOME, 'agents', 'rhea', 'agent.yaml'), 'utf8')).not.toContain(
    'web_search',
  );

  await page.getByRole('button', { name: 'Scrivi ad Atlas' }).click();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  const chats = page.getByRole('navigation', { name: 'Chat dei mostri' });
  await expect(chats.getByRole('link', { name: /^Calendario,/ })).toBeVisible();
  await expect(page.getByTestId('agent-bubble').first()).toContainText('Sono Atlas');

  // The new orchestrator answers: one closed bubble next to the welcome. The full
  // text, since `hasText` ignores case and the welcome says "ci sono" too.
  const bubbles = page.getByTestId('agent-bubble');
  await expect(bubbles).toHaveCount(1);
  const input = page.getByRole('combobox', { name: 'Messaggio' });
  await input.fill('ciao');
  await input.press('Enter');
  const reply = bubbles.filter({ hasText: 'Ciao Giulio! Ci sono, dimmi pure.' });
  await expect(reply).toHaveAttribute('data-streaming', 'false', { timeout: 15_000 });
  await expect(bubbles).toHaveCount(2);

  // A reload stays in the chat: the onboarding is over.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
});
