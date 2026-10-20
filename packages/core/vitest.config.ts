import { defineConfig } from 'vitest/config';
import '../../vitest.env.ts';

// The same test environment when vitest starts from this folder (no keychain, no model download).
// Many tests start a whole core: 5 s is not enough when the machine is busy (other suites, the VM).
export default defineConfig({
  test: { name: '@monsters/core', testTimeout: 15_000 },
});
