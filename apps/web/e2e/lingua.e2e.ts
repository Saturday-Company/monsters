import type { Locator, Page } from '@playwright/test';
import { MOCK_SETUP_CODE } from '../src/lib/mock/constants.ts';
import { expect, expectNoSideScroll, test } from './fixtures.ts';

/*
 * The app's language (D-153) on the mock core. The suites run in English; this is where Italian is
 * checked: the first screen of a browser the app does not speak, the switch of Settings → General,
 * and a short pass over the main screens with `?lang=it`, where the texts are longer.
 */

/**
 * Nothing sticks out of its card (Italian is longer): every visible element of the card ends inside
 * it, apart from what scrolls on its own (a table, a diff) and what is cut with an ellipsis.
 */
async function expectInsideCard(card: Locator): Promise<void> {
  await expect(card).toBeVisible();
  const offenders = await card.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Inside something that scrolls (or clips) on its own: not a spill.
      let scrolls = false;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX !== 'visible' && o.overflowX !== 'clip') scrolls = true;
      }
      if (scrolls) continue;
      if (r.left < box.left - 1 || r.right > box.right + 1) {
        out.push(`${el.tagName.toLowerCase()} “${(el.textContent ?? '').trim().slice(0, 40)}”`);
      } else if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1) {
        // A text cut off its own box without an ellipsis.
        const s = getComputedStyle(el);
        if (s.textOverflow !== 'ellipsis' && s.overflowX === 'visible' && s.display !== 'inline') {
          out.push(`${el.tagName.toLowerCase()} “${(el.textContent ?? '').trim().slice(0, 40)}”`);
        }
      }
    }
    return out;
  });
  expect(offenders, 'elements sticking out of their card').toEqual([]);
}

const card = (page: Page) => page.locator('[data-content-card]').first();

