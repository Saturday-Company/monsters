import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENT_PERMISSIONS, PERMISSIONS_REVISION } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSavedPermissions, patchSettingsFile } from '../src/onboarding/settings-file.ts';
import { HubSettingsSchema } from '../src/team/settings.ts';

/*
 * Everything on by default (D-1xx-tools): new teams get the terminal, permissions saved when it
 * was off by default get it once, and a choice saved after that is never changed again.
 */

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'monsters-perm-default-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

interface Saved {
  permissionsRevision?: number;
  userName?: string;
  permissions: { shell?: boolean; agents: Record<string, { shell?: boolean }> };
}
const read = () => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as Saved;
const write = (s: unknown) => writeFileSync(join(home, 'settings.json'), JSON.stringify(s));

describe('permissions on by default', () => {
  it('the defaults have the terminal on', () => {
    expect(DEFAULT_AGENT_PERMISSIONS.shell).toBe(true);
    expect(HubSettingsSchema.parse({}).permissions.shell).toBe(true);
  });

  it('turns the terminal on once in permissions saved before, team and own', () => {
    write({
      userName: 'Ada',
      permissions: {
        vault: true,
        web: true,
        shell: false,
        folders: [],
        agents: {
          rhea: { vault: true, web: false, shell: false },
          titan: { vault: true, web: true, shell: true },
        },
      },
    });
    expect(openSavedPermissions(home)).toEqual(['defaults', 'rhea']);
    const s = read();
    expect(s.permissions.shell).toBe(true);
    expect(s.permissions.agents.rhea).toEqual({ vault: true, web: false, shell: true });
    expect(s.permissions.agents.titan?.shell).toBe(true);
    expect(s.permissionsRevision).toBe(PERMISSIONS_REVISION);
    expect(s.userName).toBe('Ada');
    // Only once.
    expect(openSavedPermissions(home)).toEqual([]);
  });

  it('never changes a choice saved after the revision', () => {
    write({ userName: 'Ada' });
    patchSettingsFile(home, { permissions: { vault: true, web: true, shell: false, agents: {} } });
    expect(read().permissionsRevision).toBe(PERMISSIONS_REVISION);
    expect(openSavedPermissions(home)).toEqual([]);
    expect(read().permissions.shell).toBe(false);
  });

  it('a home without settings stays without a file', () => {
    expect(openSavedPermissions(home)).toEqual([]);
    expect(() => read()).toThrow();
  });
});
