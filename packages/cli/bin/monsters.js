#!/usr/bin/env node
// Runs the TypeScript sources directly (Node >= 24 strips types natively).
// Published builds will point to dist/ instead.
import { run } from '../src/main.ts';

process.exitCode = await run(process.argv.slice(2));

// A failed command must end the process: a handle left open (a half-started core) would keep
// it alive with its port and lock. The timer does not keep the process up on its own, so a
// normal exit is untouched and the output has a moment to flush (F-M1).
if (process.exitCode) {
  const code = Number(process.exitCode);
  setTimeout(() => process.exit(code), 1000).unref();
}
