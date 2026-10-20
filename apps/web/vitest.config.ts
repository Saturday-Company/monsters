import { defineConfig } from 'vitest/config';

// Unit tests only: the Playwright suites live in e2e/ and run with `pnpm test:e2e`.
export default defineConfig({
  test: {
    name: '@monsters/web',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
