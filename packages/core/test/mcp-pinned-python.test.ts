import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_CATALOG, UV_EXCLUDE_NEWER } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import type { TeamService } from '../src/index.ts';
import {
  EventLog,
  McpManager,
  coreMigrations,
  migrate,
  openDb,
  PINNED_PYTHON_SERVERS,
  installPinnedPython,
  pinnedPythonArgs,
  pinnedPythonDir,
  pinnedPythonExe,
  pinnedPythonInstalled,
  pinnedPythonServerOf,
  preparePythonInstall,
} from '../src/index.ts';
import type { RunController } from '../src/kill/run-controller.ts';
import type { StateStore } from '../src/db/state-store.ts';
import { tempHome } from './helpers.ts';

/*
 * Blender (and any Python server of the gallery with a pinned install) runs from its own
 * environment installed once from our requirements (review of 18/10, M10). No network and no
 * real uv here: a script lays out what the three `uv` calls would, and refuses a server archive
 * whose sha256 is not the one the requirements file asks for.
 */

const blender = PINNED_PYTHON_SERVERS.find((s) => s.id === 'blender')!;
const entry = MCP_CATALOG.find((e) => e.id === 'blender')!;
const gallerySetting = {
  catalog: 'blender',
  transport: 'stdio' as const,
  command: entry.command,
  args: entry.args ?? [],
};

