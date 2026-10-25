import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../e2e/fixtures.ts';
import { answerNames, createAccount } from '../e2e/onboarding-helpers.ts';

/*
 * The whole express first start against a real core (packages/core/test/e2e-server.ts, C1):
 * account, the names, team proposal by a (fake) model with one retry, edits, confirmation, files
 * on disk, first chat, and the "Tell me more about you" card saved to the profile note.
 */

const HOME = process.env['MONSTERS_E2E_HOME']!;

test('first start against the real core', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  const code = readFileSync(join(HOME, 'setup-code'), 'utf8').trim();
  await createAccount(page, code);

  // The fake provider counts as a configured model: no key step.
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await answerNames(page, { orchestrator: 'Atlas' });

  // The names are all it asked: the profile note is written and says what it does not know.
  // A new install in English: an English vault (D-154), never the Italian names.
  const vault = join(HOME, 'Monsters Notes');
  const profilePath = join(vault, 'profile.md');
  const profile = readFileSync(profilePath, 'utf8');
  expect(existsSync(join(vault, 'profilo.md'))).toBe(false);
  expect(existsSync(join(vault, 'Agents'))).toBe(true);
  expect(existsSync(join(vault, 'Agenti'))).toBe(false);
  expect(profile).toContain('type: profile');
  expect(profile).toContain('- Name: Giulio');
  expect(profile).toContain('## What they do\n- not given');
  // They may use the notes, the web and run commands from the start (D-159), and the squad says so.
  await expect(page.getByTestId('permissions-note')).toContainText('run commands');
  const started = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')) as {
    permissions: unknown;
  };
  expect(started.permissions).toMatchObject({ vault: true, web: true, shell: true, folders: [] });

  // The model's first answer is not JSON: the core retries and gets the team.
  const members = page.getByTestId('member');
  await expect(members).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByText(/Suggestion tailored to you/)).toBeVisible();
  await expect(page.getByText('web', { exact: true })).toHaveCount(0);

  const tethys = page.locator('[data-member="tethys"]');
  const before = await tethys.locator('svg').first().innerHTML();
  await page.getByRole('button', { name: 'Edit Tethys' }).click();
  await page.getByRole('button', { name: 'Another look for Tethys' }).click();
  await expect.poll(() => tethys.locator('svg').first().innerHTML()).not.toBe(before);
  await page.getByRole('button', { name: 'Rename Tethys' }).click();
  await page.getByLabel('New name for Tethys').fill('Calendar');
  await page.getByRole('button', { name: 'Save the name' }).click();
  // What each one does and its folder are reviewed before the confirmation, and editable.
  const rhea = page.locator('[data-member="rhea"]');
  await page.getByRole('button', { name: 'Edit Rhea' }).click();
  await page.getByRole('button', { name: 'Change what Rhea does' }).click();
  await expect(page.getByLabel('What Rhea does (one per line)')).toHaveValue(
    /You always check the date of the sources\./,
  );
  await page.getByLabel('Rhea’s folder in the notes').fill('Resources/Food');
  await page.getByRole('button', { name: 'Save what Rhea does and its folder' }).click();
  await expect(rhea.getByTestId('member-area')).toContainText('in the notes folder “Food”');
  await page.getByRole('button', { name: 'Edit Dione' }).click();
  await page.getByRole('button', { name: 'Remove Dione from the squad' }).click();
  await expect(members).toHaveCount(2);
  await page.getByRole('button', { name: 'Looks good' }).click();

  await expect(page.getByTestId('birth')).toBeVisible();
  await expect(page.getByTestId('welcome')).toContainText('Hi Giulio! I’m Atlas');
  for (const id of ['atlas', 'rhea', 'calendar']) {
    expect(existsSync(join(HOME, 'agents', id, 'AGENTS.md'))).toBe(true);
  }
  expect(existsSync(join(HOME, 'agents', 'dione'))).toBe(false);
  const settings = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')) as {
    permissions: unknown;
  };
  expect(settings.permissions).toMatchObject({ web: true, shell: true, folders: [] });
  const rheaYaml = readFileSync(join(HOME, 'agents', 'rhea', 'agent.yaml'), 'utf8');
  expect(rheaYaml).toContain('Resources/Food/**');
  expect(rheaYaml).toContain('Agents/Rhea/**');
  expect(rheaYaml).toContain('web_search');

  await page.getByRole('button', { name: 'Message Atlas' }).click();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  const chats = page.getByRole('navigation', { name: 'Monsters’ chats' });
  await expect(chats.getByRole('link', { name: /^Calendar,/ })).toBeVisible();
  await expect(page.getByTestId('agent-bubble').first()).toContainText('I’m Atlas');

  // The new orchestrator answers: one closed bubble next to the welcome. The full
  // text, since `hasText` ignores case and the welcome says "I’m here" too.
  const bubbles = page.getByTestId('agent-bubble');
  await expect(bubbles).toHaveCount(1);
  const input = page.getByTestId('composer-input');
  await input.fill('hello');
  await input.press('Enter');
  const reply = bubbles.filter({ hasText: 'Hi Giulio! I’m here, tell me.' });
  await expect(reply).toHaveAttribute('data-streaming', 'false', { timeout: 15_000 });
  await expect(bubbles).toHaveCount(2);

  // After its first answer: the card. What the old questions asked goes to the profile note,
  // through the same API as Settings → Squad → You.
  await page.getByTestId('tell-more-invite').getByRole('button', { name: 'Tell me more' }).click();
  const card = page.getByTestId('tell-more');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Social media and content' }).click();
  await card.getByLabel('In your own words (if you like)').fill('I follow three restaurants');
  await card.getByRole('button', { name: 'Online research' }).click();
  await card.getByRole('radio', { name: 'Direct' }).click();
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('tell-more-saved')).toBeVisible();
  const saved = readFileSync(profilePath, 'utf8');
  expect(saved).toContain(
    '## What they do\n- Social media and content\n- I follow three restaurants\n',
  );
  expect(saved).toContain('## Tasks to hand off\n- Online research\n');
  expect(saved).toContain('- Tone: direct');

  // A reload stays in the chat: the onboarding is over, and the card does not come back.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  await expect(page.getByTestId('tell-more')).toHaveCount(0);
});
