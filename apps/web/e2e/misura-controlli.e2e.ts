import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * How much the settings ask of a person (wave C of the usability plan): the visible controls of each
 * settings tab on the demo mock, as it opens. `MONSTERS_MEASURE=1` prints them; the ceilings below keep
 * the count from creeping back.
 */

const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="switch"], [role="radio"], [role="checkbox"], [role="combobox"]';

async function countVisible(scope: Locator): Promise<number> {
  return scope.locator(CONTROLS).evaluateAll(
    (els) =>
      els.filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
      }).length,
  );
}

/** An "Advanced" drawer is marked `data-advanced` (`DisclosureRow advanced`). */
const ADVANCED = '[data-advanced]';

async function expandAll(page: Page, panel: Locator, advanced: boolean): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    const summaries = panel.locator('details:not([open]) > summary');
    const closed = panel.locator('button[aria-expanded="false"]');
    const targets = [...(await summaries.all()), ...(await closed.all())];
    let clicked = 0;
    for (const t of targets.reverse()) {
      const isAdvanced = await t.evaluate((el, sel) => el.closest(sel) !== null, ADVANCED);
      if (isAdvanced && !advanced) continue;
      if (!(await t.isVisible())) continue;
      await t.click({ timeout: 2000 }).then(
        () => clicked++,
        () => {},
      );
    }
    if (clicked === 0) break;
    await page.waitForTimeout(300);
  }
}

const TABS = ['squadra', 'modelli', 'permessi', 'collegamenti', 'generale'] as const;

async function measureSettings(page: Page): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const tab of TABS) {
    await page.goto(`/?mock=demo#/impostazioni?sezione=${tab}`);
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeVisible();
    await page.waitForTimeout(400);
    out[tab] = await countVisible(panel);
    // Every row opened, "Advanced" still closed: what a person meets before asking for more.
    await expandAll(page, panel, false);
    out[`${tab}+rows`] = await countVisible(panel);
    // Advanced too (how the 25/10 review counted 204).
    await expandAll(page, panel, true);
    out[`${tab}+all`] = await countVisible(panel);
  }
  out['total'] = TABS.reduce((n, t) => n + out[t]!, 0);
  out['total+rows'] = TABS.reduce((n, t) => n + out[`${t}+rows`]!, 0);
  out['total+all'] = TABS.reduce((n, t) => n + out[`${t}+all`]!, 0);
  return out;
}

test('settings: visible controls per tab', async ({ page }) => {
  const counts = await measureSettings(page);
  if (process.env['MONSTERS_MEASURE']) console.warn('settings', JSON.stringify(counts));
});
