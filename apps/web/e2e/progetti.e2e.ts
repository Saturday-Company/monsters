import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoSideScroll,
  holdMock,
  releaseMock,
  SHOT_LANG,
  stepMockUntil,
  test,
} from './fixtures.ts';

/*
 * Projects in the UI (D-097, D-098, D-100) on the mock core: the demo has
 * "Social di Saturday" (the lead Iapetus with Calypso and Pandora, "Post
 * della settimana") and a draft the orchestrator proposed, "Sito di
 * Saturday". `MONSTERS_E2E_SHOTS=<folder>` saves the screenshots of the
 * design review (desktop light, phone dark).
 */

const SHOTS = process.env['MONSTERS_E2E_SHOTS'];

async function closeNotice(page: Page) {
  // The demo's notice (a tool in pause) would cover the page.
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.count()) {
    await close.first().click();
    await expect(close).toHaveCount(0);
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await closeNotice(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function noSideScroll(page: Page, width: number) {
  await expectNoSideScroll(page, width);
}

const squad = (page: Page, key: string) =>
  page.getByTestId('sidebar').locator(`[data-testid="squad"][data-squad="${key}"]`);

test('Progetti: the squads in the sidebar, the page of a project and its tabs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  const sidebar = page.getByTestId('sidebar');
  // The God's bar is the orchestrator's chat (D-102), then the squads.
  await expect(sidebar.getByTestId('god-bar')).toHaveAttribute('data-agent', 'titan');
  await expect(sidebar.locator('[data-testid="chat-row"][data-agent="titan"]')).toHaveCount(0);
  await expect(squad(page, 'personale').getByRole('heading')).toContainText('Personal squad');
  const social = squad(page, 'social-di-saturday');
  await expect(social.getByTestId('chat-row')).toHaveCount(3);
  // The lead first.
  await expect(social.getByTestId('chat-row').first()).toHaveAttribute('data-agent', 'iapetus');
  await expect(sidebar.getByTestId('project-new')).toBeVisible();
  // The sections stay in reach under the squads.
  await expect(
    sidebar.getByTestId('sidebar-foot').getByRole('link', { name: 'Note' }),
  ).toBeInViewport();
  await shot(page, 'progetti-barra-laterale-chiaro');

  // Folding a squad hides its monsters, and is remembered.
  await social.getByTestId('squad-fold').click();
  await expect(social.getByTestId('chat-row')).toHaveCount(0);
  await page.reload();
  await expect(squad(page, 'social-di-saturday').getByTestId('chat-row')).toHaveCount(0);
  await squad(page, 'social-di-saturday').getByTestId('squad-fold').click();
  await expect(squad(page, 'social-di-saturday').getByTestId('chat-row')).toHaveCount(3);

  // The project's name opens its page, on the chat with the lead.
  await squad(page, 'social-di-saturday').getByTestId('squad-link').click();
  await expect(page).toHaveURL(/#\/progetto\?id=social-di-saturday$/);
  const toolbar = page.locator('[data-titlebar]');
  await expect(toolbar.getByRole('heading', { name: 'Saturday Social' })).toBeVisible();
  await expect(squad(page, 'social-di-saturday').getByTestId('squad-link')).toHaveAttribute(
    'aria-current',
    'page',
  );
  const tabs = page.getByRole('tablist', { name: 'Saturday Social sections' });
  await expect(tabs.getByRole('tab')).toHaveCount(7);
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'iapetus');
  await expect(page.getByTestId('project-stop')).toBeVisible();
  await shot(page, 'progetti-pagina-chat-chiaro');

  await tabs.getByRole('tab', { name: 'Squad' }).click();
  await expect(page).toHaveURL(/sezione=squadra/);
  const members = page.getByTestId('project-member');
  await expect(members).toHaveCount(3);
  await expect(members.first()).toContainText('IapetusLead');
  await shot(page, 'progetti-pagina-squadra-chiaro');

  await tabs.getByRole('tab', { name: 'Note' }).click();
  // The giri of "Post della settimana" wrote their notes in the project's area.
  await expect(page.getByTestId('project-note')).toHaveCount(2);
  await tabs.getByRole('tab', { name: 'Folder' }).click();
  await expect(page.getByTestId('project-folder-path')).toHaveText(
    '/home/andrea/Projects/social-saturday',
  );
  await tabs.getByRole('tab', { name: 'Connections' }).click();
  await expect(page.getByTestId('project-web').getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await tabs.getByRole('tab', { name: 'Automations' }).click();
  const auto = page.getByTestId('automation-row');
  await expect(auto).toHaveCount(1);
  await expect(auto).toContainText('Weekly posts');
  await tabs.getByRole('tab', { name: 'Spending' }).click();
  await expect(page.getByTestId('project-spend')).toContainText('This month');
  await expect(page.getByTestId('project-caps-month')).toHaveValue('20');
  await expect(page.getByTestId('project-spend-team')).toContainText('whole squad');
  await shot(page, 'progetti-pagina-spesa-chiaro');

  // Automazioni groups by project, with the project's name.
  await page.getByTestId('sidebar').getByRole('link', { name: 'Automations' }).click();
  await expect(page.getByTestId('automation-squad').getByRole('heading')).toHaveText(
    'Saturday Social · 1',
  );
});

test('Progetti: a new project from the sidebar, with its lead and a copied monster', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await page.getByTestId('project-new').click();
  await expect(page).toHaveURL(/#\/progetto\?vista=nuovo$/);
  const form = page.getByTestId('project-form');
  // Nothing written: the form says what is missing.
  await page.getByTestId('project-create').click();
  await expect(form).toContainText('Give the project a name.');
  await page.getByTestId('project-name').fill('Newsletter');
  await form
    .getByRole('radiogroup', { name: 'The project’s folder' })
    .getByRole('radio', { name: 'A new one' })
    .click();
  await expect(page.getByTestId('project-path')).toHaveValue('~/Monsters Projects/Newsletter');
  await page.getByTestId('project-lead-name').fill('Atlas');
  await page.getByTestId('project-copies').getByTestId('pick-rhea').click();
  await expect(page.getByTestId('project-copies').getByTestId('pick-rhea')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await shot(page, 'progetti-nuovo-chiaro');
  await page.getByTestId('project-create').click();

  await expect(page).toHaveURL(/#\/progetto\?id=newsletter$/);
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'atlas');
  const news = squad(page, 'newsletter');
  await expect(news.getByTestId('chat-row')).toHaveCount(2);
  await expect(news.getByTestId('chat-row').first()).toHaveAttribute('data-agent', 'atlas');
  // The copy has a name and a look of its own (D-122), Rhea's role.
  const copy = news.getByTestId('chat-row').nth(1);
  await expect(copy).toContainText('Finds and checks sources');
  await expect(copy).not.toContainText('Rhea');
  // The original stays in the personal squad.
  await expect(squad(page, 'personale').locator('[data-agent="rhea"]')).toHaveCount(1);

  // Squadra: a copy with the name the core would give it, then removed.
  await page.getByRole('tab', { name: 'Squad' }).click();
  await page.getByTestId('project-add-copy').click();
  await page
    .locator('[data-testid="project-copy-row"][data-agent="dione"]')
    .getByRole('button', { name: 'Copy Dione into the project' })
    .click();
  // A free name of its own, not "Dione · Newsletter" (D-122).
  const copyName = page.getByTestId('project-copy-name');
  await expect(copyName).not.toHaveValue('');
  await expect(copyName).not.toHaveValue(/Dione/);
  const given = await copyName.inputValue();
  await page.getByTestId('project-copy-save').click();
  await expect(page.getByTestId('project-member')).toHaveCount(3);
  const dione = page.getByTestId('project-member').filter({ hasText: given });
  await dione.getByRole('button', { expanded: false }).first().click();
  await dione.getByRole('button', { name: 'Remove' }).click();
  await dione.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByTestId('project-member')).toHaveCount(2);

  // Archive (at the foot of Cartella), then restore from the archived projects of the sidebar.
  await page.getByRole('tab', { name: 'Folder' }).click();
  await page.getByTestId('project-archive').getByRole('button', { name: 'Archive' }).click();
  await page.getByTestId('project-archive').getByRole('button', { name: 'Yes, archive' }).click();
  await expect(page.getByTestId('project-archived-page')).toBeVisible();
  await expect(squad(page, 'newsletter')).toHaveCount(0);
  await page.getByTestId('project-restore').click();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await expect(squad(page, 'newsletter').getByTestId('chat-row')).toHaveCount(2);
});

test('Progetti: a new project starts with the team’s connections on, the user turns off the rest (D-129)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  // The mock core loads after the page's own load event: wait for it before reaching into it.
  await page.waitForFunction(() => '__monstersMock' in window);
  // Canva and Figma through Claude, given to the whole team.
  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        __monstersMock: { handle(m: string, p: string, b: unknown): unknown };
      }
    ).__monstersMock;
    mock.handle('PUT', '/api/claude-connections/canva', {});
    mock.handle('PUT', '/api/claude-connections/figma', {});
  });
  await page.getByTestId('project-new').click();
  await page.getByTestId('project-name').fill('Nebula');
  const links = page.getByTestId('project-form-links');
  await expect(links.getByTestId('project-form-link')).toHaveCount(2);
  const canva = links.getByRole('switch', { name: 'Canva for the project' });
  const figma = links.getByRole('switch', { name: 'Figma for the project' });
  await expect(canva).toHaveAttribute('aria-checked', 'true');
  await expect(figma).toHaveAttribute('aria-checked', 'true');
  await figma.click();
  await expect(figma).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('project-create').click();
  await expect(page).toHaveURL(/#\/progetto\?id=nebula$/);
  await page.getByRole('tab', { name: 'Connections' }).click();
  const chosen = page.getByTestId('project-links');
  await expect(chosen.getByRole('switch', { name: 'Canva for the project' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(chosen.getByRole('switch', { name: 'Figma for the project' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('Progetti: the orchestrator’s draft in Da rivedere, confirmed with its plan', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await page.getByTestId('review-toggle').click();
  const card = page.getByTestId('draft-card').filter({ hasText: 'Saturday website' });
  await expect(card).toHaveAttribute('data-kind', 'project');
  await expect(card).toContainText('Titan proposes a project');
  // In the narrow column the project is a summary: the whole plan is on its page.
  await expect(card.getByTestId('draft-plan-summary')).toContainText('Atlas leads');
  await expect(card.getByTestId('draft-plan')).toHaveCount(0);
  await expect(card.getByTestId('draft-discard')).toHaveCount(0);
  await shot(page, 'progetti-da-rivedere-chiaro');

  // Apri opens the draft's page with its plan.
  await card.getByTestId('draft-edit').click();
  await expect(page.getByTestId('project-draft-page')).toBeVisible();
  const plan = page.getByTestId('draft-plan');
  await expect(plan).toContainText('Atlas');
  await expect(plan).toContainText('Telesto');
  await expect(plan).toContainText('with Rhea’s role and rules; its own name, look and memory');
  await expect(plan).toContainText('I’ll create it when you confirm');
  await expect(plan).toContainText('“Website check”');
  await expect(page.getByTestId('project-draft-banner')).toContainText('Titan proposed it.');
  await page.goBack();
  // The column stays open (a preference of this browser).
  await card.getByTestId('draft-confirm').click();
  const sito = squad(page, 'sito-di-saturday');
  await expect(sito.getByTestId('chat-row')).toHaveCount(3);
  await expect(sito.getByTestId('chat-row').first()).toHaveAttribute('data-agent', 'atlas');
  // Its first automation is a draft of its own, in Da rivedere.
  const auto = page.getByTestId('draft-card').filter({ hasText: 'Website check' });
  await expect(auto).toHaveAttribute('data-kind', 'automation');
  await expect(card).toHaveCount(0);
});

test('Progetti: Ferma progetto stops its monsters with two presses, not the kill switch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Slow scripts: the lead is still at work when the second press arrives.
  await page.goto('/?mock=demo&mockSpeed=6#/progetto?id=social-di-saturday');
  await expect(page.getByTestId('chat-panel')).toHaveAttribute('data-agent', 'iapetus');
  await holdMock(page);
  const input = page.getByRole('combobox', { name: 'Message' });
  await input.fill('Prepare the Halloween posts');
  await input.press('Enter');
  await stepMockUntil(page, () => page.getByTestId('working-row').isVisible());
  const stop = page.getByTestId('project-stop');
  await stop.click();
  await expect(stop).toHaveAttribute('data-armed', 'true');
  await expect(stop).toHaveAccessibleName('Press again to stop Saturday Social');
  // The answer of the core must not wait in the mock's queue.
  await releaseMock(page);
  await stop.click();
  await expect(page.getByText('I stopped the work of Saturday Social: 1 job.')).toBeVisible();
  // The kill switch is still up: the other squads go on.
  await expect(page.getByTestId('halt-banner')).toHaveCount(0);
});

for (const scheme of ['dark', 'light'] as const) {
  test(`Progetti on a phone in ${scheme}: squads, the page, Da rivedere, no sideways scroll`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?mock=demo');
    const tag = scheme === 'dark' ? 'scuro' : 'chiaro';
    await expect(squad(page, 'social-di-saturday').getByTestId('chat-row')).toHaveCount(3);
    await noSideScroll(page, 390);
    await shot(page, `progetti-barra-laterale-telefono-${tag}`);
    await squad(page, 'social-di-saturday').getByTestId('squad-link').click();
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await noSideScroll(page, 390);
    await shot(page, `progetti-pagina-chat-telefono-${tag}`);
    await page.getByRole('tab', { name: 'Squad' }).click();
    await expect(page.getByTestId('project-member')).toHaveCount(3);
    await noSideScroll(page, 390);
    await shot(page, `progetti-pagina-squadra-telefono-${tag}`);
    await page.getByRole('tab', { name: 'Spending' }).click();
    await expect(page.getByTestId('project-spend')).toBeVisible();
    await noSideScroll(page, 390);
    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByTestId('review-toggle').click();
    await expect(page.getByTestId('review-sheet').getByTestId('draft-card').first()).toBeVisible();
    await noSideScroll(page, 390);
    // The sheet slides in (160 ms): the picture waits for it.
    await page.waitForTimeout(400);
    await shot(page, `progetti-da-rivedere-telefono-${tag}`);
  });
}

test('Progetti: a project’s monster is renamed, changes look and role from its Squadra tab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=squadra');
  const members = page.getByTestId('project-members');
  await expect(members.getByTestId('project-member')).toHaveCount(3);
  const open = async (id: string) => {
    const row = page.locator(`[data-testid="project-member"]`).filter({ has: page.getByText(id) });
    await row.getByRole('button', { expanded: false }).first().click();
    return row;
  };

  // Rename: names are unique across every squad (Rhea is in the personal one).
  let row = await open('Calypso');
  await row.getByRole('button', { name: 'Change Calypso’s name' }).click();
  await row.getByLabel('Calypso’s name').fill('rhea');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByRole('alert')).toContainText('There’s already a monster');
  await row.getByLabel('Calypso’s name').fill('Telesto');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Calypso is now called Telesto.')).toBeVisible();
  await expect(page.getByTestId('sidebar').getByRole('link', { name: /^Telesto,/ })).toBeVisible();

  // Role and duties.
  row = page.getByTestId('project-member').filter({ hasText: 'Telesto' });
  await row.getByRole('button', { name: 'Edit' }).click();
  const form = row.getByTestId('team-role-form-calypso');
  await form.getByLabel('What it does, in one line').fill('Prepares the images for the posts');
  await form
    .getByLabel('Duties, one per line')
    .fill('Choose the photos.\nCrop them for every channel.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Telesto’s role and duties saved.')).toBeVisible();
  await expect(row).toContainText('2 duties');
  await expect(row).toContainText('Prepares the images for the posts');

  // A new look, still in the project; the chat and "Togli" stay.
  await row.getByRole('button', { name: 'Change look' }).click();
  const looks = row.getByTestId('team-looks-calypso');
  await expect(looks.getByRole('radio')).toHaveCount(4);
  await looks.getByRole('radio', { name: 'New look 1 for Telesto' }).click();
  await expect(page.getByText('Telesto has a new look.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Message Telesto' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(page.getByTestId('project-member')).toHaveCount(3);

  // The lead: name and look, no role to edit and no "Togli".
  const lead = members.getByTestId('project-member').first();
  await lead.getByRole('button', { expanded: false }).first().click();
  await expect(lead).toContainText('its role can’t be changed');
  await expect(lead.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(lead.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await lead.getByRole('button', { name: 'Change Iapetus’s name' }).click();
  await lead.getByLabel('Iapetus’s name').fill('Telesto');
  await lead.getByRole('button', { name: 'Save' }).click();
  await expect(lead.getByRole('alert')).toContainText('There’s already a monster');
  await lead.getByLabel('Iapetus’s name').fill('Crio');
  await lead.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Iapetus is now called Crio.')).toBeVisible();
  await expect(page.getByTestId('project-members')).toContainText('Crio');
  await expect(page.getByTestId('project-members')).toContainText('Lead');
  await lead.getByRole('button', { name: 'Change look' }).click();
  await lead.getByRole('radio', { name: 'New look 1 for Crio' }).click();
  await expect(page.getByText('Crio has a new look.')).toBeVisible();
});

const OUT = fileURLToPath(new URL('../../../docs/schermate/', import.meta.url));

for (const theme of ['light', 'dark'] as const) {
  test.describe(`screenshot squadra del progetto ${theme}`, () => {
    test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write the screenshots');
    test.use({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    test('Squadra del progetto, una riga aperta', async ({ page }) => {
      await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=squadra');
      const row = page.getByTestId('project-member').nth(1);
      await row.getByRole('button', { expanded: false }).first().click();
      await expect(row.getByRole('button', { name: 'Change look' })).toBeVisible();
      await closeNotice(page);
      await page.screenshot({
        path: `${OUT}progetto-squadra-${theme}-1440-${SHOT_LANG}.png`,
        animations: 'disabled',
      });
    });
  });
}