/** A `uv` that does what the three calls do, with the archive it "downloads" summing to `archive`. */
const fakeUv = (home: string, archive: string, log: string[][]) => {
  const python = pinnedPythonExe(home, blender);
  const script = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const sub = args.filter((a) => !a.startsWith('--no-config'))[0];
if (sub === 'venv') {
  fs.mkdirSync(path.dirname(${JSON.stringify(python)}), { recursive: true });
  fs.writeFileSync(${JSON.stringify(python)}, '');
} else if (args.includes('--no-index')) {
  const file = args[args.indexOf('-r') + 1];
  const m = /--hash=sha256:([0-9a-f]{64})/.exec(fs.readFileSync(file, 'utf8'));
  if (!m || m[1] !== ${JSON.stringify(archive)}) {
    console.error('error: Hash mismatch for blender-mcp');
    console.error('  Expected: sha256:' + (m && m[1]));
    console.error('  Computed: sha256:' + ${JSON.stringify(archive)});
    process.exit(2);
  }
}
`;
  return (command: string, args: string[], options: Parameters<typeof spawn>[2]) => {
    log.push([command, ...args]);
    return spawn(process.execPath, ['-e', script, '--', ...args], options);
  };
};

describe('gallery Python servers with a pinned install', () => {
  it('the requirements pin every package, indirect ones too, with the sha256 of its files', () => {
    const names = new Set<string>();
    let open: string | undefined;
    let files = 0;
    const close = () => {
      if (open) expect(files, open).toBeGreaterThan(0);
    };
    for (const line of blender.requirements.split('\n')) {
      if (/^[A-Za-z0-9]/.test(line)) {
        close();
        const m = /^([A-Za-z0-9_.-]+)==[0-9][^\s;]*(?: ;[^\\]*)? \\$/.exec(line);
        expect(m, line).not.toBeNull();
        names.add(m![1]!);
        open = m![1];
        files = 0;
      } else if (line.trim()) {
        expect(line, line).toMatch(/^ {4}--hash=sha256:[0-9a-f]{64}( \\)?$/);
        files++;
      }
    }
    close();
    // The packages of Blender's `pyproject.toml`, the build tool and what they bring.
    for (const name of ['docutils', 'mcp', 'pyyaml', 'setuptools', 'pydantic-core']) {
      expect(names.has(name), name).toBe(true);
    }
    // Windows-only packages are there with their marker: all platforms in one file.
    expect(blender.requirements).toMatch(/^colorama==\S+ ; sys_platform == 'win32'/m);
    expect(blender.requirements).not.toMatch(/(?:git\+|https?:\/\/|--index|-e )/);
    expect(blender.archive).toMatch(/^https:\/\/projects\.blender\.org\/.*[0-9a-f]{40}\.tar\.gz$/);
    expect(blender.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    // The archive is the commit of the gallery line.
    const commit = /([0-9a-f]{40})\.tar\.gz$/.exec(blender.archive)![1]!;
    expect(entry.args?.find((a) => a.startsWith('git+'))).toContain(`@${commit}#`);
  });

  it('the gallery line, old or new, is the one pinned; a changed line keeps its own command', () => {
    expect(pinnedPythonServerOf(gallerySetting)).toBe(blender);
    expect(entry.args?.slice(0, 2)).toEqual(['--exclude-newer', UV_EXCLUDE_NEWER]);
    // Added before the date limit existed.
    const old = { ...gallerySetting, args: (entry.args ?? []).slice(2) };
    expect(pinnedPythonServerOf(old)).toBe(blender);
    // Added with another day.
    const day = { ...gallerySetting, args: ['--exclude-newer', '2026-01-01', ...old.args] };
    expect(pinnedPythonServerOf(day)).toBe(blender);
    expect(pinnedPythonServerOf({ ...gallerySetting, args: [...old.args, '--x'] })).toBe(undefined);
    const moved = old.args.map((a) => a.replace(/@[0-9a-f]{40}#/, '@main#'));
    expect(pinnedPythonServerOf({ ...gallerySetting, args: moved })).toBe(undefined);
    expect(pinnedPythonServerOf({ ...gallerySetting, command: 'uv' })).toBe(undefined);
    expect(pinnedPythonServerOf({ ...gallerySetting, command: '/x/uvx' })).toBe(undefined);
    expect(pinnedPythonServerOf({ ...gallerySetting, catalog: undefined })).toBe(undefined);
    expect(pinnedPythonServerOf({ ...gallerySetting, preset: 'browser' })).toBe(undefined);
  });

  it('uv: public index, sums required, no user configuration', () => {
    const home = tempHome();
    const steps = preparePythonInstall(
      home,
      blender,
      { PATH: '/bin', UV_INDEX_URL: 'x', PIP_INDEX_URL: 'y', PYTHONPATH: 'z', VIRTUAL_ENV: 'v' },
      'linux',
    );
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect(step.command).toBe('uv');
      expect(step.args[0]).toBe('--no-config');
      expect(step.env).toEqual({ PATH: '/bin' });
    }
    expect(steps[0]!.args).toEqual(expect.arrayContaining(['venv', '--python', '>=3.10']));
    expect(steps[1]!.args).toEqual(
      expect.arrayContaining(['--require-hashes', '--only-binary', ':all:', '--no-deps']),
    );
    expect(steps[1]!.args).toEqual(
      expect.arrayContaining(['--default-index', 'https://pypi.org/simple']),
    );
    expect(steps[2]!.args).toEqual(
      expect.arrayContaining([
        '--require-hashes',
        '--no-deps',
        '--no-build-isolation',
        '--no-index',
      ]),
    );
    const dir = pinnedPythonDir(home, 'blender');
    expect(readFileSync(join(dir, 'requirements.txt'), 'utf8')).toBe(blender.requirements);
    expect(readFileSync(join(dir, 'server.txt'), 'utf8')).toBe(
      `blender-mcp @ ${blender.archive}#subdirectory=mcp --hash=sha256:${blender.archiveSha256}\n`,
    );
    expect(steps[1]!.args).toContain(pinnedPythonExe(home, blender, 'linux'));
    expect(pinnedPythonExe('/h', blender, 'win32')).toMatch(/Scripts[\\/]python\.exe$/);
  });

  it('installs, starts from the Python of the environment and does not install again', async () => {
    const home = tempHome();
    const log: string[][] = [];
    const signal = new AbortController().signal;
    await installPinnedPython(home, blender, {}, fakeUv(home, blender.archiveSha256, log), signal);
    expect(log).toHaveLength(3);
    expect(pinnedPythonInstalled(home, blender)).toBe(true);
    const exe = pinnedPythonExe(home, blender);
    expect(exe).toContain(join('mcp-packages', 'blender', 'venv'));
    expect(existsSync(exe)).toBe(true);
    expect(pinnedPythonArgs(blender)).toEqual(['-I', '-c', 'import blmcp; blmcp.main()']);
    await installPinnedPython(home, blender, {}, fakeUv(home, blender.archiveSha256, log), signal);
    expect(log).toHaveLength(3);
  });

  it('refuses an archive that is not the pinned one and leaves nothing installed', async () => {
    const home = tempHome();
    const log: string[][] = [];
    const signal = new AbortController().signal;
    await expect(
      installPinnedPython(home, blender, {}, fakeUv(home, 'a'.repeat(64), log), signal),
    ).rejects.toThrow(/installazione di blender-mcp non riuscita \(uv 2\).*Hash mismatch/);
    expect(pinnedPythonInstalled(home, blender)).toBe(false);
    // The next start tries again from scratch.
    await installPinnedPython(home, blender, {}, fakeUv(home, blender.archiveSha256, log), signal);
    expect(pinnedPythonInstalled(home, blender)).toBe(true);
  });

  it('without uv: says what to install', async () => {
    const home = tempHome();
    const missing = () => spawn('/percorso-che-non-esiste-xyz/uv', []);
    await expect(
      installPinnedPython(home, blender, {}, missing, new AbortController().signal),
    ).rejects.toThrow(/serve uv: installalo da https:\/\/docs\.astral\.sh/);
    expect(pinnedPythonInstalled(home, blender)).toBe(false);
  });

  it('a new version of the server or of the requirements installs again', async () => {
    const home = tempHome();
    const log: string[][] = [];
    const signal = new AbortController().signal;
    await installPinnedPython(home, blender, {}, fakeUv(home, blender.archiveSha256, log), signal);
    const other = { ...blender, requirements: `${blender.requirements}\n` };
    expect(pinnedPythonInstalled(home, other)).toBe(false);
    expect(pinnedPythonInstalled(home, { ...blender, archiveSha256: 'b'.repeat(64) })).toBe(false);
  });

  it('the manager starts a setting with the gallery line from the Python of the environment', () => {
    const home = tempHome();
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const manager = new McpManager({
      home,
      secretsDir: join(home, 'secrets'),
      servers: {},
      log: new EventLog(db),
      runs: { onKill: () => () => {} } as unknown as RunController,
      team: {} as TeamService,
      state: {} as StateStore,
      env: { PATH: '/usr/bin', HOME: '/home/u' },
    });
    const launchOf = (setting: object) =>
      manager.launchOf({
        name: 'blender',
        setting: { transport: 'stdio', enabled: true, agents: [], ...setting },
      } as unknown as Parameters<McpManager['launchOf']>[0]) as {
        command: string;
        args: string[];
      };
    // Saved by an older version, with the gallery line: it migrates by itself.
    const old = launchOf({ ...gallerySetting, args: (entry.args ?? []).slice(2) });
    expect(old.command).toBe(pinnedPythonExe(home, blender));
    expect(old.args).toEqual(pinnedPythonArgs(blender));
    expect(launchOf(gallerySetting).command).toBe(old.command);
    // Edited by the user: it keeps its own command.
    const edited = launchOf({ ...gallerySetting, args: [...gallerySetting.args, '--verbose'] });
    expect(edited.command).toBe('uvx');
    expect(edited.args).toContain('--verbose');
  });
});
