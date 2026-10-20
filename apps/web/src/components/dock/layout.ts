import { DOCK_WIDTH_MIN } from '../../store/prefs.ts';

/*
 * Where the right-hand pane sits (docs/design.md, "Pannello a destra"; D-075).
 * Pure numbers, tested without a browser:
 * - phone (< 768 px): full screen under the top rail, like the sheets were;
 * - narrow window (768-1099 px): a sheet over the right of the content (the chat
 *   would be too narrow beside it), under the rail;
 * - wide window (from 1100 px): a column of its own, the content shrinks.
 * From 1600 px the "Da rivedere" column stays next to the chat with the pane
 * open; below it hides while the pane is open (one thing on the right).
 */

export type DockMode = 'phone' | 'sheet' | 'side';

export const PHONE_BELOW = 768;
export const SIDE_FROM = 1100;
export const REVIEW_WITH_DOCK_FROM = 1600;

/** Sidebar (Toolbar.tsx `SIDEBAR_WIDTH`) and the narrowest content that stays usable beside the pane. */
const SIDEBAR = 300;
const CONTENT_MIN = 400;
/** The chassis around the pane: the gap on its left (the grip) and on its right. */
export const DOCK_GUTTER = 12;

export function dockMode(viewport: number): DockMode {
  if (viewport < PHONE_BELOW) return 'phone';
  return viewport < SIDE_FROM ? 'sheet' : 'side';
}

/** The widest the pane may be in this window: ~60% of it, leaving the content its minimum. */
export function dockMaxWidth(viewport: number, mode: DockMode = dockMode(viewport)): number {
  if (mode === 'phone') return viewport;
  if (mode === 'sheet') return Math.max(DOCK_WIDTH_MIN, viewport - 2 * DOCK_GUTTER - 120);
  const room = viewport - SIDEBAR - CONTENT_MIN - 2 * DOCK_GUTTER;
  return Math.max(DOCK_WIDTH_MIN, Math.min(Math.round(viewport * 0.6), room));
}

/** The width the pane gets: the preference, kept between the minimum and the room there is. */
export function clampDockWidth(
  wanted: number,
  viewport: number,
  mode: DockMode = dockMode(viewport),
): number {
  if (mode === 'phone') return viewport;
  const max = dockMaxWidth(viewport, mode);
  return Math.round(Math.max(DOCK_WIDTH_MIN, Math.min(wanted, max)));
}
