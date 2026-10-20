import type { ToolError } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { isExternalActor } from '../src/index.ts';
import { PERMISSIONS, actor, newVault } from './helpers.ts';

/*
 * External AI clients of the MCP server (`mcp-<client>`): same rules as a
 * sub-agent, with their own area `Agenti/MCP/` and the globs of the settings.
 */

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return (err as ToolError).code;
  }
}

describe('external MCP clients', () => {
  it('read like a sub-agent and write in Inbox/ and Agenti/MCP/', async () => {
    const vault = await newVault();
    const titan = actor('titan');
    const claude = actor('mcp-claude-ai');
    expect(isExternalActor('mcp-claude-ai')).toBe(true);
    expect(vault.permissions.isPrivileged('mcp-claude-ai')).toBe(false);
    expect(vault.permissions.areaOf('mcp-claude-ai')).toBe('Agenti/MCP');

    await vault.write(titan, { path: 'Progetti/Piano.md', content: '# Piano\n\nIdee.\n' });
    await vault.write(titan, {
      path: 'Risorse/Segreto.md',
      content: '# Segreto\n\nNo.\n',
      frontmatter: { private: true },
    });
    expect(await code(vault.read(claude, { path: 'Progetti/Piano' }))).toBe('ok');
    expect(await code(vault.read(claude, { path: 'Risorse/Segreto' }))).toBe('BLOCKED_BY_POLICY');
    expect((await vault.search(claude, { query: 'segreto' })).length).toBe(0);

    expect(
      await code(vault.write(claude, { path: 'Inbox/Da Claude.md', content: '# Da Claude\n' })),
    ).toBe('ok');
    expect(
      await code(vault.write(claude, { path: 'Agenti/MCP/Note.md', content: '# Note\n' })),
    ).toBe('ok');
    expect(
      await code(vault.write(claude, { path: 'Progetti/Nuovo.md', content: '# Nuovo\n' })),
    ).toBe('SETTING_OFF');
    // Another client cannot edit its notes in Inbox/ (author is the actor).
    const other = actor('mcp-cursor');
    const read = await vault.read(other, { path: 'Inbox/Da Claude' });
    expect(
      await code(
        vault.edit(other, {
          path: 'Inbox/Da Claude.md',
          base_hash: read.hash,
          ops: [{ append: { text: 'altro' } }],
        }),
      ),
    ).toBe('SETTING_OFF');
  });

  it('sign proposals with the client name in words, agents with their own name', async () => {
    const vault = await newVault({
      permissions: { ...PERMISSIONS, agents: { ...PERMISSIONS.agents, eos: { name: 'Eos Bis' } } },
    });
    await vault.write(actor('titan'), { path: 'Progetti/Piano.md', content: '# Piano\n\nIdee.\n' });
    const propose = (agentId: string) =>
      vault.propose(actor(agentId), {
        path: 'Piano',
        ops: [{ append: { text: 'Altro.' } }],
        note: 'Aggiunta.',
      });
    expect((await propose('mcp-claude-code')).proposal_path).toMatch(
      /^Inbox\/Proposta di Claude Code \(MCP\) - Piano - /,
    );
    expect((await propose('mcp-client')).proposal_path).toMatch(
      /^Inbox\/Proposta di Client \(MCP\) - Piano - /,
    );
    expect((await propose('rhea')).proposal_path).toMatch(/^Inbox\/Proposta di Rhea - Piano - /);
    expect((await propose('eos')).proposal_path).toMatch(/^Inbox\/Proposta di Eos Bis - Piano - /);
    expect(vault.permissions.displayName('mcp-')).toBe('Client (MCP)');
  });

  it('clean the display name for the file system before it goes in a proposal name', async () => {
    const names: [string, RegExp][] = [
      ['AC/DC', /^Inbox\/Proposta di AC-DC - Piano - /],
      ['x/../../.obsidian', /^Inbox\/Proposta di x-..-..-.obsidian - Piano - /],
      ['Back\\slash', /^Inbox\/Proposta di Back-slash - Piano - /],
      ['Tab\tNul\u0000:?*', /^Inbox\/Proposta di Tab Nul - Piano - /],
      ['CON', /^Inbox\/Proposta di Eos - Piano - /],
      ['...', /^Inbox\/Proposta di Eos - Piano - /],
      ['N'.repeat(300), new RegExp(`^Inbox/Proposta di ${'N'.repeat(40)} - Piano - `)],
    ];
    for (const [name, expected] of names) {
      const vault = await newVault({
        permissions: { ...PERMISSIONS, agents: { ...PERMISSIONS.agents, eos: { name } } },
      });
      await vault.write(actor('titan'), {
        path: 'Progetti/Piano.md',
        content: '# Piano\n\nIdee.\n',
      });
      const r = await vault.propose(actor('eos'), {
        path: 'Piano',
        ops: [{ append: { text: 'Altro.' } }],
        note: 'Aggiunta.',
      });
      expect(r.proposal_path, name).toMatch(expected);
      expect(r.proposal_path.split('/')).toHaveLength(2);
    }
  });

  it('get the globs of the settings, kept when the team changes', async () => {
    const vault = await newVault({
      permissions: { ...PERMISSIONS, external: { write: ['Progetti/**'] } },
    });
    const claude = actor('mcp-claude-ai');
    expect(
      await code(vault.write(claude, { path: 'Progetti/Da Claude.md', content: '# Da Claude\n' })),
    ).toBe('ok');
    // The onboarding replaces the team permissions: the external profile stays.
    vault.setPermissions({ orchestrator: 'titan', agents: {} });
    expect(
      await code(vault.write(claude, { path: 'Progetti/Altro.md', content: '# Altro\n' })),
    ).toBe('ok');
  });
});
