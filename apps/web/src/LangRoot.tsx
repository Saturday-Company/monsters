import { Fragment, useEffect, type ReactNode } from 'react';
import { useAppLang } from './lib/i18n.ts';

/** What to give the focus back to once the UI is remounted in the new language (W-39, I-12). */
let focusAfterSwitch: string | null = null;

/**
 * A language switch remounts the whole tree, so the key that was pressed goes with it and the
 * focus would fall to the page. Call this just before switching with a CSS selector of the
 * element that will be there afterwards; `LangRoot` focuses it as soon as it exists.
 */
export function keepFocusThroughLangSwitch(selector: string): void {
  focusAfterSwitch = selector;
}

/** Remounts the UI when the language changes (D-153): every text is picked again. */
export function LangRoot({ children }: { children: ReactNode }) {
  const lang = useAppLang();
  useEffect(() => {
    const selector = focusAfterSwitch;
    if (!selector) return;
    focusAfterSwitch = null;
    // The page may still be loading its chunk: look again for a short while.
    let frame = 0;
    let tries = 0;
    const look = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) el.focus();
      else if (++tries < 30) frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [lang]);
  return <Fragment key={lang}>{children}</Fragment>;
}
