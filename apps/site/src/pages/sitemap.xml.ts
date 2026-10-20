import type { APIRoute } from 'astro';

export const prerender = true;

/** The two language versions, each pointing at the other (D-150). */
export const GET: APIRoute = ({ site }) => {
  const origin = (site?.toString() ?? '').replace(/\/$/, '');
  const pages = [`${origin}/`, `${origin}/it/`];
  const alternates = [
    `<xhtml:link rel="alternate" hreflang="en" href="${origin}/"/>`,
    `<xhtml:link rel="alternate" hreflang="it" href="${origin}/it/"/>`,
    `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>`,
  ].join('');
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    pages.map((loc) => `  <url><loc>${loc}</loc>${alternates}</url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
