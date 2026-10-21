import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appLang, setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppLanguage } from '../src/i18n.ts';
import { startCore, type CoreServer } from '../src/index.ts';
import { BROWSER_HEADERS, browserSession, EMAIL, PASSWORD, postJson, tempHome } from './helpers.ts';

/* The app's language (D-153): written at the first start, chosen on the first screen and from the settings. */

let core: CoreServer | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
  setAppLang('en');
});

const settingsOf = (home: string) =>
  JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as Record<string, unknown>;

describe('resolveAppLanguage', () => {
  it('a new install takes the system language and writes it', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    expect(resolveAppLanguage(home, false, { MONSTERS_LANG: 'it' })).toBe('it');
    expect(settingsOf(home)['language']).toBe('it');
    expect(appLang()).toBe('it');
    // Written once: the system changing later does not change the app.
    expect(resolveAppLanguage(home, true, { MONSTERS_LANG: 'en' })).toBe('it');
  });

  it('an install that already has an account stays Italian, the other settings kept', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ userName: 'Giulia' }));
    expect(resolveAppLanguage(home, true, { MONSTERS_LANG: 'en' })).toBe('it');
    expect(settingsOf(home)).toEqual({ userName: 'Giulia', language: 'it' });
  });
});

describe('language API', () => {
  it('is public before the account, set by the first screen, then changed from the settings', async () => {
    const home = tempHome();
    core = await startCore({ home, port: 0, env: { ...process.env, MONSTERS_LANG: 'en' } });
    const { url } = core;
    expect(await (await fetch(`${url}/api/setup-status`)).json()).toEqual({
      needsSetup: true,
      language: 'en',
    });

    const res = await postJson(`${url}/api/setup`, {
      email: EMAIL,
      password: PASSWORD,
      setupCode: core.setupCode ?? '',
      language: 'it',
    });
    expect(res.status).toBe(201);
    expect(settingsOf(home)['language']).toBe('it');
    expect(await (await fetch(`${url}/api/setup-status`)).json()).toMatchObject({
      language: 'it',
    });

    const session = await browserSession(res);
    const put = await fetch(`${url}/api/settings/language`, {
      method: 'PUT',
      headers: { ...BROWSER_HEADERS, ...session },
      body: JSON.stringify({ language: 'en' }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { language: string }).language).toBe('en');
    expect(settingsOf(home)['language']).toBe('en');
    expect(appLang()).toBe('en');

    const bad = await fetch(`${url}/api/settings/language`, {
      method: 'PUT',
      headers: { ...BROWSER_HEADERS, ...session },
      body: JSON.stringify({ language: 'fr' }),
    });
    expect(bad.status).toBe(400);
  });
});
