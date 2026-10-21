import type { Lang } from './i18n.ts';

/*
 * The languages the monsters write in (the `lingua` answer of the onboarding, D-153): not the
 * app's language. The prompts name the writing language with a word of their own family
 * ("Sempre in italiano", "Always in Italian"); files already on disk hold either word, so
 * reading accepts both and the code, the Italian word and the English word map to each other
 * here, in one place.
 */

export interface WritingLanguage {
  id: string;
  /** Its name inside the Italian prompts and notes. */
  it: string;
  /** Its name inside the English prompts and notes. */
  en: string;
}

// The names of the languages in each family: data, not copy.
export const WRITING_LANGUAGES: readonly WritingLanguage[] = [
  { id: 'it', it: 'italiano', en: 'Italian' }, // i18n-ignore
  { id: 'en', it: 'inglese', en: 'English' }, // i18n-ignore
  { id: 'es', it: 'spagnolo', en: 'Spanish' }, // i18n-ignore
  { id: 'fr', it: 'francese', en: 'French' }, // i18n-ignore
  { id: 'de', it: 'tedesco', en: 'German' }, // i18n-ignore
];

/** The writing language of a code or of a name in either family ("it", "italiano", "Italian"). */
export function writingLanguage(value: string): WritingLanguage | undefined {
  const v = value.trim().toLowerCase();
  return WRITING_LANGUAGES.find(
    (l) => l.id === v || l.it.toLowerCase() === v || l.en.toLowerCase() === v,
  );
}

/**
 * The name of a writing language in a family's prompts. A name already of that family is kept
 * as it is (its case too: an Italian prompt renders byte for byte what it rendered before); a
 * language not in the table stays as written.
 */
export function writingLanguageName(value: string, lang: Lang): string {
  const l = writingLanguage(value);
  if (!l) return value;
  return value.trim().toLowerCase() === l[lang].toLowerCase() ? value : l[lang];
}
