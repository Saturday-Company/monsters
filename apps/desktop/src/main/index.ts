import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  locateOpenSsh,
  openTunnel,
  tunnelUrlPatterns,
  type ConnectionProfile,
} from '@monsters/remote';
import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
} from 'electron';
import { appLang, isLang, resolveLang, setAppLang, type Lang } from '@monsters/shared';
import { autoUpdater } from 'electron-updater';
import {
  forgetHostKey,
  hostCheck,
  knownHostsNames,
  sshDefaults,
  systemLookup,
  systemSshRunner,
  testConnection,
} from './connection-check.ts';
import { AppTheme, envTheme } from './app-theme.ts';
import { ConnectionsWindow } from './connections-window.ts';
import {
  activeRunCount,
  closeNotice,
  leaveLocalDialog,
  quitDialog,
  shouldConfirmStop,
} from './core-jobs.ts';
import {
  checkPackagedCore,
  checkProblemText,
  CORE_MANIFESTS_DIR,
  manifestHashOf,
  manifestName,
  parseCoreManifest,
  type CoreManifest,
} from './core-integrity.ts';
import { systemLocatorDeps } from './core-locator.ts';
import { homeLanguage, openVaultFile, resolveVaultDir, showVaultFile } from './file-open.ts';
import { fromAppPage, fromCorePage, targetInfo } from './ipc-guards.ts';
import { DEBUG_SWITCHES, debugSwitchVerdict } from './debug-switches.ts';
import { DesktopLog, startedLine } from './desktop-log.ts';
import { desktopLogPath, ensurePrivateDir, homeFile, readTextFile, resolveHome } from './home.ts';
import { LinkBanner } from './link-banner.ts';
import { LoginItem, relaunchArgs, startsHidden, type LoginItemState } from './login-item.ts';
import { KeychainHost, keyringNativePath } from './keychain-host.ts';
import { coreArgs, coreChildEnv, CORE_TAMPERED, LocalCore, type CoreTarget } from './local-core.ts';
import { LOCAL_CHOICE, ProfileStore, type StoredProfile, type TargetChoice } from './profiles.ts';
import {
  bannerText,
  forgetKeyDialog,
  hostKeyChangedDialog,
  keyElsewhereDialog,
  remoteFailureCopy,
  trayTooltip,
} from './remote-copy.ts';
import { isRemoteTarget, RemoteCore, type LinkState } from './remote-core.ts';
import {
  confirmHostKey,
  connectionsView,
  tunnelOptions,
  watchWakeAndNetwork,
} from './remote-electron.ts';
import { TargetSwitcher, type CoreHost } from './target-switch.ts';
import {
  cookieLifetime,
  exchangeLoginToken,
  keepSession,
  postToCore,
  SESSION_COOKIE,
  type CoreAuth,
} from './login.ts';
import {
  ExternalOpenLimiter,
  externalUrl,
  navigationVerdict,
  originOf,
  permissionAllowed,
  WEBRTC_IP_POLICY,
  windowOpenVerdict,
} from './navigation.ts';
import {
  isStatusAction,
  statusPageUrl,
  type StatusAction,
  type StatusView,
} from './status-page.ts';
import type { CoreChild } from './supervisor.ts';
import { coreProxyEnv, PROXY_PROBE_URL } from './system-proxy.ts';
import { appStrings } from './app.strings.ts';
import { loginItemStrings } from './login-item.strings.ts';
import { appImageWithoutSandbox, sandboxNotice, sandboxNoticePath } from './linux-sandbox.ts';
import {
  debFailureDialog,
  debFailureButtons,
  spawnAfterExit,
  Updater,
  manualCheckDialog,
  updateMenuEntry,
  updateReadyDialog,
  updateReadyNotice,
  isFeedOrigin,
  updateSetup,
  type DebFailureReport,
  type UpdateSetup,
  type UpdateState,
} from './updater.ts';
import { missingDepends } from './deb-install.ts';
import { SignedFeed } from './signed-provider.ts';
import {
  channelFileName,
  loadPublicKeys,
  UPDATE_KEYS_DIR,
  type FetchText,
} from './update-signature.ts';
import { fitWindowState, MIN_WINDOW, parseWindowState } from './window-state.ts';
import {
  titleBarOptions,
  TitleBarState,
  windowBackground,
  windowChrome,
  type WindowChrome,
} from './title-bar.ts';

/*
 * Main process of the desktop app (M3.1, D-045). Local mode: the core of the data directory
 * shared with the CLI, attached or started in a utility process (local-core.ts); one hardened
 * window on the core's own origin with automatic login; tray and app menu with the kill
 * switch. Closing the window hides it (the core keeps working for the agents); "Esci" stops
 * the core if the app started it. Client mode (M3.3, D-047): the same window on a remote
 * core through an SSH tunnel (remote-core.ts), one session per profile, chosen in the
 * "Connessioni" window (connections-window.ts); target-switch.ts keeps one core at a time.
 * First start (no connections.json, audit UX 1.2): the window asks where the monsters work and
 * no core starts before the answer. Stopping the local core the app started (switching to
 * another computer, "Esci", an update) asks first when work is in progress (core-jobs.ts).
 */

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(APP_DIR, 'assets');
const PRELOAD = join(APP_DIR, 'dist', 'preload.cjs');
const KEYCHAIN_HELPER = join(APP_DIR, 'dist', 'keychain-helper.cjs');
const isMac = process.platform === 'darwin';
/** Integrated title bar (D-056): `inset` on macOS, `overlay` on Windows and Linux. */
const chrome: WindowChrome = windowChrome(process.platform, process.env);

app.setName('Monsters');
// The appId of the packages (D-046): Windows ties shortcuts and notifications to it.
if (process.platform === 'win32') app.setAppUserModelId('it.saturdaycompany.monsters');
const defaultUserData = app.getPath('userData');
// Tests and a second profile: a user data folder of their own (window state, cookies, lock).
const userData = process.env['MONSTERS_DESKTOP_USER_DATA'];
if (userData) app.setPath('userData', userData);
// The system theme of the tests (app-theme.ts): until the stored choice is read at start.
const systemTheme = envTheme(process.env);
if (systemTheme) nativeTheme.themeSource = systemTheme;
// Every renderer sandboxed, whatever a window asks for.
app.enableSandbox();

const home = resolveHome();
const log = new DesktopLog(desktopLogPath(home));

/*
 * DevTools protocol and Node inspector switches in the packaged app: only on throwaway data
 * (debug-switches.ts, D-049), checked before anything starts. Refused: the switches are dropped
 * (the DevTools server starts after this script) and the app quits.
 */
const debugVerdict = debugSwitchVerdict({
  isPackaged: app.isPackaged,
  platform: process.platform,
  present: DEBUG_SWITCHES.filter((s) => app.commandLine.hasSwitch(s)),
  home,
  defaultHome: resolveHome({}),
  userData: app.getPath('userData'),
  defaultUserData,
});
if (debugVerdict.action === 'refuse') {
  for (const s of debugVerdict.switches) app.commandLine.removeSwitch(s);
}

function coreEntry(): string {
  // The packaged app runs only its own core, checked against its manifest (S-M9).
  if (app.isPackaged) return join(process.resourcesPath, 'core', 'monsters.js');
  const configured = process.env['MONSTERS_DESKTOP_CORE'];
  if (configured) return configured;
  // Development: the bundle of `pnpm build:core` in the repo.
  return join(APP_DIR, '..', '..', 'packages', 'cli', 'dist-bundle', 'monsters.js');
}

/**
 * The sha256 of the keyring's binary in the manifest of this platform (review of 19/10, n. 12):
 * the helper checks it right before loading the binary, which happens hours after the check of
 * the core's start. Development: no check; macOS: the library validation checks the signature.
 */
