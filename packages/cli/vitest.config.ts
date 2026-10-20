import { defineConfig } from 'vitest/config';
import '../../vitest.env.ts';

// The same test environment when vitest starts from this folder (no keychain, no model download).
export default defineConfig({
  test: { name: '@monsters/cli' },
});
