/*
 * Local CI: runs the steps of .github/workflows/ci.yml on this machine, on a clean checkout of
 * one commit (a detached `git worktree` in a cache folder), so untracked files and the repo's
 * own node_modules never affect the result.
 *
 *   pnpm ci:local [--quick] [--no-package] [--keep] [--commit <rev>]
 *   node scripts/ci-local.ts --github     (the `full` jobs of .github/workflows/ci.yml, D-152)
 *
 *   --quick          skip the Playwright (e2e) steps, the bundle smoke test and the package and
 *                    update-e2e steps
 *   --no-package     skip the package and update-e2e steps only
 *   --keep           keep the checkout folder afterwards (its path is printed)
 *   --commit <rev>   commit to test (default HEAD); uncommitted changes are never tested
 *   --github         on a GitHub-hosted runner: runs in the checkout itself (the runner's clean
 *                    checkout of the commit; no worktree), the e2e and the package step on every
 *                    system (Windows: the unsigned NSIS installer built and tried on the runner
 *                    itself), each step's output in a collapsible group of the job's log, and
 *                    the packages copied to MONSTERS_CI_ARTIFACTS when set. Results in
 *                    MONSTERS_CI_RESULTS (default `ci-results/` of the checkout).
 *
 * The same script is meant to run on Linux, macOS and Windows (`ci:windows`, `ci:mac`): steps
 * follow ci.yml per OS (longer test timeouts on Windows; locally e2e on Linux only, with
 * --github on the three systems).
 *
 * Last steps (in ci.yml only in the `full` jobs): `build-core` + `smoke-bundle` (the packaged
 * core under Node and under Electron as Node), `package` (M3.5), `pnpm desktop:install-test`: builds the desktop
 * packages of the commit (test builds with a feed: never publishable), installs them from
 * scratch, starts them up to the registration and uninstalls them (Linux: AppImage + deb in a
 * clean Ubuntu chroot, needs `sudo -n`; macOS: dmg). On Windows it is skipped here:
 * ci-windows.sh builds the installer on Linux and tries it in the VM, then fills in this step of
 * the Windows result (with --github the runner builds the unsigned installer and tries it itself,
 * `install-test --win`). Then, on Linux, `update-e2e` (review of wave 5, item 5): `pnpm
 * desktop:update-e2e --scenario ok,badsig`, the AppImage updated 0.0.1 → 0.0.2 from a local feed
 * signed with a key of the run, and refused when the signature is by another key.
 *
 * Environment:
 *   MONSTERS_CI_RESULTS   results folder (default: `ci-results/` in the main checkout, shared by
 *                         all worktrees, ignored by git)
 *   MONSTERS_CI_WORKDIR   parent folder of the temporary checkouts (default: ~/.cache/monsters-ci,
 *                         %LOCALAPPDATA%\monsters-ci on Windows; same disk as the pnpm store, so
 *                         `pnpm install` hardlinks instead of copying)
 *
 * Every run writes `<results>/<YYYYMMDD-HHMMSS>-<short commit>-<platform>.json` (format: the
 * `CiResult` type below, rewritten after every step, so `status: "running"` means in progress)
 * and the full output of every step in the `.log` file with the same name.
 *
 * Exit code: 0 passed, 1 a step failed, 2 usage or setup error, 130 interrupted.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir, hostname, release, arch, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** One step of a run, in ci.yml order. */
export interface CiStep {
  /** Stable id: install, typecheck, check-public, lint, format, test, build-web, playwright-browsers,
   *  e2e-mock, e2e-core, e2e-onboarding, build-core, smoke-bundle, package, update-e2e. */
  id: string;
  /** Command line as run in the checkout. */
  command: string;
  /** `not-run`: never reached because an earlier step failed or the run was interrupted;
   *  `skipped`: not part of this run (see `note`). */
  status: 'passed' | 'failed' | 'skipped' | 'not-run' | 'running';
  durationMs: number | null;
  exitCode: number | null;
  note?: string;
}

