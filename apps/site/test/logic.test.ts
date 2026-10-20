import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/i18n/strings.ts';
import {
  compareVersions,
  downloadsFrom,
  formatSize,
  latestVersion,
  parseFeed,
} from '../src/lib/feed.ts';
import { fromBase64, revealFrame, toBase64, wrapBase64 } from '../src/lib/manifesto.ts';
import { dotTextCells } from '../src/lib/og.ts';
import { detectArch, detectOs, detectPlatform } from '../src/lib/os.ts';
import { KONAMI, sequenceMatcher, versionStamp } from '../src/lib/stamp.ts';
import {
  STAR_CACHE_KEY,
  formatStars,
  readStarCache,
  starsFromRepo,
  writeStarCache,
} from '../src/lib/stars.ts';

const UA = {
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Mobile Safari/537.36',
};

describe('OS detection', () => {
  it('recognises the desktop systems', () => {
    expect(detectOs(UA.linux)).toBe('linux');
    expect(detectOs(UA.mac)).toBe('mac');
    expect(detectOs(UA.win)).toBe('windows');
  });

  it('offers no installer to phones, even Linux-based ones and iPhones that say "Mac OS X"', () => {
    expect(detectOs(UA.iphone)).toBe('unknown');
    expect(detectOs(UA.android)).toBe('unknown');
    expect(detectOs('')).toBe('unknown');
  });

  it('uses the client hint for the architecture, and assumes Apple silicon on an unknown Mac', () => {
    expect(detectArch('mac', UA.mac)).toBe('arm64');
    expect(detectArch('mac', UA.mac, 'x86')).toBe('x64');
    expect(detectArch('windows', UA.win)).toBe('x64');
    expect(detectArch('linux', 'Mozilla/5.0 (X11; Linux aarch64)')).toBe('arm64');
    expect(detectPlatform(UA.linux, 'Linux x86_64')).toEqual({ os: 'linux', arch: 'x64' });
  });
});

const LINUX_FEED = `version: 0.1.0-alpha.17
files:
  - url: Monsters-0.1.0-alpha.17-linux-x86_64.AppImage
    sha512: abc==
    size: 123295747
    blockMapSize: 130567
  - url: Monsters-0.1.0-alpha.17-linux-amd64.deb
    sha512: def==
    size: 104792076
path: Monsters-0.1.0-alpha.17-linux-x86_64.AppImage
sha512: abc==
releaseDate: '2026-10-19T16:40:03.539Z'
`;

const MAC_FEED = `version: 0.1.0-alpha.17
files:
  - url: Monsters-0.1.0-alpha.17-mac-x64.zip
    size: 136743044
  - url: Monsters-0.1.0-alpha.17-mac-arm64.zip
    size: 130054029
  - url: Monsters-0.1.0-alpha.17-mac-x64.dmg
    size: 141717026
  - url: Monsters-0.1.0-alpha.17-mac-arm64.dmg
    size: 135025433
releaseDate: '2026-10-19T16:57:38.078Z'
`;

const WIN_FEED = `version: "0.1.0-alpha.18"
files:
  - url: Monsters-Setup-0.1.0-alpha.18-x64-unsigned.exe
    size: 124626414
`;

describe('feed parsing', () => {
  it('reads version, date and files of an electron-updater feed', () => {
    const f = parseFeed(LINUX_FEED);
    expect(f.version).toBe('0.1.0-alpha.17');
    expect(f.releaseDate).toBe('2026-10-19T16:40:03.539Z');
    expect(f.files).toEqual([
      { url: 'Monsters-0.1.0-alpha.17-linux-x86_64.AppImage', size: 123295747 },
      { url: 'Monsters-0.1.0-alpha.17-linux-amd64.deb', size: 104792076 },
    ]);
  });

  it('rejects a feed without version or files', () => {
    expect(() => parseFeed('files:\n  - url: a.exe\n')).toThrow(/version/);
    expect(() => parseFeed('version: 1.0.0\n')).toThrow(/files/);
  });

  it('maps the files to the five installers, skipping the zips, with GitHub release links', () => {
    const d = downloadsFrom([LINUX_FEED, WIN_FEED, MAC_FEED].map(parseFeed));
    expect(d.map((x) => x.id)).toEqual(['appimage', 'deb', 'dmg-arm64', 'dmg-x64', 'exe']);
    expect(d.find((x) => x.id === 'dmg-arm64')?.file).toBe('Monsters-0.1.0-alpha.17-mac-arm64.dmg');
    expect(d[0]?.url).toBe(
      'https://github.com/Saturday-Company/monsters/releases/latest/download/Monsters-0.1.0-alpha.17-linux-x86_64.AppImage',
    );
  });

  it('picks the newest version and formats sizes', () => {
    expect(latestVersion([LINUX_FEED, WIN_FEED].map(parseFeed))).toBe('0.1.0-alpha.18');
    expect(compareVersions('0.1.0-alpha.9', '0.1.0-alpha.10')).toBe(-1);
    expect(compareVersions('0.1.0', '0.1.0-alpha.10')).toBe(1);
    expect(formatSize(123295747)).toBe('118 MB');
    expect(formatSize(52428800)).toBe('50.0 MB');
    expect(formatSize(0)).toBe('');
  });
});

