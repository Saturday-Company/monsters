import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultService, type VaultWarning } from '../src/index.ts';
import { actor, newVault, track } from './helpers.ts';

/*
 * C3 of the M3.6 review: a folder without permission or a failing watcher must neither stop
 * the core from starting nor take it down; D-043: probe files left by a killed run, and a
 * change made while the watcher was starting.
 */

// Running as root, mode 000 does not stop anything: nothing to test there.
const canDenyAccess = process.platform !== 'win32' && process.getuid?.() !== 0;

const locked: string[] = [];
afterEach(() => {
  for (const dir of locked.splice(0)) chmodSync(dir, 0o755);
  vi.restoreAllMocks();
});

function lock(dir: string): void {
  chmodSync(dir, 0o000);
  locked.push(dir);
}

describe.runIf(canDenyAccess)('vault with folders it cannot read', () => {
  it('opens anyway: the folder is skipped with a warning, the rest is indexed', async () => {
    const vault = await newVault();
    const root = vault.root;
    mkdirSync(join(root, 'Privata'));
    writeFileSync(join(root, 'Privata/Diario.md'), 'segreto\n');
    writeFileSync(join(root, 'Inbox/Visibile.md'), 'ornitorinco\n');
    writeFileSync(join(root, 'Inbox/Chiusa.md'), 'echidna\n');
    chmodSync(join(root, 'Inbox/Chiusa.md'), 0o000);
    lock(join(root, 'Privata'));
    await vault.close();

    const warnings: VaultWarning[] = [];
    const opened = track(await VaultService.open({ root, onWarning: (w) => warnings.push(w) }));
    expect(warnings.map((w) => [w.code, w.path])).toEqual(
      expect.arrayContaining([
        ['vault_unreadable', 'Privata'],
        ['vault_unreadable', 'Inbox/Chiusa.md'],
      ]),
    );
    const hits = await opened.search(actor('titan'), { query: 'ornitorinco' });
    expect(hits.map((h) => h.path)).toEqual(['Inbox/Visibile.md']);
    chmodSync(join(root, 'Inbox/Chiusa.md'), 0o644);

    // The watcher starts too, and a folder locked while it runs does not take it down.
    await opened.watch();
    mkdirSync(join(root, 'Nuova'));
    lock(join(root, 'Nuova'));
    await new Promise((r) => setTimeout(r, 300));
  });
});

describe('vault watcher failures', () => {
  it('an error of the watcher (limit of watched files) is a warning, not a crash', async () => {
    const instances: FSWatcher[] = [];
    vi.spyOn(FSWatcher.prototype, 'on').mockImplementation(function (
      this: FSWatcher,
      ...args: Parameters<FSWatcher['on']>
    ) {
      if (!instances.includes(this)) instances.push(this);
      return EventEmitter.prototype.on.call(this, ...args) as FSWatcher;
    });
    const warnings: VaultWarning[] = [];
    const vault = await newVault({ onWarning: (w) => warnings.push(w) });
    await vault.watch();
    const watcher = instances.at(-1)!;
    const err = Object.assign(
      new Error('ENOSPC: System limit for number of file watchers reached'),
      {
        code: 'ENOSPC',
      },
    );
    // Without an 'error' listener EventEmitter throws, and in the core nothing catches it.
    expect(() => watcher.emit('error', err)).not.toThrow();
    expect(() => watcher.emit('error', err)).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'vault_watch_error' });
    expect(warnings[0]!.message).toMatch(/ENOSPC/);
  });

  it('removes probe files left by a run killed during watch() (D-043)', async () => {
    const vault = await newVault();
    const leftover = '.monsters-watch-deadbeef.monsters-tmp';
    writeFileSync(join(vault.root, leftover), '');
    await vault.watch();
    expect(readdirSync(vault.root).filter((n) => n.startsWith('.monsters-watch-'))).toEqual([]);
  });

  it('a change made while the watcher was starting is indexed (D-043)', async () => {
    const vault = await newVault();
    // Written after the sync of open() and before the watcher sees anything: no event
    // will ever come for it.
    writeFileSync(join(vault.root, 'Inbox/Nel mezzo.md'), 'capibara\n');
    await vault.watch();
    const hits = await vault.search(actor('titan'), { query: 'capibara' });
    expect(hits.map((h) => h.path)).toEqual(['Inbox/Nel mezzo.md']);
  });
});