/** Content of `<results>/<stamp>-<commit>-<platform>.json` (schema `monsters-ci/1`). */
export interface CiResult {
  schema: 'monsters-ci/1';
  platform: 'linux' | 'macos' | 'windows';
  host: string;
  /** Full hash of the commit tested, its short form and subject. */
  commit: string;
  shortCommit: string;
  subject: string;
  /** The revision passed with --commit, else the branch checked out (null if detached). */
  ref: string | null;
  /** True if HEAD was tested and its checkout had uncommitted changes (NOT tested). */
  dirty: boolean;
  mode: 'full' | 'quick';
  /** Where it ran: `local` (ci:local, ci:mac, ci:windows) or `github` (--github on a hosted
   *  runner). Absent in results written before D-152: local. */
  runner?: 'local' | 'github';
  status: 'running' | 'passed' | 'failed' | 'interrupted';
  failedStep: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  node: string;
  pnpm: string;
  os: string;
  /** Name of the full log, in the same folder. */
  log: string;
  steps: CiStep[];
}

const USAGE = 'usage: pnpm ci:local [--quick] [--no-package] [--keep] [--commit <rev>] [--github]';

// --- arguments -------------------------------------------------------------------------------

let quick = false;
let noPackage = false;
let keep = false;
let rev = 'HEAD';
let github = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--quick') quick = true;
  else if (arg === '--no-package') noPackage = true;
  else if (arg === '--keep') keep = true;
  else if (arg === '--github') github = true;
  else if (arg === '--commit' && argv[i + 1]) rev = argv[++i] ?? 'HEAD';
  else if (arg === '--help' || arg === '-h') {
    console.warn(USAGE);
    process.exit(0);
  } else if (arg !== '--') {
    console.error(`ci:local: unknown argument ${arg}\n${USAGE}`);
    process.exit(2);
  }
}

// --- environment -----------------------------------------------------------------------------

const isWindows = process.platform === 'win32';
const platform: CiResult['platform'] = isWindows
  ? 'windows'
  : process.platform === 'darwin'
    ? 'macos'
    : 'linux';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error(`ci:local: Node 24 required, found ${process.version} (use the pnpm wrapper)`);
  process.exit(2);
}

if (github && rev !== 'HEAD') {
  console.error('ci:local: --github tests the checkout it runs in, without --commit');
  process.exit(2);
}
// Folder for the packages built by the package step (--github: uploaded as workflow artifacts).
const artifactsDir = github ? process.env['MONSTERS_CI_ARTIFACTS'] : undefined;

