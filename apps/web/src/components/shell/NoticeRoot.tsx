import type { ReactNode } from 'react';
import { useRadioGroupKeys } from '../ui/radio-keys.ts';
import { NoticeToast } from './StatusLayer.tsx';

/**
 * The root of everything after the boot screen, loaded apart from the first
 * bundle (M2.8) while the boot screen is up, with the toasts on top. The
 * motion of the UI is all CSS by frames (styles.css, D-084): no animation
 * library to configure, "Riduci movimento" lives in `data-motion` on <html>.
 * It also hosts the arrow keys of every radio group (ui/radio-keys.ts).
 */
export default function NoticeRoot({ children }: { children: ReactNode }) {
  useRadioGroupKeys();
  return (
    <>
      {children}
      <NoticeToast />
    </>
  );
}
