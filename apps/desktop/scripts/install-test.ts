/*
 * The "package" step of the CI (M3.5): build the packages of this checkout, install them from
 * scratch, start them up to the registration, uninstall them and check nothing is left.
 *
 *   pnpm desktop:install-test --linux       AppImage + deb (`ci:local`)
 *   pnpm desktop:install-test --mac         dmg, arm64 (`ci:mac`, on the Mac)
 *   pnpm desktop:install-test --win-build <dir>
 *                                           test-signed NSIS installer built here, copied into
 *                                           <dir> with what the VM needs (`ci:windows` installs
 *                                           and starts it in its VM: test-windows.sh/.ps1)
 *   options: --no-build (reuse the packages of a previous run in .package/install-test/release),
 *            --keep (keep .package/install-test)
 *
 * Linux:
 *   - the AppImage is copied into a temporary folder and started there on its own Xvfb display
 *     (never the user's desktop: no WAYLAND_DISPLAY, DISPLAY of that Xvfb), with a temporary
 *     MONSTERS_HOME; install-probe.mjs follows it up to the registration done from the window;
 *     then the app is stopped and the folder removed;
 *   - the deb goes through test-deb.sh: a clean Ubuntu 24.04 in a chroot (needs `sudo -n`;
 *     without it the step FAILS and says so), installed with apt, started up to the
 *     registration, purged, and /opt, /usr and /etc compared with before the install.
 * macOS: the dmg (ad-hoc signed: the CI user has no signing secrets, docs/signing.md; never notarized)
 *   is mounted with hdiutil, the app copied into a temporary Applications folder, started up to
 *   the registration, quit, removed; the dmg is unmounted. Over SSH without a graphical session
 *   of the CI user, macOS never finishes launching the app (Electron's `ready` never comes, so
 *   no core either): the run sees it within READY_WAIT_S, says so, and tries the package's core
 *   with the Node running this script instead (the app's binary is never a Node: RunAsNode fuse
 *   off, S-M8), up to the registration through the API; the note says the app was NOT verified.
 *   Before starting anything, the fuses of the installed binary are read back (RunAsNode off).
 *
 * The packages of Linux and macOS are test builds with a feed (review of wave 5, item 5):
 * `--feed TEST_FEED --test-build --update-test-key <the public half of a key of this run>`, so
 * the run checks that a build with a feed carries its update keys (resources/update-keys with
 * the test key among them, the app's log says how many it trusts) without touching the published
 * builds: they are built into .package/install-test, and publish-update.ts refuses a test build.
 * Nothing listens on TEST_FEED: the app's first check fails quietly.
 *
 * The app is started with --remote-debugging-port on 127.0.0.1 for the probe (DevTools
 * protocol; the fuses turn off Node's --inspect, not Chromium's debugging port). The packaged
 * app accepts that switch only on throwaway data (D-049): every run here has its own
 * MONSTERS_HOME and user data folder, and first checks that the same package REFUSES the switch
 * on the default data of a temporary HOME (it quits, the port never answers).
 * On Linux the app runs in a test session of its own (test-session.ts: Xvfb, private D-Bus and
 * XDG_RUNTIME_DIR) and the run fails if any of its processes shows up on the user's session bus.
 * Interrupted (Ctrl-C, SIGTERM of ci:local), the app, Xvfb and the dmg mount are cleaned up too.
 * Everything lives in apps/desktop/.package/install-test (a cache folder for the backup).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hasStartedLine } from '../src/main/desktop-log.ts';
import { keyId } from '../src/main/update-signature.ts';
import { checkFuses, fusesFor } from './after-pack.ts';
import { APP, RELEASE_KEYS_DIR } from './package-config.ts';
import {
  assertIsolated,
  checkNotOnUserBus,
  pidsWithArg,
  pidsWithEnv,
  processTree,
  sessionEnv,
  startTestSession,
  stopTree,
  testRunSwitch,
  userBusAddress,
} from './test-session.ts';

const ROOT = resolve(APP, '..', '..');
const WORK = join(APP, '.package', 'install-test');
const RELEASE = join(WORK, 'release');
const PROBE = join(APP, 'scripts', 'install-probe.mjs');
const PROBE_TIMEOUT_S = 150;
/** Longest wait for the app's first line after Electron's `ready` (usually 1-2 s). */
const READY_WAIT_S = 30;

