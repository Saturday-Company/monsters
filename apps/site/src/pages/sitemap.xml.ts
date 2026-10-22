import type { APIRoute } from 'astro';
import { alternatesOf, allPages } from '../lib/pages.ts';

export const prerender = true;

/** Every page, each with its language versions pointing at one another (D-150). */
export const GET: APIRoute = ({ site }) => {
  const origin = (site?.toString() ?? '').replace(/\/$/, '');
  const urls: string[] = [];
  for (const ref of allPages()) {
    const alternates = alternatesOf(ref);
    // A page with a single version needs no alternates of its own.
    const links =
      ref.en && ref.it
        ? alternates
            .map(
              ([lang, path]) =>
                `<xhtml:link rel="alternate" hreflang="${lang}" href="${origin}${path}"/>`,
            )
            .join('')
        : '';
    for (const path of [ref.en, ref.it]) {
      if (path) urls.push(`  <url><loc>${origin}${path}</loc>${links}</url>`);
    }
  }
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
