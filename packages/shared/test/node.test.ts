import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MACOS_GUI_PATH,
  nodeMissing,
  npmMissing,
  findChildNode,
  loginShellPath,
  mergePathLists,
  nodeRuntime,
  npmCommand,
  pinNodeRuntime,
  readLoginShellPath,
  requireNodeRuntime,
  unpinNodeRuntime,
  wantsLoginShellPath,
  type LoginShellProcess,
  type RunShell,
} from '../src/node/index.ts';

const posix = process.platform !== 'win32';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  unpinNodeRuntime();
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'monsters-node-'));
  dirs.push(d);
  return d;
}
function executable(path: string, content = '#!/bin/sh\n'): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}
/** A Node installation as nvm or the official tarball lay it out: bin/node, lib/node_modules/npm. */
function nodeInstall(root: string): { node: string; cli: string } {
  const node = executable(join(root, 'bin', 'node'), '#!/bin/sh\necho v24.11.0\n');
  const cli = join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  mkdirSync(join(cli, '..'), { recursive: true });
  writeFileSync(cli, '');
  return { node, cli };
}

const plainNode = {
  execPath: '/opt/node/bin/node',
  versions: { node: '24.21.0' },
  platform: 'linux',
} as const;
const electron = {
  execPath: '/Applications/Monsters.app/Contents/MacOS/Monsters',
  versions: { node: '24.21.0', electron: '44.7.1' },
  platform: 'darwin',
} as const;

describe('nodeRuntime', () => {
  it('is the Node running Monsters from a terminal', () => {
    expect(nodeRuntime({}, plainNode)).toEqual({ command: '/opt/node/bin/node', source: 'node' });
  });

  it.skipIf(!posix)('inside the desktop app: the node on the PATH, never Electron (S-M8)', () => {
    const root = tmp();
    const { node } = nodeInstall(join(root, 'user'));
    const env = { PATH: [join(root, 'empty'), join(root, 'user', 'bin')].join(delimiter) };
    expect(nodeRuntime(env, electron)).toEqual({ command: node, source: 'path' });
    // The core's utility process (a helper binary on macOS) is no different.
    const helper = {
      ...electron,
      execPath:
        '/Applications/Monsters.app/Contents/Frameworks/Monsters Helper.app/Contents/MacOS/Monsters Helper',
    };
    expect(nodeRuntime(env, helper)?.command).toBe(node);
  });

  it('inside the desktop app without a node on the PATH: none, and a clear error', () => {
    expect(nodeRuntime({ PATH: '' }, electron)).toBeNull();
    expect(() => requireNodeRuntime({ PATH: '' }, electron)).toThrow(nodeMissing());
    expect(nodeMissing()).toMatch(/nodejs\.org.*MONSTERS_NODE_PATH/);
    // Never the Electron binary, whatever it is called.
    expect(nodeRuntime({ PATH: '' }, { ...electron, execPath: '/usr/bin/node' })).toBeNull();
  });

  it('MONSTERS_NODE_PATH wins, also inside Electron', () => {
    expect(nodeRuntime({ MONSTERS_NODE_PATH: ' /usr/local/bin/node ' }, electron)).toEqual({
      command: '/usr/local/bin/node',
      source: 'configured',
    });
    expect(requireNodeRuntime({ MONSTERS_NODE_PATH: '/n', PATH: '' }, electron).command).toBe('/n');
  });
});

