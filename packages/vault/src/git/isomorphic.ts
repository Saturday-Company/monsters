import * as fs from 'node:fs';
import { join } from 'node:path';
import * as git from 'isomorphic-git';
import type { CommitInfo, CommitRequest, VaultVcs } from './vcs.ts';

function isNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown } | null;
  return e?.code === 'NotFoundError' || e?.name === 'NotFoundError' || e?.code === 'ENOENT';
}

/** Default backend: pure JavaScript, no git installation required. */
export class IsomorphicVcs implements VaultVcs {
  readonly kind = 'isomorphic' as const;
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  isRepo(): Promise<boolean> {
    return Promise.resolve(fs.existsSync(join(this.#dir, '.git')));
  }

  async init(): Promise<void> {
    await git.init({ fs, dir: this.#dir, defaultBranch: 'main' });
  }

  async head(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir: this.#dir, ref: 'HEAD' });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readFile(commit: string, path: string): Promise<Uint8Array | null> {
    try {
      const { blob } = await git.readBlob({ fs, dir: this.#dir, oid: commit, filepath: path });
      return blob;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async fileOid(commit: string, path: string): Promise<string | null> {
    try {
      const { oid } = await git.readBlob({ fs, dir: this.#dir, oid: commit, filepath: path });
      return oid;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async commit(req: CommitRequest): Promise<string> {
    for (const filepath of req.paths) {
      if (fs.existsSync(join(this.#dir, filepath))) {
        await git.add({ fs, dir: this.#dir, filepath });
      } else {
        try {
          await git.remove({ fs, dir: this.#dir, filepath });
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }
    }
    return git.commit({
      fs,
      dir: this.#dir,
      message: req.message,
      author: req.author,
      committer: req.author,
    });
  }

  async log(opts: { ref?: string; depth?: number } = {}): Promise<CommitInfo[]> {
    if ((await this.head()) === null) return [];
    const commits = await git.log({
      fs,
      dir: this.#dir,
      ref: opts.ref ?? 'HEAD',
      ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    });
    return commits.map((c) => ({
      oid: c.oid,
      parents: c.commit.parent,
      message: c.commit.message,
      author: { name: c.commit.author.name, email: c.commit.author.email },
      timestamp: c.commit.author.timestamp,
    }));
  }

  async changedFiles(commit: string): Promise<string[]> {
    const [c] = await git.log({ fs, dir: this.#dir, ref: commit, depth: 1, includeChanges: true });
    const changes = (c?.commit as { changes?: (string | null)[][] } | undefined)?.changes ?? [];
    return changes.map((ch) => ch[2]).filter((p): p is string => typeof p === 'string');
  }
}
