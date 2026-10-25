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
 * Turns the technical details on (Settings → General → Advanced) before the page loads: the
 * line under the replies, the receipts' models and the tokens of a run, which are off by
 * default (D-181). It keeps the other stored preferences; the version is that of
 * `PREFS_VERSION` in `store/prefs.ts`, so the one-time reset does not undo it.
 */
export async function showTechnicalDetails(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('monsters-prefs') ?? '{}') as object;
      localStorage.setItem(
        'monsters-prefs',
        JSON.stringify({ ...stored, showDetails: true, version: 2 }),
      );
    } catch {
      // no storage: the details stay off and the test says so
    }
  });
}

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

/** Turns the technical details on or off in the page that is open now (the store, as the Settings switch does). */
export async function setTechnicalDetails(page: Page, on: boolean): Promise<void> {
  await page.evaluate(
    async ([src, value]) => {
      const { setPrefs } = (await import(/* @vite-ignore */ src as string)) as {
        setPrefs: (p: { showDetails: boolean }) => void;
      };
      setPrefs({ showDetails: value as boolean });
    },
    ['/src/store/prefs.ts', on],
  );
}

/** Opens the "Advanced" drawer of Settings → General (sounds, technical details, notes folder, keys). */
export async function openGeneralAdvanced(page: Page): Promise<void> {
  const drawer = page.getByTestId('general-advanced');
  const toggle = drawer.getByRole('button', { name: /^Advanced/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
