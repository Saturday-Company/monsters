import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel checkouts (worktrees) run their suites side by side.
const PORT = Number(process.env['E2E_PORT'] ?? 5179);

/** End-to-end tests of the UI in mock mode (no core needed). */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  // Inside node_modules so lint, prettier and git never see traces and reports.
  outputDir: 'node_modules/.playwright/results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
