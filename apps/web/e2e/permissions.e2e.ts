import type { Page } from '@playwright/test';
import { expect, holdMock, releaseMock, test } from './fixtures.ts';

/*
 * Permissions after the onboarding (M2.1, C7), on the mock core: one level per monster (notes,
 * notes and web, also commands) with "Apply to all"; the switches (notes, web, commands) and the
 * folders of the computer one by one behind "Switches and folders"; all saved at once.
 * `PERMISSIONS_SHOTS=<dir>` also writes screenshots in light and dark.
 */

/** The first layer: one level per monster. */
async function openPermissions(page: Page) {
  await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
  const section = page.getByTestId('permissions-settings');
  await expect(section.getByRole('heading', { name: 'What the monsters can do' })).toBeVisible();
  return section;
}

/** Behind "Switches and folders": Rhea's switches and folders, one by one. */
async function openRhea(page: Page) {
  const section = await openPermissions(page);
  await section.getByTestId('permissions-fine').getByRole('button').first().click();
  const rhea = section.getByTestId('agent-permissions-fine-rhea');
  await rhea.getByRole('button', { expanded: false }).click();
  return rhea;
}

test('settings: one level per monster, "Apply to all", the switches stay behind', async ({
  page,
}) => {
  const section = await openPermissions(page);
  const rhea = section.getByTestId('agent-permissions-rhea');
  const level = (name: string) => section.getByLabel(`What ${name} can do`);
  // Everything is on by default (D-159): commands too. No switch is in front.
  await expect(level('Rhea')).toHaveValue('commands');
  await expect(level('Rhea').getByRole('option')).toHaveText([
    'Notes only',
    'Notes and web',
    'Also runs commands',
  ]);
  await expect(rhea.getByTestId('permissions-summary')).toHaveText('Notes, web, commands');
  await expect(section.getByRole('switch')).toHaveCount(0);
  // "Run commands", never "Terminal", for the permission.
  await expect(section).not.toContainText('Terminal');
  // A mix the three levels do not describe reads as custom.
  await expect(level('Mimas')).toHaveValue('custom');

  // One monster to "Notes only", saved at once; another keeps its own.
  await holdMock(page);
  await level('Rhea').selectOption('notes');
  await expect(level('Rhea')).toBeDisabled();
  await releaseMock(page);
  await expect(page.getByText('Rhea’s permissions saved.')).toBeVisible();
  await expect(level('Rhea')).toHaveValue('notes');
  await expect(rhea.getByTestId('permissions-summary')).toHaveText('Notes');
  await expect(level('Dione')).toHaveValue('commands');

  // Apply to all: nothing happens before a level is chosen.
  const all = section.getByTestId('permissions-all');
  await expect(all.getByRole('button', { name: 'Apply to all' })).toBeDisabled();
  await all.getByLabel('Level for all monsters').selectOption('web');
  await all.getByRole('button', { name: 'Apply to all' }).click();
  await expect(page.getByText('Done: every monster is set.')).toBeVisible();
  for (const name of ['Titan', 'Rhea', 'Dione', 'Enceladus', 'Mimas']) {
    await expect(level(name)).toHaveValue('web');
  }

  // Giving commands to everyone asks first.
  await all.getByLabel('Level for all monsters').selectOption('commands');
  await all.getByRole('button', { name: 'Apply to all' }).click();
  await expect(all).toContainText('Let every monster run commands?');
  await all.getByRole('button', { name: 'Cancel' }).click();
  await expect(level('Rhea')).toHaveValue('web');
  await all.getByLabel('Level for all monsters').selectOption('commands');
  await all.getByRole('button', { name: 'Apply to all' }).click();
  await all.getByRole('button', { name: 'Yes, apply' }).click();
  await expect(level('Rhea')).toHaveValue('commands');
  await expect(level('Mimas')).toHaveValue('commands');

  // The switches behind the row follow the level.
  await section.getByTestId('permissions-fine').getByRole('button').first().click();
  const fine = section.getByTestId('agent-permissions-fine-rhea');
  await fine.getByRole('button', { expanded: false }).click();
  await expect(fine.getByRole('switch', { name: 'Run commands', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('settings: where a project switches the web off, the row says so with a link', async ({
  page,
}) => {
  const section = await openPermissions(page);
  // Iapetus works in a project; its own web permission is on.
  const iapetus = section.getByTestId('agent-permissions-iapetus');
  await expect(iapetus.getByTestId('permissions-web-override')).toHaveCount(0);
  // Switch the web off in the project (its Connections tab), then look again.
  await page
    .getByRole('link', { name: /Saturday Social/ })
    .first()
    .click();
  await page.getByRole('tab', { name: 'Connections' }).click();
  await page.getByRole('switch', { name: /web/i }).first().click();
  await page.goto('/?mock=demo#/impostazioni?sezione=permessi');
  const link = page
    .getByTestId('permissions-settings')
    .getByTestId('agent-permissions-iapetus')
    .getByTestId('permissions-web-override');
  await expect(link).toHaveText('Web: off in project Saturday Social');
  await link.click();
  await expect(page).toHaveURL(/#\/project\?id=/);
});

test('settings: change what a monster may do one by one, saved at once and logged', async ({
  page,
}) => {
  const rhea = await openRhea(page);
  // Everything is on by default (D-159): commands too, with their warning.
  await expect(rhea.getByTestId('shell-warning')).toBeVisible();
  // The explanation is in the language of the app (it was Italian).
  await expect(rhea).toContainText('Run commands and install programs in their own folder');
  await expect(rhea).not.toContainText('Eseguire comandi');

  // Commands off: while it is saved (the mock holds the reply until the test
  // has looked) the switches are disabled, keyboard included; then the warning goes.
  await holdMock(page);
  await rhea.getByRole('switch', { name: 'Run commands', exact: true }).click();
  await expect(rhea.getByRole('switch', { name: 'The web', exact: true })).toBeDisabled();
  await expect(rhea.getByRole('switch', { name: 'Run commands', exact: true })).toBeDisabled();
  await releaseMock(page);
  await expect(page.getByText('Rhea’s permissions saved.')).toBeVisible();
  await expect(rhea.getByRole('switch', { name: 'The web', exact: true })).toBeEnabled();
  await expect(rhea.getByTestId('shell-warning')).toHaveCount(0);
  // The level in front follows.
  await expect(page.getByLabel('What Rhea can do')).toHaveValue('web');

  // Commands on again: a plain warning.
  await rhea.getByRole('switch', { name: 'Run commands', exact: true }).click();
  await expect(rhea.getByRole('switch', { name: 'Run commands', exact: true })).toBeEnabled();
  await expect(rhea.getByTestId('shell-warning')).toContainText(
    'anything on the computer that you can',
  );

  // Folders: a relative path is caught in the page, the vault by the core.
  const field = rhea.getByLabel('Add a folder: computer folders');
  await field.fill('Documents');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByRole('alert')).toContainText('full path');
  await field.fill('/home/demo/Monsters Notes');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByRole('alert')).toContainText('notes folder');
  await field.fill('/home/demo/Progetti');
  await rhea.getByRole('button', { name: 'Add' }).click();
  await expect(rhea.getByTestId('folder-grant')).toHaveCount(1);
  await expect(rhea.getByRole('alert')).toHaveCount(0);
  await expect(field).toHaveValue('');
  await expect(rhea.getByRole('button').first()).toContainText('Notes, web, commands, 1 folder');
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

  // Notes read only: the level does not change.
  await rhea.getByRole('switch', { name: 'Write in the notes' }).click();
  await expect(rhea.getByRole('button').first()).toContainText(
    'Read-only notes, web, commands, 1 folder',
  );
  await expect(page.getByLabel('What Rhea can do')).toHaveValue('commands');

  // Another monster keeps its own permissions.
  await expect(
    page.getByTestId('agent-permissions-dione').getByTestId('permissions-summary'),
  ).toHaveText('Notes, web, commands');

  // Remove the folder.
  await rhea.getByRole('button', { name: 'Remove /home/demo/Progetti' }).click();
  await expect(rhea.getByTestId('folder-grant')).toHaveCount(0);

  // Every change is in the log.
  await page.goto('/?mock=demo#/log');
  await expect(page.getByText('You changed Rhea’s permissions').first()).toBeVisible();
});

test.describe('the folder dialog of the desktop app', () => {
  test('a folder is chosen in the system dialog; the typed path is still there', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { monstersDesktop: unknown }).monstersDesktop = {
        isDesktop: true,
        version: '0.0.0',
        platform: 'linux',
        chrome: 'frame',
        setupCode: () => Promise.resolve(null),
        target: () => Promise.resolve({ kind: 'local', name: 'This computer', state: 'ready' }),
        pickFolder: () => Promise.resolve('/home/demo/Progetti'),
      };
    });
    const rhea = await openRhea(page);
    await expect(rhea.getByLabel('Add a folder: computer folders')).toHaveCount(0);
    await rhea.getByTestId('folder-grant-pick').click();
    await expect(rhea.getByTestId('folder-grant')).toHaveText(/\/home\/demo\/Progetti/);
    // Choosing it again is caught like a typed one.
    await rhea.getByTestId('folder-grant-pick').click();
    await expect(rhea.getByRole('alert')).toContainText('already there');
    // The path can still be typed.
    await rhea.getByRole('button', { name: 'Type a path instead' }).click();
    await expect(rhea.getByLabel('Add a folder: computer folders')).toBeVisible();
  });
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
      await section.getByTestId('permissions-fine').getByRole('button').first().click();
      const mimas = section.getByTestId('agent-permissions-fine-mimas');
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
