import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import type { ConnectionProfile } from '@monsters/remote';
import type { TestResult } from './connection-check.ts';
import { fromAppPage } from './ipc-guards.ts';
import { connectionsPageUrl, type ConnectionsView, type FormRequest } from './connections-page.ts';
import { LOCAL_CHOICE, parseProfileForm, withSshAlias, type ProfileStore } from './profiles.ts';
import {
  titleBarOptions,
  TitleBarState,
  windowBackground,
  type WindowChrome,
} from './title-bar.ts';

/*
 * The "Connessioni" window (M3.3, D-047): the profiles of the client mode and the choice of
 * the core. Hardened like the main window (sandbox, context isolation, no navigation, no
 * new windows, every permission denied) and in a session of its own without storage. The
 * page is a data: URL built by the app; the IPC handlers answer only to that window's main
 * frame, so neither the web UI of a core (local or remote) nor anything else can call them.
 * Same integrated title bar as the main window (D-056); its page follows the app's theme (the
 * Settings' choice, or the system: `nativeTheme.themeSource`, D-091), and so do the overlay's
 * colours. Besides list, save, remove and use: "Prova" (a tunnel of
 * its own, the destination unchanged), the defaults of ssh for the advanced options, and a
 * form to open with the window ("Aggiungi un computer" at the first start, "Correggi la
 * connessione" after a failure).
 */

export interface ConnectionsDeps {
  preload: string;
  store: ProfileStore;
  view(): ConnectionsView;
  /** Switch the app to `choice` (`local` or a profile id); false if the user cancelled. */
  use(choice: string, parent: BrowserWindow | null): Promise<boolean> | boolean;
  /** At save time: a message when the address is unknown to the DNS (shown once). */
  checkHost(profile: ConnectionProfile): Promise<string | null>;
  /** "Prova": a tunnel of its own, opened and closed; the current destination stays. */
  test(
    profile: ConnectionProfile & { name: string },
    parent: BrowserWindow | null,
  ): Promise<TestResult>;
  /** What ssh would use for this host (placeholders of the advanced options). */
  defaults(
    profile: Pick<ConnectionProfile, 'host' | 'user' | 'sshPort'>,
  ): Promise<{ user: string; port: number } | null>;
  /** A profile changed or was removed (menus, current connection). */
  changed(id: string | null): void;
  /** The user's SSH config (aliases for an address typed by hand); default `~/.ssh/config`. */
  sshConfig?(): string | null;
  log(line: string): void;
  /** The window chrome of the app (title-bar.ts). */
  chrome: WindowChrome;
  icon?: string;
}

export class ConnectionsWindow {
  readonly #d: ConnectionsDeps;
  #win: BrowserWindow | null = null;
  #titleBar: TitleBarState | null = null;
  /** The form to open at the next list (a new computer, or a profile to fix). */
  #formRequest: FormRequest | null = null;

  constructor(deps: ConnectionsDeps) {
    this.#d = deps;
    this.#registerIpc();
    nativeTheme.on('updated', () => {
      const win = this.#win;
      if (!win || win.isDestroyed()) return;
      this.#titleBar?.system(nativeTheme.shouldUseDarkColors);
      win.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
    });
  }

  get window(): BrowserWindow | null {
    return this.#win;
  }

