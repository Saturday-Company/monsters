import { FolderOpen } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { desktop } from '../../lib/desktop.ts';
import { Button } from '../ui/button.tsx';

/*
 * "Scegli…" next to a folder's path: the system's folder dialog of the desktop app
 * (`pickFolder`, apps/desktop/src/preload/index.ts). Only when the window shows this
 * computer's core: a browser gives no paths, and a path of this computer means nothing to a
 * remote core. Elsewhere the path is typed by hand, as before.
 */

/** True when the desktop app can show its folder dialog for the core in the window. */
export function useCanPickFolder(): boolean {
  const d = desktop();
  const [local, setLocal] = useState(false);
  useEffect(() => {
    if (!d?.pickFolder || !d.target) return;
    let live = true;
    void d
      .target()
      .then((t) => {
        if (live) setLocal(t?.kind === 'local');
      })
      .catch(() => {});
    const stop = d.onTargetChange?.((t) => setLocal(t.kind === 'local'));
    return () => {
      live = false;
      stop?.();
    };
  }, [d]);
  return local;
}

export function FolderPickButton({
  onPicked,
  disabled,
  testId,
}: {
  /** The absolute path of the folder chosen in the dialog. */
  onPicked: (path: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = async () => {
    const d = desktop();
    if (!d?.pickFolder) return;
    setOpen(true);
    try {
      const path = await d.pickFolder();
      if (path) onPicked(path);
    } catch {
      // A refused call is the same as a cancelled dialog: the field stays as it is.
    } finally {
      setOpen(false);
    }
  };
  return (
    <Button
      variant="secondary"
      disabled={disabled || open}
      onClick={() => void pick()}
      data-testid={testId}
    >
      <FolderOpen size={18} aria-hidden />
      Scegli…
    </Button>
  );
}
