import { create } from 'zustand';
import type { PreviewItem } from '@monsters/shared';

/*
 * The right-hand pane (plan of 16/10, feature 4; D-075): one place on the right
 * with tabs, instead of sheets stacked on each other. `open` shows an item in the
 * Anteprima tab (adding it, or focusing it if already there); the other tabs are
 * the instruments that used to be separate sheets ("Dietro le quinte", Consumi).
 *
 * Extensions of the contract (all compatible):
 * - `open(item, { focus: false })` opens without moving the keyboard focus (a
 *   monster showing something, `preview_show`): `focusNonce` counts the opens
 *   that asked for the focus, and the pane takes it when the number changes;
 * - `toggle()` (the shortcut ⌘J / Ctrl J) and `select(index)` (the strip);
 * - `MAX_ITEMS`: the strip keeps the latest few, the oldest goes first.
 * The width is a preference of the viewer (`dockWidth` in store/prefs.ts).
 */

export type DockTab = 'preview' | 'terminal' | 'usage';

export interface OpenOptions {
  /** Move the keyboard focus to the pane (default true: the user asked for it). */
  focus?: boolean;
}

export interface PreviewState {
  /** Whether the pane is shown. */
  visible: boolean;
  tab: DockTab;
  /** Items open in Anteprima, oldest first. */
  items: PreviewItem[];
  /** Index in `items` of the one shown. */
  active: number;
  /** Grows each time the pane should take the keyboard focus. */
  focusNonce: number;
  open: (item: PreviewItem, options?: OpenOptions) => void;
  closeItem: (index: number) => void;
  select: (index: number) => void;
  showTab: (tab: DockTab, options?: OpenOptions) => void;
  toggle: () => void;
  hide: () => void;
}

/** Items kept in the strip of Anteprima. */
export const MAX_ITEMS = 12;

export const samePreview = (a: PreviewItem, b: PreviewItem): boolean =>
  a.kind === b.kind &&
  (a.kind === 'file' ? a.fileId === (b as typeof a).fileId : a.path === (b as typeof a).path);

/** A stable key for an item (React keys, caches). */
export const previewKey = (item: PreviewItem): string =>
  item.kind === 'file' ? `file:${item.fileId}` : `note:${item.path}`;

export const usePreview = create<PreviewState>((set) => ({
  visible: false,
  tab: 'preview',
  items: [],
  active: 0,
  focusNonce: 0,
  open: (item, options) =>
    set((s) => {
      const focusNonce = s.focusNonce + (options?.focus === false ? 0 : 1);
      const at = s.items.findIndex((it) => samePreview(it, item));
      if (at >= 0) return { visible: true, tab: 'preview', active: at, focusNonce };
      const items = [...s.items, item].slice(-MAX_ITEMS);
      return { visible: true, tab: 'preview', items, active: items.length - 1, focusNonce };
    }),
  closeItem: (index) =>
    set((s) => {
      if (index < 0 || index >= s.items.length) return {};
      const items = s.items.filter((_, i) => i !== index);
      const active = Math.max(
        0,
        Math.min(s.active > index ? s.active - 1 : s.active, items.length - 1),
      );
      return { items, active, visible: s.visible && (items.length > 0 || s.tab !== 'preview') };
    }),
  select: (index) =>
    set((s) => (index >= 0 && index < s.items.length ? { active: index, tab: 'preview' } : {})),
  showTab: (tab, options) =>
    set((s) => ({
      visible: true,
      tab,
      focusNonce: s.focusNonce + (options?.focus === false ? 0 : 1),
    })),
  toggle: () =>
    set((s) => (s.visible ? { visible: false } : { visible: true, focusNonce: s.focusNonce + 1 })),
  hide: () => set({ visible: false }),
}));

/** Opens an item in the Anteprima tab of the right-hand pane. */
export const openPreview = (item: PreviewItem, options?: OpenOptions): void =>
  usePreview.getState().open(item, options);

/** Hides the pane (Esc, ✕, Indietro on a phone). */
export const hideDock = (): void => usePreview.getState().hide();
