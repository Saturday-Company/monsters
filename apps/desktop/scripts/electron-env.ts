import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/*
 * Running the unpacked app from the repo (dev and e2e). Ubuntu 23.10+ forbids unprivileged
 * user namespaces to programs without an AppArmor profile
 * (kernel.apparmor_restrict_unprivileged_userns=1), so Chromium's sandbox needs either that
 * profile or a setuid-root `chrome-sandbox`; neither exists for the Electron of node_modules
 * and Electron aborts. In that case only, the dev launch adds --no-sandbox (the renderer
 * stays without Node and isolated, but loses the OS sandbox). The packages of M3.4 ship an
 * AppArmor profile (deb) like VS Code and Slack do. See D-045.
 */

export function electronBinary(): string {
  return createRequire(import.meta.url)('electron') as string;
}

export function needsNoSandbox(binary: string = electronBinary()): boolean {
  if (process.platform !== 'linux') return false;
  let restricted: boolean;
  try {
    restricted =
      readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1';
  } catch {
    return false;
  }
  if (!restricted) return false;
  try {
    const st = statSync(join(dirname(binary), 'chrome-sandbox'));
    return !(st.uid === 0 && (st.mode & 0o4000) !== 0);
  } catch {
    return true;
  }
}

/** Extra command-line switches for the unpacked app on this machine. */
export function electronArgs(): string[] {
  return needsNoSandbox() ? ['--no-sandbox'] : [];
}
