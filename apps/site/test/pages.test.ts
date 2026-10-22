import { describe, expect, it } from 'vitest';
import { COMPARE, COMPETITORS, COMPETITOR_FACTS, ROWS } from '../src/i18n/compare.ts';
import { PAGES } from '../src/i18n/pages.ts';
import { STRINGS } from '../src/i18n/strings.ts';
import {
  GUIDES,
  absolutizeLinks,
  guideMarkdown,
  isoDate,
  parseChangelog,
  readRepoFile,
  changelogFile,
  SITE_LINKS,
} from '../src/lib/docs.ts';
import { llmsTxt } from '../src/lib/llms.ts';
import { allPages, alternatesOf } from '../src/lib/pages.ts';
import { pageGraph } from '../src/lib/seo.ts';
import fallback from '../src/data/fallback.json' with { type: 'json' };
import { downloadsFrom, latestVersion, type Feed } from '../src/lib/feed.ts';

const site = 'https://getmonsters.dev';

describe('guides', () => {
  it('reads every published guide from docs/ and drops its first heading', () => {
    for (const g of GUIDES) {
      const { title, body } = guideMarkdown(g);
      expect(title.length).toBeGreaterThan(3);
      expect(body.startsWith('#')).toBe(false);
      expect(body.length).toBeGreaterThan(500);
    }
  });

  it('keeps links between guides on the site and sends the rest to GitHub', () => {
    const out = absolutizeLinks(
      '[a](security-model.md#x) [b](DECISIONS.md) [c](../CONTRIBUTING.md)',
      'ROADMAP.md',
      SITE_LINKS,
    );
    expect(out).toContain('(/docs/security-model/#x)');
    expect(out).toContain(
      '(https://github.com/Saturday-Company/monsters/blob/main/docs/DECISIONS.md)',
    );
    expect(out).toContain(
      '(https://github.com/Saturday-Company/monsters/blob/main/CONTRIBUTING.md)',
    );
  });

  it('has an Italian summary for every guide, and the guides stay English only', () => {
    for (const g of GUIDES) {
      expect(PAGES.en.docs.summaries[g.slug].length).toBeGreaterThan(20);
      expect(PAGES.it.docs.summaries[g.slug].length).toBeGreaterThan(20);
    }
    expect(PAGES.it.docs.englishOnly).toMatch(/inglese/);
  });
});

describe('changelog', () => {
  it('reads the same releases, in the same order, in both languages', () => {
    const en = parseChangelog(readRepoFile(changelogFile('en')));
    const it = parseChangelog(readRepoFile(changelogFile('it')));
    expect(en.length).toBeGreaterThan(5);
    expect(it.map((r) => r.version)).toEqual(en.map((r) => r.version));
    expect(it.map((r) => r.date)).toEqual(en.map((r) => r.date));
    for (const r of [...en, ...it]) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.body.length).toBeGreaterThan(20);
    }
  });

  it('reads dates in both languages', () => {
    expect(isoDate('21 October 2026')).toBe('2026-10-21');
    expect(isoDate('9 ottobre 2026')).toBe('2026-10-09');
    expect(isoDate('soon')).toBe('');
  });
});

describe('comparisons', () => {
  for (const lang of ['en', 'it'] as const) {
    for (const slug of COMPETITORS) {
      it(`${slug} (${lang}) has every row, sources and questions`, () => {
        const page = COMPARE[lang].pages[slug];
        for (const row of ROWS) {
          expect(page.rows[row].trim().length).toBeGreaterThan(2);
          expect(COMPARE[lang].monsters[row].trim().length).toBeGreaterThan(2);
        }
        expect(page.title).toBe(`Monsters vs ${COMPETITOR_FACTS[slug].name}`);
        expect(page.ahead.length).toBeGreaterThan(2);
        expect(page.pickThem.length).toBeGreaterThan(2);
        expect(page.pickUs.length).toBeGreaterThan(2);
        expect(page.faq.length).toBeGreaterThan(1);
        expect(COMPETITOR_FACTS[slug].sources.length).toBeGreaterThan(2);
      });
    }
  }

  it('has no long dash in the Italian texts', () => {
    const text = JSON.stringify([COMPARE.it, PAGES.it, STRINGS.it.faq.more]);
    expect(text).not.toMatch(/[—–]/);
  });
});

describe('page registry', () => {
  const feeds = fallback.feeds as Feed[];
  const data = {
    version: latestVersion(feeds),
    releaseDate: null,
    downloads: downloadsFrom(feeds),
    stars: null,
    contributors: [],
    offline: [],
  };

  it('pairs the pages that exist in both languages and leaves the guides alone', () => {
    const pages = allPages();
    const paired = pages.filter((p) => p.en && p.it);
    expect(paired.map((p) => p.en)).toEqual([
      '/',
      '/docs/',
      '/changelog/',
      '/compare/',
      ...COMPETITORS.map((c) => `/compare/${c}/`),
    ]);
    const guides = pages.filter((p) => p.en?.startsWith('/docs/') && p.en !== '/docs/');
    expect(guides.length).toBe(GUIDES.length);
    expect(guides.every((p) => p.it === undefined)).toBe(true);
    expect(alternatesOf({ en: '/docs/architecture/' })).toEqual([
      ['en', '/docs/architecture/'],
      ['x-default', '/docs/architecture/'],
    ]);
  });

  it('lists every page in llms.txt', () => {
    const text = llmsTxt(data);
    for (const g of GUIDES) expect(text).toContain(`${site}/docs/${g.slug}/`);
    for (const c of COMPETITORS) expect(text).toContain(`${site}/compare/${c}/`);
    expect(text).toContain(`${site}/changelog/`);
    expect(text).toContain('Is Monsters free and open source?');
  });
});

describe('page JSON-LD', () => {
  it('has a BreadcrumbList and, with questions, a FAQPage', () => {
    const g = pageGraph({
      lang: 'en',
      site,
      path: '/compare/goose/',
      title: 'Monsters vs Goose',
      description: 'd',
      type: 'WebPage',
      crumbs: [
        { name: 'Monsters', path: '/' },
        { name: 'Compare', path: '/compare/' },
      ],
      faq: [{ q: 'Q?', a: 'A.' }],
    });
    const nodes = g['@graph'] as { '@type': string }[];
    expect(nodes.map((n) => n['@type'])).toEqual([
      'WebPage',
      'BreadcrumbList',
      'Organization',
      'FAQPage',
    ]);
    const crumbs = nodes[1] as unknown as { itemListElement: { position: number; item: string }[] };
    expect(crumbs.itemListElement.map((i) => i.item)).toEqual([`${site}/`, `${site}/compare/`]);
  });
});
