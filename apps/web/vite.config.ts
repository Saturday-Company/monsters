import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { mockFilesMiddleware } from './scripts/mock-files.ts';

/** Port of the local core (see DEFAULT_PORT in @monsters/shared). */
const CORE = process.env['MONSTERS_CORE_URL'] ?? 'http://127.0.0.1:4747';

/** The bytes of the mock core's files, dev server only (`?mock=…`, D-075). */
const mockFiles: Plugin = {
  name: 'monsters-mock-files',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(mockFilesMiddleware);
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), mockFiles],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The core accepts the dev origin only when started with MONSTERS_DEV=1.
    proxy: {
      '/api/stream': { target: CORE.replace(/^http/, 'ws'), ws: true },
      '/api': { target: CORE },
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    // Pages, the Markdown renderer and the graph are loaded on demand
    // (App.tsx, M2.8): the first bundle is ~445 kB (~140 kB gzip), no chunk
    // passes the default limit of 500 kB.
  },
});
