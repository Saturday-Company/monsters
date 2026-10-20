import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { appImageWithoutSandbox } from '../src/main/linux-sandbox.ts';
import { UpdateRefusedError } from '../src/main/update-signature.ts';
import type { DebFailure, DebInstaller, DebUpdate } from '../src/main/deb-install.ts';
import {
  appImageBackupPath,
  channelFromAppUpdateYml,
  isNewerVersion,
  debFailureDialog,
  downloadedDeb,
  feedFromAppUpdateYml,
  isFeedOrigin,
  isSafeFeedUrl,
  manualCheckDialog,
  Updater,
  updateMenuEntry,
  updateReadyDialog,
  updateSetup,
  type AppImageFiles,
  type DebFailureReport,
  type ManualCheckResult,
  type UpdateEnvironment,
  type UpdaterBackend,
  type UpdateState,
  type UpdaterOptions,
} from '../src/main/updater.ts';

/** The files of an AppImage folder, in memory. */
class FakeFiles implements AppImageFiles {
  readonly files = new Set<string>();
  readonly readOnly = new Set<string>();
  exists(path: string): boolean {
    return this.files.has(path);
  }
  writableDir(dir: string): boolean {
    return !this.readOnly.has(dir);
  }
  linkOrCopy(from: string, to: string): void {
    if (!this.files.has(from)) throw new Error(`ENOENT ${from}`);
    this.files.add(to);
  }
  rename(from: string, to: string): void {
    if (!this.files.delete(from)) throw new Error(`ENOENT ${from}`);
    this.files.add(to);
  }
  unlink(path: string): void {
    if (!this.files.delete(path)) throw new Error(`ENOENT ${path}`);
  }
}

const OLD = '/home/u/Apps/Monsters-0.0.1-linux-x86_64.AppImage';
const NEW = '/home/u/Apps/Monsters-0.0.2-linux-x86_64.AppImage';
const appImageSetup = () => updateSetup({ ...packaged, platform: 'linux', env: { APPIMAGE: OLD } });

/** The marker file that `package.ts --test-build` ships (resources/update-test-build). */
const withTestMarker = (base: UpdateEnvironment): UpdateEnvironment => {
  const inner = base.readText;
  return {
    ...base,
    readText: (p) => (p.endsWith('/update-test-build') ? 'x\n' : (inner?.(p) ?? null)),
  };
};

const packaged: UpdateEnvironment = {
  isPackaged: true,
  platform: 'darwin',
  env: {},
  resourcesPath: '/app/Resources',
  fileExists: (p) => p === '/app/Resources/app-update.yml',
};

/** /opt/Monsters/resources of the .deb, as electron-builder writes it. */
const APP_UPDATE_YML =
  'provider: generic\nurl: https://updates.example.com/desktop/\nchannel: alpha\n' +
  'updaterCacheDirName: monsters-updater\n';
const debResources =
  (packageType = 'deb\n') =>
  (p: string): string | null =>
    p === '/opt/Monsters/resources/package-type'
      ? packageType
      : p === '/opt/Monsters/resources/app-update.yml'
        ? APP_UPDATE_YML
        : null;
const debEnv: UpdateEnvironment = {
  isPackaged: true,
  platform: 'linux',
  env: {},
  resourcesPath: '/opt/Monsters/resources',
  fileExists: (p) => p === '/opt/Monsters/resources/app-update.yml',
  readText: debResources(),
};
const debSetup = () => updateSetup(debEnv);
const PENDING = '/home/u/.cache/monsters-updater/pending/Monsters-0.0.2-linux-amd64.deb';
/** What electron-updater's DebUpdater emits with `update-downloaded` (alpha-linux.yml). */
const DEB_DOWNLOADED = {
  version: '0.0.2',
  downloadedFile: PENDING,
  files: [
    { url: 'Monsters-0.0.2-linux-x86_64.AppImage', sha512: 'appimage-sha', size: 1 },
    { url: 'Monsters-0.0.2-linux-amd64.deb', sha512: 'deb-sha', size: 2 },
  ],
};

/** A privileged install that answers as told, and says what was asked of it. */
function fakeDebInstaller(
  calls: string[],
  outcome: { ready?: DebFailure | null; go?: DebFailure | null; hang?: boolean } = {},
): { installer: DebInstaller; asked: DebUpdate[] } {
  const asked: DebUpdate[] = [];
  const installer: DebInstaller = (update) => {
    asked.push(update);
    calls.push('password asked');
    return {
      ready: outcome.hang ? new Promise(() => {}) : Promise.resolve(outcome.ready ?? null),
      go: () => {
        calls.push('dpkg');
        return Promise.resolve(outcome.go ?? null);
      },
      cancel: () => calls.push('cancel'),
    };
  };
  return { installer, asked };
}

class FakeBackend extends EventEmitter implements UpdaterBackend {
  channel: string | null = null;
  allowDowngrade = false;
  autoDownload = false;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = true;
  logger: UpdaterBackend['logger'] = null;
  feed: unknown = null;
  checks = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  failInstall = false;
  /** AppImage: what electron-updater's doInstall does to the folder (old file deleted first). */
  folder: FakeFiles | null = null;
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  setFeedURL(options: unknown): void {
    this.feed = options;
  }
  /** What the next checks throw (the signed provider refusing the feed), as electron-updater does. */
  checkError: Error | null = null;
  checkForUpdates(): Promise<unknown> {
    this.checks++;
    this.emit('checking-for-update');
    const err = this.checkError;
    if (err) {
      // AppUpdater.checkForUpdates: `error` first, then the rejection.
      this.emit('error', err);
      return Promise.reject(err);
    }
    return Promise.resolve(null);
  }
  downloads = 0;
  downloadUpdate(): Promise<unknown> {
    this.downloads++;
    return Promise.resolve([]);
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
    // AppImageUpdater.doInstall: unlink the running file, then move the new one in.
    this.folder?.unlink(OLD);
    if (this.failInstall) {
      this.emit('error', new Error('No valid update available'));
      return;
    }
    this.folder?.files.add(NEW);
    this.emit('appimage-filename-updated', NEW);
  }
}