// Hooks run with GIT_DIR and friends set: they must not leak into the checkout or the tests.
const cleanEnv: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('GIT_') || key.startsWith('MONSTERS_') || key.startsWith('npm_')) continue;
  cleanEnv[key] = value;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function git(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', args, {
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

const stamp = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// --- commit and folders ----------------------------------------------------------------------

let commit: string;
let sourceRoot: string;
let commonDir: string;
try {
  sourceRoot = git(['rev-parse', '--show-toplevel']);
  commonDir = resolve(sourceRoot, git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  commit = git(['rev-parse', '--verify', `${rev}^{commit}`]);
} catch {
  console.error(`ci:local: not a git checkout, or unknown commit ${rev}`);
  process.exit(2);
}
const shortCommit = commit.slice(0, 7);
const subject = git(['log', '-1', '--format=%s', commit]);
// With --commit the revision as given; otherwise the branch checked out (null if detached).
let ref: string | null = rev === 'HEAD' ? null : rev;
if (rev === 'HEAD') {
  try {
    ref = git(['symbolic-ref', '--short', '-q', 'HEAD']) || null;
  } catch {
    // Detached HEAD.
  }
}
const dirty = rev === 'HEAD' && git(['status', '--porcelain']) !== '';

const resultsDir = resolve(
  process.env['MONSTERS_CI_RESULTS'] ??
    (github ? join(sourceRoot, 'ci-results') : join(dirname(commonDir), 'ci-results')),
);
const workRoot = resolve(
  process.env['MONSTERS_CI_WORKDIR'] ??
    (isWindows
      ? join(process.env['LOCALAPPDATA'] ?? tmpdir(), 'monsters-ci')
      : join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'monsters-ci')),
);
const started = new Date();
const base = `${stamp(started)}-${shortCommit}-${platform}`;
// --github: the runner's checkout is already clean and of the commit; it is the one tested.
const checkout = github ? sourceRoot : join(workRoot, base);
mkdirSync(resultsDir, { recursive: true });
mkdirSync(workRoot, { recursive: true });
const resultPath = join(resultsDir, `${base}.json`);
const logPath = join(resultsDir, `${base}.log`);
// Synchronous writes: nothing is lost when the run ends with process.exit.
const logFd = openSync(logPath, 'w');
const log = {
  write: (data: string | Buffer): void => {
    if (typeof data === 'string') writeSync(logFd, data);
    else writeSync(logFd, data);
  },
};

let pnpmVersion = 'unknown';
try {
  pnpmVersion = execFileSync('pnpm', ['--version'], {
    env: cleanEnv,
    encoding: 'utf8',
    shell: isWindows,
  }).trim();
} catch {
  console.error('ci:local: pnpm not found in PATH');
  process.exit(2);
}

// --- steps (keep in sync with .github/workflows/ci.yml) --------------------------------------

const web = ['--filter', '@monsters/web', 'exec', 'playwright'];
const e2e = (platform === 'linux' || github) && !quick;
const e2eNote = quick ? '--quick' : 'locally e2e runs on Linux only (with --github everywhere)';
const pkg = !quick && !noPackage && (platform !== 'windows' || github);
const pkgNote = quick ? '--quick' : '--no-package';

interface StepDef {
  id: string;
  args: string[];
  run: boolean;
  /** Why the step is skipped (default: the e2e note). */
  note?: string;
  /** The onboarding suite uses fixed ports (4791, 5181): one run at a time on this machine. */
  fixedPorts?: number[];
  /** Extra environment of this step only. */
  env?: Record<string, string>;
}

const stepDefs: StepDef[] = [
  { id: 'install', args: ['install', '--frozen-lockfile'], run: true },
  { id: 'typecheck', args: ['typecheck'], run: true },
  // The public-repo guard (D-143) on its own, so a red says why; `pnpm lint` runs it too.
  { id: 'check-public', args: ['check:public'], run: true },
  // The type-aware lint of the whole repo needs more than Node's default heap on a 7 GB runner
  // (the macOS one aborted at 1m30s); ci-cloud.sh passes the same limit.
  {
    id: 'lint',
    args: ['lint'],
    run: true,
    env: { NODE_OPTIONS: '--max-old-space-size=4096' },
  },
  { id: 'format', args: ['format:check'], run: true },
  {
    id: 'test',
    args: isWindows ? ['test', '--testTimeout=30000', '--hookTimeout=30000'] : ['test'],
    run: true,
    // A time zone far from UTC (the other runners) and from the maintainers' (Europe/Rome): a
    // test that reads the local clock without fixing its zone fails here first (D-148).
    ...(platform === 'linux' ? { env: { TZ: 'Pacific/Kiritimati' } } : {}),
  },
  { id: 'build-web', args: ['--filter', '@monsters/web', 'build'], run: true },
  // Locally the browsers already installed in the shared Playwright cache are reused, and only a
  // missing Chromium is downloaded; a Linux runner also needs Chromium's system libraries
  // (--with-deps, through its passwordless sudo).
  {
    id: 'playwright-browsers',
    args: [
      ...web,
      'install',
      ...(github && platform === 'linux' ? ['--with-deps'] : []),
      'chromium',
    ],
    run: e2e,
  },
  { id: 'e2e-mock', args: [...web, 'test'], run: e2e },
  { id: 'e2e-core', args: [...web, 'test', '-c', 'playwright.core.config.ts'], run: e2e },
  {
    id: 'e2e-onboarding',
    args: [...web, 'test', '-c', 'playwright.onboarding.config.ts'],
    run: e2e,
    fixedPorts: [4791, 5181],
  },
  // The packaged core (M3.0): the bundle under Node 24 and under Electron as Node (Node only
  // where Electron's binary is not installed: the Windows VM and the cloud CI skip it).
  { id: 'build-core', args: ['build:core'], run: !quick, note: '--quick' },
  {
    id: 'smoke-bundle',
    args: [
      'smoke:bundle',
      '--no-build',
      ...(process.env['ELECTRON_SKIP_BINARY_DOWNLOAD'] === '1' ? ['--runtime', 'node'] : []),
    ],
    run: !quick,
    note: '--quick',
  },
  {
    id: 'package',
    args: [
      'desktop:install-test',
      platform === 'macos' ? '--mac' : platform === 'windows' ? '--win' : '--linux',
    ],
    run: pkg,
    note:
      platform === 'windows' && !github && !quick && !noPackage
        ? 'built on Linux and tried in the VM by ci-windows.sh'
        : pkgNote,
  },
  {
    // The only end-to-end test of the feed's signature (S-A4): a key of the run, removed after.
    id: 'update-e2e',
    args: ['desktop:update-e2e', '--scenario', 'ok,badsig'],
    run: pkg && platform === 'linux',
    note: platform !== 'linux' ? 'AppImage: Linux only' : pkgNote,
  },
];

const result: CiResult = {
  schema: 'monsters-ci/1',
  platform,
  host: hostname(),
  commit,
  shortCommit,
  subject,
  ref,
  dirty,
  mode: quick ? 'quick' : 'full',
  runner: github ? 'github' : 'local',
  status: 'running',
  failedStep: null,
  startedAt: started.toISOString(),
  finishedAt: null,
  durationMs: null,
  node: process.version,
  pnpm: pnpmVersion,
  os: `${platform} ${release()} ${arch()}`,
  log: basename(logPath),
  steps: stepDefs.map((s) => ({
    id: s.id,
    command: `pnpm ${s.args.join(' ')}`,
    status: s.run ? 'not-run' : 'skipped',
    durationMs: null,
    exitCode: null,
    ...(s.run ? {} : { note: s.note ?? e2eNote }),
  })),
};

const save = (): void => writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);

