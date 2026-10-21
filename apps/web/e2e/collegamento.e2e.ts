import { expect, test } from './fixtures';

/*
 * The core stops answering (UX 4): after 10 s the display, the bar of the capo, a band under the
 * rail and the writing field all say so; the text stays in the field; when the stream is back the
 * band goes away and Invia works again. The mock's stream is made to fail by closing its sockets
 * and refusing the next ones.
 */

interface MockSockets {
  attach: (socket: { close(code: number, reason: string): void }) => void;
  sockets: Set<{ close(code: number, reason: string): void }>;
}
type Win = { __monstersMock: MockSockets };

test('Core that does not answer: non collegato everywhere, the message waits in the field', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=demo');
  await expect(page.getByTestId('status-display')).toBeVisible();
  await expect(page.getByTestId('link-band')).toHaveCount(0);

  const original = await page.evaluate(() => {
    const m = (window as unknown as Win).__monstersMock;
    const attach = m.attach.bind(m);
    (window as unknown as { __attach: unknown }).__attach = attach;
    m.attach = (s) => setTimeout(() => s.close(1006, 'down'), 0);
    for (const s of [...m.sockets]) s.close(1006, 'down');
    return true;
  });
  expect(original).toBe(true);

  // Not yet: the first seconds are "Reconnecting…".
  await expect(page.getByTestId('status-display')).toHaveAttribute('data-state', 'reconnecting');
  await expect(page.getByTestId('link-band')).toHaveCount(0);

  await expect(page.getByTestId('link-band')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('link-band')).toContainText(
    'Monsters isn’t answering on the computer',
  );
  await expect(page.getByTestId('status-display')).toHaveAttribute('data-state', 'offline');
  await expect(page.getByTestId('status-display')).toContainText('Not connected');

  const field = page.getByRole('combobox', { name: 'Message' });
  await field.fill('Are you there?');
  await expect(page.getByTestId('composer-offline')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(field).toHaveValue('Are you there?');

  // The core is back: "Try now" brings the stream up at once.
  await page.evaluate(() => {
    const w = window as unknown as Win & {
      __attach: MockSockets['attach'];
    };
    w.__monstersMock.attach = w.__attach;
  });
  await page.getByTestId('link-retry').click();
  await expect(page.getByTestId('link-band')).toHaveCount(0);
  await expect(page.getByTestId('composer-offline')).toHaveCount(0);
  await expect(field).toHaveValue('Are you there?');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});
