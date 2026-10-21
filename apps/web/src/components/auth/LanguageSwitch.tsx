import { LANGS } from '@monsters/shared';
import { applyLang, LANG_NAMES, useAppLang } from '../../lib/i18n.ts';
import { cn } from '../../lib/utils.ts';

/*
 * The app's language on the first screen and on the sign-in (D-153), before any
 * setting can be reached: each language by its own name. Applied here at once;
 * the core takes it with the new account (`setup`) or after the sign-in (`login`).
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const lang = useAppLang();
  return (
    <div
      className={cn('flex items-center justify-center gap-1 text-footnote', className)}
      data-testid="language-switch"
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === lang}
          onClick={() => applyLang(l)}
          className={cn(
            'rounded-[8px] px-2.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            l === lang ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