test.describe('a German browser', () => {
  test.use({ locale: 'de-DE' });

  test('the first screen is English with the language switch; Italiano turns it Italian and the account keeps it', async ({
    page,
  }) => {
    // A team that already exists, so that the account is the only step.
    await page.goto('/?mock=team');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const lang = page.getByTestId('language-switch');
    await expect(lang.getByRole('button')).toHaveText(['English', 'Italiano']);
    await expect(lang.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

    await lang.getByRole('button', { name: 'Italiano' }).click();
    await expect(page.getByRole('heading', { name: 'Crea il tuo account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crea account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(lang.getByRole('button', { name: 'Italiano' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByLabel('Email').fill('giulio@esempio.it');
    await page.getByLabel('Password').fill('una-password-lunga');
    await page.getByLabel('Codice di avvio').fill(MOCK_SETUP_CODE);
    await page.getByRole('button', { name: 'Crea account' }).click();
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Impostazioni' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0);

    // The account kept the language: after a reload the app is still Italian, in the settings too.
    await page.reload();
    await expect(
      page.getByTestId('sidebar').getByRole('link', { name: 'Impostazioni' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await page.goto('/?mock=team#/impostazioni?sezione=generale');
    await expect(page.getByRole('radiogroup', { name: 'Lingua' })).toBeVisible();
    await expect(
      page.getByRole('radiogroup', { name: 'Lingua' }).getByRole('radio', { name: 'Italiano' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});

test('Settings → General → Language: English ↔ Italian in place, the page remounts and stays on Settings', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/impostazioni?sezione=generale');
  const titlebar = page.locator('[data-titlebar]');
  const sections = (name: string) =>
    page.getByTestId('sidebar').getByRole('navigation', { name }).getByRole('link');
  await expect(titlebar.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(sections('Sections').first()).toHaveAccessibleName('Automations');
  const english = page.getByRole('radiogroup', { name: 'Language' });
  await expect(english.getByRole('radio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Marks that survive a reload of the tree only if it is not remounted: the page itself stays.
  await page.evaluate(() => {
    (window as unknown as { __kept: boolean }).__kept = true;
    document.querySelector('[data-testid="sidebar"]')?.setAttribute('data-e2e-old', 'yes');
  });
  await english.getByRole('radio', { name: 'Italiano' }).click();
  const italian = page.getByRole('radiogroup', { name: 'Lingua' });
  await expect(italian).toBeVisible();
  await expect(titlebar.getByRole('heading', { name: 'Impostazioni', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Generale' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(sections('Sezioni').first()).toHaveAccessibleName('Automazioni');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=generale$/);
  // The tree was mounted again (the marked sidebar is a new element); the page was not reloaded.
  await expect(page.locator('[data-e2e-old]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);

  await italian.getByRole('radio', { name: 'English' }).click();
  await expect(titlebar.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Language' })).toBeVisible();
  await expect(sections('Sections').first()).toHaveAccessibleName('Automations');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveURL(/#\/impostazioni\?sezione=generale$/);
});

test.describe('the main screens in Italian, at 1024 px', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('chat: the composer and the sidebar', async ({ page }) => {
    await page.goto('/?mock=demo&lang=it#/?chat=titan');
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Messaggio' })).toBeVisible();
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Automazioni' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Note', exact: true })).toBeVisible();
    await expect(page.getByTestId('review-toggle')).toBeVisible();
    await expect(page.getByTestId('kill')).toBeVisible();
    await expectNoSideScroll(page);
    await expectInsideCard(card(page));
  });

  test('notes: the filters panel', async ({ page }) => {
    await page.goto('/?mock=demo&lang=it#/note');
    await expect(page.getByTestId('vault-view')).toBeVisible();
    await page.getByTestId('vault-filters-toggle').click();
    const filters = page.getByTestId('vault-filters');
    // One search box: the exact words are offered after a search with no result, not in the filters.
    await expect(filters.getByRole('radiogroup')).toHaveCount(0);
    await expect(filters.getByRole('group', { name: 'Filtra per tag' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Mostra le note dei mostri' })).toBeVisible();
    await expectNoSideScroll(page);
    await expectInsideCard(filters);
    await expectInsideCard(card(page));
  });

  test('settings: the tabs and the longest texts', async ({ page }) => {
    await page.goto('/?mock=demo&lang=it#/impostazioni');
    const tabs = page.getByRole('tablist', { name: 'Sezioni delle impostazioni' });
    await expect(tabs.getByRole('tab')).toHaveText([
      'Squadra',
      'Modelli',
      'Permessi',
      'App e Telegram',
      'Generale',
    ]);
    await expectNoSideScroll(page);
    await expectInsideCard(card(page));
    for (const tab of ['Permessi', 'App e Telegram', 'Generale']) {
      await tabs.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible();
      await expectNoSideScroll(page);
      await expectInsideCard(card(page));
    }
    await expect(page.getByRole('radiogroup', { name: 'Lingua' })).toBeVisible();
  });

  test('an automation: the list, its page and the new one', async ({ page }) => {
    await page.goto('/?mock=demo&lang=it#/automazioni');
    const toolbar = page.locator('[data-titlebar]');
    await expect(toolbar.getByRole('heading', { name: 'Automazioni', level: 1 })).toBeVisible();
    const row = page.getByTestId('automation-row');
    await expect(row).toContainText('ogni domenica alle 23:00 · Iapetus con Calypso e Pandora');
    await expect(row.getByTestId('automation-next')).toContainText(/^Prossimo: dom/);
    await expectNoSideScroll(page);
    await expectInsideCard(card(page));

    await row.getByRole('link').click();
    const detail = page.getByTestId('automation-detail');
    await expect(detail.getByTestId('automation-crew')).toContainText('Capo');
    await expect(detail.getByTestId('automation-giri')).toContainText('all’ora prevista');
    await expectNoSideScroll(page);
    await expectInsideCard(card(page));

    await page.goto('/?mock=demo&lang=it#/automazioni');
    await page.getByTestId('automation-new').click();
    const form = page.getByTestId('automation-form');
    await expect(form.getByRole('heading', { name: 'Nuova automazione' })).toBeVisible();
    await expect(form.getByRole('radiogroup', { name: 'Quando gira' })).toBeVisible();
    await expectNoSideScroll(page);
    await expectInsideCard(card(page));
  });
});
