import { describe, expect, it } from 'vitest';
import { THEMES } from '../../web/src/theme/tokens.ts';
import { connectionsPageHtml } from '../src/main/connections-page.ts';
import { PAGE_PALETTE, pageThemeCss } from '../src/main/page-theme.ts';
import { bannerHtml } from '../src/main/remote-copy.ts';
import { statusPageHtml } from '../src/main/status-page.ts';
import {
  parseTitleBarColors,
  systemTitleBarColors,
  TITLE_BAR_HEIGHT,
  titleBarOptions,
  TitleBarState,
  windowBackground,
  windowChrome,
  type TitleBarColors,
} from '../src/main/title-bar.ts';

/* The integrated title bar (D-062): chrome per platform, overlay colours from the page. */

describe('window chrome', () => {
  it('inset on macOS, overlay on Windows and Linux, frame elsewhere', () => {
    expect(windowChrome('darwin', {})).toBe('inset');
    expect(windowChrome('win32', {})).toBe('overlay');
    expect(windowChrome('linux', {})).toBe('overlay');
    expect(windowChrome('freebsd', {})).toBe('frame');
    expect(windowChrome('openbsd', {})).toBe('frame');
  });

  it('MONSTERS_DESKTOP_TITLEBAR=system brings back the system frame', () => {
    expect(windowChrome('linux', { MONSTERS_DESKTOP_TITLEBAR: 'system' })).toBe('frame');
    expect(windowChrome('win32', { MONSTERS_DESKTOP_TITLEBAR: ' Frame ' })).toBe('frame');
    expect(windowChrome('darwin', { MONSTERS_DESKTOP_TITLEBAR: 'native' })).toBe('frame');
    // Anything else keeps the integrated bar.
    expect(windowChrome('linux', { MONSTERS_DESKTOP_TITLEBAR: 'overlay' })).toBe('overlay');
    expect(windowChrome('linux', { MONSTERS_DESKTOP_TITLEBAR: '' })).toBe('overlay');
  });

  it('window options: hidden bar, traffic lights centred in the 52 px rail, overlay colours', () => {
    expect(titleBarOptions('inset', false)).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 18 },
    });
    expect(titleBarOptions('overlay', false)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#e3e1db', symbolColor: '#1a1a18', height: 52 },
    });
    expect(titleBarOptions('overlay', true)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#151514', symbolColor: '#ecebe5', height: 52 },
    });
    expect(titleBarOptions('frame', true)).toEqual({});
    expect(windowBackground(false)).toBe('#e3e1db');
    expect(windowBackground(true)).toBe('#151514');
    expect(TITLE_BAR_HEIGHT).toBe(52);
  });

  it('system colours are the chassis of the rail and the ink of the spec', () => {
    expect(systemTitleBarColors(false)).toEqual({
      color: PAGE_PALETTE.light.chassis,
      symbolColor: PAGE_PALETTE.light.ink,
    });
    expect(systemTitleBarColors(true)).toEqual({
      color: PAGE_PALETTE.dark.chassis,
      symbolColor: PAGE_PALETTE.dark.ink,
    });
  });
});

describe('title bar colours from the page', () => {
  it('accepts exactly { background, symbol } as #rrggbb, lower-cased', () => {
    expect(parseTitleBarColors({ background: '#FFFFFF', symbol: '#1d1d1f' })).toEqual({
      color: '#ffffff',
      symbolColor: '#1d1d1f',
    });
    expect(
      parseTitleBarColors(
        Object.assign(Object.create(null), {
          background: '#1c1c1e',
          symbol: '#f5f5f7',
        }),
      ),
    ).toEqual({ color: '#1c1c1e', symbolColor: '#f5f5f7' });
  });

  it('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      undefined,
      '#ffffff',
      42,
      ['#ffffff', '#000000'],
      {},
      { background: '#ffffff' },
      { symbol: '#ffffff' },
      { background: '#ffffff', symbol: '#000000', height: 10 },
      { background: '#fff', symbol: '#000' },
      { background: '#ffffff00', symbol: '#000000' },
      { background: 'rgb(0,0,0)', symbol: '#000000' },
      { background: 'red', symbol: '#000000' },
      { background: 'transparent', symbol: '#000000' },
      { background: '#ffffff\n', symbol: '#000000' },
      { background: ' #ffffff', symbol: '#000000' },
      { background: '#gggggg', symbol: '#000000' },
      { background: 0xffffff, symbol: '#000000' },
      { background: '#ffffff', symbol: { toString: () => '#000000' } },
      { background: 'undefined', symbol: 'undefined' },
      new (class {
        background = '#ffffff';
        symbol = '#000000';
      })(),
    ];
    for (const input of bad) expect(parseTitleBarColors(input), String(input)).toBeNull();
  });

  it('the page takes over from the system theme until the window shows something else', () => {
    const applied: TitleBarColors[] = [];
    const state = new TitleBarState('overlay', (c) => applied.push(c));
    state.system(true);
    expect(applied).toEqual([{ color: '#151514', symbolColor: '#ecebe5' }]);
    expect(state.page({ background: '#ffffff', symbol: '#1d1d1f' })).toBe(true);
    expect(state.fromPage).toBe(true);
    // The system turns light, then dark: the page chose its theme, nothing changes.
    state.system(false);
    state.system(true);
    expect(applied).toHaveLength(2);
    // Refused colours change nothing.
    expect(state.page({ background: 'red', symbol: '#000000' })).toBe(false);
    expect(applied).toHaveLength(2);
    // The same colours again: no call.
    state.page({ background: '#FFFFFF', symbol: '#1d1d1f' });
    expect(applied).toHaveLength(2);
    // Status page or a new load: back to the system theme, which it follows again.
    state.reset(true);
    expect(state.fromPage).toBe(false);
    expect(applied.at(-1)).toEqual({ color: '#151514', symbolColor: '#ecebe5' });
    state.system(false);
    expect(applied.at(-1)).toEqual({ color: '#e3e1db', symbolColor: '#1a1a18' });
  });

  it('does nothing without an overlay (macOS, system frame)', () => {
    for (const chrome of ['inset', 'frame'] as const) {
      const applied: TitleBarColors[] = [];
      const state = new TitleBarState(chrome, (c) => applied.push(c));
      expect(state.page({ background: '#ffffff', symbol: '#1d1d1f' })).toBe(true);
      state.reset(true);
      state.system(false);
      expect(applied).toEqual([]);
    }
  });
});