  /** Opens (or brings forward) the window; `form` opens the form too, on a field. */
  open(form?: FormRequest): void {
    if (form) this.#formRequest = form;
    if (this.#win && !this.#win.isDestroyed()) {
      this.#win.show();
      this.#win.focus();
      if (form) this.refresh();
      return;
    }
    const ses = session.fromPartition('monsters-connections');
    ses.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BrowserWindow({
      width: 560,
      height: 680,
      minWidth: 420,
      minHeight: 420,
      show: false,
      title: 'Connessioni',
      autoHideMenuBar: true,
      backgroundColor: windowBackground(dark),
      ...titleBarOptions(this.#d.chrome, dark),
      ...(this.#d.icon ? { icon: this.#d.icon } : {}),
      webPreferences: {
        preload: this.#d.preload,
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: false,
        devTools: !app.isPackaged,
        additionalArguments: ['--monsters-page=connections'],
      },
    });
    const wc = win.webContents;
    wc.on('will-frame-navigate', (e) => e.preventDefault());
    wc.on('will-redirect', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (this.#win === win) {
        this.#win = null;
        this.#titleBar = null;
      }
    });
    this.#win = win;
    this.#titleBar = new TitleBarState(this.#d.chrome, (colors) => {
      if (!win.isDestroyed()) win.setTitleBarOverlay(colors);
    });
    void win
      .loadURL(connectionsPageUrl(this.#d.chrome))
      .catch((err: Error) => this.#d.log(`connections: ${err.message}`));
  }

  /** Tells the page to reload its list (state of the link, profiles). */
  refresh(): void {
    const win = this.#win;
    if (win && !win.isDestroyed()) win.webContents.send('connections:changed');
  }

  close(): void {
    if (this.#win && !this.#win.isDestroyed()) this.#win.destroy();
    this.#win = null;
  }

  #sshConfig(): string | null {
    if (this.#d.sshConfig) return this.#d.sshConfig();
    try {
      return readFileSync(join(homedir(), '.ssh', 'config'), 'utf8');
    } catch {
      return null;
    }
  }

  #fromPage(event: IpcMainInvokeEvent): boolean {
    const win = this.#win;
    return !!win && !win.isDestroyed() && fromAppPage(event, win.webContents);
  }

  #registerIpc(): void {
    ipcMain.handle('connections:list', (event) => {
      if (!this.#fromPage(event)) return null;
      const view = this.#d.view();
      const form = this.#formRequest;
      this.#formRequest = null;
      return form ? { ...view, form } : view;
    });
    ipcMain.handle('connections:save', async (event, typed: unknown) => {
      if (!this.#fromPage(event)) return { ok: false, errors: {} };
      const form = withSshAlias(typed, this.#sshConfig());
      // An address the DNS does not know: said once, saved when the user insists (`force`).
      const parsed = parseProfileForm(form);
      const force =
        typeof form === 'object' && form !== null && (form as { force?: unknown }).force === true;
      if (parsed.ok && !force) {
        const warning = await this.#d.checkHost(parsed.profile).catch(() => null);
        if (warning) return { ok: false, errors: {}, warnings: { host: warning } };
      }
      const result = this.#d.store.save(form);
      if (!result.ok) return result;
      this.#d.log(`connections: saved "${result.profile.name}"`);
      this.#d.changed(result.profile.id);
      return { ok: true, id: result.profile.id };
    });
    ipcMain.handle('connections:remove', (event, id: unknown) => {
      if (!this.#fromPage(event) || typeof id !== 'string') return false;
      const name = this.#d.store.get(id)?.name;
      const removed = this.#d.store.remove(id);
      if (removed) {
        this.#d.log(`connections: removed "${name ?? id}"`);
        this.#d.changed(id);
      }
      return removed;
    });
    ipcMain.handle('connections:use', async (event, choice: unknown) => {
      if (!this.#fromPage(event) || typeof choice !== 'string') return false;
      if (choice !== LOCAL_CHOICE && !this.#d.store.get(choice)) return false;
      return this.#d.use(choice, this.#win);
    });
    ipcMain.handle('connections:test', async (event, form: unknown) => {
      if (!this.#fromPage(event)) return null;
      const parsed = parseProfileForm(withSshAlias(form, this.#sshConfig()));
      if (!parsed.ok) return { ok: false, errors: parsed.errors };
      const { autoLogin: _autoLogin, ...profile } = parsed.profile;
      this.#d.log(`connections: trying "${profile.name}"`);
      const result = await this.#d.test(profile, this.#win);
      this.#d.log(`connections: try of "${profile.name}": ${result.ok ? 'ok' : result.kind}`);
      return result;
    });
    ipcMain.handle('connections:defaults', async (event, input: unknown) => {
      if (!this.#fromPage(event) || typeof input !== 'object' || input === null) return null;
      const i = input as Record<string, unknown>;
      const host = typeof i['host'] === 'string' ? i['host'].trim() : '';
      if (!host || host.length > 255) return null;
      const at = host.lastIndexOf('@');
      const user = typeof i['user'] === 'string' && i['user'].trim() ? i['user'].trim() : undefined;
      const port =
        typeof i['sshPort'] === 'string' && /^\d{1,5}$/.test(i['sshPort'].trim())
          ? Number(i['sshPort'].trim())
          : undefined;
      const u = user ?? (at > 0 ? host.slice(0, at) : undefined);
      // Same rules as the profile: never something ssh would read as an option.
      if (u !== undefined && (u.startsWith('-') || /\s/.test(u) || u.length > 64)) return null;
      const bare = at > 0 ? host.slice(at + 1) : host;
      // What "Salva" will use: the alias of the SSH config for this address, if any.
      const alias = u === undefined ? withSshAlias({ host: bare }, this.#sshConfig()) : null;
      return this.#d
        .defaults({
          host: (alias as { host?: string } | null)?.host ?? bare,
          ...(u ? { user: u } : {}),
          ...(port !== undefined && port > 0 && port < 65_536 ? { sshPort: port } : {}),
        })
        .catch(() => null);
    });
    ipcMain.handle('connections:pick-key', async (event) => {
      if (!this.#fromPage(event) || !this.#win) return null;
      const res = await dialog.showOpenDialog(this.#win, {
        title: 'Scegli la chiave privata SSH',
        defaultPath: join(homedir(), '.ssh'),
        properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
      });
      return res.canceled ? null : (res.filePaths[0] ?? null);
    });
  }
}
