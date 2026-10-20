import { defineConfig } from 'vitest/config';
import './vitest.env.ts';

export default defineConfig({
  test: {
    // scripts: tests of the repo scripts (e.g. ci-cloud-status).
    projects: ['packages/*', 'apps/*', 'scripts'],
  },
});
