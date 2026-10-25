import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The stored preferences (D-181): the technical details are off by default for everyone, and a
 * store written before the versioned reset loses its old `showDetails` once; after that the
 * person's own choice sticks.
 */

const KEY = 'monsters-prefs';

function fakeWindow(initial?: string, failWrites = false) {
  const storage = new Map<string, string>();
  if (initial !== undefined) storage.set(KEY, initial);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites) throw new Error('private mode');
        storage.set(k, v);
      },
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  return storage;
}

const load = async () => import('../src/store/prefs.ts');
const saved = (storage: Map<string, string>) =>
  JSON.parse(storage.get(KEY) ?? '{}') as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('technical details', () => {
  it('are off for a person who has no stored preferences', async () => {
    fakeWindow();
    const { usePrefs } = await load();
    expect(usePrefs.getState().showDetails).toBe(false);
  });

  it('are reset once for stored preferences without a version, whatever they held', async () => {
    for (const before of [{ showDetails: true }, { showDetails: false }, { theme: 'dark' }]) {
      const storage = fakeWindow(JSON.stringify(before));
      const { usePrefs, PREFS_VERSION } = await load();
      expect(usePrefs.getState().showDetails).toBe(false);
      // The reset is written back with the version, so it happens only once.
      expect(saved(storage)['version']).toBe(PREFS_VERSION);
      expect(saved(storage)['showDetails']).toBe(false);
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('keeps the other preferences while resetting', async () => {
    fakeWindow(JSON.stringify({ theme: 'dark', sounds: true, showDetails: true, dockWidth: 600 }));
    const { usePrefs } = await load();
    const p = usePrefs.getState();
    expect([p.theme, p.sounds, p.dockWidth]).toEqual(['dark', true, 600]);
  });

  it('keep the choice of a person who turned them on after the reset', async () => {
    const storage = fakeWindow(JSON.stringify({ showDetails: true }));
    const first = await load();
    expect(first.usePrefs.getState().showDetails).toBe(false);
    first.setPrefs({ showDetails: true });
    expect(saved(storage)['showDetails']).toBe(true);
    expect(saved(storage)['version']).toBe(first.PREFS_VERSION);
    vi.resetModules();
    const again = await load();
    expect(again.usePrefs.getState().showDetails).toBe(true);
  });

  it('keep the choice written at the current version, on or off', async () => {
    fakeWindow(JSON.stringify({ showDetails: true, version: 2 }));
    expect((await load()).usePrefs.getState().showDetails).toBe(true);
    vi.resetModules();
    fakeWindow(JSON.stringify({ showDetails: false, version: 2 }));
    expect((await load()).usePrefs.getState().showDetails).toBe(false);
  });

  it('stay off when the storage refuses the write (private mode)', async () => {
    fakeWindow(JSON.stringify({ showDetails: true }), true);
    const { usePrefs } = await load();
    expect(usePrefs.getState().showDetails).toBe(false);
  });

  it('are off for unreadable stored preferences', async () => {
    fakeWindow('{not json');
    const { usePrefs } = await load();
    expect(usePrefs.getState().showDetails).toBe(false);
  });
});
