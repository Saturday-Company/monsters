import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childEnv,
  cleanTerminalText,
  createShellTool,
  elevationIn,
  OutputCapture,
  type ShellToolOptions,
} from '../src/index.ts';
import { tempDir, toolCtx, toolError } from './system-helpers.ts';

const POSIX = process.platform !== 'win32';

function shellTool(extra: Partial<ShellToolOptions> = {}) {
  const root = tempDir();
  const workspace = (id: string) => join(root, 'workspaces', id);
  const tool = createShellTool({ workspace, allowed: () => true, ...extra });
  return { tool, root, workspace };
}

// A test that pins the Italian family restores the English one.
afterEach(() => setAppLang('en'));

describe('OutputCapture', () => {
  it('keeps the beginning and the end and counts what it drops', () => {
    const c = new OutputCapture(100);
    for (let i = 0; i < 1000; i++) c.push(`${i}\n`);
    const text = c.text();
    expect(text.startsWith('0\n1\n2\n')).toBe(true);
    expect(text.endsWith('999\n')).toBe(true);
    expect(c.omitted).toBeGreaterThan(3000);
    expect(text).toContain(`[${c.omitted} characters omitted]`);
  });

  it('never splits a character made of two UTF-16 units (emoji)', () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    for (const max of [99, 100, 101, 102]) {
      // One buffer, many buffers, and a head that fills exactly at a chunk end.
      const one = new OutputCapture(max);
      one.push(Buffer.from('x' + '😀'.repeat(300)));
      const many = new OutputCapture(max);
      for (let i = 0; i < 300; i++) many.push('😀');
      const edge = new OutputCapture(max);
      edge.push('x'.repeat(Math.floor(max / 4) - 1) + '\ud83d');
      edge.push('\ude00' + 'y'.repeat(max));
      for (const c of [one, many, edge]) {
        const text = c.text();
        expect(lone.test(text), `${max}: ${text}`).toBe(false);
        expect(text).toContain('characters omitted');
      }
    }
  });

  it('decodes UTF-8 split across chunks and cleans terminal codes', () => {
    const c = new OutputCapture(1000);
    const bytes = Buffer.from('città \u001b[32mverde\u001b[0m\n10%\r50%\r100%\n');
    c.push(bytes.subarray(0, 4));
    c.push(bytes.subarray(4));
    expect(c.text()).toBe('città verde\n100%\n');
    expect(cleanTerminalText('a\r\nb')).toBe('a\nb');
  });
});

describe('elevationIn', () => {
  it('finds sudo and friends at command position only', () => {
    expect(elevationIn('sudo apt install jq')).toBe('sudo');
    expect(elevationIn('cd /tmp && sudo -n true')).toBe('sudo');
    expect(elevationIn('echo ok; su root')).toBe('su');
    expect(elevationIn('env FOO=1 doas ls')).toBe('doas');
    expect(elevationIn('Start-Process pwsh -Verb RunAs')).toBe('runas');
    expect(elevationIn('echo "vai su e giù"')).toBeNull();
    expect(elevationIn('npm install -g pseudo-sudo')).toBeNull();
    expect(elevationIn('grep sudoers notes.txt')).toBeNull();
  });
});

describe('childEnv', () => {
  it('drops the secrets of Monsters and puts the agent folders first in PATH', () => {
    const env = childEnv({
      workspace: '/w/rhea',
      platform: 'linux',
      base: {
        PATH: '/usr/bin',
        HOME: '/home/u',
        MONSTERS_HOME: '/home/u/.monsters',
        monsters_dev: '1',
        OPENROUTER_API_KEY: 'sk-or-v1-x',
        BRAVE_API_KEY: 'b',
        LEAKY: 'contains-the-known-secret',
      },
      isSecret: (_n, v) => v.includes('known-secret'),
    });
    expect(env['HOME']).toBe('/home/u');
    expect(env['MONSTERS_HOME']).toBeUndefined();
    expect(env['monsters_dev']).toBeUndefined();
    expect(env['OPENROUTER_API_KEY']).toBeUndefined();
    expect(env['BRAVE_API_KEY']).toBeUndefined();
    expect(env['LEAKY']).toBeUndefined();
    expect(env['PATH']).toBe('/w/rhea/bin:/w/rhea/.tools/bin:/usr/bin');
    expect(env['NPM_CONFIG_PREFIX']).toBe('/w/rhea/.tools');
    expect(env['UV_TOOL_BIN_DIR']).toBe('/w/rhea/.tools/bin');
  });

  it('drops the variables of the Claude Code or Codex session the core was started from', () => {
    const session = {
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 't',
      CLAUDE_CODE_BRIDGE_SESSION_ID: 'b',
      CLAUDE_PID: '1',
      CLAUDE_EFFORT: 'high',
      AI_AGENT: 'claude-code',
      CODEX_SANDBOX: 'seatbelt',
      CODEX_SANDBOX_NETWORK_DISABLED: '1',
      CODEX_THREAD_ID: 'thr',
    };
    const env = childEnv({
      workspace: '/w/rhea',
      platform: 'linux',
      base: { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'own', CODEX_HOME: '/h', ...session },
    });
    for (const name of Object.keys(session)) expect(env[name], name).toBeUndefined();
    // The user's own settings stay.
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('own');
    expect(env['CODEX_HOME']).toBe('/h');
  });

  it('keeps the spelling of Path on Windows and adds the npm prefix itself', () => {
    const env = childEnv({
      workspace: 'C:\\w\\rhea',
      platform: 'win32',
      base: { Path: 'C:\\Windows' },
    });
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(env['Path']!.split(';').at(-1)).toBe('C:\\Windows');
    expect(env['Path']!.split(';')).toEqual([
      'C:\\w\\rhea\\bin',
      'C:\\w\\rhea\\.tools\\bin',
      'C:\\w\\rhea\\.tools',
      'C:\\w\\rhea\\.tools\\Scripts',
      'C:\\Windows',
    ]);
    expect(env['NPM_CONFIG_PREFIX']).toBe('C:\\w\\rhea\\.tools');
  });
});

