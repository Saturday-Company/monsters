import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests of the UI against a real core (fake model provider, empty
 * home): `pnpm --filter @monsters/web test:e2e:core`. Vite serves the UI and
 * proxies /api to the core, as in development.
 */

const CORE_PORT = 4791;
const UI_PORT = 5181;
const UI = `http://127.0.0.1:${UI_PORT}`;
// Workers inherit the env of the runner: one fresh home per run.
process.env['MONSTERS_E2E_HOME'] ??= join(mkdtempSync(join(tmpdir(), 'monsters-e2e-')), 'home');
const HOME = process.env['MONSTERS_E2E_HOME'];

export default defineConfig({
  testDir: 'e2e-core',
  testMatch: '**/*.e2e.ts',
  outputDir: 'node_modules/.playwright/results-core',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: UI,
    trace: 'retain-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec node ../../packages/core/test/e2e-server.ts',
      env: {
        MONSTERS_E2E_HOME: HOME,
        MONSTERS_E2E_PORT: String(CORE_PORT),
        MONSTERS_E2E_ORIGIN: UI,
      },
      url: `http://127.0.0.1:${CORE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${UI_PORT} --strictPort`,
      env: { MONSTERS_CORE_URL: `http://127.0.0.1:${CORE_PORT}` },
      url: UI,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
