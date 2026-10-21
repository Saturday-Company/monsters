import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * Settings → Squadra (D-058) and the password (D-057) on the mock core: the
 * team after the onboarding (rename, look, role and duties, remove and bring
 * back, add), the user's profile, "Cambia password". Every change reaches the
 * sidebar and Attività.
 */

async function openTeam(page: Page) {
  await page.goto('/?mock=demo#/impostazioni');
  await expect(page.getByTestId('team-members')).toBeVisible();
}

async function openMember(page: Page, id: string) {
  const row = page.getByTestId(`team-member-${id}`);
  await row.getByRole('button', { expanded: false }).first().click();
  return row;
}

test('rename a monster and give it another look', async ({ page }) => {
  await openTeam(page);
  const rhea = await openMember(page, 'rhea');
  await rhea.getByRole('button', { name: 'Change Rhea’s name' }).click();
  const field = rhea.getByLabel('Rhea’s name');
  await field.fill('Ti4');
  await rhea.getByRole('button', { name: 'Save' }).click();
  await expect(rhea.getByRole('alert')).toContainText('Letters only');
  await field.fill('dione');
  await rhea.getByRole('button', { name: 'Save' }).click();
  await expect(rhea.getByRole('alert')).toContainText('There’s already a monster');
  await field.fill('Febe');
  await rhea.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Rhea is now called Febe.')).toBeVisible();
  // Same monster (same id), new name everywhere.
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Febe,/ })).toBeVisible();

  // A look among new previews, the current one first.
  const febe = page.getByTestId('team-member-rhea');
  await febe.getByRole('button', { name: 'Change look' }).click();
  const looks = febe.getByTestId('team-looks-rhea');
  await expect(looks.getByRole('radio')).toHaveCount(4);
  await expect(looks.getByRole('radio', { name: 'Keep Febe as is' })).toBeVisible();
  await looks.getByRole('radio', { name: 'New look 2 for Febe' }).click();
  await expect(page.getByText('Febe has a new look.')).toBeVisible();

  await page.goto('/?mock=demo#/log');
  await expect(page.getByText('You renamed Rhea: now Febe').first()).toBeVisible();
});

test('role and duties: checked in the page, AGENTS.md edited by hand needs a yes', async ({
  page,
}) => {
  await openTeam(page);
  const enceladus = await openMember(page, 'enceladus');
  await enceladus.getByRole('button', { name: 'Edit' }).click();
  const form = enceladus.getByTestId('team-role-form-enceladus');
  await form.getByLabel('Duties, one per line').fill('');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('At least one duty is needed.')).toBeVisible();
  await form
    .getByLabel('Duties, one per line')
    .fill('You never delete a note: you move it to Archive.\nEvery Monday you remove duplicates.');
  await form.getByRole('button', { name: 'Save' }).click();
  // Its instructions were changed by hand: replace them only after a yes.
  const overwrite = form.getByTestId('team-overwrite');
  await expect(overwrite).toContainText('You edited Enceladus’s instructions by hand');
  await expect(overwrite).toContainText('A copy stays saved');
  await overwrite.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Enceladus’s role and duties saved.')).toBeVisible();
  await expect(page.getByTestId('team-member-enceladus')).toContainText('2 duties');
});

test('remove a monster, find it among the archived, bring it back', async ({ page }) => {
  await openTeam(page);
  // The capo squadra cannot be removed: only its name changes.
  const titan = await openMember(page, 'titan');
  await expect(titan.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(titan).toContainText('its role can’t be changed');

  const dione = await openMember(page, 'dione');
  await dione.getByRole('button', { name: 'Remove' }).click();
  await dione.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText(/Dione is no longer in the squad/)).toBeVisible();
  await expect(page.getByTestId('team-member-dione')).toHaveCount(0);
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Dione,/ })).toHaveCount(0);

  const archived = page.getByTestId('team-archived-dione');
  await expect(archived).toContainText('Removed on');
  await archived.getByRole('button', { name: 'Bring back' }).click();
  await expect(page.getByText('Dione is back in the squad.')).toBeVisible();
  await expect(page.getByTestId('team-member-dione')).toBeVisible();
  await expect(page.getByTestId('team-archived')).toHaveCount(0);
});

test('add a monster from a description, reviewed before it is added', async ({ page }) => {
  await openTeam(page);
  await page.getByRole('button', { name: 'Add a monster' }).click();
  const add = page.getByTestId('team-add');
  // An idea fills the description.
  await add.getByRole('button', { name: 'Summaries' }).click();
  await expect(add.getByLabel('What should it do?')).toHaveValue(
    'Sums up long documents and notes in a few clear points.',
  );
  await add.getByRole('button', { name: 'Prepare the monster' }).click();
  const draft = page.getByTestId('team-draft');
  await expect(draft.getByLabel('What it does, in one line')).toHaveValue(
    'Sums up long documents and notes in a few clear points.',
  );
  await draft.getByLabel('Name', { exact: true }).fill('Pan');
  await draft.getByRole('button', { name: 'Another look' }).click();
  await draft.getByRole('button', { name: 'Add to the squad' }).click();
  await expect(page.getByText('Pan is in the squad: write to it from its chat.')).toBeVisible();
  await expect(page.getByTestId('team-member-pan')).toBeVisible();
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Pan,/ })).toBeVisible();
});

test('your profile: name and tone; what to always ask, in Permessi', async ({ page }) => {
  await openTeam(page);
  const you = page.getByTestId('team-you');
  await you.getByRole('button', { name: 'Change your name' }).click();
  await you.getByLabel('Your name').fill('Giulia');
  await you.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('From now on the monsters call you Giulia.')).toBeVisible();
  await expect(you.getByTestId('team-user-name')).toContainText('Giulia');

  await you.getByLabel('Tone').selectOption({ index: 1 });
  await expect(page.getByText('Tone saved.')).toBeVisible();

  // What they always ask lives in Permessi now (D-066): Squadra links to it.
  await you.getByTestId('team-ask-always-link').click();
  await expect(page.getByRole('tab', { name: 'Permissions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const ask = page.getByTestId('team-ask-always');
  await expect(ask).toContainText('Publishing, writing to others');
  const goal = ask.getByRole('switch', { name: 'Changing a goal' });
  await goal.click();
  await expect(goal).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('From now on they ask you first: changing a goal.')).toBeVisible();
});

test('change the password: the current one is checked, then the new one works', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=generale');
  const account = page.getByTestId('settings-account');
  await account.getByRole('button', { name: 'Change password' }).click();
  const form = account.getByTestId('password-form');
  await form.getByLabel('Current password').fill('wrong');
  await form.getByLabel('New password', { exact: true }).fill('short');
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByText('At least 8 characters.', { exact: true }).first()).toBeVisible();
  await form.getByLabel('New password', { exact: true }).fill('a-new-password');
  await form.getByLabel('Repeat the new password').fill('a-different-password');
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByText('The two passwords don’t match.')).toBeVisible();
  await form.getByLabel('Repeat the new password').fill('a-new-password');
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByRole('alert')).toHaveText('The current password isn’t right.');

  await form.getByLabel('Current password').fill('mostriciattoli');
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed.')).toBeVisible();
  await expect(account.getByTestId('password-form')).toHaveCount(0);

  // Out and in again with the new one.
  await account.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email').fill('ciao@monsters.local');
  await page.getByLabel('Password').fill('a-new-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
});