function keyringHash(path: string): string | null | undefined {
  if (!app.isPackaged || process.platform === 'darwin') return undefined;
  const file = join(
    app.getAppPath(),
    CORE_MANIFESTS_DIR,
    manifestName(process.platform, process.arch),
  );
  let manifest: CoreManifest | null;
  try {
    manifest = parseCoreManifest(readFileSync(file, 'utf8'));
  } catch {
    manifest = null;
  }
  if (!manifest) return null;
  const hash = manifestHashOf(manifest, join(process.resourcesPath, 'core'), path);
  return hash === 'signed' ? undefined : hash;
}

/**
 * Before every start of the packaged core: resources/core against the manifest in app.asar
 * (S-M9, core-integrity.ts). A file changed, added or missing and the core does not start.
 */
async function checkCoreFiles(): Promise<{ code: string; message: string } | null> {
  const check = await checkPackagedCore({
    appPath: app.getAppPath(),
    coreDir: join(process.resourcesPath, 'core'),
  });
  if (check.ok) {
    log.info(`core: ${check.files} files checked against the manifest in ${check.ms} ms`);
    return null;
  }
  log.info(`core: integrity check failed (${check.problem}: ${check.file}) in ${check.ms} ms`);
  return { code: CORE_TAMPERED, message: checkProblemText(check) };
}

/** The system proxy for the next start of the core (system-proxy.ts). */
let coreProxy: Record<string, string> = {};
let coreProxyNote = '';

/**
 * Asks Chromium which proxy reaches the internet (system settings, PAC included): before the
 * first start, after each start (for the next one, a restart after a crash), after a wake or a
 * network change. A failure keeps the last answer.
 */
async function refreshCoreProxy(): Promise<void> {
  try {
    const resolved = await Promise.race([
      session.defaultSession.resolveProxy(PROXY_PROBE_URL),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('no answer in 5 s')), 5_000).unref();
      }),
    ]);
    const proxy = coreProxyEnv(resolved, process.env);
    coreProxy = proxy.env;
    if (proxy.note !== coreProxyNote) log.info(`core ${proxy.note}`);
    coreProxyNote = proxy.note;
  } catch (err) {
    log.info(`core proxy: system settings not read (${(err as Error).message}), kept as they were`);
  }
}

/**
 * The app's language (D-153): the web UI's last word, else the data folder's (`settings.json`, else
 * Italian when it has an account: an install the core has not restarted since the update), else
 * `MONSTERS_LANG` (tests, support), else the system's.
 */
function appLanguage(): Lang {
  const forced = process.env['MONSTERS_LANG'];
  return (
    store?.language ??
    homeLanguage(home) ??
    (isLang(forced) ? forced : resolveLang(app.getPreferredSystemLanguages()))
  );
}

