import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * How much a project asks of a person (wave C, C5 of the usability plan): the tabs of a project's
 * page, the visible controls of each as it opens, and the fields of the form that creates one, on
 * the demo mock. `MONSTERS_MEASURE=1` prints the numbers; the ceilings keep them from creeping back.
 */

const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="switch"], [role="radio"], [role="checkbox"], [role="combobox"]';
/** What a person fills in or chooses (not the buttons that go places). */
const FIELDS =
  'input:not([type="hidden"]), select, textarea, [role="switch"], [role="radio"], [role="checkbox"]';

async function countVisible(scope: Locator, selector = CONTROLS): Promise<number> {
  return scope.locator(selector).evaluateAll(
    (els) =>
      els.filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      }).length,
  );
}

/** Opens every closed row (`aria-expanded="false"`) of a scope, a few passes for the nested ones. */
async function openRows(page: Page, scope: Locator): Promise<void> {
  for (let pass = 0; pass < 4; pass++) {
    const closed = await scope.locator('button[aria-expanded="false"]').all();
    let clicked = 0;
    for (const b of closed) {
      if (!(await b.isVisible())) continue;
      await b.click({ timeout: 2000 }).then(
        () => clicked++,
        () => {},
      );
    }
    if (clicked === 0) break;
    await page.waitForTimeout(250);
  }
}

test('projects: tabs and visible controls of a project page, fields of the new-project form', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const out: Record<string, number> = {};

  // The form, as it opens and with every row open.
  await page.goto('/?mock=demo#/progetto?vista=nuovo');
  const form = page.getByTestId('project-form');
  await expect(form).toBeVisible();
  await page.waitForTimeout(500);
  out['form'] = await countVisible(form);
  out['form fields'] = await countVisible(form, FIELDS);
  await openRows(page, form);
  out['form+rows'] = await countVisible(form);
  out['form+rows fields'] = await countVisible(form, FIELDS);

  // The page of a project: tabs, and the controls of each tab as it opens.
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday');
  const tabs = page.getByRole('tablist', { name: 'Saturday Social sections' }).getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  await page.waitForTimeout(500);
  const names = await tabs.allInnerTexts();
  out['tabs'] = names.length;
  const panel = page.getByRole('tabpanel');
  out['page as it opens (chat)'] = await countVisible(page.getByTestId('project-page'));
  let all = 0;
  for (const name of names) {
    await page
      .getByRole('tablist', { name: 'Saturday Social sections' })
      .getByRole('tab', { name, exact: true })
      .click();
    await page.waitForTimeout(600);
    const n = await countVisible(panel);
    out[`tab ${name}`] = n;
    all += n;
  }
  out['all tabs'] = all;

  if (process.env['MONSTERS_MEASURE']) console.warn('projects', JSON.stringify(out));
  expect(out['tabs']).toBeLessThanOrEqual(5);
  expect(out['form fields']).toBeLessThanOrEqual(1);
});