describe('pages of the app in the palette of the instrument', () => {
  const old = [
    '#e8ecf4',
    '#0b0c12',
    'blob',
    'radial-gradient',
    '#0a6cff',
    '--accent',
    'border-radius:999px',
    'rgba(23,21,31',
  ];

  it('status page, connections page and banner: spec colours, no old backdrop', () => {
    const pages = [
      statusPageHtml({ kind: 'failed', logPath: '/tmp/desktop.log' }),
      connectionsPageHtml('overlay'),
      bannerHtml('Collegato a casa', 'ok'),
    ];
    for (const html of pages) for (const s of old) expect(html).not.toContain(s);
    expect(pages[0]).toContain(pageThemeCss());
    expect(pages[0]).toContain('background:var(--chassis)');
    expect(pages[1]).toContain(pageThemeCss());
  });

  it('connections page: integrated bar for the chrome of the platform', () => {
    expect(connectionsPageHtml('inset')).toContain('<html lang="it" data-chrome="inset">');
    const overlay = connectionsPageHtml('overlay');
    expect(overlay).toContain('data-chrome="overlay"');
    expect(overlay).toContain('env(titlebar-area-width');
    expect(overlay).toMatch(/\.titlebar\{[^}]*height:52px[^}]*-webkit-app-region:drag/);
    expect(overlay).toMatch(/button\{[^}]*-webkit-app-region:no-drag/);
    expect(connectionsPageHtml()).toContain('data-chrome="frame"');
  });

  it('the palette is the one of the web UI, value by value', () => {
    const plain = (v: string) => v.replace(/\s+/g, '').replace(/(?<![\d.])0\./g, '.');
    for (const name of ['light', 'dark'] as const) {
      const web = THEMES[name];
      const page = PAGE_PALETTE[name];
      for (const [key, value] of Object.entries(page)) {
        const webKey = (key === 'shadowRgb' ? 'shadow' : key) as keyof typeof web;
        expect(plain(value), `${name}.${key}`).toBe(plain(web[webKey]));
      }
    }
  });

  it('pages of the instrument (D-089): fonts inside, the rail, Titan in dots', () => {
    const pages = [
      statusPageHtml({ kind: 'welcome' }, 'inset'),
      statusPageHtml({ kind: 'failed', logPath: '/tmp/desktop.log' }, 'overlay'),
      connectionsPageHtml('overlay'),
    ];
    for (const html of pages) {
      // The fonts of the web UI travel in the page: nothing is fetched.
      expect(html).toContain('font-src data:');
      for (const family of ['Instrument Sans', 'Martian Mono', 'Doto']) {
        expect(html).toMatch(
          new RegExp(`@font-face\\{font-family:'${family}';[^}]*src:url\\(data:font/woff2;base64,`),
        );
      }
      expect(html).toContain('<span class="wordmark" aria-hidden="true">monsters</span>');
      expect(html).not.toContain('backdrop-filter');
      expect(html).not.toContain('will-change');
    }
    // The status page knows the chrome of the window: room for the traffic lights or the buttons.
    expect(pages[0]).toContain('<html lang="it" data-chrome="inset">');
    expect(pages[1]).toContain('<html lang="it" data-chrome="overlay">');
    expect(statusPageHtml({ kind: 'starting' })).toContain('data-chrome="frame"');
    // Titan is the dot creature of the web UI (renderDots), with its frames.
    for (const html of pages.slice(0, 2)) {
      expect(html).toMatch(/<svg [^>]*data-dots="titan"/);
      expect(html).toContain('@keyframes dk-');
    }
    // A wait has dashes, never a spinner; a problem a red light.
    expect(statusPageHtml({ kind: 'starting' })).toContain('<span class="meter"');
    expect(pages[1]).toContain('<span class="led" data-tone="stop">');
  });

  it('one orange key per page', () => {
    const orange = (html: string) =>
      (html.match(/<button[^>]*>/g) ?? []).filter((b) => !/class="(secondary|choice)/.test(b))
        .length;
    expect(orange(statusPageHtml({ kind: 'failed', logPath: '/l' }))).toBe(1);
    expect(orange(statusPageHtml({ kind: 'starting' }))).toBe(0);
    expect(
      orange(
        statusPageHtml({
          kind: 'remote-failed',
          name: 'Casa',
          errorKind: 'auth-failed',
          message: 'x',
          detail: '',
        }),
      ),
    ).toBe(1);
    // "Usa" in the list of computers is a plain key: the orange one is "Salva e collega".
    expect(connectionsPageHtml()).toMatch(/\.row-actions button\.primary\{--cap:var\(--raised\)/);
  });
});
