import type { APIRoute } from 'astro';
import { siteData } from '../lib/build-data.ts';
import { lastmodResolver } from '../lib/lastmod.ts';
import { alternatesOf, allPages } from '../lib/pages.ts';
import { currentRelease } from '../lib/release.ts';

export const prerender = true;

/** Every page, each with its language versions pointing at one another (D-150). */
export const GET: APIRoute = async ({ site }) => {
  const origin = (site?.toString() ?? '').replace(/\/$/, '');
  const lastmod = lastmodResolver({
    buildDay: new Date().toISOString().slice(0, 10),
    releaseDay: currentRelease(await siteData()).date,
  });
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
      if (path)
        urls.push(
          `  <url><loc>${origin}${path}</loc><lastmod>${lastmod(path)}</lastmod>${links}</url>`,
        );
    }
  }
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