/** A feed whose signature checks out for whatever is found (the signature has tests of its own). */
const acceptAll: UpdaterOptions['verify'] = (info) => ({
  ok: true,
  release: {
    version: info.version,
    channelFile: 'alpha-linux.yml',
    text: 'signed channel file\n',
    signature: 'monsters-update-signature-v1\nkey 0123456789abcdef x\n',
    keyId: '0123456789abcdef',
    signed: {
      version: info.version,
      files: [
        ...(info.files ?? []).map((f) => ({ url: f.url, sha512: f.sha512 ?? '' })),
        ...DEB_DOWNLOADED.files,
      ],
    },
  },
});

function makeUpdater(
  setup = updateSetup(packaged),
  extra: {
    autoInstall?: boolean;
    files?: FakeFiles;
    onManualResult?: (r: ManualCheckResult) => void;
    debPasswordTimeoutMs?: number;
    /** The .deb: what the password and dpkg answer. */
    deb?: { ready?: DebFailure | null; go?: DebFailure | null; hang?: boolean };
    nativeUpdater?: UpdaterOptions['nativeUpdater'];
    nativeWaitMs?: number;
    installGuardMs?: number;
    firstCheckMs?: number;
    debDepends?: UpdaterOptions['debDepends'];
    verify?: UpdaterOptions['verify'];
    feedOptions?: UpdaterOptions['feedOptions'];
    hashFile?: UpdaterOptions['hashFile'];
    discardDownload?: UpdaterOptions['discardDownload'];
    refusalRetryMs?: number;
  } = {},
) {
  const backend = new FakeBackend();
  backend.folder = extra.files ?? null;
  const states: UpdateState[] = [];
  const log: string[] = [];
  const calls: string[] = [];
  const reports: DebFailureReport[] = [];
  const { deb, ...options } = extra;
  const fake = fakeDebInstaller(calls, deb);
  const updater = new Updater({
    setup,
    verify: acceptAll,
    backend: () => backend,
    log: (l) => log.push(l),
    onChange: (s) => states.push(s),
    beforeInstall: () => {
      calls.push('beforeInstall');
      return Promise.resolve();
    },
    relaunch: (p) => calls.push(`relaunch ${p}`),
    onInstallFailed: (p) => calls.push(`failed, start ${p}`),
    restart: () => calls.push('restart'),
    onDebFailed: (r) => {
      calls.push(`told ${r.failure.kind}${r.restarting ? ', restarting' : ''}`);
      reports.push(r);
      return Promise.resolve();
    },
    currentVersion: '0.0.1',
    debInstaller: fake.installer,
    firstCheckMs: 10,
    intervalMs: 1000,
    ...options,
  });
  return { updater, backend, states, log, calls, reports, asked: fake.asked };
}

/** An AppImage folder with the running 0.0.1 in it. */
function appImageFolder(): FakeFiles {
  const files = new FakeFiles();
  files.files.add(OLD);
  return files;
}

describe('update setup', () => {
  it('is on for a packaged app with a feed', () => {
    expect(updateSetup(packaged)).toEqual({
      enabled: true,
      feedOverride: null,
      appImage: null,
      deb: false,
      feed: null,
      channel: 'alpha',
      testBuild: false,
    });
  });

  it('says why it is off', () => {
    expect(updateSetup({ ...packaged, isPackaged: false })).toMatchObject({ enabled: false });
    expect(updateSetup({ ...packaged, fileExists: () => false })).toEqual({
      enabled: false,
      reason: 'no update feed in this build',
    });
    expect(updateSetup({ ...packaged, env: { MONSTERS_UPDATE: 'off' } })).toMatchObject({
      enabled: false,
    });
    // Linux: the AppImage and the .deb update themselves; anything else does not.
    expect(updateSetup({ ...packaged, platform: 'linux' })).toEqual({
      enabled: false,
      reason: 'neither an AppImage nor the .deb (no package-type in resources)',
    });
    expect(updateSetup({ ...debEnv, readText: debResources('rpm\n') })).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('rpm') as string,
    });
    expect(
      updateSetup(
        withTestMarker({ ...packaged, env: { MONSTERS_UPDATE_URL: 'file:///etc/passwd' } }),
      ),
    ).toMatchObject({ enabled: false });
  });

  it('is on for the .deb (package-type), with the feed of app-update.yml', () => {
    expect(debSetup()).toEqual({
      enabled: true,
      feedOverride: null,
      appImage: null,
      deb: true,
      feed: 'https://updates.example.com/desktop/',
      channel: 'alpha',
      testBuild: false,
    });
    // The .deb without a feed in the build, or turned off: off as everywhere.
    expect(updateSetup({ ...debEnv, fileExists: () => false })).toEqual({
      enabled: false,
      reason: 'no update feed in this build',
    });
    expect(updateSetup({ ...debEnv, env: { MONSTERS_UPDATE: 'off' } })).toMatchObject({
      enabled: false,
    });
    // MONSTERS_UPDATE_URL: the same https rule, and it is the feed of the links.
    expect(
      updateSetup(
        withTestMarker({
          ...debEnv,
          env: { MONSTERS_UPDATE_URL: 'http://updates.example.com/' },
        }),
      ),
    ).toMatchObject({ enabled: false });
    expect(
      updateSetup(
        withTestMarker({ ...debEnv, env: { MONSTERS_UPDATE_URL: 'http://127.0.0.1:9/feed/' } }),
      ),
    ).toMatchObject({ enabled: true, deb: true, feed: 'http://127.0.0.1:9/feed/' });
    // An AppImage is an AppImage, whatever its resources say.
    expect(updateSetup({ ...debEnv, env: { APPIMAGE: OLD } })).toMatchObject({
      appImage: OLD,
      deb: false,
    });
  });

  it('reads the feed of app-update.yml', () => {
    expect(feedFromAppUpdateYml(APP_UPDATE_YML)).toBe('https://updates.example.com/desktop/');
    expect(feedFromAppUpdateYml("url: 'https://x.example/a/'\n")).toBe('https://x.example/a/');
    expect(feedFromAppUpdateYml('provider: generic\n')).toBeNull();
  });

  it('takes the feed from MONSTERS_UPDATE_URL and knows the AppImage', () => {
    expect(
      updateSetup(
        withTestMarker({
          ...packaged,
          platform: 'linux',
          fileExists: () => false,
          env: { APPIMAGE: '/home/u/M.AppImage', MONSTERS_UPDATE_URL: 'http://127.0.0.1:9/feed' },
        }),
      ),
    ).toEqual({
      enabled: true,
      feedOverride: 'http://127.0.0.1:9/feed',
      appImage: '/home/u/M.AppImage',
      deb: false,
      feed: 'http://127.0.0.1:9/feed',
      channel: 'alpha',
      testBuild: true,
    });
  });

  it('a published build ignores MONSTERS_UPDATE_URL (no test marker)', () => {
    expect(
      updateSetup({ ...debEnv, env: { MONSTERS_UPDATE_URL: 'https://evil.example.com/feed/' } }),
    ).toMatchObject({
      enabled: true,
      feedOverride: null,
      feed: 'https://updates.example.com/desktop/',
    });
    expect(
      updateSetup({ ...packaged, env: { MONSTERS_UPDATE_URL: 'https://evil.example.com/' } }),
    ).toMatchObject({ enabled: true, feedOverride: null, testBuild: false });
  });

  it('opens dialog links only on https and the origin of the feed', () => {
    const feed = 'https://updates.example.com/desktop/';
    expect(isFeedOrigin('https://updates.example.com/desktop/M.deb', feed)).toBe(true);
    expect(isFeedOrigin('https://evil.example.com/M.deb', feed)).toBe(false);
    expect(isFeedOrigin('http://updates.example.com/M.deb', feed)).toBe(false);
    expect(isFeedOrigin('file:///etc/passwd', feed)).toBe(false);
    expect(isFeedOrigin('https://updates.example.com/M.deb', null)).toBe(false);
  });
});

