/*
 * Automatic updates of the packaged app (M3.4, D-046), on top of electron-updater's generic
 * provider. Checks shortly after start and every 6 hours, downloads in the background and then
 * waits for the user: the tray and the app menu offer "Riavvia per aggiornare". Never forced.
 *
 * Where updates come from: the feed baked in at build time (`app-update.yml` in resources,
 * `pnpm desktop:dist --feed <url>`), or MONSTERS_UPDATE_URL at run time. The channel (alpha,
 * later beta) is the `channel:` of that same file: a build moves its users to another channel
 * by shipping another `app-update.yml`, see `channelFromAppUpdateYml`.
 * Disabled, with one log line, when: not packaged, no feed, a Linux install that is neither an
 * AppImage nor the .deb, MONSTERS_UPDATE=off.
 *
 * The .deb (D-105): electron-updater downloads the new package and checks its sha512; the install
 * asks the computer's password and runs dpkg (deb-install.ts), never on quit, and the core is
 * stopped only once the password was accepted: a refusal leaves the app as it was.
 *
 * Our own signature (S-A4, update-signature.ts): electron-updater reads the feed only through
 * our provider (signed-provider.ts, `feedOptions`), which fetches the channel file and its `.sig`
 * once, checks the signature with the keys in the app and hands electron-updater that signed
 * object. electron-updater does not download by itself (`autoDownload` off): `verify` confirms
 * that what it found is the object the provider verified, and only then the download starts. The
 * downloaded file's own sha512 must be in the signed file too (`hashFile`), or it is thrown away
 * and never installed, not even on quit. No signature, a wrong one or one of another channel:
 * nothing is downloaded, the menu says why (an `invalid` or `mismatch` is tried again once after a
 * minute: a check that fell in the middle of a publication). The .deb's root script checks the
 * signature again.
 *
 * Kept free of Electron imports: the electron-updater object comes in through `backend`, so the
 * logic is tested with a fake (test/updater.test.ts).
 */
import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, posix, win32 } from 'node:path';
import {
  dependencyTrouble,
  describeDebFailure,
  logDebFailure,
  manualInstallCommand,
  REPAIR_COMMAND,
  startDebInstall,
  type DebFailure,
  type DebInstaller,
  type DebUpdate,
} from './deb-install.ts';
import {
  describeRefusal,
  downloadMismatch,
  infoMismatch,
  refusalOf,
  type UpdateInfoLike,
  type VerifiedRelease,
  type VerifyRefusal,
  type VerifyResult,
} from './update-signature.ts';

/** The channel of a build whose `app-update.yml` does not name one. */
export const UPDATE_CHANNEL = 'alpha';
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const FIRST_CHECK_MS = 10_000;
/** After "Riavvia ora" on macOS/Windows: still running after this long means it did not install. */
export const INSTALL_GUARD_MS = 60_000;
/** macOS: how long to wait for Squirrel's own `update-downloaded` after electron-updater's. */
export const NATIVE_WAIT_MS = 60_000;
/** A signature refused as `invalid` or `mismatch`: checked again once after this long. */
export const REFUSAL_RETRY_MS = 60_000;

export type UpdateState =
  | { kind: 'disabled'; reason: string }
  | { kind: 'idle'; checkedAt: number | null }
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string };

interface Logger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message: string): void;
}

