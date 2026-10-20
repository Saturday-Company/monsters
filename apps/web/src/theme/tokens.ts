/*
 * Theme tokens of the "Strumento" design (docs/design.md, D-062). Single source
 * for the CSS variables (applied at runtime by `applyTheme`) and for the
 * automatic contrast test (test/contrast.test.ts).
 *
 * The window is an instrument: a neutral chassis (warm aluminium in light,
 * graphite in dark) with the content module set into it (`panel`), keys and
 * cards on top (`raised`), fields sunk into it (`well`), joints drawn as seams
 * (a dark line and a light one under it). Every surface is opaque: there is no
 * glass and no wallpaper any more. One action colour, the orange `signal`; red
 * (`stop`) only for Ferma and errors. Screens are black in both themes, they
 * are objects: on them only light (`screen-ink`, `screen-muted`, the monsters).
 *
 * Fills under text (`signal`, `stop`) have their own ink (`onSignal`,
 * `onStop`); the same hues as text on the surfaces are `signalInk` and
 * `stopInk`. `fill`, `fillStrong`, `separator` and `stopSoft` are kept for the
 * views not restyled yet (Tailwind names `bg-fill`, `border-separator`…).
 */

export type ThemeName = 'light' | 'dark';

export interface ThemeTokens {
  /** Window, top rail and sidebar. */
  chassis: string;
  /** The content module set into the chassis. */
  panel: string;
  /** Monster bubbles, cards, menus, dialogs, the caps of the keys. */
  raised: string;
  /** Fields and search (sunk), tracks of the switches. */
  well: string;
  /** The dark line of a seam. */
  seam: string;
  /** The light line under a seam. */
  seamLight: string;
  /** The thickness of the keys (a solid shadow below). */
  keyEdge: string;
  /** The cap of a switch's lever: it must stand out of its track (≥ 3:1 with its edge or cap). */
  lever: string;
  /** The edge of the lever. */
  leverEdge: string;
  ink: string;
  /** Secondary text (≥ 4.5:1 on chassis, panel, raised and well). */
  inkMuted: string;
  /** Labels and times, only on panel and raised. */
  inkFaint: string;
  /** The main action and the "something to do" lights: a fill under dark text. */
  signal: string;
  onSignal: string;
  /** The signal as text, links, focus ring (≥ 4.5:1). */
  signalInk: string;
  /** The thickness of a signal key. */
  signalEdge: string;
  /** Ferma, serious errors: a fill. */
  stop: string;
  onStop: string;
  /** Red text. */
  stopInk: string;
  /** A soft red band under `stopInk` (errors, older views). */
  stopSoft: string;
  /** Green light (connected, done). */
  ok: string;
  /** Every screen (the same in both themes). */
  screen: string;
  /** Main text on the screens. */
  screenInk: string;
  /** Secondary text on the screens (≥ 4.5:1 on black). */
  screenMuted: string;
  /** Dots switched off. */
  screenOff: string;
  /** Red light and text on a screen (FERMI, NON COLLEGATO), ≥ 4.5:1 on black. */
  screenStop: string;
  /** Green light and text on a screen (✓ on the receipt), ≥ 4.5:1 on black. */
  screenOk: string;
  /** Translucent ink: hover rows, chips, code (older views). */
  fill: string;
  /** Pressed and selected rows (older views). */
  fillStrong: string;
  /** Hairlines between rows (older views). */
  separator: string;
  /** `r, g, b` of the soft shadows of menus and dialogs. */
  shadow: string;
}

const SCREEN = {
  screenInk: '#efe9dc',
  screenMuted: '#8f8b81',
  screenOff: 'rgba(255, 255, 255, 0.07)',
  screenStop: '#ff5a4e',
  screenOk: '#4fd98a',
} as const;

export const THEMES: Record<ThemeName, ThemeTokens> = {
  light: {
    chassis: '#e3e1db',
    panel: '#f2f1ec',
    raised: '#fbfaf7',
    well: '#d8d5ce',
    seam: 'rgba(0, 0, 0, 0.13)',
    seamLight: 'rgba(255, 255, 255, 0.65)',
    keyEdge: '#b5b2a9',
    lever: '#fbfaf7',
    leverEdge: '#78756d',
    ink: '#1a1a18',
    inkMuted: '#5c5a54',
    inkFaint: '#6b6963',
    signal: '#ff4f00',
    onSignal: '#170800',
    signalInk: '#a83500',
    signalEdge: '#a33300',
    stop: '#d8231a',
    onStop: '#ffffff',
    stopInk: '#b51c14',
    stopSoft: '#f4dcd5',
    ok: '#1f8f4e',
    screen: '#0d0d0c',
    ...SCREEN,
    fill: 'rgba(60, 52, 30, 0.07)',
    fillStrong: 'rgba(60, 52, 30, 0.1)',
    separator: 'rgba(0, 0, 0, 0.11)',
    shadow: '40, 34, 20',
  },
  dark: {
    chassis: '#151514',
    panel: '#1c1c1a',
    raised: '#252523',
    well: '#0f0f0e',
    seam: 'rgba(0, 0, 0, 0.6)',
    seamLight: 'rgba(255, 255, 255, 0.05)',
    keyEdge: '#0a0a09',
    lever: '#64635e',
    leverEdge: '#0a0a09',
    ink: '#ecebe5',
    inkMuted: '#a3a19a',
    inkFaint: '#8d8b85',
    signal: '#ff5e14',
    onSignal: '#170800',
    signalInk: '#ff8a4c',
    signalEdge: '#8a2c00',
    stop: '#ff3b2f',
    onStop: '#1a0302',
    stopInk: '#ff7b72',
    stopSoft: '#2e1513',
    ok: '#4fd98a',
    screen: '#050505',
    ...SCREEN,
    fill: 'rgba(0, 0, 0, 0.3)',
    fillStrong: 'rgba(255, 255, 255, 0.07)',
    separator: 'rgba(255, 255, 255, 0.07)',
    shadow: '0, 0, 0',
  },
};

const VAR_NAMES: Record<keyof ThemeTokens, string> = {
  chassis: '--chassis',
  panel: '--panel',
  raised: '--raised',
  well: '--well',
  seam: '--seam',
  seamLight: '--seam-light',
  keyEdge: '--key-edge',
  lever: '--lever',
  leverEdge: '--lever-edge',
  ink: '--ink',
  inkMuted: '--ink-muted',
  inkFaint: '--ink-faint',
  signal: '--signal',
  onSignal: '--on-signal',
  signalInk: '--signal-ink',
  signalEdge: '--signal-edge',
  stop: '--stop',
  onStop: '--on-stop',
  stopInk: '--stop-ink',
  stopSoft: '--stop-soft',
  ok: '--ok',
  screen: '--screen',
  screenInk: '--screen-ink',
  screenMuted: '--screen-muted',
  screenOff: '--screen-off',
  screenStop: '--screen-stop',
  screenOk: '--screen-ok',
  fill: '--fill',
  fillStrong: '--fill-strong',
  separator: '--separator',
  shadow: '--shadow-rgb',
};

/** CSS custom properties for a theme. */
export function themeVariables(name: ThemeName): Record<string, string> {
  const t = THEMES[name];
  const vars: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(VAR_NAMES)) {
    vars[cssVar] = t[key as keyof ThemeTokens];
  }
  return vars;
}

/** Writes the theme variables on an element (the document root). */
export function applyTheme(el: HTMLElement, name: ThemeName): void {
  for (const [k, v] of Object.entries(themeVariables(name))) el.style.setProperty(k, v);
  el.dataset['theme'] = name;
  el.style.colorScheme = name;
}
