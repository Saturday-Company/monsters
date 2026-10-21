import type { Page } from '@playwright/test';
import { expect, holdMock, releaseMock, test } from './fixtures.ts';

/*
 * Permissions after the onboarding (M2.1), on the mock core: per monster,
 * notes, web, terminal and folders of the computer, saved at once.
 * `PERMISSIONS_SHOTS=<dir>` also writes screenshots in light and dark.
 */

async function openRhea(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
  const section = page.getByTestId('permissions-settings');
  await expect(section.getByRole('heading', { name: 'What the monsters can do' })).toBeVisible();
  const rhea = section.getByTestId('agent-permissions-rhea');
  await rhea.getByRole('button', { expanded: false }).click();
  return rhea;
}

test('settings: change what a monster may do, saved at once and logged', async ({ page }) => {
  const rhea = await openRhea(page);
  await expect(rhea.getByTestId('permissions-summary')).toHaveText('Notes, web');

  // Terminal on: while it is saved (the mock holds the reply until the test
  // has looked) the switches are disabled, keyboard included, and the summary
  // waits; then a plain warning, the summary follows.
  await holdMock(page);
  await rhea.getByRole('switch', { name: 'Terminal', exact: true }).click();
  await expect(rhea.getByRole('switch', { name: 'The web', exact: true })).toBeDisabled();
  await expect(rhea.getByRole('switch', { name: 'Terminal', exact: true })).toBeDisabled();
  await expect(rhea.getByTestId('permissions-summary')).toHaveText('Notes, web');
  await releaseMock(page);
  await expect(page.getByText('Rhea’s permissions saved.')).toBeVisible();
  await expect(rhea.getByRole('switch', { name: 'The web', exact: true })).toBeEnabled();
  await expect(rhea.getByTestId('shell-warning')).toContainText(
    'anything on the computer that you can',
  );
  await expect(rhea.getByTestId('permissions-summary')).toHaveText('Notes, web, terminal');

  // Folders: a relative path is caught in the page, the vault by the core.
  const field = rhea.getByLabel('Add a folder: computer folders');
  await field.fill('Documents');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByRole('alert')).toContainText('full path');
  await field.fill('/home/demo/Monsters Note');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByRole('alert')).toContainText('notes folder');
  await field.fill('/home/demo/Progetti');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByTestId('folder-grant')).toHaveCount(1);
  await expect(rhea.getByRole('alert')).toHaveCount(0);
  await expect(field).toHaveValue('');
  await expect(rhea.getByTestId('permissions-summary')).toHaveText(
    'Notes, web, terminal, 1 folder',
  );
  // The same folder written with `~` is caught in the page.
  await field.fill('~/Progetti/');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByRole('alert')).toContainText('already there');
  await expect(rhea.getByTestId('folder-grant')).toHaveCount(1);
  await field.fill('');
  const write = rhea.getByRole('switch', { name: 'Can edit the files in /home/demo/Progetti' });
  await expect(write).toHaveAttribute('aria-checked', 'false');
  await expect(rhea.getByTestId('launch-files-note')).toHaveCount(0);
  await write.click();
  await expect(write).toHaveAttribute('aria-checked', 'true');
  await expect(rhea.getByTestId('launch-files-note')).toContainText('.git');

  // Notes read only.
  await rhea.getByRole('switch', { name: 'Write in the notes' }).click();
  await expect(rhea.getByTestId('permissions-summary')).toHaveText(
    'Read-only notes, web, terminal, 1 folder',
  );

  // Another monster keeps its own permissions.
  await expect(
    page.getByTestId('agent-permissions-dione').getByTestId('permissions-summary'),
  ).toHaveText('Notes, web');

  // Remove the folder.
  await rhea.getByRole('button', { name: 'Remove /home/demo/Progetti' }).click();
  await expect(rhea.getByTestId('folder-grant')).toHaveCount(0);

  // Every change is in the log.
  await page.goto('/?mock=demo#/log');
  await expect(page.getByText('You changed Rhea’s permissions').first()).toBeVisible();
});

const SHOTS = process.env['PERMISSIONS_SHOTS'];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`permissions screenshot ${theme}`, () => {
    test.skip(!SHOTS, 'set PERMISSIONS_SHOTS=<dir> to write the screenshots');
    test.use({
      colorScheme: theme,
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 1000 },
    });

    test('settings and onboarding', async ({ page }) => {
      await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
      const section = page.getByTestId('permissions-settings');
      const mimas = section.getByTestId('agent-permissions-mimas');
      await mimas.getByRole('button', { expanded: false }).click();
      await expect(mimas.getByTestId('shell-warning')).toBeVisible();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/impostazioni-permessi-${theme}.png`,
        animations: 'disabled',
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await mimas.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS}/impostazioni-permessi-${theme}-390.png`,
        animations: 'disabled',
      });
    });
  });
}
