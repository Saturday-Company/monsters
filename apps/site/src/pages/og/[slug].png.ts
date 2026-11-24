import type { APIRoute } from 'astro';
import desktop from '../../../../desktop/package.json' with { type: 'json' };
import { titan } from '../../lib/monsters.ts';
import { ogPageSvg } from '../../lib/og.ts';
import { ogPages } from '../../lib/ogpages.ts';
import { png, svgToPng } from '../../lib/raster.ts';
import { versionStamp } from '../../lib/stamp.ts';

export const prerender = true;

export const getStaticPaths = () =>
  ogPages().map((p) => ({ params: { slug: p.slug }, props: { p } }));

/** The card of one guide or comparison. */
export const GET: APIRoute = ({ props }) => {
  const { p } = props as { p: ReturnType<typeof ogPages>[number] };
  return png(svgToPng(ogPageSvg(titan(), versionStamp(desktop.version), p), 1200));
};
