import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lang } from '@monsters/shared';
import { tempHome } from './helpers.ts';

/*
 * A data folder whose app language is `lang` (D-153): a core reads `settings.json` at its start
 * and sets the language from it (a test core gets no `MONSTERS_LANG` from the environment), so a
 * test of the Italian family of what the models read starts its core in `langHome('it')`, after
 * `inLang('it')` (prompt-lang.ts) for the texts made outside the core.
 */
export function langHome(lang: Lang): string {
  const home = tempHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ language: lang }));
  return home;
}