// --- process handling ------------------------------------------------------------------------

let child: ChildProcess | null = null;
let lockDir: string | null = null;
let cleaned = false;

function killChild(): void {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (isWindows) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

function releaseLock(): void {
  if (lockDir) rmSync(lockDir, { recursive: true, force: true });
  lockDir = null;
}

function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  releaseLock();
  if (github || keep || !existsSync(checkout)) return;
  try {
    git(['worktree', 'remove', '--force', checkout], sourceRoot);
  } catch {
    rmSync(checkout, { recursive: true, force: true });
    try {
      git(['worktree', 'prune'], sourceRoot);
    } catch {
      // Nothing else to do.
    }
  }
}

function finish(status: CiResult['status']): never {
  const end = new Date();
  result.status = status;
  result.finishedAt = end.toISOString();
  result.durationMs = end.getTime() - started.getTime();
  save();
  cleanup();
  closeSync(logFd);
  const label = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : 'INTERRUPTED';
  out(`${label} ${shortCommit} on ${platform} in ${formatDuration(result.durationMs)}`);
  out(`results: ${resultPath}`);
  if (keep) out(`checkout kept: ${checkout}`);
  process.exit(status === 'passed' ? 0 : status === 'failed' ? 1 : 130);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    killChild();
    for (const step of result.steps) if (step.status === 'running') step.status = 'not-run';
    finish('interrupted');
  });
}

/** Cross-process lock (an atomic mkdir) for steps bound to fixed ports. */
async function acquireLock(name: string, ports: number[]): Promise<void> {
  const dir = join(tmpdir(), `monsters-ci-${name}.lock`);
  const deadline = Date.now() + 15 * 60_000;
  let waiting = false;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'pid'), String(process.pid));
      lockDir = dir;
      break;
    } catch {
      let holder = 0;
      try {
        holder = Number(readFileSync(join(dir, 'pid'), 'utf8'));
      } catch {
        // Being created or removed right now.
      }
      let alive = holder > 0;
      if (alive) {
        try {
          process.kill(holder, 0);
        } catch {
          alive = false;
        }
      }
      if (!alive && holder > 0) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`lock ${dir} still held by pid ${holder}`);
      if (!waiting) log.write(`waiting for ${dir} (pid ${holder})\n`);
      waiting = true;
      await sleep(2000);
    }
  }
  // Ports may also be taken by a run outside ci:local (e.g. test:e2e:onboarding by hand).
  for (const port of ports) {
    while (!(await portIsFree(port))) {
      if (Date.now() > deadline) throw new Error(`port ${port} still busy`);
      await sleep(2000);
    }
  }
}

