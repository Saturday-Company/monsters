import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type Metafile } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BANNER,
  BUNDLE_OPTIONS,
  buildCore,
  CONFINE_ENV,
  EXTERNALS,
  STUBBED,
  stubSource,
} from './build-core.ts';

/*
 * The modules the core of the desktop app may load (review of 19/10, n. 1): the optional peers
 * are stubs inside the bundle, and the confined core (MONSTERS_CORE_CONFINE=1, set by the
 * packaged app) refuses any module outside its own folder, resources/core.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'monsters-build-core-'));
  dirs.push(d);
  return d;
}

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** Package names a file requires or imports with a literal name (the stubs must not be there). */
function literalLoads(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:\brequire|\bimport)\(\s*["']([^"'./$][^"']*)["']\s*\)/g)) {
    out.add(m[1]!);
  }
  return out;
}

/** A package planted where Node would look after the core's own node_modules. */
function plant(nodeModules: string, name: string, marker: string): void {
  const dir = join(nodeModules, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
  writeFileSync(
    join(dir, 'index.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = {};\n`,
  );
}

describe('the bundle of the core', () => {
  it(
    'holds the optional peers as stubs: no lookup of them on disk',
    { timeout: 120_000 },
    async () => {
      const out = join(temp(), 'core');
      let meta: Metafile | undefined;
      await buildCore({
        out,
        web: false,
        link: false,
        log: () => {},
        onMetafile: (m) => (meta = m),
      });
      // What the bundle leaves to the run time: built-ins and the declared externals only.
      const external = new Set<string>();
      for (const o of Object.values(meta!.outputs)) {
        for (const imp of o.imports)
          if (imp.external && !BUILTINS.has(imp.path)) external.add(imp.path);
      }
      const allowed = new Set(EXTERNALS.map((e) => e.name));
      for (const name of external) expect(allowed.has(name), name).toBe(true);
      expect(external.has('@node-rs/argon2')).toBe(true);
      for (const file of ['monsters.js', 'embed-worker.js', 'extract-worker.js']) {
        const code = readFileSync(join(out, file), 'utf8');
        // Every file starts with the confinement.
        expect(code.slice(0, 2000)).toContain(CONFINE_ENV);
        const loaded = literalLoads(code);
        for (const s of STUBBED) expect(loaded.has(s.name), `${file}: ${s.name}`).toBe(false);
      }
      const monsters = readFileSync(join(out, 'monsters.js'), 'utf8');
      for (const s of STUBBED) {
        expect(monsters).toContain(
          `Cannot find module '${s.name}' (left out of the Monsters bundle)`,
        );
      }
      // The stubs are not dependencies of the bundle any more.
      const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')) as {
        optionalDependencies: Record<string, string>;
      };
      for (const s of STUBBED) expect(pkg.optionalDependencies[s.name]).toBeUndefined();
    },
  );

  it('a stub fails as a missing package does', () => {
    const run = spawnSync(
      process.execPath,
      [
        '-e',
        `try { new Function(${JSON.stringify(stubSource('bufferutil'))})(); } catch (e) { console.log(e.code, e.message); }`,
      ],
      { encoding: 'utf8' },
    );
    expect(run.stdout).toContain("MODULE_NOT_FOUND Cannot find module 'bufferutil'");
  });

  it('confined, the core loads nothing from outside its folder; unconfined, Node looks up as usual', () => {
    const resources = temp();
    const core = join(resources, 'core');
    const marker = join(resources, 'ran');
    mkdirSync(join(core, 'node_modules', 'inside'), { recursive: true });
    writeFileSync(join(core, 'node_modules', 'inside', 'package.json'), '{"name":"inside"}');
    writeFileSync(join(core, 'node_modules', 'inside', 'index.js'), 'module.exports = "inside";');
    // What the review planted: a package in resources/node_modules, above resources/core.
    plant(join(resources, 'node_modules'), 'supports-color', marker);
    plant(join(resources, 'node_modules'), '@huggingface/transformers', marker);
    const entry = join(core, 'entry.mjs');
    writeFileSync(
      entry,
      `${BANNER}
const out = [];
try { require('supports-color'); out.push('require loaded'); } catch (e) { out.push('require ' + e.code); }
try { await import('@huggingface/transformers'); out.push('import loaded'); } catch (e) { out.push('import ' + e.code); }
out.push(require('inside'), typeof require('node:fs').readFileSync, typeof (await import('fs')).readFileSync);
console.log(out.join('|'));
`,
    );
    const run = (confine: boolean) => {
      rmSync(marker, { force: true });
      const env = { ...process.env };
      delete env[CONFINE_ENV];
      if (confine) env[CONFINE_ENV] = '1';
      const r = spawnSync(process.execPath, [entry], { encoding: 'utf8', env });
      return { out: r.stdout.trim(), err: r.stderr, ran: existsSync(marker) };
    };
    const confined = run(true);
    expect(confined.err).toBe('');
    expect(confined.out).toBe(
      'require MODULE_NOT_FOUND|import ERR_MODULE_NOT_FOUND|inside|function|function',
    );
    expect(confined.ran).toBe(false);
    // The same file without the variable (the CLI, development): the planted package runs.
    const loose = run(false);
    expect(loose.out).toBe('require loaded|import loaded|inside|function|function');
    expect(loose.ran).toBe(true);
  });

  it(
    'a grammY call works from the bundle: the polyfilled AbortSignal keeps its name for node-fetch',
    { timeout: 60_000 },
    async () => {
      const dir = temp();
      // A fake Bot API on loopback; the probe, bundled as the core is, asks it getMe.
      const probe = [
        "import { createServer } from 'node:http';",
        "import { Api } from 'grammy';",
        // The core uses the global AbortSignal too: esbuild then renames the polyfill's class.
        'globalThis.__native = AbortSignal.timeout;',
        'const server = createServer((_req, res) => {',
        "  res.setHeader('content-type', 'application/json');",
        "  res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: 'B', username: 'b_bot' } }));",
        '});',
        "await new Promise((r) => server.listen(0, '127.0.0.1', r));",
        "const api = new Api('1:x', { apiRoot: `http://127.0.0.1:${server.address().port}`, timeoutSeconds: 5 });",
        'try {',
        '  const me = await api.getMe();',
        '  console.log(`ok ${me.username}`);',
        '} catch (err) {',
        '  console.log(`failed ${err?.error?.message ?? err?.message}`);',
        '} finally {',
        '  server.close();',
        '}',
      ].join('\n');
      await build({
        ...BUNDLE_OPTIONS,
        stdin: {
          contents: probe,
          resolveDir: join(process.cwd(), 'packages', 'core'),
          sourcefile: 'probe.ts',
          loader: 'ts',
        },
        outfile: join(dir, 'probe.mjs'),
        logLevel: 'silent',
      });
      const run = spawnSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8' });
      expect(run.stdout.trim(), run.stderr).toBe('ok b_bot');
    },
  );
});
