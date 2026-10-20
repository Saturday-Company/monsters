/*
 * Files imported as data: URLs (`?inline`): esbuild's `dataurl` loader in scripts/build.ts,
 * Vite's inline assets in the unit tests. Used for the fonts of the app's own pages.
 */
declare module '*.woff2?inline' {
  const dataUrl: string;
  export default dataUrl;
}
