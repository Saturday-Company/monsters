import { readFileSync } from 'node:fs';
import { MCP_CATALOG, type ClaudeConnectionView, type McpServerView } from '@monsters/shared';
import * as simpleIcons from 'simple-icons';
import { describe, expect, it } from 'vitest';
import { BRAND_ICONS, SIMPLE_ICONS_VERSION } from '../src/components/settings/brand-icons.ts';
import { SATURDAY_ICONS } from '../src/components/settings/saturday-icons.ts';
import {
  GENERIC_ICONS,
  claudeGalleryState,
  galleryState,
  serverOf,
  viaClaudeOf,
} from '../src/components/settings/McpGallery.tsx';
import { BRAND_MIN_CONTRAST, brandLight, screenContrast } from '../src/lib/brand-light.ts';

/* The marks of the MCP gallery (D-063) and the state of its keys. */

const SI = new Map(
  Object.values(
    simpleIcons as unknown as Record<string, { slug?: string; hex: string; path: string }>,
  )
    .filter((i) => typeof i === 'object' && i !== null && typeof i.slug === 'string')
    .map((i) => [i.slug!, i]),
);

describe('brand icons', () => {
  it('every entry has a mark from simple-icons or a generic icon', () => {
    for (const e of MCP_CATALOG) {
      expect(
        Boolean(BRAND_ICONS[e.icon] ?? SATURDAY_ICONS[e.icon] ?? GENERIC_ICONS[e.icon]),
        e.id,
      ).toBe(true);
    }
  });

  it('Saturday’s marks are drawn by hand, one light on the screen like the others (D-075)', () => {
    expect(Object.keys(SATURDAY_ICONS).sort()).toEqual(['anteiku', 'witdesk']);
    for (const [slug, icon] of Object.entries(SATURDAY_ICONS)) {
      expect(BRAND_ICONS[slug], slug).toBeUndefined();
      expect(MCP_CATALOG.some((e) => e.icon === slug)).toBe(true);
      expect(icon.light).toBe(brandLight(icon.hex));
      expect(screenContrast(icon.light), slug).toBeGreaterThanOrEqual(BRAND_MIN_CONTRAST - 0.01);
      // A square box, so the mark sits in the middle of the screen like a 24×24 one.
      const [, , w, h] = icon.viewBox.split(' ').map(Number);
      expect(w).toBe(h);
      expect(icon.paths.length).toBeGreaterThan(0);
    }
  });

  it('the copied marks are those of the pinned simple-icons (run `icons` after an update)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(SIMPLE_ICONS_VERSION).toBe(pkg.devDependencies['simple-icons']);
    expect(SIMPLE_ICONS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [slug, icon] of Object.entries(BRAND_ICONS)) {
      const si = SI.get(slug);
      expect(si, slug).toBeDefined();
      expect(icon.path).toBe(si!.path);
      expect(icon.hex).toBe(si!.hex);
      expect(icon.light).toBe(brandLight(icon.hex));
    }
    // Only the marks the catalog uses go in the bundle.
    const used = new Set(MCP_CATALOG.map((e) => e.icon));
    for (const slug of Object.keys(BRAND_ICONS)) expect(used.has(slug), slug).toBe(true);
  });

  it('each mark is light on the black screens: at least 3:1 in both themes', () => {
    for (const [slug, icon] of Object.entries(BRAND_ICONS)) {
      expect(screenContrast(icon.light), slug).toBeGreaterThanOrEqual(3);
      expect(screenContrast(icon.light), slug).toBeGreaterThanOrEqual(BRAND_MIN_CONTRAST - 0.01);
    }
    // Black marks take the screen's light; a dark blue keeps its hue, lifted.
    expect(brandLight('000000')).toBe('#efe9dc');
    expect(brandLight('0052CC')).not.toBe('#efe9dc');
    expect(brandLight('FF4F00')).toBe('#ff4f00');
  });
});

describe('gallery state', () => {
  const entry = (id: string) => MCP_CATALOG.find((e) => e.id === id)!;
  const view = (over: Partial<McpServerView>): McpServerView => ({
    name: 'x',
    label: 'X',
    transport: 'http',
    url: 'https://example.com/mcp',
    envKeys: [],
    headerKeys: [],
    enabled: true,
    agents: ['*'],
    tools: [],
    timeoutSec: 60,
    status: 'idle',
    ...over,
  });

  it('finds the server of an entry by its tag, or by name and address', () => {
    const tagged = view({ name: 'notion-2', catalog: 'notion' });
    expect(serverOf(entry('notion'), [tagged])).toBe(tagged);
    const old = view({ name: 'linear', url: 'https://mcp.linear.app/mcp' });
    expect(serverOf(entry('linear'), [old])).toBe(old);
    // Same name, another address: a program of the user, not the gallery's.
    expect(serverOf(entry('linear'), [view({ name: 'linear' })])).toBeUndefined();
  });

  it('says what the key shows', () => {
    expect(galleryState(entry('slack'), undefined)).toBe('soon');
    expect(galleryState(entry('notion'), undefined)).toBe('off');
    const oauth = (connected: boolean, pending: boolean) =>
      view({ catalog: 'notion', oauth: { connected, pending } });
    expect(galleryState(entry('notion'), oauth(false, true))).toBe('waiting');
    expect(galleryState(entry('notion'), oauth(false, false))).toBe('login');
    expect(galleryState(entry('notion'), oauth(true, false))).toBe('connected');
    // A sign-in the service refused while in use (connettori 1), tokens gone or not.
    for (const connected of [false, true]) {
      const refused = view({
        catalog: 'notion',
        status: 'error',
        oauth: { connected, pending: false, needsSignIn: true },
      });
      expect(galleryState(entry('notion'), refused)).toBe('signin');
    }
    // A call refused for a scope the access lacks (insufficient_scope): «Collega» for more.
    const moreScope = view({
      catalog: 'notion',
      status: 'running',
      oauth: { connected: true, pending: false, moreScope: 'read write admin' },
    });
    expect(galleryState(entry('notion'), moreScope)).toBe('signin');
    expect(galleryState(entry('github'), view({ catalog: 'github', status: 'error' }))).toBe(
      'error',
    );
  });

  it('a service through Claude: "Collega tramite Claude" only with the Claude plan (D-069)', () => {
    const figma: ClaudeConnectionView = {
      id: 'figma',
      added: false,
      agents: ['*'],
      state: 'unknown',
      parts: [{ name: 'Figma', state: 'unknown' }],
    };
    expect(viaClaudeOf(entry('figma'), null)).toBeUndefined();
    expect(viaClaudeOf(entry('figma'), { claude: false, connections: [figma] })).toBeUndefined();
    expect(viaClaudeOf(entry('notion'), { claude: true, connections: [figma] })).toBeUndefined();
    expect(viaClaudeOf(entry('figma'), { claude: true, connections: [figma] })).toBe(figma);
    expect(claudeGalleryState(figma)).toBe('claude');
    expect(claudeGalleryState({ ...figma, added: true, state: 'connected' })).toBe('connected');
    expect(claudeGalleryState({ ...figma, added: true, state: 'missing' })).toBe('login');
    expect(claudeGalleryState({ ...figma, added: true, state: 'needs_login' })).toBe('login');
    expect(claudeGalleryState({ ...figma, added: true, state: 'error' })).toBe('error');
  });
});
