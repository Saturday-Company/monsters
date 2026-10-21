import { contextBridge, ipcRenderer } from 'electron';

/*
 * The only bridge between the pages and the app (sandboxed preload, context isolation).
 * In the main window: a "desktop" flag with the app version and the window chrome, the
 * setup code for the first start, opening a web link in the system browser, opening (or
 * showing in its folder) a file of the notes folder with the system, the colours of
 * the title bar overlay (Windows and Linux, D-056), the "Connessioni" window and where the
 * window is connected (audit UX 1.3), and the buttons of the app's own pages (status page and
 * first start: "Riprova", "Usa questo computer", "Connessioni…"…). In the connections window
 * (`--monsters-page=connections`, M3.3): the connection profiles, the choice of the core and
 * "Prova", nothing else. The main process checks who calls (index.ts and ipc-guards.ts,
 * connections-window.ts): the web UI of the core only reaches its own calls, the app's pages
 * only theirs. Nothing here gives a page Node or the content of a file.
 *
 * Contract for the web UI (apps/web/src/lib/desktop.ts, all optional there: older apps lack
 * them), answered only to the main frame of the main window at the core's origin:
 * - `openConnections(): void` opens (or brings forward) the "Connessioni" window;
 * - `target(): Promise<TargetInfo | null>` where the window is connected now;
 * - `onTargetChange(listener: (info: TargetInfo) => void): () => void` calls `listener` when
 *   the destination's state changes while the page is shown (e.g. `reconnecting`); returns the
 *   function that stops listening. Changing computer loads a new page (a new window).
 * - `openFile(path: string): Promise<boolean>` "Apri con il sistema" for a file of the notes
 *   folder, `path` relative to it as in the core's FileMeta (`File/2026-10/foto.png`): true
 *   when the system's default app opened it. False when the window shows a remote core, when
 *   the path is not an existing regular file under `File/` (symlinks resolved), or when the
 *   file could run (executable extension or execute bit): then it is shown in its folder;
 * - `showFileInFolder(path: string): Promise<boolean>` "Mostra nella cartella": the same
 *   checks, then the file selected in the file manager (true).
 * - `pickFolder(): Promise<string | null>` "Scegli…" of a project's folder: the system's folder
 *   dialog, the absolute path chosen. Null when cancelled, when the window shows a remote core
 *   (a path of this computer means nothing there) or while another dialog is open.
 * - `setTheme(choice: 'system' | 'light' | 'dark'): void` the theme chosen in the Settings
 *   (the choice, not the resolved theme), sent at start and when it changes: the app's own
 *   pages and windows follow it, and it is kept for the next start (main/app-theme.ts, D-091).
 * - `loginItem(): Promise<LoginItemState | null>` "Apri all'accesso" as the system has it now;
 * - `setLoginItem(enabled: boolean): Promise<LoginItemState | null>` turns it on or off (only
 *   true or false) and answers with the system's state after the change;
 * - `onLoginItemChange(listener: (state: LoginItemState) => void): () => void` the change made
 *   from the app's menus while the page is shown (main/login-item.ts, D-095).
 * `LoginItemState` = `{ supported: boolean; enabled: boolean; note?: string }`.
 * `TargetInfo` = `{ kind: 'local' | 'remote'; name: string; state: 'ready' | 'starting' |
 * 'connecting' | 'reconnecting' | 'offline' }`; `name` is "Questo computer" or the name the
 * user gave the connection (main/ipc-guards.ts). Files: main/file-open.ts.
 */

/**
 * The window chrome (main/title-bar.ts): `inset` macOS without a title bar (traffic lights
 * over the page), `overlay` Windows and Linux with the system buttons over the top right of
 * the page, `frame` the normal system frame.
 */
type Chrome = 'inset' | 'overlay' | 'frame';
const CHROMES: readonly string[] = ['inset', 'overlay', 'frame'];

interface Info {
  version: string;
  platform: string;
  chrome: Chrome;
}

