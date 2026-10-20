import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import type {
  AgentPermissions,
  Channel,
  FolderGrant,
  PermissionsResponse,
  PermissionsUpdateRequest,
} from '@monsters/shared';
import { expandHome, mayBeInside, realPathOf } from '@monsters/tools';
import type { EventLog } from '../log/event-log.ts';
import { patchSettingsFile } from '../onboarding/settings-file.ts';
import type { HubSettings } from './settings.ts';
import { fullPermissions, type TeamService, type ToolPolicy } from './team-service.ts';

/*
 * Permissions after the onboarding (M2.1): the team's defaults and the
 * permissions of each agent, saved in `settings.json` and applied at once
 * (`TeamService.setPolicy`). Granted folders are checked here: they exist, they
 * are folders, they are not the vault (reachable only through `vault_*`) nor
 * the data folder of Monsters (secrets, database, agents).
 */

/** Folder of the agents' working folders, inside `MONSTERS_HOME`. */
export const WORKSPACES_DIR = 'workspaces';
/** Where `fs_delete` and overwrites keep the old files, inside `MONSTERS_HOME`. */
export const FILES_TRASH_DIR = join('trash', 'files');

export function workspacesDir(home: string): string {
  return join(home, WORKSPACES_DIR);
}

/** Working folder of an agent: cwd of its commands, home of the CLIs it installs. */
export function agentWorkspace(home: string, agentId: string): string {
  return join(workspacesDir(home), agentId);
}

export class PermissionsError extends Error {
  readonly code: 'invalid_folder' | 'unknown_agent';
  readonly path: string | undefined;
  constructor(code: PermissionsError['code'], message: string, path?: string) {
    super(message);
    this.name = 'PermissionsError';
    this.code = code;
    this.path = path;
  }
}

/** Variable the desktop app sets on the core it starts: where the app is installed. */
export const INSTALL_DIRS_ENV = 'MONSTERS_INSTALL_DIRS';

/**
 * The folders of the installed app (`resources` and the folder of the executable), which the
 * desktop app names to its core: `fs_*` never reaches them, or a monster with a folder that
 * holds them (the home, on Windows the per-user install) would rewrite the core that runs
 * outside the signed ASAR (review of 18/10, M9). Absolute paths only, separated by the path
 * delimiter (`:` or `;`).
 */
export function installFolders(env: NodeJS.ProcessEnv): string[] {
  const raw = env[INSTALL_DIRS_ENV];
  if (!raw) return [];
  return raw
    .split(delimiter)
    .map((p) => p.trim())
    .filter((p) => p !== '' && isAbsolute(p))
    .map((p) => resolve(p));
}

export interface ForbiddenFolder {
  path: string;
  /** Plain Italian, shown in the UI. */
  why: string;
}

/**
 * Checks and normalises granted folders (absolute, `~` expanded, duplicates
 * merged with write winning). Throws `invalid_folder` with a message for the UI.
 */
export async function checkFolders(
  folders: readonly FolderGrant[],
  forbidden: readonly ForbiddenFolder[],
): Promise<FolderGrant[]> {
  const out = new Map<string, FolderGrant>();
  for (const f of folders) {
    const raw = f.path.trim();
    const expanded = expandHome(raw);
    if (!isAbsolute(expanded)) {
      throw new PermissionsError(
        'invalid_folder',
        `Scrivi il percorso completo della cartella, per esempio ${join(homedir(), 'Documenti')}.`,
        raw,
      );
    }
    const path = resolve(expanded);
    let isDir: boolean;
    try {
      isDir = (await stat(path)).isDirectory();
    } catch {
      throw new PermissionsError('invalid_folder', `La cartella ${path} non esiste.`, raw);
    }
    if (!isDir) {
      throw new PermissionsError('invalid_folder', `${path} è un file, non una cartella.`, raw);
    }
    const real = await realPathOf(path);
    for (const x of forbidden) {
      const forbiddenReal = await realPathOf(x.path).catch(() => resolve(x.path));
      if (mayBeInside(forbiddenReal, real))
        throw new PermissionsError('invalid_folder', x.why, raw);
    }
    const prev = out.get(path);
    out.set(path, { path, write: f.write || (prev?.write ?? false) });
  }
  return [...out.values()];
}