describe("the children's node inside the app (review of wave 5, n. 9)", () => {
  const v24 = () => 'v24.11.0\n';

  it('on Windows only node.exe, never node.cmd or node.bat, and no relative entry', () => {
    const files = new Set(['C:\\shim\\node.cmd', 'C:\\bat\\node.bat', 'C:\\nodejs\\node.exe']);
    const found = findChildNode({
      platform: 'win32',
      env: { Path: '.;tools;C:relative;C:\\shim;C:\\bat;"C:\\nodejs"', PATHEXT: '.CMD;.BAT;.EXE' },
      isExecutable: (p) => files.has(p),
      version: v24,
    });
    expect(found).toEqual({ command: 'C:\\nodejs\\node.exe', version: 'v24.11.0' });
    // Only a .cmd: none.
    expect(
      findChildNode({
        platform: 'win32',
        env: { Path: 'C:\\shim' },
        isExecutable: (p) => files.has(p),
        version: v24,
      }).command,
    ).toBeNull();
    // A node.exe in the current folder (".") is never taken.
    const cwd = findChildNode({
      platform: 'win32',
      env: { Path: '.' },
      isExecutable: () => true,
      version: v24,
    });
    expect(cwd).toEqual({ command: null, skipped: ['.: not an absolute folder'] });
  });

  it.skipIf(!posix)('skips relative entries and the folders the monsters can write', () => {
    const root = tmp();
    const planted = nodeInstall(join(root, 'home', 'agents', 'scout', 'bin'));
    const user = nodeInstall(join(root, 'user'));
    const env = {
      PATH: [
        '.',
        'bin',
        join(root, 'home', 'agents', 'scout', 'bin', 'bin'),
        join(root, 'user', 'bin'),
      ].join(delimiter),
    };
    const found = findChildNode({ env, exclude: [join(root, 'home')] });
    expect(found.command).toBe(user.node);
    expect(planted.node).not.toBe(user.node);
    const none = findChildNode({
      env: { PATH: join(root, 'home', 'agents', 'scout', 'bin', 'bin') },
      exclude: [join(root, 'home')],
    });
    expect(none.command).toBeNull();
    expect((none as { skipped: string[] }).skipped[0]).toContain('monsters can write');
  });

  it.skipIf(!posix)('refuses a Node older than 20, and a file that is not a Node', () => {
    const root = tmp();
    executable(join(root, 'old', 'node'), '#!/bin/sh\necho v18.20.0\n');
    executable(join(root, 'fake', 'node'), '#!/bin/sh\necho hello\n');
    const env = { PATH: [join(root, 'old'), join(root, 'fake')].join(delimiter) };
    const found = findChildNode({ env });
    expect(found.command).toBeNull();
    expect((found as { skipped: string[] }).skipped).toEqual([
      `${join(root, 'old', 'node')}: Node 18, older than 20`,
      `${join(root, 'fake', 'node')}: not a Node`,
    ]);
    const good = nodeInstall(join(root, 'good'));
    expect(
      findChildNode({ env: { PATH: `${env.PATH}${delimiter}${join(root, 'good', 'bin')}` } })
        .command,
    ).toBe(good.node);
  });

  it.skipIf(!posix)('pinned at start: a PATH changed later does not change it', () => {
    const root = tmp();
    const user = nodeInstall(join(root, 'user'));
    const other = nodeInstall(join(root, 'other'));
    expect(
      pinNodeRuntime(
        { env: { PATH: join(root, 'user', 'bin') }, exclude: [join(root, 'home')] },
        electron,
      ),
    ).toEqual({ command: user.node, source: 'path' });
    expect(nodeRuntime({ PATH: join(root, 'other', 'bin') }, electron)?.command).toBe(user.node);
    expect(nodeRuntime({ PATH: '' }, electron)?.command).toBe(user.node);
    // A second pin keeps the first.
    expect(pinNodeRuntime({ env: { PATH: join(root, 'other', 'bin') } }, electron)?.command).toBe(
      user.node,
    );
    expect(other.node).not.toBe(user.node);
    // Outside Electron: the Node running Monsters, nothing pinned.
    expect(pinNodeRuntime({}, plainNode)).toEqual({ command: plainNode.execPath, source: 'node' });
  });

  it.skipIf(!posix)(
    'none found at start: found later with the same search, not another PATH',
    () => {
      const root = tmp();
      const bin = join(root, 'later', 'bin');
      expect(pinNodeRuntime({ env: { PATH: bin } }, electron)).toBeNull();
      const elsewhere = nodeInstall(join(root, 'elsewhere'));
      expect(nodeRuntime({ PATH: join(root, 'elsewhere', 'bin') }, electron)).toBeNull();
      const later = nodeInstall(join(root, 'later'));
      expect(nodeRuntime({ PATH: '' }, electron)?.command).toBe(later.node);
      expect(elsewhere.node).not.toBe(later.node);
    },
  );
});

