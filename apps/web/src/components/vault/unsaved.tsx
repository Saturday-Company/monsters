import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { holdNavigation, proceedNavigation } from '../../lib/navigation-guard.ts';
import { Button } from '../ui/button.tsx';
import { noteStrings } from './note.strings.ts';

/*
 * A draft that is not saved yet (review W-4). While `dirty`, leaving by the address (a link, the
 * list, the sidebar, the back key) is held back and the person is asked: save, discard or keep
 * editing; closing the window asks through the browser. The route is a hash, so there is nothing
 * to cancel before it changes: `lib/navigation-guard.ts` stops the move, puts the old address
 * back and tells us where it was going. Only when the person says so does the move happen.
 */

/**
 * Guards a form with unsaved changes. Returns the question to render somewhere in the form (null
 * when there is nothing to ask) and `allow`, to call when the form is done and moves on by
 * itself (a new note created, then opened). `save` saves the draft and says whether it worked; leave it out
 * when the draft cannot be saved as it is (the dialog then offers only discard and keep editing).
 */
export function useUnsavedGuard({
  dirty,
  isNew = false,
  save,
}: {
  dirty: boolean;
  /** A note not created yet (the text of the question changes). */
  isNew?: boolean;
  save?: (() => Promise<boolean>) | undefined;
}): { question: ReactNode; allow: () => void } {
  const s = noteStrings().unsaved;
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  /** Set by `allow`: the form is done, the next moves are its own. */
  const done = useRef(false);
  const allow = useCallback(() => {
    done.current = true;
  }, []);

  useEffect(() => {
    if (!dirty) return;
    done.current = false;
    const release = holdNavigation((to) => {
      if (done.current) proceedNavigation(to);
      else setTarget(to);
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      if (done.current) return;
      e.preventDefault();
      // Some browsers still want a value to show their own question.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      release();
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty]);

  const leave = useCallback((to: string) => {
    setTarget(null);
    proceedNavigation(to);
  }, []);

  const keep = useCallback(() => setTarget(null), []);
  useEffect(() => {
    if (target === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') keep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, keep]);

  if (target === null) return { question: null, allow };
  const saveThenLeave = async () => {
    setSaving(true);
    try {
      if (await saveRef.current?.()) leave(target);
      else setTarget(null);
    } finally {
      setSaving(false);
    }
  };
  // Not a native modal (`showModal` would make the page inert, kill switch included): a layer
  // that starts below the top bar, as the other questions of the app.
  const question = createPortal(
    <div
      data-testid="unsaved-layer"
      className="fixed inset-x-0 top-16 bottom-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-text"
        data-testid="unsaved-dialog"
        className="raised relative m-0 w-[min(440px,100%)] rounded-[16px] p-6 text-ink"
      >
        <h2 id="unsaved-title" className="text-title2 font-semibold">
          {s.title}
        </h2>
        <p id="unsaved-text" className="mt-2 text-large leading-snug text-ink-muted">
          {isNew ? s.textNew : s.text}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => leave(target)}
            disabled={saving}
            data-testid="unsaved-discard"
          >
            {s.discard}
          </Button>
          {save && (
            <Button
              variant="secondary"
              onClick={() => void saveThenLeave()}
              disabled={saving}
              data-testid="unsaved-save"
            >
              {s.save}
            </Button>
          )}
          <Button onClick={keep} disabled={saving} autoFocus data-testid="unsaved-keep">
            {s.keep}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
  return { question, allow };
}
