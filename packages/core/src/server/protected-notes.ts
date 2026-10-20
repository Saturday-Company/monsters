import { posix } from 'node:path';
import { PROFILE_PATH } from '../onboarding/service.ts';

/*
 * Notes the CLI token may not write (review of ondate 3-4, n. 7). The token is a file every
 * process of the user can read, a monster with the terminal too: through the vault routes it
 * could write a monster's MEMORY.md without the mark of third-party text (getting past the
 * drafts of memory, A2), rewrite the user's profile, or reach the private notes. Only the user
 * in person (`AuthContext.owner`) writes them from the API; the monsters keep their own tools.
 */

/** A vault path as the vault would resolve it, lower case, for the comparison only. */
function normalVaultPath(raw: string): string {
  const slashes = raw.replace(/\\/g, '/').trim();
  const normal = posix.normalize(`/${slashes}`).replace(/^\/+/, '').replace(/\/+$/, '');
  return normal.normalize('NFC').toLowerCase();
}

/**
 * Vault tools whose target the input does not name (an undo by action id): with the token they
 * could put back a protected note as it was (a line of memory without its mark).
 */
export const TOKEN_CLOSED_VAULT_TOOLS: ReadonlySet<string> = new Set(['vault_undo']);

/** True for a monster's memory, the user's profile and the private folder. */
export function protectedNote(raw: string): boolean {
  const p = normalVaultPath(raw);
  // The vault takes a note's path with or without `.md`.
  const profile = PROFILE_PATH.toLowerCase();
  if (p === profile || `${p}.md` === profile) return true;
  if (p === 'privato' || p.startsWith('privato/')) return true;
  return /^agenti\/[^/]+\/memory(?:\.md)?$/.test(p) || p === 'agenti' || /^agenti\/[^/]+$/.test(p);
}

/**
 * The paths of a vault tool's input (`path`, `from`, `to`, `paths`): what the call may write,
 * move or delete. Strings only; anything else is the tool's own validation.
 */
export function inputPaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const i = input as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['path', 'from', 'to', 'old_path', 'new_path']) {
    if (typeof i[key] === 'string') out.push(i[key]);
  }
  if (Array.isArray(i['paths'])) {
    for (const p of i['paths']) if (typeof p === 'string') out.push(p);
  }
  return out;
}
