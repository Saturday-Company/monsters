import type { Page } from '@playwright/test';
import { connectOpenRouter, createAccount } from './onboarding-helpers.ts';
import { expect, holdMock, releaseMock, stepMockUntil, test } from './fixtures.ts';

/*
 * Onboarding and settings after the review of 28/10 (D-220), on the mock core: the password
 * prompt of a limited session, "Back" while the squad is written, a list that failed once, the
 * draft of the chat that comes back, the answer to an automation's question and the autosave of
 * a chain that is not lost with the tab.
 */

const MOCK_SETUP_CODE = '424242';

interface MockHooks {
  __monstersMock: {
    handle(method: string, path: string, body: unknown): { status: number; body: unknown };
    clearFailures(): void;
    failRequests(match: string, times?: number): void;
    requests: string[];
  };
}

test('"Next" on a limited session asks for the password, then goes on (review of 28/10)', async ({
  page,
}) => {
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await connectOpenRouter(page);
  // The core started from a terminal: saving the answers wants the password again.
  await page.evaluate(() => {
    const w = window as unknown as MockHooks & { __confirmed: boolean };
    w.__confirmed = false;
    const original = w.__monstersMock.handle.bind(w.__monstersMock);
    w.__monstersMock.handle = (method, path, body) => {
      if (path === '/api/auth/confirm') w.__confirmed = true;
      return !w.__confirmed && path === '/api/onboarding/answers'
        ? { status: 403, body: { error: 'confirm_required', message: 'Password again' } }
        : original(method, path, body);
    };
  });
  await page.getByRole('textbox', { name: 'Your name' }).fill('Giulio');
  await page.getByRole('button', { name: /^Next/ }).click();
  const prompt = page.getByTestId('owner-prompt');
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Password').fill('una-password-lunga');
  await prompt.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'team');
});

test('"Back" waits while the squad is being written, so two proposals never race', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await connectOpenRouter(page);
  await holdMock(page);
  await page.getByRole('textbox', { name: 'Your name' }).fill('Giulio');
  await page.getByRole('button', { name: /^Next/ }).click();
  // The names are saved, then the proposal is asked for; both replies wait in the mock.
  await stepMockUntil(
    page,
    async () => (await page.getByTestId('onboarding').getAttribute('data-step')) === 'team',
  );
  const back = page.getByRole('button', { name: 'Back' });
  await expect(page.getByTestId('member')).toHaveCount(0);
  await expect(back).toBeDisabled();
  await releaseMock(page);
  await expect(page.getByTestId('member')).toHaveCount(2);
  await expect(back).toBeEnabled();
  // Another squad asked for: Back waits again until it is there.
  await holdMock(page);
  await page.getByRole('button', { name: 'Suggest another squad' }).click();
  await expect(back).toBeDisabled();
  await releaseMock(page);
  await expect(back).toBeEnabled();
});

test('a squad that takes too long can be given up on: Back comes back, and Try again asks anew', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/?mock=1');
  await createAccount(page, MOCK_SETUP_CODE);
  await connectOpenRouter(page);
  await holdMock(page);
  await page.getByRole('textbox', { name: 'Your name' }).fill('Giulio');
  await page.getByRole('button', { name: /^Next/ }).click();
  await stepMockUntil(
    page,
    async () => (await page.getByTestId('onboarding').getAttribute('data-step')) === 'team',
  );
  const back = page.getByRole('button', { name: 'Back' });
  await expect(back).toBeDisabled();
  await page.getByTestId('stop-waiting').click();
  await expect(back).toBeEnabled();
  await expect(page.getByText('I stopped waiting for the squad.')).toBeVisible();
  // The answer that was on its way when the user gave up is not taken.
  await releaseMock(page);
  await expect(page.getByTestId('member')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('member')).toHaveCount(2);
  await expect(back).toBeEnabled();
});

