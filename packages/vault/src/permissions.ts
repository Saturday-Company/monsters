import { ToolError } from '@monsters/shared';
import { PRIVATE_FOLDER } from './index-db/vault-index.ts';
import { isInside, isSystemPath, matchesAnyGlob } from './paths.ts';
import { currentVaultScope } from './scope.ts';

/** Inside the folders the current work may reach (`withVaultScope`, D-114); true without one. */
function inScope(path: string): boolean {
  const scope = currentVaultScope();
  return scope === undefined || scope.some((folder) => isInside(path, folder));
}

/** The refusal of a path out of the current scope, or null. */
function outOfScope(path: string): ToolError | null {
  const scope = currentVaultScope();
  if (scope === undefined || inScope(path)) return null;
  return new ToolError('BLOCKED_BY_POLICY', `${path} is not reachable in this chat`, {
    hint: `Other people take part in this chat: here you may use only the notes in ${scope.map((f) => `${f}/`).join(', ')}.`,
  });
}

/*
 * Vault permissions per agent (research/04 §6.3). They keep order without
 * blocking work: everything is reversible and logged, and a denied write
 * suggests `vault_propose`.
 */

export interface AgentVaultProfile {
  /** Display name: the agent's own area is `Agenti/<name>/`. Default: the id, capitalized. */
  name?: string;
  /** Extra globs the agent may create and edit (e.g. `Progetti/Social/**`). */
  write?: string[];
  /** Extra globs the agent may delete and move. */
  delete?: string[];
}

export interface VaultPermissionsConfig {
  /** Agent id of the orchestrator: full access, like the user. */
  orchestrator?: string;
  agents?: Record<string, AgentVaultProfile>;
  /**
   * Profile of the external AI clients of the MCP server (actor ids starting
   * with `mcp-`): the same rules as a sub-agent. Default area `Agenti/MCP/`.
   */
  external?: AgentVaultProfile;
}

/** Actor ids of external MCP clients start with this (e.g. `mcp-claude-ai`). */
export const EXTERNAL_ACTOR_PREFIX = 'mcp-';
const EXTERNAL_AREA_NAME = 'MCP';

export function isExternalActor(agent: string): boolean {
  return agent.startsWith(EXTERNAL_ACTOR_PREFIX);
}

export interface WriteCheck {
  /** The change only appends to the "## Agenti" section of a daily note. */
  dailyAgentsAppend?: boolean;
  /** The file does not exist yet. */
  isNew?: boolean;
}

export const AGENTS_FOLDER = 'Agenti';
export const INBOX_FOLDER = 'Inbox';
export const DAILY_FOLDER = 'Diario';
export const DAILY_AGENTS_SECTION = 'Agenti';

/** Actors with full access besides the orchestrator. */
const PRIVILEGED = new Set(['user', 'system']);

const PROPOSE_HINT =
  'Use vault_propose to suggest this change: it creates a proposal in Inbox/ that the orchestrator can apply.';

export function capitalize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Longest actor name inside a note name ("Proposta di <name> - …"). */
export const MAX_ACTOR_NAME_LENGTH = 40;
/** Characters a note name cannot hold (Obsidian, Windows) and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[#|^:[\]?*"<>\u0000-\u001f\u007f]|%%/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * A name made safe as part of a file name: slashes become dashes (no folders),
 * forbidden and control characters go, no leading dot, no final dot or space,
 * at most {@link MAX_ACTOR_NAME_LENGTH} characters. Empty or reserved by
 * Windows → null.
 */
export function fileNamePart(name: string): string | null {
  const out = name
    .replace(/[/\\]/g, '-')
    .replace(UNSAFE_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, MAX_ACTOR_NAME_LENGTH)
    .replace(/[.\s]+$/, '');
  return out === '' || WINDOWS_RESERVED.test(out) ? null : out;
}

export class VaultPermissions {
  readonly #config: VaultPermissionsConfig;

  constructor(config: VaultPermissionsConfig = {}) {
    this.#config = config;
  }

  /** The configuration (to rebuild it with another team). */
  get config(): VaultPermissionsConfig {
    return this.#config;
  }

  isPrivileged(agent: string): boolean {
    if (isExternalActor(agent)) return false;
    return PRIVILEGED.has(agent) || agent === this.#config.orchestrator;
  }

  #profile(agent: string): AgentVaultProfile | undefined {
    if (isExternalActor(agent)) {
      return { name: EXTERNAL_AREA_NAME, ...this.#config.external };
    }
    return this.#config.agents?.[agent];
  }

  /**
   * Readable name of an actor, for note names: the agent's display name, or
   * the MCP client in words (`mcp-claude-code` → "Claude Code (MCP)"). Made
   * safe for the file system (`fileNamePart`): "AC/DC" never becomes a folder.
   */
  displayName(agent: string): string {
    if (isExternalActor(agent)) {
      const words = agent
        .slice(EXTERNAL_ACTOR_PREFIX.length)
        .split('-')
        .filter((w) => w.length > 0)
        .map(capitalize);
      return `${fileNamePart(words.join(' ')) ?? 'Client'} (MCP)`;
    }
    const name = this.#profile(agent)?.name;
    return (
      (name !== undefined ? fileNamePart(name) : null) ??
      fileNamePart(capitalize(agent)) ??
      'Agente'
    );
  }

