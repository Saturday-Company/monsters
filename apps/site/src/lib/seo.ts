/*
 * Structured data for search engines and AI assistants: one JSON-LD `@graph` per language. The
 * identifiers are shared with the other Saturday Company sites (the organisation) and stable
 * across builds (the software), so every page and every site points at the same entities.
 */
import type { Strings } from '../i18n/strings.ts';
import { REPO_URL } from './feed.ts';

export const SITE_ORIGIN = 'https://getmonsters.dev';
export const SOFTWARE_ID = `${SITE_ORIGIN}/#software`;
export const COMPANY_URL = 'https://saturdaycompany.it';
export const COMPANY_ID = `${COMPANY_URL}/#organizzazione`;
export const COMPANY_NAME = 'Saturday Company';
export const COMPANY_GITHUB = 'https://github.com/Saturday-Company';
export const COMPANY_PROFILES = [
  COMPANY_GITHUB,
  'https://www.linkedin.com/company/saturdaycompany/',
  'https://www.instagram.com/saturdaycompany.it/',
];
export const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

export interface Crumb {
  name: string;
  /** Path on the site, e.g. `/docs/`. */
  path: string;
}

export interface PageSeo {
  lang: 'en' | 'it';
  /** Origin without the trailing slash. */
  site: string;
  /** Path of this page. */
  path: string;
  title: string;
  description: string;
  /** `TechArticle` for a guide, `WebPage` for the rest. */
  type: 'WebPage' | 'TechArticle' | 'CollectionPage';
  crumbs: Crumb[];
  faq?: { q: string; a: string }[];
  /** Other software the page is about (a comparison). */
  mentions?: { name: string; url: string }[];
  /** ISO date of the last change, when the page has one. */
  modified?: string;
}

export interface SeoInput {
  t: Strings;
  /** Origin without the trailing slash (Astro's `site`). */
  site: string;
  /** Version of the newest release (from the feed), or '' when unknown. */
  version: string;
}

type Json = Record<string, unknown>;

/** The page's JSON-LD: software, its source code, the company, the FAQ and the website. */
export function jsonLdGraph({ t, site, version }: SeoInput): Json {
  const home = t.lang === 'it' ? `${site}/it/` : `${site}/`;
  const company = { '@id': COMPANY_ID };
  const software: Json = {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: 'Monsters',
    description: t.meta.description,
    url: home,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Windows, macOS, Linux',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    license: LICENSE_URL,
    author: company,
    publisher: company,
    inLanguage: t.lang,
    image: `${site}/og.png`,
    codeRepository: REPO_URL,
    sameAs: [REPO_URL],
  };
  if (version) {
    software['softwareVersion'] = version;
    software['downloadUrl'] = `${REPO_URL}/releases/tag/v${encodeURIComponent(version)}`;
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      software,
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${SITE_ORIGIN}/#source`,
        name: 'Monsters',
        codeRepository: REPO_URL,
        programmingLanguage: 'TypeScript',
        license: LICENSE_URL,
        author: company,
        targetProduct: { '@id': SOFTWARE_ID },
      },
      {
        '@type': 'Organization',
        '@id': COMPANY_ID,
        name: COMPANY_NAME,
        url: COMPANY_URL,
        sameAs: COMPANY_PROFILES,
      },
      {
        '@type': 'FAQPage',
        '@id': `${home}#faq`,
        url: home,
        inLanguage: t.lang,
        mainEntity: homeFaq(t).map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        name: 'Monsters',
        url: home,
        inLanguage: t.lang,
        publisher: company,
        about: { '@id': SOFTWARE_ID },
      },
    ],
  };
}

/** Serialised for an inline `<script type="application/ld+json">` (no `</script>` escape). */
export function jsonLdText(input: SeoInput): string {
  return JSON.stringify(jsonLdGraph(input)).replace(/</g, '\\u003c');
}

/**
 * The JSON-LD of a page other than the home: the page itself (about the software, made by the
 * company), its BreadcrumbList and, where the page has questions, a FAQPage.
 */
export function pageGraph(p: PageSeo): Json {
  const url = `${p.site}${p.path}`;
  const home = `${p.site}${p.lang === 'it' ? '/it/' : '/'}`;
  const company = { '@id': COMPANY_ID };
  const page: Json = {
    '@type': p.type,
    '@id': `${url}#page`,
    url,
    name: p.title,
    description: p.description,
    inLanguage: p.lang,
    isPartOf: { '@id': `${home}#website` },
    about: { '@id': SOFTWARE_ID },
    publisher: company,
    breadcrumb: { '@id': `${url}#breadcrumb` },
  };
  if (p.type === 'TechArticle') {
    page['headline'] = p.title;
    page['author'] = company;
  }
  if (p.modified) page['dateModified'] = p.modified;
  if (p.mentions && p.mentions.length > 0) {
    page['mentions'] = p.mentions.map((m) => ({
      '@type': 'SoftwareApplication',
      name: m.name,
      url: m.url,
    }));
  }
  const nodes: Json[] = [
    page,
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: p.crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: `${p.site}${c.path}`,
      })),
    },
    {
      '@type': 'Organization',
      '@id': COMPANY_ID,
      name: COMPANY_NAME,
      url: COMPANY_URL,
      sameAs: COMPANY_PROFILES,
    },
  ];
  if (p.faq && p.faq.length > 0) {
    nodes.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      url,
      inLanguage: p.lang,
      mainEntity: p.faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': nodes };
}

export const pageLdText = (p: PageSeo): string =>
  JSON.stringify(pageGraph(p)).replace(/</g, '\\u003c');

/** The home's questions: the monsters' ones, then the ones people ask. */
export function homeFaq(t: Strings): { q: string; a: string }[] {
  return [...t.faq.items, ...t.faq.more.items].map(({ q, a }) => ({ q, a }));
}
