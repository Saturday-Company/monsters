import type { APIRoute } from 'astro';
import { faviconSvg } from '../lib/icons.ts';
import { titan } from '../lib/monsters.ts';

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(faviconSvg(titan()), { headers: { 'content-type': 'image/svg+xml' } });
