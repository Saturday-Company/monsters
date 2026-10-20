/*
 * Runs the Playwright suite of the desktop app. On Linux it runs under `xvfb-run` (a virtual
 * display: no windows popping up on the user's screen) when available, unless
 * MONSTERS_E2E_HEADED=1. Needs the core bundle (`pnpm build:core`) and the desktop build.
 *
 *   node scripts/e2e.ts [--screenshots] [playwright args…]
 *
 * --screenshots: only the screenshot test, files in MONSTERS_DESKTOP_SHOTS (default
 * node_modules/.playwright/shots).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateBusConfig } from './test-session.ts';
import { fileURLToPath } from 'node:url';

const APP = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bundle = join(APP, '..', '..', 'packages', 'cli', 'dist-bundle', 'monsters.js');
if (!existsSync(bundle)) {
  console.error(`desktop e2e: no core bundle at ${bundle}: run "pnpm build:core" first`);
  process.exit(1);
}

let args = process.argv.slice(2);
const env = { ...process.env };
if (args.includes('--screenshots')) {
  args = args.filter((a) => a !== '--screenshots');
  env['MONSTERS_DESKTOP_SCREENSHOTS'] = '1';
  args.push('screenshots');
}
const playwright = join(APP, 'node_modules', '.bin', 'playwright');
const useXvfb =
  process.platform === 'linux' &&
  env['MONSTERS_E2E_HEADED'] !== '1' &&
  spawnSync('which', ['xvfb-run']).status === 0;
// Electron prefers Wayland in a Wayland session (it finds the compositor even without
// WAYLAND_DISPLAY, through XDG_RUNTIME_DIR): without this, the windows of the tests would open
// on the user's desktop instead of the virtual display. And a session bus of their own
// (dbus-run-session) with a private XDG_RUNTIME_DIR: the tray icon and the notifications of
// the app must never reach the user's desktop (M3.6, C6); the user's bus address goes to the
// tests, which check that no process of the app is on it.
let runtimeDir: string | null = null;
if (useXvfb) {
  for (const k of ['WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'DISPLAY', 'XAUTHORITY', 'SESSION_MANAGER'])
    delete env[k];
  env['XDG_SESSION_TYPE'] = 'x11';
  env['NO_AT_BRIDGE'] = '1';
  env['MONSTERS_E2E_USER_BUS'] =
    env['DBUS_SESSION_BUS_ADDRESS'] ?? `unix:path=/run/user/${process.getuid?.() ?? 0}/bus`;
  delete env['DBUS_SESSION_BUS_ADDRESS'];
  runtimeDir = mkdtempSync(join(tmpdir(), 'monsters-e2e-session-'));
  chmodSync(runtimeDir, 0o700);
  env['XDG_RUNTIME_DIR'] = runtimeDir;
  writeFileSync(join(runtimeDir, 'session-bus.conf'), privateBusConfig(runtimeDir));
}
const [command, commandArgs] = useXvfb
  ? [
      'dbus-run-session',
      [
        `--config-file=${join(runtimeDir ?? '', 'session-bus.conf')}`,
        '--',
        'xvfb-run',
        '-a',
        // A random first display number: two runs at once (another worktree) do not race
        // for :99 and end up sharing, and killing, the same server.
        '-n',
        String(100 + Math.floor(Math.random() * 800)),
        '-s',
        // -noreset: Xvfb resets when its last client leaves, and an app launched in that
        // moment finds no X server.
        '-noreset -screen 0 1600x1000x24',
        playwright,
        'test',
        ...args,
      ],
    ]
  : [playwright, ['test', ...args]];
const result = spawnSync(command, commandArgs, { cwd: APP, stdio: 'inherit', env });
if (runtimeDir) {
  try {
    rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // a temporary folder
  }
}
process.exitCode = result.status ?? 1;
