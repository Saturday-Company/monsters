import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Debugging switches of the packaged app (M3.6, D-049). The fuses turn off Node's --inspect,
 * not Chromium's DevTools protocol: `--remote-debugging-port` or `--remote-debugging-pipe` on a
 * shortcut would hand the window, its session cookies and the cores it is logged in to to
 * whoever listens. Like Chrome 136+, the packaged app accepts them only on throwaway data: a
 * MONSTERS_HOME and a user data folder (MONSTERS_DESKTOP_USER_DATA) that are both not the
 * defaults. That is how the package tests drive the window (install-probe.mjs); a tampered
 * shortcut on the user's real data makes the app quit before anything starts. Node's inspector
 * switches are refused in any case (the fuses already ignore them).
 */

/** Chromium switches that open the DevTools protocol. */
export const REMOTE_DEBUGGING_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'];
/** Node's inspector (also off through the fuses). */
export const INSPECT_SWITCHES = ['inspect', 'inspect-brk', 'inspect-port', 'inspect-brk-node'];

export interface DebugSwitchInput {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** Switches present on the command line (names without dashes). */
  present: readonly string[];
  home: string;
  defaultHome: string;
  userData: string;
  defaultUserData: string;
}

export type DebugSwitchVerdict =
  | { action: 'allow'; debugging: boolean }
  | { action: 'refuse'; switches: string[]; reason: string };

/** The real path when it exists (symlinks resolved), else the absolute path as given. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const ca = canonicalPath(a);
  const cb = canonicalPath(b);
  // macOS and Windows: case-insensitive file systems by default.
  return platform === 'linux' ? ca === cb : ca.toLowerCase() === cb.toLowerCase();
}

export function debugSwitchVerdict(i: DebugSwitchInput): DebugSwitchVerdict {
  const remote = i.present.filter((s) => REMOTE_DEBUGGING_SWITCHES.includes(s));
  const inspect = i.present.filter((s) => INSPECT_SWITCHES.includes(s));
  if (!i.isPackaged) return { action: 'allow', debugging: remote.length > 0 };
  if (inspect.length > 0) {
    return {
      action: 'refuse',
      switches: [...inspect, ...remote],
      reason: "Node's inspector is never available in the packaged app",
    };
  }
  if (remote.length === 0) return { action: 'allow', debugging: false };
  if (samePath(i.home, i.defaultHome, i.platform)) {
    return {
      action: 'refuse',
      switches: remote,
      reason: 'DevTools protocol on the default data directory (MONSTERS_HOME)',
    };
  }
  if (samePath(i.userData, i.defaultUserData, i.platform)) {
    return {
      action: 'refuse',
      switches: remote,
      reason: 'DevTools protocol on the default user data folder (MONSTERS_DESKTOP_USER_DATA)',
    };
  }
  return { action: 'allow', debugging: true };
}

/** Every switch the verdict looks at (to check them with `app.commandLine.hasSwitch`). */
export const DEBUG_SWITCHES = [...REMOTE_DEBUGGING_SWITCHES, ...INSPECT_SWITCHES];