  /** `Agenti/<Name>` for an agent. */
  areaOf(agent: string): string {
    return `${AGENTS_FOLDER}/${this.#profile(agent)?.name ?? capitalize(agent)}`;
  }

  /** Folders and globs where an agent may create and edit notes, for hints. */
  writableAreas(agent: string): string[] {
    const extra = this.#profile(agent)?.write ?? [];
    return [
      `${this.areaOf(agent)}/`,
      `${INBOX_FOLDER}/`,
      ...extra.map((g) => g.replace(/\/\*\*$/, '/')),
    ];
  }

  canRead(agent: string, path: string, isPrivate: boolean): boolean {
    if (isSystemPath(path) || !inScope(path)) return false;
    if (this.isPrivileged(agent)) return true;
    return !isPrivate && !isInside(path, PRIVATE_FOLDER);
  }

  assertRead(agent: string, path: string, isPrivate: boolean): void {
    const out = outOfScope(path);
    if (out) throw out;
    if (!this.canRead(agent, path, isPrivate)) {
      throw new ToolError('BLOCKED_BY_POLICY', `${path} is private`, {
        hint: 'Private notes are readable only by the user and the orchestrator.',
      });
    }
  }

  /**
   * Create/edit. `author` is the `author` property of the existing note (null
   * for new files or notes without author). In `Inbox/` a sub-agent creates
   * new notes and edits only its own (`author` = itself): notes of the user and
   * of other agents (proposals included) are not its to change.
   */
  canWrite(agent: string, path: string, author: string | null, opts: WriteCheck = {}): boolean {
    if (isSystemPath(path) || !inScope(path)) return false;
    if (this.isPrivileged(agent)) return true;
    if (isInside(path, this.areaOf(agent))) return true;
    if (isInside(path, INBOX_FOLDER) && (opts.isNew || author === agent)) return true;
    if (author === agent) return true;
    if (opts.dailyAgentsAppend && isInside(path, DAILY_FOLDER)) return true;
    return matchesAnyGlob(path, this.#profile(agent)?.write ?? []);
  }

  assertWrite(agent: string, path: string, author: string | null, opts: WriteCheck = {}): void {
    if (isSystemPath(path)) {
      throw new ToolError(
        'BLOCKED_BY_POLICY',
        `${path}: .obsidian, .git and .trash are managed by the system`,
      );
    }
    const out = outOfScope(path);
    if (out) throw out;
    if (!this.canWrite(agent, path, author, opts)) {
      throw new ToolError('SETTING_OFF', `${agent} cannot write ${path}`, {
        hint: `${PROPOSE_HINT} You can write freely in ${this.areaOf(agent)}/, create new notes in ${INBOX_FOLDER}/ and edit your own notes there${this.#extraWritable(agent)}. The user can change the note areas of a monster.`,
      });
    }
  }

  #extraWritable(agent: string): string {
    const extra = (this.#profile(agent)?.write ?? []).map((g) => g.replace(/\/\*\*$/, '/'));
    return extra.length > 0 ? `, and in ${extra.join(', ')}` : '';
  }

  canDelete(agent: string, path: string, author: string | null): boolean {
    if (isSystemPath(path) || !inScope(path)) return false;
    if (this.isPrivileged(agent)) return true;
    if (isInside(path, this.areaOf(agent))) return true;
    if (isInside(path, INBOX_FOLDER) && author === agent) return true;
    return matchesAnyGlob(path, this.#profile(agent)?.delete ?? []);
  }

  assertDelete(agent: string, path: string, author: string | null): void {
    const out = outOfScope(path);
    if (out) throw out;
    if (!this.canDelete(agent, path, author)) {
      throw new ToolError('SETTING_OFF', `${agent} cannot delete or move ${path}`, {
        hint: `${PROPOSE_HINT} You can delete and move only inside ${this.areaOf(agent)}/ and your own notes in ${INBOX_FOLDER}/. The user can change the note areas of a monster.`,
      });
    }
  }

  assertMove(agent: string, from: string, to: string, author: string | null): void {
    this.assertDelete(agent, from, author);
    const out = outOfScope(to);
    if (out) throw out;
    if (this.isPrivileged(agent)) {
      if (isSystemPath(to))
        throw new ToolError('BLOCKED_BY_POLICY', `${to} is managed by the system`);
      return;
    }
    const inArea = isInside(to, this.areaOf(agent));
    const granted = matchesAnyGlob(to, this.#profile(agent)?.delete ?? []);
    if (!inArea && !granted) {
      throw new ToolError('SETTING_OFF', `${agent} cannot move notes to ${to}`, {
        hint: `${PROPOSE_HINT} Sub-agents move notes only inside ${this.areaOf(agent)}/. The user can change the note areas of a monster.`,
      });
    }
  }
}