describe('npmCommand', () => {
  it.skipIf(!posix)('uses the npm of the runtime Node', () => {
    const { node, cli } = nodeInstall(tmp());
    expect(npmCommand({ PATH: '' }, { ...plainNode, execPath: node })).toEqual({
      command: node,
      args: [cli],
      env: {},
    });
  });

  it.skipIf(!posix)('inside Electron: the npm of the node on the PATH, never Electron', () => {
    const root = tmp();
    // An npm next to the Electron binary could not run: the packaged app is never a Node.
    const app = nodeInstall(join(root, 'app'));
    const user = nodeInstall(join(root, 'user'));
    const env = { PATH: [join(root, 'empty'), join(root, 'user', 'bin')].join(delimiter) };
    expect(npmCommand(env, { ...electron, execPath: app.node })).toEqual({
      command: user.node,
      args: [user.cli],
      env: {},
    });
  });

  it.skipIf(!posix)('MONSTERS_NODE_PATH: its npm', () => {
    const { node, cli } = nodeInstall(tmp());
    expect(npmCommand({ PATH: '', MONSTERS_NODE_PATH: node }, electron)).toEqual({
      command: node,
      args: [cli],
      env: {},
    });
  });

  it.skipIf(!posix)('falls back to an npm on the PATH, else null', () => {
    const bin = join(tmp(), 'bin');
    expect(npmCommand({ PATH: bin }, electron)).toBeNull();
    const npm = executable(join(bin, 'npm'));
    expect(npmCommand({ PATH: bin }, electron)).toEqual({ command: npm, args: [], env: {} });
    expect(npmMissing()).toMatch(/MONSTERS_NODE_PATH/);
  });
});