describe.skipIf(!POSIX)('shell', () => {
  it('returns exit code, stdout and stderr', async () => {
    const { tool } = shellTool();
    const out = await tool.execute(
      { command: 'echo ciao; echo attenzione >&2; exit 3' },
      toolCtx(),
    );
    expect(out).toMatchObject({
      exit_code: 3,
      timed_out: false,
      stdout: 'ciao\n',
      stderr: 'attenzione\n',
    });
    expect(out.truncated).toBeUndefined();
  });

  it('works in the agent folder by default and accepts a relative cwd', async () => {
    const { tool, workspace } = shellTool();
    const out = await tool.execute({ command: 'pwd' }, toolCtx('rhea'));
    expect(realpathSync(out.stdout.trim())).toBe(realpathSync(workspace('rhea')));
    expect(out.cwd).toBe(workspace('rhea'));
    mkdirSync(join(workspace('rhea'), 'progetto'));
    const sub = await tool.execute({ command: 'pwd', cwd: 'progetto' }, toolCtx('rhea'));
    expect(sub.stdout.trim()).toBe(join(workspace('rhea'), 'progetto'));
    const err = await toolError(tool.execute({ command: 'pwd', cwd: 'manca' }, toolCtx('rhea')));
    expect(err.code).toBe('NOT_FOUND');
  });

  it('stops a command at the timeout with its children and keeps the partial output', async () => {
    const { tool } = shellTool();
    const started = Date.now();
    const out = await tool.execute(
      { command: 'echo prima; sleep 30 & sleep 30; echo mai', timeout_s: 1 },
      toolCtx(),
    );
    expect(Date.now() - started).toBeLessThan(4000);
    expect(out).toMatchObject({ timed_out: true, exit_code: null, stdout: 'prima\n' });
    expect(out.note).toContain('Stopped after 1 s');
  });

  it('caps the output, keeping beginning and end', async () => {
    const { tool } = shellTool({ maxOutputChars: 2000 });
    const out = await tool.execute({ command: 'seq 1 100000' }, toolCtx());
    expect(out.truncated).toBe(true);
    expect(out.stdout.startsWith('1\n2\n3\n')).toBe(true);
    expect(out.stdout.trimEnd().endsWith('100000')).toBe(true);
    expect(out.stdout).toMatch(/characters omitted/);
    expect(out.stdout.length).toBeLessThan(2200);
    expect(out.note).toContain('Output too long');
  });

  it("tells project monsters that the project's ./bin is not on their PATH (toolsHome)", () => {
    const plain = shellTool().tool.description;
    expect(plain).toContain('put an executable in ./bin');
    const withHome = shellTool({ toolsHome: (id) => `/t/${id}` }).tool.description;
    expect(withHome).toContain('your own tools folder');
    expect(withHome).toContain('not on your PATH');
    expect(withHome).not.toContain('put an executable in ./bin');
  });

  it('gives the child no secret of Monsters and the agent CLI folders on PATH', async () => {
    const { tool, workspace } = shellTool({
      env: {
        ...process.env,
        MONSTERS_HOME: '/segreto/home',
        OPENROUTER_API_KEY: 'sk-or-v1-abcdefabcdefabcdef',
        COPIA: 'valore-segreto-123',
      },
      isSecret: (_n, v) => v === 'valore-segreto-123',
    });
    const out = await tool.execute({ command: 'env' }, toolCtx('dione'));
    expect(out.stdout).not.toContain('MONSTERS_HOME');
    expect(out.stdout).not.toContain('OPENROUTER_API_KEY');
    expect(out.stdout).not.toContain('valore-segreto-123');
    expect(out.stdout).toContain(`PATH=${join(workspace('dione'), 'bin')}:`);
    expect(out.stdout).toContain(`NPM_CONFIG_PREFIX=${join(workspace('dione'), '.tools')}`);
  });

  it.skipIf(!POSIX)(
    'in a project’s repo the CLIs stay the agent’s own: a bin/ of the repo is not on PATH (review 18/10, M4)',
    async () => {
      const repo = tempDir();
      mkdirSync(join(repo, 'bin'));
      writeFileSync(join(repo, 'bin', 'ls'), '#!/bin/sh\necho DIROTTATO\n', { mode: 0o755 });
      const own = tempDir();
      const tool = createShellTool({
        workspace: () => repo,
        toolsHome: () => own,
        allowed: () => true,
      });
      const out = await tool.execute({ command: 'ls; echo "$PATH"; env' }, toolCtx('dione'));
      expect(out.cwd).toBe(repo);
      expect(out.stdout).not.toContain('DIROTTATO');
      expect(out.stdout).toContain(`${join(own, 'bin')}:${join(own, '.tools', 'bin')}:`);
      expect(out.stdout).not.toContain(join(repo, 'bin'));
      expect(out.stdout).toContain(`NPM_CONFIG_PREFIX=${join(own, '.tools')}`);
      expect(out.stdout).not.toContain(join(repo, '.tools'));
    },
  );

  it('masks known secrets in the output given to the model', async () => {
    const { tool } = shellTool({ redact: (t) => t.replaceAll('sk-or-v1-000', '[REDACTED]') });
    const out = await tool.execute({ command: 'echo chiave=sk-or-v1-000' }, toolCtx());
    expect(out.stdout).toBe('chiave=[REDACTED]\n');
  });

  it('refuses without the permission, with a hint for the user', async () => {
    const { tool } = shellTool({ allowed: (id) => id === 'rhea' });
    const err = await toolError(tool.execute({ command: 'echo no' }, toolCtx('dione')));
    expect(err.code).toBe('SETTING_OFF');
    expect(err.hint).toContain('Settings → Permissions');
  });

  it('never runs sudo', async () => {
    const { tool } = shellTool();
    const err = await toolError(tool.execute({ command: 'sudo -n true' }, toolCtx()));
    expect(err.code).toBe('BLOCKED_BY_POLICY');
    expect(err.hint).toContain('npm -g');
  });

  it('keeps out of the data folder of Monsters, except the own folder (D-078)', async () => {
    setAppLang('it');
    const root = tempDir();
    const data = join(root, 'home');
    const workspace = (id: string) => join(data, 'workspaces', id);
    mkdirSync(join(data, 'secrets'), { recursive: true });
    const tool = createShellTool({
      workspace,
      allowed: () => true,
      lockout: (id) => ({ dataDir: data, allowed: [workspace(id)], home: root }),
    });
    for (const command of [
      'cat ../../secrets/keys.json',
      `ls ${join(data, 'agents')}`,
      'cd .. && ls',
    ]) {
      const err = await toolError(tool.execute({ command }, toolCtx()));
      expect(err.code, command).toBe('BLOCKED_BY_POLICY');
      expect(err.message).toBe(
        'I file interni di Monsters non sono accessibili: usa gli strumenti di Monsters.',
      );
    }
    const cwd = await toolError(tool.execute({ command: 'ls', cwd: data }, toolCtx()));
    expect(cwd.code).toBe('BLOCKED_BY_POLICY');
    const ok = (await tool.execute({ command: 'echo ciao > a.txt && cat a.txt' }, toolCtx())) as {
      stdout: string;
    };
    expect(ok.stdout.trim()).toBe('ciao');
  });

  it('says it in English, in the English family, when the data folder is reached (D-153)', async () => {
    const root = tempDir();
    const data = join(root, 'home');
    const workspace = (id: string) => join(data, 'workspaces', id);
    mkdirSync(join(data, 'secrets'), { recursive: true });
    const tool = createShellTool({
      workspace,
      allowed: () => true,
      lockout: (id) => ({ dataDir: data, allowed: [workspace(id)], home: root }),
    });
    const err = await toolError(
      tool.execute({ command: 'cat ../../secrets/keys.json' }, toolCtx()),
    );
    expect(err.message).toBe(
      'The internal files of Monsters aren’t accessible: use the Monsters tools.',
    );
  });

  it('does not wait for processes left in the background, and stops them', async () => {
    const { tool, workspace } = shellTool({ closeGraceMs: 200 });
    const started = Date.now();
    const out = await tool.execute(
      { command: 'sleep 30 & echo $! > bg.pid; echo fatto' },
      toolCtx('rhea'),
    );
    expect(out.stdout).toBe('fatto\n');
    expect(Date.now() - started).toBeLessThan(3000);
    const pid = Number(readFileSync(join(workspace('rhea'), 'bg.pid'), 'utf8'));
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('reports a missing shell as unavailable', async () => {
    const { tool } = shellTool({
      shell: { name: 'nessuna', command: '/non/esiste/sh', args: (c) => ['-c', c] },
    });
    const err = await toolError(tool.execute({ command: 'true' }, toolCtx()));
    expect(err.code).toBe('UNAVAILABLE');
  });

  it('creates the agent folder on first use', async () => {
    const { tool, workspace } = shellTool();
    expect(existsSync(workspace('mimas'))).toBe(false);
    await tool.execute({ command: 'true' }, toolCtx('mimas'));
    expect(existsSync(workspace('mimas'))).toBe(true);
  });
});
