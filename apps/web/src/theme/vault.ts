import { accentInk } from './bubbles.ts';
import { THEMES, type ThemeName } from './tokens.ts';

/*
 * Colours of the vault view. Since the "Strumento" design (D-062) the graph is
 * a black screen lit in the monsters' LED colours (VaultView.tsx): the group
 * hues below no longer colour it; they stay as the tested palette for a group
 * colour on the surfaces (`accentInk`, readable as text with the theme).
 */

export const GROUP_HUES = [
  '#3b74d9',
  '#d4721c',
  '#2c9a6a',
  '#b23f92',
  '#7457e8',
  '#b8920f',
  '#d2434e',
  '#2a8fa6',
] as const;

/** Colour of the `index`-th group (groups ranked by size: the biggest get distinct hues). */
export function paletteColor(index: number, theme: ThemeName): string {
  if (index < 0 || index >= GROUP_HUES.length) return THEMES[theme].inkFaint;
  return accentInk(GROUP_HUES[index]!, theme);
}

/**
 * Diff lines on a black screen (docs/design.md, "Schermo": only light inside),
 * the same in both themes: added in green light, removed in red, each on a
 * faint band of its colour. Text ≥ 4.5:1 on the screen (test/vault-view.test.ts).
 */
export const SCREEN_DIFF = {
  addBg: 'rgba(79, 217, 138, 0.13)',
  addFg: '#7fe3aa',
  delBg: 'rgba(255, 90, 78, 0.15)',
  delFg: '#ff8f85',
} as const;

/** Diff lines on the theme surfaces: removed and added text on tinted rows (contrast-tested). */
export const DIFF_COLORS: Record<
  ThemeName,
  { addBg: string; addFg: string; delBg: string; delFg: string }
> = {
  light: { addBg: '#dcf3e4', addFg: '#11552f', delBg: '#fbe1df', delFg: '#7f1d16' },
  dark: { addBg: '#123323', addFg: '#9ee6b8', delBg: '#3a1614', delFg: '#ffb3aa' },
};
