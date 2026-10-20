import { TITLE_BAR_HEIGHT } from './title-bar.ts';

/*
 * Size and position of the window, remembered between launches (`window-state.json` in the
 * app's user data). A saved position that no longer falls on a screen (monitor unplugged)
 * is dropped and the window is centred; a size larger than every screen is shrunk.
 */

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 840, maximized: false };
export const MIN_WINDOW = { width: 720, height: 560 };

const int = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;

export function parseWindowState(raw: string | null): WindowState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Record<string, unknown>;
    const width = int(s['width']);
    const height = int(s['height']);
    if (width === undefined || height === undefined) return null;
    const x = int(s['x']);
    const y = int(s['y']);
    return {
      width,
      height,
      maximized: s['maximized'] === true,
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    };
  } catch {
    return null;
  }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Fits a saved state to the screens' work areas available now. */
export function fitWindowState(state: WindowState | null, workAreas: readonly Rect[]): WindowState {
  const s = state ?? DEFAULT_WINDOW;
  const largest = workAreas.reduce<Rect | null>(
    (best, r) => (!best || r.width * r.height > best.width * best.height ? r : best),
    null,
  );
  const width = Math.max(MIN_WINDOW.width, Math.min(s.width, largest?.width ?? s.width));
  const height = Math.max(MIN_WINDOW.height, Math.min(s.height, largest?.height ?? s.height));
  const fitted: WindowState = { width, height, maximized: s.maximized };
  if (s.x === undefined || s.y === undefined) return fitted;
  const rect = { x: s.x, y: s.y, width, height };
  // The title bar (the top 52 px row, D-056) must be on a screen, and a fair part of the window.
  const titleBar = { x: s.x, y: s.y, width, height: TITLE_BAR_HEIGHT };
  const visible = workAreas.some(
    (area) => overlap(titleBar, area) > 0 && overlap(rect, area) >= (width * height) / 4,
  );
  return visible ? { ...fitted, x: s.x, y: s.y } : fitted;
}
