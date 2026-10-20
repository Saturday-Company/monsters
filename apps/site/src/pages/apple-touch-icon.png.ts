import type { APIRoute } from 'astro';
import { faviconSvg } from '../lib/icons.ts';
import { titan } from '../lib/monsters.ts';
import { png, svgToPng } from '../lib/raster.ts';

export const prerender = true;

export const GET: APIRoute = () => png(svgToPng(faviconSvg(titan()), 180));
