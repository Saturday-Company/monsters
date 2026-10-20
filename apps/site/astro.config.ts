import { defineConfig } from 'astro/config';

// Static output only (D-144): the Worker serves dist/ as plain assets, no adapter, no SSR.
// `site` is the canonical origin (D-150): canonical, hreflang, og:url and the sitemap use it.
export default defineConfig({
  site: 'https://getmonsters.dev',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  server: { port: 4321, host: '127.0.0.1' },
  vite: {
    build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 200 },
  },
});
