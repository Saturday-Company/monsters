import { defineConfig } from 'vitest/config';

// Unit tests of the Worker, run in Node against an in-memory bucket.
export default defineConfig({
  test: {
    name: '@monsters/update-server',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
