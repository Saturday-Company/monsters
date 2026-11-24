/*
 * The changelog as an Atom feed (/changelog.xml and /it/changelog.xml), built from the same
 * releases as the changelog page. Pure: the pages pass the entries in.
 */
import { COMPANY_NAME, COMPANY_URL } from './seo.ts';

export interface FeedEntry {
  version: string;
  /** ISO day of the release ("" when the changelog date could not be read). */
  date: string;
  /** The release notes, rendered to HTML. */
  html: string;
}

export interface FeedInput {
  /** Origin without the trailing slash. */
  site: string;
  lang: 'en' | 'it';
  title: string;
  subtitle: string;
  entries: FeedEntry[];
}

export const feedPath = (lang: 'en' | 'it'): string =>
  lang === 'it' ? '/it/changelog.xml' : '/changelog.xml';
export const changelogPath = (lang: 'en' | 'it'): string =>
  lang === 'it' ? '/it/changelog/' : '/changelog/';

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stamp = (day: string): string => `${day}T00:00:00Z`;

/** At most this many releases go into the feed, newest first. */
export const FEED_LIMIT = 20;

export function atomFeed({ site, lang, title, subtitle, entries }: FeedInput): string {
  const page = `${site}${changelogPath(lang)}`;
  const self = `${site}${feedPath(lang)}`;
  const items = entries.slice(0, FEED_LIMIT);
  const days = items.map((e) => e.date).filter(Boolean);
  const updated = days.length > 0 ? days.reduce((a, b) => (a > b ? a : b)) : '';
  const body = items.map((e) => {
    const link = `${page}#v${encodeURIComponent(e.version)}`;
    return [
      '  <entry>',
      `    <id>${esc(link)}</id>`,
      `    <title>${esc(`Monsters ${e.version}`)}</title>`,
      `    <link rel="alternate" type="text/html" href="${esc(link)}"/>`,
      ...(e.date ? [`    <updated>${stamp(e.date)}</updated>`] : []),
      `    <content type="html" xml:base="${esc(page)}">${esc(e.html)}</content>`,
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">`,
    `  <id>${esc(self)}</id>`,
    `  <title>${esc(title)}</title>`,
    `  <subtitle>${esc(subtitle)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${esc(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${esc(page)}"/>`,
    ...(updated ? [`  <updated>${stamp(updated)}</updated>`] : []),
    `  <author><name>${esc(COMPANY_NAME)}</name><uri>${esc(COMPANY_URL)}</uri></author>`,
    ...body,
    '</feed>',
    '',
  ].join('\n');
}
