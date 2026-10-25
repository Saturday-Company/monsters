import { useEffect, useState, type KeyboardEvent } from 'react';

/*
 * A confirmation in place (a button that turns into "Sure? Yes / Cancel", a switch that asks
 * before it turns on): the focus goes to the safe choice when it opens, Escape takes it back,
 * and the focus returns to the control that asked, not to <body> (review of 25/10, W-32).
 */
export interface InPlaceConfirm<T extends HTMLElement> {
  asking: boolean;
  ask: () => void;
  /** Closes the question and puts the focus back on the control that asked. */
  close: () => void;
  /** `ref` of the control that asks (or of an element holding it). */
  trigger: (el: T | null) => void;
  /** `ref` of the safe choice ("Cancel"): it takes the focus when the question opens. */
  safe: (el: HTMLButtonElement | null) => void;
  /** On the element that holds the question: Escape cancels it. */
  onKeyDown: (e: KeyboardEvent) => void;
}

/** `idle`: nothing asked; `asking`: the question is open; `back`: closed, the focus is owed to the trigger. */
type Phase = 'idle' | 'asking' | 'back';

export function useInPlaceConfirm<T extends HTMLElement = HTMLButtonElement>(): InPlaceConfirm<T> {
  const [phase, setPhase] = useState<Phase>('idle');
  const [triggerEl, trigger] = useState<T | null>(null);
  const [safeEl, safe] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (phase === 'asking') {
      safeEl?.focus({ preventScroll: true });
    } else if (phase === 'back' && triggerEl) {
      // The trigger is back on screen (it was replaced by the question): the focus returns to it.
      const target = triggerEl.matches('button, [tabindex]')
        ? triggerEl
        : triggerEl.querySelector('button');
      target?.focus({ preventScroll: true });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the focus is given back once
      setPhase('idle');
    }
  }, [phase, safeEl, triggerEl]);

  const close = () => setPhase('back');
  return {
    asking: phase === 'asking',
    ask: () => setPhase('asking'),
    close,
    trigger,
    safe,
    onKeyDown: (e) => {
      if (e.key !== 'Escape') return;
      // Only the question closes: a dialog or sheet around it stays.
      e.preventDefault();
      close();
    },
  };
}
