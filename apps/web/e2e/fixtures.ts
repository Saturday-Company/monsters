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

/**
 * The language of the screenshots written into `docs/schermate/` (`en` by default, `it` with
 * `E2E_LOCALE=it-IT`): it ends the file name (`novita-dark-1440-en.png`), so the README and the
 * Italian README each point to their own.
 */
export const SHOT_LANG = (process.env['E2E_LOCALE'] ?? 'en-US').toLowerCase().startsWith('it')
  ? 'it'
  : 'en';

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

/**
 * The page has no sideways scroll: its width is at most `width` (default: the viewport's own).
 * Polled, never read once: after a resize, a navigation or a new panel the layout settles a few
 * frames later, and one early reading of `scrollWidth` is a coin toss on a slow runner (the
 * macOS one read 728 px at a 390 px phone width). A real overflow stays, so it still fails.
 */
export async function expectNoSideScroll(page: Page, width?: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (max) =>
          document.documentElement.scrollWidth - (max ?? document.documentElement.clientWidth),
        width ?? null,
      ),
    )
    .toBeLessThanOrEqual(0);
}