function spawnCore(): CoreChild {
  const child = utilityProcess.fork(coreEntry(), coreArgs(home, store?.corePort ?? null), {
    serviceName: 'Monsters core',
    stdio: 'pipe',
    env: {
      ...coreChildEnv(
        process.env,
        app.getVersion(),
        // The installed app is off limits to the monsters' file tools (review of 18/10, M9).
        app.isPackaged ? [process.resourcesPath, dirname(process.execPath)] : [],
      ),
      ...coreProxy,
      // The language of a new install (D-153): the one the web UI last said, else the system's.
      MONSTERS_LANG: process.env['MONSTERS_LANG'] ?? appLanguage(),
      MONSTERS_LOCALE: process.env['MONSTERS_LOCALE'] ?? app.getLocale(),
    },
    cwd: home,
  });
  // For the next start: the network may have changed meanwhile.
  void refreshCoreProxy();
  child.on('spawn', () => log.info(`core: pid ${child.pid ?? '?'}`));
  child.stdout?.on('data', (d: Buffer) => log.write('core', d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => log.write('core', d.toString('utf8')));
  return {
    get pid() {
      return child.pid;
    },
    postMessage: (m) => child.postMessage(m),
    kill: () => {
      child.kill();
    },
    onMessage: (listener) => child.on('message', listener),
    onExit: (listener) => child.on('exit', listener),
  };
}

/*
 * The core's keychain calls (D-042), each in a utility process of the app running only
 * dist/keychain-helper.cjs: the app's binary is never a Node (RunAsNode off, S-M8), and the
 * keychain's "Allow always" stays with code only the app runs: the helper's JavaScript is all
 * in the ASAR, of the keyring it loads only the native binary in resources/core.
 */
const keychainHost = new KeychainHost({
  fork: () => {
    const child = utilityProcess.fork(KEYCHAIN_HELPER, [], {
      serviceName: 'Monsters keychain',
      stdio: 'pipe',
    });
    child.stderr?.on('data', (d: Buffer) => log.write('keychain', d.toString('utf8')));
    return {
      get pid() {
        return child.pid;
      },
      postMessage: (m) => child.postMessage(m),
      onMessage: (listener) => child.on('message', listener),
      onExit: (listener) => child.on('exit', listener),
      kill: () => {
        child.kill();
      },
    };
  },
  nativePath: () => keyringNativePath(coreEntry()),
  nativeHash: keyringHash,
  log: (line) => log.info(line),
});

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
/** "Questo computer" or a remote profile: one core at a time (M3.3). */
let switcher: TargetSwitcher<TargetChoice> | null = null;
let store: ProfileStore | null = null;
let connections: ConnectionsWindow | null = null;
const banner = new LinkBanner();
/** State of the SSH link in the client mode; null for "Questo computer". */
let link: LinkState | null = null;
let coreSession: Session | null = null;
/** The core the window shows now (local or remote). */
const host = (): CoreHost | null => switcher?.host ?? null;
/** Origin of the core the window shows; null while it shows a status page. */
let coreOrigin: string | null = null;
/** The last destination info sent to the core's page (notifyTarget). */
let sentTarget = '';
let quitting = false;
let cleanedUp = false;
let updater: Updater | null = null;
/** Colours of the window's title bar overlay (Windows and Linux): page or app theme. */
let titleBar: TitleBarState | null = null;
/** The theme chosen in the web UI's Settings, for the whole app (D-091). */
let appTheme: AppTheme | null = null;
/** "Apri all'accesso" (login-item.ts, D-095): the system keeps the choice. */
let loginItem: LoginItem | null = null;
/**
 * Opened at login (D-095): the window stays hidden, only the tray icon, until the user opens
 * it. Its maximized state waits too (`maximize()` would show it).
 */
let startHidden = false;
let maximizeOnShow = false;

const windowStatePath = () => join(app.getPath('userData'), 'window-state.json');

function saveWindowState(w: BrowserWindow): void {
  try {
    const b = w.getNormalBounds();
    writeFileSync(windowStatePath(), JSON.stringify({ ...b, maximized: w.isMaximized() }), {
      mode: 0o600,
    });
  } catch {
    // not worth an error
  }
}

function showWindow(): void {
  if (!win) return;
  startHidden = false;
  if (maximizeOnShow) {
    maximizeOnShow = false;
    win.maximize();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // "Apri" after the core gave up: try again.
  const h = host();
  if (h && !h.target) h.retry();
}

let shownStatus = '';
/** The last page of the status page shown, to build it again when the language changes. */
let lastStatusView: StatusView | null = null;
function showStatus(view: StatusView): void {
  lastStatusView = view;
  const key = JSON.stringify(view);
  if (coreOrigin === null && key === shownStatus) return;
  shownStatus = key;
  coreOrigin = null;
  // The status page follows the app's theme (Settings, or the system), and so does the bar.
  titleBar?.reset(nativeTheme.shouldUseDarkColors);
  log.info(`status: ${view.kind}`);
  void win?.loadURL(statusPageUrl(view, chrome)).catch(() => {});
}

/** Logs the window in on the core without a password (D-045); the login page otherwise. */
async function ensureLogin(target: CoreTarget, ses: Session): Promise<void> {
  const [existing] = await ses.cookies.get({ url: target.url, name: SESSION_COOKIE });
  // A limited session left on the app's own core is replaced (review of ondate 3-4, n. 4), and
  // so is a cookie of it on disk from an older version (`cookieLifetime`, n. 9).
  const onDisk = target.kind === 'owned' && existing?.session === false;
  if (existing && !onDisk && (await keepSession(target, existing.value))) return;
  if (onDisk) await ses.cookies.remove(target.url, SESSION_COOKIE).catch(() => {});
  const token = await target.loginToken();
  if (!token) {
    log.info('automatic login: no login token, the window asks for the password');
    return;
  }
  const result = await exchangeLoginToken(target.url, token);
  if (result.status !== 'ok') {
    log.info(
      `automatic login: ${result.status === 'needs_setup' ? 'no account yet' : result.reason}`,
    );
    return;
  }
  await ses.cookies.set({
    url: target.url,
    name: SESSION_COOKIE,
    value: result.cookie.value,
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    ...cookieLifetime(target.kind, result.cookie),
  });
  log.info('automatic login: done');
}

/**
 * A remote core accepts only its own origin: when the tunnel's local port differs from the
 * remote one, the requests of this session to exactly the tunnel's origin (HTTP and the
 * WebSocket upgrade) get the remote Origin (D-044). One listener per session: registering
 * again replaces the filter (new port after a reconnection), null removes it.
 */
function applyOriginRewrite(ses: Session, target: CoreTarget): void {
  if (!isRemoteTarget(target) || !target.originRewrite) {
    ses.webRequest.onBeforeSendHeaders(null);
    return;
  }
  ses.webRequest.onBeforeSendHeaders(
    { urls: tunnelUrlPatterns(target.ports.localPort) },
    (details, callback) =>
      callback({ requestHeaders: target.rewriteHeaders(details.url, details.requestHeaders) }),
  );
  log.info(
    `origin rewrite: ${target.ports.localPort} → ${target.ports.remotePort} (HTTP and WebSocket)`,
  );
}

async function showTarget(target: CoreTarget): Promise<void> {
  if (!win || !coreSession) return;
  if (host()?.target !== target) return;
  applyOriginRewrite(coreSession, target);
  try {
    await ensureLogin(target, coreSession);
  } catch (err) {
    log.info(`automatic login failed: ${(err as Error).message}`);
  }
  if (host()?.target !== target || !win) return;
  coreOrigin = originOf(target.url);
  shownStatus = '';
  // A new page: it asks with target() when it starts; changes after that are sent.
  sentTarget = JSON.stringify(currentTargetInfo());
  await win.loadURL(`${target.url}/`).catch((err: Error) => log.info(`load: ${err.message}`));
}

/** The kill switch and resume of the menus: the same API as the window's button. */
async function coreAction(path: '/api/kill' | '/api/resume'): Promise<boolean> {
  // Always the core the window shows: in the client mode, the remote one through the tunnel.
  const target = host()?.target;
  let status = 0;
  if (target && coreSession) {
    const [cookie] = await coreSession.cookies.get({ url: target.url, name: SESSION_COOKIE });
    status = cookie ? await postToCore(target.url, path, { cookie: cookie.value }) : 401;
    if ((status === 401 || status === 403) && target.kind !== 'remote') {
      // Not logged in yet (first start): the CLI token of this data directory still works.
      const cli = readTextFile(homeFile(home, 'cliToken'))?.trim();
      const auth: CoreAuth | null = cli ? { bearer: cli } : null;
      if (auth) status = await postToCore(target.url, path, auth);
    }
  }
  log.info(`menu ${path}: ${status || 'core unreachable'}`);
  if (status !== 200) {
    const t = appStrings().coreAction;
    void dialog.showMessageBox({
      type: 'error',
      message: path === '/api/kill' ? t.killFailed : t.resumeFailed,
      detail: !target
        ? link
          ? t.notConnected(link.name)
          : t.notRunning
        : status === 401 && target.kind === 'remote'
          ? t.signInFirst
          : t.noAnswer,
    });
  }
  return status === 200;
}

function menuItems() {
  const t = appStrings().menu;
  return {
    open: { id: 'monsters-open', label: t.open, click: () => showWindow() },
    kill: { id: 'monsters-kill', label: t.kill, click: () => void coreAction('/api/kill') },
    resume: {
      id: 'monsters-resume',
      label: t.resume,
      click: () => void coreAction('/api/resume'),
    },
    quit: {
      id: 'monsters-quit',
      label: t.quit,
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit(),
    },
    loginItem: {
      id: 'monsters-login-item',
      label: loginItemStrings().label,
      type: 'checkbox' as const,
      checked: loginItem?.state().enabled ?? false,
      click: (item: Electron.MenuItem) => toggleLoginItem(item.checked),
    },
    connections: {
      id: 'monsters-connections',
      label: t.connections,
      click: () => connections?.open(),
    },
    reconnect: {
      id: 'monsters-reconnect',
      label: t.reconnect,
      visible: link !== null,
      click: () => host()?.retry(),
    },
    // "This computer" and the remote profiles; the checked one is what the window shows.
    targets: {
      id: 'monsters-targets',
      label: t.use,
      submenu: [
        { label: t.thisComputer, id: `monsters-target-${LOCAL_CHOICE}`, choice: LOCAL_CHOICE },
        ...(store?.list() ?? []).map((p) => ({
          label: p.name,
          id: `monsters-target-${p.id}`,
          choice: p.id,
        })),
      ].map(({ label, id, choice }) => ({
        id,
        label,
        type: 'radio' as const,
        checked: switcher?.choice === choice,
        click: () => void useTarget(choice).then(() => buildMenus()),
      })),
    },
  } satisfies Record<string, MenuItemConstructorOptions>;
}

/** "Check for updates" / "Restart to update" (updater.ts), when updates are on. */
function updateItems(): MenuItemConstructorOptions[] {
  const entry = updater ? updateMenuEntry(updater.state) : null;
  if (!entry) return [];
  return [
    {
      id: 'monsters-update',
      label: entry.label,
      enabled: entry.enabled,
      click: () => {
        if (entry.action === 'check') updater?.check(true);
        // The .deb asks the computer's password: the dialog says so before it is asked.
        else if (entry.action === 'install' && debUpdates && updater?.state.kind === 'ready') {
          void askToInstall(updater.state.version);
        } else if (entry.action === 'install') void installUpdate();
      },
    },
  ];
}

function buildMenus(): void {
  const i = menuItems();
  const t = appStrings().menu;
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Monsters',
      submenu: [
        ...(isMac ? [{ role: 'about' as const, label: t.about }, sep] : []),
        i.open,
        ...updateItems(),
        sep,
        i.kill,
        i.resume,
        sep,
        i.targets,
        i.connections,
        i.reconnect,
        sep,
        i.loginItem,
        sep,
        ...(isMac
          ? [
              { role: 'hide' as const, label: t.hide },
              { role: 'hideOthers' as const, label: t.hideOthers },
              { role: 'unhide' as const, label: t.unhide },
              sep,
            ]
          : []),
        i.quit,
      ],
    },
    {
      label: t.edit,
      submenu: [
        { role: 'undo', label: t.undo },
        { role: 'redo', label: t.redo },
        sep,
        { role: 'cut', label: t.cut },
        { role: 'copy', label: t.copy },
        { role: 'paste', label: t.paste },
        { role: 'selectAll', label: t.selectAll },
      ],
    },
    {
      label: t.view,
      submenu: [
        { role: 'reload', label: t.reload },
        sep,
        { role: 'resetZoom', label: t.actualSize },
        { role: 'zoomIn', label: t.zoomIn },
        { role: 'zoomOut', label: t.zoomOut },
        sep,
        { role: 'togglefullscreen', label: t.fullScreen },
        ...(app.isPackaged ? [] : [sep, { role: 'toggleDevTools' as const, label: t.devTools }]),
      ],
    },
    {
      label: t.window,
      submenu: [
        { role: 'minimize', label: t.minimize },
        ...(isMac ? [{ role: 'zoom' as const, label: t.zoom }] : []),
        { label: t.closeWindow, accelerator: 'CmdOrCtrl+W', click: () => win?.hide() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  const trayMenu = Menu.buildFromTemplate([
    i.open,
    ...updateItems(),
    sep,
    i.kill,
    i.resume,
    sep,
    i.targets,
    i.connections,
    i.reconnect,
    sep,
    i.loginItem,
    sep,
    i.quit,
  ]);
  if (!tray) {
    const icon = nativeImage.createFromPath(join(ASSETS, isMac ? 'trayTemplate.png' : 'tray.png'));
    if (isMac) icon.setTemplateImage(true);
    try {
      tray = new Tray(icon);
      if (!isMac) tray.on('click', () => showWindow());
    } catch (err) {
      // Linux desktops without a tray area: the window and the menu bar still have everything.
      log.info(`tray not available: ${(err as Error).message}`);
    }
  }
  tray?.setContextMenu(trayMenu);
  updateTooltip();
  // Opened at login on a desktop without a tray area: nothing would be visible.
  if (!tray && !isMac && startHidden) showWindow();
  if (isMac) app.dock?.setMenu(Menu.buildFromTemplate([i.kill, i.resume, sep, i.connections]));
}

let shownTooltip = '';
/** Tray tooltip and window title: which core, and how the link is doing. */
function updateTooltip(): void {
  const text = trayTooltip(link);
  if (text !== shownTooltip) {
    shownTooltip = text;
    tray?.setToolTip(text);
    log.info(`tray: ${text}`);
  }
  if (win && !win.isDestroyed()) win.setTitle(link ? `Monsters · ${link.name}` : 'Monsters');
}

function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = permissionAllowed(permission, details.requestingUrl, coreOrigin);
    if (!ok) log.info(`permission denied: ${permission}`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, coreOrigin),
  );
  ses.setDevicePermissionHandler(() => false);
}

const externalOpens = new ExternalOpenLimiter();
async function openExternal(url: string): Promise<boolean> {
  const safe = externalUrl(url);
  if (!safe) return false;
  if (!externalOpens.allow()) {
    log.info(`not opened in the browser (too many links at once): ${new URL(safe).origin}`);
    return false;
  }
  log.info(`opening in the browser: ${new URL(safe).origin}`);
  await shell.openExternal(safe);
  return true;
}

function createWindow(ses: Session): BrowserWindow {
  const saved = fitWindowState(
    parseWindowState(readTextFile(windowStatePath())),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const w = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    show: false,
    title: 'Monsters',
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: true,
    ...titleBarOptions(chrome, nativeTheme.shouldUseDarkColors),
    ...(isMac ? {} : { icon: join(ASSETS, 'icon.png') }),
    webPreferences: {
      preload: PRELOAD,
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      additionalArguments: [
        `--monsters-desktop=${JSON.stringify({
          version: app.getVersion(),
          platform: process.platform,
          chrome,
        })}`,
      ],
    },
  });
  if (saved.maximized && startHidden) maximizeOnShow = true;
  else if (saved.maximized) w.maximize();
  w.once('ready-to-show', () => {
    if (!startHidden) w.show();
  });
  titleBar = new TitleBarState(chrome, (colors) => {
    if (!w.isDestroyed()) w.setTitleBarOverlay(colors);
  });

  const wc = w.webContents;
  // A new document in the window: its colours are the app theme's until it sends its own.
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      titleBar?.reset(nativeTheme.shouldUseDarkColors);
    }
  });
  wc.on('will-frame-navigate', (event) => {
    const verdict = navigationVerdict(event.url, coreOrigin);
    if (verdict.action === 'allow') return;
    event.preventDefault();
    if (verdict.action === 'external' && event.isMainFrame) void openExternal(verdict.url);
    else log.info(`navigation blocked: ${originOf(event.url) ?? event.url.split(':')[0]}`);
  });
  wc.on('will-redirect', (event) => {
    if (navigationVerdict(event.url, coreOrigin).action !== 'allow') event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    const verdict = windowOpenVerdict(url, coreOrigin);
    if (verdict.action === 'external') void openExternal(verdict.url);
    return { action: 'deny' };
  });
  // The page asked to go to a core that is gone: the status page says it.
  wc.on('render-process-gone', (_e, details) => {
    log.info(`renderer gone: ${details.reason}`);
    const target = host()?.target;
    if (target && details.reason !== 'clean-exit') void showTarget(target);
  });
  // The title says which core the window shows (updateTooltip), not the page's.
  wc.on('page-title-updated', (event) => event.preventDefault());

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(w), 500);
  };
  w.on('resize', scheduleSave);
  w.on('move', scheduleSave);
  w.on('close', (event) => {
    saveWindowState(w);
    if (quitting) return;
    // Closing the window hides it: the agents keep working, the tray and the menu stay.
    event.preventDefault();
    w.hide();
    closeNoticeOnce();
  });
  return w;
}

