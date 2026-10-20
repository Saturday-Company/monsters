/*
 * Deploys the update server (src/worker.ts) to Cloudflare as the Worker `monsters-updates`,
 * on workers.dev, with the private R2 bucket `monsters-updates` bound as BUCKET.
 *
 *   pnpm --filter @monsters/update-server deploy:worker             build and upload
 *   pnpm --filter @monsters/update-server deploy:worker --dry-run   build and check, no upload
 *
 * The Worker is bundled with esbuild into Cloudflare's Build Output layout and deployed with the
 * `cf` CLI (logged in already) as `cf deploy --prebuilt`, run from this package:
 *
 *   .cloudflare/output/v0/config.json                             build context
 *   .cloudflare/output/v0/workers/default/worker.config.json      name, bindings, settings
 *   .cloudflare/output/v0/workers/default/bundle/index.js         the bundle
 *
 * The output is removed afterwards (it is also gitignored): the repo's lint and format checks
 * would otherwise pick up the generated bundle.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT = join(PKG, '.cloudflare', 'output', 'v0');
const WORKER_DIR = join(OUTPUT, 'workers', 'default');

const WORKER_NAME = 'monsters-updates';
const BUCKET_NAME = 'monsters-updates';
const COMPATIBILITY_DATE = '2026-09-30';

const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
  strict: true,
});
const dryRun = values['dry-run'];

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<number> {
  rmSync(join(PKG, '.cloudflare'), { recursive: true, force: true });
  mkdirSync(join(WORKER_DIR, 'bundle'), { recursive: true });

  await build({
    entryPoints: [join(PKG, 'src', 'worker.ts')],
    outfile: join(WORKER_DIR, 'bundle', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    absWorkingDir: PKG,
  });

  writeJson(join(OUTPUT, 'config.json'), {
    buildContext: { isPreview: false, mode: 'production' },
  });
  writeJson(join(WORKER_DIR, 'worker.config.json'), {
    name: WORKER_NAME,
    compatibilityDate: COMPATIBILITY_DATE,
    workersDev: true,
    env: { BUCKET: { type: 'r2', name: BUCKET_NAME } },
    manifest: { type: 'partial', mainModule: 'index.js', modules: {} },
  });

  const args = ['deploy', '--prebuilt', ...(dryRun ? ['--dry-run'] : [])];
  console.warn(`cf ${args.join(' ')}`);
  const result = spawnSync('cf', args, { cwd: PKG, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let status = 1;
try {
  status = await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  rmSync(join(PKG, '.cloudflare'), { recursive: true, force: true });
}
process.exit(status);