function log(line: string): void {
  process.stderr.write(`install-test: ${line}\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Runs a step, logs its duration; throws with the step's name. */
async function timed<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const t0 = Date.now();
  log(`${name}...`);
  try {
    const r = await fn();
    log(`${name}: ok in ${seconds(Date.now() - t0)}`);
    return r;
  } catch (err) {
    throw new Error(`${name}: ${(err as Error).message}`, { cause: err });
  }
}

function appVersion(): string {
  return (JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { version: string })
    .version;
}

/**
 * Temporary files of the build and of the deb's chroot on disk, in WORK: /tmp is a tmpfs here
 * (16 GB, shared with every test of the machine) and fpm's staging of the deb failed there with
 * "tar failed (exit code 2)" during a CI run.
 */
function tmpEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const dir = join(WORK, 'tmp');
  mkdirSync(dir, { recursive: true });
  return { ...env, TMPDIR: dir };
}

/** The feed of the test builds here: nothing listens on it (port 9, discard). */
export const TEST_FEED = 'http://127.0.0.1:9/';

/** The update keys a test build of this run must carry: file names in resources/update-keys. */
interface TestFeed {
  args: string[];
  /** `test-<id>.pem`: the key of this run. */
  testKey: string;
  /** How many keys the app trusts: the release keys and the test key. */
  keys: number;
}

/**
 * The test build's feed and key: a new Ed25519 pair of this run, of which only the public half
 * is written (in the work folder): nothing is signed with it here, and no private key is kept.
 */
function testFeed(): TestFeed {
  const { publicKey } = generateKeyPairSync('ed25519');
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, 'update-test.pub.pem');
  writeFileSync(file, publicKey.export({ format: 'pem', type: 'spki' }));
  const release = existsSync(RELEASE_KEYS_DIR)
    ? readdirSync(RELEASE_KEYS_DIR).filter((n) => n.endsWith('.pem')).length
    : 0;
  return {
    args: ['--feed', TEST_FEED, '--test-build', '--update-test-key', file],
    testKey: `test-${keyId(publicKey)}.pem`,
    keys: release + 1,
  };
}

/** What the run expects of the test build (set by `buildPackages`; a --no-build run has none). */
let built: TestFeed | null = null;

function buildPackages(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  built = testFeed();
  execFileSync(
    process.execPath,
    [join(APP, 'scripts', 'package.ts'), ...args, ...built.args, '--out', RELEASE],
    {
      cwd: ROOT,
      env: tmpEnv(env),
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
}

/** The app's log says it updates from the test feed and how many keys it trusts. */
function checkUpdateKeys(home: string, what: string): void {
  if (!built) return;
  const file = join(home, 'logs', 'desktop.log');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const m = /updates: (\d+) update signing key\(s\) trusted/.exec(text);
  if (!m || Number(m[1]) !== built.keys) {
    throw new Error(
      `${what}: the app should trust ${built.keys} update key(s): ${m ? m[1] : 'no line'} in desktop.log`,
    );
  }
  log(`${what}: updates on, ${m[1]} update key(s) trusted (${built.testKey} among them)`);
}

function findPackage(suffix: string): string {
  const f = existsSync(RELEASE) ? readdirSync(RELEASE).find((n) => n.endsWith(suffix)) : undefined;
  if (!f) throw new Error(`no *${suffix} in ${RELEASE}`);
  return join(RELEASE, f);
}

/**
 * The probe with the Node running this script; its output goes to our stderr. `window:
 * 'optional'` (macOS over SSH): 'no-window' when the account had to be created through the API.
 * The probe answers the first-start question in the window ("Su questo computer", with Enter);
 * only with an optional window the user data folder gets a connections.json beforehand
 * (`skipFirstStart`), since nobody could answer without a window.
 */
function runProbe(
  home: string,
  cdp: number,
  version: string,
  window: 'required' | 'optional' | 'none' = 'required',
): Promise<'window' | 'no-window'> {
  return new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      [
        PROBE,
        '--home',
        home,
        '--cdp',
        String(cdp),
        '--version',
        version,
        '--timeout',
        String(PROBE_TIMEOUT_S),
        '--window',
        window,
        '--first-start',
        window === 'optional' ? 'skip' : 'ask',
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.on('exit', (code) => {
      if (code === 0) ok('window');
      else if (code === 3 && window !== 'required') ok('no-window');
      else fail(new Error(`install-probe.mjs exited with ${code}`));
    });
  });
}

/**
 * The answer of the first start already given ("Su questo computer"), as a connections.json the
 * app would have written: only where no window may appear to ask (macOS without a session).
 */
function skipFirstStart(userData: string): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'connections.json'),
    `${JSON.stringify({ version: 1, profiles: [], last: 'local' })}\n`,
    { mode: 0o600 },
  );
  log('first start answered beforehand (no window to ask in): this computer');
}

/** Env of a test app: data in temporary folders, nothing of a Monsters of the user. */
function appEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(ELECTRON_RUN_AS_NODE|MONSTERS_)/.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    MONSTERS_SECRETS: 'file',
    MONSTERS_EMBEDDINGS: 'off',
    MONSTERS_TELEGRAM: 'off',
    MONSTERS_UPDATE: 'off',
    ...extra,
  };
}

/**
 * What to undo if the run is interrupted (SIGINT, SIGTERM, SIGHUP): a `finally` does not run
 * then, and an AppImage left running keeps its FUSE mount, a dmg stays attached.
 */
const onInterrupt = new Set<() => void>();
let keepWork = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    log(`interrupted (${signal}): cleaning up`);
    for (const undo of [...onInterrupt].reverse()) {
      try {
        undo();
      } catch {
        // go on with the rest
      }
    }
    if (!keepWork) rmSync(WORK, { recursive: true, force: true });
    process.exit(130);
  });
}

/** SIGKILL to the processes found now, synchronously (for the interrupt handler). */
function killNow(find: () => number[]): void {
  for (const pid of find()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** True if something answers the DevTools protocol on 127.0.0.1:`port`. */
async function devtoolsAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The package must refuse --remote-debugging-port on the default data (a tampered shortcut,
 * D-049): started with a temporary HOME and neither MONSTERS_HOME nor a user data folder, it
 * must quit by itself, say why, and never open the port.
 */
async function refusesDebuggingOnDefaultData(
  command: string,
  args: string[],
  env: Record<string, string>,
  dir: string,
): Promise<void> {
  const fakeHome = join(dir, 'default-home');
  mkdirSync(fakeHome, { recursive: true });
  const port = await freePort();
  const childEnv: Record<string, string> = { ...env, HOME: fakeHome };
  for (const k of ['MONSTERS_HOME', 'MONSTERS_DESKTOP_USER_DATA', 'XDG_CONFIG_HOME']) {
    delete childEnv[k];
  }
  const app = spawn(command, [...args, `--remote-debugging-port=${port}`], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  app.stdout.on('data', (d: Buffer) => (output += d.toString()));
  app.stderr.on('data', (d: Buffer) => (output += d.toString()));
  const exited = new Promise<number | null>((ok) => app.once('exit', (code) => ok(code)));
  let code: number | null | undefined;
  let opened = false;
  const deadline = Date.now() + 30_000;
  while (code === undefined && Date.now() < deadline) {
    if (await devtoolsAnswers(port)) opened = true;
    code = await Promise.race([exited, sleep(100).then(() => undefined)]);
  }
  if (code === undefined) {
    try {
      process.kill(-app.pid!, 'SIGKILL');
    } catch {
      // gone
    }
    throw new Error('started with --remote-debugging-port on the default data, it did not quit');
  }
  if (opened) throw new Error('the DevTools port answered on the default data');
  if (!output.includes('refusing to start: --remote-debugging-port')) {
    throw new Error(`no refusal in the output (exit ${code}):\n${output.slice(-2000)}`);
  }
  log(`--remote-debugging-port on the default data: refused, exit ${code}, port never open`);
}

/** macOS processes whose command line contains `path` (the app bundle in the temp folder). */
function pidsWithPath(path: string): number[] {
  try {
    return execFileSync('pgrep', ['-f', path], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((p) => p !== process.pid);
  } catch {
    return [];
  }
}

/** SIGTERM (the app quits and stops its core), then SIGKILL; fails if something survives. */
async function stopAll(find: () => number[], what: string): Promise<void> {
  for (const sig of ['SIGTERM', 'SIGKILL'] as const) {
    const pids = find();
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone
      }
    }
    for (let i = 0; i < 20 && find().length > 0; i++) await sleep(500);
  }
  const left = find();
  if (left.length > 0) throw new Error(`${what}: processes still running: ${left.join(', ')}`);
}

// --- Linux -----------------------------------------------------------------------------------

async function appImageTest(appImage: string, version: string): Promise<void> {
  const dir = mkdtempSync(join(WORK, 'appimage-'));
  const apps = join(dir, 'Applications');
  const home = join(dir, 'home');
  const userData = join(dir, 'userdata');
  for (const d of [apps, home, userData]) mkdirSync(d, { recursive: true });
  const installed = join(apps, basename(appImage));
  copyFileSync(appImage, installed);
  execFileSync('chmod', ['755', installed]);
  // The notice of an AppImage without Chromium's sandbox (Ubuntu 24.04+), already accepted: a
  // modal dialog would stop the start (linux-sandbox.ts; the deb has the AppArmor profile).
  writeFileSync(join(userData, 'sandbox-notice-accepted'), 'install-test\n');

  const userBus = userBusAddress();
  const session = await startTestSession();
  const cdp = await freePort();
  const marker = `MONSTERS_HOME=${home}`;
  // The packaged app's processes are not dumpable (their environment cannot be read): the main
  // one is found by a switch on its command line, the others are its children.
  const runArg = testRunSwitch(basename(dir));
  const roots = () => [...pidsWithArg(runArg), ...pidsWithEnv(marker)];
  const base = sessionEnv(appEnv({}), session);
  const env = {
    ...base,
    MONSTERS_HOME: home,
    MONSTERS_DESKTOP_USER_DATA: userData,
    // The test build's updater on, to see the keys it trusts (nothing answers on TEST_FEED).
    ...(built ? { MONSTERS_UPDATE: 'on' } : {}),
  };
  const undo = () => {
    killNow(() => processTree(roots()));
    session.stop();
  };
  onInterrupt.add(undo);
  try {
    assertIsolated(env, session);
    await refusesDebuggingOnDefaultData(installed, ['--ozone-platform=x11'], base, dir);
    log(`AppImage from ${apps} on Xvfb ${session.display}, DevTools on 127.0.0.1:${cdp}`);
    const out = openSync(join(dir, 'app.log'), 'a');
    const args = ['--ozone-platform=x11', `--remote-debugging-port=${cdp}`, runArg];
    const app = spawn(installed, args, {
      env,
      stdio: ['ignore', out, out],
      detached: true,
    });
    app.unref();
    try {
      await runProbe(home, cdp, version);
    } catch (err) {
      const tail = (f: string) =>
        existsSync(f) ? readFileSync(f, 'utf8').split('\n').slice(-30).join('\n') : '(none)';
      log(`app.log:\n${tail(join(dir, 'app.log'))}`);
      log(`desktop.log:\n${tail(join(home, 'logs', 'desktop.log'))}`);
      throw err;
    }
    // Never a tray icon or a notification on the desktop of the person at this PC (C6).
    log(checkNotOnUserBus(processTree(roots()), session, userBus));
    checkUpdateKeys(home, 'AppImage');
    await stopTree(roots, 'AppImage');
    log('AppImage stopped, no process left');
  } finally {
    await stopTree(roots, 'AppImage').catch(() => {});
    session.stop();
    onInterrupt.delete(undo);
  }
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(dir)) throw new Error(`cannot remove ${dir}`);
  log(`AppImage removed with its folder ${basename(dir)}`);
}

function sudoAvailable(): boolean {
  try {
    execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function debTest(deb: string): void {
  if (!sudoAvailable()) {
    throw new Error(
      'sudo -n non disponibile: il .deb NON è stato installato né provato (test-deb.sh usa un ' +
        'chroot Ubuntu e serve sudo senza password per questo utente)',
    );
  }
  // The version the app reports is the product's (a prerelease may be spelled differently in
  // the deb's own Version field).
  execFileSync('bash', [join(APP, 'scripts', 'test-deb.sh'), deb, appVersion()], {
    // The probe's Node in the clean chroot: this one (an official build), not the app's binary.
    env: {
      ...tmpEnv(),
      MONSTERS_TEST_NODE: process.execPath,
      ...(built ? { MONSTERS_TEST_UPDATE_KEY: built.testKey } : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

async function linux(build: boolean): Promise<void> {
  const version = appVersion();
  if (build) await timed('build AppImage + deb', () => buildPackages(['--linux']));
  const appImage = findPackage('.AppImage');
  const deb = findPackage('.deb');
  await timed(`AppImage ${basename(appImage)}`, () => appImageTest(appImage, version));
  await timed(`deb ${basename(deb)} in a clean Ubuntu 24.04`, () => debTest(deb));
  ciNote(
    `AppImage e deb ${version}: installati da zero, registrazione dalla finestra, disinstallati senza resti`,
  );
}

/** One line for the result of the CI step (ci-local.ts reads `ci-note:` lines into its note). */
function ciNote(text: string): void {
  process.stdout.write(`ci-note: ${text}\n`);
}

// --- macOS -----------------------------------------------------------------------------------

/** Waits for the app's first line after Electron's `ready` in desktop.log. */
async function waitAppStarted(home: string, seconds: number): Promise<boolean> {
  const file = join(home, 'logs', 'desktop.log');
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (existsSync(file) && hasStartedLine(readFileSync(file, 'utf8'))) return true;
    await sleep(250);
  }
  return false;
}

function tail(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(-30).join('\n') : '(none)';
}

async function mac(build: boolean): Promise<void> {
  const version = appVersion();
  if (build) {
    await timed('build dmg (arm64)', () =>
      // A CI run never notarizes (minutes, and Apple's service): signing only, or ad-hoc.
      buildPackages(['--mac', '--arch', 'arm64', '--target', 'dmg'], {
        ...process.env,
        MONSTERS_MAC_NOTARIZE: '0',
      }),
    );
  }
  const dmg = findPackage('.dmg');
  const dir = mkdtempSync(join(WORK, 'mac-'));
  const mnt = join(dir, 'mnt');
  const apps = join(dir, 'Applications');
  const home = join(dir, 'home');
  const userData = join(dir, 'userdata');
  for (const d of [mnt, apps, home, userData]) mkdirSync(d, { recursive: true });
  const bundle = join(apps, 'Monsters.app');
  let mounted = false;
  let signer = 'ad-hoc';
  const undo = () => {
    killNow(() => pidsWithPath(bundle));
    if (mounted) spawnSync('hdiutil', ['detach', '-force', mnt], { stdio: 'ignore' });
  };
  onInterrupt.add(undo);
  try {
    await timed(`mount ${basename(dmg)}`, () => {
      execFileSync(
        'hdiutil',
        ['attach', '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mnt, dmg],
        {
          stdio: ['ignore', 'ignore', 'inherit'],
        },
      );
      mounted = true;
    });
    await timed('copy Monsters.app into a temporary Applications folder', () => {
      execFileSync('ditto', [join(mnt, 'Monsters.app'), bundle]);
      execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
      // `codesign -dv` writes to stderr: the signer (Developer ID or ad-hoc).
      const info = spawnSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8' });
      signer = /^Authority=(.*)$/m.exec(info.stderr)?.[1] ?? 'ad-hoc';
      log(`signature valid (codesign --verify --deep --strict), signed by: ${signer}`);
    });
    await timed('fuses of the installed app (RunAsNode off)', () =>
      checkFuses(bundle, fusesFor('darwin')),
    );
    const cdp = await freePort();
    const binary = join(bundle, 'Contents', 'MacOS', 'Monsters');
    await timed('refuses --remote-debugging-port on the default data', () =>
      refusesDebuggingOnDefaultData(binary, [], appEnv({}), dir),
    );
    const env = appEnv({ MONSTERS_HOME: home, MONSTERS_DESKTOP_USER_DATA: userData });
    const out = openSync(join(dir, 'app.log'), 'a');
    // Over SSH the CI user may have no graphical session (no `gui/<uid>` launchd domain): only
    // then the window may be missing, and the result says "not verified". With a session, a
    // window that does not show the registration is a failure, never "no session".
    const gui = spawnSync('launchctl', ['print', `gui/${process.getuid?.() ?? ''}`], {
      stdio: 'ignore',
    });
    const windowMode = gui.status === 0 ? 'required' : 'optional';
    log(
      `graphical session of this user: ${gui.status === 0 ? 'yes' : 'no'} (window ${windowMode})`,
    );
    if (windowMode === 'optional') skipFirstStart(userData);
    const dumpLogs = () => {
      log(`app.log:\n${tail(join(dir, 'app.log'))}`);
      log(`desktop.log:\n${tail(join(home, 'logs', 'desktop.log'))}`);
    };
    const seen = await timed('start up to the registration', async () => {
      const app = spawn(binary, [`--remote-debugging-port=${cdp}`], {
        env,
        stdio: ['ignore', out, out],
        detached: true,
      });
      app.unref();
      try {
        if (!(await waitAppStarted(home, READY_WAIT_S))) {
          if (windowMode === 'required') {
            throw new Error(
              `the app did not get past Electron's ready in ${READY_WAIT_S}s (no "Monsters ` +
                'desktop" line in desktop.log), although this user has a graphical session',
            );
          }
          // Without a WindowServer login of this user macOS never finishes launching a GUI app:
          // no `ready`, no core (measured on macOS 27 over SSH, D-048).
          log(
            `the app did not get past Electron's ready in ${READY_WAIT_S}s: no graphical ` +
              'session, macOS does not finish launching it over SSH; app and window NOT verified',
          );
          return 'no-app' as const;
        }
        return await runProbe(home, cdp, version, windowMode);
      } catch (err) {
        dumpLogs();
        throw err;
      }
    });
    if (seen === 'no-app') {
      dumpLogs();
      await timed('quit the app stuck before ready', () =>
        stopAll(() => pidsWithPath(bundle), 'Monsters.app'),
      );
      await timed("the package's core with this script's Node, up to the registration", () =>
        coreWithNode(bundle, home, version, env, dir),
      );
    }
    ciNote(
      seen === 'window'
        ? `dmg ${version} (${signer}): montato, app copiata, registrazione dalla finestra, rimossa`
        : seen === 'no-window'
          ? `dmg ${version} (${signer}): montato, app copiata, core e registrazione via API ok, ` +
            'finestra NON verificata (nessuna sessione grafica via SSH), rimossa'
          : `dmg ${version} (${signer}): montato, app copiata; senza sessione grafica macOS non ` +
            "finisce di avviare l'app (Electron non arriva a ready): core del pacchetto avviato " +
            'col Node della CI, registrazione via API ok, app e finestra NON verificate, rimossa',
    );
    await timed('quit', () => stopAll(() => pidsWithPath(bundle), 'Monsters.app'));
    await timed('remove the app', () => {
      rmSync(bundle, { recursive: true, force: true });
      if (existsSync(bundle)) throw new Error(`${bundle} still there`);
    });
  } finally {
    await stopAll(() => pidsWithPath(bundle), 'Monsters.app').catch(() => {});
    if (mounted) {
      await timed('unmount the dmg', () => {
        execFileSync('hdiutil', ['detach', mnt], { stdio: ['ignore', 'ignore', 'inherit'] });
        mounted = false;
      });
    }
    onInterrupt.delete(undo);
  }
  rmSync(dir, { recursive: true, force: true });
}