describe('PATH from the login shell', () => {
  const gui = (o: Partial<LoginShellProcess> = {}): LoginShellProcess => ({
    platform: 'darwin',
    versions: { node: '24.21.0' },
    tty: false,
    ...o,
  });

  it('is asked only when the process looks started from the desktop', () => {
    // macOS app from the Dock/Finder: launchd's bare PATH, no terminal.
    expect(wantsLoginShellPath({ PATH: MACOS_GUI_PATH }, gui())).toBe(true);
    // Electron with no terminal, on macOS and Linux.
    const inElectron = { versions: { node: '24', electron: '44' } };
    expect(wantsLoginShellPath({ PATH: '/usr/bin' }, gui(inElectron))).toBe(true);
    expect(
      wantsLoginShellPath({ PATH: '/usr/bin' }, gui({ ...inElectron, platform: 'linux' })),
    ).toBe(true);
    // From a terminal, or a service with a full PATH: no.
    expect(wantsLoginShellPath({ PATH: MACOS_GUI_PATH }, gui({ tty: true }))).toBe(false);
    expect(wantsLoginShellPath({ PATH: MACOS_GUI_PATH, TERM: 'xterm' }, gui())).toBe(false);
    expect(wantsLoginShellPath({ PATH: '/usr/bin' }, gui({ platform: 'linux' }))).toBe(false);
    // Never on Windows; the variable forces it either way elsewhere.
    expect(
      wantsLoginShellPath({ MONSTERS_LOGIN_SHELL_PATH: '1' }, gui({ platform: 'win32' })),
    ).toBe(false);
    expect(
      wantsLoginShellPath({ MONSTERS_LOGIN_SHELL_PATH: '1', TERM: 'x' }, gui({ tty: true })),
    ).toBe(true);
    expect(
      wantsLoginShellPath({ MONSTERS_LOGIN_SHELL_PATH: '0', PATH: MACOS_GUI_PATH }, gui()),
    ).toBe(false);
  });

  it('merges without duplicates, the login shell first', () => {
    expect(mergePathLists('/a:/b::/c', '/c:/usr/bin:/a', ':')).toBe('/a:/b:/c:/usr/bin');
  });

  it('runs $SHELL -i -l -c and reads PATH between the markers', async () => {
    const calls: { shell: string; args: string[]; timeoutMs: number }[] = [];
    const run: RunShell = (shell, args, o) => {
      calls.push({ shell, args, timeoutMs: o.timeoutMs });
      const mark = /echo (\S+);/.exec(args[3] ?? '')?.[1] ?? '';
      return Promise.resolve(
        `Welcome back!\n${mark}\n/opt/homebrew/bin:/Users/g/.local/bin:/usr/bin:/bin\n${mark}\nbye\n`,
      );
    };
    const env = { SHELL: '/bin/zsh', PATH: MACOS_GUI_PATH, MONSTERS_LOGIN_SHELL_PATH: '1' };
    expect(await loginShellPath({ env, proc: gui(), run })).toBe(
      '/opt/homebrew/bin:/Users/g/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    );
    expect(calls).toEqual([
      { shell: '/bin/zsh', args: ['-i', '-l', '-c', expect.any(String)], timeoutMs: 3000 },
    ]);
    expect(calls[0]!.args[3]).toContain('printenv PATH');
  });

  it('falls back silently: no markers, failure, nothing new, not asked', async () => {
    const env = { SHELL: '/bin/bash', PATH: '/usr/bin:/bin', MONSTERS_LOGIN_SHELL_PATH: '1' };
    const proc = gui();
    const reply =
      (out: string | null): RunShell =>
      () =>
        Promise.resolve(out);
    expect(await loginShellPath({ env, proc, run: reply('just noise\n') })).toBeNull();
    expect(await loginShellPath({ env, proc, run: reply(null) })).toBeNull();
    expect(
      await loginShellPath({ env, proc, run: () => Promise.reject(new Error('boom')) }),
    ).toBeNull();
    const same: RunShell = (_s, args) => {
      const mark = /echo (\S+);/.exec(args[3] ?? '')?.[1] ?? '';
      return Promise.resolve(`${mark}\n/usr/bin:/bin\n${mark}\n`);
    };
    expect(await loginShellPath({ env, proc, run: same })).toBeNull();
    let asked = false;
    const spy: RunShell = () => {
      asked = true;
      return Promise.resolve(null);
    };
    expect(
      await loginShellPath({ env: { PATH: '/usr/bin', TERM: 'x' }, proc, run: spy }),
    ).toBeNull();
    expect(asked).toBe(false);
    expect(await readLoginShellPath({ env: {}, fallbackShell: () => null, run: spy })).toBeNull();
  });

  it.skipIf(!posix)('with a real shell: login PATH read, a hanging shell times out', async () => {
    const dir = tmp();
    const shell = executable(
      join(dir, 'login-shell'),
      // Like an rc file: prints noise, extends PATH, then runs the command.
      '#!/bin/sh\necho "motd: hello"\nPATH="/opt/login/bin:$PATH"; export PATH\neval "$4"\n',
    );
    const env = { SHELL: shell, PATH: '/usr/bin:/bin', MONSTERS_LOGIN_SHELL_PATH: '1' };
    expect(await readLoginShellPath({ env })).toBe('/opt/login/bin:/usr/bin:/bin');
    expect(await loginShellPath({ env, proc: gui() })).toBe('/opt/login/bin:/usr/bin:/bin');

    // An rc file that leaves a process in the background holding stdout (an agent, a
    // daemon): the PATH comes at the closing marker, not when the pipe closes.
    const daemon = executable(
      join(dir, 'daemon-shell'),
      '#!/bin/sh\nsleep 30 &\nPATH="/opt/rc/bin:$PATH"; export PATH\neval "$4"\n',
    );
    const t0 = Date.now();
    expect(
      await readLoginShellPath({ env: { SHELL: daemon, PATH: '/usr/bin:/bin' }, timeoutMs: 2500 }),
    ).toBe('/opt/rc/bin:/usr/bin:/bin');
    expect(Date.now() - t0).toBeLessThan(2000);

    const slow = executable(join(dir, 'slow-shell'), '#!/bin/sh\nsleep 30\n');
    const started = Date.now();
    expect(
      await readLoginShellPath({ env: { SHELL: slow, PATH: '/usr/bin:/bin' }, timeoutMs: 300 }),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
