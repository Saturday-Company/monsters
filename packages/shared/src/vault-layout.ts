import { z } from 'zod';

/*
 * The names Monsters gives to what it keeps on disk (D-154): the folders and notes of a vault
 * (`Agenti/`, `profilo.md`, `Privato/`…) and the default folders next to it (`~/Monsters
 * Note`). Every vault made before D-154 has the Italian names, and keeps them forever: nothing
 * is ever renamed. A vault takes its layout once, when it is created (from the app's language
 * at that moment), and records it in `.monsters/vault.json`; a vault without the record is
 * recognized from what it has (`detectVaultLayout` in `@monsters/vault`). The layout is not the
 * app's language: an Italian vault stays Italian with the app in English, and the other way.
 *
 * The code that guards the notes (permissions, private folder, profile, memories) takes the
 * layout of its vault (`VaultService.layout`); the texts that only name a path (prompts, hints,
 * the UI) read `vaultLayout()`, the layout of the vault in use, which the core and the UI set.
 */

export const VAULT_LAYOUT_IDS = ['it', 'en'] as const;
export const VaultLayoutIdSchema = z.enum(VAULT_LAYOUT_IDS);
export type VaultLayoutId = z.infer<typeof VaultLayoutIdSchema>;

export function isVaultLayoutId(value: unknown): value is VaultLayoutId {
  return value === 'it' || value === 'en';
}

export interface VaultLayout {
  readonly id: VaultLayoutId;
  /** Quick capture; the agents without an area of their own write here. */
  readonly inbox: string;
  /** One note per day (`YYYY-MM-DD`). */
  readonly daily: string;
  /** The section of a daily note the agents append to (`## Agenti`). */
  readonly dailyAgentsSection: string;
  /** Active projects; the projects' areas go here (`Progetti/<name>`). */
  readonly projects: string;
  readonly areas: string;
  readonly resources: string;
  readonly people: string;
  readonly archive: string;
  /** One folder per agent (`Agenti/<Name>/`), with its memory and state. */
  readonly agents: string;
  /** The templates of the new notes. */
  readonly templates: string;
  /** Images and PDFs (Obsidian's attachment folder). */
  readonly attachments: string;
  /** Notes only the user and the orchestrator see. */
  readonly private: string;
  /** The user's profile, at the root of the notes. */
  readonly profile: string;
  /** Tag of the profile note. */
  readonly profileTag: string;
  /** The note that explains the vault, at the root. */
  readonly readme: string;
  /** An agent's memory index, in its folder. */
  readonly memory: string;
  /** An agent's state of the work, in its folder. */
  readonly state: string;
  /** The folder of the files of Monsters (D-075), and its name when the user has one of their own. */
  readonly files: string;
  readonly filesAlt: string;
  /** Default areas of the archetypes (Rhea, Dione). */
  readonly research: string;
  readonly drafts: string;
  /** Suffix of an agent's memory folder while it is renamed (`Agenti/Rhea (rinomina)`). */
  readonly renaming: string;
  /** Default folders next to the data directory (`~/Monsters Note`, `~/Monsters Progetti`). */
  readonly notesDir: string;
  readonly projectsDir: string;
  /** The folder of a new project whose name leaves nothing usable (`~/Monsters Progetti/Progetto`). */
  readonly untitledProject: string;
}

// The names are data, not copy: they are on disk and never change (D-154).
const it: VaultLayout = {
  id: 'it',
  inbox: 'Inbox',
  daily: 'Diario',
  dailyAgentsSection: 'Agenti',
  projects: 'Progetti',
  areas: 'Aree',
  resources: 'Risorse',
  people: 'Persone',
  archive: 'Archivio',
  agents: 'Agenti',
  templates: 'Modelli',
  attachments: 'Allegati',
  private: 'Privato',
  profile: 'profilo.md',
  profileTag: 'profilo',
  readme: 'LEGGIMI.md',
  memory: 'MEMORY.md',
  state: 'stato.md',
  files: 'File',
  filesAlt: 'File di Monsters',
  research: 'Risorse/Ricerche',
  drafts: 'Inbox/Bozze',
  renaming: 'rinomina',
  notesDir: 'Monsters Note',
  projectsDir: 'Monsters Progetti',
  untitledProject: 'Progetto',
};

