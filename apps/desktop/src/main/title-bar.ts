import type { BrowserWindowConstructorOptions } from 'electron';
import { PAGE_PALETTE } from './page-theme.ts';

/*
 * The integrated title bar (docs/design.md, D-062): no system title bar above the page; the
 * page's top rail (52 px of chassis across the window) is the title bar.
 * - macOS (`inset`): `titleBarStyle: 'hidden'`, the traffic lights centred in the rail.
 * - Windows and Linux (`overlay`): `titleBarStyle: 'hidden'` with a Window Controls Overlay,
 *   the system buttons drawn by Electron over the top right of the page, 52 px tall, in the
 *   chassis colour of the rail with ink symbols. The page reserves their room with
 *   `env(titlebar-area-*)` and sends its colours when its theme changes (IPC, validated
 *   here: only `#rrggbb`).
 * - `frame`: the normal system frame. Other platforms, or MONSTERS_DESKTOP_TITLEBAR=system
 *   (a way out on a Linux desktop where the frameless window misbehaves).
 * Pure functions and a small state holder, tested without Electron.
 */

export type WindowChrome = 'inset' | 'overlay' | 'frame';

/** Height of the top rail, as in the spec. */
export const TITLE_BAR_HEIGHT = 52;
/** Height of the frame of the traffic lights (macOS draws them 12 px wide in a 16 px box). */
const TRAFFIC_LIGHT_FRAME = 16;

/**
 * Origin of the traffic lights in the top rail (docs/design.md): 16 px from the left edge of
 * the window, vertically centred in the 52 px rail ((52 - 16) / 2 = 18). They end at 76 px
 * (macOS 26+); the rail leaves 92 px before the wordmark (web styles.css).
 */
export const TRAFFIC_LIGHTS = {
  x: 16,
  y: (TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_FRAME) / 2,
} as const;

/** Environment variable that brings back the system frame on Windows and Linux. */
export const TITLEBAR_ENV = 'MONSTERS_DESKTOP_TITLEBAR';

export function windowChrome(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): WindowChrome {
  const choice = env[TITLEBAR_ENV]?.trim().toLowerCase();
  if (choice === 'system' || choice === 'frame' || choice === 'native') return 'frame';
  if (platform === 'darwin') return 'inset';
  if (platform === 'win32' || platform === 'linux') return 'overlay';
  return 'frame';
}

/** What `BrowserWindow.setTitleBarOverlay` takes (the part used here). */
export interface TitleBarColors {
  color: string;
  symbolColor: string;
}

/**
 * Overlay colours from the app's theme (`nativeTheme.shouldUseDarkColors`: the system, or the
 * Settings' choice through `themeSource`, D-091): `--chassis` (the rail) with `--ink` symbols.
 */
export function systemTitleBarColors(dark: boolean): TitleBarColors {
  const p = PAGE_PALETTE[dark ? 'dark' : 'light'];
  return { color: p.chassis, symbolColor: p.ink };
}

/** Background of a window before its page paints: the chassis of the theme. */
export function windowBackground(dark: boolean): string {
  return PAGE_PALETTE[dark ? 'dark' : 'light'].chassis;
}

/** The title bar options of a `BrowserWindow` for `chrome`. */
export function titleBarOptions(
  chrome: WindowChrome,
  dark: boolean,
): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'
> {
  switch (chrome) {
    case 'inset':
      return { titleBarStyle: 'hidden', trafficLightPosition: { ...TRAFFIC_LIGHTS } };
    case 'overlay':
      return {
        titleBarStyle: 'hidden',
        titleBarOverlay: { ...systemTitleBarColors(dark), height: TITLE_BAR_HEIGHT },
      };
    case 'frame':
      return {};
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The colours a page sends (`setTitleBarColors({ background, symbol })`), or null. Strict:
 * a plain object with exactly these two keys, each `#rrggbb`. No names, no alpha, no
 * `rgb()`: the overlay is opaque like the page under it, and nothing else reaches Chromium's
 * colour parser from a page.
 */
export function parseTitleBarColors(input: unknown): TitleBarColors | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input) as unknown;
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('background') || !keys.includes('symbol')) return null;
  const { background, symbol } = input as Record<string, unknown>;
  if (typeof background !== 'string' || typeof symbol !== 'string') return null;
  if (!HEX.test(background) || !HEX.test(symbol)) return null;
  return { color: background.toLowerCase(), symbolColor: symbol.toLowerCase() };
}

/**
 * Who decides the overlay colours of a window. The page of the core, once it has sent
 * valid colours; until then, and after it goes (status page, another core), the app's theme
 * (`nativeTheme`: the system, or the Settings' choice, D-091). Nothing happens unless the
 * window has an overlay.
 */
export class TitleBarState {
  readonly #chrome: WindowChrome;
  readonly #apply: (colors: TitleBarColors) => void;
  #fromPage = false;
  #shown = '';

  constructor(chrome: WindowChrome, apply: (colors: TitleBarColors) => void) {
    this.#chrome = chrome;
    this.#apply = apply;
  }

  get fromPage(): boolean {
    return this.#fromPage;
  }

  /** Colours from the page (already checked to come from the core). False if refused. */
  page(input: unknown): boolean {
    const colors = parseTitleBarColors(input);
    if (!colors) return false;
    this.#fromPage = true;
    this.#show(colors);
    return true;
  }

  /** The system theme changed: followed unless the page took over. */
  system(dark: boolean): void {
    if (!this.#fromPage) this.#show(systemTitleBarColors(dark));
  }

  /** The window shows something else (status page, a new page load): back to the system. */
  reset(dark: boolean): void {
    this.#fromPage = false;
    this.#show(systemTitleBarColors(dark));
  }

  #show(colors: TitleBarColors): void {
    if (this.#chrome !== 'overlay') return;
    const key = `${colors.color}/${colors.symbolColor}`;
    if (key === this.#shown) return;
    this.#shown = key;
    this.#apply(colors);
  }
}