/** The part of electron-updater's AppUpdater used here. */
export interface UpdaterBackend {
  channel: string | null;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  logger: Logger | null;
  setFeedURL(options: { provider: 'generic' | 'custom'; url: string; channel?: string }): void;
  checkForUpdates(): Promise<unknown>;
  /** With `autoDownload` off: downloads what the last check found. */
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface UpdateEnvironment {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  resourcesPath: string;
  fileExists: (path: string) => boolean;
  /** A small text file (`package-type`, `app-update.yml`); null when it cannot be read. */
  readText?: (path: string) => string | null;
}

export type UpdateSetup =
  | {
      enabled: true;
      feedOverride: string | null;
      appImage: string | null;
      /** Installed from the .deb (`resources/package-type` says so). */
      deb: boolean;
      /** The feed in use, for the link to download a package by hand (null if unknown). */
      feed: string | null;
      /** The update channel (`alpha*.yml`, `beta*.yml`…): from `app-update.yml`. */
      channel: string;
      /**
       * A build made for the update e2e (`resources/update-test-build`, written by
       * `package.ts --test-build`). Only these honour MONSTERS_UPDATE_URL and
       * MONSTERS_UPDATE_AUTO_INSTALL: the published app ignores them.
       */
      testBuild: boolean;
    }
  | { enabled: false; reason: string };

/** The `url:` of an `app-update.yml` (electron-builder writes it on one line). */
export function feedFromAppUpdateYml(text: string): string | null {
  const m = /^url:\s*['"]?([^'"\s#]+)['"]?\s*$/m.exec(text);
  return m?.[1] ?? null;
}

/**
 * The `channel:` of an `app-update.yml`, or the default (`alpha`). The channel decides which
 * `<channel>*.yml` the app reads from the feed, so a build published with `channel: beta` in its
 * file moves the users who install it from alpha to beta.
 */
export function channelFromAppUpdateYml(text: string | null): string {
  const m = text ? /^channel:\s*['"]?([A-Za-z0-9-]+)['"]?\s*$/m.exec(text) : null;
  return m?.[1] ?? UPDATE_CHANNEL;
}

/**
 * A feed the app may download updates from: https, or plain http on this computer (the update
 * e2e). On Linux nothing but the feed's own sha512 vouches for a downloaded AppImage, so a
 * plain-http feed would let anyone on the network swap the app. `httpHosts` adds hosts for test
 * builds only (the Windows VM reaches the host at 10.0.2.2).
 */
export function isSafeFeedUrl(url: string, httpHosts: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  return ['127.0.0.1', 'localhost', '[::1]', ...httpHosts].includes(u.hostname);
}

/**
 * Whether a link of the update dialog may be opened: https, on the origin of the update feed
 * (a compromised feed could otherwise send the user anywhere with one click).
 */
export function isFeedOrigin(url: string, feed: string | null): boolean {
  if (!feed) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.origin === new URL(feed).origin;
  } catch {
    return false;
  }
}

/** Whether this copy of the app updates itself, and from where. */
export function updateSetup(e: UpdateEnvironment): UpdateSetup {
  const flag = e.env['MONSTERS_UPDATE']?.trim().toLowerCase();
  if (flag === 'off' || flag === '0') {
    return { enabled: false, reason: 'turned off (MONSTERS_UPDATE=off)' };
  }
  if (!e.isPackaged) return { enabled: false, reason: 'not a packaged app (development)' };
  // The separator of the platform described by `e`, not of the one running the tests.
  const path = e.platform === 'win32' ? win32 : posix;
  const read = (name: string) => e.readText?.(path.join(e.resourcesPath, name)) ?? null;
  const appImage = e.platform === 'linux' ? (e.env['APPIMAGE'] ?? null) : null;
  // electron-updater picks its DebUpdater from the same file (written by electron-builder).
  const packageType = e.platform === 'linux' && !appImage ? read('package-type')?.trim() : null;
  const deb = packageType === 'deb';
  if (e.platform === 'linux' && !appImage && !deb) {
    return {
      enabled: false,
      reason: packageType
        ? `installed as a ${packageType} package: only the AppImage and the .deb update themselves`
        : 'neither an AppImage nor the .deb (no package-type in resources)',
    };
  }
  const testBuild = read('update-test-build') !== null;
  // A published app takes its feed only from its own app-update.yml.
  const override = (testBuild ? e.env['MONSTERS_UPDATE_URL']?.trim() : '') || null;
  if (override && !isSafeFeedUrl(override)) {
    return {
      enabled: false,
      reason: 'MONSTERS_UPDATE_URL is not an https URL (plain http only on this computer)',
    };
  }
  if (!override && !e.fileExists(path.join(e.resourcesPath, 'app-update.yml'))) {
    return { enabled: false, reason: 'no update feed in this build' };
  }
  const yml = override ? null : read('app-update.yml');
  const feed = override ?? (yml ? feedFromAppUpdateYml(yml) : null);
  // The channel comes from the build's file even when a test build overrides the feed.
  const channel = channelFromAppUpdateYml(read('app-update.yml'));
  return { enabled: true, feedOverride: override, appImage, deb, feed, channel, testBuild };
}

/** File operations around the AppImage swap (injected in the tests). */
export interface AppImageFiles {
  exists(path: string): boolean;
  /** True if files can be created and removed in `dir`. */
  writableDir(dir: string): boolean;
  /** A hard link (no copy); a copy where hard links are not possible. */
  linkOrCopy(from: string, to: string): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
}

export const systemAppImageFiles: AppImageFiles = {
  exists: existsSync,
  writableDir(dir) {
    try {
      accessSync(dir, constants.W_OK | constants.X_OK);
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  },
  linkOrCopy(from, to) {
    try {
      linkSync(from, to);
    } catch {
      copyFileSync(from, to);
    }
  },
  rename: renameSync,
  unlink: unlinkSync,
};

/**
 * The copy of the running AppImage kept during an update, next to it (a hidden hard link):
 * electron-updater deletes the old file BEFORE moving the new one in (AppImageUpdater.doInstall),
 * so a failed move or start would otherwise leave no app at all. AppImage paths are POSIX.
 */
export function appImageBackupPath(appImage: string): string {
  return posix.join(posix.dirname(appImage), `.${posix.basename(appImage)}.monsters-backup`);
}

/**
 * Starts `execPath` once process `pid` has exited, from /bin/sh: Electron's `app.relaunch` does
 * not work from an AppImage (its relauncher is the app binary inside the AppImage mount, which
 * goes away with the app; tested in update-e2e.ts).
 */
export function spawnAfterExit(execPath: string, args: string[], pid = process.pid): void {
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; shift; exec "$@"',
      'monsters-relaunch',
      String(pid),
      execPath,
      ...args,
    ],
    { detached: true, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  child.unref();
}

/** The update entry of the tray and app menus for a state; null when there is none. */
export function updateMenuEntry(
  state: UpdateState,
): { label: string; enabled: boolean; action: 'check' | 'install' | null } | null {
  switch (state.kind) {
    case 'disabled':
      return null;
    case 'idle':
      return { label: 'Cerca aggiornamenti', enabled: true, action: 'check' };
    case 'checking':
      return { label: 'Cerco aggiornamenti…', enabled: false, action: null };
    case 'downloading':
      return {
        label: `Scarico la versione ${state.version} (${Math.floor(state.percent)}%)`,
        enabled: false,
        action: null,
      };
    case 'ready':
      return {
        label: `Riavvia per aggiornare (versione ${state.version})`,
        enabled: true,
        action: 'install',
      };
    case 'installing':
      return { label: 'Aggiorno…', enabled: false, action: null };
    case 'error':
      return { label: 'Aggiornamento non riuscito: riprova', enabled: true, action: 'check' };
  }
}

/** What a check asked from the menu found: said in a dialog, or nothing seems to happen. */
export type ManualCheckResult =
  { kind: 'latest' } | { kind: 'found'; version: string } | { kind: 'error'; message: string };

/** The dialog after "Cerca aggiornamenti". */
export function manualCheckDialog(
  result: ManualCheckResult,
  currentVersion: string,
): { type: 'info' | 'warning'; message: string; detail: string } {
  switch (result.kind) {
    case 'latest':
      return {
        type: 'info',
        message: 'Monsters è aggiornato',
        detail: `Hai già l’ultima versione (${currentVersion}).`,
      };
    case 'found':
      return {
        type: 'info',
        message: `C’è la versione ${result.version}`,
        detail:
          'La sto scaricando: quando è pronta ti chiedo se riavviare. Intanto puoi continuare a ' +
          'usare Monsters.',
      };
    case 'error':
      return {
        type: 'warning',
        message: 'Non riesco a cercare gli aggiornamenti',
        detail:
          'Controlla di essere collegato a internet e riprova più tardi. ' +
          `Dettaglio: ${result.message}`,
      };
  }
}

/** The notification of a downloaded update; a click asks `updateReadyDialog`. */
export function updateReadyNotice(version: string): { title: string; body: string } {
  return {
    title: 'Aggiornamento pronto',
    body: `Monsters ${version} è pronto: fai clic qui per riavviare e installarlo.`,
  };
}

/**
 * "Riavvia ora" (0, the default) or "Più tardi" (1, also Esc). `password`: the .deb, whose
 * install asks the computer's password (said before it is asked, D-105).
 */
export function updateReadyDialog(
  version: string,
  o: { password?: boolean } = {},
): {
  type: 'info';
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
} {
  const later =
    'Se preferisci, lo trovi anche più tardi nel menu, alla voce «Riavvia per aggiornare».';
  return {
    type: 'info',
    message: `Monsters ${version} è pronto`,
    detail: o.password
      ? 'Ti chiederò la password del computer per installare l’aggiornamento (quella con cui ' +
        'accedi, di un utente che può installare programmi). Poi Monsters si riavvia: ci ' +
        `vogliono pochi secondi. Se annulli, resta tutto com’è. ${later}`
      : `Per installarlo Monsters si riavvia: ci vogliono pochi secondi. ${later}`,
    buttons: ['Riavvia ora', 'Più tardi'],
    defaultId: 0,
    cancelId: 1,
  };
}

/** A .deb update that was not installed: what happened, and how to install it by hand. */
export interface DebFailureReport {
  failure: DebFailure;
  update: DebUpdate;
  currentVersion: string;
  /** false: nothing was stopped, the app keeps running; true: the app restarts after this. */
  restarting: boolean;
}

/** The buttons of `debFailureDialog`. */
export const DEB_FAILURE_BUTTONS = ['Copia il comando', 'Apri il link', 'Chiudi'] as const;

/** The dialog of a .deb update that was not installed (the command is copyable: button 0). */
export function debFailureDialog(r: DebFailureReport): {
  type: 'warning';
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  command: string | null;
} {
  // A package that failed its check is not one to install by hand.
  // dpkg left it unpacked and not configured: `apt install -f` finishes it (and fetches the
  // dependencies); the same package installed with `apt install <file>` would too.
  const half = dependencyTrouble(r.failure);
  const forged = ['signature', 'not-ours', 'not-newer'].includes(r.failure.kind);
  const untrusted = forged || r.failure.kind === 'mismatch';
  const command = half ? REPAIR_COMMAND : untrusted ? null : manualInstallCommand(r.update.file);
  const now = half
    ? 'Monsters si riavvia, ma i file della versione nuova sono già sul disco e il pacchetto non è configurato: finché non lo completi può non partire bene.'
    : r.restarting
      ? 'Monsters si riavvia con la versione che è installata adesso.'
      : `Monsters continua con la versione ${r.currentVersion}.`;
  const how = command
    ? half
      ? `Per completare l’installazione, apri un terminale e scrivi:\n\n${command}\n\n(apt scarica le dipendenze che mancano)`
      : `Per installarlo a mano, apri un terminale e scrivi:\n\n${command}${
          r.failure.kind === 'depends' ? '\n\n(apt scarica da solo le dipendenze che mancano)' : ''
        }`
    : forged
      ? 'Può essere un pacchetto manomesso: non installarlo a mano.'
      : 'Scaricalo di nuovo e installalo a mano.';
  // A package that failed root's signature or identity check: no link to the feed that served it.
  const url = forged ? null : r.update.url;
  const link = url ? `\n\nIl pacchetto si scarica anche da:\n${url}` : '';
  const buttons = [
    ...(command ? [DEB_FAILURE_BUTTONS[0]] : []),
    ...(url ? [DEB_FAILURE_BUTTONS[1]] : []),
    DEB_FAILURE_BUTTONS[2],
  ];
  return {
    type: 'warning',
    message: `Non ho installato Monsters ${r.update.version}`,
    detail: `${describeDebFailure(r.failure)} ${now}\n\n${how}${link}`,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    command,
  };
}

/** The entry of the feed's update info for the downloaded file: its sha512 and its URL. */
export function downloadedDeb(
  info: {
    version: string;
    downloadedFile?: string;
    files?: readonly { url: string; sha512: string }[];
  },
  feed: string | null,
  release: VerifiedRelease | null = null,
): DebUpdate | null {
  const file = info.downloadedFile;
  if (!file || !file.endsWith('.deb')) return null;
  const name = basename(file);
  const entry =
    info.files?.find((f) => basename(decodeURIComponent(f.url.split('?')[0] ?? '')) === name) ??
    null;
  if (!entry) return null;
  let url: string | null = null;
  if (feed) {
    try {
      url = new URL(entry.url, feed.endsWith('/') ? feed : `${feed}/`).href;
    } catch {
      url = null;
    }
  }
  const channel = release
    ? { name: release.channelFile, text: release.text, signature: release.signature }
    : null;
  return { version: info.version, file, sha512: entry.sha512, url, channel };
}

export interface UpdaterOptions {
  setup: UpdateSetup;
  /**
   * The signature of what a check found (update-signature.ts `verifyUpdate`): nothing is
   * downloaded unless it is valid. Tests may answer synchronously.
   */
  verify: (info: UpdateInfoLike) => VerifyResult | Promise<VerifyResult>;
  /**
   * The provider electron-updater must read the feed through (signed-provider.ts): set on start.
   * Without it (tests) a test build's feed override goes to electron-updater's generic provider.
   */
  feedOptions?: { provider: 'custom'; url: string; channel?: string };
  /** The sha512 (base64) of a downloaded file; without it the file itself is not checked. */
  hashFile?: (path: string) => Promise<string>;
  /** A download refused after the fact: remove it, so nothing installs it later. */
  discardDownload?: (path: string) => void;
  /** After a refusal as `invalid` or `mismatch`: the one check again. Default 60 s. */
  refusalRetryMs?: number;
  /** Created only when updates are enabled (electron-updater reads files at construction). */
  backend: () => UpdaterBackend;
  log: (line: string) => void;
  onChange: (state: UpdateState) => void;
  /** Before installing: stop the core, let the app quit. */
  beforeInstall: () => Promise<void>;
  /** Linux AppImage: start the new file once this process has exited. */
  relaunch: (execPath: string) => void;
  /**
   * The install did not happen (the core is already stopped): start the app again. For an
   * AppImage, the file to start once this process exits (the old one, restored if needed), or
   * null when none is left; always null otherwise (the app relaunches itself).
   */
  onInstallFailed: (appImage: string | null) => void;
  /** The .deb is installed: start the new version once this process exits, and quit. */
  restart: () => void;
  /** The .deb: runs the privileged install (tests: a fake). */
  debInstaller?: DebInstaller;
  /**
   * The .deb: the dependencies of the downloaded package this computer lacks, checked before the
   * update is offered (empty: go ahead). Without it nothing is checked.
   */
  debDepends?: (update: DebUpdate) => string[] | Promise<string[]>;
  /**
   * macOS: Electron's own `autoUpdater` (Squirrel.Mac). electron-updater reports a download
   * before Squirrel has staged it: the update is offered only after this one's `update-downloaded`.
   */
  nativeUpdater?: Pick<UpdaterBackend, 'on'>;
  /** How long to wait for `nativeUpdater` before offering the update anyway. Default 60 s. */
  nativeWaitMs?: number;
  /** After "Riavvia ora" (macOS, Windows): still alive after this long = not installed. Default 60 s. */
  installGuardMs?: number;
  /** How long the password prompt of the .deb may stay unanswered. Default 5 minutes. */
  debPasswordTimeoutMs?: number;
  /**
   * The .deb was not installed: tell the user (what happened, the command to do it by hand).
   * Awaited only when the app restarts after it (`restarting`).
   */
  onDebFailed?: (report: DebFailureReport) => Promise<void>;
  /** The running version (the dialogs). */
  currentVersion?: string;
  /** AppImage file operations (tests). */
  files?: AppImageFiles;
  /** The outcome of a check asked from the menu (`check(true)`). */
  onManualResult?: (result: ManualCheckResult) => void;
  /** Tests (and the update e2e): install as soon as the download is done. */
  autoInstall?: boolean;
  intervalMs?: number;
  firstCheckMs?: number;
  now?: () => number;
}

export class Updater {
  private current: UpdateState;
  private backend: UpdaterBackend | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private newAppImage: string | null = null;
  /** The .deb: the downloaded package and its sha512 from the feed. */
  private debUpdate: DebUpdate | null = null;
  private lastPercent = -1;
  private installError: string | null = null;
  /** The app was asked to quit and install (macOS, Windows): an `error` or the guard is a failure. */
  private afterQuit = false;
  private guard: ReturnType<typeof setTimeout> | null = null;
  /** macOS: Squirrel has staged the update (its own `update-downloaded`). */
  private nativeDownloaded = false;
  private awaitingNative: Parameters<typeof downloadedDeb>[0] | null = null;
  private nativeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The version whose missing dependencies were already told (once per version). */
  private dependsTold: string | null = null;
  /** A check asked from the menu is under way: its outcome is told (onManualResult). */
  private manual = false;
  /** The signature of a version found is being checked (no other check meanwhile). */
  private verifying = false;
  /** The last version whose signature checked out: the only one that may be downloaded. */
  private verified: VerifiedRelease | null = null;
  /** Errors already handled (electron-updater emits `error` and rejects the check with it). */
  private handled = new WeakSet<object>();
  /** The one check again after an `invalid` or `mismatch` is scheduled or done. */
  private retried = false;

  private readonly o: UpdaterOptions;

  constructor(options: UpdaterOptions) {
    this.o = options;
    this.current = options.setup.enabled
      ? { kind: 'idle', checkedAt: null }
      : { kind: 'disabled', reason: options.setup.reason };
  }

  get state(): UpdateState {
    return this.current;
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.o.onChange(state);
  }

  start(): void {
    const setup = this.o.setup;
    if (!setup.enabled) {
      this.o.log(`updates: disabled, ${setup.reason}`);
      return;
    }
    // A backup left by an update interrupted earlier (the app runs, so its file exists).
    if (setup.appImage && this.files.exists(setup.appImage)) this.removeBackup(setup.appImage);
    const b = this.o.backend();
    this.backend = b;
    b.logger = {
      info: (m) => this.o.log(`updater: ${String(m)}`),
      warn: (m) => this.o.log(`updater: warning: ${String(m)}`),
      error: (m) => this.o.log(`updater: error: ${String(m)}`),
    };
    // Nothing is downloaded before its signature is checked (see `found`).
    b.autoDownload = false;
    // Setting the channel turns allowDowngrade on: never go back to an older version.
    b.channel = setup.channel;
    b.allowDowngrade = false;
    // An AppImage update renames the file (the version is in its name), the .deb asks the
    // computer's password (and DebUpdater's own install is not used, see deb-install.ts): only
    // when the user asks, never silently on quit. On macOS and Windows a downloaded update is
    // installed when the user quits anyway, as everywhere.
    b.autoInstallOnAppQuit = !setup.appImage && !setup.deb;
    if (this.o.feedOptions) b.setFeedURL(this.o.feedOptions);
    else if (setup.feedOverride) {
      b.setFeedURL({ provider: 'generic', url: setup.feedOverride, channel: setup.channel });
    }
    b.on('checking-for-update', () => {
      if (this.current.kind !== 'downloading' && this.current.kind !== 'ready') {
        this.set({ kind: 'checking' });
      }
    });
    b.on('update-not-available', () => {
      // A feed that went back while an update waits does not take the update away.
      if (this.current.kind === 'ready' || this.current.kind === 'downloading') return;
      this.set({ kind: 'idle', checkedAt: (this.o.now ?? Date.now)() });
      this.tell({ kind: 'latest' });
    });
    b.on('update-available', (info: UpdateInfoLike) => {
      // A check while an update waits (the 6 hours do not stop in `ready`): the same version is
      // already downloaded; only a higher one replaces it.
      if (this.current.kind === 'ready') {
        this.manual = false;
        if (!isNewerVersion(info.version, this.current.version)) return;
      }
      this.found(info);
    });
    b.on('download-progress', (p: { percent: number }) => {
      if (this.current.kind !== 'downloading') return;
      const step = Math.floor(p.percent / 10);
      if (step === this.lastPercent) return;
      this.lastPercent = step;
      this.set({ ...this.current, percent: p.percent });
    });
    const native = this.o.nativeUpdater;
    native?.on('update-downloaded', () => {
      this.nativeDownloaded = true;
      const waiting = this.awaitingNative;
      if (!waiting) return;
      this.awaitingNative = null;
      if (this.nativeTimer) clearTimeout(this.nativeTimer);
      this.downloaded(waiting);
    });
    b.on('update-downloaded', (info: Parameters<typeof downloadedDeb>[0]) => {
      if (native && !this.nativeDownloaded) {
        // electron-updater is done, Squirrel.Mac is not: offering the install now would stop the
        // core for an update that is not staged yet.
        this.o.log(`updates: version ${info.version} downloaded, waiting for the system updater`);
        this.awaitingNative = info;
        this.nativeTimer = setTimeout(() => {
          const waiting = this.awaitingNative;
          if (!waiting) return;
          this.awaitingNative = null;
          this.o.log('updates: the system updater did not answer, offering the update anyway');
          this.downloaded(waiting);
        }, this.o.nativeWaitMs ?? NATIVE_WAIT_MS);
        return;
      }
      this.downloaded(info);
    });
    b.on('appimage-filename-updated', (path: string) => {
      this.newAppImage = path;
    });
    b.on('error', (err: Error) => {
      if (this.refused(err)) return;
      this.o.log(`updates: ${err.message.split('\n')[0]}`);
      if (this.current.kind === 'installing') {
        // Squirrel (macOS) reports its failures after `quitAndInstall` returned.
        if (this.afterQuit) this.installFailedLate(err.message);
        else this.installError = err.message;
      } else if (this.current.kind !== 'ready') {
        const message = err.message.split('\n')[0] ?? 'error';
        this.set({ kind: 'error', message });
        this.tell({ kind: 'error', message });
      }
    });

    this.o.log(
      `updates: on, channel ${setup.channel}${setup.feedOverride ? `, feed ${setup.feedOverride}` : ''}`,
    );
    this.timers.push(setTimeout(() => this.check(), this.o.firstCheckMs ?? FIRST_CHECK_MS));
    this.timers.push(setInterval(() => this.check(), this.o.intervalMs ?? CHECK_EVERY_MS));
  }

  /**
   * A check now (timer, or `manual` from the menu: its outcome is told). Nothing while a
   * download is running; while an update waits (`ready`) it goes on, so a higher version
   * replaces the one waiting (a defective alpha gets its fix).
   */
  check(manual = false): void {
    const b = this.backend;
    if (!b) return;
    if (manual) this.manual = true;
    if (this.current.kind === 'checking') return;
    if (this.verifying || ['downloading', 'installing'].includes(this.current.kind)) {
      this.manual = false;
      return;
    }
    b.checkForUpdates().catch((err: Error) => {
      if (this.refused(err)) return;
      const message = err.message.split('\n')[0] ?? 'error';
      this.o.log(`updates: check failed: ${message}`);
      this.set({ kind: 'error', message });
      this.tell({ kind: 'error', message });
    });
  }

  /** A version found: its signature first, then the download. */
  private found(info: UpdateInfoLike): void {
    const b = this.backend;
    if (!b) return;
    this.verifying = true;
    const done = (r: VerifyResult) => {
      this.verifying = false;
      if (!r.ok) {
        this.refusal(info.version, r.reason, r.detail);
        return;
      }
      this.retried = false;
      this.verified = r.release;
      const waiting = this.current.kind === 'ready' ? this.current.version : null;
      this.o.log(
        `updates: version ${info.version} signed (key ${r.release.keyId}), ` +
          (waiting ? `replaces ${waiting}, which was waiting` : 'downloading'),
      );
      this.tell({ kind: 'found', version: info.version });
      this.lastPercent = -1;
      this.nativeDownloaded = false;
      this.set({ kind: 'downloading', version: info.version, percent: 0 });
      // A failure comes as an `error` event too.
      b.downloadUpdate().catch(() => {});
    };
    let result: VerifyResult | Promise<VerifyResult>;
    try {
      result = this.o.verify(info);
    } catch (err) {
      result = { ok: false, reason: 'fetch', detail: (err as Error).message };
    }
    if (result instanceof Promise) {
      void result.then(done, (err: Error) =>
        done({ ok: false, reason: 'fetch', detail: err.message }),
      );
    } else done(result);
  }

  /**
   * A check our signature refused (the provider threw it): said like the refusals of `found`.
   * True when `err` is one (and is handled once, whether it comes as `error` or as the rejection).
   */
  private refused(err: unknown): boolean {
    const r = refusalOf(err);
    if (!r) return false;
    if (!this.handled.has(r)) {
      this.handled.add(r);
      this.refusal(r.version, r.reason, r.detail);
    }
    return true;
  }

  /** Nothing downloaded: the log and the menu say why; `invalid`/`mismatch` tried again once. */
  private refusal(version: string | null, reason: VerifyRefusal, detail: string): void {
    const message = describeRefusal(version, reason);
    this.o.log(`updates: version ${version ?? '?'} refused: ${reason} (${detail})`);
    // An update already waiting (verified earlier) stays; otherwise the menu says why.
    if (this.current.kind !== 'ready') {
      this.set({ kind: 'error', message });
      this.tell({ kind: 'error', message });
    }
    // A check in the middle of a publication can see the new file with the old signature (or
    // the other way round): one more check a minute later, not six hours of a scary message.
    if ((reason === 'invalid' || reason === 'mismatch') && !this.retried) {
      this.retried = true;
      const t = setTimeout(() => this.check(), this.o.refusalRetryMs ?? REFUSAL_RETRY_MS);
      this.timers.push(t);
    }
  }

  /** The outcome of a check asked from the menu, once. */
  private tell(result: ManualCheckResult): void {
    if (!this.manual) return;
    this.manual = false;
    this.o.onManualResult?.(result);
  }

  /** The download is complete (and, on macOS, staged): offer it to the user. */
  private downloaded(info: Parameters<typeof downloadedDeb>[0]): void {
    if (this.current.kind === 'ready' && this.current.version === info.version) return;
    // Only what was verified: anything else (it should not happen, the download starts after the
    // check) is not offered.
    const release = this.verified;
    const mismatch = release
      ? infoMismatch(info, release.signed)
      : `version ${info.version} was never verified`;
    if (mismatch) {
      this.notOffered(info, mismatch);
      return;
    }
    const file = info.downloadedFile;
    const hash = this.o.hashFile;
    if (!hash || !release) {
      this.offerDownloaded(info, release);
      return;
    }
    if (!file) {
      this.notOffered(info, 'no downloaded file to check');
      return;
    }
    void hash(file).then(
      (sha512) => {
        const wrong = downloadMismatch(file, sha512, release.signed);
        if (wrong) this.notOffered(info, wrong);
        else this.offerDownloaded(info, release);
      },
      (err: Error) => this.notOffered(info, `cannot read ${file}: ${err.message}`),
    );
  }

  /**
   * A download that is not what was verified: never offered, never installed on quit (macOS and
   * Windows install a downloaded update when the app quits), and the file is removed.
   */
  private notOffered(info: Parameters<typeof downloadedDeb>[0], why: string): void {
    const message = describeRefusal(info.version, 'mismatch');
    this.o.log(`updates: version ${info.version} downloaded but not offered: ${why}`);
    if (this.backend) this.backend.autoInstallOnAppQuit = false;
    if (info.downloadedFile) {
      try {
        this.o.discardDownload?.(info.downloadedFile);
      } catch (err) {
        this.o.log(`updates: cannot remove ${info.downloadedFile}: ${(err as Error).message}`);
      }
    }
    this.set({ kind: 'error', message });
  }

  /** A verified download: offered to the user (the .deb: once its dependencies are there). */
  private offerDownloaded(
    info: Parameters<typeof downloadedDeb>[0],
    release: VerifiedRelease | null,
  ): void {
    const setup = this.o.setup;
    // Back to the default after a download that was refused (see `start`).
    if (this.backend && setup.enabled) {
      this.backend.autoInstallOnAppQuit = !setup.appImage && !setup.deb;
    }
    if (setup.enabled && setup.deb) {
      this.debUpdate = downloadedDeb(info, setup.feed, release);
      if (!this.debUpdate) {
        this.o.log(`updates: version ${info.version} downloaded, but no .deb in the update info`);
      }
    }
    const offer = (missing: string[]) => {
      const update = this.debUpdate;
      if (update && missing.length > 0) {
        this.dependsMissing(update, missing);
        return;
      }
      this.o.log(`updates: version ${info.version} ready, waiting for the user`);
      this.set({ kind: 'ready', version: info.version });
      if (this.o.autoInstall) void this.install();
    };
    const found =
      this.debUpdate && this.o.debDepends ? this.o.debDepends(this.debUpdate) : undefined;
    if (found instanceof Promise) void found.then(offer, () => offer([]));
    else offer(found ?? []);
  }

  /** The package needs what this computer lacks: not offered, said once per version. */
  private dependsMissing(update: DebUpdate, missing: string[]): void {
    const failure: DebFailure = { kind: 'depends', missing };
    this.o.log(
      `updates: version ${update.version} not offered (${logDebFailure(failure)}); ` +
        `by hand: ${manualInstallCommand(update.file)}`,
    );
    this.set({ kind: 'error', message: describeDebFailure(failure) });
    if (this.dependsTold === update.version) return;
    this.dependsTold = update.version;
    void this.o.onDebFailed?.({
      failure,
      update,
      currentVersion: this.o.currentVersion ?? 'attuale',
      restarting: false,
    });
  }

  /** `error` or the guard after "Riavvia ora" (macOS, Windows): it did not install, start again. */
  private installFailedLate(message: string): void {
    if (!this.afterQuit) return;
    this.afterQuit = false;
    if (this.guard) clearTimeout(this.guard);
    this.guard = null;
    this.o.log('updates: install failed after quitting, restarting the current version');
    this.set({ kind: 'error', message: message.split('\n')[0] ?? 'error' });
    this.o.onInstallFailed(null);
  }

  private get files(): AppImageFiles {
    return this.o.files ?? systemAppImageFiles;
  }

  /**
   * "Riavvia per aggiornare": stop the core, install, start the new version. `refused`: nothing
   * was touched (e.g. the AppImage's folder is not writable) and the app keeps running;
   * `failed`: the install did not happen and the app starts again (`onInstallFailed`).
   */
  async install(): Promise<'started' | 'refused' | 'failed' | 'none'> {
    const b = this.backend;
    if (!b || this.current.kind !== 'ready') return 'none';
    const version = this.current.version;
    if (this.o.setup.enabled && this.o.setup.deb) return this.installDeb(version);
    const appImage = this.o.setup.enabled ? this.o.setup.appImage : null;
    if (appImage) {
      const refusal = this.appImagePreflight(appImage);
      if (refusal) {
        this.o.log(`updates: not installing version ${version}: ${refusal}`);
        this.set({ kind: 'error', message: refusal });
        return 'refused';
      }
    }
    this.set({ kind: 'installing', version });
    this.o.log(`updates: installing version ${version} and restarting`);
    this.stop();
    await this.o.beforeInstall();
    this.installError = null;
    if (appImage) {
      // electron-updater would start the new AppImage while this one still runs (and holds the
      // single-instance lock): replace the file now, start it after this process exits.
      b.autoRunAppAfterInstall = false;
      b.quitAndInstall(true, false);
      if (!this.failedInstall()) {
        this.removeBackup(appImage);
        this.o.relaunch(this.newAppImage ?? appImage);
        return 'started';
      }
    } else {
      b.quitAndInstall(false, true);
    }
    // electron-updater reports a failed install through `error`, synchronously...
    const failure = this.failedInstall();
    if (!failure) {
      if (!appImage) {
        // ...or, on macOS, later: Squirrel fails after this returned. Nothing quit within the
        // guard time either means the same.
        this.afterQuit = true;
        this.guard = setTimeout(
          () => this.installFailedLate('L’installazione non è partita: riprova.'),
          this.o.installGuardMs ?? INSTALL_GUARD_MS,
        );
        this.guard.unref();
      }
      return 'started';
    }
    this.o.log(`updates: install failed, restarting the current version`);
    this.set({ kind: 'error', message: failure.split('\n')[0] ?? 'error' });
    this.o.onInstallFailed(appImage ? this.restoreAppImage(appImage) : null);
    return 'failed';
  }

  /**
   * The .deb: the password first (root checks its own copy of the package and waits), then the
   * core stops and dpkg runs, then the new version starts. Refused, cancelled or no agent:
   * nothing was stopped, the app keeps running and the update stays ready (`refused`).
   */
  private async installDeb(version: string): Promise<'started' | 'refused' | 'failed'> {
    const update = this.debUpdate;
    if (!update || update.version !== version) {
      const message = 'non trovo il pacchetto scaricato: riprova a cercare gli aggiornamenti';
      this.o.log(`updates: not installing version ${version}: no downloaded .deb`);
      this.set({ kind: 'error', message });
      return 'refused';
    }
    const current = this.o.currentVersion ?? 'attuale';
    this.set({ kind: 'installing', version });
    this.o.log(`updates: asking the computer's password to install ${update.file}`);
    const run = (this.o.debInstaller ?? startDebInstall)(update);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<DebFailure>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: 'timeout' }),
        this.o.debPasswordTimeoutMs ?? 300_000,
      );
    });
    const refusal = await Promise.race([run.ready, timedOut]);
    clearTimeout(timer);
    if (refusal?.kind === 'timeout') run.cancel();
    if (refusal) {
      this.o.log(
        `updates: version ${version} not installed (${logDebFailure(refusal)}), ` +
          `still running ${current}; by hand: ${manualInstallCommand(update.file)}`,
      );
      // Ready again: "Riavvia per aggiornare" stays in the menu to try again.
      this.set({ kind: 'ready', version });
      void this.o.onDebFailed?.({
        failure: refusal,
        update,
        currentVersion: current,
        restarting: false,
      });
      return 'refused';
    }
    // Root holds a checked copy and waits: only now the core stops (dpkg replaces its files).
    this.o.log('updates: password accepted, stopping the core before dpkg');
    this.stop();
    await this.o.beforeInstall();
    this.o.log(`updates: installing version ${version} with dpkg`);
    const failure = await run.go();
    if (!failure) {
      this.o.log(`updates: version ${version} installed, restarting`);
      this.o.restart();
      return 'started';
    }
    this.o.log(
      `updates: install failed (${logDebFailure(failure)}), restarting the installed version; ` +
        `by hand: ${manualInstallCommand(update.file)}`,
    );
    this.set({ kind: 'error', message: describeDebFailure(failure) });
    await this.o.onDebFailed?.({ failure, update, currentVersion: current, restarting: true });
    this.o.onInstallFailed(null);
    return 'failed';
  }

  /** Why the AppImage cannot be swapped safely (null: go ahead, with a backup kept). */
  private appImagePreflight(appImage: string): string | null {
    const files = this.files;
    const dir = posix.dirname(appImage);
    if (!files.exists(appImage)) return `il file dell'app non c'è più (${appImage})`;
    if (!files.writableDir(dir)) {
      return `la cartella ${dir} non è scrivibile: scarica la nuova versione e sostituisci il file a mano`;
    }
    const backup = appImageBackupPath(appImage);
    try {
      if (files.exists(backup)) files.unlink(backup);
      files.linkOrCopy(appImage, backup);
    } catch (err) {
      return `non riesco a tenere una copia dell'app nella sua cartella (${(err as Error).message})`;
    }
    return null;
  }

  /** After a failed install: the old AppImage back in place; the file to start, if any. */
  private restoreAppImage(appImage: string): string | null {
    const files = this.files;
    const backup = appImageBackupPath(appImage);
    try {
      if (!files.exists(appImage) && files.exists(backup)) {
        files.rename(backup, appImage);
        this.o.log('updates: the previous AppImage restored from its backup');
      }
    } catch (err) {
      this.o.log(`updates: cannot restore the previous AppImage: ${(err as Error).message}`);
    }
    if (files.exists(appImage)) {
      this.removeBackup(appImage);
      return appImage;
    }
    if (this.newAppImage && files.exists(this.newAppImage)) return this.newAppImage;
    if (files.exists(backup)) return backup;
    this.o.log('updates: no AppImage left to start');
    return null;
  }

  private removeBackup(appImage: string): void {
    try {
      const backup = appImageBackupPath(appImage);
      if (this.files.exists(backup)) this.files.unlink(backup);
    } catch {
      // a hidden leftover, removed at the next start
    }
  }

  private failedInstall(): string | null {
    return this.installError;
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.nativeTimer) clearTimeout(this.nativeTimer);
  }
}

/** Whether `a` is a higher version than `b` (semver, with the prerelease: 0.1.0-alpha.2 > .1). */
export function isNewerVersion(a: string, b: string): boolean {
  const split = (v: string) => {
    const [core = '', pre] = v.replace(/^v/, '').split(/\+/)[0]!.split(/-(.*)/s);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  // Same numbers: a release is higher than its prereleases.
  if (x.pre === null || y.pre === null) return x.pre === null && y.pre !== null;
  const p = x.pre.split('.');
  const q = y.pre.split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    const l = p[i];
    const r = q[i];
    if (l === undefined || r === undefined) return l !== undefined;
    if (l === r) continue;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    if (ln && rn) return Number(l) > Number(r);
    if (ln !== rn) return rn;
    return l > r;
  }
  return false;
}
