import { isLang, setAppLang, systemLang, type Lang } from '@monsters/shared';
import { patchSettingsFile, readSettingsFile } from './onboarding/settings-file.ts';

/*
 * The app's language in the core (D-153). Kept in `settings.json`; the first
 * start writes it: an install that already has an account stays Italian (the
 * app was Italian only until then), a new one takes the system's language (the
 * desktop app passes its own as `MONSTERS_LANG`). The core's texts are picked in
 * the language in use when they are written: events already in the log stay as
 * they are.
 */

export function resolveAppLanguage(
  home: string,
  hasAccount: boolean,
  env: Record<string, string | undefined> = process.env,
): Lang {
  const saved = readSettingsFile(home)['language'];
  const lang: Lang = isLang(saved) ? saved : hasAccount ? 'it' : systemLang(env);
  if (!isLang(saved)) patchSettingsFile(home, { language: lang });
  setAppLang(lang, regionOf(env));
  return lang;
}

/** Saves and applies a new language. */
export function saveAppLanguage(
  home: string,
  lang: Lang,
  env: Record<string, string | undefined> = process.env,
): void {
  patchSettingsFile(home, { language: lang });
  setAppLang(lang, regionOf(env));
}

/** The system's tag, for dates and numbers of the same language ("en-GB"). */
function regionOf(env: Record<string, string | undefined>): string | undefined {
  return env['MONSTERS_LOCALE'] ?? env['LC_ALL'] ?? env['LC_MESSAGES'] ?? env['LANG'];
}
