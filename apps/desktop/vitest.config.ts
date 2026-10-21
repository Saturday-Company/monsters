import { defineConfig } from 'vitest/config';
import '../../vitest.env.ts';

// Unit tests of the main-process logic (no Electron); the Playwright suite is in e2e/. The same test
// environment as the root config when vitest starts from this folder (language, vault layout, secrets).
export default defineConfig({
  test: {
    name: '@monsters/desktop',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
