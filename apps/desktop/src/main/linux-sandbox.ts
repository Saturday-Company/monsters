/*
 * The Chromium sandbox of the AppImage on Linux (M3.4, D-046). Ubuntu 23.10+ forbids user
 * namespaces to programs without an AppArmor profile, and an AppImage cannot have one (it runs
 * from a random mount point) nor a setuid-root chrome-sandbox. electron-builder's AppRun then
 * starts the app with --no-sandbox, silently. The .deb installs a profile and keeps the sandbox.
 *
 * Here the app says it once instead: a dialog explains what is missing and how to get it back
 * (the .deb), the user continues or quits; "Don't show again" is remembered in the user data
 * folder. The log notes it at every start.
 */
import { join } from 'node:path';
import { sandboxNoticeStrings } from './linux-sandbox.strings.ts';

export const SANDBOX_NOTICE_FILE = 'sandbox-notice-accepted';

export interface SandboxFacts {
  platform: NodeJS.Platform;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}

/** True when this is an AppImage running without Chromium's sandbox. */
export function appImageWithoutSandbox(f: SandboxFacts): boolean {
  return f.platform === 'linux' && !!f.env['APPIMAGE'] && f.argv.includes('--no-sandbox');
}

export function sandboxNoticePath(userData: string): string {
  return join(userData, SANDBOX_NOTICE_FILE);
}

/** The dialog's texts, in the app's language. */
export const sandboxNotice = sandboxNoticeStrings;
