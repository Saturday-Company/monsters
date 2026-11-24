/* The Atom feed of one language, read from the changelog collection. Used by the two feed routes. */
import { getCollection } from 'astro:content';
import { PAGES } from '../i18n/pages.ts';
import { atomFeed, type FeedEntry } from './atom.ts';

export async function changelogFeed(lang: 'en' | 'it', site: string): Promise<Response> {
  const entries: FeedEntry[] = (await getCollection('releases'))
    .filter((e) => e.data.lang === lang)
    .sort((a, b) => a.data.order - b.data.order)
    .map((e) => ({ version: e.data.version, date: e.data.date, html: e.rendered?.html ?? '' }));
  const p = PAGES[lang].changelog;
  const xml = atomFeed({ site, lang, title: p.feedTitle, subtitle: p.lede, entries });
  return new Response(xml, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } });
}
