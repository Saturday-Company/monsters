import { defineConfig } from '@playwright/test';

/*
 * End-to-end tests of the desktop app with Playwright's Electron support: the built app
 * (dist/) with the core bundle of `pnpm build:core`, a temporary data directory and user
 * data per test file. Run with `pnpm --filter @monsters/desktop test:e2e` (under xvfb-run on
 * Linux, see scripts/e2e.ts).
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: 'node_modules/.playwright/results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure' },
});
