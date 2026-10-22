import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/i18n/strings.ts';
import { absolutizeLinks } from '../src/lib/docs.ts';
import { llmsFullTxt, llmsTxt } from '../src/lib/llms.ts';
import { COMPANY_ID, SOFTWARE_ID, jsonLdGraph, jsonLdText } from '../src/lib/seo.ts';
import fallback from '../src/data/fallback.json' with { type: 'json' };
import { downloadsFrom, latestVersion, type Feed } from '../src/lib/feed.ts';

const site = 'https://getmonsters.dev';
const feeds = fallback.feeds as Feed[];
const data = {
  version: latestVersion(feeds),
  releaseDate: null,
  downloads: downloadsFrom(feeds),
  stars: null,
  contributors: [],
  offline: [],
};

describe('JSON-LD', () => {
  for (const lang of ['en', 'it'] as const) {
    it(`has the shared entities in ${lang}`, () => {
      const t = STRINGS[lang];
      const graph = jsonLdGraph({ t, site, version: '0.1.0-alpha.20' });
      const nodes = graph['@graph'] as { '@type': string; '@id'?: string }[];
      expect(nodes.map((n) => n['@type'])).toEqual([
        'SoftwareApplication',
        'SoftwareSourceCode',
        'Organization',
        'FAQPage',
        'WebSite',
      ]);
      expect(nodes[0]?.['@id']).toBe(SOFTWARE_ID);
      expect(nodes[2]?.['@id']).toBe(COMPANY_ID);
      const faq = nodes[3] as unknown as { mainEntity: { name: string }[] };
      expect(faq.mainEntity.map((q) => q.name)).toEqual([
        ...t.faq.items.map((i) => i.q),
        ...t.faq.more.items.map((i) => i.q),
      ]);
      const text = jsonLdText({ t, site, version: '' });
      expect(JSON.parse(text) as unknown).toEqual(
        JSON.parse(JSON.stringify(jsonLdGraph({ t, site, version: '' }))),
      );
    });
  }

  it('leaves out the version and the download when unknown', () => {
    const g = jsonLdGraph({ t: STRINGS.en, site, version: '' });
    const software = (g['@graph'] as Record<string, unknown>[])[0];
    expect(software).not.toHaveProperty('softwareVersion');
    expect(software).not.toHaveProperty('downloadUrl');
  });
});

describe('llms.txt', () => {
  it('summarises the product and links the repository', () => {
    const text = llmsTxt(data);
    expect(text.startsWith('# Monsters\n')).toBe(true);
    expect(text).toContain('Made by Saturday Company (https://saturdaycompany.it)');
    expect(text).toContain('https://github.com/Saturday-Company/monsters');
    expect(text).toContain('Kill switch');
  });

  it('turns relative links of the guides into GitHub links', () => {
    const out = absolutizeLinks(
      '[a](security-model.md#x) [b](../SECURITY.md) [c](https://x.y) [d](#z)',
      'remote.md',
    );
    expect(out).toContain(
      '(https://github.com/Saturday-Company/monsters/blob/main/docs/security-model.md#x)',
    );
    expect(out).toContain('(https://github.com/Saturday-Company/monsters/blob/main/SECURITY.md)');
    expect(out).toContain('(https://x.y)');
    expect(out).toContain('(#z)');
  });

  it('full version adds the guides', () => {
    const text = llmsFullTxt(data);
    expect(text).toContain('# Security model');
    expect(text).toContain('# Monsters architecture');
  });
});
