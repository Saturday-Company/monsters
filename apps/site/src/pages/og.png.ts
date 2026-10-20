import type { APIRoute } from 'astro';
import desktop from '../../../desktop/package.json' with { type: 'json' };
import { titan } from '../lib/monsters.ts';
import { ogSvg } from '../lib/og.ts';
import { png, svgToPng } from '../lib/raster.ts';
import { versionStamp } from '../lib/stamp.ts';

export const prerender = true;

export const GET: APIRoute = () =>
  png(svgToPng(ogSvg(titan(), versionStamp(desktop.version)), 1200));