describe('manifesto', () => {
  const text = STRINGS.it.oss.manifesto;

  it('round-trips UTF-8 through base64', () => {
    const b64 = toBase64(text);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(fromBase64(b64)).toBe(text);
    expect(fromBase64(wrapBase64(b64, 16).join('\n'))).toBe(text);
  });

  it('decodes left to right, frame by frame', () => {
    const b64 = toBase64('hello monsters');
    expect(revealFrame('hello monsters', b64, 0, 10)).toBe(b64);
    expect(revealFrame('hello monsters', b64, 10, 10)).toBe('hello monsters');
    const mid = revealFrame('hello monsters', b64, 5, 10);
    expect(mid.startsWith('hello m')).toBe(true);
    expect(mid.endsWith(b64.slice(7))).toBe(true);
  });
});

describe('star counter', () => {
  it('fits the four LED cells', () => {
    expect(formatStars(null)).toBe('----');
    expect(formatStars(7)).toBe('   7');
    expect(formatStars(1234)).toBe('1234');
    expect(formatStars(12345)).toBe(' 12k');
    expect(formatStars(1_250_000)).toBe('1.3M');
  });

  it('reads the API body defensively', () => {
    expect(starsFromRepo({ stargazers_count: 42 })).toBe(42);
    expect(starsFromRepo({ message: 'Not Found' })).toBeNull();
    expect(starsFromRepo(null)).toBeNull();
  });

  it('caches for an hour and survives broken or blocked storage', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    writeStarCache(storage, 99, 1000);
    expect(readStarCache(storage, 1000 + 60_000)).toEqual({ count: 99, at: 1000 });
    expect(readStarCache(storage, 1000 + 2 * 60 * 60 * 1000)).toBeNull();
    map.set(STAR_CACHE_KEY, '{not json');
    expect(readStarCache(storage, 1000)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readStarCache(blocked, 1000)).toBeNull();
    expect(() => writeStarCache(blocked, 1, 1000)).not.toThrow();
  });
});

describe('stamp, Konami code and dot font', () => {
  it('turns the version into a part number', () => {
    expect(versionStamp('0.1.0-alpha.18')).toBe('MNSTR.0A18');
    expect(versionStamp('0.2.0-beta.3')).toBe('MNSTR.0B3');
    expect(versionStamp('1.2.0')).toBe('MNSTR.1.2');
    expect(versionStamp('dev')).toBe('MNSTR.DEV');
  });

  it('matches the Konami code even after a false start', () => {
    const m = sequenceMatcher(KONAMI);
    const keys = ['ArrowUp', ...KONAMI];
    expect(keys.map(m).filter(Boolean)).toHaveLength(1);
    expect(m('B')).toBe(false);
  });

  it('has a 5 × 7 glyph for every character of the OG card', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-monsters') {
      const { cells } = dotTextCells(ch);
      expect(cells.length, ch).toBeGreaterThan(0);
      expect(
        cells.every(([x, y]) => x < 5 && y < 7),
        ch,
      ).toBe(true);
    }
  });
});

describe('strings', () => {
  it('has the same keys in English and Italian', () => {
    const keys = (o: unknown, p = ''): string[] =>
      typeof o === 'object' && o !== null
        ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}.${k}`))
        : [p];
    expect(keys(STRINGS.it).sort()).toEqual(keys(STRINGS.en).sort());
  });

  it('never uses an em or en dash', () => {
    expect(JSON.stringify(STRINGS)).not.toMatch(/[–—]/);
  });
});
