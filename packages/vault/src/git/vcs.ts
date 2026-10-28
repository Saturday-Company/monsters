/*
 * Version control of the vault behind a small interface with two backends
 * (same scheme as obsidian-git): isomorphic-git (pure JS, the default: works
 * without git installed) and the system git (faster, optional).
 *
 * We always know which files an action touched, so commits stage only those
 * paths: no full `status` of the vault is ever needed.
 */

export interface GitAuthor {
  name: string;
  email: string;
}

export interface CommitInfo {
  oid: string;
  parents: string[];
  message: string;
  author: GitAuthor;
  /** Unix epoch in seconds. */
  timestamp: number;
}

export interface CommitRequest {
  /** Paths to record: existing files are staged, missing ones are removed. */
  paths: readonly string[];
  message: string;
  author: GitAuthor;
}

export interface CommitResult {
  /** The new commit, or null when nothing was recorded (every path is ignored). */
  commit: string | null;
  /**
   * Paths left out because the repository's own ignore rules exclude them and history does
   * not track them yet: Monsters never puts files the user chose to ignore into history (D-214).
   */
  ignored: string[];
}

export interface VaultVcs {
  readonly kind: 'isomorphic' | 'system';
  isRepo(): Promise<boolean>;
  init(): Promise<void>;
  /** Current commit, or null on an empty repository. */
  head(): Promise<string | null>;
  /** File content at a commit, or null when the file is not there. */
  readFile(commit: string, path: string): Promise<Uint8Array | null>;
  /** Blob id of a file at a commit, or null. */
  fileOid(commit: string, path: string): Promise<string | null>;
  /** The paths the repository's ignore rules exclude and history does not track (a tracked file is never ignored). */
  ignoredPaths(paths: readonly string[]): Promise<string[]>;
  /**
   * Records the paths of `req` in one commit. Paths the repository ignores (and does not
   * track) are skipped and reported in `ignored`; with nothing left no commit is created.
   */
  commit(req: CommitRequest): Promise<CommitResult>;
  /** Commits reachable from `ref` (default HEAD), newest first. */
  log(opts?: { ref?: string; depth?: number }): Promise<CommitInfo[]>;
  /** Paths changed by a commit compared to its first parent. */
  changedFiles(commit: string): Promise<string[]>;
}

export type VcsKind = 'isomorphic' | 'system' | 'auto';

export const TRAILER_ACTION = 'Monsters-Action';
export const TRAILER_AGENT = 'Monsters-Agent';

/** Reads `Key: value` trailers from a commit message. */
export function parseTrailers(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of message.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.+)$/.exec(line.trim());
    if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}
