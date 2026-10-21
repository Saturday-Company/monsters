import { setAppLang, type Lang } from '@monsters/shared';
import { onTestFinished } from 'vitest';

/*
 * The texts the models read follow the app's language (D-153, wave 3). Tests start in English; a
 * test of the Italian family calls `inLang('it')` first: the Italian assertions it makes are the
 * proof that the Italian prompts did not move. Starting a core picks the language of the
 * environment (`MONSTERS_LANG`), so that is set too; both go back when the test ends.
 */
export function inLang(lang: Lang): void {
  const saved = process.env['MONSTERS_LANG'];
  process.env['MONSTERS_LANG'] = lang;
  setAppLang(lang);
  onTestFinished(() => {
    if (saved === undefined) delete process.env['MONSTERS_LANG'];
    else process.env['MONSTERS_LANG'] = saved;
    setAppLang('en');
  });
}
