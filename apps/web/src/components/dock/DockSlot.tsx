import { lazy, Suspense, useEffect, useState } from 'react';
import { still, UI_MS } from '../../lib/motion.ts';
import { usePreview } from '../../store/preview.ts';
import { ErrorBoundary } from '../shell/ErrorBoundary.tsx';

/*
 * The place of the right-hand pane in the shell (D-075). Its chunk is fetched
 * the first time the pane opens, then stays. Closing plays the way out (three
 * frames) before the pane leaves the page; with "Riduci movimento" it just goes.
 */
const RightDock = lazy(() => import('./RightDock.tsx'));

/** Length of the way out (dock.css: `slide-out`, three frames). */
const LEAVE_MS = UI_MS;

export function DockSlot() {
  const visible = usePreview((s) => s.visible);
  const [mounted, setMounted] = useState(visible);
  const [leaving, setLeaving] = useState(false);
  // Adjusted while rendering (no effect in between): shown, leaving, gone.
  if (visible && !mounted) setMounted(true);
  if (visible && leaving) setLeaving(false);
  if (!visible && mounted && !leaving) {
    if (still()) setMounted(false);
    else setLeaving(true);
  }

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!mounted) return null;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <RightDock leaving={leaving} />
      </Suspense>
    </ErrorBoundary>
  );
}
