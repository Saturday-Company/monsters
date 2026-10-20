/*
 * Inside the desktop app (apps/desktop, M3.1) the preload exposes `window.monstersDesktop`:
 * the app version, the window chrome and a few calls. In a browser it is absent and the UI
 * behaves as always.
 */

/**
 * How the window draws its title bar (docs/design.md, "Barra del titolo integrata"):
 * - `inset`: macOS, no title bar, the traffic lights over the top-left of the sidebar;
 * - `overlay`: Windows and Linux, no title bar, the system buttons drawn over the top
 *   right of the page (`titleBarOverlay`, room given by `env(titlebar-area-*)`);
 * - `frame`: a normal window frame, nothing to leave free.
 */
export type DesktopChrome = 'inset' | 'overlay' | 'frame';

export interface TitleBarColors {
  /** Background of the system buttons: the theme's `--chassis` (the top rail), as `#rrggbb`. */
  background: string;
  /** Their symbols: the theme's `--ink`, as `#rrggbb`. */
  symbol: string;
}

/** The theme chosen in the Settings, as the app takes it (the choice, not the resolved theme). */
export type DesktopTheme = 'system' | 'light' | 'dark';

export interface DesktopBridge {
  isDesktop: true;
  version: string;
  platform: string;
  chrome: DesktopChrome;
  /** The one-time setup code of the first start, read by the app from the data directory. */
  setupCode(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  /**
   * Colours of the overlay buttons (`chrome: 'overlay'`), sent at start and at every theme
   * change. Optional: older apps and the other chromes do not have it.
   */
  setTitleBarColors?(colors: TitleBarColors): void;
  /**
   * The theme of the Settings for the app's own pages and windows (first start, status page,
   * "Connessioni", window background), kept by the app for its next start. Sent at start and
   * when the choice changes; "Sistema" lets the app follow the system again. Absent in older
   * apps (apps/desktop/src/main/app-theme.ts, D-091).
   */
  setTheme?(choice: DesktopTheme): void;
  /**
   * "Apri all'accesso" of this computer's app, as the system has it now (null if the app
   * refuses the caller). Absent in older apps (apps/desktop/src/main/login-item.ts, D-095).
   */
  loginItem?(): Promise<DesktopLoginItem | null>;
  /** Turns it on or off; the answer is the system's state after the change. */
  setLoginItem?(enabled: boolean): Promise<DesktopLoginItem | null>;
  /** The change made from the app's menus while this page is shown; returns the unsubscribe. */
  onLoginItemChange?(listener: (state: DesktopLoginItem) => void): () => void;
  /** Opens (or brings forward) the app's "Connessioni" window. Absent in older apps. */
  openConnections?(): void;
  /** Where the window is connected now (null if the app refuses the caller). */
  target?(): Promise<DesktopTarget | null>;
  /**
   * Calls `listener` when the destination's state changes while this page is shown; returns
   * the function that stops listening. Changing computer loads a new page.
   */
  onTargetChange?(listener: (target: DesktopTarget) => void): () => void;
  /**
   * Opens a file of the notes folder with its program (`path` relative to the
   * notes folder, `FileMeta.path`, under `File/`). Only for this computer's
   * core; a file that could run is shown in its folder instead (false).
   * Absent in older apps (D-075).
   */
  openFile?(path: string): Promise<boolean>;
  /** Shows that file in the system's file manager. Absent in older apps. */
  showFileInFolder?(path: string): Promise<boolean>;
  /**
   * The system's folder dialog ("Scegli…" of a project's folder): the absolute path chosen,
   * null when cancelled or when the window shows a remote core. Absent in older apps.
   */
  pickFolder?(): Promise<string | null>;
}

/** "Apri all'accesso" (apps/desktop/src/main/login-item.ts). */
export interface DesktopLoginItem {
  /** False where the app cannot open at login: `note` says why. */
  supported: boolean;
  enabled: boolean;
  /** What to tell the user, in Italian (why not, or what is still missing). */
  note?: string;
}

/** A state from the bridge, or null when it does not look like one. */
export function loginItemState(input: unknown): DesktopLoginItem | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  if (typeof o['supported'] !== 'boolean' || typeof o['enabled'] !== 'boolean') return null;
  return {
    supported: o['supported'],
    enabled: o['enabled'],
    ...(typeof o['note'] === 'string' && o['note'] ? { note: o['note'] } : {}),
  };
}

/** The computer the desktop window shows (apps/desktop/src/main/ipc-guards.ts). */
export interface DesktopTarget {
  kind: 'local' | 'remote';
  /** "Questo computer", or the name the user gave the connection. */
  name: string;
  state: 'ready' | 'starting' | 'connecting' | 'reconnecting' | 'offline';
}

export function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const d = (window as { monstersDesktop?: Partial<DesktopBridge> }).monstersDesktop;
  return d?.isDesktop === true && typeof d.setupCode === 'function' ? (d as DesktopBridge) : null;
}

/**
 * Marks the document for the desktop styles (`data-desktop`, `data-chrome`, styles.css):
 * the two 52 px bars become the window's drag area and leave room for the window controls.
 */
export function applyDesktopChrome(): void {
  const d = desktop();
  if (!d) return;
  document.documentElement.dataset['desktop'] = d.platform;
  const chrome: DesktopChrome = d.chrome === 'inset' || d.chrome === 'overlay' ? d.chrome : 'frame';
  document.documentElement.dataset['chrome'] = chrome;
}
