import { appLang, type Lang } from '@monsters/shared';
import english from '../../../../CHANGELOG.md?raw';
import italian from '../../../../CHANGELOG.it.md?raw';
import { parseChangelog, type ChangelogVersion } from './changelog.ts';

// The product's changelog, bundled at build time (Vite `?raw`): the web UI served by the core and
// the desktop app carry it, no request needed. The repo root is inside Vite's fs.allow (workspace).
// CHANGELOG.md is the English one (also the notes of a release), CHANGELOG.it.md the Italian one.

const BY_LANG: Record<Lang, ChangelogVersion[]> = {
  en: parseChangelog(english),
  it: parseChangelog(italian),
};

/** The versions of the changelog in a language (the app's by default), newest first. */
export function changelog(lang: Lang = appLang()): ChangelogVersion[] {
  return BY_LANG[lang];
}

/**
 * The versions in the app's language, newest first: a read-only view that follows the language
 * when it is read (`.map`, `.some`, `[0]`, `.length`), so a component that already uses it shows
 * the right one without changes. Prefer `changelog()` in new code.
 */
export const CHANGELOG: readonly ChangelogVersion[] = new Proxy([] as ChangelogVersion[], {
  get: (_target, prop) => Reflect.get(changelog(), prop) as unknown,
  has: (_target, prop) => Reflect.has(changelog(), prop),
});
