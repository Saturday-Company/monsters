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
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  const code = readFileSync(join(HOME, 'setup-code'), 'utf8').trim();
  await createAccount(page, code);

  // The fake provider counts as a configured model: no key step.
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await answerQuestions(page, { orchestrator: 'Atlas' });

  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'permissions');
  const vault = join(HOME, 'Monsters Note');
  const profile = readFileSync(join(vault, 'profilo.md'), 'utf8');
  expect(profile).toContain('type: profile');
  expect(profile).toContain('I follow three restaurants');
  await page.getByRole('switch', { name: 'The web' }).click();
  // The terminal; folders of the computer are granted later in the settings (D-053).
  await page.getByRole('switch', { name: 'Terminal' }).click();
  await page.getByRole('button', { name: /Looks good, continue/ }).click();

  // The model's first answer is not JSON: the core retries and gets the team.
  const members = page.getByTestId('member');
  await expect(members).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByText(/Tailor-made suggestion/)).toBeVisible();
  await expect(page.getByText('web', { exact: true })).toHaveCount(0);

  const tethys = page.locator('[data-member="tethys"]');
  const before = await tethys.locator('svg').first().innerHTML();
  await page.getByRole('button', { name: 'Another look for Tethys' }).click();
  await expect.poll(() => tethys.locator('svg').first().innerHTML()).not.toBe(before);
  await page.getByRole('button', { name: 'Rename Tethys' }).click();
  await page.getByLabel('New name for Tethys').fill('Calendar');
  await page.getByRole('button', { name: 'Save the name' }).click();
  // Duties and folder are reviewed before the confirmation, and editable.
  const rhea = page.locator('[data-member="rhea"]');
  await page.getByRole('button', { name: 'Customize Rhea' }).click();
  await expect(page.getByLabel('Rhea’s tasks (one per line)')).toHaveValue(
    /You always check the date of the sources\./,
  );
  await page.getByLabel('Rhea’s folder in the notes').fill('Resources/Food');
  await page.getByRole('button', { name: 'Save Rhea’s tasks and folder' }).click();
  await expect(rhea.getByTestId('member-area')).toContainText('in the notes “Food”');
  await page.getByRole('button', { name: 'Remove Dione from the squad' }).click();
  await expect(members).toHaveCount(2);
  await page.getByRole('button', { name: /Confirm the squad/ }).click();

  await expect(page.getByTestId('birth')).toBeVisible();
  await expect(page.getByTestId('welcome')).toContainText('Hi Giulio! I’m Atlas');
  for (const id of ['atlas', 'rhea', 'calendar']) {
    expect(existsSync(join(HOME, 'agents', id, 'AGENTS.md'))).toBe(true);
  }
  expect(existsSync(join(HOME, 'agents', 'dione'))).toBe(false);
  const settings = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')) as {
    permissions: unknown;
  };
  expect(settings.permissions).toMatchObject({ web: false, shell: true, folders: [] });
  expect(readFileSync(join(HOME, 'agents', 'rhea', 'agent.yaml'), 'utf8')).toContain(
    'Resources/Food/**',
  );
  expect(readFileSync(join(HOME, 'agents', 'rhea', 'agent.yaml'), 'utf8')).not.toContain(
    'web_search',
  );

  await page.getByRole('button', { name: 'Message Atlas' }).click();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  const chats = page.getByRole('navigation', { name: 'Monsters’ chats' });
  await expect(chats.getByRole('link', { name: /^Calendar,/ })).toBeVisible();
  await expect(page.getByTestId('agent-bubble').first()).toContainText('I’m Atlas');

  // The new orchestrator answers: one closed bubble next to the welcome. The full
  // text, since `hasText` ignores case and the welcome says "I’m here" too.
  const bubbles = page.getByTestId('agent-bubble');
  await expect(bubbles).toHaveCount(1);
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.fill('hello');
  await input.press('Enter');
  const reply = bubbles.filter({ hasText: 'Hi Giulio! I’m here, tell me.' });
  await expect(reply).toHaveAttribute('data-streaming', 'false', { timeout: 15_000 });
  await expect(bubbles).toHaveCount(2);

  // A reload stays in the chat: the onboarding is over.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
});
