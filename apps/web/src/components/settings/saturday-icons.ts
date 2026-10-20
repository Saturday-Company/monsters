import { brandLight } from '../../lib/brand-light.ts';

/*
 * The marks of Saturday's own products in the gallery (D-075), drawn from
 * their logos and made one light on the black screen like the simple-icons
 * marks (`brand-icons.ts`): the Anteiku cup from `anteiku/app/icon.svg`
 * (its strokes, without the red tile), the WitDesk "w" and dot from
 * `logos/witdesk-logo/svg/mono-white/mark.svg`. Written by hand: simple-icons
 * does not carry them, and `scripts/brand-icons.ts` leaves them out.
 */

export interface OwnIcon {
  title: string;
  /** Colour of the brand. */
  hex: string;
  /** The same colour as light on the black screens (≥ 3:1, brand-light.ts). */
  light: string;
  /** A square box around the mark. */
  viewBox: string;
  /** Filled paths, or stroked with this width. */
  paths: { d: string; stroke?: number }[];
}

const own = (o: Omit<OwnIcon, 'light'>): OwnIcon => ({ ...o, light: brandLight(o.hex) });

export const SATURDAY_ICONS: Record<string, OwnIcon> = {
  anteiku: own({
    title: 'Anteiku',
    hex: 'CF482E',
    viewBox: '3 3.3 18 18',
    paths: [
      { d: 'M6.6 11.6 C6.8 15 8.6 17 11.3 17 C14 17 15.8 15 16 11.6', stroke: 1.7 },
      { d: 'M15.9 12.4 C18 11.7 19 12.8 18.5 14.2 C18.1 15.3 16.8 15.7 15.3 15.6', stroke: 1.6 },
      {
        d: 'M6.5 11.3 C6.4 10.3 8.6 9.6 11.3 9.6 C14 9.6 16.1 10.2 16.1 11.2 C16.1 12.2 14 12.9 11.3 12.9 C8.6 12.9 6.5 12.2 6.5 11.3Z',
        stroke: 1.6,
      },
      { d: 'M5.2 18.4 C7.6 19.3 15 19.3 17.4 18.4', stroke: 1.6 },
      { d: 'M9.9 8.3 C9 7.4 10.8 6.6 9.9 5.4M12.7 8.3 C11.8 7.4 13.6 6.6 12.7 5.4', stroke: 1.3 },
    ],
  }),
  witdesk: own({
    title: 'WitDesk',
    hex: '0F6F6A',
    viewBox: '-0.37 -2.7 15.4 15.4',
    paths: [
      {
        d: 'M3.253 10L0 0L2.581 0L3.889 4.289Q4.065 4.877 4.221 5.523Q4.377 6.17 4.504 6.879Q4.599 6.387 4.695 5.991Q4.791 5.595 4.91 5.193Q5.028 4.792 5.184 4.289L5.92 2L9.703 2L10.409 4.289Q10.462 4.441 10.547 4.77Q10.632 5.099 10.738 5.485Q10.844 5.87 10.929 6.244Q11.014 6.617 11.067 6.872Q11.146 6.49 11.264 6.003Q11.383 5.516 11.513 5.061Q11.644 4.605 11.733 4.289L11.823 4L14.287 4L12.213 10L9.901 10L8.528 5.664Q8.223 4.682 8.048 3.978Q7.872 3.273 7.814 2.901Q7.741 3.255 7.577 3.869Q7.413 4.484 7.036 5.706L5.664 10Z',
      },
      { d: 'M11.455 1.6A1.6 1.6 0 1 1 14.655 1.6A1.6 1.6 0 1 1 11.455 1.6Z' },
    ],
  }),
};
