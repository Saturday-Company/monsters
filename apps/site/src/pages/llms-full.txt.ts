import type { APIRoute } from 'astro';
import { siteData } from '../lib/build-data.ts';
import { llmsFullTxt } from '../lib/llms.ts';

export const prerender = true;

/** The summary plus the user-facing guides of `docs/`, read from the files at build time. */
export const GET: APIRoute = async () =>
  new Response(llmsFullTxt(await siteData()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
