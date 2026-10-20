/*
 * Bundles the core and the `monsters` CLI into plain JavaScript (M3.0, D-041), the form the
 * desktop app runs (Electron `utilityProcess`: Node's type stripping does not work inside
 * node_modules nor in ASAR).
 *
 *   pnpm build:core              web UI build + this script
 *   node scripts/build-core.ts [--out <dir>] [--version <v>] [--no-web] [--no-link]
 *
 *   --out <dir>   output folder (default packages/cli/dist-bundle)
 *   --version <v> version the core reports (default: apps/desktop/package.json, the product
 *                 version of D-046; the desktop app also passes its own at run time)
 *   --no-web      do not copy the web UI (apps/web/dist must exist otherwise)
 *   --no-link     do not link the external packages into <out>/node_modules
 *
 * Output (one folder, self-contained except for the external packages):
 *   monsters.js        the CLI (`monsters start|status|kill|…`), core included; ESM
 *   embed-worker.js    the embedding worker of the vault, next to the entry (embedder.ts loads
 *                      `./embed-worker.js` relative to its own module, which is the entry)
 *   extract-worker.js  the worker that extracts the text of the files (PDF, Office), same rule
 *                      (core/src/files/extract-run.ts, D-085)
 *   web/               the web UI, the core's default `webDist` in the bundle
 *   package.json       the external packages with their exact versions, for the installer
 *   node_modules/      symlinks to the external packages of this checkout (local runs, smoke test)
 *   *.map, *.LEGAL.txt source maps and the third-party license comments
 *
 * Everything is bundled from the TypeScript sources (default export condition), monster-kit
 * included. Native or optional packages stay external: they are listed in EXTERNALS, and the
 * build fails if the bundle imports any other package it does not contain. The optional peers
 * the bundled code requires inside try/catch and that are never installed (STUBBED) are
 * replaced by a module that throws as a missing one does: the bundle never looks for them on
 * disk, where a file put next to the app's core would run inside it (review of 19/10, n. 1).
 *
 * The packaged desktop app also starts the core with MONSTERS_CORE_CONFINE=1: the banner of
 * every output file then refuses any module that resolves outside the bundle's own folder
 * (resources/core, checked against the manifest in app.asar), for `require` and `import()` alike
 * (`module.registerHooks`). The static imports (`@node-rs/argon2`) are resolved before the
 * banner runs: they are found in resources/core/node_modules, the nearest one, which the
 * manifest covers.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build, type BuildOptions, type Metafile, type Plugin } from 'esbuild';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A package the bundle imports at run time instead of containing it. */
export interface External {
  name: string;
  /**
   * Workspace package that depends on it: its version and its files come from there. Absent for
   * optional peers that are never installed (the code imports them inside try/catch).
   */
  from?: string;
  /** Optional at run time: the code works (with less) when it is missing. */
  optional?: boolean;
  why: string;
}

/**
 * Packages kept out of the bundle. To add one (e.g. a native keyring module): one line here and,
 * when it is installed, its workspace package in `from`.
 */
export const EXTERNALS: readonly External[] = [
  {
    name: '@node-rs/argon2',
    from: 'packages/core',
    why: 'native (N-API, prebuilt per platform)',
  },
  {
    name: '@napi-rs/keyring',
    from: 'packages/core',
    why: 'native (N-API, prebuilt per platform), loaded by the keychain helper process (D-042)',
  },
  {
    name: '@huggingface/transformers',
    from: 'packages/vault',
    optional: true,
    why: 'semantic search, loaded only by the embedding worker; brings onnxruntime-node and sharp (native)',
  },
];

/**
 * Optional peers the bundled code requires inside try/catch and that are never installed: in
 * the bundle, a module that throws `MODULE_NOT_FOUND` (the code goes on without them, as it
 * does where they are missing), never a lookup on disk.
 */
export const STUBBED: readonly { name: string; why: string }[] = [
  { name: 'bufferutil', why: 'optional speed-up of ws' },
  { name: 'utf-8-validate', why: 'optional speed-up of ws' },
  { name: 'encoding', why: 'optional charset support of node-fetch (grammy)' },
  { name: 'supports-color', why: 'optional colors of debug' },
];

/** The code of a stubbed package: a require of it fails as for a package that is not there. */
export function stubSource(name: string): string {
  const message = `Cannot find module '${name}' (left out of the Monsters bundle)`;
  return `const err = new Error(${JSON.stringify(message)});\nerr.code = 'MODULE_NOT_FOUND';\nthrow err;\n`;
}

const stubPlugin: Plugin = {
  name: 'monsters-stubs',
  setup(b) {
    const names = new Set(STUBBED.map((s) => s.name));
    // Plain package names (letters, digits, dashes): no escaping needed.
    const filter = new RegExp(`^(?:${[...names].join('|')})$`);
    b.onResolve({ filter }, (args) =>
      names.has(args.path) ? { path: args.path, namespace: 'monsters-stub' } : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: 'monsters-stub' }, (args) => ({
      contents: stubSource(args.path),
      loader: 'js',
    }));
  },
};

