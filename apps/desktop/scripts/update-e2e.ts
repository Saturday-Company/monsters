/*
 * End-to-end automatic update of the Linux AppImage (M3.4, D-046), all on this PC:
 *
 *   pnpm desktop:update-e2e [--keep] [--no-build] [--reuse] [--win|--deb] [--remote] [--scenario <name>]
 *
 *   --win        the same with the NSIS installer (test-signed, publisher checked) in the Windows
 *                VM of `pnpm ci:windows`: the VM reaches the server on the host as 10.0.2.2
 *   --deb        the .deb (D-105): 0.0.1 installed in a clean Ubuntu 24.04 chroot
 *                (test-deb-update.sh, sudo), updated from the app with dpkg; scenarios `cancel`,
 *                `dpkg`, `ok` (default: all three, in this order)
 *   --keep       keep the work folder (packages, logs, data)
 *   --no-build   reuse the core bundle and the app's dist/
 *   --reuse      reuse the two packages of a run kept with --keep (same feed port)
 *   --scenario   AppImage only: `ok`, `fail`, `readonly`, `badsig`, a list (`ok,badsig`) or `all`
 *                (default)
 *   --remote     AppImage, `ok` only: the feed is the real one on Cloudflare (D-050), under a
 *                prefix of its own (desktop/e2e-<run>: the Worker serves only desktop/) that is published with publish-update.ts and
 *                deleted at the end: checks the Worker, its ranges and the publishing script
 *
 * 1. builds Monsters 0.0.1 and 0.0.2 as AppImages, both with the feed http://127.0.0.1:<port>/
 *    and a test key pair of this run (S-A4): the builds trust its public key
 *    (`package.ts --update-test-key`), its private key signs the channel file of 0.0.2; no key
 *    of this run is kept anywhere but the work folder;
 * 2. serves 0.0.2 (alpha-linux.yml, its .sig, the AppImage) from a local HTTP server;
 * 3. per scenario, starts 0.0.1 from a copy in a temporary "Applications" folder, in a test
 *    session of its own (test-session.ts: Xvfb, private D-Bus and XDG_RUNTIME_DIR), with a
 *    temporary HOME, XDG_CACHE_HOME (electron-updater's download cache) and MONSTERS_HOME, and
 *    MONSTERS_UPDATE_AUTO_INSTALL=1 (the user's click on "Riavvia per aggiornare");
 * 4. `ok`: waits until 0.0.2 runs with a healthy core (the log says "Monsters desktop 0.0.2", the
 *    folder holds only the 0.0.2 AppImage, the server saw the metadata and the download);
 *    `fail`: the install fails after electron-updater deleted the old file (a folder in the way
 *    of the new file): the old AppImage is put back and 0.0.1 starts again, healthy (M3.6, C1);
 *    `readonly`: the folder cannot be written: nothing is installed, 0.0.1 keeps running;
 *    `badsig`: the feed serves a signature by another key: nothing is downloaded, 0.0.1 keeps
 *    running and says why.
 *    Every scenario also checks that no process of the app reached the user's session bus.
 *
 * Everything lives in apps/desktop/.package/update-e2e (removed at the end unless --keep). The
 * Chromium sandbox: on Ubuntu 24.04+ an AppImage runs without it; the notice is accepted in the
 * test's user data folder beforehand.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { signChannelFile } from '../src/main/update-signature.ts';
import { APP } from './package-config.ts';
import {
  deleteObjects,
  feedUrl,
  fetchPublished,
  listObjects,
  planRelease,
  publish,
} from './publish-update.ts';
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

const { values } = parseArgs({
  options: {
    keep: { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
    reuse: { type: 'boolean', default: false },
    win: { type: 'boolean', default: false },
    deb: { type: 'boolean', default: false },
    remote: { type: 'boolean', default: false },
    scenario: { type: 'string', default: 'all' },
  },
});
const SCENARIOS = ['ok', 'fail', 'readonly', 'badsig'] as const;
type Scenario = (typeof SCENARIOS)[number];

const ROOT = resolve(APP, '..', '..');
const WORK = join(APP, '.package', 'update-e2e');
const TIMEOUT_MS = 240_000;

function log(line: string): void {
  process.stderr.write(`update-e2e: ${line}\n`);
}

function packageExt(): string {
  return values.win ? '.exe' : values.deb ? '.deb' : '.AppImage';
}

/** The .deb part: the chroot of test-deb-update.sh, which reaches the feed on 127.0.0.1. */
async function runDebInChroot(v1: string, seen: string[]): Promise<void> {
  const scenarios = values.scenario === 'all' ? [] : values.scenario.split(',');
  const code = await new Promise<number | null>((ok) => {
    // Not execFileSync: the feed server lives in this process and must keep answering.
    const child = spawn(
      'bash',
      [join(APP, 'scripts', 'test-deb-update.sh'), v1, '0.0.1', '0.0.2', ...scenarios],
      { stdio: 'inherit' },
    );
    child.on('exit', ok);
  });
  log(`requests: ${seen.join(', ')}`);
  if (code !== 0) throw new Error(`the update in the chroot failed (exit ${code})`);
  if (!seen.some((r) => r.includes('/alpha-linux.yml'))) {
    throw new Error('alpha-linux.yml never asked');
  }
  if (!seen.some((r) => r.includes('/alpha-linux.yml.sig'))) {
    throw new Error('alpha-linux.yml.sig never asked');
  }
  if (!seen.some((r) => /^GET \/Monsters-0\.0\.2-linux-amd64\.deb/.test(r))) {
    throw new Error('the 0.0.2 .deb was never downloaded');
  }
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createNetServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

/**
 * The key pair of this run (S-A4): the private key stays in the work folder (removed at the end
 * unless --keep), the public one goes into both test builds.
 */
function testKeys(): { privateKey: KeyObject; publicPem: string } {
  const priv = join(WORK, 'update-test.key');
  const pub = join(WORK, 'update-test.pem');
  if (!existsSync(priv)) {
    const pair = generateKeyPairSync('ed25519');
    writeFileSync(priv, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    writeFileSync(pub, pair.publicKey.export({ format: 'pem', type: 'spki' }));
  }
  return { privateKey: createPrivateKey(readFileSync(priv, 'utf8')), publicPem: pub };
}

/** Signs the channel files of a release folder (what publish-update.ts does on the real feed). */
function signRelease(dir: string, key: KeyObject): void {
  for (const name of readdirSync(dir).filter((n) => /^alpha.*\.yml$/.test(n))) {
    writeFileSync(
      join(dir, `${name}.sig`),
      signChannelFile(name, readFileSync(join(dir, name)), [key]),
    );
  }
}

function packageVersion(version: string, feed: string, out: string): string {
  execFileSync(
    process.execPath,
    [
      join(APP, 'scripts', 'package.ts'),
      ...(values.win ? ['--win'] : ['--linux', '--target', values.deb ? 'deb' : 'AppImage']),
      '--no-build',
      '--version',
      version,
      '--feed',
      feed,
      '--test-build',
      '--update-test-key',
      testKeys().publicPem,
      ...(values.win ? ['--test-feed-host', '10.0.2.2'] : []),
      '--out',
      out,
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: values.win ? { ...process.env, MONSTERS_WIN_SIGN: 'test' } : process.env,
    },
  );
  const file = readdirSync(out).find((f) => f.endsWith(packageExt()));
  if (!file) throw new Error(`no package in ${out}`);
  return join(out, file);
}

/** Files answered instead of the folder's (the `badsig` scenario's forged signature). */
const overrides = new Map<string, string>();

/** A static server over one folder, remembering what was asked. */
function serve(dir: string, port: number, seen: string[]): Promise<Server> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    seen.push(
      `${req.method ?? 'GET'} ${path}${req.headers.range ? ` (${req.headers.range})` : ''}`,
    );
    const forged = overrides.get(path);
    if (forged !== undefined) {
      res.writeHead(200, { 'content-length': Buffer.byteLength(forged) }).end(forged);
      return;
    }
    const file = normalize(join(dir, path));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const ranges = /^bytes=([\d\-, ]+)$/.exec(req.headers.range ?? '')?.[1]?.split(',') ?? [];
    if (ranges.length > 1) {
      // Several ranges: multipart/byteranges, what the differential download of electron-updater
      // asks for (only the blocks that changed between the two AppImages).
      const boundary = 'monsters-update-e2e';
      const data = readFileSync(file);
      const parts: Buffer[] = [];
      for (const r of ranges) {
        const [a = '0', b = ''] = r.trim().split('-');
        const start = Number(a);
        const end = b ? Number(b) : size - 1;
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Type: application/octet-stream\r\n` +
              `Content-Range: bytes ${start}-${end}/${size}\r\n\r\n`,
          ),
          data.subarray(start, end + 1),
          Buffer.from('\r\n'),
        );
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      const body = Buffer.concat(parts);
      res.writeHead(206, {
        'content-type': `multipart/byteranges; boundary=${boundary}`,
        'content-length': body.length,
      });
      res.end(body);
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
        'accept-ranges': 'bytes',
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

async function health(home: string): Promise<boolean> {
  try {
    const { url } = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')) as { url: string };
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The folder of the VM of ci-windows.sh: MONSTERS_WINVM_DIR from the environment or from
 * scripts/ci.local.env (read by scripts/ci-env.sh, as the shell scripts do), else the default.
 */
function winVmDir(): string {
  const out = execFileSync(
    'bash',
    [
      '-c',
      '. "$1/ci-env.sh" && monsters_load_ci_env "$1" && ' +
        'printf %s "${MONSTERS_WINVM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/monsters/winvm}"',
      'win-vm-dir',
      join(ROOT, 'scripts'),
    ],
    { encoding: 'utf8' },
  );
  return out;
}

/** The Windows part: the VM of ci-windows.sh, from its clean snapshot, shut down at the end. */
async function runInWindowsVm(installer: string): Promise<void> {
  const ci = join(ROOT, 'scripts', 'ci-windows.sh');
  const vmDir = winVmDir();
  const ssh = [
    '-i',
    join(process.env['HOME'] ?? '', '.ssh', 'monsters_winvm'),
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'LogLevel=ERROR',
    '-o',
    `UserKnownHostsFile=${join(vmDir, 'known_hosts')}`,
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  const port = process.env['MONSTERS_WINVM_SSH_PORT'] ?? '22522';
  const wasOff = execFileSync('bash', [ci, 'status'], { encoding: 'utf8' }).startsWith(
    'ci:windows: off',
  );
  if (wasOff) {
    execFileSync('qemu-img', ['snapshot', '-a', 'ci-base', join(vmDir, 'disk.qcow2')]);
    copyFileSync(join(vmDir, 'OVMF_VARS.ci-base.fd'), join(vmDir, 'OVMF_VARS.fd'));
  }
  try {
    execFileSync('bash', [ci, 'start'], { stdio: 'inherit' });
    const dir = 'C:\\Users\\ci\\monsters-update';
    execFileSync('ssh', [
      ...ssh,
      '-p',
      port,
      'ci@127.0.0.1',
      `powershell -NoProfile -Command "New-Item -Force -ItemType Directory ${dir} | Out-Null"`,
    ]);
    execFileSync('scp', [
      '-q',
      ...ssh,
      '-P',
      port,
      installer,
      join(APP, 'scripts', 'update-e2e-windows.ps1'),
      join(APP, '.signing', 'test-ca.crt'),
      'ci@127.0.0.1:monsters-update/',
    ]);
    // Not execFileSync: the feed server lives in this process and must keep answering.
    const code = await new Promise<number | null>((ok) => {
      const child = spawn(
        'ssh',
        [
          ...ssh,
          '-p',
          port,
          'ci@127.0.0.1',
          `powershell -NoProfile -ExecutionPolicy Bypass -File ${dir}\\update-e2e-windows.ps1 ` +
            `-Installer ${dir}\\${installer.split('/').pop() ?? ''} -TestCa ${dir}\\test-ca.crt`,
        ],
        { stdio: 'inherit' },
      );
      child.on('exit', ok);
    });
    if (code !== 0) throw new Error(`the update in the VM failed (exit ${code})`);
  } finally {
    if (wasOff && !values.keep) execFileSync('bash', [ci, 'stop'], { stdio: 'inherit' });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const V1_NAME = 'Monsters-0.0.1-linux-x86_64.AppImage';
const V2_NAME = 'Monsters-0.0.2-linux-x86_64.AppImage';

/** What a scenario waits for in desktop.log (with a healthy core), and checks afterwards. */
const EXPECT: Record<Scenario, { done: (log: string) => boolean; what: string }> = {
  ok: { done: (l) => l.includes('Monsters desktop 0.0.2'), what: '0.0.2 running' },
  fail: {
    // The second start of 0.0.1, after the failed install.
    done: (l) =>
      l.includes('updates: install failed') && l.split('Monsters desktop 0.0.1').length > 2,
    what: '0.0.1 running again after the failed install',
  },
  readonly: {
    done: (l) => l.includes('updates: not installing version 0.0.2'),
    what: 'the install refused, 0.0.1 still running',
  },
  badsig: {
    done: (l) => l.includes('updates: version 0.0.2 refused: unknown-key'),
    what: 'the update refused for its signature, 0.0.1 still running',
  },
};

/** Interrupted (Ctrl-C): the app of the running scenario and its session go too. */
let interruptCleanup: (() => void) | null = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    interruptCleanup?.();
    if (!values.keep) rmSync(WORK, { recursive: true, force: true });
    process.exit(130);
  });
}

async function runScenario(scenario: Scenario, v1: string, seen: string[]): Promise<void> {
  seen.length = 0;
  const dir = join(WORK, scenario);
  rmSync(dir, { recursive: true, force: true });
  const apps = join(dir, 'Applications');
  const home = join(dir, 'home');
  const userData = join(dir, 'userdata');
  // HOME and the download cache of electron-updater (~/.cache/monsters-updater) of this run only.
  const fakeHome = join(dir, 'user-home');
  const cache = join(fakeHome, '.cache');
  for (const d of [apps, home, userData, cache]) mkdirSync(d, { recursive: true });
  const installed = join(apps, V1_NAME);
  copyFileSync(v1, installed);
  chmodSync(installed, 0o755);
  // The sandbox notice of an AppImage on Ubuntu 24.04+ (linux-sandbox.ts), already accepted.
  writeFileSync(join(userData, 'sandbox-notice-accepted'), 'update-e2e\n');
  if (scenario === 'fail') {
    // A folder where the new file must go: electron-updater deletes 0.0.1, moves 0.0.2 into
    // that folder, then fails to start it. Without the backup of updater.ts nothing is left.
    mkdirSync(join(apps, V2_NAME));
    writeFileSync(join(apps, V2_NAME, 'in-the-way'), '');
  }
  // A folder of the user that this user cannot write (installed by an administrator…).
  if (scenario === 'readonly') chmodSync(apps, 0o555);
  // A signature by a key the builds do not trust, for the very same channel file.
  overrides.clear();
  if (scenario === 'badsig') {
    const v2dir = join(WORK, 'v2');
    const stranger = generateKeyPairSync('ed25519').privateKey;
    overrides.set(
      '/alpha-linux.yml.sig',
      signChannelFile('alpha-linux.yml', readFileSync(join(v2dir, 'alpha-linux.yml')), [stranger]),
    );
  }

  const userBus = userBusAddress();
  const session = await startTestSession();
  const marker = `MONSTERS_HOME=${home}`;
  // The app's processes: the packaged ones cannot have their environment read, so the main one
  // is found by a switch on its command line (kept by the relaunch after an update).
  const runArg = testRunSwitch(`update-e2e-${scenario}`);
  const roots = () => [...pidsWithArg(runArg), ...pidsWithEnv(marker)];
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(ELECTRON_RUN_AS_NODE|XDG_CACHE_HOME|HOME)$|^MONSTERS_/.test(k)) {
      base[k] = v;
    }
  }
  const env = {
    ...sessionEnv(base, session),
    HOME: fakeHome,
    XDG_CACHE_HOME: cache,
    MONSTERS_HOME: home,
    MONSTERS_DESKTOP_USER_DATA: userData,
    MONSTERS_SECRETS: 'file',
    MONSTERS_EMBEDDINGS: 'off',
    MONSTERS_TELEGRAM: 'off',
    MONSTERS_UPDATE_AUTO_INSTALL: '1',
  };
  assertIsolated(env, session);
  // The first-start question already answered ("Su questo computer"): nobody clicks here.
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'connections.json'),
    `${JSON.stringify({ version: 1, profiles: [], last: 'local' })}\n`,
  );
  interruptCleanup = () => {
    for (const pid of processTree(roots())) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    try {
      chmodSync(apps, 0o755);
    } catch {
      // gone
    }
    session.stop();
  };
  const started = Date.now();
  log(`${scenario}: starting 0.0.1 on ${session.display}`);
  // Output of both versions (the relaunched one inherits it) in app.log.
  const out = openSync(join(dir, 'app.log'), 'a');
  const app = spawn(installed, ['--ozone-platform=x11', runArg], {
    env,
    stdio: ['ignore', out, out],
    detached: true,
  });
  app.unref();

  const desktopLog = join(home, 'logs', 'desktop.log');
  const expect = EXPECT[scenario];
  let ok = false;
  try {
    while (Date.now() - started < TIMEOUT_MS) {
      await sleep(1000);
      const text = existsSync(desktopLog) ? readFileSync(desktopLog, 'utf8') : '';
      if (expect.done(text) && (await health(home))) {
        ok = true;
        break;
      }
    }
    const files = readdirSync(apps).sort();
    const text = existsSync(desktopLog) ? readFileSync(desktopLog, 'utf8') : '(no log)';
    const lines = text
      .split('\n')
      .filter((l) =>
        /Monsters desktop|updates:|updater:.*(Download|download|differential|Full)/.test(l),
      );
    log(`${scenario}: desktop.log:\n    ${lines.join('\n    ')}`);
    log(`${scenario}: requests: ${seen.join(', ')}`);
    log(`${scenario}: folder: ${files.join(', ')}`);
    if (!ok) throw new Error(`${scenario}: not ${expect.what} after ${TIMEOUT_MS / 1000}s`);
    log(`${scenario}: ${checkNotOnUserBus(processTree(roots()), session, userBus)}`);
    if (values.remote) {
      // No server of ours to watch: the differential download must not have fallen back.
      if (/fallback to full download/i.test(text)) {
        throw new Error(`${scenario}: the differential download through the Worker failed`);
      }
    } else if (!seen.some((r) => r.includes('/alpha-linux.yml'))) {
      throw new Error(`${scenario}: alpha-linux.yml never asked`);
    } else if (!seen.some((r) => r.includes('/alpha-linux.yml.sig'))) {
      throw new Error(`${scenario}: the signature alpha-linux.yml.sig never asked`);
    } else if (scenario === 'badsig') {
      if (seen.some((r) => r.includes('.AppImage'))) {
        throw new Error('badsig: the AppImage was downloaded despite the wrong signature');
      }
    } else if (!seen.some((r) => r.includes('.AppImage'))) {
      throw new Error(`${scenario}: the AppImage was never downloaded`);
    }
    const hidden = files.filter((f) => f.startsWith('.'));
    if (scenario === 'ok') {
      if (files.join() !== V2_NAME) {
        throw new Error(`the folder should hold only the 0.0.2 AppImage: ${files.join(', ')}`);
      }
    } else if (scenario === 'fail') {
      // 0.0.1 back in place (a file, executable), no backup left beside it.
      const st = statSync(installed);
      if (!st.isFile() || (st.mode & 0o111) === 0 || hidden.length > 0) {
        throw new Error(`the 0.0.1 AppImage was not put back: ${files.join(', ')}`);
      }
      if (!text.includes('updates: the previous AppImage restored from its backup')) {
        throw new Error('no restore of the previous AppImage in the log');
      }
    } else if (files.join() !== V1_NAME) {
      throw new Error(`the folder should be untouched: ${files.join(', ')}`);
    }
    if (scenario === 'badsig' && /updates: version 0\.0\.2 signed/.test(text)) {
      throw new Error('badsig: the forged signature was accepted');
    }
    log(`${scenario}: OK in ${Math.round((Date.now() - started) / 1000)}s, core healthy`);
  } finally {
    await stopTree(roots, scenario).catch((err: Error) => log(err.message));
    try {
      chmodSync(apps, 0o755);
    } catch {
      // gone
    }
    session.stop();
    interruptCleanup = null;
  }
}

async function main(): Promise<void> {
  // One scenario or a list (`ok,badsig`, the evening CI), in the order of SCENARIOS.
  const wanted = values.scenario.split(',').map((s) => s.trim());
  const scenarios: Scenario[] =
    values.scenario === 'all' ? [...SCENARIOS] : SCENARIOS.filter((s) => wanted.includes(s));
  const unknown = wanted.filter((w) => !(SCENARIOS as readonly string[]).includes(w));
  if (!values.deb && values.scenario !== 'all' && (scenarios.length === 0 || unknown.length > 0)) {
    throw new Error(`unknown scenario ${values.scenario}`);
  }
  if (values.deb && (values.win || values.remote)) {
    throw new Error('--deb goes without --win and --remote');
  }
  if (values.remote) {
    if (values.win || values.reuse || values.scenario !== 'all') {
      throw new Error('--remote runs the ok scenario of the AppImage only');
    }
    scenarios.splice(0, scenarios.length, 'ok');
  }
  const portFile = join(WORK, 'port');
  const reuse = values.reuse && existsSync(portFile);
  if (reuse) {
    for (const d of [...SCENARIOS]) rmSync(join(WORK, d), { recursive: true, force: true });
  } else {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
  }
  const port = reuse ? Number(readFileSync(portFile, 'utf8')) : await freePort();
  writeFileSync(portFile, `${port}\n`);
  const prefix = `desktop/e2e-${Date.now().toString(36)}`;
  const feed = values.remote
    ? feedUrl(prefix)
    : `http://${values.win ? '10.0.2.2' : '127.0.0.1'}:${port}/`;
  if (!values['no-build'] && !reuse) {
    log('building the core bundle and the app');
    execFileSync('pnpm', ['-w', 'run', 'build:core'], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    execFileSync(process.execPath, [join(APP, 'scripts', 'build.ts')], {
      cwd: APP,
      stdio: 'inherit',
    });
  }
  const v2dir = join(WORK, 'v2');
  const ext = packageExt();
  if (!reuse) {
    log(`packaging 0.0.1 and 0.0.2 with the feed ${feed}`);
    packageVersion('0.0.1', feed, join(WORK, 'v1'));
    packageVersion('0.0.2', feed, v2dir);
  }
  const v1name = readdirSync(join(WORK, 'v1')).find((f) => f.endsWith(ext));
  if (!v1name) throw new Error(`no 0.0.1 package (${ext}) in ${join(WORK, 'v1')}`);
  const v1 = join(WORK, 'v1', v1name);
  const meta = values.win ? 'alpha.yml' : 'alpha-linux.yml';
  if (!existsSync(join(v2dir, meta))) throw new Error(`no ${meta} for 0.0.2`);
  // The local feed is signed here; the remote one by publish-update.ts, with the same key.
  const { privateKey } = testKeys();
  if (!values.remote) signRelease(v2dir, privateKey);

  if (values.remote) {
    try {
      const plan = await planRelease({
        dir: v2dir,
        prefix,
        allowUnsigned: false,
        published: (name) => fetchPublished(feed, name),
        signer: privateKey,
        // A test build, on its own prefix (publish-update.ts refuses it anywhere else).
        testFeed: true,
      });
      await publish(plan, log);
      await runScenario('ok', v1, []);
      log('OK: ok through the Worker');
    } finally {
      const keys = [...listObjects(prefix).keys()];
      deleteObjects(keys);
      const left = listObjects(prefix).size;
      log(`removed ${keys.length} objects under ${prefix}${left ? `, ${left} LEFT` : ''}`);
      if (values.keep) log(`kept ${WORK}`);
      else rmSync(WORK, { recursive: true, force: true });
    }
    return;
  }
  const seen: string[] = [];
  const server = await serve(v2dir, port, seen);
  try {
    if (values.deb) {
      await runDebInChroot(v1, seen);
      log(`OK: .deb ${values.scenario === 'all' ? 'cancel, dpkg, ok' : values.scenario}`);
      return;
    }
    if (values.win) {
      try {
        await runInWindowsVm(v1);
      } finally {
        log(`requests: ${seen.join(', ')}`);
      }
      if (!seen.some((r) => r.includes('/alpha.yml'))) throw new Error('alpha.yml never asked');
      if (!seen.some((r) => r.includes('/alpha.yml.sig'))) {
        throw new Error('alpha.yml.sig never asked');
      }
      return;
    }
    for (const scenario of scenarios) await runScenario(scenario, v1, seen);
    log(`OK: ${scenarios.join(', ')}`);
  } finally {
    server.close();
    if (values.keep) log(`kept ${WORK}`);
    else rmSync(WORK, { recursive: true, force: true });
  }
}

main().catch((err: Error) => {
  log(`FAILED: ${err.message}`);
  process.exitCode = 1;
});
