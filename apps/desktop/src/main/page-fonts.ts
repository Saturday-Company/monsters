import instrumentSans from '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?inline';
import doto from '@fontsource/doto/files/doto-latin-900-normal.woff2?inline';
import martianMono400 from '@fontsource/martian-mono/files/martian-mono-latin-400-normal.woff2?inline';
import martianMono500 from '@fontsource/martian-mono/files/martian-mono-latin-500-normal.woff2?inline';

/*
 * The three faces of the instrument (docs/design.md, "Caratteri"; D-089) for the pages the
 * main process builds (status page, "Connessioni"). Those pages are data: URLs without the web
 * bundle, so the fonts travel inside them: the same @fontsource files as the web UI, latin
 * subset only (Italian fits in it; anything else falls back to the system font), ~55 KB.
 * Bundled as data: URLs by esbuild (scripts/build.ts); the pages allow `font-src data:`.
 */

const FACES: readonly (readonly [family: string, weight: string, url: string])[] = [
  ['Instrument Sans', '400 700', instrumentSans],
  ['Martian Mono', '400', martianMono400],
  ['Martian Mono', '500', martianMono500],
  ['Doto', '900', doto],
];

/** `@font-face` rules for the pages (the names the web UI uses). */
export const PAGE_FONTS_CSS: string = FACES.map(
  ([family, weight, url]) =>
    `@font-face{font-family:'${family}';font-style:normal;font-display:block;font-weight:${weight};src:url(${url}) format('woff2')}`,
).join('\n');

/** Text: Instrument Sans, then the system's. */
export const FONT_SANS =
  "'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI Variable Text','Segoe UI','Ubuntu Sans',Cantarell,system-ui,sans-serif";
/** Labels and instrumentation. */
export const FONT_MONO =
  "'Martian Mono',ui-monospace,'SF Mono','Cascadia Code','Ubuntu Sans Mono',Menlo,Consolas,monospace";
/** The wordmark and big numbers: dots, never under 18 px. */
export const FONT_DISPLAY = "'Doto','Martian Mono',ui-monospace,monospace";
