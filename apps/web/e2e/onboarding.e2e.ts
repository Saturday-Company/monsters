import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, test } from './fixtures.ts';
import { answerQuestions, connectOpenRouter, createAccount } from './onboarding-helpers.ts';

/* First start against the mock core (`?mock=1`). The real core is in onboarding-core.e2e.ts. */

test('first start: model, about you, team, birth', async ({ page }) => {
  // The longest flow of the suite (every step, with the guide's animations).
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await expect(page).toHaveURL(/#\/benvenuto$/);
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'key');
  // Four steps, the first one current.
  const progress = page.getByRole('navigation', { name: 'Progress' });
  await expect(progress.getByRole('listitem')).toHaveText([
    /Model/,
    /About you/,
    /What they can do/,
    /Squad/,
  ]);

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

  await answerQuestions(page, { orchestrator: 'Atlas' });
  // The starting agent comments the last answer, then the permissions: a step of their own.
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'permissions');
  await expect(progress.getByRole('listitem').nth(2)).toHaveAttribute('aria-current', 'step');
  // The counter of "About you" stays with its three screens: the permissions are a step of
  // their own (D-066).
  await expect(page.getByTestId('screen-progress')).toHaveCount(0);
  await page.getByRole('switch', { name: 'The web' }).click();
  await page.getByRole('switch', { name: 'The web' }).click();
  // Only the three switches (terminal off by default); folders, browser and MCP tools
  // are set up in the settings, nothing is announced as coming.
  const perms = page.getByRole('list', { name: 'The monsters’ permissions' });
  await expect(perms.getByRole('switch')).toHaveCount(3);
  await expect(page.getByText('Coming soon')).toHaveCount(0);
  await expect(page.getByTestId('guide-says').locator('..').locator('..')).toContainText(
    'in the settings',
  );
  await expect(page.getByRole('switch', { name: 'Terminal' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('button', { name: /Looks good, continue/ }).click();
  await expect(page.getByTestId('guide-says')).toContainText('put the squad together');

  const members = page.getByTestId('member');
  await expect(members).toHaveCount(3);
  await expect(page.getByTestId('guide-says')).toContainText('Here’s the squad');

  // A new look for Tethys, a new name, Dione out and back in, then out again.
  const tethys = page.locator('[data-member="tethys"]');
  const before = await tethys.locator('svg').first().innerHTML();
  await page.getByRole('button', { name: 'Another look for Tethys' }).click();
  await expect.poll(() => tethys.locator('svg').first().innerHTML()).not.toBe(before);
  await page.getByRole('button', { name: 'Rename Tethys' }).click();
  await page.getByLabel('New name for Tethys').fill('Calendar');
  await page.getByRole('button', { name: 'Save the name' }).click();
  await expect(tethys.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(tethys.getByTestId('member-saved')).toBeVisible();
  // The card says what the monster does in plain words; duties (written for the
  // model) and folder are under "Personalizza", editable: a glob or a reserved
  // folder is refused (audit 2.10).
  await expect(tethys.getByTestId('member-area')).toContainText('in the notes folder “Calendar”');
  await expect(tethys).not.toContainText('vault');
  await expect(tethys).not.toContainText('You see the work through');
  await page.getByRole('button', { name: 'Customize Calendar' }).click();
  const area = page.getByLabel('Calendar’s folder in the notes');
  await area.fill('**');
  await page.getByRole('button', { name: 'Save Calendar’s tasks and folder' }).click();
  await expect(tethys.getByRole('alert')).toContainText('no * ?');
  await area.fill('Agenti/Atlas');
  await page.getByRole('button', { name: 'Save Calendar’s tasks and folder' }).click();
  await expect(tethys.getByRole('alert')).toContainText('reserved');
  await area.fill(' Projects/Editorial plan/ ');
  await page
    .getByLabel('Calendar’s tasks (one per line)')
    .fill('One plan a week.\n- You remember the deadlines.');
  await page.getByRole('button', { name: 'Save Calendar’s tasks and folder' }).click();
  await expect(tethys.getByTestId('member-area')).toContainText('“Editorial plan”');
  await page.getByRole('button', { name: 'Customize Calendar' }).click();
  await expect(page.getByLabel('Calendar’s tasks (one per line)')).toHaveValue(
    'One plan a week.\nYou remember the deadlines.',
  );
  await expect(page.getByLabel('Calendar’s folder in the notes')).toHaveValue(
    'Projects/Editorial plan',
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Remove Dione from the squad' }).click();
  await expect(members).toHaveCount(2);
  // The focus does not fall on the page: it is on “Put back”, ready to undo.
  await expect(page.getByRole('button', { name: 'Put Dione back on the squad' })).toBeFocused();
  await page.getByRole('button', { name: 'Put Dione back on the squad' }).click();
  await expect(members).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove Dione from the squad' }).click();
  await expect(members).toHaveCount(2);

  await page.getByRole('button', { name: /Confirm the squad/ }).click();
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
  await expect(page.getByRole('combobox', { name: 'Message' })).toHaveValue('Do some research on ');
  await expect(page.getByRole('combobox', { name: 'Message' })).toBeFocused();
});

test('the Claude subscription: Claude Code on the computer of Monsters', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('radio', { name: /Claude subscription/ }).click();
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
  await expect(page.getByTestId('access-connected')).toContainText('subscription');
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
  await answerQuestions(page);
  await page.getByRole('button', { name: /Looks good, continue/ }).click();
  await page.getByRole('button', { name: /Confirm the squad/ }).click();
  await page.getByRole('button', { name: /^Message / }).click();
  // The greeting is honest, and carries the way out; the field and the state agree.
  const greeting = page.getByTestId('agent-bubble').first();
  await expect(greeting).toContainText('To work I’m only missing a model');
  await expect(page.getByTestId('chat-status')).toContainText('Waiting for a model');
  const input = page.getByRole('combobox', { name: 'Message' });
  await expect(input).toBeDisabled();
  await expect(input).toHaveAttribute('placeholder', 'Connect a model first');
  const notice = greeting.getByTestId('no-model');
  await notice.getByRole('link', { name: 'Connect a model' }).click();
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=modelli$/);
});

test('the key can wait, and the chats send back to the onboarding', async ({ page }) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'I’ll do it later' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'questions');
  await page.getByLabel('Your name').fill('Giulio');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.locator('[data-question="lavoro"]')).toBeVisible();
  // Going to the chats before finishing brings the user back here.
  await page.goto('/?mock=1#/');
  await expect(page.getByTestId('onboarding')).toBeVisible();
});
