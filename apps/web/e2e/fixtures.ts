import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails if the page logs an error or throws. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors, 'errors in the browser console').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/*
 * The tests decide when the mock core moves on (`MockCore.hold`): scripted
 * steps and request replies wait until `stepMock` or `releaseMock`, so a
 * passing state stays on screen however slow the machine is.
 */
interface MockGate {
  hold(): void;
  step(): boolean;
  release(): void;
}
const gate = (page: Page, action: keyof MockGate) =>
  page.evaluate(
    (a) => (window as unknown as { __monstersMock: MockGate }).__monstersMock[a](),
    action,
  );

export const holdMock = (page: Page) => gate(page, 'hold');
export const releaseMock = (page: Page) => gate(page, 'release');

/** Lets the mock go on one item at a time until `ready` holds. */
export async function stepMockUntil(page: Page, ready: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await ready()) return true;
        await gate(page, 'step');
        return ready();
      },
      { intervals: [50], timeout: 15_000 },
    )
    .toBe(true);
}
