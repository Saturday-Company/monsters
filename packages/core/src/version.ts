import { readFileSync } from 'node:fs';

/*
 * The version of Monsters reported by the core (`/api/health`, `/api/status`, `monsters --version`,
 * the MCP servers, the User-Agent). It is the version of the product, the one of
 * `apps/desktop/package.json` (D-046), not the `0.0.0` of the workspace packages:
 *
 *  1. `MONSTERS_APP_VERSION`, set by the desktop app on the core it starts (`app.getVersion()`):
 *     the core of a package always says the version of that package, even when the bundle was
 *     reused for another version (`package.ts --no-build`, the update e2e);
 *  2. the version the bundle was built for (`MONSTERS_VERSION`, defined by scripts/build-core.ts);
 *  3. from the sources: `apps/desktop/package.json` of the repo;
 *  4. `0.0.0` when none of these is known.
 */

/** Defined by scripts/build-core.ts in the bundle; not defined in the sources. */
declare const MONSTERS_VERSION: string | undefined;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface VersionSources {
  env: NodeJS.ProcessEnv;
  bundled: string | undefined;
  /** Reads the version of the sources (null if not in a repo). */
  source: () => string | null;
}

/** The first valid version of the sources above, in order. */
export function resolveCoreVersion(s: VersionSources): string {
  const fromApp = s.env['MONSTERS_APP_VERSION']?.trim();
  if (fromApp && SEMVER.test(fromApp)) return fromApp;
  if (s.bundled && SEMVER.test(s.bundled)) return s.bundled;
  const fromSource = s.source();
  if (fromSource && SEMVER.test(fromSource)) return fromSource;
  return '0.0.0';
}

function sourceVersion(): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../../apps/desktop/package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export const CORE_VERSION = resolveCoreVersion({
  env: process.env,
  bundled: typeof MONSTERS_VERSION === 'string' ? MONSTERS_VERSION : undefined,
  source: sourceVersion,
});
