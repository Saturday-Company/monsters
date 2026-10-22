import type { APIRoute } from 'astro';
import { siteData } from '../lib/build-data.ts';
import { llmsTxt } from '../lib/llms.ts';

export const prerender = true;

/** The short, linked summary for language models (llmstxt.org). */
export const GET: APIRoute = async () =>
  new Response(llmsTxt(await siteData()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
