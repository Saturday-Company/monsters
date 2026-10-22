/*
 * Every page of the site, with the language versions it has: the one list behind the sitemap, the
 * hreflang links of each page and llms.txt. A page with one version (the guides are English only)
 * lists just that one.
 */
import { COMPETITORS } from '../i18n/compare.ts';
import { GUIDES } from './docs.ts';

export interface PageRef {
  /** Path of the English version, e.g. `/docs/`. */
  en?: string;
  /** Path of the Italian version, e.g. `/it/docs/`. */
  it?: string;
}

const pair = (path: string): PageRef => ({ en: path, it: `/it${path}` });

export function allPages(): PageRef[] {
  return [
    { en: '/', it: '/it/' },
    pair('/docs/'),
    ...GUIDES.map((g) => ({ en: `/docs/${g.slug}/` })),
    pair('/changelog/'),
    pair('/compare/'),
    ...COMPETITORS.map((c) => pair(`/compare/${c}/`)),
  ];
}

/** The `<link rel="alternate" hreflang>` targets of a page, as [hreflang, path]. */
export function alternatesOf(ref: PageRef): [string, string][] {
  const out: [string, string][] = [];
  if (ref.en) out.push(['en', ref.en]);
  if (ref.it) out.push(['it', ref.it]);
  const def = ref.en ?? ref.it;
  if (def) out.push(['x-default', def]);
  return out;
}

export const homePath = (lang: 'en' | 'it'): string => (lang === 'it' ? '/it/' : '/');
