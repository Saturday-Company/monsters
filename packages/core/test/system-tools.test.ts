import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import type { LogEvent, PermissionsResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, isFreeChain, systemTools } from '../src/index.ts';
import {
  deferred,
  startTestHub,
  TERMINAL_OFF,
  toolResultsSeen,
  type TestHub,
} from './hub-helpers.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

const POSIX = process.platform !== 'win32';
const SHELL_ON = { vault: true, web: true, shell: true };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const toolResult = (t: TestHub, runId: string, tool: string) =>
  t
    .events(runId)
    .find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === tool);

describe('system tools in the hub', () => {
  it('offers shell and fs_* only to the agents whose permissions allow them', async () => {
    // The terminal is on by default: the team starts with it off, as a user may have chosen.
    const t = await startTestHub({}, { hub: { settings: TERMINAL_OFF } });
    // Starting a core picks the language of the system: the test says which one it wants.
    inLang('it');
    const tools = (id: string) => t.core.hub.team.get(id)!.config.tools;
    for (const id of ['titan', 'rhea', 'dione']) {
      expect(tools(id).filter((x) => x === 'shell' || x.startsWith('fs_'))).toEqual([]);
    }
    const folder = join(t.home, '..', 'lavoro');
    mkdirSync(folder);
    await t.json('PUT', '/api/permissions', {
      agents: {
        rhea: { vault: true, web: true, shell: true, folders: [{ path: folder, write: true }] },
      },
    });
    expect(tools('rhea')).toEqual(
      expect.arrayContaining(['shell', 'fs_list', 'fs_read', 'fs_write', 'fs_move', 'fs_delete']),
    );
    expect(tools('dione')).not.toContain('shell');

    // Free models get a smaller set: no move or delete (the terminal can do them).
    const free = [{ provider: 'openrouter', model: 'openrouter/free' }];
    expect(isFreeChain(free)).toBe(true);
    expect(isFreeChain([{ provider: 'fake', model: 'x' }])).toBe(false);
    expect(
      systemTools(
        { vault: true, web: true, shell: true, folders: [{ path: '/x', write: true }] },
        true,
      ),
    ).toEqual(['shell', 'fs_list', 'fs_read', 'fs_write']);
    expect(
      systemTools({ vault: true, web: true, folders: [{ path: '/x', write: false }] }, false),
    ).toEqual(['fs_list', 'fs_read']);

    // The prompt of an agent with the terminal carries one rule about it.
    const rhea = t.core.hub.team.get('rhea')!;
    const prompt = buildSystemPrompt({
      agent: rhea,
      toolNames: rhea.config.tools,
    });
    expect(prompt).toContain('Terminale e file (`shell`, `fs_*`)');
  });

  it('settings written before Phase 2 load fine; the terminal comes on once, logged by the system', async () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'settings.json'),
      JSON.stringify({ permissions: { vault: true, web: false } }),
    );
    const t = await startTestHub({}, { hub: { settings: {} }, home });
    const view = await t.json<PermissionsResponse>('GET', '/api/permissions');
    expect(view.defaults).toEqual({ vault: true, web: false, shell: true, folders: [] });
    expect(view.agents.map((a) => [a.id, a.custom])).toEqual([
      ['titan', false],
      ['dione', false],
      ['rhea', false],
    ]);
    const logged = t.events().filter((e) => e.type === 'permissions');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      agent: 'system',
      data: { target: 'defaults', by: 'system' },
    });
    const saved = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as {
      permissions: { shell: boolean };
      permissionsRevision: number;
    };
    expect(saved.permissions.shell).toBe(true);
    expect(saved.permissionsRevision).toBe(2);
  });

  it('changes permissions through the API: saved, applied, logged; bad folders refused', async () => {
    const t = await startTestHub({}, { hub: { settings: TERMINAL_OFF } });
    const folder = join(t.home, '..', 'Progetti');
    mkdirSync(folder);
    const updated = await t.json<PermissionsResponse>('PUT', '/api/permissions', {
      agents: {
        dione: { vault: false, web: false, shell: true, folders: [{ path: folder, write: false }] },
      },
    });
    const dione = updated.agents.find((a) => a.id === 'dione')!;
    expect(dione).toMatchObject({
      custom: true,
      permissions: {
        vault: false,
        web: false,
        shell: true,
        folders: [{ path: folder, write: false }],
      },
    });
    expect(t.core.hub.team.get('dione')!.config.tools).not.toContain('vault_write');
    expect(t.core.hub.team.get('dione')!.config.tools).toEqual(
      expect.arrayContaining(['shell', 'fs_read']),
    );
    const saved = JSON.parse(readFileSync(join(t.home, 'settings.json'), 'utf8')) as {
      permissions: { agents: Record<string, { shell: boolean }> };
    };
    expect(saved.permissions.agents['dione']?.shell).toBe(true);
    const logged = t.events().filter((e) => e.type === 'permissions');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ agent: 'user', data: { target: 'dione', by: 'ui' } });

    const bad = async (path: string) => {
      const res = await t.api('PUT', '/api/permissions', {
        agents: { rhea: { vault: true, web: true, folders: [{ path, write: true }] } },
      });
      expect(res.status).toBe(400);
      return (await res.json()) as { error: string; message: string };
    };
    expect(await bad(join(folder, 'manca'))).toMatchObject({
      error: 'invalid_folder',
      message: expect.stringContaining('doesn’t exist') as unknown,
    });
    expect(await bad('relativa/cartella')).toMatchObject({
      message: expect.stringContaining('full path') as unknown,
    });
    expect(await bad(t.core.hub.vault.root)).toMatchObject({
      message: expect.stringContaining('notes folder') as unknown,
    });
    expect(await bad(join(t.core.hub.vault.root, 'Inbox'))).toMatchObject({
      error: 'invalid_folder',
    });
    expect(await bad(t.home)).toMatchObject({
      message: expect.stringContaining('Monsters data folder') as unknown,
    });
    const unknown = await t.api('PUT', '/api/permissions', {
      agents: { nessuno: { vault: true, web: true } },
    });
    expect(unknown.status).toBe(404);

    // Back to the team's defaults.
    const reset = await t.json<PermissionsResponse>('PUT', '/api/permissions', {
      agents: { dione: null },
    });
    expect(reset.agents.find((a) => a.id === 'dione')).toMatchObject({ custom: false });
    expect(t.core.hub.team.get('dione')!.config.tools).not.toContain('shell');
  });

  it('keeps both of two permission changes sent at the same time', async () => {
    const t = await startTestHub({});
    const folder = join(t.home, '..', 'Insieme');
    mkdirSync(folder);
    const grant = { vault: true, web: true, folders: [{ path: folder, write: false }] };
    await Promise.all([
      t.json('PUT', '/api/permissions', { agents: { dione: grant } }),
      t.json('PUT', '/api/permissions', { agents: { rhea: grant } }),
    ]);
    const view = await t.json<PermissionsResponse>('GET', '/api/permissions');
    for (const id of ['dione', 'rhea']) {
      expect(view.agents.find((a) => a.id === id)).toMatchObject({ custom: true });
    }
    const saved = JSON.parse(readFileSync(join(t.home, 'settings.json'), 'utf8')) as {
      permissions: { agents: Record<string, unknown> };
    };
    expect(Object.keys(saved.permissions.agents).sort()).toEqual(['dione', 'rhea']);
  });

  it('the onboarding grants the terminal and folders, checked like in the settings', async () => {
    const t = await startTestHub({}, { withoutTeam: true });
    const folder = join(t.home, '..', 'Documenti');
    mkdirSync(folder);
    const state = await t.json<{ permissions: unknown }>('POST', '/api/onboarding/answers', {
      permissions: {
        vault: true,
        web: false,
        shell: true,
        folders: [{ path: `${folder}/`, write: true }],
      },
    });
    expect(state.permissions).toEqual({
      vault: true,
      web: false,
      shell: true,
      folders: [{ path: folder, write: true }],
    });
    const res = await t.api('POST', '/api/onboarding/answers', {
      permissions: {
        vault: true,
        web: true,
        folders: [{ path: t.core.hub.vault.root, write: true }],
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_folder' });
  });

  it.skipIf(!POSIX)(
    'the kill switch stops a long command and its children in under 2 s',
    async () => {
      const t = await startTestHub(
        {
          titan: [
            fake.toolCall('shell', {
              // A child in the foreground (with a grandchild) and one in the background,
              // which a non-interactive shell starts with SIGINT ignored.
              command:
                "sleep 60 & echo $! > sfondo.pid; sh -c 'echo $$ > figlio.pid; sleep 60'; echo mai",
            }),
            fake.text('non arrivo qui'),
          ],
        },
        { hub: { settings: { permissions: SHELL_ON } } },
      );
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'lancia' });
      const ws = join(t.home, 'workspaces', 'titan');
      const pid = (name: string) => Number(readFileSync(join(ws, name), 'utf8').trim() || 'NaN');
      await waitFor(
        () =>
          existsSync(join(ws, 'figlio.pid')) &&
          existsSync(join(ws, 'sfondo.pid')) &&
          pid('figlio.pid') > 0 &&
          pid('sfondo.pid') > 0,
      );
      const children = [pid('figlio.pid'), pid('sfondo.pid')];
      expect(children.every(alive)).toBe(true);
      const started = Date.now();
      expect((await t.api('POST', '/api/kill', {})).status).toBe(200);
      await waitFor(() => children.every((p) => !alive(p)), 2000);
      expect(Date.now() - started).toBeLessThan(2000);
      const ended = await t.runEnded(sent.runId);
      expect(ended.data.status).toBe('aborted');
      expect(toolResult(t, sent.runId, 'shell')).toMatchObject({
        data: { ok: false, error: 'aborted' },
      });
    },
  );

  it.skipIf(!POSIX)('a permission removed during a run holds at the next call', async () => {
    const release = deferred();
    const t = await startTestHub(
      {
        titan: [
          fake.toolCall('shell', { command: 'echo ciao' }, { gate: release.promise }),
          fake.text('ok'),
        ],
      },
      { hub: { settings: { permissions: SHELL_ON } } },
    );
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'prova' });
    // The model has the tool already: the request is waiting on the gate.
    await waitFor(() => t.provider.calls.length === 1);
    await t.json('PUT', '/api/permissions', {
      agents: { titan: { vault: true, web: true, shell: false } },
    });
    release.resolve();
    await t.runEnded(sent.runId);
    const result = toolResult(t, sent.runId, 'shell')!;
    expect(result.data.ok).toBe(false);
    expect(result.data.error).toContain('SETTING_OFF');
    expect(toolResultsSeen(t.provider.calls[1]!.options.prompt)).toContain(
      'Settings → Permissions',
    );
  });

  it.skipIf(!POSIX)(
    'logs every command and keeps the secrets of Monsters out of log and model',
    async () => {
      const t = await startTestHub(
        {
          titan: [
            fake.toolCall('shell', {
              command: 'cat "$TOKEN_FILE"; echo; env | grep -c MONSTERS_ || true',
            }),
            fake.text('fatto'),
          ],
        },
        { hub: { settings: { permissions: SHELL_ON } } },
      );
      process.env['TOKEN_FILE'] = t.core.paths.cliToken;
      process.env['MONSTERS_TEST_VISIBLE'] = 'no';
      try {
        const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'token?' });
        await t.runEnded(sent.runId);
        const token = readFileSync(t.core.paths.cliToken, 'utf8').trim();
        const call = t.events(sent.runId).find((e) => e.type === 'tool_call');
        expect(call).toMatchObject({
          data: { tool: 'shell', input: { command: expect.stringContaining('cat') as unknown } },
        });
        const result = toolResult(t, sent.runId, 'shell')!;
        const logged = JSON.stringify(result.data.output);
        expect(logged).not.toContain(token);
        expect(logged).toContain('[REDACTED]');
        const seen = toolResultsSeen(t.provider.calls[1]!.options.prompt);
        expect(seen).not.toContain(token);
        expect(seen).toContain('<dati_esterni fonte=\\"shell cat');
        // No MONSTERS_* variable reaches the command.
        expect((result.data.output as { stdout: string }).stdout.trim().split('\n').at(-1)).toBe(
          '0',
        );
      } finally {
        delete process.env['TOKEN_FILE'];
        delete process.env['MONSTERS_TEST_VISIBLE'];
      }
    },
  );

  const hasNpm = POSIX && spawnSync('npm', ['--version'], { stdio: 'ignore' }).status === 0;

  it.skipIf(!hasNpm)(
    'demo: an agent installs a CLI in its folder and uses it',
    async () => {
      const pkg = JSON.stringify({ name: 'saluta', version: '1.0.0', bin: { saluta: 'cli.js' } });
      const cli = '#!/usr/bin/env node\nconsole.log("ciao " + process.argv[2]);\n';
      const t = await startTestHub(
        {
          titan: [
            fake.toolCall('shell', {
              command: [
                'mkdir -p saluta && cd saluta',
                `printf '%s' '${pkg}' > package.json`,
                `printf '${cli.replace(/\n/g, '\\n')}' > cli.js`,
                'npm pack --silent >/dev/null',
                'npm install -g --offline --no-audit ./saluta-1.0.0.tgz',
              ].join(' && '),
              timeout_s: 120,
            }),
            fake.toolCall('shell', { command: 'command -v saluta && saluta Giulio' }),
            fake.text('Installata e provata.'),
          ],
        },
        { hub: { settings: { permissions: SHELL_ON } } },
      );
      const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
        text: 'Installa una CLI che saluta e provala',
      });
      await t.runEnded(sent.runId);
      const results = t
        .events(sent.runId)
        .filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
      expect(results).toHaveLength(2);
      expect(results[0]!.data.output).toMatchObject({ exit_code: 0 });
      const used = results[1]!.data.output as { exit_code: number; stdout: string };
      const bin = join(t.home, 'workspaces', 'titan', '.tools', 'bin', 'saluta');
      expect(used.exit_code).toBe(0);
      expect(used.stdout).toBe(`${bin}\nciao Giulio\n`);
      expect(existsSync(bin)).toBe(true);
    },
    120_000,
  );
});
