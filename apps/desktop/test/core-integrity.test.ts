import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPackedCore as checkAfterPack } from '../scripts/after-pack.ts';
import {
  buildCoreManifest,
  checkCore,
  checkPackagedCore,
  checkProblemText,
  CORE_MANIFESTS_DIR,
  manifestHashOf,
  manifestName,
  parseCoreManifest,
  type CoreCheck,
} from '../src/main/core-integrity.ts';
import { tempDir } from './helpers.ts';

/*
 * The core of the packaged app, checked against the manifest in app.asar before every start
 * (review of 18/10, S-M9): a file changed, added or missing and the core does not start.
 */

const POSIX = process.platform !== 'win32';

/** A staged core: the bundle, the web UI, a native module. */
function stagedCore(): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', '@node-rs', 'argon2-linux-x64-gnu'), { recursive: true });
  writeFileSync(join(dir, 'monsters.js'), 'console.log("core")\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"monsters-core"}\n');
  writeFileSync(join(dir, 'web', 'index.html'), '<!doctype html>\n');
  writeFileSync(join(dir, 'web', 'assets', 'app.js'), 'export {}\n');
  writeFileSync(
    join(dir, 'node_modules', '@node-rs', 'argon2-linux-x64-gnu', 'argon2.linux-x64-gnu.node'),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]),
  );
  return dir;
}

const LINUX = { platform: 'linux', arch: 'x64' };
const failed = (c: CoreCheck) => (c.ok ? null : { problem: c.problem, file: c.file });

