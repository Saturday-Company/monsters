import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ToolEmittedEvent } from '@monsters/shared';
import { afterEach } from 'vitest';
import { VaultService, type VaultActor, type VaultCreateOptions } from '../src/index.ts';

const dirs: string[] = [];
const services: VaultService[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-vault-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export const PERMISSIONS = {
  orchestrator: 'titan',
  agents: {
    rhea: { name: 'Rhea' },
    dione: { name: 'Dione', write: ['Progetti/Social/**'] },
  },
};

export async function newVault(opts: Partial<VaultCreateOptions> = {}): Promise<VaultService> {
  const root = join(tempDir(), 'Vault');
  const vault = await VaultService.create({
    root,
    permissions: PERMISSIONS,
    orchestratorName: 'Titan',
    agentNames: ['Rhea', 'Dione'],
    ...opts,
  });
  services.push(vault);
  return vault;
}

export function track(vault: VaultService): VaultService {
  services.push(vault);
  return vault;
}

export interface TestActor extends VaultActor {
  events: ToolEmittedEvent[];
}

export function actor(agentId: string, signal?: AbortSignal): TestActor {
  const events: ToolEmittedEvent[] = [];
  return { agentId, signal, events, emit: (e) => events.push(e) };
}

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  timeoutMs = 5000,
): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: timed out');
    await sleep(25);
  }
}

/** All files under a folder (relative POSIX paths), `.git` excluded. */
export function listAll(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(root.length + 1)
        .replace(/\\/g, '/'),
    )
    .filter((p) => !p.startsWith('.git/'))
    .sort();
}
