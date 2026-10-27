import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/*
 * A read that fails does not leave "Loading" on the screen for ever (W-12, W-35): the section
 * says it could not read, with a key to try again. The mock core answers 500 to the paths we
 * name until the test lets it through.
 */

interface Mock {
  handle(method: string, path: string, body: unknown): { status: number; body: unknown };
}

/** From now on the mock answers 500 to the paths that contain one of `parts`, while `window.__down` holds. */
async function breakReads(page: Page, parts: string[]): Promise<void> {
  // The mock core is loaded after the page (a dynamic import): wait for it.
  await page.waitForFunction(() => '__monstersMock' in window);
  await page.evaluate((names) => {
    const w = window as unknown as { __monstersMock: Mock; __down: boolean };
    const original = w.__monstersMock.handle.bind(w.__monstersMock);
    w.__down = true;
    w.__monstersMock.handle = (method, path, body) =>
      w.__down && names.some((n) => path.includes(n))
        ? { status: 500, body: { error: 'internal' } }
        : original(method, path, body);
  }, parts);
}

const repair = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __down: boolean }).__down = false;
  });

test('an automation whose runs cannot be read says so, and a retry loads them (W-12)', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/automazioni');
  await expect(page.getByTestId('automation-giri')).toHaveCount(0);
  await breakReads(page, ['/runs']);
  await page.goto('/?mock=demo#/automazioni?automazione=post-della-settimana');
  // `goto` on a hash only moves inside the page: the mock (and our break) is still there.
  const giri = page.getByTestId('automation-giri');
  await expect(giri.getByTestId('automation-giri-error')).toBeVisible();
  await expect(giri.getByText('Loading…')).toHaveCount(0);
  // Still down: the retry shows the error again.
  await giri.getByRole('button', { name: 'Try again' }).click();
  await expect(giri.getByTestId('automation-giri-error')).toBeVisible();
  await repair(page);
  await giri.getByRole('button', { name: 'Try again' }).click();
  await expect(giri.getByTestId('automation-giri-error')).toHaveCount(0);
  await expect(giri.getByRole('link').first()).toBeVisible();
});

test('the connections of a project that cannot be read say so, and a retry loads them (W-35)', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  await breakReads(page, ['/api/mcp-servers', '/api/claude-connections']);
  await page.goto('/?mock=demo#/progetto?id=social-di-saturday&sezione=collegamenti');
  const links = page.getByTestId('project-links');
  await expect(links.getByTestId('project-links-error')).toBeVisible();
  await expect(links.getByText('Loading…')).toHaveCount(0);
  await repair(page);
  await links.getByRole('button', { name: 'Try again' }).click();
  await expect(links.getByTestId('project-links-error')).toHaveCount(0);
  await expect(links.getByText('Loading…')).toHaveCount(0);
  await expect(links.getByRole('listitem').first()).toBeVisible();
});

test('the list of the automations that cannot be read says so, and a retry loads it (R2)', async ({
  page,
}) => {
  await page.goto('/?mock=demo');
  await breakReads(page, ['/api/automations']);
  await page.evaluate(() => (window.location.hash = '#/automazioni'));
  const failed = page.getByTestId('load-failed');
  await expect(failed).toContainText('Couldn’t load the automations.');
  await expect(page.getByText('Loading…')).toHaveCount(0);
  // Still down: the retry shows the notice again.
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(failed).toBeVisible();
  await repair(page);
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('load-failed')).toHaveCount(0);
  await expect(page.getByTestId('automation-row').first()).toBeVisible();
});
