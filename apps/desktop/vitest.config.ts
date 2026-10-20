import { defineConfig } from 'vitest/config';

// Unit tests of the main-process logic (no Electron); the Playwright suite is in e2e/.
export default defineConfig({
  test: {
    name: '@monsters/desktop',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
