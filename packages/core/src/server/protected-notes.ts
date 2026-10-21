import { posix } from 'node:path';
import { VAULT_LAYOUT_IDS, VAULT_LAYOUTS } from '@monsters/shared';

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

/**
 * True for a monster's memory, the user's profile and the private folder, with the names of
 * either layout (D-154: `profilo.md`, `Privato/`, `Agenti/<Name>/MEMORY.md` and `profile.md`,
 * `Private/`, `Agents/<Name>/MEMORY.md`): whatever the vault's, the token never writes them.
 */
export function protectedNote(raw: string): boolean {
  const p = normalVaultPath(raw);
  return VAULT_LAYOUT_IDS.some((id) => {
    const l = VAULT_LAYOUTS[id];
    // The vault takes a note's path with or without `.md`.
    const profile = l.profile.toLowerCase();
    if (p === profile || `${p}.md` === profile) return true;
    const priv = l.private.toLowerCase();
    if (p === priv || p.startsWith(`${priv}/`)) return true;
    const agents = l.agents.toLowerCase();
    const memory = l.memory.toLowerCase().replace(/\.md$/, '');
    if (p === agents) return true;
    const rest = p.startsWith(`${agents}/`) ? p.slice(agents.length + 1).split('/') : null;
    if (!rest) return false;
    // `Agenti/<Name>` itself (a move of the whole folder) and `Agenti/<Name>/MEMORY(.md)`.
    return (
      rest.length === 1 || (rest.length === 2 && (rest[1] === memory || rest[1] === `${memory}.md`))
    );
  });
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
