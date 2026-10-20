import type { ReactNode } from 'react';
import { NoticeToast } from './StatusLayer.tsx';

/**
 * The root of everything after the boot screen, loaded apart from the first
 * bundle (M2.8) while the boot screen is up, with the toasts on top. The
 * motion of the UI is all CSS by frames (styles.css, D-084): no animation
 * library to configure, "Riduci movimento" lives in `data-motion` on <html>.
 */
export default function NoticeRoot({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <NoticeToast />
    </>
  );
}
