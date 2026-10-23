import { createContext, useContext } from 'react';
import type { ThemeName } from '../../../theme/tokens.ts';
import { accentInk } from '../../../theme/bubbles.ts';
import { GROUP_HUES, paletteColor } from '../../../theme/vault.ts';

/** How a block is drawn: the theme, and whether it sits on a black screen (the terminal). */
export interface UiDrawing {
  theme: ThemeName;
  onScreen: boolean;
}

export const UiDrawingContext = createContext<UiDrawing>({ theme: 'light', onScreen: false });

export const useUiDrawing = (): UiDrawing => useContext(UiDrawingContext);

/**
 * The colour of the `i`-th series: the tested palette of the vault's groups (readable as text on
 * the surfaces, so as marks too). On a screen, always the light variant: the screen is black in
 * both themes.
 */
export function seriesColor(i: number, d: UiDrawing): string {
  const index = Math.max(0, Math.min(i, GROUP_HUES.length - 1));
  return d.onScreen ? accentInk(GROUP_HUES[index]!, 'dark') : paletteColor(index, d.theme);
}
