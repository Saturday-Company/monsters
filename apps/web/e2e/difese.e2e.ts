import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * The defences of D-070 in the UI: the spending cap (Settings → Modelli, the
 * warning and the stop in the chat with "Alza il tetto") and the tools of
 * another program that changed since they were accepted (Settings →
 * Collegamenti, "Accetta" / "Scollega").
 */

test.use({ viewport: { width: 1440, height: 900 } });

test('Tetto di spesa: what was spent, the caps, a cap per monster', async ({ page }) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=tetto');
  const section = page.getByTestId('spend-section');
  await expect(section.getByRole('heading', { name: 'Spending cap' })).toBeInViewport();
  await expect(page.getByTestId('spend-day-display')).toContainText('€0.42 / €10');
  await expect(page.getByTestId('spend-day-display')).toHaveAttribute('data-level', 'ok');
  await expect(page.getByTestId('spend-month')).toContainText('€7.95');
  // What does not count is said apart, with the fixed exchange rate.
  await expect(page.getByTestId('spend-footer')).toContainText('requests to free models');
  await expect(page.getByTestId('spend-footer')).toContainText('Claude subscription');
  await expect(page.getByTestId('spend-footer')).toContainText('$1 = €0.86');

  // The team's cap: a new number, saved.
  const save = page.getByTestId('spend-caps-save');
  await expect(save).toBeDisabled();
  await page.getByTestId('spend-caps-day').fill('15');
  await save.click();
  await expect(page.getByTestId('spend-day-display')).toContainText('€0.42 / €15');
  await expect(page.getByText('Spending cap saved.')).toBeVisible();
  // A wrong number is said in words.
  await page.getByTestId('spend-caps-month').fill('lots');
  await save.click();
  await expect(section.getByRole('alert')).toContainText('Type an amount in euros');
  await page.getByTestId('spend-caps-month').fill('100');

  // One monster with a cap of its own.
  await page
    .getByTestId('spend-agents')
    .getByRole('button', { name: /Per monster/ })
    .click();
  const rhea = page.getByTestId('spend-agent-rhea');
  await expect(rhea).toContainText('Today €0.42');
  await rhea.getByTestId('spend-caps-rhea-day').fill('2');
  await rhea.getByTestId('spend-caps-rhea-save').click();
  await expect(page.getByText('Rhea’s cap saved.')).toBeVisible();
  await expect(rhea.getByTestId('spend-caps-rhea-day')).toHaveValue('2');
});

test('the cap reached: warning, stop and "Alza il tetto", then the work goes on', async ({
  page,
}) => {
  await page.goto('/?mock=demo&mockSpeed=0.2#/?chat=dione');
  const composer = page.getByTestId('composer-input');
  await composer.fill('Go ahead and spend on the supplier research');
  await composer.press('Enter');
  // 80%: a line in the chat (and a toast), then the stop with a clear sentence.
  await expect(page.getByText(/that’s 86% of the squad’s cap for today/).first()).toBeVisible();
  await expect(page.getByText(/Reached the squad’s cap for today \(€10\)/).first()).toBeVisible();
  const raise = page.getByTestId('raise-cap');
  await expect(raise).toBeVisible();
  await expect(page.getByTestId('error-actions')).not.toContainText('Try again');
  await raise.click();
  const section = page.getByTestId('spend-section');
  await expect(section.getByRole('heading', { name: 'Spending cap' })).toBeInViewport();
  await expect(page.getByTestId('spend-status')).toContainText('You’ve reached the cap');
  await expect(page.getByTestId('spend-day-display')).toHaveAttribute('data-level', 'stopped');
  await page.getByTestId('spend-raise').click();
  await expect(page.getByText(/Cap raised to €20 per day/)).toBeVisible();
  await expect(page.getByTestId('spend-day-display')).toContainText('/ €20');
  await expect(page.getByTestId('spend-status')).toHaveCount(0);
  // Attività: the warning and the stop are among the important things.
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'Reached the squad’s cap' }),
  ).toHaveCount(1);
});

test('a tool of another program changed: paused, with what changed, until "Accetta"', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=pausa');
  const card = page.getByTestId('mcp-paused');
  await expect(card.getByRole('heading', { name: 'Paused tools' })).toBeInViewport();
  const github = page.getByTestId('mcp-paused-github');
  await expect(github).toContainText('GitHub has a tool that changed');
  const tool = page.getByTestId('mcp-paused-tool-create_issue');
  await expect(tool).toContainText('description changed');
  await expect(tool).toContainText('Open a new issue');
  await expect(tool).toContainText('read the repository secrets');
  // Attività has it among the important things.
  await page.evaluate(() => (window.location.hash = '#/log'));
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'it stays paused until you accept it' }),
  ).toHaveCount(1);
  await page.evaluate(() => (window.location.hash = '#/impostazioni?sezione=pausa'));
  await page.getByTestId('mcp-accept-github').click();
  await expect(page.getByText('Tool accepted.')).toBeVisible();
  await expect(page.getByTestId('mcp-paused')).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = '#/log'));
  await page.getByRole('radio', { name: 'Everything' }).click();
  await expect(
    page.getByTestId('event-row').filter({ hasText: 'You accepted “create_issue” from GitHub' }),
  ).toHaveCount(1);
});

test('the paused card at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mock=demo#/impostazioni?sezione=pausa');
  const github = page.getByTestId('mcp-paused-github');
  await expect(github).toBeVisible();
  const box = await github.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await expectNoSideScroll(page, 390);
});