function runStep(args: string[], env: NodeJS.ProcessEnv, tail: string[]): Promise<number> {
  return new Promise((done) => {
    child = spawn('pnpm', args, {
      cwd: checkout,
      env,
      shell: isWindows,
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let partial = '';
    const collect = (chunk: Buffer): void => {
      log.write(chunk);
      // On a runner the job's log is where a red is read: the step's output goes there too.
      if (github) process.stdout.write(chunk);
      const lines = (partial + chunk.toString('utf8')).split('\n');
      partial = lines.pop() ?? '';
      tail.push(...lines);
      if (tail.length > 200) tail.splice(0, tail.length - 200);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => {
      log.write(`\n${String(error)}\n`);
      done(127);
    });
    child.on('close', (code, signal) => {
      if (partial) tail.push(partial);
      child = null;
      done(code ?? (signal ? 128 : 1));
    });
  });
}

// --- run -------------------------------------------------------------------------------------

async function main(): Promise<void> {
  save();
  out(`ci:local ${platform} ${shortCommit} "${subject}" (${result.mode})`);
  if (dirty) out('note: uncommitted changes in this checkout are not tested');

  log.write(`# ci:local ${platform} ${commit} ${result.mode}\n# checkout ${checkout}\n`);
  if (!github) {
    try {
      git(['worktree', 'add', '--detach', checkout, commit], sourceRoot);
    } catch (error) {
      console.error(`ci:local: cannot create the checkout: ${String(error)}`);
      result.failedStep = 'checkout';
      finish('failed');
    }
  }

  // Same variables as the CI runner (GitHub sets CI=true), free ports for the e2e servers.
  const env: NodeJS.ProcessEnv = {
    ...cleanEnv,
    CI: 'true',
    MONSTERS_EMBEDDINGS: 'off',
    MONSTERS_SECRETS: 'file',
    E2E_PORT: String(await freePort()),
    MONSTERS_E2E_PORT: String(await freePort()),
    ...(artifactsDir ? { MONSTERS_CI_ARTIFACTS: resolve(artifactsDir) } : {}),
  };
  log.write(`# E2E_PORT=${env['E2E_PORT']} MONSTERS_E2E_PORT=${env['MONSTERS_E2E_PORT']}\n`);

  for (const [index, def] of stepDefs.entries()) {
    const step = result.steps[index];
    if (!step || !def.run) continue;
    step.status = 'running';
    save();
    const t0 = Date.now();
    const tail: string[] = [];
    log.write(`\n# ---- ${def.id}: ${step.command}\n`);
    let code: number;
    try {
      if (def.fixedPorts) await acquireLock(def.id, def.fixedPorts);
      if (github) out(`::group::${def.id}: ${step.command}`);
      code = await runStep(def.args, def.env ? { ...env, ...def.env } : env, tail);
    } catch (error) {
      tail.push(String(error));
      log.write(`${String(error)}\n`);
      code = 2;
    } finally {
      if (def.fixedPorts) releaseLock();
      if (github) out('::endgroup::');
    }
    step.durationMs = Date.now() - t0;
    step.exitCode = code;
    step.status = code === 0 ? 'passed' : 'failed';
    // A step can describe what it proved in one line (`ci-note: …`, e.g. the package step).
    const note = tail.findLast((l) => l.startsWith('ci-note: '));
    if (note) step.note = note.slice('ci-note: '.length).trim();
    log.write(`# ---- ${def.id}: exit ${code} in ${formatDuration(step.durationMs)}\n`);
    out(
      `  ${code === 0 ? 'ok  ' : 'FAIL'}  ${def.id.padEnd(20)} ${formatDuration(step.durationMs).padStart(7)}`,
    );
    if (code !== 0) {
      result.failedStep = def.id;
      if (!github) out(tail.slice(-40).join('\n'));
      out(`full log: ${logPath}`);
      finish('failed');
    }
    save();
  }
  finish('passed');
}

main().catch((error: unknown) => {
  console.error(`ci:local: ${String(error)}`);
  killChild();
  finish('failed');
});