/**
 * The first time the window is closed, say that Monsters keeps working and how to really quit
 * (audit UX 1.9): without a tray icon (GNOME without the extension) it would look gone.
 */
function closeNoticeOnce(): void {
  const marker = join(app.getPath('userData'), 'close-notice-shown');
  if (existsSync(marker)) return;
  try {
    writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
  } catch {
    // shown again next time
  }
  log.info('window closed for the first time: telling that Monsters keeps working');
  if (!Notification.isSupported()) return;
  const n = new Notification(closeNotice(isMac ? '⌘Q' : 'Ctrl+Q'));
  n.on('click', () => showWindow());
  n.show();
}

/** IPC from the preload: the caller must be our window, at the core's origin. */
function fromCore(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return fromCorePage(event, win?.webContents, coreOrigin);
}

/**
 * The notes folder of the core the window shows, only when it is this computer's core (owned
 * or attached, on `home`); null for a remote core or while no core is shown.
 */
function localVaultDir(): string | null {
  const target = host()?.target;
  if (link !== null || switcher?.choice !== LOCAL_CHOICE || !target || target.kind === 'remote') {
    return null;
  }
  return resolveVaultDir(home);
}

const fileOpens = new ExternalOpenLimiter();
/** A folder dialog is open for the web UI ("Scegli…"): a second call gets null. */
let pickingFolder = false;

/** Where the window is connected, for the web UI (ipc-guards.ts, audit UX 1.3). */
function currentTargetInfo() {
  return targetInfo(link, !!host()?.target);
}

/**
 * The app's language changed (D-153): menus, tray and dock, the connections window and the status
 * page (while it is the one shown) are built again, and the banner of a reconnection. Dialogs and
 * notifications take the language when they are shown.
 */
function applyLanguage(): void {
  buildMenus();
  connections?.relocalize();
  if (coreOrigin === null && lastStatusView) {
    shownStatus = '';
    showStatus(lastStatusView);
  }
  if (win && link?.status === 'reconnecting') {
    const text = bannerText(link);
    if (text) banner.show(win, text, 'busy');
  }
  notifyTarget();
}

