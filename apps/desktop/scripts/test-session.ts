/*
 * The graphical session of the scripts that start the app for a test (M3.6, D-049): an Xvfb
 * display, a private D-Bus session bus and a private XDG_RUNTIME_DIR. Never the desktop of the
 * person at this PC: no Wayland (Electron finds the compositor through XDG_RUNTIME_DIR even
 * without WAYLAND_DISPLAY), no X display of theirs, and nothing on their session bus (the tray
 * icon is a StatusNotifierItem and notifications go through org.freedesktop.Notifications: both
 * would show up on their desktop). `userBusPeers` checks the last point from the outside.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestSession {
  display: string;
  /** Address of the private session bus. */
  bus: string;
  runtimeDir: string;
  /** Variables to set on the app's environment (see `sessionEnv`). */
  vars: Record<string, string>;
  stop(): void;
}

/** Variables of the user's session that must never reach a test app. */
const USER_SESSION_VARS =
  /^(WAYLAND_DISPLAY|WAYLAND_SOCKET|DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|XDG_SESSION_DESKTOP|DESKTOP_SESSION|GNOME_.*|SESSION_MANAGER)$/;

/** `base` without the user's session, plus the test session. */
export function sessionEnv(
  base: Record<string, string | undefined>,
  session: Pick<TestSession, 'vars'>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !USER_SESSION_VARS.test(k)) env[k] = v;
  }
  return { ...env, ...session.vars };
}

/** Refuses to start a window anywhere but the test session (the rule of AGENTS.md). */
export function assertIsolated(
  env: Record<string, string | undefined>,
  session: Pick<TestSession, 'display' | 'bus' | 'runtimeDir'>,
): void {
  if (env['WAYLAND_DISPLAY']) throw new Error('WAYLAND_DISPLAY set: refusing to open windows');
  if (env['DISPLAY'] !== session.display) {
    throw new Error(
      `DISPLAY is ${env['DISPLAY'] ?? 'unset'}, not the test Xvfb ${session.display}`,
    );
  }
  if (env['DBUS_SESSION_BUS_ADDRESS'] !== session.bus) {
    throw new Error('the session bus is not the private one of the test: refusing to start');
  }
  if (env['XDG_RUNTIME_DIR'] !== session.runtimeDir) {
    throw new Error('XDG_RUNTIME_DIR is not the private one of the test: refusing to start');
  }
}

/**
 * Configuration of the private session bus: no service directories, so nothing of the user's
 * desktop is activated on it (the document portal mounts FUSE in XDG_RUNTIME_DIR, dconf and
 * gvfs-metadata write in the user's real home).
 */
export function privateBusConfig(runtimeDir: string): string {
  return `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path=${join(runtimeDir, 'bus')}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`;
}

/** Reads one line from file descriptor 3 of `proc` (Xvfb -displayfd, dbus-daemon --print-address). */
function firstLine(proc: ChildProcess, what: string): Promise<string> {
  return new Promise((ok, fail) => {
    proc.once('error', fail);
    proc.once('exit', (code) => fail(new Error(`${what} exited with ${code}`)));
    let text = '';
    (proc.stdio[3] as NodeJS.ReadableStream).on('data', (d: Buffer) => {
      text += d.toString();
      if (text.includes('\n')) ok(text.trim());
    });
  });
}

export async function startTestSession(): Promise<TestSession> {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'monsters-session-'));
  chmodSync(runtimeDir, 0o700);
  const procs: ChildProcess[] = [];
  const stop = () => {
    for (const p of procs) p.kill();
    try {
      rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // a temporary folder; tmp cleaning removes it
    }
  };
  try {
    const xvfb = spawn(
      'Xvfb',
      ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] },
    );
    procs.push(xvfb);
    const display = `:${await firstLine(xvfb, 'Xvfb')}`;
    const config = join(runtimeDir, 'session-bus.conf');
    writeFileSync(config, privateBusConfig(runtimeDir));
    const dbus = spawn(
      'dbus-daemon',
      [`--config-file=${config}`, '--nofork', '--nopidfile', '--print-address=3'],
      { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] },
    );
    procs.push(dbus);
    const bus = await firstLine(dbus, 'dbus-daemon');
    return {
      display,
      bus,
      runtimeDir,
      vars: {
        DISPLAY: display,
        XDG_SESSION_TYPE: 'x11',
        DBUS_SESSION_BUS_ADDRESS: bus,
        XDG_RUNTIME_DIR: runtimeDir,
        // No accessibility bus either (it is found through the session bus).
        NO_AT_BRIDGE: '1',
      },
      stop,
    };
  } catch (err) {
    stop();
    throw err;
  }
}

