import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import {
  answerNames,
  connectOpenRouter,
  createAccount,
  watchWalk,
  walked,
} from './onboarding-helpers.ts';

/*
 * First start against the mock core (`?mock=1`), the express path: model, your name, the
 * squad, the birth. The real core is in e2e-core/onboarding.e2e.ts.
 */

test('first start: model, name, squad, birth', async ({ page }) => {
  // The longest flow of the suite (every step, with the guide's animations).
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'key');
  // Three steps, the first one current: no "About you" or "What they can do" any more.
  const progress = page.getByRole('navigation', { name: 'Progress' });
  await expect(progress.getByRole('listitem')).toHaveText([/Model/, /Your name/, /Squad/]);

  // Three ways to a model; nothing goes on until one is connected.
  const ways = page.getByRole('radiogroup', { name: 'How I reach a model' });
  await expect(ways.getByRole('radio')).toHaveCount(3);
  const go = page.getByTestId('access-continue');
  await expect(go).toBeDisabled();
  await page.getByRole('radio', { name: /Free models/ }).click();
  // The key has its own way forward: one orange key on screen, nothing to leave for later
  // once a model is there (audit UI-18).
  await expect(go).toHaveCount(0);
  const key = page.getByLabel('Your OpenRouter key');
  await key.fill('not-a-key');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByRole('alert')).toContainText('sk-or-');
  await connectOpenRouter(page);
  await expect(progress.getByRole('listitem').first()).toHaveAttribute('data-done', 'yes');

  // From here to the first chat: the screens seen and the clicks made.
  await watchWalk(page);
  // One screen asks for the names: two text fields, the lead's already filled in.
  await expect(page.getByTestId('screen-progress')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Your lead’s name' })).toHaveValue('Titan');
  await expect(page.getByText('Your first monster')).toBeVisible();
  await answerNames(page, { orchestrator: 'Atlas' });
  await expect(progress.getByRole('listitem').nth(1)).toHaveAttribute('data-done', 'yes');
  await expect(progress.getByRole('listitem').nth(2)).toHaveAttribute('aria-current', 'step');

  // The squad comes with no wait in between (no forced reply of the guide), and says honestly
  // what they may do from the start and where to change it.
  const members = page.getByTestId('member');
  await expect(members).toHaveCount(2);
  await expect(page.getByTestId('guide-says')).toContainText('Here’s the squad');
  await expect(page.getByTestId('permissions-note')).toHaveText(
    'They can write in your notes, search the web and run commands on this computer. You can change that in Settings → Permissions.',
  );
  // "Looks good" is the one main key; the rest is secondary.
  await expect(page.getByRole('button', { name: 'Looks good' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  // The four ways to change a card are one tap away: closed until "Edit".
  await expect(page.getByTestId('member-keys')).toHaveCount(0);

  // A new look for Rhea, a new name, Dione out and back in, then out again.
  const rhea = page.locator('[data-member="rhea"]');
  await page.getByRole('button', { name: 'Edit Rhea' }).click();
  const before = await rhea.locator('svg').first().innerHTML();
  await page.getByRole('button', { name: 'Another look for Rhea' }).click();
  await expect.poll(() => rhea.locator('svg').first().innerHTML()).not.toBe(before);
  await page.getByRole('button', { name: 'Rename Rhea' }).click();
  await page.getByLabel('New name for Rhea').fill('Calendar');
  await page.getByRole('button', { name: 'Save the name' }).click();
  await expect(rhea.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(rhea.getByTestId('member-saved')).toBeVisible();
  // The card says what the monster does in plain words; the list of what it does (written
  // for the model) and the folder are under "What it does", editable: a glob or a reserved
  // folder is refused (audit 2.10).
  await expect(rhea.getByTestId('member-area')).toContainText('in the notes folder “Research”');
  await expect(rhea).not.toContainText('vault');
  await expect(rhea).not.toContainText('You see the work through');
  await page.getByRole('button', { name: 'Change what Calendar does' }).click();
  const area = page.getByLabel('Calendar’s folder in the notes');
  await area.fill('**');
  await page.getByRole('button', { name: 'Save what Calendar does and its folder' }).click();
  await expect(rhea.getByRole('alert')).toContainText('no * ?');
  await area.fill('Agents/Atlas');
  await page.getByRole('button', { name: 'Save what Calendar does and its folder' }).click();
  await expect(rhea.getByRole('alert')).toContainText('reserved');
  await area.fill(' Projects/Editorial plan/ ');
  await page
    .getByLabel('What Calendar does (one per line)')
    .fill('One plan a week.\n- You remember the deadlines.');
  await page.getByRole('button', { name: 'Save what Calendar does and its folder' }).click();
  await expect(rhea.getByTestId('member-area')).toContainText('“Editorial plan”');
  await page.getByRole('button', { name: 'Change what Calendar does' }).click();
  await expect(page.getByLabel('What Calendar does (one per line)')).toHaveValue(
    'One plan a week.\nYou remember the deadlines.',
  );
  await expect(page.getByLabel('Calendar’s folder in the notes')).toHaveValue(
    'Projects/Editorial plan',
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Edit Dione' }).click();
  await page.getByRole('button', { name: 'Remove Dione from the squad' }).click();
  await expect(members).toHaveCount(1);
  // The focus does not fall on the page: it is on “Put back”, ready to undo.
  await expect(page.getByRole('button', { name: 'Put Dione back on the squad' })).toBeFocused();
  await page.getByRole('button', { name: 'Put Dione back on the squad' }).click();
  await expect(members).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit Dione' }).click();
  await page.getByRole('button', { name: 'Remove Dione from the squad' }).click();
  await expect(members).toHaveCount(1);

  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByTestId('birth')).toBeVisible();
  await expect(page.getByTestId('welcome')).toContainText('Hi Giulio! I’m Atlas');
  await page.getByRole('button', { name: 'Message Atlas' }).click();

  // The onboarding lands in the orchestrator's chat, with the new team on the left.
  await expect(page).toHaveURL(/#\/\?chat=atlas$/);
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  const chats = page.getByRole('navigation', { name: 'Monsters’ chats' });
  // The orchestrator's chat is the god's bar at the head of the sidebar (D-102).
  await expect(page.getByTestId('god-bar')).toHaveAccessibleName(/^Atlas,/);
  await expect(chats.getByRole('link', { name: /^Calendar,/ })).toBeVisible();
  await expect(chats.getByRole('link', { name: /^Dione,/ })).toHaveCount(0);
  await expect(page.getByTestId('agent-bubble').first()).toContainText('I’m Atlas');
  // A model is connected: no warning on the home page.
  await expect(page.getByTestId('no-model')).toHaveCount(0);
  // A first thing to ask: an unfinished one goes in the field, to be completed.
  const ideas = page.getByTestId('suggestions');
  await expect(ideas.getByRole('button')).toHaveCount(3);
  await ideas.getByRole('button', { name: 'Do some research on…' }).click();
  await expect(page.getByTestId('composer-input')).toHaveValue('Do some research on ');
  await expect(page.getByTestId('composer-input')).toBeFocused();
});

test('the express path: three screens, three clicks, two text fields', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await connectOpenRouter(page);
  await watchWalk(page);

  // Names (1 click), the squad as it arrives (1), the birth (1). Nothing waits in between.
  const started = Date.now();
  await answerNames(page);
  await expect(page.getByTestId('member')).toHaveCount(2);
  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByRole('button', { name: /^Message / }).click();
  await expect(page.getByRole('heading', { name: 'Titan', level: 1 })).toBeVisible();
  // The old path held the guide for 0.95 s on each of three screens and 0.8 s on the fourth:
  // the whole walk now takes less than one of those pauses and a half.
  expect(Date.now() - started).toBeLessThan(6000);

  const walk = await walked(page);
  // Names, squad, birth: the questions about work, hand-offs, rules and the permissions are gone.
  expect(walk.steps).toEqual(['questions', 'team', 'done']);
  expect(walk.clicks).toBe(3);
});

test('Back from the squad keeps the proposal, and a changed name makes a new one', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await connectOpenRouter(page);
  await answerNames(page, { orchestrator: 'Atlas' });
  const members = page.getByTestId('member');
  await expect(members).toHaveCount(2);
  // A look the user chose is part of the proposal: it survives Back and Next with the same names.
  await page.getByRole('button', { name: 'Edit Rhea' }).click();
  const rhea = page.locator('[data-member="rhea"]');
  const before = await rhea.locator('svg').first().innerHTML();
  await page.getByRole('button', { name: 'Another look for Rhea' }).click();
  await expect.poll(() => rhea.locator('svg').first().innerHTML()).not.toBe(before);
  // The ids of the SVG patterns change with every mount: the dots are what counts.
  const dots = async () =>
    (await page.locator('[data-member="rhea"]').locator('svg').first().innerHTML()).replace(
      /m_[\w-]*-off/g,
      'id',
    );
  const chosen = await dots();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  // The names are as they were left.
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveValue('Giulio');
  await expect(page.getByRole('textbox', { name: 'Your lead’s name' })).toHaveValue('Atlas');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'team');
  await expect(members).toHaveCount(2);
  expect(await dots()).toBe(chosen);

  // Another name for the lead: the squad is proposed again, for it.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('textbox', { name: 'Your lead’s name' }).fill('Pan');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'team');
  await expect(page.getByText('Your lead: Pan')).toBeVisible();
});

test('the Claude plan: Claude Code on the computer of Monsters', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('radio', { name: /Claude plan/ }).click();
  const panel = page.getByTestId('access-panel');
  // The core may run elsewhere (desktop app over SSH): the copy says where.
  await expect(panel).toContainText('on the computer where Monsters runs');
  await panel.getByRole('button', { name: 'Use Claude Code' }).click();
  await expect(panel.getByTestId('claude-terminal-hint')).toContainText('claude');
  await expect(page.getByTestId('access-continue')).toBeDisabled();
  // The user signs in in a terminal; Monsters asks Claude Code again.
  await expect(async () => {
    await panel.getByRole('button', { name: 'Check again' }).click({ timeout: 1000 });
    await expect(page.getByTestId('access-connected')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByTestId('access-connected')).toContainText('plan');
  await expect(page.getByTestId('way-claude-agent')).toHaveAttribute('data-ready', 'yes');
  await page.getByTestId('access-continue').click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
});

test('the ChatGPT plan: continue with ChatGPT and the first-use modal', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('radio', { name: /ChatGPT plan/ }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await (await popup).close();
  const modal = page.getByTestId('chatgpt-welcome');
  await expect(modal).toContainText('Eligible usage in this app uses your ChatGPT plan.');
  await modal.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('access-connected')).toContainText('giulio@example.com');
  await page.getByTestId('access-continue').click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
});

test('without a model the home page says so', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'I’ll do it later' }).click();
  await answerNames(page);
  await page.getByRole('button', { name: 'Looks good' }).click();
  await page.getByRole('button', { name: /^Message / }).click();
  // The greeting is honest, and carries the way out; the field and the state agree.
  const greeting = page.getByTestId('agent-bubble').first();
  await expect(greeting).toContainText('To work I’m only missing a model');
  await expect(page.getByTestId('chat-status')).toContainText('Waiting for a model');
  const input = page.getByTestId('composer-input');
  await expect(input).toBeDisabled();
  await expect(input).toHaveAttribute('placeholder', 'Add a model first');
  const notice = greeting.getByTestId('no-model');
  await notice.getByRole('link', { name: 'Add a model' }).click();
  await expect(page).toHaveURL(/#\/settings\?section=models$/);
});

test('the key can wait, and the chats send back to the onboarding', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'I’ll do it later' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await page.getByLabel('Your name').fill('Giulio');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'team');
  // Going to the chats before finishing brings the user back here.
  await page.goto('/?mock=1#/');
  await expect(page.getByTestId('onboarding')).toBeVisible();
});
