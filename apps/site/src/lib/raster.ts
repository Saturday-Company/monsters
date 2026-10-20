/* SVG → PNG at build time (resvg, no browser), for the OG card and the PNG icons. */
import { Resvg } from '@resvg/resvg-js';

export function svgToPng(svg: string, width: number): Uint8Array {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
    background: 'rgba(0,0,0,0)',
  });
  return new Uint8Array(r.render().asPng());
}

export const png = (bytes: Uint8Array): Response =>
  new Response(bytes as unknown as BodyInit, {
    headers: { 'content-type': 'image/png' },
  });