/** Set by the packaged desktop app on its core: no module from outside the bundle's folder. */
export const CONFINE_ENV = 'MONSTERS_CORE_CONFINE';

const ENTRIES = {
  monsters: 'packages/cli/bin/monsters.js',
  'embed-worker': 'packages/vault/src/semantic/embed-worker.ts',
  'extract-worker': 'packages/core/src/files/extract-worker.ts',
} as const;

/**
 * Prepended to every output file: bundled CommonJS packages call `require` (Node built-ins,
 * mostly), which an ES module does not have. With `CONFINE_ENV` set, a resolve hook refuses
 * every module outside the folder of the file (realpath), built-ins apart: a planted
 * `resources/node_modules/x` never runs in the core (review of 19/10, n. 1). Without
 * `module.registerHooks` the confined core does not start.
 */
export const BANNER = [
  "import { createRequire as __monstersCreateRequire } from 'node:module';",
  'const require = __monstersCreateRequire(import.meta.url);',
  `if (process.env.${CONFINE_ENV} === '1') {`,
  "  const { registerHooks } = require('node:module');",
  "  const { realpathSync } = require('node:fs');",
  "  const { dirname, sep } = require('node:path');",
  "  const { fileURLToPath } = require('node:url');",
  "  if (typeof registerHooks !== 'function') throw new Error('module.registerHooks is missing: the confined core does not start');",
  "  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);",
  '  const root = fold(realpathSync(dirname(fileURLToPath(import.meta.url))));',
  '  registerHooks({',
  '    resolve(specifier, context, nextResolve) {',
  '      const found = nextResolve(specifier, context);',
  "      if (found.url.startsWith('node:')) return found;",
  "      const file = found.url.startsWith('file:') ? fold(fileURLToPath(found.url)) : null;",
  '      if (file !== null && file.startsWith(root + sep)) return found;',
  '      const err = new Error(`Cannot find module ${JSON.stringify(specifier)}: outside the core of the app`);',
  "      err.code = context.conditions?.includes('require') ? 'MODULE_NOT_FOUND' : 'ERR_MODULE_NOT_FOUND';",
  '      throw err;',
  '    },',
  '  });',
  '}',
].join('\n');

/**
 * The esbuild options of every file of the bundle that do not depend on the build (the tests
 * build small probes with them). `keepNames`: esbuild renames a top-level class that clashes
 * with a global (`AbortSignal` of the abort-controller polyfill becomes `AbortSignal2`), and
 * node-fetch, under grammY, accepts a signal only if its constructor is named "AbortSignal":
 * without it every call to Telegram from the bundle failed ("Expected signal to be an
 * instanceof AbortSignal"), while the sources worked.
 */
export const BUNDLE_OPTIONS = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  keepNames: true,
  // tr46 (node-fetch, under grammy) requires Node's deprecated `punycode`: outside
  // node_modules that prints DEP0040 at every start. Same API from the userland package.
  alias: { punycode: 'punycode/punycode.js' },
  plugins: [stubPlugin],
  banner: { js: BANNER },
} satisfies BuildOptions;

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** `@scope/name/sub/path` → `@scope/name`. */
function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** The installed copy of an external, as its workspace package sees it (pnpm links it there). */
function installedDir(ext: External): string | null {
  if (!ext.from) return null;
  const link = join(ROOT, ext.from, 'node_modules', ext.name);
  return existsSync(link) ? realpathSync(link) : null;
}

/** Root folder of every package whose files are in the bundle (`…/node_modules/<name>`). */
function bundledPackages(meta: Metafile): string[] {
  const roots = new Set<string>();
  for (const input of Object.keys(meta.inputs)) {
    const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/@][^/]*)\//.exec(input.replaceAll('\\', '/'));
    if (m?.[1]) roots.add(resolve(ROOT, m[1]));
  }
  return [...roots].sort();
}

const LICENSE_FILE = /^(licen[cs]e|copying)([-.][\w.-]*)?$/i;