/** Tells the core's page that the destination or its state changed. */
function notifyTarget(): void {
  if (!win || win.isDestroyed() || coreOrigin === null) return;
  const info = currentTargetInfo();
  const key = JSON.stringify(info);
  if (key === sentTarget) return;
  sentTarget = key;
  win.webContents.send('monsters:target-changed', info);
}

/** "Open at login" from the menus; says why when the system does not allow it. */
function toggleLoginItem(enabled: boolean): void {
  if (!loginItem) return;
  const state = loginItem.set(enabled);
  buildMenus();
  notifyLoginItem(state);
  if (!state.supported || state.enabled !== enabled || (enabled && state.note)) {
    const options = {
      type: state.supported ? ('info' as const) : ('warning' as const),
      message: state.supported ? loginItemStrings().label : loginItemStrings().unavailable,
      detail: state.note ?? loginItemStrings().couldntChange,
      noLink: true,
    };
    const parent = win && !win.isDestroyed() && win.isVisible() ? win : null;
    void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
  }
}

/** Tells the core's page that "Apri all'accesso" changed (from the menus). */
function notifyLoginItem(state: LoginItemState): void {
  if (!win || win.isDestroyed() || coreOrigin === null) return;
  win.webContents.send('monsters:login-item-changed', state);
}

function registerIpc(): void {
  ipcMain.handle('monsters:setup-code', async (event) => {
    if (!fromCore(event)) return null;
    return (await host()?.target?.setupCode()) ?? null;
  });
  ipcMain.handle('monsters:open-external', async (event, url: unknown) => {
    if (!fromCore(event) || typeof url !== 'string') return false;
    const verdict = windowOpenVerdict(url, coreOrigin);
    return verdict.action === 'external' ? openExternal(verdict.url) : false;
  });
  // The web UI of the core: "Connessioni…" and where the window is connected (audit UX 1.3).
  ipcMain.on('monsters:open-connections', (event) => {
    if (!fromCore(event)) return;
    log.info('connections opened from the web UI');
    connections?.open();
  });
  ipcMain.handle('monsters:target', (event) => (fromCore(event) ? currentTargetInfo() : null));
  // Preview pane: a file of the notes folder of THIS computer's core (file-open.ts).
  const shellForFiles = {
    openPath: (p: string) => shell.openPath(p),
    showItemInFolder: (p: string) => shell.showItemInFolder(p),
  };
  const fileLog = (line: string) => log.info(line);
  ipcMain.handle('monsters:open-file', async (event, path: unknown) => {
    if (!fromCore(event)) return false;
    if (!fileOpens.allow()) {
      log.info('file not opened (too many at once)');
      return false;
    }
    return openVaultFile(localVaultDir(), path, shellForFiles, fileLog);
  });
  ipcMain.handle('monsters:show-file', (event, path: unknown) => {
    if (!fromCore(event)) return false;
    if (!fileOpens.allow()) {
      log.info('file not shown (too many at once)');
      return false;
    }
    return showVaultFile(localVaultDir(), path, shellForFiles, fileLog);
  });
  // "Scegli…" of a project's folder: the system's folder dialog, only for THIS computer's
  // core (a path of this computer means nothing to a remote one), one dialog at a time.
  ipcMain.handle('monsters:pick-folder', async (event) => {
    if (!fromCore(event) || !win || localVaultDir() === null || pickingFolder) return null;
    pickingFolder = true;
    try {
      const res = await dialog.showOpenDialog(win, {
        title: appStrings().pickFolder,
        defaultPath: homedir(),
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      });
      return res.canceled ? null : (res.filePaths[0] ?? null);
    } finally {
      pickingFolder = false;
    }
  });
  // Only the status page (a data: URL loaded by this process) has these buttons.
  const fromStatusPage = (event: IpcMainEvent) => fromAppPage(event, win?.webContents);
  ipcMain.on('monsters:retry-core', (event) => {
    if (!fromStatusPage(event)) return;
    log.info('retry requested from the status page');
    host()?.retry();
  });
  ipcMain.on('monsters:status-action', (event, action: unknown) => {
    if (!fromStatusPage(event) || !isStatusAction(action)) return;
    void statusAction(action);
  });
  // Title bar overlay colours from the web UI (its theme may differ from the system's).
  ipcMain.on('monsters:title-bar-colors', (event, colors: unknown) => {
    if (!fromCore(event) || !titleBar) return;
    if (!titleBar.page(colors)) log.info('title bar colours refused (not #rrggbb)');
  });
  // The theme of the Settings (D-091): the whole app follows it, and it is kept for the next
  // start. Only from the core's page (local or remote), only system / light / dark.
  ipcMain.on('monsters:theme', (event, choice: unknown) => {
    if (!fromCore(event)) return;
    appTheme?.fromPage(choice);
  });
  // The app's language (D-153), sent by the core's page at start and when it changes: the
  // menus and the app's own pages follow it, and it is kept for the next start.
  ipcMain.on('monsters:language', (event, lang: unknown) => {
    if (!fromCore(event) || !isLang(lang)) return;
    store?.setLanguage(lang);
    if (lang === appLang()) return;
    log.info(`language: ${lang}`);
    setAppLang(lang, app.getLocale());
    applyLanguage();
  });
  // "Apri all'accesso" (D-095): from the core's page (local or remote, it is this computer's
  // app either way), only true or false; the answer is what the system says now.
  ipcMain.handle('monsters:login-item', (event) =>
    fromCore(event) ? (loginItem?.state() ?? null) : null,
  );
  ipcMain.handle('monsters:set-login-item', (event, enabled: unknown) => {
    if (!fromCore(event) || !loginItem) return null;
    const state = loginItem.fromPage(enabled);
    if (state) buildMenus();
    return state;
  });
  // The system theme changed, or the app's (themeSource).
  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors;
    titleBar?.system(dark);
    if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground(dark));
  });
}

// ---- Client mode (M3.3, D-047) ---------------------------------------------------------

/** One session per destination: cookies do not tell ports apart (D-044). */
const hardened = new Set<Session>();
function sessionFor(choice: TargetChoice): Session {
  const ses = session.fromPartition(
    choice === LOCAL_CHOICE ? 'persist:monsters-local' : `persist:remote-${choice}`,
  );
  if (!hardened.has(ses)) {
    hardenSession(ses);
    hardened.add(ses);
  }
  return ses;
}

/**
 * Before the local core the app started stops (another computer, "Esci", an update): asks
 * when work is in progress, or when that cannot be known (core-jobs.ts). True: go on.
 */
async function confirmStopLocal(
  dialogFor: (runs: number | null) => Electron.MessageBoxOptions,
  parent: BrowserWindow | null = win,
): Promise<boolean> {
  const target = host()?.target ?? null;
  if (switcher?.choice !== LOCAL_CHOICE || !target || target.kind !== 'owned') return true;
  const cli = readTextFile(homeFile(home, 'cliToken'))?.trim();
  let auth: CoreAuth | null = cli ? { bearer: cli } : null;
  if (!auth && coreSession) {
    const [cookie] = await coreSession.cookies.get({ url: target.url, name: SESSION_COOKIE });
    if (cookie) auth = { cookie: cookie.value };
  }
  const runs = await activeRunCount(target.url, auth);
  log.info(`work in progress on this computer: ${runs ?? 'unknown'}`);
  if (!shouldConfirmStop(target.kind, runs)) return true;
  const options = { ...dialogFor(runs), noLink: true };
  const { response } =
    parent && !parent.isDestroyed() && parent.isVisible()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
  return response === 0;
}