const en: VaultLayout = {
  id: 'en',
  inbox: 'Inbox',
  daily: 'Journal',
  dailyAgentsSection: 'Agents',
  projects: 'Projects',
  areas: 'Areas',
  resources: 'Resources',
  people: 'People',
  archive: 'Archive',
  agents: 'Agents',
  templates: 'Templates',
  attachments: 'Attachments',
  private: 'Private',
  profile: 'profile.md',
  profileTag: 'profile',
  readme: 'README.md',
  memory: 'MEMORY.md',
  state: 'state.md',
  files: 'Files',
  filesAlt: 'Monsters Files',
  research: 'Resources/Research',
  drafts: 'Inbox/Drafts',
  renaming: 'renaming',
  notesDir: 'Monsters Notes',
  projectsDir: 'Monsters Projects',
  untitledProject: 'Project',
};

export const VAULT_LAYOUTS: Readonly<Record<VaultLayoutId, VaultLayout>> = { it, en };

/** Name of the notes folder before 16/10 (`~/Monsters Vault`): kept wherever it exists. */
export const LEGACY_NOTES_DIR_NAME = 'Monsters Vault';

/** Hidden file of a vault that records its layout (`{ "layout": "en" }`), relative to the vault. */
export const VAULT_LAYOUT_RECORD = '.monsters/vault.json';

/** The layout of a vault id; anything else is the Italian one (every vault made before D-154). */
export function vaultLayoutOf(id: unknown): VaultLayout {
  return isVaultLayoutId(id) ? VAULT_LAYOUTS[id] : VAULT_LAYOUTS.it;
}

let current: VaultLayout = VAULT_LAYOUTS.it;

/**
 * The layout of the vault in use, for texts that name a path (prompts, hints, the UI). The
 * core sets it when it opens its vault, the UI when the core says it; until then the Italian
 * one, the layout of every vault made before D-154.
 */
export function vaultLayout(): VaultLayout {
  return current;
}

export function setVaultLayout(layout: VaultLayout | VaultLayoutId): void {
  current = typeof layout === 'string' ? vaultLayoutOf(layout) : layout;
}

/** `Agenti/<name>` in a layout: an agent's own area of the notes. */
export function agentFolder(layout: VaultLayout, name: string): string {
  return `${layout.agents}/${name}`;
}

/** `Agenti/<name>/MEMORY.md` in a layout. */
export function agentMemoryPath(layout: VaultLayout, name: string): string {
  return `${layout.agents}/${name}/${layout.memory}`;
}

/** An agent's memory index (`Agenti/<Name>/MEMORY.md`), in the vault in use by default. */
export function isAgentMemoryPath(path: string, layout: VaultLayout = vaultLayout()): boolean {
  const parts = path.split('/');
  return (
    parts.length === 3 &&
    parts[0] === layout.agents &&
    parts[1] !== '' &&
    parts[2] === layout.memory
  );
}

/**
 * The agent a path of an agent's own folder belongs to (`Agenti/Rhea/MEMORY.md` → `Rhea`), in
 * either layout's folder when `layout` is not given; null for any other path.
 */
export function agentOfPath(path: string, layout?: VaultLayout): string | null {
  const folders = layout ? [layout.agents] : VAULT_LAYOUT_IDS.map((l) => VAULT_LAYOUTS[l].agents);
  for (const folder of folders) {
    if (path.startsWith(`${folder}/`)) {
      const name = path.slice(folder.length + 1).split('/')[0] ?? '';
      if (name !== '') return name;
    }
  }
  return null;
}

/** The private folders of both layouts (`Privato`, `Private`). */
export const PRIVATE_FOLDERS: readonly string[] = VAULT_LAYOUT_IDS.map(
  (id) => VAULT_LAYOUTS[id].private,
);

/**
 * In the private folder of either layout (`Privato/`, `Private/`, any case: a disk that ignores
 * case opens `private/` as `Private/`), whatever the vault's layout (D-154). The guards of the
 * private notes take it for the readers that are not privileged (sub-agents, MCP clients, the
 * index without the private notes, the runs of a Telegram chat): a vault with traces of both
 * layouts, or whose record was rewritten, never loses the guard of either folder.
 */
export function inAnyPrivateFolder(path: string): boolean {
  const p = path.normalize('NFC').toLowerCase();
  return PRIVATE_FOLDERS.some((name) => {
    const folder = name.toLowerCase();
    return p === folder || p.startsWith(`${folder}/`);
  });
}