function readInfo(): Info {
  const arg = process.argv.find((a) => a.startsWith('--monsters-desktop='));
  try {
    const parsed = JSON.parse(arg?.slice('--monsters-desktop='.length) ?? '{}') as Partial<Info>;
    return {
      version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
      platform: typeof parsed.platform === 'string' ? parsed.platform : process.platform,
      chrome:
        typeof parsed.chrome === 'string' && CHROMES.includes(parsed.chrome)
          ? parsed.chrome
          : 'frame',
    };
  } catch {
    return { version: '0.0.0', platform: process.platform, chrome: 'frame' };
  }
}

if (process.argv.includes('--monsters-page=connections')) {
  contextBridge.exposeInMainWorld(
    'monstersConnections',
    Object.freeze({
      list: (): Promise<unknown> => ipcRenderer.invoke('connections:list'),
      save: (form: unknown): Promise<unknown> => ipcRenderer.invoke('connections:save', form),
      remove: (id: string): Promise<boolean> =>
        ipcRenderer.invoke('connections:remove', String(id)),
      use: (choice: string): Promise<boolean> =>
        ipcRenderer.invoke('connections:use', String(choice)),
      pickKey: (): Promise<string | null> => ipcRenderer.invoke('connections:pick-key'),
      test: (form: unknown): Promise<unknown> => ipcRenderer.invoke('connections:test', form),
      defaults: (input: unknown): Promise<unknown> =>
        ipcRenderer.invoke('connections:defaults', input),
      onChange: (listener: () => void): void => {
        ipcRenderer.on('connections:changed', () => listener());
      },
    }),
  );
} else {
  const info = readInfo();
  contextBridge.exposeInMainWorld(
    'monstersDesktop',
    Object.freeze({
      isDesktop: true,
      version: info.version,
      platform: info.platform,
      chrome: info.chrome,
      setupCode: (): Promise<string | null> => ipcRenderer.invoke('monsters:setup-code'),
      openExternal: (url: string): Promise<boolean> =>
        ipcRenderer.invoke('monsters:open-external', String(url)),
      openFile: (path: string): Promise<boolean> =>
        ipcRenderer.invoke('monsters:open-file', String(path)),
      showFileInFolder: (path: string): Promise<boolean> =>
        ipcRenderer.invoke('monsters:show-file', String(path)),
      pickFolder: (): Promise<string | null> => ipcRenderer.invoke('monsters:pick-folder'),
      retryCore: (): void => ipcRenderer.send('monsters:retry-core'),
      openConnections: (): void => ipcRenderer.send('monsters:open-connections'),
      target: (): Promise<unknown> => ipcRenderer.invoke('monsters:target'),
      onTargetChange: (listener: (info: unknown) => void): (() => void) => {
        const handler = (_event: unknown, info: unknown) => {
          if (typeof listener === 'function') listener(info);
        };
        ipcRenderer.on('monsters:target-changed', handler);
        return () => {
          ipcRenderer.removeListener('monsters:target-changed', handler);
        };
      },
      statusAction: (action: string): void =>
        ipcRenderer.send('monsters:status-action', String(action)),
      // `system`, `light` or `dark`, checked again by the main process.
      setTheme: (choice: string): void => ipcRenderer.send('monsters:theme', String(choice)),
      // `en` or `it`, checked again by the main process (D-153).
      setLanguage: (lang: string): void => ipcRenderer.send('monsters:language', String(lang)),
      // A boolean only, checked again by the main process.
      loginItem: (): Promise<unknown> => ipcRenderer.invoke('monsters:login-item'),
      setLoginItem: (enabled: boolean): Promise<unknown> =>
        ipcRenderer.invoke('monsters:set-login-item', enabled === true),
      onLoginItemChange: (listener: (state: unknown) => void): (() => void) => {
        const handler = (_event: unknown, state: unknown) => {
          if (typeof listener === 'function') listener(state);
        };
        ipcRenderer.on('monsters:login-item-changed', handler);
        return () => {
          ipcRenderer.removeListener('monsters:login-item-changed', handler);
        };
      },
      // `#rrggbb` only, checked again by the main process; a no-op on macOS.
      setTitleBarColors: (colors: { background: string; symbol: string }): void => {
        const c = (typeof colors === 'object' && colors !== null ? colors : {}) as Partial<
          Record<'background' | 'symbol', unknown>
        >;
        ipcRenderer.send('monsters:title-bar-colors', {
          background: String(c.background),
          symbol: String(c.symbol),
        });
      },
    }),
  );
}