test('a first read of the projects that failed says so, and "Try again" fills the sidebar', async ({
  page,
}) => {
  // The mock is created before the app starts: refuse the list from its very first request.
  await page.addInitScript(() => {
    let mock: MockHooks['__monstersMock'] | undefined;
    Object.defineProperty(window, '__monstersMock', {
      configurable: true,
      get: () => mock,
      set: (m: MockHooks['__monstersMock']) => {
        mock = m;
        m.failRequests('GET /api/projects');
      },
    });
  });
  await page.goto('/?mock=demo');
  const failed = page.getByTestId('projects-load-failed');
  await expect(failed).toContainText('Couldn’t load your projects.');
  await expect(page.getByTestId('sidebar')).not.toContainText('Saturday Social');
  // Still down: the notice stays.
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(failed).toBeVisible();
  await page.evaluate(() => (window as unknown as MockHooks).__monstersMock.clearFailures());
  // Another part of the page may read the list meanwhile: the notice goes either way.
  await expect(async () => {
    await failed
      .getByRole('button', { name: 'Try again' })
      .click({ timeout: 1000 })
      .catch(() => {});
    await expect(failed).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(page.getByTestId('sidebar')).toContainText('Saturday Social');
});

async function propose(page: Page) {
  await page.goto('/?mock=team&mockSpeed=0.3');
  await page.getByLabel('Email').fill('giulio@esempio.it');
  await page.getByLabel('Password').fill('una-password-lunga');
  await page.getByLabel('Setup code').fill(MOCK_SETUP_CODE);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('sidebar').waitFor();
  await page.evaluate(() => (window.location.hash = '#/?chat=titan'));
  const input = page.getByTestId('composer-input');
  await input.fill('Create a monster that keeps my ideas in order');
  await input.press('Enter');
  const card = page.getByTestId('proposal-card');
  await expect(card).toHaveAttribute('data-status', 'proposed');
  return card;
}

test('the draft handed from the chat comes once: "Add a monster" opens empty afterwards', async ({
  page,
}) => {
  const card = await propose(page);
  await card.getByTestId('proposal-change').click();
  await expect(page.getByTestId('team-draft').getByLabel('Name')).toHaveValue('Lyra');
  // Back to the first form, then away: the draft is spent.
  await page.getByTestId('team-draft').getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('team-add').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('team-add')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add a monster' }).click();
  await expect(page.getByTestId('team-add')).toBeVisible();
  await expect(page.getByTestId('team-draft')).toHaveCount(0);
});

test('"Answer" on the question of an automation opens its giro, where the card is', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  const detail = page.getByTestId('automation-detail');
  await expect(detail).toHaveAttribute('data-status', 'active');
  await holdMock(page);
  await detail.getByTestId('automation-run-now').click();
  const giro = page.getByTestId('giro-view');
  await stepMockUntil(page, () => giro.isVisible());
  const runId = /run=([^&]+)/.exec(page.url())![1]!;
  await page.evaluate((run) => {
    const mock = (
      window as unknown as {
        __monstersMock: {
          ask(
            a: string,
            r: string,
            q: string,
            o: unknown[],
            rec: undefined,
            then: () => void,
          ): void;
        };
      }
    ).__monstersMock;
    mock.ask('iapetus', run, 'What do you want out this week?', [], undefined, () => {});
  }, runId);
  const card = giro.getByTestId('giro-questions').getByTestId('question-card');
  await stepMockUntil(page, () => card.isVisible());
  await releaseMock(page);

  await page.evaluate(() => (window.location.hash = '#/log'));
  const row = page
    .getByTestId('event-row')
    .filter({ hasText: 'Iapetus asked you a question' })
    .filter({ has: page.getByTestId('answer-question') });
  await expect(row).toBeVisible();
  await row.getByTestId('answer-question').click();
  // Not the chat of the capo (the giro is not in it): the page of the giro, with the question.
  await expect(page).toHaveURL(/#\/automations\?.*run=/);
  await expect(page.getByTestId('giro-questions').getByTestId('question-card')).toHaveAttribute(
    'data-status',
    'open',
  );
});

test('a chain edited in Advanced is saved even if the tab is left within a moment', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Add a model' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByTestId('models-connected').getByTestId('subscription-claude'),
  ).toBeVisible();
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByLabel('Account 1 of Rhea', { exact: true }).selectOption('claude-agent');
  // The account's first model fills in when its list arrives: that is a chain that can be saved.
  await expect(rhea.getByLabel('Model 1 of Rhea', { exact: true })).toHaveValue('sonnet');
  // Leave at once, well before the autosave's moment.
  await page.evaluate(() => (window.location.hash = '#/'));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as MockHooks).__monstersMock.requests.some((r) =>
          r.startsWith('PUT /api/agents/rhea/models'),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=modelli'));
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  // Rhea's chain now differs from the others': the list of each monster is already there.
  await expect(
    page.getByTestId('agent-chain-rhea').getByLabel('Account 1 of Rhea', { exact: true }),
  ).toHaveValue('claude-agent');
});

test('a chain the core refuses after the tab was left is told in a notice, not lost in silence', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=modelli');
  await page.getByRole('button', { name: 'Add a model' }).click();
  await page.getByTestId('subscription-claude').getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByTestId('models-connected').getByTestId('subscription-claude'),
  ).toBeVisible();
  await page.getByTestId('chains-advanced-toggle').locator(':scope > button').click();
  await page.getByTestId('chains-per-monster').click();
  const rhea = page.getByTestId('agent-chain-rhea');
  await rhea.getByLabel('Account 1 of Rhea', { exact: true }).selectOption('claude-agent');
  await expect(rhea.getByLabel('Model 1 of Rhea', { exact: true })).toHaveValue('sonnet');
  await page.evaluate(() =>
    (window as unknown as MockHooks).__monstersMock.failRequests('PUT /api/agents/rhea/models'),
  );
  // Leave at once, well before the autosave's moment: the editor sends from its last breath.
  await page.evaluate(() => (window.location.hash = '#/'));
  await expect(page.getByTestId('notice')).toHaveAttribute('role', 'alert');
});
