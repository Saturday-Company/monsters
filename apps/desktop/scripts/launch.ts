/*
 * Starts the unpacked app (after `pnpm build:core` and the desktop build):
 *
 *   pnpm --filter @monsters/desktop start      # or `dev`, which builds everything first
 *
 * Uses MONSTERS_HOME like the CLI (default ~/.monsters): the app attaches to a core already
 * started with `monsters start` there, or starts its own.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronArgs, electronBinary } from './electron-env.ts';

const APP = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = electronArgs();
if (args.includes('--no-sandbox')) {
  console.warn(
    'desktop: Chromium sandbox off for this dev run (AppArmor blocks user namespaces and chrome-sandbox is not setuid root, D-045)',
  );
}
const env = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE'];
const child = spawn(electronBinary(), [APP, ...args, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