/** Shows `choice`; false when the user kept the current one (work in progress here). */
async function useTarget(
  choice: TargetChoice,
  opts: { force?: boolean; parent?: BrowserWindow | null } = {},
): Promise<boolean> {
  if (choice !== LOCAL_CHOICE && !store?.get(choice)) return false;
  const name =
    choice === LOCAL_CHOICE ? appStrings().menu.thisComputer : (store?.get(choice)?.name ?? '');
  if (choice !== switcher?.choice) {
    const ok = await confirmStopLocal((runs) => leaveLocalDialog(name, runs), opts.parent ?? win);
    if (!ok) {
      log.info(`switch to ${name} cancelled: work in progress on this computer`);
      return false;
    }
  }
  log.info(`switch requested: ${name}`);
  void switcher?.switchTo(choice, { force: opts.force === true });
  connections?.close();
  showWindow();
  return true;
}

/** The buttons of the status page besides "Try again". */
async function statusAction(action: StatusAction): Promise<void> {
  log.info(`status page: ${action}`);
  const h = host();
  const remote = h instanceof RemoteCore ? h : null;
  switch (action) {
    case 'local':
      await useTarget(LOCAL_CHOICE);
      return;
    case 'connections':
      connections?.open();
      return;
    case 'add-connection':
      connections?.open({ choice: null });
      return;
    case 'open-log':
      void shell.openPath(log.path);
      return;
    case 'fix': {
      if (!remote || link?.status !== 'failed') return;
      const { fix } = remoteFailureCopy(link.kind, remote.profile.name, remote.profile.host);
      connections?.open({ choice: remote.profile.id, ...(fix ? { field: fix } : {}) });
      return;
    }
    case 'forget-key':
      if (remote) await forgetKey(remote.profile);
      return;
  }
}

/** ssh's view of a profile (real address, port, user), from the app's ssh settings. */
function sshSettings(): { runner: ReturnType<typeof systemSshRunner>; configFile?: string } {
  const configFile = process.env['MONSTERS_DESKTOP_SSH_CONFIG'];
  return {
    runner: systemSshRunner(locateOpenSsh('ssh')),
    ...(configFile ? { configFile } : {}),
  };
}

/** "Dimentica la vecchia chiave" (host key changed): after a strong warning, then retry. */
async function forgetKey(profile: StoredProfile): Promise<void> {
  const parent = win && !win.isDestroyed() ? win : null;
  const warn = { ...forgetKeyDialog(profile.name), noLink: true };
  const { response } = parent
    ? await dialog.showMessageBox(parent, warn)
    : await dialog.showMessageBox(warn);
  if (response !== 0) return;
  const { runner, configFile } = sshSettings();
  const d = await sshDefaults(profile, runner, configFile);
  const file = join(app.getPath('userData'), 'known_hosts');
  const removed = d ? forgetHostKey(file, knownHostsNames(d)) : 0;
  log.info(`host key of "${profile.name}": ${removed} line(s) forgotten`);
  if (removed === 0) {
    const elsewhere = {
      ...keyElsewhereDialog(profile.name, d?.hostname ?? profile.host),
      noLink: true,
    };
    if (parent) await dialog.showMessageBox(parent, elsewhere);
    else await dialog.showMessageBox(elsewhere);
    return;
  }
  host()?.retry();
}

/** "Prova" in the connections window: a tunnel of its own; the current core keeps running. */
function tryConnection(
  profile: ConnectionProfile & { name: string },
  parent: BrowserWindow | null,
): ReturnType<typeof testConnection> {
  const options = tunnelOptions(app.getPath('userData'));
  return testConnection(profile, (p) =>
    openTunnel(p, {
      ...options,
      confirmHostKey: (info) =>
        confirmHostKey(parent ?? win, info, { ...profile, id: 'test', autoLogin: false }, (l) =>
          log.info(l),
        ),
    }),
  );
}

function createHost(choice: TargetChoice): CoreHost {
  const profile = choice === LOCAL_CHOICE ? null : store?.get(choice);
  if (!profile) {
    return new LocalCore({
      home,
      coreEntry: coreEntry(),
      spawn: spawnCore,
      locator: systemLocatorDeps(),
      fileExists: existsSync,
      log: (line) => log.info(line),
      logPath: log.path,
      rememberPort: (port) => {
        if (store?.corePort === port) return;
        log.info(`core: port ${port} kept for the next start`);
        store?.setCorePort(port);
      },
      dev: !app.isPackaged,
      supervisor: {
        keychain: keychainHost,
        ...(app.isPackaged ? { check: checkCoreFiles } : {}),
      },
    });
  }
  return new RemoteCore({
    profile,
    openTunnel: (p, options) => openTunnel(p, options),
    tunnelOptions: tunnelOptions(app.getPath('userData')),
    confirmHostKey: (info, p) => confirmHostKey(win, info, p, (line) => log.info(line)),
    log: (line) => log.info(line),
  });
}

/** The switcher opened `h` for `choice`: the window, its session and the events. */
function onActive(choice: TargetChoice, h: CoreHost): void {
  const ses = sessionFor(choice);
  link = h instanceof RemoteCore ? h.link : null;
  if (ses !== coreSession) {
    // A window keeps its session for life: a new one for the new destination.
    const old = win;
    banner.dispose();
    coreSession = ses;
    coreOrigin = null;
    shownStatus = '';
    if (old) saveWindowState(old);
    win = createWindow(ses);
    old?.destroy();
  }
  showStatus(
    h instanceof RemoteCore
      ? { kind: 'remote-connecting', name: h.profile.name }
      : { kind: 'starting' },
  );
  h.on('target', (target) => {
    if (host() === h) void showTarget(target);
  });
  h.on('down', (view) => {
    if (host() === h) showStatus(view);
  });
  if (h instanceof RemoteCore) h.on('link', (state) => onLink(h, state));
  store?.setLast(choice);
  buildMenus();
  connections?.refresh();
}

function onLink(h: RemoteCore, state: LinkState): void {
  if (host() !== h) return;
  const before = link;
  link = state;
  log.info(`link: ${state.status}${'attempt' in state ? ` (attempt ${state.attempt})` : ''}`);
  updateTooltip();
  buildMenus();
  connections?.refresh();
  notifyTarget();
  if (!win) return;
  const text = bannerText(state);
  if (state.status === 'reconnecting' && text) banner.show(win, text, 'busy');
  else if (state.status === 'connected' && before?.status === 'reconnecting' && text)
    banner.show(win, text, 'ok', 2500);
  else banner.hide();
  if (state.status === 'failed' && state.kind === 'host-key-changed') {
    void dialog.showMessageBox(win, { ...hostKeyChangedDialog(state.name) });
  }
}

/** A profile was saved or removed in the connections window. */
function profileChanged(id: string | null): void {
  const exists = id !== null && !!store?.get(id);
  if (id !== null && !exists) {
    // Removed: its cookies go too.
    void session
      .fromPartition(`persist:remote-${id}`)
      .clearStorageData()
      .catch(() => {});
  }
  if (id !== null && switcher?.choice === id) {
    // The profile in use changed: reconnect with the new settings, or go back home.
    if (exists) void switcher.switchTo(id, { force: true });
    else void switcher.switchTo(LOCAL_CHOICE);
  }
  buildMenus();
  connections?.refresh();
}

/** AppImage without Chromium's sandbox: say it (linux-sandbox.ts). False if the user quits. */
async function acceptSandboxNotice(): Promise<boolean> {
  if (!appImageWithoutSandbox({ platform: process.platform, argv: process.argv, env: process.env }))
    return true;
  log.info('Chromium sandbox off: AppImage on a system without user namespaces (use the .deb)');
  const accepted = sandboxNoticePath(app.getPath('userData'));
  if (existsSync(accepted)) return true;
  const { buttons, checkboxLabel, ...text } = sandboxNotice();
  const answer = await dialog.showMessageBox({
    type: 'warning',
    ...text,
    buttons: [...buttons],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel,
    noLink: true,
  });
  if (answer.response === 1) return false;
  if (answer.checkboxChecked) {
    try {
      writeFileSync(accepted, `${new Date().toISOString()}\n`, { mode: 0o600 });
    } catch {
      // asked again next time
    }
  }
  return true;
}