export interface PermissionsServiceOptions {
  home: string;
  settings: HubSettings;
  team: TeamService;
  log: EventLog;
  vaultRoot: () => string;
  /** Where the desktop app is installed (`installFolders`): never granted. */
  installDirs?: readonly string[];
}

export class PermissionsService {
  readonly #o: PermissionsServiceOptions;
  /** Updates one at a time: each starts from what the previous one saved. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: PermissionsServiceOptions) {
    this.#o = options;
  }

  /** Folders that can never be granted: the vault and the data folder of Monsters. */
  forbiddenFolders(): ForbiddenFolder[] {
    return [
      {
        path: this.#o.vaultRoot(),
        why: 'È la cartella delle note: i mostri la usano già, con la cronologia e l’annulla. Scegli un’altra cartella.',
      },
      {
        path: this.#o.home,
        why: 'È la cartella dei dati di Monsters (chiavi, attività, mostri): non si può concedere.',
      },
      ...(this.#o.installDirs ?? []).map((path) => ({
        path,
        why: 'È la cartella dove è installato Monsters: non si può concedere.',
      })),
    ];
  }

  /** Checks folders for the onboarding (same rules as the settings). */
  checkFolders(folders: readonly FolderGrant[]): Promise<FolderGrant[]> {
    return checkFolders(folders, this.forbiddenFolders());
  }

  view(): PermissionsResponse {
    const { team, settings, home } = this.#o;
    return {
      defaults: fullPermissions(settings.permissions),
      agents: team.list().map((a) => ({
        id: a.config.id,
        name: a.config.name,
        color: a.config.color,
        isOrchestrator: a.config.kind === 'orchestrator',
        // What a project adds (its folder) shows on the project, not here (D-097).
        permissions: team.savedPermissionsFor(a.config.id),
        custom: team.hasOwnPermissions(a.config.id),
      })),
      home: homedir(),
      workspaces: workspacesDir(home),
      platform: process.platform,
    };
  }

  /**
   * Validates, saves in `settings.json`, applies to the team and logs the
   * change. Serialised: folder checks are asynchronous, and two updates that
   * read the same settings would otherwise undo each other.
   */
  update(req: PermissionsUpdateRequest, by: Channel): Promise<PermissionsResponse> {
    const next = this.#queue.then(() => this.#update(req, by));
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #update(req: PermissionsUpdateRequest, by: Channel): Promise<PermissionsResponse> {
    const { team, settings, home, log } = this.#o;
    for (const id of Object.keys(req.agents ?? {})) {
      if (!team.get(id) || team.get(id)?.config.id !== id) {
        throw new PermissionsError('unknown_agent', `unknown agent ${id}`);
      }
    }
    const normalise = async (p: AgentPermissions) => {
      const full = fullPermissions(p);
      return { ...full, folders: await this.checkFolders(full.folders) };
    };
    const current = settings.permissions;
    const defaults = req.defaults ? await normalise(req.defaults) : fullPermissions(current);
    const agents: Record<string, Required<AgentPermissions>> = {};
    for (const [id, p] of Object.entries(current.agents)) agents[id] = fullPermissions(p);
    const changed: { target: string; permissions: Required<AgentPermissions> | null }[] = [];
    if (req.defaults) changed.push({ target: 'defaults', permissions: defaults });
    for (const [id, p] of Object.entries(req.agents ?? {})) {
      if (p === null) {
        delete agents[id];
        changed.push({ target: id, permissions: null });
      } else {
        agents[id] = await normalise(p);
        changed.push({ target: id, permissions: agents[id] });
      }
    }
    const next: HubSettings['permissions'] = { ...defaults, agents };
    patchSettingsFile(home, { permissions: next });
    settings.permissions = next;
    team.setPolicy(next satisfies ToolPolicy);
    for (const c of changed) {
      log.append({
        agent: 'user',
        type: 'permissions',
        data: { target: c.target, permissions: c.permissions, by },
      });
    }
    return this.view();
  }
}
