import type { Page } from '@playwright/test';
import { expect, holdMock, releaseMock, test } from './fixtures.ts';

/*
 * The messages the user sends (D-217): the pending bubble is matched with the core's copy by its
 * own id, never by its words; a held message leaves storage only once the core took it; a held
 * message at the bottom does not keep the chat pinned there.
 */

type Mock = { failRequests: (match: string, times?: number) => void };

const row = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Monsters’ chats' })
    .getByRole('link', { name: new RegExp(`^${name},`) });

const bubbles = (page: Page, text: string) =>
  page.getByTestId('user-bubble').filter({ hasText: text });

async function stop(page: Page): Promise<void> {
  await page.getByTestId('kill').click();
  await page.getByTestId('kill').click();
  await expect(page.getByTestId('halt-banner')).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test('the same words as an earlier message, to another monster or with "Again", still show the pending bubble', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=rhea');
  const input = page.getByTestId('composer-input');
  await input.fill('Thanks, that is all');
  await input.press('Enter');
  await expect(bubbles(page, 'Thanks, that is all')).toHaveCount(1);
  await expect(page.getByText('Sending…')).toHaveCount(0);

  // The same words to Dione: the bubble shows while the core has not answered yet.
  await row(page, 'Dione').click();
  await holdMock(page);
  await input.fill('Thanks, that is all');
  await input.press('Enter');
  await expect(bubbles(page, 'Thanks, that is all')).toHaveCount(1);
  await expect(page.getByText('Sending…')).toBeVisible();
  await releaseMock(page);
  // Its copy takes its place: one bubble, not two.
  await expect(page.getByText('Sending…')).toHaveCount(0);
  await expect(bubbles(page, 'Thanks, that is all')).toHaveCount(1);

  // "Again" sends the same words to the same monster: a second bubble, pending, then the copy.
  const frame = page
    .locator('.bubble-frame')
    .filter({ has: page.getByText('Thanks, that is all', { exact: true }) })
    .last();
  await frame.hover();
  await holdMock(page);
  await frame.getByTestId('message-again').click();
  await expect(bubbles(page, 'Thanks, that is all')).toHaveCount(2);
  await expect(page.getByText('Sending…')).toBeVisible();
  await releaseMock(page);
  await expect(page.getByText('Sending…')).toHaveCount(0);
  await expect(bubbles(page, 'Thanks, that is all')).toHaveCount(2);
});

test('a held message whose send fails stays held, and goes once with "Send now"', async ({
  page,
}) => {
  await page.goto('/?mock=demo#/?chat=dione');
  await stop(page);
  const input = page.getByTestId('composer-input');
  await input.fill('When you are back, the caption for the photo');
  await input.press('Enter');
  const held = bubbles(page, 'the caption for the photo');
  await expect(held).toHaveAttribute('data-held', 'true');

  // Resumed, and the core is busy for this one request: the message is not lost.
  await page.evaluate(() =>
    (window as unknown as { __monstersMock: Mock }).__monstersMock.failRequests(
      'POST /api/messages',
      1,
    ),
  );
  await page
    .getByTestId('halt-banner')
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  await expect(page.getByTestId('halt-banner')).toBeHidden();
  const note = page.getByTestId('held-note');
  await expect(note).toContainText('Not sent yet');
  await expect(held).toHaveAttribute('data-held', 'true');

  await note.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByTestId('held-note')).toHaveCount(0);
  await expect(held).toHaveCount(1);
  await expect(held).not.toHaveAttribute('data-held', 'true');
  // Out of storage once taken: a reload (a new mock core) does not send it again.
  await page.reload();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(held).toHaveCount(0);
});

test('a held message at the bottom does not pin the chat there', async ({ page }) => {
  await page.goto('/?mock=demo&mockChat=400#/?chat=titan');
  await expect(page.getByTestId('chat-list')).toHaveAttribute('data-virtual', 'true');
  await expect(page.getByTestId('older-messages')).toHaveText('Earlier messages');
  await stop(page);
  const input = page.getByTestId('composer-input');
  await input.fill('When you are back, read this');
  await input.press('Enter');
  await expect(bubbles(page, 'When you are back, read this')).toHaveAttribute('data-held', 'true');

  const scroller = page.getByTestId('chat-scroller');
  const fromBottom = () =>
    scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(fromBottom).toBeLessThan(4);
  // Up to the top: the earlier messages come in above, and the place is kept.
  const size = () =>
    scroller.evaluate((el) =>
      Number(el.querySelector('[data-testid="chat-list"] > li')?.getAttribute('aria-setsize') ?? 0),
    );
  const before = await size();
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(size, { timeout: 10_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  expect(await fromBottom()).toBeGreaterThan(1000);
  // The user can still scroll back by hand to their message.
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(bubbles(page, 'When you are back, read this')).toBeInViewport();
});
