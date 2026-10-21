import { Fragment, type ReactNode } from 'react';
import { useAppLang } from './lib/i18n.ts';

/** Remounts the UI when the language changes (D-153): every text is picked again. */
export function LangRoot({ children }: { children: ReactNode }) {
  const lang = useAppLang();
  return <Fragment key={lang}>{children}</Fragment>;
}
