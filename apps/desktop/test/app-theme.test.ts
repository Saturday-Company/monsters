import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppTheme,
  envTheme,
  parseThemeChoice,
  themeSourceFor,
  type ThemeChoice,
} from '../src/main/app-theme.ts';
import { fromCorePage } from '../src/main/ipc-guards.ts';
import { parseConnectionsFile, ProfileStore } from '../src/main/profiles.ts';
import { tempDir } from './helpers.ts';

/* The theme of the web UI's Settings for the whole app (D-091). */

function storePath(): string {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, 'connections.json');
}

const onDisk = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('the choice a page sends', () => {
  it('only system, light or dark', () => {
    for (const ok of ['system', 'light', 'dark'] as const) expect(parseThemeChoice(ok)).toBe(ok);
    for (const bad of [
      'Dark',
      ' dark',
      'auto',
      '',
      null,
      undefined,
      1,
      { theme: 'dark' },
      ['dark'],
    ]) {
      expect(parseThemeChoice(bad)).toBeNull();
    }
  });

  it('MONSTERS_DESKTOP_THEME stands in for the system: what "Sistema" shows', () => {
    expect(envTheme({})).toBeNull();
    expect(envTheme({ MONSTERS_DESKTOP_THEME: 'dark' })).toBe('dark');
    expect(envTheme({ MONSTERS_DESKTOP_THEME: 'system' })).toBeNull();
    expect(themeSourceFor('system', null)).toBe('system');
    expect(themeSourceFor('system', 'light')).toBe('light');
    expect(themeSourceFor('dark', 'light')).toBe('dark');
    expect(themeSourceFor('light', null)).toBe('light');
  });
});

function fakeStore(theme: ThemeChoice = 'system') {
  const store = {
    theme,
    writes: [] as ThemeChoice[],
    setTheme(c: ThemeChoice) {
      store.theme = c;
      store.writes.push(c);
    },
  };
  return store;
}

describe('AppTheme', () => {
  it('applies the stored choice at start, then the valid choices of the page', () => {
    const store = fakeStore('dark');
    const applied: ThemeChoice[] = [];
    const lines: string[] = [];
    const t = new AppTheme({
      store,
      apply: (s) => applied.push(s),
      env: null,
      log: (l) => lines.push(l),
    });
    t.start();
    expect(applied).toEqual(['dark']);
    // The same choice again (every page load sends it): nothing written, nothing applied.
    expect(t.fromPage('dark')).toBe(true);
    expect(store.writes).toEqual([]);
    expect(applied).toEqual(['dark']);
    expect(t.fromPage('system')).toBe(true);
    expect(t.choice).toBe('system');
    expect(store.writes).toEqual(['system']);
    expect(applied).toEqual(['dark', 'system']);
    // Refused: the theme stays.
    for (const bad of ['#000000', 'DARK', 42, null]) expect(t.fromPage(bad)).toBe(false);
    expect(store.writes).toEqual(['system']);
    expect(applied).toEqual(['dark', 'system']);
    expect(lines.filter((l) => l.includes('refused'))).toHaveLength(4);
  });

  it('with the system theme of the tests, "Sistema" is that theme', () => {
    const store = fakeStore();
    const applied: ThemeChoice[] = [];
    const t = new AppTheme({ store, apply: (s) => applied.push(s), env: 'light', log: () => {} });
    t.start();
    t.fromPage('dark');
    t.fromPage('system');
    expect(applied).toEqual(['light', 'dark', 'light']);
  });
});

describe('the choice is kept with the connections', () => {
  it('written to connections.json and read at the next start; "Sistema" leaves no key', () => {
    const path = storePath();
    const a = new ProfileStore(path);
    a.setLast('local');
    expect(onDisk(path)).not.toHaveProperty('theme');
    a.setTheme('dark');
    expect(onDisk(path)).toMatchObject({ version: 1, last: 'local', theme: 'dark' });
    const b = new ProfileStore(path);
    expect(b.firstStart).toBe(false);
    expect(b.theme).toBe('dark');
    b.setTheme('system');
    expect(onDisk(path)).not.toHaveProperty('theme');
    expect(new ProfileStore(path).theme).toBe('system');
  });

  it('first start: the theme waits in memory, the file stays missing until the first choice', () => {
    const path = storePath();
    const s = new ProfileStore(path);
    s.setTheme('light');
    expect(s.theme).toBe('light');
    expect(() => readFileSync(path)).toThrow();
    s.setLast('local');
    expect(onDisk(path)).toMatchObject({ last: 'local', theme: 'light' });
  });

  it('an unknown theme is "Sistema", and the file is not damaged for it', () => {
    const path = storePath();
    writeFileSync(path, JSON.stringify({ version: 1, profiles: [], last: 'local', theme: 'neon' }));
    const s = new ProfileStore(path);
    expect(s.theme).toBe('system');
    expect(s.readOnly).toBe(false);
    expect(parseConnectionsFile(readFileSync(path, 'utf8'))).toEqual({
      version: 1,
      profiles: [],
      last: 'local',
    });
  });

  it('a file of a newer app is never rewritten: the theme lives in memory', () => {
    const path = storePath();
    const raw = JSON.stringify({ version: 2, profiles: [], last: 'local' });
    writeFileSync(path, raw);
    const s = new ProfileStore(path);
    s.setTheme('dark');
    expect(s.theme).toBe('dark');
    expect(readFileSync(path, 'utf8')).toBe(raw);
  });
});

describe('who may send it', () => {
  const frame = (url: string) => ({ url, origin: new URL(url).origin });
  const wc = (main: { url: string }) => ({ mainFrame: main });

  it('the core page of the window, also a remote core through the tunnel', () => {
    // Client mode: the web UI of the remote core comes from the tunnel's local origin.
    const tunnel = 'http://127.0.0.1:53127';
    const main = frame(`${tunnel}/impostazioni`);
    const win = wc(main);
    expect(fromCorePage({ sender: win, senderFrame: main }, win, tunnel)).toBe(true);
    // A status page or the connections window (data: URLs) never set it.
    const data = frame('data:text/html;base64,AAAA');
    expect(fromCorePage({ sender: wc(data), senderFrame: data }, wc(data), tunnel)).toBe(false);
  });
});