describe('feed URL', () => {
  it('takes https anywhere and plain http only on this computer', () => {
    expect(isSafeFeedUrl('https://updates.example.com/monsters/')).toBe(true);
    expect(isSafeFeedUrl('http://127.0.0.1:8080/')).toBe(true);
    expect(isSafeFeedUrl('http://localhost/feed')).toBe(true);
    expect(isSafeFeedUrl('http://[::1]:9/')).toBe(true);
    expect(isSafeFeedUrl('http://updates.example.com/')).toBe(false);
    expect(isSafeFeedUrl('http://10.0.2.2:9/')).toBe(false);
    expect(isSafeFeedUrl('http://10.0.2.2:9/', ['10.0.2.2'])).toBe(true);
    expect(isSafeFeedUrl('https://user:pw@updates.example.com/')).toBe(false);
    expect(isSafeFeedUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeFeedUrl('not a url')).toBe(false);
  });

  it('refuses a plain-http MONSTERS_UPDATE_URL on the network', () => {
    expect(
      updateSetup(
        withTestMarker({
          ...packaged,
          env: { MONSTERS_UPDATE_URL: 'http://updates.example.com/' },
        }),
      ),
    ).toMatchObject({ enabled: false, reason: expect.stringContaining('https') as string });
  });
});

describe('menu entry', () => {
  it('follows the state', () => {
    expect(updateMenuEntry({ kind: 'disabled', reason: 'x' })).toBeNull();
    expect(updateMenuEntry({ kind: 'idle', checkedAt: null })).toMatchObject({ action: 'check' });
    expect(updateMenuEntry({ kind: 'downloading', version: '0.0.2', percent: 42.7 })).toEqual({
      label: 'Scarico la versione 0.0.2 (42%)',
      enabled: false,
      action: null,
    });
    expect(updateMenuEntry({ kind: 'ready', version: '0.0.2' })).toEqual({
      label: 'Riavvia per aggiornare (versione 0.0.2)',
      enabled: true,
      action: 'install',
    });
  });
});

