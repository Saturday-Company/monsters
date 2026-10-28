import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommitInfo, CommitRequest, VaultVcs } from './vcs.ts';

interface GitResult {
  stdout: Buffer;
  code: number;
  stderr: string;
}

function runGit(cwd: string, args: string[], env: Record<string, string> = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [
        '-c',
        'core.quotepath=off',
        '-c',
        'commit.gpgsign=false',
        // Byte-exact history on every OS (Git for Windows defaults to
        // autocrlf=true) and paths over 260 characters on Windows.
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.longpaths=true',
        ...args,
      ],
      {
        cwd,
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env },
      },
      (err, stdout, stderr) => {
        if (err && typeof (err as { code?: unknown }).code !== 'number') {
          reject(err instanceof Error ? err : new Error('git failed to start'));
          return;
        }
        const code = err ? Number((err as { code?: unknown }).code) : 0;
        resolve({ stdout, code, stderr: stderr.toString('utf8') });
      },
    );
  });
}

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<Buffer> {
  const r = await runGit(cwd, args, env);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed (${r.code}): ${r.stderr.trim()}`);
  return r.stdout;
}

/** True when a usable `git` is on the PATH. */
export async function systemGitAvailable(): Promise<boolean> {
  try {
    const r = await runGit(process.cwd(), ['--version']);
    return r.code === 0;
  } catch {
    return false;
  }
}

/** Optional backend using the git installed on the system (faster on large vaults). */
export class SystemVcs implements VaultVcs {
  readonly kind = 'system' as const;
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  isRepo(): Promise<boolean> {
    return Promise.resolve(existsSync(join(this.#dir, '.git')));
  }

  async init(): Promise<void> {
    await git(this.#dir, ['init', '-q', '-b', 'main']);
  }

  async head(): Promise<string | null> {
    const r = await runGit(this.#dir, ['rev-parse', '--verify', '-q', 'HEAD']);
    return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
  }

  async readFile(commit: string, path: string): Promise<Uint8Array | null> {
    const r = await runGit(this.#dir, ['cat-file', 'blob', `${commit}:${path}`]);
    return r.code === 0 ? new Uint8Array(r.stdout) : null;
  }

  async fileOid(commit: string, path: string): Promise<string | null> {
    const r = await runGit(this.#dir, ['rev-parse', '--verify', '-q', `${commit}:${path}`]);
    return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
  }

  async commit(req: CommitRequest): Promise<string> {
    const env = {
      GIT_AUTHOR_NAME: req.author.name,
      GIT_AUTHOR_EMAIL: req.author.email,
      GIT_COMMITTER_NAME: req.author.name,
      GIT_COMMITTER_EMAIL: req.author.email,
    };
    const paths = [...req.paths];
    if (paths.length > 0) {
      // Stage new/changed files; drop removed ones from the index.
      const present = paths.filter((p) => existsSync(join(this.#dir, p)));
      const missing = paths.filter((p) => !existsSync(join(this.#dir, p)));
      if (present.length > 0) await git(this.#dir, ['add', '--force', '--', ...present]);
      if (missing.length > 0) {
        await git(this.#dir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...missing]);
      }
    }
    // `--only` with pathspecs records exactly these paths, whatever else is staged.
    const tracked: string[] = [];
    for (const p of paths) {
      const inIndex = await runGit(this.#dir, ['ls-files', '--error-unmatch', '--', p]);
      const inHead = await runGit(this.#dir, ['cat-file', '-e', `HEAD:${p}`]);
      if (inIndex.code === 0 || inHead.code === 0) tracked.push(p);
    }
    const args = ['commit', '-q', '--no-verify', '--allow-empty', '-m', req.message];
    await git(this.#dir, tracked.length > 0 ? [...args, '--only', '--', ...tracked] : args, env);
    return (await git(this.#dir, ['rev-parse', 'HEAD'])).toString('utf8').trim();
  }

  async log(opts: { ref?: string; depth?: number } = {}): Promise<CommitInfo[]> {
    if ((await this.head()) === null) return [];
    const args = ['log', '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%B%x1e'];
    if (opts.depth !== undefined) args.push('-n', String(opts.depth));
    args.push(opts.ref ?? 'HEAD', '--');
    const out = (await git(this.#dir, args)).toString('utf8');
    return out
      .split('\x1e')
      .map((s) => s.replace(/^\n/, ''))
      .filter((s) => s.trim() !== '')
      .map((record) => {
        const [oid = '', parents = '', name = '', email = '', at = '0', ...rest] =
          record.split('\x00');
        return {
          oid,
          parents: parents.split(' ').filter(Boolean),
          message: rest.join('\x00'),
          author: { name, email },
          timestamp: Number(at),
        };
      });
  }

  async changedFiles(commit: string): Promise<string[]> {
    const out = await git(this.#dir, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      '--root',
      '-z',
      commit,
    ]);
    return out.toString('utf8').split('\x00').filter(Boolean);
  }
}