describe('core integrity (S-M9)', () => {
  it('a core as packed passes, with every file counted', async () => {
    const dir = stagedCore();
    const manifest = await buildCoreManifest(dir, LINUX);
    expect(Object.keys(manifest.files)).toEqual([
      'monsters.js',
      'node_modules/@node-rs/argon2-linux-x64-gnu/argon2.linux-x64-gnu.node',
      'package.json',
      'web/assets/app.js',
      'web/index.html',
    ]);
    expect(parseCoreManifest(JSON.stringify(manifest))).toEqual(manifest);
    const check = await checkCore(dir, manifest);
    expect(check).toMatchObject({ ok: true, files: 5 });
  });

  it('a file changed, added or missing stops the core', async () => {
    const dir = stagedCore();
    const manifest = await buildCoreManifest(dir, LINUX);
    writeFileSync(join(dir, 'monsters.js'), 'console.log("altro")\n');
    expect(failed(await checkCore(dir, manifest))).toEqual({
      problem: 'changed',
      file: 'monsters.js',
    });
    writeFileSync(join(dir, 'monsters.js'), 'console.log("core")\n');
    // The native module counts too.
    writeFileSync(
      join(dir, 'node_modules', '@node-rs', 'argon2-linux-x64-gnu', 'argon2.linux-x64-gnu.node'),
      'non è il modulo',
    );
    expect(failed(await checkCore(dir, manifest))?.problem).toBe('changed');
    const fresh = stagedCore();
    const m2 = await buildCoreManifest(fresh, LINUX);
    writeFileSync(join(fresh, 'web', 'assets', 'extra.js'), 'fetch("https://evil")');
    expect(failed(await checkCore(fresh, m2))).toEqual({
      problem: 'extra',
      file: 'web/assets/extra.js',
    });
    rmSync(join(fresh, 'web', 'assets', 'extra.js'));
    rmSync(join(fresh, 'web', 'index.html'));
    expect(failed(await checkCore(fresh, m2))).toEqual({
      problem: 'missing',
      file: 'web/index.html',
    });
  });

  it.skipIf(!POSIX)('a link put in the core is not part of it', async () => {
    const dir = stagedCore();
    const manifest = await buildCoreManifest(dir, LINUX);
    symlinkSync('/etc/hostname', join(dir, 'node_modules', 'altro.js'));
    expect(failed(await checkCore(dir, manifest))).toEqual({
      problem: 'extra',
      file: 'node_modules/altro.js',
    });
  });

  it('on macOS a native module is signed in place: its content is not hashed, its presence is', async () => {
    const dir = stagedCore();
    const manifest = await buildCoreManifest(dir, { platform: 'darwin', arch: 'arm64' });
    const native = 'node_modules/@node-rs/argon2-linux-x64-gnu/argon2.linux-x64-gnu.node';
    expect(manifest.files[native]).toBe('signed');
    writeFileSync(join(dir, native), 'firmato dopo il pacchetto');
    expect((await checkCore(dir, manifest)).ok).toBe(true);
    rmSync(join(dir, native));
    expect(failed(await checkCore(dir, manifest))).toEqual({ problem: 'missing', file: native });
  });

  it('the packaged app reads the manifest of its platform from the app; none, none starts', async () => {
    const core = stagedCore();
    const app = tempDir();
    mkdirSync(join(app, CORE_MANIFESTS_DIR), { recursive: true });
    const missing = await checkPackagedCore({ appPath: app, coreDir: core, ...LINUX });
    expect(failed(missing)).toEqual({
      problem: 'manifest',
      file: 'core-manifests/linux-x64.json',
    });
    expect(checkProblemText(missing as Exclude<CoreCheck, { ok: true }>)).toContain(
      'the list of the program’s files is missing',
    );
    const manifest = await buildCoreManifest(core, LINUX);
    writeFileSync(
      join(app, CORE_MANIFESTS_DIR, manifestName('linux', 'x64')),
      JSON.stringify(manifest),
    );
    expect((await checkPackagedCore({ appPath: app, coreDir: core, ...LINUX })).ok).toBe(true);
    // The manifest of another target does not stand for this one.
    writeFileSync(
      join(app, CORE_MANIFESTS_DIR, manifestName('linux', 'arm64')),
      JSON.stringify(manifest),
    );
    expect(
      failed(
        await checkPackagedCore({ appPath: app, coreDir: core, platform: 'linux', arch: 'arm64' }),
      )?.problem,
    ).toBe('manifest');
    writeFileSync(join(core, 'monsters.js'), 'cambiato');
    const changed = await checkPackagedCore({ appPath: app, coreDir: core, ...LINUX });
    expect(checkProblemText(changed as Exclude<CoreCheck, { ok: true }>)).toBe(
      'resources/core/monsters.js has changed',
    );
  });

  it('after packing, a packed core that is not the staged one stops the build', async () => {
    const out = tempDir();
    const core = join(out, 'resources', 'core');
    mkdirSync(join(out, 'resources'), { recursive: true });
    const staged = stagedCore();
    const manifests = tempDir();
    mkdirSync(manifests, { recursive: true });
    writeFileSync(
      join(manifests, manifestName('linux', 'x64')),
      JSON.stringify(await buildCoreManifest(staged, LINUX)),
    );
    // electron-builder copied it without one file.
    const { cpSync } = await import('node:fs');
    cpSync(staged, core, { recursive: true });
    rmSync(join(core, 'package.json'));
    const context = {
      appOutDir: out,
      electronPlatformName: 'linux',
      arch: 1,
      packager: { appInfo: { productFilename: 'Monsters' } },
    };
    await expect(checkAfterPack(context, manifests)).rejects.toThrow(/missing: package\.json/);
    writeFileSync(join(core, 'package.json'), '{"name":"monsters-core"}\n');
    await expect(checkAfterPack(context, manifests)).resolves.toBeUndefined();
  });
});

describe('the hash of one file of the core (the keyring before loading it, review 19/10)', () => {
  it('is the manifest’s for a file inside the core, null for anything else', () => {
    const manifest = {
      version: 1 as const,
      platform: 'linux',
      arch: 'x64',
      files: { 'node_modules/k/keyring.node': 'a'.repeat(64), 'x.node': 'signed' },
    };
    const core = join('/opt', 'Monsters', 'resources', 'core');
    expect(manifestHashOf(manifest, core, join(core, 'node_modules', 'k', 'keyring.node'))).toBe(
      'a'.repeat(64),
    );
    expect(manifestHashOf(manifest, core, join(core, 'x.node'))).toBe('signed');
    expect(manifestHashOf(manifest, core, join(core, 'other.node'))).toBeNull();
    expect(manifestHashOf(manifest, core, join(core, '..', 'x.node'))).toBeNull();
    expect(manifestHashOf(manifest, core, core)).toBeNull();
  });
});