describe('Updater', () => {
  it('logs once and does nothing when disabled', () => {
    const backend = vi.fn();
    const log: string[] = [];
    const u = new Updater({
      setup: { enabled: false, reason: 'no update feed in this build' },
      verify: acceptAll,
      backend,
      log: (l) => log.push(l),
      onChange: () => {},
      beforeInstall: () => Promise.resolve(),
      relaunch: () => {},
      onInstallFailed: () => {},
      restart: () => {},
    });
    u.start();
    u.check();
    expect(backend).not.toHaveBeenCalled();
    expect(log).toEqual(['updates: disabled, no update feed in this build']);
    expect(u.state.kind).toBe('disabled');
  });

  it('sets the channel without allowing downgrades and checks after start and on a timer', async () => {
    vi.useFakeTimers();
    try {
      const { updater, backend } = makeUpdater();
      updater.start();
      expect(backend.channel).toBe('alpha');
      expect(backend.allowDowngrade).toBe(false);
      // Never downloads by itself: the signature first.
      expect(backend.autoDownload).toBe(false);
      expect(backend.autoInstallOnAppQuit).toBe(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(backend.checks).toBe(1);
      backend.emit('update-not-available', {});
      await vi.advanceTimersByTimeAsync(1000);
      expect(backend.checks).toBe(2);
      updater.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(backend.checks).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells the outcome of a check from the menu, and only of that one', () => {
    const told: ManualCheckResult[] = [];
    const { updater, backend } = makeUpdater(undefined, { onManualResult: (r) => told.push(r) });
    updater.start();
    // The timer's check says nothing.
    updater.check();
    backend.emit('update-not-available', {});
    expect(told).toEqual([]);
    updater.check(true);
    backend.emit('update-not-available', {});
    expect(told).toEqual([{ kind: 'latest' }]);
    updater.check(true);
    backend.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED\nstack'));
    expect(told.at(-1)).toEqual({ kind: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
    updater.check(true);
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(told.at(-1)).toEqual({ kind: 'found', version: '0.0.2' });
    expect(told).toHaveLength(3);
    updater.stop();
  });

  it('words the dialog after "Cerca aggiornamenti"', () => {
    expect(manualCheckDialog({ kind: 'latest' }, '0.1.0-alpha.3')).toMatchObject({
      message: 'Monsters è aggiornato',
      detail: 'Hai già l’ultima versione (0.1.0-alpha.3).',
    });
    expect(manualCheckDialog({ kind: 'found', version: '0.2.0' }, '0.1.0').message).toBe(
      'C’è la versione 0.2.0',
    );
    expect(manualCheckDialog({ kind: 'error', message: 'x' }, '0.1.0').type).toBe('warning');
  });

  it('downloads, waits for the user, then installs (macOS, Windows)', async () => {
    const { updater, backend, states, calls } = makeUpdater();
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('download-progress', { percent: 55 });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(states.map((s) => s.kind)).toEqual(['downloading', 'downloading', 'ready']);
    // While an update waits the checks go on (a higher version replaces it, item 26).
    updater.check();
    expect(backend.checks).toBe(1);
    expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
    expect(backend.installs).toEqual([]);
    await updater.install();
    expect(calls).toEqual(['beforeInstall']);
    expect(backend.installs).toEqual([[false, true]]);
    updater.stop();
  });

  it('replaces the AppImage and starts the new file after exit', async () => {
    const files = appImageFolder();
    const { updater, backend, calls } = makeUpdater(appImageSetup(), { autoInstall: true, files });
    updater.start();
    // Never on quit: the file changes name.
    expect(backend.autoInstallOnAppQuit).toBe(false);
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    await vi.waitFor(() => expect(backend.installs).toHaveLength(1));
    expect(backend.autoRunAppAfterInstall).toBe(false);
    expect(backend.installs).toEqual([[true, false]]);
    expect(calls).toEqual(['beforeInstall', `relaunch ${NEW}`]);
    // The backup kept during the swap is gone.
    expect([...files.files]).toEqual([NEW]);
    updater.stop();
  });

  it('starts the current version again when the install fails (macOS, Windows)', async () => {
    const { updater, backend, calls } = makeUpdater();
    backend.failInstall = true;
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(await updater.install()).toBe('failed');
    expect(calls).toEqual(['beforeInstall', 'failed, start null']);
    expect(updater.state).toEqual({ kind: 'error', message: 'No valid update available' });
    updater.stop();
  });

  it('a failed AppImage install puts the old file back and starts it (it never vanishes)', async () => {
    // electron-updater deletes the running AppImage before moving the new one in: when the move
    // or the start fails, nothing would be left (M3.6 review, C1).
    const files = appImageFolder();
    const { updater, backend, calls, log } = makeUpdater(appImageSetup(), { files });
    backend.failInstall = true;
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(await updater.install()).toBe('failed');
    expect(calls).toEqual(['beforeInstall', `failed, start ${OLD}`]);
    expect([...files.files]).toEqual([OLD]);
    expect(log).toContain('updates: the previous AppImage restored from its backup');
    updater.stop();
  });

  it('does not touch an AppImage in a folder it cannot write: the app keeps running', async () => {
    const files = appImageFolder();
    files.readOnly.add('/home/u/Apps');
    const { updater, backend, calls, states } = makeUpdater(appImageSetup(), { files });
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(await updater.install()).toBe('refused');
    // The core is not stopped, electron-updater never runs, the file stays.
    expect(calls).toEqual([]);
    expect(backend.installs).toEqual([]);
    expect([...files.files]).toEqual([OLD]);
    expect(states.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('non è scrivibile') as string,
    });
    updater.stop();
  });

  it('removes a backup left by an interrupted update at start', () => {
    const files = appImageFolder();
    files.files.add(appImageBackupPath(OLD));
    const { updater } = makeUpdater(appImageSetup(), { files });
    updater.start();
    expect([...files.files]).toEqual([OLD]);
    expect(appImageBackupPath(OLD)).toBe(
      '/home/u/Apps/.Monsters-0.0.1-linux-x86_64.AppImage.monsters-backup',
    );
    updater.stop();
  });
});

describe('Updater: Squirrel fails after "Riavvia ora" (review 18/10, item 20)', () => {
  it('an asynchronous error while installing restarts the current version', async () => {
    const { updater, backend, calls, states } = makeUpdater();
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(await updater.install()).toBe('started');
    expect(calls).toEqual(['beforeInstall']);
    // Squirrel.Mac complains later (signature, disk, proxy): the core and the tray come back.
    backend.emit('error', new Error('Could not get code signature for running application'));
    expect(calls).toEqual(['beforeInstall', 'failed, start null']);
    expect(states.at(-1)).toEqual({
      kind: 'error',
      message: 'Could not get code signature for running application',
    });
    // Once: a second error or the guard do not start it again.
    backend.emit('error', new Error('again'));
    expect(calls.filter((c) => c.startsWith('failed'))).toHaveLength(1);
    updater.stop();
  });

  it('nothing quit within the guard time: the same failure', async () => {
    vi.useFakeTimers();
    try {
      const { updater, backend, calls, states } = makeUpdater(undefined, {
        installGuardMs: 60_000,
      });
      updater.start();
      backend.emit('update-available', { version: '0.0.2' });
      backend.emit('update-downloaded', { version: '0.0.2' });
      await updater.install();
      await vi.advanceTimersByTimeAsync(59_000);
      expect(calls).toEqual(['beforeInstall']);
      await vi.advanceTimersByTimeAsync(2000);
      expect(calls).toEqual(['beforeInstall', 'failed, start null']);
      expect(states.at(-1)).toMatchObject({ kind: 'error' });
      updater.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('macOS: ready only after Squirrel staged the update (either order)', () => {
    const native = new EventEmitter();
    const make = () =>
      makeUpdater(undefined, {
        nativeUpdater: {
          on: (e, l) => native.on(e, l as (...a: unknown[]) => void),
        },
      });
    const first = make();
    first.updater.start();
    first.backend.emit('update-available', { version: '0.0.2' });
    first.backend.emit('update-downloaded', { version: '0.0.2' });
    expect(first.updater.state).toMatchObject({ kind: 'downloading' });
    native.emit('update-downloaded');
    expect(first.updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
    first.updater.stop();

    // Squirrel first, electron-updater after: ready at once.
    native.removeAllListeners();
    const second = make();
    second.updater.start();
    second.backend.emit('update-available', { version: '0.0.3' });
    native.emit('update-downloaded');
    second.backend.emit('update-downloaded', { version: '0.0.3' });
    expect(second.updater.state).toEqual({ kind: 'ready', version: '0.0.3' });
    second.updater.stop();
  });

  it('macOS: a Squirrel that never answers does not hide the update forever', async () => {
    vi.useFakeTimers();
    try {
      const { updater, backend } = makeUpdater(undefined, {
        nativeUpdater: { on: () => undefined },
        nativeWaitMs: 5000,
      });
      updater.start();
      backend.emit('update-available', { version: '0.0.2' });
      backend.emit('update-downloaded', { version: '0.0.2' });
      await vi.advanceTimersByTimeAsync(5001);
      expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
      updater.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Updater: checks while an update waits, and the channel (review 18/10, item 26)', () => {
  it('a higher version replaces the one waiting; the same one changes nothing', () => {
    const { updater, backend, states } = makeUpdater();
    updater.start();
    backend.emit('update-available', { version: '0.1.0-alpha.2' });
    backend.emit('update-downloaded', { version: '0.1.0-alpha.2' });
    expect(updater.state).toEqual({ kind: 'ready', version: '0.1.0-alpha.2' });
    const before = states.length;
    // The 6-hour check: electron-updater finds the version it already has.
    updater.check();
    expect(backend.checks).toBe(1);
    backend.emit('update-available', { version: '0.1.0-alpha.2' });
    backend.emit('update-downloaded', { version: '0.1.0-alpha.2' });
    expect(states.length).toBe(before);
    // A feed that went back says "not available": the waiting update stays.
    backend.emit('update-not-available', {});
    expect(updater.state).toEqual({ kind: 'ready', version: '0.1.0-alpha.2' });
    // The fix of a defective alpha.
    updater.check();
    backend.emit('update-available', { version: '0.1.0-alpha.3' });
    expect(updater.state).toMatchObject({ kind: 'downloading', version: '0.1.0-alpha.3' });
    backend.emit('update-downloaded', { version: '0.1.0-alpha.3' });
    expect(updater.state).toEqual({ kind: 'ready', version: '0.1.0-alpha.3' });
    updater.stop();
  });

  it('compares versions with their prereleases', () => {
    expect(isNewerVersion('0.1.0-alpha.10', '0.1.0-alpha.9')).toBe(true);
    expect(isNewerVersion('0.1.0-alpha.2', '0.1.0-alpha.2')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.1.0-alpha.9')).toBe(true);
    expect(isNewerVersion('0.1.0-beta.1', '0.1.0-alpha.9')).toBe(true);
    expect(isNewerVersion('0.1.1', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0-alpha.1', '0.1.0')).toBe(false);
  });

  it('reads the channel from app-update.yml: the move from alpha to beta comes from the feed', () => {
    expect(channelFromAppUpdateYml(APP_UPDATE_YML)).toBe('alpha');
    expect(channelFromAppUpdateYml('provider: generic\nchannel: beta\n')).toBe('beta');
    expect(channelFromAppUpdateYml('provider: generic\n')).toBe('alpha');
    expect(channelFromAppUpdateYml(null)).toBe('alpha');
    const beta = updateSetup({
      ...debEnv,
      readText: (p) =>
        p.endsWith('/app-update.yml')
          ? APP_UPDATE_YML.replace('channel: alpha', 'channel: beta')
          : debResources()(p),
    });
    expect(beta).toMatchObject({ enabled: true, channel: 'beta' });
    const { updater, backend, log } = makeUpdater(beta);
    updater.start();
    expect(backend.channel).toBe('beta');
    expect(backend.allowDowngrade).toBe(false);
    expect(log).toContain('updates: on, channel beta');
    updater.stop();
  });
});

describe('Updater, .deb: dependencies before ready (review 18/10, item 23)', () => {
  const missing = ['libgbm1 (>= 21)'];

  it('missing dependencies: not offered, told once, the command to fix it', async () => {
    const u = makeUpdater(debSetup(), {
      debDepends: () => Promise.resolve(missing),
      firstCheckMs: 10_000_000,
    });
    u.updater.start();
    u.backend.emit('update-available', { version: '0.0.2' });
    u.backend.emit('update-downloaded', DEB_DOWNLOADED);
    await vi.waitFor(() => expect(u.updater.state.kind).toBe('error'));
    expect(u.updater.state).toMatchObject({
      message: expect.stringContaining('libgbm1 (>= 21)') as string,
    });
    expect(u.calls).toEqual(['told depends']);
    expect(await u.updater.install()).toBe('none');
    // The next 6-hour check downloads again (the cache): not told again.
    u.backend.emit('update-available', { version: '0.0.2' });
    u.backend.emit('update-downloaded', DEB_DOWNLOADED);
    await vi.waitFor(() => expect(u.log.filter((l) => l.includes('not offered'))).toHaveLength(2));
    expect(u.calls).toEqual(['told depends']);
    const dialog = debFailureDialog(u.reports[0]!);
    expect(dialog.detail).toContain('libgbm1 (>= 21)');
    expect(dialog.detail).toContain(`sudo apt install ${PENDING}`);
    u.updater.stop();
  });

  it('dependencies satisfied (or the check unavailable): ready as before', async () => {
    const u = makeUpdater(debSetup(), { debDepends: () => Promise.resolve([]) });
    u.updater.start();
    u.backend.emit('update-available', { version: '0.0.2' });
    u.backend.emit('update-downloaded', DEB_DOWNLOADED);
    await vi.waitFor(() => expect(u.updater.state).toEqual({ kind: 'ready', version: '0.0.2' }));
    u.updater.stop();
  });

  it('dpkg left the package half installed: the dialog says "sudo apt install -f"', () => {
    const failure: DebFailure = {
      kind: 'dpkg',
      code: 1,
      detail: 'dependency problems prevent configuration of monsters',
    };
    const dialog = debFailureDialog({
      failure,
      update: { version: '0.0.2', file: PENDING, sha512: 'x', url: null },
      currentVersion: '0.0.1',
      restarting: true,
    });
    expect(dialog.command).toBe('sudo apt install -f');
    expect(dialog.detail).toContain('sudo apt install -f');
    expect(dialog.detail).toContain('rimasto a metà');
    expect(dialog.detail).not.toContain('si riavvia con la versione che è installata adesso');
  });
});

describe('Updater, .deb (D-105)', () => {
  const fixture = (
    deb: { ready?: DebFailure | null; go?: DebFailure | null; hang?: boolean } = {},
    extra: { debPasswordTimeoutMs?: number } = {},
  ) => {
    const u = makeUpdater(debSetup(), { deb, ...extra });
    u.updater.start();
    u.backend.emit('update-available', { version: '0.0.2' });
    u.backend.emit('update-downloaded', DEB_DOWNLOADED);
    return u;
  };

  it('never installs on quit, and never through electron-updater', async () => {
    const { updater, backend, asked } = fixture();
    expect(backend.autoInstallOnAppQuit).toBe(false);
    expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
    expect(await updater.install()).toBe('started');
    // DebUpdater.quitAndInstall (spawnSync dpkg, then apt-get -f as root) is not used.
    expect(backend.installs).toEqual([]);
    // The .deb entry of alpha-linux.yml: its sha512 goes to root's check, its URL to the dialog,
    // and the signed channel file the app verified goes to root, which checks it again.
    expect(asked).toEqual([
      {
        version: '0.0.2',
        file: PENDING,
        sha512: 'deb-sha',
        url: 'https://updates.example.com/desktop/Monsters-0.0.2-linux-amd64.deb',
        channel: {
          name: 'alpha-linux.yml',
          text: 'signed channel file\n',
          signature: 'monsters-update-signature-v1\nkey 0123456789abcdef x\n',
        },
      },
    ]);
    updater.stop();
  });

  it('stops the core only once the password is accepted, then dpkg, then the new version', async () => {
    const { updater, calls, log } = fixture();
    expect(await updater.install()).toBe('started');
    expect(calls).toEqual(['password asked', 'beforeInstall', 'dpkg', 'restart']);
    expect(log).toContain('updates: password accepted, stopping the core before dpkg');
    expect(log).toContain('updates: version 0.0.2 installed, restarting');
    updater.stop();
  });

  it('a password prompt nobody answers is cancelled after the timeout, back to ready', async () => {
    const { updater, calls, states } = fixture({ hang: true }, { debPasswordTimeoutMs: 20 });
    expect(await updater.install()).toBe('refused');
    expect(calls).toEqual(['password asked', 'cancel', 'told timeout']);
    expect(states.at(-1)).toEqual({ kind: 'ready', version: '0.0.2' });
    updater.stop();
  });

  it.each([
    [{ kind: 'cancelled' }],
    [{ kind: 'no-agent' }],
    [{ kind: 'not-authorized' }],
    [{ kind: 'no-pkexec' }],
    [{ kind: 'mismatch' }],
  ] satisfies [DebFailure][])(
    'refused before root starts (%o): nothing stopped, the app keeps running',
    async (failure) => {
      const { updater, calls, log, reports, states } = fixture({ ready: failure });
      expect(await updater.install()).toBe('refused');
      // No core stop, no dpkg, no restart: the user was told, the update is still ready.
      expect(calls).toEqual(['password asked', `told ${failure.kind}`]);
      expect(states.slice(-2)).toEqual([
        { kind: 'installing', version: '0.0.2' },
        { kind: 'ready', version: '0.0.2' },
      ]);
      expect(reports[0]).toMatchObject({ failure, currentVersion: '0.0.1', restarting: false });
      expect(log.at(-1)).toBe(
        `updates: version 0.0.2 not installed (${failure.kind}), still running 0.0.1; ` +
          `by hand: sudo apt install ${PENDING}`,
      );
      // "Riavvia per aggiornare" again from the menu: asked again.
      expect(updateMenuEntry(updater.state)?.action).toBe('install');
      expect(await updater.install()).toBe('refused');
      expect(calls.filter((c) => c === 'password asked')).toHaveLength(2);
      updater.stop();
    },
  );

  it('dpkg failing after the core stopped: tells, then restarts the installed version', async () => {
    const failure: DebFailure = { kind: 'dpkg', code: 1, detail: 'dependency problems' };
    const { updater, calls, reports, states } = fixture({ go: failure });
    expect(await updater.install()).toBe('failed');
    expect(calls).toEqual([
      'password asked',
      'beforeInstall',
      'dpkg',
      'told dpkg, restarting',
      'failed, start null',
    ]);
    expect(reports[0]?.restarting).toBe(true);
    expect(states.at(-1)).toMatchObject({ kind: 'error' });
    updater.stop();
  });

  it('without the downloaded .deb in the update info: nothing asked', async () => {
    const u = makeUpdater(debSetup());
    u.updater.start();
    u.backend.emit('update-available', { version: '0.0.2' });
    u.backend.emit('update-downloaded', { version: '0.0.2', downloadedFile: PENDING, files: [] });
    expect(await u.updater.install()).toBe('refused');
    expect(u.calls).toEqual([]);
    expect(u.updater.state).toMatchObject({ kind: 'error' });
    u.updater.stop();
  });

  it('finds the .deb of the update info, not the AppImage', () => {
    expect(downloadedDeb(DEB_DOWNLOADED, 'http://127.0.0.1:9/feed')).toMatchObject({
      sha512: 'deb-sha',
      url: 'http://127.0.0.1:9/feed/Monsters-0.0.2-linux-amd64.deb',
    });
    expect(downloadedDeb({ ...DEB_DOWNLOADED, downloadedFile: OLD }, null)).toBeNull();
    expect(downloadedDeb(DEB_DOWNLOADED, null)?.url).toBeNull();
  });
});

describe('update dialogs', () => {
  it('says the password will be asked before asking it (.deb only)', () => {
    const deb = updateReadyDialog('0.0.2', { password: true });
    expect(deb.detail).toContain(
      'Ti chiederò la password del computer per installare l’aggiornamento',
    );
    expect(deb.buttons).toEqual(['Riavvia ora', 'Più tardi']);
    expect(updateReadyDialog('0.0.2').detail).not.toContain('password');
  });

  const update: DebUpdate = {
    version: '0.0.2',
    file: PENDING,
    sha512: 'x',
    url: 'https://updates.example.com/desktop/Monsters-0.0.2-linux-amd64.deb',
  };

  it('a refused install: why, the version kept, the command to copy and the link', () => {
    const d = debFailureDialog({
      failure: { kind: 'no-agent' },
      update,
      currentVersion: '0.0.1',
      restarting: false,
    });
    expect(d.message).toBe('Non ho installato Monsters 0.0.2');
    expect(d.detail).toContain('sessione remota');
    expect(d.detail).toContain('Monsters continua con la versione 0.0.1.');
    expect(d.detail).toContain(`sudo apt install ${PENDING}`);
    expect(d.detail).toContain(update.url);
    expect(d.command).toBe(`sudo apt install ${PENDING}`);
    expect(d.buttons).toEqual(['Copia il comando', 'Apri il link', 'Chiudi']);
    expect(d.cancelId).toBe(2);
  });

  it('dpkg failed: says the app restarts; a package that failed its check is not offered', () => {
    const dpkg = debFailureDialog({
      failure: { kind: 'dpkg', code: 2, detail: 'dpkg frontend lock is locked' },
      update,
      currentVersion: '0.0.1',
      restarting: true,
    });
    expect(dpkg.detail).toContain('codice 2');
    expect(dpkg.detail).toContain('si riavvia con la versione che è installata adesso');
    const bad = debFailureDialog({
      failure: { kind: 'mismatch' },
      update: { ...update, url: null },
      currentVersion: '0.0.1',
      restarting: false,
    });
    expect(bad.command).toBeNull();
    expect(bad.detail).not.toContain('sudo apt');
    expect(bad.buttons).toEqual(['Chiudi']);
  });
});

describe('AppImage sandbox notice', () => {
  it('only for an AppImage started with --no-sandbox', () => {
    const env = { APPIMAGE: '/x/M.AppImage' };
    expect(appImageWithoutSandbox({ platform: 'linux', argv: ['m', '--no-sandbox'], env })).toBe(
      true,
    );
    expect(appImageWithoutSandbox({ platform: 'linux', argv: ['m'], env })).toBe(false);
    expect(
      appImageWithoutSandbox({ platform: 'linux', argv: ['m', '--no-sandbox'], env: {} }),
    ).toBe(false);
  });
});

describe('Updater: the signature before the download (S-A4)', () => {
  const refuse =
    (reason: 'missing' | 'invalid' | 'unknown-key' | 'mismatch' = 'missing') =>
    (): ReturnType<UpdaterOptions['verify']> => ({ ok: false, reason, detail: 'alpha.yml.sig' });

  it('an unsigned or wrongly signed version: nothing downloaded, nothing offered, said why', () => {
    const told: ManualCheckResult[] = [];
    const { updater, backend, log } = makeUpdater(undefined, {
      verify: refuse('missing'),
      onManualResult: (r) => told.push(r),
    });
    updater.start();
    updater.check(true);
    backend.emit('update-available', { version: '0.0.2' });
    expect(backend.downloads).toBe(0);
    expect(updater.state).toEqual({
      kind: 'error',
      message: 'l’aggiornamento 0.0.2 non è firmato: non lo scarico',
    });
    expect(told).toEqual([
      { kind: 'error', message: 'l’aggiornamento 0.0.2 non è firmato: non lo scarico' },
    ]);
    expect(log).toContain('updates: version 0.0.2 refused: missing (alpha.yml.sig)');
    // A download that arrives anyway (it should not) is never offered.
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(updater.state.kind).toBe('error');
    expect(log.at(-1)).toContain('downloaded but not offered');
    updater.stop();
  });

  it('a signed version: checked first, then downloaded, then offered', async () => {
    let answer: (r: Awaited<ReturnType<UpdaterOptions['verify']>>) => void = () => {};
    const pending = new Promise<Awaited<ReturnType<UpdaterOptions['verify']>>>((r) => (answer = r));
    const { updater, backend, log } = makeUpdater(undefined, { verify: () => pending });
    updater.start();
    updater.check();
    expect(backend.checks).toBe(1);
    backend.emit('update-available', { version: '0.0.2' });
    // Still checking while the signature is fetched: no download, no second check.
    expect(updater.state).toEqual({ kind: 'checking' });
    expect(backend.downloads).toBe(0);
    updater.check(true);
    expect(backend.checks).toBe(1);
    const ok = acceptAll({ version: '0.0.2' });
    answer(ok instanceof Promise ? await ok : ok);
    await vi.waitFor(() => expect(backend.downloads).toBe(1));
    expect(updater.state).toEqual({ kind: 'downloading', version: '0.0.2', percent: 0 });
    expect(log).toContain('updates: version 0.0.2 signed (key 0123456789abcdef), downloading');
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
    updater.stop();
  });

  it('a download that is not what was verified is not offered', () => {
    const { updater, backend, log } = makeUpdater();
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', {
      version: '0.0.2',
      files: [{ url: 'Monsters-0.0.2-evil.zip', sha512: 'evil' }],
    });
    expect(updater.state).toEqual({
      kind: 'error',
      message: 'l’aggiornamento 0.0.2 non corrisponde a quello firmato: non lo scarico',
    });
    expect(log.at(-1)).toContain('Monsters-0.0.2-evil.zip is not in the signed file');
    updater.stop();
  });

  it('a higher version with a bad signature leaves the verified one waiting', () => {
    let verdict: UpdaterOptions['verify'] = acceptAll;
    const { updater, backend } = makeUpdater(undefined, { verify: (i) => verdict(i) });
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2' });
    expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
    verdict = refuse('invalid');
    backend.emit('update-available', { version: '0.0.3' });
    expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' });
    expect(backend.downloads).toBe(1);
    updater.stop();
  });

  it('a verifier that throws refuses', () => {
    const { updater, backend } = makeUpdater(undefined, {
      verify: () => {
        throw new Error('boom');
      },
    });
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    expect(updater.state.kind).toBe('error');
    expect(backend.downloads).toBe(0);
    updater.stop();
  });

  it('a .deb that failed root’s signature or package check: no command, no link to the feed', () => {
    for (const kind of ['signature', 'not-ours', 'not-newer'] as const) {
      const dialog = debFailureDialog({
        failure: { kind },
        update: { version: '0.0.2', file: PENDING, sha512: 'x', url: 'https://u.example/x.deb' },
        currentVersion: '0.0.1',
        restarting: false,
      });
      expect(dialog.command).toBeNull();
      expect(dialog.buttons).toEqual(['Chiudi']);
      expect(dialog.detail).toContain('manomesso');
      expect(dialog.detail).not.toContain('https://u.example/x.deb');
    }
  });
});

describe('Updater: one read of the feed, and the downloaded file (review of wave 5)', () => {
  it('hands electron-updater the signed provider', () => {
    const feedOptions = { provider: 'custom' as const, url: 'https://u.example/desktop/' };
    const { updater, backend } = makeUpdater(undefined, { feedOptions });
    updater.start();
    expect(backend.feed).toBe(feedOptions);
    updater.stop();
  });

  it('a feed the provider refused: said once, nothing downloaded, checked again once', async () => {
    const told: ManualCheckResult[] = [];
    const { updater, backend, log } = makeUpdater(undefined, {
      onManualResult: (r) => told.push(r),
      refusalRetryMs: 20,
      firstCheckMs: 100_000,
    });
    backend.checkError = new UpdateRefusedError('invalid', 'alpha-mac.yml.sig', '0.0.2');
    updater.start();
    updater.check(true);
    await vi.waitFor(() => expect(updater.state.kind).toBe('error'));
    expect(updater.state).toEqual({
      kind: 'error',
      message: 'la firma dell’aggiornamento 0.0.2 non è valida: non lo scarico',
    });
    expect(told).toHaveLength(1);
    expect(log.filter((l) => l.includes('refused: invalid'))).toHaveLength(1);
    expect(backend.downloads).toBe(0);
    // The check that fell in the middle of a publication is done again, once.
    await vi.waitFor(() => expect(backend.checks).toBe(2));
    await new Promise((r) => setTimeout(r, 60));
    expect(backend.checks).toBe(2);
    updater.stop();
  });

  it('a download whose own sha512 is not signed: not offered, not installed on quit, removed', async () => {
    const removed: string[] = [];
    const { updater, backend, log } = makeUpdater(undefined, {
      hashFile: () => Promise.resolve('forged-sha'),
      discardDownload: (p) => removed.push(p),
      firstCheckMs: 100_000,
    });
    updater.start();
    expect(backend.autoInstallOnAppQuit).toBe(true);
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/c/pending/M.zip' });
    await vi.waitFor(() => expect(updater.state.kind).toBe('error'));
    expect(backend.autoInstallOnAppQuit).toBe(false);
    expect(removed).toEqual(['/c/pending/M.zip']);
    expect(log.at(-1)).toContain('M.zip: its sha512 is not in the signed file');
    updater.stop();
  });

  it('a download whose sha512 is signed: offered, install on quit as before', async () => {
    const { updater, backend } = makeUpdater(undefined, {
      hashFile: () => Promise.resolve('deb-sha'),
    });
    updater.start();
    backend.autoInstallOnAppQuit = false;
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/c/pending/M.zip' });
    await vi.waitFor(() => expect(updater.state).toEqual({ kind: 'ready', version: '0.0.2' }));
    expect(backend.autoInstallOnAppQuit).toBe(true);
    updater.stop();
  });

  it('a legacy-only info (files empty, path with a sha256) is never offered', () => {
    const { updater, backend, log } = makeUpdater();
    updater.start();
    backend.emit('update-available', { version: '0.0.2' });
    backend.emit('update-downloaded', {
      version: '0.0.2',
      files: [],
      path: 'Monsters-0.0.2-linux-amd64.deb',
      sha2: 'deadbeef',
    });
    expect(updater.state.kind).toBe('error');
    expect(log.at(-1)).toContain('has no sha512');
    updater.stop();
  });
});
