import { create } from 'zustand';

/*
 * Where the message of the shell is drawn (docs/design.md, "The top rail"). On a desktop (900 px and
 * more) it lives inside the rail, in the free space between the view's title and keys and the
 * Inbox key, so the page never moves; how much of it fits depends on that free space. Below 900 px,
 * or when even the smallest form does not fit, it is a band under the rail (the phone's way).
 */

export type NoticePlace =
  /** The sentence in one line, with its key and ✕, in the rail. */
  | 'chip'
  /** Not enough room for the sentence: a light and "1 notice" that opens a popover. */
  | 'key'
  /** Hardly any room: the light alone (the name says the rest). */
  | 'icon'
  /** A band under the rail (phones, narrow windows, no room in the rail). */
  | 'band';

/** The free width (px) the sentence needs to be worth showing in the rail. */
export const CHIP_MIN = 240;
/** The least width of the light with its words. */
export const KEY_MIN = 104;
/** The least width of the light alone. */
export const ICON_MIN = 36;

/** The form that fits in `room` px of free rail (null: the rail is not there, below 900 px). */
export function noticePlaceFor(room: number | null): NoticePlace {
  if (room === null) return 'band';
  if (room >= CHIP_MIN) return 'chip';
  if (room >= KEY_MIN) return 'key';
  if (room >= ICON_MIN) return 'icon';
  return 'band';
}

export const useNoticePlace = create<{ place: NoticePlace }>()(() => ({ place: 'band' }));

export function setNoticePlace(place: NoticePlace): void {
  if (useNoticePlace.getState().place !== place) useNoticePlace.setState({ place });
}
