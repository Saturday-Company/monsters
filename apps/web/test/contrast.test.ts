import { ROSTER, ROSTER_ORDER, derivePalette } from '@monsters/monster-kit';
import { describe, expect, it } from 'vitest';
import { composite, contrast, parseColor, type Rgb, type Rgba } from '../src/lib/color.ts';
import { colorOf, monsterFor } from '../src/lib/monsters.ts';
import { accentInk, BUBBLE_TINT, bubbleColors } from '../src/theme/bubbles.ts';
import { THEMES, type ThemeName, type ThemeTokens } from '../src/theme/tokens.ts';
import { DIFF_COLORS, GROUP_HUES, paletteColor } from '../src/theme/vault.ts';

/*
 * Automatic contrast check (WCAG AA, 4.5:1) for the text the UI puts on its
 * surfaces (docs/design.md, "Strumento"). Every surface is opaque: chassis,
 * panel, raised and well; the screens are black in both themes. Translucent
 * fills of the older views are composited over the surface they sit on.
 */

const AA = 4.5;
const THEME_NAMES: ThemeName[] = ['light', 'dark'];

const rgba = (s: string): Rgba => {
  const c = parseColor(s);
  if (!c) throw new Error(`bad colour ${s}`);
  return c;
};

/** `top` (maybe translucent) laid over the opaque `under`. */
const over = (top: string, under: string | Rgb): Rgb =>
  composite(rgba(top), typeof under === 'string' ? rgba(under) : under);

const ratio = (fg: string, bg: string | Rgb): number =>
  contrast(rgba(fg), typeof bg === 'string' ? rgba(bg) : bg);

type Surface = 'chassis' | 'panel' | 'raised' | 'well';
const SURFACES: Surface[] = ['chassis', 'panel', 'raised', 'well'];

describe('theme tokens', () => {
  for (const name of THEME_NAMES) {
    const t: ThemeTokens = THEMES[name];

    it(`${name}: the surfaces, the fills under text and the screen are opaque`, () => {
      for (const s of SURFACES) expect(rgba(t[s]).a).toBe(1);
      for (const c of [t.signal, t.stop, t.stopSoft, t.screen, t.keyEdge]) {
        expect(rgba(c).a).toBe(1);
      }
    });

    for (const s of SURFACES) {
      it(`${name}: ink and ink-muted on ${s}`, () => {
        expect(ratio(t.ink, t[s])).toBeGreaterThanOrEqual(AA);
        expect(ratio(t.inkMuted, t[s])).toBeGreaterThanOrEqual(AA);
      });

      it(`${name}: the signal and the red as text on ${s}`, () => {
        expect(ratio(t.signalInk, t[s])).toBeGreaterThanOrEqual(AA);
        expect(ratio(t.stopInk, t[s])).toBeGreaterThanOrEqual(AA);
      });
    }

    it(`${name}: ink-faint (labels, times) on panel and raised`, () => {
      expect(ratio(t.inkFaint, t.panel)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.inkFaint, t.raised)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: the lever of a switch stands out of its track (WCAG 1.4.11, ≥ 3:1)`, () => {
      // The state of a switch is where its lever is: the cap or its edge must show on the well.
      const lever = Math.max(ratio(t.lever, t.well), ratio(t.leverEdge, t.well));
      expect(lever).toBeGreaterThanOrEqual(3);
      expect(rgba(t.lever).a).toBe(1);
    });

    it(`${name}: a primary key that cannot be pressed reads as a normal key`, () => {
      // Disabled primary = raised cap with ink-muted words (styles.css `.key-primary:disabled`).
      expect(ratio(t.inkMuted, t.raised)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: dark text on the signal keys, the stop fill`, () => {
      expect(ratio(t.onSignal, t.signal)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.onStop, t.stop)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: the user's bubble and the unread count (panel on ink)`, () => {
      expect(ratio(t.panel, t.ink)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.chassis, t.ink)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: the halt band and errors on the soft red`, () => {
      expect(ratio(t.stopInk, t.stopSoft)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.ink, t.stopSoft)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: text on the screens (status display, monitors, terminal)`, () => {
      expect(ratio(t.screenInk, t.screen)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.screenMuted, t.screen)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.screenStop, t.screen)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.screenOk, t.screen)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.signal, t.screen)).toBeGreaterThanOrEqual(AA);
      // The dots switched off are only a hint of the grid: barely there.
      const off = contrast(over(t.screenOff, t.screen), rgba(t.screen));
      expect(off).toBeGreaterThan(1.05);
      expect(off).toBeLessThan(1.6);
    });

    it(`${name}: older views: ink and ink-muted on their fills over panel and raised`, () => {
      for (const s of ['panel', 'raised'] as const) {
        for (const ink of [t.ink, t.inkMuted]) {
          expect(ratio(ink, over(t.fill, t[s]))).toBeGreaterThanOrEqual(AA);
          expect(ratio(ink, over(t.fillStrong, t[s]))).toBeGreaterThanOrEqual(AA);
        }
        expect(ratio(t.stopInk, over(t.fillStrong, t[s]))).toBeGreaterThanOrEqual(AA);
        expect(ratio(t.signalInk, over(t.fill, t[s]))).toBeGreaterThanOrEqual(AA);
      }
    });
  }
});