let notifiedVersion = '';
function onUpdateState(state: UpdateState): void {
  buildMenus();
  if (state.kind !== 'ready' || state.version === notifiedVersion) return;
  notifiedVersion = state.version;
  if (!Notification.isSupported()) return;
  const copy = updateReadyNotice(state.version);
  const n = new Notification({ title: copy.title, body: copy.body });
  // A click asks "Restart now / Later" (audit UX 1.10): the menu entry is easy to miss.
  n.on('click', () => void askToInstall(state.version));
  n.show();
}

let askingToInstall = false;
async function askToInstall(version: string): Promise<void> {
  if (askingToInstall || updater?.state.kind !== 'ready') return;
  askingToInstall = true;
  try {
    const options = { ...updateReadyDialog(version, { password: debUpdates }), noLink: true };
    const parent = win && !win.isDestroyed() && win.isVisible() ? win : null;
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    log.info(`update ${version}: ${response === 0 ? 'restart now' : 'later'}`);
    if (response === 0) await installUpdate();
  } finally {
    askingToInstall = false;
  }
}

/**
 * Stops what the app runs (the local core if the app started it, or the SSH tunnel: a remote
 * core keeps running) once: "Esci" pressed twice, or during an update, waits for the same stop
 * instead of letting Electron exit with the core half stopped.
 */
let stopping: Promise<void> | null = null;
function stopAll(): Promise<void> {
  stopping ??= (async () => {
    quitting = true;
    banner.dispose();
    connections?.close();
    try {
      await switcher?.shutdown();
    } catch (err) {
      log.info(`stop: ${(err as Error).message}`);
    }
    cleanedUp = true;
    tray?.destroy();
    tray = null;
  })();
  return stopping;
}

/** Stops the core and lets the app quit for an update (updater.ts). */
async function prepareForUpdate(): Promise<void> {
  await stopAll();
  // The new version may start before this process is gone.
  app.releaseSingleInstanceLock();
}

/** "Riavvia per aggiornare" from the menus; says why when the update cannot be installed. */
async function installUpdate(): Promise<void> {
  if (!(await confirmStopLocal((runs) => quitDialog(runs, 'update')))) {
    log.info('update postponed: work in progress on this computer');
    return;
  }
  const result = await updater?.install();
  const state = updater?.state;
  if (result === 'refused' && state?.kind === 'error') {
    void dialog.showMessageBox({
      type: 'warning',
      message: appStrings().update.cannotInstall,
      detail: `${state.message.charAt(0).toUpperCase()}${state.message.slice(1)}.`,
    });
  }
}

/** Installed from the .deb: updates ask the computer's password (D-105). */
let debUpdates = false;
/** The feed in use, and whether this is an update e2e build (the only one with the test env). */
let updateFeed: string | null = null;
let updateTestBuild = false;

/** A .deb update not installed: what happened and the way to do it by hand (copyable). */
async function tellDebFailure(report: DebFailureReport): Promise<void> {
  const { command, ...d } = debFailureDialog(report);
  log.info(`updates: told the user: ${d.message}`);
  // The update e2e clicks nothing.
  if (updateTestBuild && process.env['MONSTERS_UPDATE_AUTO_INSTALL'] === '1') return;
  let detail = d.detail;
  for (let shown = 0; shown < 5; shown++) {
    const options = { ...d, detail, noLink: true };
    const parent = win && !win.isDestroyed() && win.isVisible() ? win : null;
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    const button = d.buttons[response];
    if (button === debFailureButtons()[0] && command) {
      try {
        await clipboard.writeText(command);
        log.info('updates: install command copied');
        // Shown again: the link is still there, and the user sees the copy happened.
        detail = `${appStrings().update.commandCopied}\n\n${d.detail}`;
      } catch (err) {
        log.info(`updates: cannot copy the command: ${(err as Error).message}`);
      }
      continue;
    }
    if (button === debFailureButtons()[1] && report.update.url) {
      // Through the same filter as every link, and only to the origin of the feed.
      if (isFeedOrigin(report.update.url, updateFeed)) void openExternal(report.update.url);
      else log.info('updates: link not opened (not on the origin of the feed)');
    }
    return;
  }
}

