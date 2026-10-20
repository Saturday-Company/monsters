/*
 * Deploys the site to Cloudflare as the static-assets Worker `monsters`, on workers.dev
 * (monsters.saturdaycompany.workers.dev). No Worker code: Cloudflare serves dist/ as assets
 * (D-144; the `cf` CLI instead of Wrangler, D-050).
 *
 *   pnpm --filter @monsters/site deploy:worker             build and upload
 *   pnpm --filter @monsters/site deploy:worker --dry-run   build and check, no upload
 *   pnpm --filter @monsters/site deploy:worker --no-build  upload the dist/ already there
 *
 * The build is laid out in Cloudflare's Build Output format and deployed with
 * `cf deploy --prebuilt`, run from this package (logged in already):
 *
 *   .cloudflare/output/v0/config.json                          build context
 *   .cloudflare/output/v0/workers/default/worker.config.json   name, assets settings
 *   .cloudflare/output/v0/workers/default/assets/              the site (a copy of dist/)
 *
 * A Worker with an assets directory and no bundle is an assets-only Worker. `_headers` in
 * dist/ (from public/) sets the cache and security headers. The output is removed afterwards
 * (it is also gitignored).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(PKG, 'dist');
const OUTPUT = join(PKG, '.cloudflare', 'output', 'v0');
const WORKER_DIR = join(OUTPUT, 'workers', 'default');

const WORKER_NAME = 'monsters';
const COMPATIBILITY_DATE = '2026-09-30';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
  },
  strict: true,
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cmd: string, args: string[]): number {
  console.warn(`${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: PKG, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main(): number {
  if (!values['no-build']) {
    const built = run('pnpm', ['run', 'build']);
    if (built !== 0) return built;
  }
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}`);

  rmSync(join(PKG, '.cloudflare'), { recursive: true, force: true });
  mkdirSync(WORKER_DIR, { recursive: true });
  cpSync(DIST, join(WORKER_DIR, 'assets'), { recursive: true });

  writeJson(join(OUTPUT, 'config.json'), {
    buildContext: { isPreview: false, mode: 'production' },
  });
  writeJson(join(WORKER_DIR, 'worker.config.json'), {
    name: WORKER_NAME,
    compatibilityDate: COMPATIBILITY_DATE,
    workersDev: true,
    // /it → /it/ (Astro writes it/index.html); unknown paths get a real 404.
    assets: { htmlHandling: 'auto-trailing-slash', notFoundHandling: '404-page' },
  });

  return run('cf', ['deploy', '--prebuilt', ...(values['dry-run'] ? ['--dry-run'] : [])]);
}

let status = 1;
try {
  status = main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  rmSync(join(PKG, '.cloudflare'), { recursive: true, force: true });
}
process.exit(status);
