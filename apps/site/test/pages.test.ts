import { describe, expect, it } from 'vitest';
import { COMPARE, COMPETITORS, COMPETITOR_FACTS, ROWS, VERIFIED } from '../src/i18n/compare.ts';
import { PAGES, TLDR } from '../src/i18n/pages.ts';
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
import { atomFeed, changelogPath, feedPath } from '../src/lib/atom.ts';
import { cliHelp } from '../src/lib/code.ts';
import { GETTING_STARTED, gettingStartedCommands } from '../src/i18n/getting-started.ts';
import {
  FRAMEWORKS,
  FRAMEWORKS_PAGE,
  FRAMEWORKS_VERIFIED,
  FRAMEWORK_FACTS,
  FRAMEWORK_ROWS,
} from '../src/i18n/frameworks.ts';
import { fileDates } from '../src/lib/history.ts';
import { changelogDay, lastmodResolver } from '../src/lib/lastmod.ts';
import { currentRelease, releaseLabel } from '../src/lib/release.ts';
import { pageGraph } from '../src/lib/seo.ts';
import fallback from '../src/data/fallback.json' with { type: 'json' };
import { BUILD_STEPS, downloadsFrom, latestVersion, type Feed } from '../src/lib/feed.ts';

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
    starsAt: null,
    contributors: [],
    offline: [],
  };

  it('pairs the pages that exist in both languages and leaves the guides alone', () => {
    const pages = allPages();
    const paired = pages.filter((p) => p.en && p.it);
    expect(paired.map((p) => p.en)).toEqual([
      '/',
      '/docs/',
      '/docs/getting-started/',
      '/changelog/',
      '/compare/',
      ...COMPETITORS.map((c) => `/compare/${c}/`),
      '/compare/frameworks/',
    ]);
    const guides = pages.filter(
      (p) => p.en?.startsWith('/docs/') && p.en !== '/docs/' && p.it === undefined,
    );
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
    expect(text).toContain(`${site}/docs/getting-started/`);
    expect(text).toContain(`${site}/compare/frameworks/`);
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

describe('build from source', () => {
  it('shows the same commands on the site, in llms.txt and in both READMEs', () => {
    const root = [readRepoFile('README.md'), readRepoFile('README.it.md')];
    for (const step of BUILD_STEPS) for (const readme of root) expect(readme).toContain(step);
    const feeds = fallback.feeds as Feed[];
    const data = {
      version: latestVersion(feeds),
      releaseDate: null,
      downloads: downloadsFrom(feeds),
      stars: null,
      starsAt: null,
      contributors: [],
      offline: [],
    };
    expect(llmsTxt(data)).toContain(BUILD_STEPS.join(' && '));
  });

  it('only uses scripts and workspaces that exist', () => {
    const scripts = (
      JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts['build:core']).toBeDefined();
    for (const name of ['@monsters/web', '@monsters/cli']) {
      const dir = name === '@monsters/web' ? 'apps/web' : 'packages/cli';
      const pkg = JSON.parse(readRepoFile(`${dir}/package.json`)) as { name: string };
      expect(pkg.name).toBe(name);
    }
    const web = JSON.parse(readRepoFile('apps/web/package.json')) as {
      scripts: Record<string, string>;
    };
    expect(web.scripts['build']).toBeDefined();
  });
});

describe('comparison facts', () => {
  it('takes the Monsters version and day from the build, not from text', () => {
    for (const lang of ['en', 'it'] as const) {
      expect(COMPARE[lang].monsters.stage).toContain('{release}');
      expect(COMPARE[lang].monsters.stage).not.toMatch(/alpha\.\d+/);
    }
    const release = currentRelease({ version: '', releaseDate: null });
    expect(release.version).toMatch(/^0\.1\.0-alpha\.\d+$/);
    expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(releaseLabel(release, 'en')).toContain(release.version);
    expect(releaseLabel({ version: '1.0.0', date: '' }, 'en')).toBe('1.0.0');
  });

  it('are dated today or earlier and every source is an https link', () => {
    expect(VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const c of COMPETITORS)
      for (const s of COMPETITOR_FACTS[c].sources) expect(s.url).toMatch(/^https:\/\//);
  });
});

describe('docs in the READMEs and on the guide pages', () => {
  it('links the READMEs to the guide pages of the site, and only to ones that exist', () => {
    const slugs = new Set<string>(GUIDES.map((g) => g.slug));
    for (const file of ['README.md', 'README.it.md']) {
      const text = readRepoFile(file);
      const found = [...text.matchAll(/https:\/\/getmonsters\.dev\/docs\/([a-z-]+)\//g)];
      expect(found.length).toBeGreaterThanOrEqual(6);
      for (const m of found) expect(slugs.has(m[1] ?? '')).toBe(true);
      // no relative link left to a guide that has a page
      for (const g of GUIDES) expect(text).not.toContain(`](docs/${g.file})`);
    }
  });

  it('has a summary of its own for every guide, not the meta description', () => {
    for (const g of GUIDES) {
      const tldr = TLDR[g.slug];
      expect(tldr.length).toBeGreaterThan(150);
      expect(tldr).not.toBe(PAGES.en.docs.summaries[g.slug]);
    }
  });

  it('reads the dates of a guide from git', () => {
    const d = fileDates('docs/remote.md');
    // A tarball without history has none: then the page falls back to the release day.
    if (d) {
      expect(d.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.modified >= d.published).toBe(true);
    }
    expect(fileDates('docs/does-not-exist.md')).toBeNull();
  });
});

describe('sitemap dates', () => {
  const lastmod = lastmodResolver({ buildDay: '2026-11-24', releaseDay: '2026-10-28' });
  it('dates each kind of page from its own source', () => {
    expect(lastmod('/')).toBe('2026-11-24');
    expect(lastmod('/it/')).toBe('2026-11-24');
    expect(lastmod('/compare/goose/')).toBe(VERIFIED);
    expect(lastmod('/it/compare/')).toBe(VERIFIED);
    expect(lastmod('/changelog/')).toBe(changelogDay());
    expect(lastmod('/it/changelog/')).toBe(changelogDay());
    for (const g of GUIDES) expect(lastmod(`/docs/${g.slug}/`)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lets the docs index take the newest guide', () => {
    const newest = GUIDES.map((g) => lastmod(`/docs/${g.slug}/`))
      .sort()
      .at(-1);
    expect(lastmod('/docs/')).toBe(newest);
  });

  it('falls back to the release day, then the build day, without history', () => {
    expect(lastmodResolver({ buildDay: '2026-11-24', releaseDay: '' })('/docs/nowhere/')).toBe(
      '2026-11-24',
    );
  });
});

describe('changelog feed', () => {
  const entries = [
    { version: '0.2.0', date: '2026-11-02', html: '<p>New & <b>better</b></p>' },
    { version: '0.1.9', date: '2026-10-30', html: '<p>Older</p>' },
  ];
  const xml = atomFeed({
    site,
    lang: 'en',
    title: 'Monsters changelog',
    subtitle: 'What changed',
    entries,
  });

  it('is an Atom feed with one entry per release, newest date as updated', () => {
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml).toContain('<updated>2026-11-02T00:00:00Z</updated>');
    expect(xml).toContain(
      `<link rel="self" type="application/atom+xml" href="${site}/changelog.xml"/>`,
    );
    expect(xml).toContain(`<id>${site}/changelog/#v0.2.0</id>`);
  });

  it('escapes the HTML inside the content', () => {
    expect(xml).toContain('&lt;p&gt;New &amp; &lt;b&gt;better&lt;/b&gt;&lt;/p&gt;');
    expect(xml).not.toContain('<b>');
  });

  it('has paths for both languages', () => {
    expect(feedPath('it')).toBe('/it/changelog.xml');
    expect(changelogPath('it')).toBe('/it/changelog/');
  });
});

describe('meta descriptions', () => {
  const inRange = (text: string, label: string): void => {
    expect(text.length, `${label}: ${text.length}`).toBeGreaterThanOrEqual(150);
    expect(text.length, `${label}: ${text.length}`).toBeLessThanOrEqual(155);
  };

  it('are 150 to 155 characters on every page, in both languages', () => {
    for (const lang of ['en', 'it'] as const) {
      inRange(STRINGS[lang].meta.description, `home ${lang}`);
      inRange(PAGES[lang].docs.description, `docs ${lang}`);
      inRange(PAGES[lang].changelog.description, `changelog ${lang}`);
      inRange(COMPARE[lang].index.description, `compare ${lang}`);
      for (const c of COMPETITORS) inRange(COMPARE[lang].pages[c].description, `${c} ${lang}`);
      inRange(FRAMEWORKS_PAGE[lang].description, `frameworks ${lang}`);
      inRange(GETTING_STARTED[lang].description, `getting started ${lang}`);
    }
    for (const g of GUIDES) inRange(PAGES.en.docs.summaries[g.slug], `guide ${g.slug}`);
  });

  it('keeps the guide title suffix short', () => {
    expect(PAGES.en.guide.metaSuffix).toBe('Monsters');
  });
});

describe('getting started', () => {
  const commands = gettingStartedCommands().join('\n');
  const help = cliHelp('0.0.0');

  it('only shows commands the repository has', () => {
    const scripts = (
      JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> }
    ).scripts;
    for (const line of commands.split('\n')) {
      const exec = /exec monsters (\w+)/.exec(line);
      if (exec) expect(help, line).toMatch(new RegExp(`^\\s+${exec[1]}\\b`, 'm'));
      const run = /^pnpm (?:run )?([\w:]+)$/.exec(line.trim());
      if (run && !['install'].includes(run[1] ?? '')) expect(scripts[run[1] ?? '']).toBeDefined();
    }
    expect(help).toContain('--to');
    expect(commands).toContain(BUILD_STEPS.join('\n'));
    expect(readRepoFile('package.json')).toContain('"desktop:dev"');
  });

  it('has the same steps and commands in both languages', () => {
    const [en, it] = [GETTING_STARTED.en, GETTING_STARTED.it];
    expect(it.steps.map((s) => s.id)).toEqual(en.steps.map((s) => s.id));
    for (const [i, step] of en.steps.entries()) {
      const other = it.steps[i];
      expect(other?.cmds?.length ?? 0).toBe(step.cmds?.length ?? 0);
      for (const [j, cmd] of (step.cmds ?? []).entries()) {
        const a = cmd.code.split(' ').slice(0, 6).join(' ');
        expect(other?.cmds?.[j]?.code.startsWith(a)).toBe(true);
      }
    }
  });

  it('is in the sitemap and dated, in both languages', () => {
    const pages = allPages();
    expect(
      pages.some((p) => p.en === '/docs/getting-started/' && p.it === '/it/docs/getting-started/'),
    ).toBe(true);
    expect(
      pages.some((p) => p.en === '/compare/frameworks/' && p.it === '/it/compare/frameworks/'),
    ).toBe(true);
    const lastmod = lastmodResolver({ buildDay: '2026-11-25', releaseDay: '' });
    expect(lastmod('/it/compare/frameworks/')).toBe(FRAMEWORKS_VERIFIED);
    expect(lastmod('/docs/getting-started/')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('frameworks comparison', () => {
  it('fills every row for every framework, in both languages', () => {
    for (const lang of ['en', 'it'] as const) {
      const page = FRAMEWORKS_PAGE[lang];
      for (const row of FRAMEWORK_ROWS) {
        expect(page.rowLabels[row].length).toBeGreaterThan(2);
        expect(page.monsters[row].length).toBeGreaterThan(5);
        for (const slug of FRAMEWORKS) expect(page.rows[slug][row].length).toBeGreaterThan(5);
      }
      expect(page.faq.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('dates the facts and links every source over https', () => {
    expect(FRAMEWORKS_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const slug of FRAMEWORKS)
      for (const src of FRAMEWORK_FACTS[slug].sources) expect(src.url).toMatch(/^https:\/\//);
  });

  it('says AutoGen is archived, in both languages', () => {
    expect(FRAMEWORKS_PAGE.en.rows.autogen.stage).toMatch(/Archived/);
    expect(FRAMEWORKS_PAGE.it.rows.autogen.stage).toMatch(/Archiviato/);
  });
});
