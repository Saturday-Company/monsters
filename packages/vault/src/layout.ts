import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  VAULT_LAYOUT_IDS,
  VAULT_LAYOUT_RECORD,
  VAULT_LAYOUTS,
  isVaultLayoutId,
  type VaultLayoutId,
} from '@monsters/shared';

/*
 * The layout of a vault on disk (D-154): which names its folders and notes have. It is
 * decided once, when the vault is created, and recorded in `.monsters/vault.json` (hidden: no
 * index, no history, no vault tool reaches it). A vault without the record (every vault made
 * before D-154, or a folder of notes Monsters never used) is recognized from what it has.
 */

/**
 * The entries at the root that mark a layout: what Monsters makes there (the agents' folder,
 * the profile, the private folder). The Italian readme and templates folder count too; their
 * English names (`README.md`, `Templates/`) are in many folders of notes Monsters never used.
 */
function traces(id: VaultLayoutId): string[] {
  const l = VAULT_LAYOUTS[id];
  const names = [l.agents, l.private, l.profile, ...(id === 'it' ? [l.readme, l.templates] : [])];
  return names.map((n) => n.toLowerCase());
}

/** Names at the root of the vault, lower case (a disk that ignores case sees `agenti` as `Agenti`). */
function rootEntries(root: string): Set<string> | null {
  try {
    return new Set(readdirSync(root).map((n) => n.normalize('NFC').toLowerCase()));
  } catch {
    return null;
  }
}

/** The layouts the vault has a trace of, Italian first. */
function tracedLayouts(root: string): VaultLayoutId[] {
  const names = rootEntries(root);
  if (!names) return [];
  return VAULT_LAYOUT_IDS.filter((id) => traces(id).some((t) => names.has(t)));
}

/** The layout written in the vault's record, or null (missing, unreadable, unknown). */
export function readVaultLayoutRecord(root: string): VaultLayoutId | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, VAULT_LAYOUT_RECORD), 'utf8'));
    const layout = (parsed as { layout?: unknown } | null)?.layout;
    return isVaultLayoutId(layout) ? layout : null;
  } catch {
    return null;
  }
}

/** Writes the record of the vault's layout (`.monsters/vault.json`). */
export function writeVaultLayoutRecord(root: string, layout: VaultLayoutId): void {
  const file = join(root, VAULT_LAYOUT_RECORD);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ layout }, null, 2)}\n`);
}

/**
 * The layout of an existing vault: its record; without one, the layout it has traces of
 * (`Agenti/`, `profilo.md`, `Privato/`, `LEGGIMI.md`, `Modelli/` → Italian), the Italian one
 * when it has traces of both. Null when the vault has neither (a folder of notes Monsters
 * never used): the caller decides, as for a new vault. A record naming a layout the vault has
 * no trace of, while it has traces of the other, gives way to the other: an Italian vault is
 * never read as English because of its record alone (its `Privato/` would lose its guard).
 */
export function detectVaultLayout(root: string): VaultLayoutId | null {
  const record = readVaultLayoutRecord(root);
  const traced = tracedLayouts(root);
  if (record !== null) {
    return traced.length > 0 && !traced.includes(record) ? traced[0]! : record;
  }
  return traced[0] ?? null;
}
