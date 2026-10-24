import { createContext, useContext } from 'react';

/**
 * The part of a tab a link points to (`?sezione=istinto` → `istinto`), until it has been scrolled
 * into view. A closed drawer that holds the part reads it to open itself: the element
 * `settings-<part>` only exists once it is open.
 */
export const SettingsTargetContext = createContext<string | null>(null);

export function useSettingsTarget(): string | null {
  return useContext(SettingsTargetContext);
}
