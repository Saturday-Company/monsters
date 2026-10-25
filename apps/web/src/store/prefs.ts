import { create } from 'zustand';
import { desktop } from '../lib/desktop.ts';
import { applyTheme, THEMES, type ThemeName } from '../theme/tokens.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Prefs {
  theme: ThemeChoice;
  /** No idle animations of the monsters and no transitions, as with the system's reduced motion. */
  reduceMotion: boolean;
  /** The synthesized sounds of the instrument (lib/sound.ts): off by default. */
  sounds: boolean;
  /** The instrumentation line under the monsters' turns, tokens, model ids (off by default, D-181). */
  showDetails: boolean;
  /** The "Attività" column next to the chat (wide windows only). */
  activityPanel: boolean;
  /** Width of the right-hand pane in px, as last dragged (components/dock, D-075). */
  dockWidth: number;
  /** The squads folded in the sidebar (a project's id, `~personale`; D-100). */
  foldedSquads: string[];
}

/** Width of the right-hand pane before it is ever dragged. */
export const DOCK_WIDTH_DEFAULT = 520;
/** Narrowest the pane can be dragged. */
export const DOCK_WIDTH_MIN = 380;

const KEY = 'monsters-prefs';

/**
 * Version of the stored preferences. Version 2 (D-181) turned the technical details off for
 * everyone: a store written before it (no version) has its `showDetails` reset once; after that
 * the person's own choice sticks again.
 */
export const PREFS_VERSION = 2;

/** The preferences as they are stored: the version beside them, so a later reset can tell old from new. */
function stored(p: Prefs): string {
  return JSON.stringify({ ...p, version: PREFS_VERSION });
}

function load(): Prefs {
  const fallback: Prefs = {
    theme: 'system',
    reduceMotion: false,
    sounds: false,
    showDetails: false,
    activityPanel: false,
    dockWidth: DOCK_WIDTH_DEFAULT,
    foldedSquads: [],
  };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Prefs> & { version?: unknown };
    const current = typeof p.version === 'number' && p.version >= PREFS_VERSION;
    const prefs: Prefs = {
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      reduceMotion: p.reduceMotion === true,
      sounds: p.sounds === true,
      // Before version 2 the details were on unless switched off: that value is not a choice any more.
      showDetails: current ? p.showDetails === true : false,
      activityPanel: p.activityPanel === true,
      dockWidth:
        typeof p.dockWidth === 'number' && Number.isFinite(p.dockWidth)
          ? Math.max(DOCK_WIDTH_MIN, Math.min(4000, Math.round(p.dockWidth)))
          : DOCK_WIDTH_DEFAULT,
      foldedSquads: Array.isArray(p.foldedSquads)
        ? p.foldedSquads.filter((k): k is string => typeof k === 'string').slice(0, 100)
        : [],
    };
    if (!current) {
      try {
        window.localStorage.setItem(KEY, stored(prefs));
      } catch {
        // private mode: the reset repeats at the next start, with the same result
      }
    }
    return prefs;
  } catch {
    return fallback;
  }
}

export const usePrefs = create<Prefs>()(() => load());

export function setPrefs(patch: Partial<Prefs>): void {
  usePrefs.setState(patch);
  try {
    window.localStorage.setItem(KEY, stored(usePrefs.getState()));
  } catch {
    // private mode: preferences last for this tab only
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
const motionQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');

export function resolveTheme(choice: ThemeChoice): ThemeName {
  if (choice !== 'system') return choice;
  return darkQuery().matches ? 'dark' : 'light';
}

let painted: string | null = null;

/**
 * Colours of the system buttons drawn over the page by the desktop app on
 * Windows and Linux (`titleBarOverlay`): the chassis of the top rail and the ink of the theme.
 * Optional in the bridge, absent in a browser; sent only when they change.
 */
function paintTitleBar(theme: ThemeName): void {
  const d = desktop();
  if (!d?.setTitleBarColors) return;
  const colors = { background: THEMES[theme].chassis, symbol: THEMES[theme].ink };
  const key = `${colors.background}|${colors.symbol}`;
  if (key === painted) return;
  painted = key;
  try {
    d.setTitleBarColors(colors);
  } catch {
    // an older app without the call: the default colours stay
  }
}

let sentTheme: ThemeChoice | null = null;

/**
 * The choice of the Settings to the desktop app, which applies it to its own pages and
 * windows (and so to this page's `prefers-color-scheme`). The choice, never the resolved
 * theme: with "Sistema" the app goes back to the system's, which then reaches this page as a
 * change of the media query. Sent once per choice; absent in a browser and in older apps.
 */
function sendTheme(choice: ThemeChoice): void {
  const d = desktop();
  if (!d?.setTheme || choice === sentTheme) return;
  sentTheme = choice;
  try {
    d.setTheme(choice);
  } catch {
    // an older app: its pages keep following the system
  }
}

/** Keeps <html> in sync with the preferences and the system settings. */
export function watchPrefs(root: HTMLElement = document.documentElement): () => void {
  const sync = () => {
    const p = usePrefs.getState();
    const theme = resolveTheme(p.theme);
    applyTheme(root, theme);
    sendTheme(p.theme);
    paintTitleBar(theme);
    // read by the monster kit's stylesheet, like the system's prefers-reduced-motion
    const still = p.reduceMotion || motionQuery().matches;
    root.dataset['motion'] = still ? 'reduced' : 'full';
  };
  sync();
  const unsub = usePrefs.subscribe(sync);
  const queries = [darkQuery(), motionQuery()];
  for (const q of queries) q.addEventListener('change', sync);
  return () => {
    unsub();
    for (const q of queries) q.removeEventListener('change', sync);
  };
}
