import * as fs from 'node:fs';
import { join } from 'node:path';
import * as git from 'isomorphic-git';
import type { CommitInfo, CommitRequest, CommitResult, VaultVcs } from './vcs.ts';

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

  async ignoredPaths(paths: readonly string[]): Promise<string[]> {
    const head = await this.head();
    const out: string[] = [];
    for (const filepath of paths) {
      if (!(await git.isIgnored({ fs, dir: this.#dir, filepath }))) continue;
      // A file history already tracks is followed whatever the .gitignore says (as git does).
      if (head !== null && (await this.fileOid(head, filepath)) !== null) continue;
      out.push(filepath);
    }
    return out;
  }

  async commit(req: CommitRequest): Promise<CommitResult> {
    // A path the user's .gitignore excludes stays out of history (D-214); only what is left is added.
    const ignored = await this.ignoredPaths(req.paths);
    const paths = req.paths.filter((p) => !ignored.includes(p));
    if (paths.length === 0 && req.paths.length > 0) return { commit: null, ignored };
    for (const filepath of paths) {
      if (fs.existsSync(join(this.#dir, filepath))) {
        // `force` only matters for a tracked file the .gitignore also matches (isomorphic-git
        // would skip it silently): an ignored, untracked file never gets here.
        await git.add({ fs, dir: this.#dir, filepath, force: true });
      } else {
        try {
          await git.remove({ fs, dir: this.#dir, filepath });
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }
    }
    const commit = await git.commit({
      fs,
      dir: this.#dir,
      message: req.message,
      author: req.author,
      committer: req.author,
    });
    return { commit, ignored };
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