/** Linux processes that carry `marker` (`NAME=value`) in their environment. */
export function pidsWithEnv(marker: string): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (readFileSync(`/proc/${entry}/environ`, 'latin1').split('\0').includes(marker))
        pids.push(Number(entry));
    } catch {
      // gone, or not ours
    }
  }
  return pids;
}

/**
 * `roots` and all their descendants (Linux, from /proc/<pid>/stat, readable even for the
 * sandboxed helpers of Chromium whose environment is not).
 */
export function processTree(roots: number[]): number[] {
  const children = new Map<number, number[]>();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'latin1');
      // pid (comm) state ppid …: comm may contain spaces and parentheses.
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const list = children.get(ppid) ?? [];
      list.push(Number(entry));
      children.set(ppid, list);
    } catch {
      // gone
    }
  }
  const seen = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return [...seen];
}

/**
 * Linux processes whose command line has the argument `arg` (Chromium rewrites its process
 * title as one string with spaces: both separators count).
 */
export function pidsWithArg(arg: string): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, 'latin1').split(/[\0 ]/).includes(arg))
        pids.push(Number(entry));
    } catch {
      // gone
    }
  }
  return pids;
}

/**
 * A command-line switch that marks the main process of one test app (Chromium ignores it; an
 * app relaunched by the updater keeps its arguments). Needed because the environment of the
 * packaged app's processes cannot be read (they are not dumpable), only their command line.
 */
export function testRunSwitch(id: string): string {
  return `--monsters-test-run=${id}`;
}

/**
 * The processes of a test app: those carrying `marker` in their environment or `arg` on their
 * command line, and all their children.
 */
export function appProcesses(marker: string, arg?: string): number[] {
  return processTree([...pidsWithEnv(marker), ...(arg ? pidsWithArg(arg) : [])]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * SIGTERM to the app's main processes (`roots`: the app quits and stops its core), then SIGKILL
 * to whatever of their process tree is left; fails if something survives.
 */
export async function stopTree(roots: () => number[], what: string): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const first = processTree(roots());
  const left = () => [...new Set([...first.filter(isAlive), ...processTree(roots())])];
  const signal = (pids: number[], sig: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone
      }
    }
  };
  signal(roots(), 'SIGTERM');
  for (let i = 0; i < 20 && left().length > 0; i++) await sleep(500);
  signal(left(), 'SIGKILL');
  for (let i = 0; i < 10 && left().length > 0; i++) await sleep(200);
  if (left().length > 0) throw new Error(`${what}: processes still running: ${left().join(', ')}`);
}

/** Pids with a connection on the bus at `address` (`busctl list`); null if it cannot be read. */
export function busPeers(address: string | null): Set<number> | null {
  try {
    const out = execFileSync(
      'busctl',
      [...(address ? [`--address=${address}`] : ['--user']), 'list', '--no-legend', '--no-pager'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
    const pids = new Set<number>();
    for (const line of out.split('\n')) {
      const pid = Number(line.trim().split(/\s+/)[1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return pids;
  } catch {
    return null;
  }
}

/** The bus of the person at this PC, as this script found it (before any test session). */
export function userBusAddress(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env['DBUS_SESSION_BUS_ADDRESS']) return env['DBUS_SESSION_BUS_ADDRESS'];
  const uid = process.getuid?.();
  return uid === undefined ? null : `unix:path=/run/user/${uid}/bus`;
}

/**
 * Fails if any of `pids` is connected to the user's session bus. Returns a line for the log
 * (also saying whether the app was seen on the private bus of the test, the proof that it does
 * use D-Bus and that this check would see it).
 */
export function checkNotOnUserBus(
  pids: number[],
  session: Pick<TestSession, 'bus'>,
  userBus: string | null,
): string {
  const user = busPeers(userBus);
  const leaked = user ? pids.filter((p) => user.has(p)) : [];
  if (leaked.length > 0) {
    throw new Error(`the app is on the user's session bus (pids ${leaked.join(', ')})`);
  }
  const own = busPeers(session.bus);
  const onOwn = own ? pids.filter((p) => own.has(p)).length : 0;
  return user
    ? `D-Bus: none of ${pids.length} processes on the user's bus; ${onOwn} on the test bus`
    : `D-Bus: the user's bus cannot be read here (no session); ${onOwn} processes on the test bus`;
}
