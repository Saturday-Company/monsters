import { defineConfig } from 'astro/config';

// Static output only (D-144): the Worker serves dist/ as plain assets, no adapter, no SSR.
export default defineConfig({
  site: 'https://monsters.saturdaycompany.workers.dev',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  server: { port: 4321, host: '127.0.0.1' },
  vite: {
    build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 200 },
  },
});