/** The license of every bundled package (MIT and the like want their notice in every copy). */
function thirdPartyLicenses(meta: Metafile): string {
  const parts = [
    'Third-party software bundled in monsters.js and embed-worker.js (generated by scripts/build-core.ts).',
    'The external packages listed in package.json carry their own licenses.',
  ];
  const seen = new Set<string>();
  for (const dir of bundledPackages(meta)) {
    const pkg = readJson<{ name?: string; version?: string; license?: unknown }>(
      join(dir, 'package.json'),
    );
    const id = `${pkg.name ?? dir}@${pkg.version ?? '?'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const file = readdirSync(dir).find((f) => LICENSE_FILE.test(f));
    const license = typeof pkg.license === 'string' ? pkg.license : 'see the package';
    parts.push(
      `${'-'.repeat(78)}\n${id} (${license})\n\n${
        file ? readFileSync(join(dir, file), 'utf8').trim() : '(no license file in the package)'
      }`,
    );
  }
  return `${parts.join('\n\n')}\n`;
}

/** Imports of packages that are neither bundled, built in, nor declared external. */
export function undeclaredImports(meta: Metafile, externals: readonly External[]): string[] {
  const declared = new Set(externals.map((e) => e.name));
  const found = new Set<string>();
  for (const output of Object.values(meta.outputs)) {
    for (const imp of output.imports) {
      if (!imp.external || BUILTINS.has(imp.path)) continue;
      if (!declared.has(packageName(imp.path))) found.add(imp.path);
    }
  }
  return [...found].sort();
}

export interface BuildCoreOptions {
  out?: string;
  /** Version reported by the bundled core (default: the product version, bundleVersion()). */
  version?: string;
  web?: boolean;
  link?: boolean;
  log?: (line: string) => void;
  /** What esbuild says it built (tests: the imports left to the run time). */
  onMetafile?: (meta: Metafile) => void;
}

/** The product version: the one of the desktop app (D-046), not the 0.0.0 of the workspace. */
export function bundleVersion(): string {
  return readJson<{ version: string }>(join(ROOT, 'apps', 'desktop', 'package.json')).version;
}

export async function buildCore(options: BuildCoreOptions = {}): Promise<string> {
  const out = resolve(options.out ?? join(ROOT, 'packages', 'cli', 'dist-bundle'));
  const version = options.version ?? bundleVersion();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`version ${version}: not a semantic version`);
  }
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const webDist = join(ROOT, 'apps', 'web', 'dist');
  if (options.web !== false && !existsSync(join(webDist, 'index.html'))) {
    throw new Error(
      `no web UI build in ${relative(ROOT, webDist)}: run "pnpm --filter @monsters/web build" first (or pass --no-web)`,
    );
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const result = await build({
    entryPoints: Object.fromEntries(
      Object.entries(ENTRIES).map(([name, path]) => [name, join(ROOT, path)]),
    ),
    outdir: out,
    ...BUNDLE_OPTIONS,
    // Each external also with its subpaths (`@huggingface/transformers/...`).
    external: EXTERNALS.flatMap((e) => [e.name, `${e.name}/*`]),
    // Read by the sources that need to know they run from the bundle (server/web-ui.ts) and by
    // core/src/version.ts.
    define: { MONSTERS_BUNDLED: 'true', MONSTERS_VERSION: JSON.stringify(version) },
    absWorkingDir: ROOT,
    sourcemap: 'linked',
    // The full texts go in THIRD_PARTY_LICENSES.txt.
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
  });

  options.onMetafile?.(result.metafile);
  const undeclared = undeclaredImports(result.metafile, EXTERNALS);
  if (undeclared.length > 0) {
    throw new Error(
      `the bundle imports packages it does not contain: ${undeclared.join(', ')}. ` +
        'Bundle them, or add them to EXTERNALS in scripts/build-core.ts.',
    );
  }

  writeFileSync(join(out, 'THIRD_PARTY_LICENSES.txt'), thirdPartyLicenses(result.metafile));
  if (options.web !== false) cpSync(webDist, join(out, 'web'), { recursive: true });

  const dependencies: Record<string, string> = {};
  const optionalDependencies: Record<string, string> = {};
  for (const ext of EXTERNALS) {
    const dir = installedDir(ext);
    if (!dir) {
      if (ext.from && !ext.optional) throw new Error(`${ext.name} is not installed in ${ext.from}`);
      continue;
    }
    const { version } = readJson<{ version: string }>(join(dir, 'package.json'));
    (ext.optional ? optionalDependencies : dependencies)[ext.name] = version;
    if (options.link !== false) {
      const target = join(out, 'node_modules', ext.name);
      mkdirSync(dirname(target), { recursive: true });
      // Node resolves the real path, so the package's own dependencies (pnpm puts them next to
      // it in the store) are found as in the workspace.
      symlinkSync(dir, target, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  writeFileSync(
    join(out, 'package.json'),
    `${JSON.stringify(
      {
        name: 'monsters-core-bundle',
        version,
        private: true,
        description: 'Monsters core and CLI bundled by scripts/build-core.ts',
        license: 'Apache-2.0',
        type: 'module',
        main: 'monsters.js',
        bin: { monsters: 'monsters.js' },
        engines: { node: '>=24' },
        dependencies,
        optionalDependencies,
      },
      null,
      2,
    )}\n`,
  );

  for (const [file, o] of Object.entries(result.metafile.outputs)) {
    if (file.endsWith('.js'))
      log(`${relative(ROOT, file)}  ${(o.bytes / 1024 / 1024).toFixed(1)} MB`);
  }
  log(`bundle ready in ${relative(ROOT, out) || '.'} (Monsters ${version})`);
  return out;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      version: { type: 'string' },
      'no-web': { type: 'boolean' },
      'no-link': { type: 'boolean' },
    },
  });
  try {
    await buildCore({
      ...(values.out ? { out: values.out } : {}),
      ...(values.version ? { version: values.version } : {}),
      web: !values['no-web'],
      link: !values['no-link'],
    });
  } catch (err) {
    console.error(`build:core: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