/**
 * The package's core started as the app would start it, but with the Node running this script
 * (Node 24, the same N-API for the package's native modules) instead of a utility process: what
 * can be verified of the installed package when the app itself cannot start (no graphical
 * session). Not the app's binary: its RunAsNode fuse is off (S-M8), it is never a Node.
 */
async function coreWithNode(
  bundle: string,
  home: string,
  version: string,
  env: Record<string, string>,
  dir: string,
): Promise<void> {
  const entry = join(bundle, 'Contents', 'Resources', 'core', 'monsters.js');
  if (!existsSync(entry)) throw new Error(`no core in the package: ${entry}`);
  const coreLog = join(dir, 'core.log');
  const out = openSync(coreLog, 'a');
  const core = spawn(process.execPath, [entry, 'start', '--home', home, '--port', '0'], {
    env: { ...env, MONSTERS_APP_VERSION: version },
    cwd: home,
    stdio: ['ignore', out, out],
    detached: true,
  });
  core.unref();
  try {
    await runProbe(home, 0, version, 'none');
  } catch (err) {
    log(`core.log:\n${tail(coreLog)}`);
    throw err;
  }
}

// --- Windows (built here, tried in the VM by ci-windows.sh) -----------------------------------

async function winBuild(out: string, build: boolean): Promise<void> {
  const version = appVersion();
  if (build) {
    await timed('test certificate', () => {
      execFileSync('bash', [join(APP, 'scripts', 'setup-signing.sh'), '--test-cert'], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    });
    await timed('build NSIS installer (test-signed)', () =>
      buildPackages(['--win'], { ...process.env, MONSTERS_WIN_SIGN: 'test' }),
    );
  }
  const installer = findPackage('-test-signed.exe');
  mkdirSync(out, { recursive: true });
  for (const f of [
    installer,
    join(APP, '.signing', 'test-ca.crt'),
    join(APP, 'scripts', 'test-windows.ps1'),
    PROBE,
  ]) {
    copyFileSync(f, join(out, basename(f)));
  }
  writeFileSync(join(out, 'version'), `${version}\n`);
  writeFileSync(join(out, 'installer'), `${basename(installer)}\n`);
  log(`for the VM in ${out}: ${readdirSync(out).join(', ')}`);
}

// --- main ------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      linux: { type: 'boolean', default: false },
      mac: { type: 'boolean', default: false },
      'win-build': { type: 'string' },
      'no-build': { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
    },
  });
  const modes = [values.linux, values.mac, values['win-build'] !== undefined].filter(Boolean);
  if (modes.length !== 1) {
    throw new Error(
      'usage: install-test.ts --linux | --mac | --win-build <dir> [--no-build] [--keep]',
    );
  }
  const build = !values['no-build'];
  keepWork = values.keep;
  if (build) rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const t0 = Date.now();
  try {
    if (values.linux) await linux(build);
    else if (values.mac) await mac(build);
    else await winBuild(resolve(values['win-build'] ?? ''), build);
    log(`OK in ${seconds(Date.now() - t0)}`);
  } finally {
    if (!values.keep) rmSync(WORK, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((err: Error) => {
    log(`FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}