function startUpdater(): void {
  const setup: UpdateSetup = updateSetup({
    isPackaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
    resourcesPath: process.resourcesPath,
    fileExists: existsSync,
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
  });
  debUpdates = setup.enabled && setup.deb;
  updateFeed = setup.enabled ? setup.feed : null;
  updateTestBuild = setup.enabled && setup.testBuild;
  if (debUpdates) {
    // Defense in depth: our install never calls DebUpdater.doInstall (deb-install.ts; no install
    // on quit, no quitAndInstall). Should it ever run, it must take dpkg, never its apt path
    // (`apt install --allow-unauthenticated --allow-downgrades`).
    process.env['ELECTRON_BUILDER_LINUX_PACKAGE_MANAGER'] = 'dpkg';
  }
  // The keys this build trusts for the signature of the feed (update-signature.ts, S-A4).
  let keys: ReturnType<typeof loadPublicKeys> = [];
  if (setup.enabled) {
    // A broken file is skipped (and said): the other keys still verify.
    keys = loadPublicKeys(join(process.resourcesPath, UPDATE_KEYS_DIR), (file, error) =>
      log.info(`updates: update key ${file} skipped: ${error}`),
    );
    log.info(`updates: ${keys.length} update signing key(s) trusted`);
  }
  const fetchText: FetchText = async (url) => {
    const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).pathname}`);
    return res.text();
  };
  // electron-updater reads the feed only through this (signed-provider.ts): one read, verified.
  const signedFeed = new SignedFeed({
    feed: setup.enabled ? setup.feed : null,
    channelFile: channelFileName(
      setup.enabled ? setup.channel : 'alpha',
      process.platform,
      process.arch,
    ),
    keys,
    fetchText,
  });
  updater = new Updater({
    setup,
    feedOptions: signedFeed.publishOptions(setup.enabled ? setup.channel : 'alpha'),
    verify: (info) => signedFeed.verify(info),
    hashFile: (path) =>
      new Promise((resolve, reject) => {
        const h = createHash('sha512');
        createReadStream(path)
          .on('error', reject)
          .on('data', (chunk) => h.update(chunk))
          .on('end', () => resolve(h.digest('base64')));
      }),
    discardDownload: (path) => {
      // electron-updater keeps the download in `<cache>/pending/`: all of it goes.
      const dir = dirname(path);
      rmSync(basename(dir) === 'pending' ? dir : path, { recursive: true, force: true });
    },
    currentVersion: app.getVersion(),
    onDebFailed: tellDebFailure,
    restart: () => {
      // Not an AppImage: the binary in /opt is the new one, and Electron's relauncher works.
      app.relaunch({ args: relaunchArgs(process.argv.slice(1)) });
      app.quit();
    },
    backend: () => autoUpdater,
    // macOS: Squirrel.Mac stages the update after electron-updater says it downloaded it.
    ...(process.platform === 'darwin' ? { nativeUpdater } : {}),
    debDepends: (update) => missingDepends(update.file),
    log: (line) => log.info(line),
    onChange: onUpdateState,
    beforeInstall: prepareForUpdate,
    relaunch: (execPath) => {
      log.info(`updates: starting ${execPath} after exit`);
      spawnAfterExit(execPath, relaunchArgs(process.argv.slice(1)));
    },
    onInstallFailed: (appImage) => {
      // `app.relaunch` does not work from an AppImage (see spawnAfterExit): the file restored
      // by the updater is started once this process is gone.
      if (appImage) spawnAfterExit(appImage, relaunchArgs(process.argv.slice(1)));
      else if (process.platform === 'linux' && process.env['APPIMAGE']) {
        dialog.showErrorBox(appStrings().update.failedTitle, appStrings().update.fileGone);
      } else app.relaunch();
      app.quit();
    },
    onManualResult: (result) => {
      const options = { ...manualCheckDialog(result, app.getVersion()), noLink: true };
      const parent = win && !win.isDestroyed() && win.isVisible() ? win : null;
      void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
    },
    autoInstall: updateTestBuild && process.env['MONSTERS_UPDATE_AUTO_INSTALL'] === '1',
  });
  updater.start();
}

async function start(): Promise<void> {
  ensurePrivateDir(home);
  log.info(startedLine(app.getVersion(), process.versions.electron, home));
  if (!(await acceptSandboxNotice())) {
    log.info('quitting: the user declined to run without the sandbox');
    cleanedUp = true;
    app.quit();
    return;
  }
  store = new ProfileStore(join(app.getPath('userData'), 'connections.json'), {
    log: (line) => log.info(line),
  });
  const first = store.last;
  // Before the first window and the menus (D-153).
  setAppLang(appLanguage(), app.getLocale());
  // Before the first window: its background, title bar and status page take the theme.
  appTheme = new AppTheme({
    store,
    apply: (source) => {
      nativeTheme.themeSource = source;
    },
    env: systemTheme,
    log: (line) => log.info(line),
  });
  appTheme.start();
  loginItem = new LoginItem({
    platform: process.platform,
    env: process.env,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    homedir: homedir(),
    backend: {
      get: (options) => app.getLoginItemSettings(options),
      set: (settings) => app.setLoginItemSettings(settings),
    },
    log: (line) => log.info(line),
  });
  loginItem.refresh();
  // Opened at login: hidden, unless the first start still has to ask where the monsters work.
  startHidden =
    !store.firstStart &&
    startsHidden(process.argv, isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  if (startHidden) log.info('opened at login: the window stays hidden (tray only)');
  coreSession = sessionFor(first);
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // WebRTC sends UDP whatever the page's CSP says (a STUN request from a monster's page in
    // the preview pane, review of 16/10, D-085): no UDP that does not go through a proxy, and
    // no local address in the candidates. TCP to a TURN server stays possible: the lockdown
    // script of the core's HTML pages takes RTCPeerConnection away for that.
    contents.setWebRTCIPHandlingPolicy(WEBRTC_IP_POLICY);
  });
  registerIpc();
  connections = new ConnectionsWindow({
    preload: PRELOAD,
    store,
    view: () =>
      connectionsView({
        current: switcher?.choice ?? null,
        link,
        localReady: !!host()?.target,
        home,
        profiles: store?.list() ?? [],
      }),
    use: (choice, parent) => useTarget(choice, { parent }),
    checkHost: (profile) => {
      const { runner, configFile } = sshSettings();
      return hostCheck(profile, runner, systemLookup, configFile);
    },
    test: tryConnection,
    defaults: async (profile) => {
      const { runner, configFile } = sshSettings();
      const d = await sshDefaults(profile, runner, configFile);
      return d ? { user: d.user, port: d.port } : null;
    },
    changed: profileChanged,
    log: (line) => log.info(line),
    chrome,
    ...(isMac ? {} : { icon: join(ASSETS, 'icon.png') }),
  });
  win = createWindow(coreSession);
  switcher = new TargetSwitcher<TargetChoice>({
    create: createHost,
    log: (line) => log.info(line),
    // A profile removed while the switch to it was closing the previous core: "Questo computer".
    available: (choice) => choice === LOCAL_CHOICE || !!store?.get(choice),
    fallback: LOCAL_CHOICE,
  });
  switcher.on('active', onActive);
  buildMenus();
  // Wake from sleep or network back: check the SSH link at once (D-044, point 4).
  watchWakeAndNetwork((why) => {
    // A VPN or another network may bring another proxy: for the next start of the core.
    void refreshCoreProxy();
    const h = host();
    if (!(h instanceof RemoteCore)) return;
    log.info(`${why}: checking the link`);
    h.reconnectNow();
  });
  startUpdater();
  // The system proxy before the first start of the core (the session answers once ready).
  await refreshCoreProxy();
  if (store.firstStart) {
    // Nothing chosen yet: ask before starting any core (audit UX 1.2).
    log.info('first start: asking where the monsters work');
    showStatus({ kind: 'welcome' });
    return;
  }
  await switcher.switchTo(first);
}

/**
 * `start()` failed (e.g. a MONSTERS_HOME that cannot be written): say it and quit, instead of
 * staying as an invisible process that holds the single-instance lock.
 */
async function startFailed(err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Monsters cannot start: ${message}\n`);
  log.info(`start failed: ${message}`);
  app.releaseSingleInstanceLock();
  await stopAll();
  win?.destroy();
  win = null;
  await dialog
    .showMessageBox({
      type: 'error',
      message: appStrings().startFailed.message,
      detail: appStrings().startFailed.detail(home, message),
      buttons: [appStrings().startFailed.quit],
    })
    .catch(() => {});
  app.exit(1);
}

/** Longest wait for the core to stop on quit, then the app quits anyway. */
const QUIT_TIMEOUT_MS = 20_000;
/** macOS is logging out or shutting down: quitting must not be held up (it would cancel it). */
let systemShuttingDown = false;

if (debugVerdict.action === 'refuse') {
  const line = `refusing to start: ${debugVerdict.switches.map((s) => `--${s}`).join(' ')} (${debugVerdict.reason})`;
  process.stderr.write(`Monsters: ${line}\n`);
  log.info(line);
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  // A second launch: the first instance shows its window (second-instance below).
  app.quit();
} else {
  if (debugVerdict.debugging) log.info('DevTools protocol on (throwaway data directory)');
  // A second launch shows the window; a second start at login does not.
  app.on('second-instance', (_e, argv) => {
    if (!startsHidden(argv)) showWindow();
  });
  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {
    // The window only hides; when it is really gone the app is quitting anyway.
  });
  let askingToQuit = false;
  app.on('before-quit', (event) => {
    if (cleanedUp || !switcher) {
      quitting = true;
      return;
    }
    if (systemShuttingDown) {
      // Best effort: the stop starts, the quit goes on (the core's lock is checked by pid).
      quitting = true;
      log.info('quitting: the system is shutting down');
      void stopAll();
      return;
    }
    event.preventDefault();
    // "Esci" again, or during an update: the stop under way quits the app when it is done.
    if (stopping || askingToQuit) return;
    // Work in progress on the core the app started: ask first (audit UX 1.9).
    askingToQuit = true;
    void confirmStopLocal((runs) => quitDialog(runs))
      .catch(() => true)
      .then((ok) => {
        askingToQuit = false;
        if (ok) beginQuit();
        else log.info('quit cancelled: work in progress on this computer');
      });
  });
  const beginQuit = () => {
    quitting = true;
    log.info('quitting');
    const timer = setTimeout(() => {
      log.info(`quit: still stopping after ${QUIT_TIMEOUT_MS / 1000}s, quitting anyway`);
      cleanedUp = true;
      app.quit();
    }, QUIT_TIMEOUT_MS);
    void stopAll().finally(() => {
      clearTimeout(timer);
      app.quit();
    });
  };
  void app
    .whenReady()
    .then(() => {
      if (isMac) {
        powerMonitor.on('shutdown', () => {
          systemShuttingDown = true;
        });
      }
      return start();
    })
    .catch(startFailed);
}
