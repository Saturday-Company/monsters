/*
 * Builds the desktop app's main process and preload with esbuild (like scripts/build-core.ts):
 *
 *   dist/main.js       main process, ESM, everything bundled except `electron`
 *   dist/preload.cjs   preload, CommonJS (sandboxed preloads cannot be ES modules)
 *   dist/keychain-helper.cjs  the keychain helper, run in a utility process (keychain-host.ts)
 *
 * The core is not here: the app runs the bundle of `pnpm build:core` in a utility process.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions, type Plugin } from 'esbuild';

const APP = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(APP, 'dist');

/**
 * `import url from './file.woff2?inline'`: the file as a data: URL, like Vite's inline assets
 * (the unit tests run through Vite). The fonts of the app's own pages (src/main/page-fonts.ts).
 */
export const inlineAssets: Plugin = {
  name: 'inline-assets',
  setup(b) {
    b.onResolve({ filter: /\?inline$/ }, async (args) => {
      const r = await b.resolve(args.path.slice(0, -'?inline'.length), {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
      });
      return r.errors.length > 0 ? { errors: r.errors } : { path: r.path, namespace: 'inline' };
    });
    b.onLoad({ filter: /.*/, namespace: 'inline' }, (args) => ({
      contents: readFileSync(args.path),
      loader: 'dataurl',
    }));
  },
};

export async function buildDesktop(): Promise<void> {
  rmSync(out, { recursive: true, force: true });
  const common: BuildOptions = {
    bundle: true,
    platform: 'node',
    target: 'node24',
    external: ['electron'],
    sourcemap: 'linked',
    legalComments: 'none',
    logLevel: 'warning',
    absWorkingDir: APP,
    plugins: [inlineAssets],
  };
  await Promise.all([
    build({
      ...common,
      entryPoints: [join(APP, 'src', 'main', 'index.ts')],
      outfile: join(out, 'main.js'),
      format: 'esm',
      // Bundled CommonJS code (zod has none, but stay safe) may call `require`.
      banner: {
        js: "import { createRequire as __monstersCreateRequire } from 'node:module';\nconst require = __monstersCreateRequire(import.meta.url);",
      },
    }),
    build({
      ...common,
      entryPoints: [join(APP, 'src', 'preload', 'index.ts')],
      outfile: join(out, 'preload.cjs'),
      format: 'cjs',
    }),
    // The keychain helper, a utility process of its own (S-M8): CommonJS, no dependencies. All
    // the JavaScript it runs is in this file, in the ASAR: of the keyring it loads only the
    // native binary (review of wave 5, n. 4).
    build({
      ...common,
      entryPoints: [join(APP, 'src', 'keychain-helper', 'index.ts')],
      outfile: join(out, 'keychain-helper.cjs'),
      format: 'cjs',
    }),
  ]);
  process.stderr.write('desktop: dist/main.js, dist/preload.cjs, dist/keychain-helper.cjs\n');
}

if (import.meta.main) {
  try {
    await buildDesktop();
  } catch (err) {
    console.error(`desktop build: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