describe('monster bubbles', () => {
  // All seven monsters, both concept variants and the chosen one.
  const colours = ROSTER_ORDER.flatMap((name) => [
    { label: `${name} (scelto)`, color: colorOf(monsterFor(name)) },
    { label: `${name} A`, color: derivePalette(ROSTER[name].variants.A).base },
    { label: `${name} B`, color: derivePalette(ROSTER[name].variants.B).base },
  ]);

  for (const theme of THEME_NAMES) {
    const t = THEMES[theme];
    for (const { label, color } of colours) {
      it(`${theme}: ink on the ${label} bubble (${color}) ≥ 4.5`, () => {
        const b = bubbleColors(color, theme);
        expect(b.fg).toBe(t.ink);
        expect(ratio(b.fg, b.bg)).toBeGreaterThanOrEqual(AA);
        expect(ratio(b.fg, b.codeBg)).toBeGreaterThanOrEqual(AA);
      });

      it(`${theme}: the ${label} accent ink readable on the surfaces`, () => {
        for (const s of ['chassis', 'panel', 'raised'] as const) {
          expect(ratio(accentInk(color, theme), t[s])).toBeGreaterThanOrEqual(AA);
        }
      });
    }

    it(`${theme}: the bubble is the monster colour at ${BUBBLE_TINT[theme] * 100}% over raised`, () => {
      const titan = colorOf(monsterFor('titan'));
      const expected = composite({ ...rgba(titan), a: BUBBLE_TINT[theme] }, rgba(t.raised));
      const got = rgba(bubbleColors(titan, theme).bg);
      expect(Math.abs(got.r - expected.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.g - expected.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.b - expected.b)).toBeLessThanOrEqual(1);
      // a tint, not a grey: it differs from the surface
      expect(bubbleColors(titan, theme).bg).not.toBe(t.raised);
    });
  }

  it('handles any CSS colour the core might send', () => {
    for (const c of [
      '#123',
      '#ffeeaa',
      '#000000',
      '#ffffff',
      'rgb(40 200 120)',
      'rgba(255, 0, 0, 1)',
      'oklch(0.7 0.12 250)',
      'nonsense',
    ]) {
      for (const theme of THEME_NAMES) {
        const b = bubbleColors(c, theme);
        expect(ratio(b.fg, b.bg)).toBeGreaterThanOrEqual(AA);
        expect(ratio(b.fg, b.codeBg)).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

describe('vault view', () => {
  // components/vault: group colours (graph nodes, list dots, legend), diff rows,
  // tags and embeds on the fill, search highlights, graph labels.
  for (const name of THEME_NAMES) {
    const t = THEMES[name];

    it(`${name}: every group colour is readable on the surfaces (as text, so nodes too)`, () => {
      for (let i = 0; i < GROUP_HUES.length; i++) {
        const c = paletteColor(i, name);
        for (const s of ['panel', 'raised'] as const) {
          expect(ratio(c, t[s])).toBeGreaterThanOrEqual(AA);
        }
      }
      // Groups past the palette use the faint ink.
      expect(paletteColor(GROUP_HUES.length, name)).toBe(t.inkFaint);
    });

    it(`${name}: neighbouring group colours differ`, () => {
      const colours = GROUP_HUES.map((_, i) => rgba(paletteColor(i, name)));
      for (let i = 1; i < colours.length; i++) {
        const a = colours[i - 1]!;
        const b = colours[i]!;
        expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeGreaterThan(60);
      }
    });

    it(`${name}: diff rows ≥ 4.5`, () => {
      const d = DIFF_COLORS[name];
      expect(ratio(d.addFg, d.addBg)).toBeGreaterThanOrEqual(AA);
      expect(ratio(d.delFg, d.delBg)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: tags, embeds and search highlights on the panel ≥ 4.5`, () => {
      const tint = over(t.fill, t.panel);
      expect(ratio(t.inkMuted, tint)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.ink, tint)).toBeGreaterThanOrEqual(AA);
      // <mark>: the signal ink at 20% under ink.
      const mark = composite({ ...rgba(t.signalInk), a: 0.2 }, rgba(t.panel));
      expect(ratio(t.ink, mark)).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: graph labels (ink and ink-muted on a panel halo) ≥ 4.5`, () => {
      expect(ratio(t.ink, t.panel)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t.inkMuted, t.panel)).toBeGreaterThanOrEqual(AA);
    });
  }
});

/*
 * Settings rows of the older views: a `fill` group over the panel, a hovered
 * row one more `fill`, tags `fill-strong` on the group.
 */
describe('settings groups', () => {
  for (const name of THEME_NAMES) {
    const t: ThemeTokens = THEMES[name];
    const group = over(t.fill, t.panel);
    const hovered = composite(rgba(t.fill), group);
    const tag = composite(rgba(t.fillStrong), group);

    it(`${name}: text on a group, on a hovered row and on a tag`, () => {
      for (const bg of [group, hovered]) {
        expect(ratio(t.ink, bg)).toBeGreaterThanOrEqual(AA);
        expect(ratio(t.inkMuted, bg)).toBeGreaterThanOrEqual(AA);
        expect(ratio(t.stopInk, bg)).toBeGreaterThanOrEqual(AA);
        expect(ratio(t.signalInk, bg)).toBeGreaterThanOrEqual(3);
      }
      expect(ratio(t.ink, tag)).toBeGreaterThanOrEqual(AA);
    });
  }
});
