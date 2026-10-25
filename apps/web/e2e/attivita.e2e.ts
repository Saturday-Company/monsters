import { expect, test } from './fixtures.ts';

/* Attività after the visual review (D-066): the segment, "Rispondi", the phone's drawer. */

test('a question still open in Attività: "Rispondi" opens its chat', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  const row = page.getByTestId('event-row').filter({ hasText: 'Titan asked you a question' });
  await expect(row).toBeVisible();
  await row.getByTestId('answer-question').click();
  await expect(page).toHaveURL(/#\/\?chat=titan$/);
  await expect(page.getByTestId('question-card').first()).toHaveAttribute('data-status', 'open');
});

test('the filters line up: "Chi" and the keys start on the same top edge', async ({ page }) => {
  await page.goto('/?mock=demo#/log');
  const who = await page.getByTestId('activity-who').boundingBox();
  const types = await page
    .getByRole('group', { name: 'Filter by type' })
    .getByRole('button')
    .first()
    .boundingBox();
  expect(who && types).toBeTruthy();
  expect(Math.abs(who!.y - types!.y)).toBeLessThanOrEqual(1);
});

/** A ULID of the given time (Crockford base32); `n` tells apart ids of one millisecond. */
function ulidAt(time: number, n: number): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = time;
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = alphabet.charAt(t % 32) + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  let r = n;
  for (let i = 0; i < 16; i++) {
    tail = alphabet.charAt(r % 32) + tail;
    r = Math.floor(r / 32);
  }
  return head + tail;
}

test('"Load older" past 600 events makes the list longer, one page at a time (W-8)', async ({
  page,
}) => {
  // 1500 old replies in the mock's log before the app reads it: the first page (400) is full of them.
  const base = Date.now() - 60 * 24 * 3_600_000;
  const seed = Array.from({ length: 1500 }, (_, i) => ({
    id: ulidAt(base + i * 1000, i),
    ts: base + i * 1000,
    agent: 'titan',
    runId: null,
    parentId: null,
    type: 'message',
    data: { role: 'agent', text: `Old reply ${i}` },
  }));
  await page.addInitScript((events) => {
    let mock: { events: { id: string }[] } | undefined;
    Object.defineProperty(window, '__monstersMock', {
      configurable: true,
      get: () => mock,
      set: (m: { events: { id: string }[] }) => {
        mock = m;
        m.events.push(...events);
        m.events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      },
    });
  }, seed);
  await page.goto('/?mock=demo#/log');
  await page.getByRole('radio', { name: 'Everything' }).click();
  const rows = page.getByTestId('event-row');
  await expect(rows.first()).toBeVisible();
  const more = page.getByRole('button', { name: 'Load older' });
  // Each press adds a page to the list, past the 600 it started with.
  let seen = await rows.count();
  expect(seen).toBeLessThanOrEqual(600);
  for (let i = 0; i < 3; i++) {
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(seen);
    seen = await rows.count();
  }
  expect(seen).toBeGreaterThan(600);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('one "Filtri" key opens a drawer with who, the types and the period', async ({ page }) => {
    await page.goto('/?mock=demo#/log');
    await expect(page.getByTestId('activity-who')).toBeHidden();
    await page.getByRole('button', { name: /^Filters/ }).click();
    const drawer = page.getByTestId('activity-more');
    await expect(drawer.getByTestId('activity-who')).toBeVisible();
    await drawer.getByRole('button', { name: 'Errors' }).click();
    // The count of the filters on is on the key.
    await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
    for (const text of await page.getByTestId('event-row').allInnerTexts())
      expect(text).toMatch(/ERRORS/i);
    await drawer.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('button', { name: /^Filters/ })).not.toContainText('1');
  });

  test('a note named by date never breaks on its dash', async ({ page }) => {
    await page.goto('/?mock=demo#/log');
    const date = page
      .getByTestId('event-row')
      .filter({ hasText: 'the note 2026-10-14' })
      .locator('span.whitespace-nowrap', { hasText: '2026-10-14' });
    await expect(date).toBeVisible();
    const box = await date.boundingBox();
    // One line of text, not two.
    expect(box!.height).toBeLessThan(30);
  });
});
