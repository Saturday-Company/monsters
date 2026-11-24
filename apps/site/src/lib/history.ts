/*
 * When a file of the repository was first committed and last changed, read from git at build time.
 * The guides' "Last updated" and the dates of the structured data and the sitemap come from here.
 * Without git, or without history (a tarball), every answer is null and the callers fall back.
 */
import { execFileSync } from 'node:child_process';
import { repoRoot } from './docs.ts';

export interface FileDates {
  /** ISO day of the first commit that has the file. */
  published: string;
  /** ISO day of the last commit that changed it. */
  modified: string;
}

const cache = new Map<string, FileDates | null>();

/** The dates of a file given by its path from the repository root, or null when git cannot tell. */
export function fileDates(path: string): FileDates | null {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  let result: FileDates | null = null;
  try {
    const out = execFileSync('git', ['log', '--format=%cI', '--', path], {
      cwd: repoRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    const first = out[out.length - 1];
    const last = out[0];
    if (first && last) result = { published: first.slice(0, 10), modified: last.slice(0, 10) };
  } catch {
    result = null;
  }
  cache.set(path, result);
  return result;
}
