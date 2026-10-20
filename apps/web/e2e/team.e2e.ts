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
  await rhea.getByRole('button', { name: 'Cambia il nome di Rhea' }).click();
  const field = rhea.getByLabel('Il nome di Rhea');
  await field.fill('Ti4');
  await rhea.getByRole('button', { name: 'Salva' }).click();
  await expect(rhea.getByRole('alert')).toContainText('Solo lettere');
  await field.fill('dione');
  await rhea.getByRole('button', { name: 'Salva' }).click();
  await expect(rhea.getByRole('alert')).toContainText('C’è già un mostro');
  await field.fill('Febe');
  await rhea.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Rhea ora si chiama Febe.')).toBeVisible();
  // Same monster (same id), new name everywhere.
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Febe,/ })).toBeVisible();

  // A look among new previews, the current one first.
  const febe = page.getByTestId('team-member-rhea');
  await febe.getByRole('button', { name: 'Cambia aspetto' }).click();
  const looks = febe.getByTestId('team-looks-rhea');
  await expect(looks.getByRole('radio')).toHaveCount(4);
  await expect(looks.getByRole('radio', { name: 'Lascia Febe com’è' })).toBeVisible();
  await looks.getByRole('radio', { name: 'Aspetto nuovo 2 per Febe' }).click();
  await expect(page.getByText('Febe ha un aspetto nuovo.')).toBeVisible();

  await page.goto('/?mock=demo#/log');
  await expect(page.getByText('Hai cambiato nome a Rhea: ora è Febe').first()).toBeVisible();
});

test('role and duties: checked in the page, AGENTS.md edited by hand needs a yes', async ({
  page,
}) => {
  await openTeam(page);
  const enceladus = await openMember(page, 'enceladus');
  await enceladus.getByRole('button', { name: 'Modifica' }).click();
  const form = enceladus.getByTestId('team-role-form-enceladus');
  await form.getByLabel('Compiti, uno per riga').fill('');
  await form.getByRole('button', { name: 'Salva' }).click();
  await expect(form.getByText('Serve almeno un compito.')).toBeVisible();
  await form
    .getByLabel('Compiti, uno per riga')
    .fill('Non cancelli mai una nota: la sposti in Archivio.\nOgni lunedì togli i doppioni.');
  await form.getByRole('button', { name: 'Salva' }).click();
  // Its instructions were changed by hand: replace them only after a yes.
  const overwrite = form.getByTestId('team-overwrite');
  await expect(overwrite).toContainText('Hai modificato a mano le istruzioni di Enceladus');
  await expect(overwrite).toContainText('Una copia resta salvata');
  await overwrite.getByRole('button', { name: 'Sostituisci' }).click();
  await expect(page.getByText('Ruolo e compiti di Enceladus salvati.')).toBeVisible();
  await expect(page.getByTestId('team-member-enceladus')).toContainText('2 compiti');
});

test('remove a monster, find it among the archived, bring it back', async ({ page }) => {
  await openTeam(page);
  // The capo squadra cannot be removed: only its name changes.
  const titan = await openMember(page, 'titan');
  await expect(titan.getByRole('button', { name: 'Togli' })).toHaveCount(0);
  await expect(titan).toContainText('il suo ruolo non si cambia');

  const dione = await openMember(page, 'dione');
  await dione.getByRole('button', { name: 'Togli' }).click();
  await dione.getByRole('button', { name: 'Sì, togli' }).click();
  await expect(page.getByText(/Dione non è più nella squadra/)).toBeVisible();
  await expect(page.getByTestId('team-member-dione')).toHaveCount(0);
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Dione,/ })).toHaveCount(0);

  const archived = page.getByTestId('team-archived-dione');
  await expect(archived).toContainText('Tolto il');
  await archived.getByRole('button', { name: 'Riporta' }).click();
  await expect(page.getByText('Dione è di nuovo nella squadra.')).toBeVisible();
  await expect(page.getByTestId('team-member-dione')).toBeVisible();
  await expect(page.getByTestId('team-archived')).toHaveCount(0);
});

