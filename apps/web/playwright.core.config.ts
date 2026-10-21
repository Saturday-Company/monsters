import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end test against a real core (`pnpm test:e2e:core`, which builds the UI
 * first): the core serves apps/web/dist on its own origin, with a temporary
 * MONSTERS_HOME and the team on the fake provider (e2e/core/start-core.ts).
 * One core for the whole run, so the test is serial and never retried.
 */

// Workers load this file again: they inherit the folder chosen by the runner.
// The real spelling of the folder (D-148): the core shows the paths it resolves, and the temp
// folder of a Windows runner carries the 8.3 short name (RUNNER~1); on macOS /var is /private/var.
process.env['MONSTERS_E2E_HOME'] ??= join(
  realpathSync.native(mkdtempSync(join(tmpdir(), 'monsters-e2e-'))),
  'home',
);
process.env['MONSTERS_E2E_PORT'] ??= '4797';
const HOME = process.env['MONSTERS_E2E_HOME'];
const PORT = Number(process.env['MONSTERS_E2E_PORT']);

export default defineConfig({
  testDir: 'e2e/core',
  testMatch: '**/*.core.ts',
  outputDir: 'node_modules/.playwright/core-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'node e2e/core/start-core.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { MONSTERS_E2E: '1', MONSTERS_HOME: HOME, MONSTERS_E2E_PORT: String(PORT) },
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
