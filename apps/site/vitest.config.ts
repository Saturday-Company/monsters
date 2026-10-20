import { defineConfig } from 'vitest/config';

// Unit tests of the site's pure logic (no browser, no Astro).
export default defineConfig({
  test: {
    name: '@monsters/site',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