test('add a monster from a description, reviewed before it is added', async ({ page }) => {
  await openTeam(page);
  await page.getByRole('button', { name: 'Aggiungi un mostro' }).click();
  const add = page.getByTestId('team-add');
  // An idea fills the description.
  await add.getByRole('button', { name: 'Riassunti' }).click();
  await expect(add.getByLabel('Cosa deve fare?')).toHaveValue(
    'Riassume documenti e note lunghe in pochi punti chiari.',
  );
  await add.getByRole('button', { name: 'Prepara il mostro' }).click();
  const draft = page.getByTestId('team-draft');
  await expect(draft.getByLabel('Cosa fa, in una riga')).toHaveValue(
    'Riassume documenti e note lunghe in pochi punti chiari.',
  );
  await draft.getByLabel('Nome', { exact: true }).fill('Pan');
  await draft.getByRole('button', { name: 'Un altro aspetto' }).click();
  await draft.getByRole('button', { name: 'Aggiungi alla squadra' }).click();
  await expect(page.getByText('Pan è nella squadra: scrivigli dalla sua chat.')).toBeVisible();
  await expect(page.getByTestId('team-member-pan')).toBeVisible();
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Pan,/ })).toBeVisible();
});

test('your profile: name and tone; what to always ask, in Permessi', async ({ page }) => {
  await openTeam(page);
  const you = page.getByTestId('team-you');
  await you.getByRole('button', { name: 'Cambia il tuo nome' }).click();
  await you.getByLabel('Il tuo nome').fill('Giulia');
  await you.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Da ora i mostri ti chiamano Giulia.')).toBeVisible();
  await expect(you.getByTestId('team-user-name')).toContainText('Giulia');

  await you.getByLabel('Tono').selectOption({ index: 1 });
  await expect(page.getByText('Tono salvato.')).toBeVisible();

  // What they always ask lives in Permessi now (D-066): Squadra links to it.
  await you.getByTestId('team-ask-always-link').click();
  await expect(page.getByRole('tab', { name: 'Permessi' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const ask = page.getByTestId('team-ask-always');
  await expect(ask).toContainText('Pubblicare, scrivere ad altri');
  const goal = ask.getByRole('switch', { name: 'Cambiare un obiettivo' });
  await goal.click();
  await expect(goal).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Da ora ti chiedono prima di: cambiare un obiettivo.')).toBeVisible();
});

test('change the password: the current one is checked, then the new one works', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=generale');
  const account = page.getByTestId('settings-account');
  await account.getByRole('button', { name: 'Cambia password' }).click();
  const form = account.getByTestId('password-form');
  await form.getByLabel('Password attuale').fill('sbagliata');
  await form.getByLabel('Nuova password', { exact: true }).fill('corta');
  await form.getByRole('button', { name: 'Cambia password' }).click();
  await expect(form.getByText('Almeno 8 caratteri.', { exact: true }).first()).toBeVisible();
  await form.getByLabel('Nuova password', { exact: true }).fill('una-password-nuova');
  await form.getByLabel('Ripeti la nuova password').fill('una-password-diversa');
  await form.getByRole('button', { name: 'Cambia password' }).click();
  await expect(form.getByText('Le due password non sono uguali.')).toBeVisible();
  await form.getByLabel('Ripeti la nuova password').fill('una-password-nuova');
  await form.getByRole('button', { name: 'Cambia password' }).click();
  await expect(form.getByRole('alert')).toHaveText('La password attuale non è giusta.');

  await form.getByLabel('Password attuale').fill('mostriciattoli');
  await form.getByRole('button', { name: 'Cambia password' }).click();
  await expect(page.getByText('Password cambiata.')).toBeVisible();
  await expect(account.getByTestId('password-form')).toHaveCount(0);

  // Out and in again with the new one.
  await account.getByRole('button', { name: 'Esci' }).click();
  await page.getByLabel('Email').fill('ciao@monsters.local');
  await page.getByLabel('Password').fill('una-password-nuova');
  await page.getByRole('button', { name: 'Entra' }).click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
});
