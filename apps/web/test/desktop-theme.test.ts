import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The theme of the Settings to the desktop app (D-091): the choice, not the resolved theme,
 * sent at start and when it changes, once per choice; nothing in a browser or an older app.
 */

interface Query {
  matches: boolean;
  listeners: Set<() => void>;
}

function fakeWindow(bridge: Record<string, unknown> | undefined, dark = false) {
  const queries = new Map<string, Query>();
  const query = (q: string): Query => {
    let found = queries.get(q);
    if (!found) {
      found = { matches: q.includes('dark') ? dark : false, listeners: new Set() };
      queries.set(q, found);
    }
    return found;
  };
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    monstersDesktop: bridge,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    },
    matchMedia: (q: string) => {
      const entry = query(q);
      return {
        get matches() {
          return entry.matches;
        },
        addEventListener: (_: string, l: () => void) => entry.listeners.add(l),
        removeEventListener: (_: string, l: () => void) => entry.listeners.delete(l),
      };
    },
  });
  /** The system (or the app's themeSource) turns dark or light. */
  const setDark = (value: boolean) => {
    const q = query('(prefers-color-scheme: dark)');
    q.matches = value;
    for (const l of q.listeners) l();
  };
  return { storage, setDark };
}

const root = () =>
  ({ style: { setProperty: () => {}, colorScheme: '' }, dataset: {} }) as unknown as HTMLElement;

function bridge() {
  const themes: string[] = [];
  const colors: unknown[] = [];
  return {
    themes,
    colors,
    api: {
      isDesktop: true,
      version: '0.1.0',
      platform: 'linux',
      chrome: 'overlay',
      setupCode: () => Promise.resolve(null),
      openExternal: () => Promise.resolve(false),
      setTheme: (choice: string) => themes.push(choice),
      setTitleBarColors: (c: unknown) => colors.push(c),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('theme to the desktop app', () => {
  it('sends the stored choice at start, then each new choice once', async () => {
    const b = bridge();
    const { storage } = fakeWindow(b.api);
    storage.set('monsters-prefs', JSON.stringify({ theme: 'dark' }));
    const { watchPrefs, setPrefs } = await import('../src/store/prefs.ts');
    const stop = watchPrefs(root());
    expect(b.themes).toEqual(['dark']);
    // Another preference: nothing new for the app.
    setPrefs({ sounds: true });
    expect(b.themes).toEqual(['dark']);
    setPrefs({ theme: 'light' });
    setPrefs({ theme: 'system' });
    expect(b.themes).toEqual(['dark', 'light', 'system']);
    stop();
  });

  it('"Sistema" is sent as such: a change of the system theme is not a new choice', async () => {
    const b = bridge();
    const { setDark } = fakeWindow(b.api);
    const { watchPrefs } = await import('../src/store/prefs.ts');
    const stop = watchPrefs(root());
    setDark(true);
    setDark(false);
    expect(b.themes).toEqual(['system']);
    // The title bar colours still follow the resolved theme.
    expect(b.colors).toHaveLength(3);
    stop();
  });

  it('an older app without setTheme, and a browser, are left alone', async () => {
    const b = bridge();
    const { setTheme: _, ...older } = b.api;
    fakeWindow(older);
    const prefs = await import('../src/store/prefs.ts');
    expect(() => prefs.watchPrefs(root())()).not.toThrow();
    vi.resetModules();
    fakeWindow(undefined);
    const browser = await import('../src/store/prefs.ts');
    expect(() => browser.watchPrefs(root())()).not.toThrow();
  });
});
