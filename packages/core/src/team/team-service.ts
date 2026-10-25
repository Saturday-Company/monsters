import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { monsterFor, ROSTER, type RosterName } from '@monsters/monster-kit';
import type { ModelRef } from '@monsters/providers';
import {
  CONFUSED_MIN_MS,
  EventInputSchema,
  STUCK_ACTIONS,
  agentMemoryPath,
  workChangeOf,
  workOfRun,
  isReservedActor,
  unmarkedMemoryLine,
  vaultLayout,
  type VaultLayout,
  type AgentPermissions,
  type AgentState,
  type AgentSummary,
  type AutoModels,
  type Channel,
  type LogEvent,
  type Project,
  type WorkChange,
} from '@monsters/shared';
import { FS_READ_TOOLS, FS_WRITE_TOOLS } from '@monsters/tools';
import type { VaultPermissionsConfig, VaultService } from '@monsters/vault';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import {
  ALL_VAULT_TOOLS,
  VAULT_READ_TOOLS,
  RETIRED_MODELS,
  WEB_TOOLS,
  dioneBlueprint,
  orchestratorBlueprint,
  replaceRetired,
  rheaBlueprint,
  type ArchetypeOptions,
} from '../agents/archetypes.ts';
import {
  AGENT_YAML,
  ModelRefSchema,
  loadAgentDefinition,
  type AgentDefinition,
} from '../agents/definition.ts';
import {
  parseInstructions,
  readFields,
  upgradeInstructions,
  type InstructionFields,
} from '../agents/instructions.ts';
import { writeAgentFolder } from '../agents/templates.ts';
import type { EventLog } from '../log/event-log.ts';
import { PROJECTS_DIR, ProjectStore } from '../projects/store.ts';
import {
  MAX_MEMORY_CHARS,
  MAX_REMEMBER_LINES,
  MEMORY_TAINT_MARK,
  memoryKey,
  memoryWindow,
  newMemoryLines,
  shouldRemember,
  type RememberFilter,
} from './memory.ts';
import { teamPrompts } from './team.prompts.ts';
import { teamStrings } from './team.strings.ts';

/*
 * The team (ARCHITECTURE §5.3): agents are folders in `MONSTERS_HOME/agents/<id>/`,
 * their long-term memory is `Agenti/<Name>/MEMORY.md` in the vault. The service
 * also keeps the runtime state of every agent (state + activity line for the
 * speech bubble), derived from the event log.
 */

/**
 * What the agents may do (settings `permissions`, granted at the onboarding,
 * editable in the settings): the team's defaults, `agents[id]` for one agent.
 */
export interface ToolPolicy extends AgentPermissions {
  agents?: Record<string, AgentPermissions>;
}

/** Every field present: missing `shell` means off, missing `folders` none. */
export function fullPermissions(p: AgentPermissions): Required<AgentPermissions> {
  return {
    vault: p.vault,
    web: p.web,
    shell: p.shell ?? false,
    folders: (p.folders ?? []).map((f) => ({ path: f.path, write: f.write })),
  };
}

const VAULT_WRITE = new Set(ALL_VAULT_TOOLS.filter((t) => !VAULT_READ_TOOLS.includes(t)));
const WEB = new Set(WEB_TOOLS);
const SHELL_TOOL = 'shell';
const FS_READ = new Set<string>(FS_READ_TOOLS);
const FS_WRITE = new Set<string>(FS_WRITE_TOOLS);
/** Write tools a free model gets: moving and deleting stay with the terminal or bigger models. */
const FS_WRITE_FREE = ['fs_write'];

/** The tools of `tools` allowed by the permissions (system tools included). */
export function allowedTools(tools: readonly string[], policy: AgentPermissions): string[] {
  const p = fullPermissions(policy);
  const canWriteFiles = p.folders.some((f) => f.write);
  return tools.filter(
    (t) =>
      (p.web || !WEB.has(t)) &&
      (p.vault || !VAULT_WRITE.has(t)) &&
      (p.shell || t !== SHELL_TOOL) &&
      (p.folders.length > 0 || !FS_READ.has(t)) &&
      (canWriteFiles || !FS_WRITE.has(t)),
  );
}

/**
 * Free (or router) models only: they get a smaller toolset (ARCHITECTURE §5.7),
 * so they are not confused by tools they rarely need.
 */
export function isFreeChain(models: readonly ModelRef[]): boolean {
  return models.every(
    (m) =>
      m.provider === 'openrouter' && (m.model.endsWith(':free') || m.model === 'openrouter/free'),
  );
}

/**
 * System tools follow the permissions, not agent.yaml: an agent gets `shell`
 * with the terminal, `fs_*` with granted folders (write tools only with a
 * writable one). Decided at runtime, so teams created earlier need no change.
 */
export function systemTools(policy: AgentPermissions, free: boolean): string[] {
  const p = fullPermissions(policy);
  const out: string[] = [];
  if (p.shell) out.push(SHELL_TOOL);
  if (p.folders.length > 0) out.push(...FS_READ_TOOLS);
  if (p.folders.some((f) => f.write)) out.push(...(free ? FS_WRITE_FREE : FS_WRITE_TOOLS));
  return out;
}

/**
 * The web follows the permission too (D-128), not agent.yaml: a monster whose
 * effective web permission is on (`permissionsFor`: its own or the team's,
 * and its project's `webSearch`) gets `web_search` and `web_fetch`, also when
 * its agent.yaml does not list them. Who removes them on purpose does it
 * after this (the orchestrator and the leads covered by their squad, D-026;
 * a free chain whose request surely needs no web, AG-07).
 */
export function webTools(policy: AgentPermissions): string[] {
  return fullPermissions(policy).web ? [...WEB_TOOLS] : [];
}

/**
 * The orchestrator searches the web only when nobody else in the team can
 * (DECISIONS D-026): with web tools at hand free models research by themselves
 * instead of delegating, even when the user names the researcher. Decided at
 * runtime from the loaded team, so it holds for teams created earlier too.
 * It keeps `web_fetch` (D-161): without it, "read this site" or the user's own
 * product page became "I can't open pages, send me a presentation".
 */
export function orchestratorTools(tools: readonly string[], teamHasWeb: boolean): string[] {
  const out = teamHasWeb ? tools.filter((t) => t !== 'web_search') : [...tools];
  // Proposing a monster (D-075) is the capo's, also for teams created before it.
  if (!out.includes(PROPOSE_TOOL)) out.push(PROPOSE_TOOL);
  return out;
}

/**
 * The preview pane (`preview_show`, D-075) follows the notes: every monster
 * that reads notes (`vault_read`) may show one, or a file, to the user. Decided
 * at runtime, so teams created earlier need no change.
 */
export function previewTools(tools: readonly string[]): string[] {
  return tools.includes('vault_read') ? [PREVIEW_TOOL] : [];
}

/** `preview_show` (the name only: the tool needs the vault and the files, see preview-show.ts). */
const PREVIEW_TOOL = 'preview_show';

/** `team_propose_monster` (the name only: the tool needs the team manager, see propose-monster.ts). */
const PROPOSE_TOOL = 'team_propose_monster';

/** The orchestrator's tools for the projects (D-097): given while a project is active. */
export const PROJECT_TOOLS = ['project_send', 'project_status'];

/**
 * Drafts of the capi (D-098): the orchestrator proposes projects and
 * automations, a lead automations of its project (names only: the tools need
 * the services, see projects/propose.ts and automations/propose.ts).
 */
export const ORCHESTRATOR_DRAFT_TOOLS = ['project_propose', 'automation_propose'];
export const LEAD_DRAFT_TOOLS = ['automation_propose'];

/**
 * `access_request` (D-130): the orchestrator and the leads ask the user for an access a
 * monster lacks (the name only: the tool needs the services, see access-requests.ts).
 */
export const ACCESS_REQUEST_TOOL = 'access_request';

/**
 * A change to CLAUDE.md or AGENTS.md of a project's folder (D-113): every
 * monster of an active project with a folder, and the orchestrator while one
 * exists (the name only: the tool needs the proposals, see projects/docs-proposals.ts).
 */
export const DOCS_PROPOSE_TOOL = 'project_docs_propose';

/** How `appendMemory` writes (D-065; review of 18/10, A2 for `mark` and `proposal`). */
export interface AppendMemoryOptions {
  runId?: string | null;
  parentId?: string | null;
  signal?: AbortSignal;
  filter?: RememberFilter;
  /** The lines carry third-party text: each ends with `MEMORY_TAINT_MARK`. */
  mark?: boolean;
  /** A draft of memory the user confirmed: the `remembered` event closes it. */
  proposal?: { id: string; by: Channel };
}

export interface BootstrapOptions {
  user: string;
  orchestratorName?: string;
  models?: ModelRef[];
  /** Force a concept variant; default is the official monster of each agent (`monsterFor`). */
  variant?: 'A' | 'B';
}

interface Runtime {
  /** Active work items (runs and delegations) of the agent. */
  work: Set<string>;
  /** Open blocking questions asked by the agent: by id, the run that asked (C-6). */
  waiting: Map<string, string | undefined>;
  /** Parked questions of the agent (D-078): it waits for the user with no run; by id, the question. */
  parked: Map<string, string>;
  /** State when nothing is active. */
  rest: AgentState;
  activity?: string | undefined;
  /**
   * Going round in circles (the instinct's `stuck_*`): since when. Kept at
   * least `CONFUSED_MIN_MS`, then the next tool or words end it (D-072).
   */
  confusedSince?: number | undefined;
}

/** Read whole: the prompt keeps the newest lines (`memoryWindow`), not the first ones. */
const READ_ALL = Number.MAX_SAFE_INTEGER;
const ACTIVITY_MAX = 80;

function clip(text: string, max = ACTIVITY_MAX): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function str(input: unknown, key: string): string | undefined {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

/** One line describing a tool call, for the speech bubble. */
export function describeToolCall(tool: string, input: unknown): string {
  const path = str(input, 'path');
  const t = teamStrings();
  switch (tool) {
    case 'web_search':
      return clip(t.webSearch(str(input, 'query') ?? ''));
    case 'web_fetch': {
      const url = str(input, 'url');
      let host = url ?? '';
      try {
        if (url) host = new URL(url).host;
      } catch {
        // keep the raw value
      }
      return clip(t.reads(host));
    }
    case 'vault_search':
      return clip(t.searchNotes(str(input, 'query') ?? ''));
    case 'vault_read':
      return clip(t.reads(path ?? t.aNote));
    case 'vault_write':
      return clip(t.writes(path ?? t.aNote));
    case 'vault_edit':
      return clip(t.edits(path ?? t.aNote));
    case 'vault_list':
      return t.looksAtNotes;
    case 'delegate':
      return clip(t.delegatesTo(str(input, 'agent') ?? t.anAgent));
    case 'shell':
      return clip(t.runs(str(input, 'command') ?? t.aCommand));
    case 'fs_read':
      return clip(t.reads(path ?? t.aFile));
    case 'fs_write':
      return clip(t.writes(path ?? t.aFile));
    case 'fs_list':
      return clip(t.looksAt(path ?? t.theFolders));
    case 'fs_move':
      return clip(t.moves(str(input, 'from') ?? t.aFile));
    case 'fs_delete':
      return clip(t.trashes(path ?? t.aFile));
    case 'ask_user':
      return clip(t.asks(str(input, 'question') ?? ''));
    case 'artifact_create':
      return clip(t.createsPage(str(input, 'title') ?? str(input, 'name') ?? ''));
    case 'team_propose_monster':
      return clip(t.proposesMonster(str(input, 'name') ?? ''));
    case 'preview_show': {
      // A file id says nothing to the user: the chip carries the file's name.
      const note = str(input, 'note');
      return clip(t.showsYou(note ?? (str(input, 'file') ? t.aFile : t.somethingToShow)));
    }
    default: {
      // External tools (M2.5): `mcp__<server>__<tool>`.
      const mcp = /^mcp__([a-z0-9-]+)__(.+)$/.exec(tool);
      if (mcp) {
        const [, server = '', name = ''] = mcp;
        const url = str(input, 'url');
        if (server === 'browser' && name === 'browser_navigate' && url) {
          return clip(t.opensInBrowser(url.replace(/^https?:\/\//, '')));
        }
        return clip(t.uses(server, name.replace(/_/g, ' ')));
      }
      return tool.replace(/_/g, ' ');
    }
  }
}

export class TeamService {
  readonly dir: string;
  readonly #log: EventLog;
  readonly #agents = new Map<string, AgentDefinition>();
  readonly #runtime = new Map<string, Runtime>();
  /** Text of the questions asked since this start, by id (the activity of a parked one). */
  readonly #asked = new Map<string, string>();
  /** Tools declared in each agent.yaml, before the policy. */
  readonly #declared = new Map<string, string[]>();
  #policy: ToolPolicy;
  #vault: VaultService | undefined;
  /** The vault's folder names (D-154), known before the vault opens (the team is bootstrapped first). */
  readonly #layout: VaultLayout | undefined;
  /** Memory writes of each agent, one at a time (parallel delegations to the same agent). */
  readonly #memoryWrites = new Map<string, Promise<unknown>>();
  /** "Utile anche nei prossimi lavori?" (the instinct, D-067); default: every line. */
  #rememberFilter: RememberFilter | undefined;
  /** Length of the MEMORY.md last reported `over_limit`, per agent: one event per change. */
  readonly #overLimit = new Map<string, number>();
  #unsubscribe: (() => void) | undefined;
  #haltedAtStart = false;

  /** The check of the memory lines before they are saved (the instinct, D-067). */
  setRememberFilter(filter: RememberFilter | undefined): void {
    this.#rememberFilter = filter;
  }

  /** `MONSTERS_HOME/projects` (D-097). */
  readonly #projects: ProjectStore;

  constructor(options: {
    dir: string;
    log: EventLog;
    halted?: boolean;
    policy?: ToolPolicy;
    /** Default: `projects/` next to the agents' folder. */
    projectsDir?: string;
    /** The layout of the vault the team will use (D-154). Default: the vault's, else the one in use. */
    layout?: VaultLayout;
  }) {
    this.dir = options.dir;
    this.#layout = options.layout;
    this.#log = options.log;
    this.#projects = new ProjectStore(
      options.projectsDir ?? join(dirname(options.dir), PROJECTS_DIR),
    );
    this.#policy = { vault: true, web: true };
    if (options.policy) this.setPolicy(options.policy);
    if (options.halted) this.#haltAll();
  }

  get policy(): ToolPolicy {
    return this.#policy;
  }

  /**
   * Effective permissions of an agent: its own, or the team's defaults. A
   * project's monster also gets its project's folder (read and write: it is
   * where it works, D-097), and the web only when the project allows it.
   */
  permissionsFor(agentId: string): Required<AgentPermissions> {
    const base = fullPermissions(this.#policy.agents?.[agentId] ?? this.#policy);
    const project = this.projectOf(agentId);
    if (!project) return base;
    const folders = base.folders.filter((f) => f.path !== project.folder);
    if (project.folder) folders.push({ path: project.folder, write: true });
    return { ...base, web: base.web && project.webSearch, folders };
  }

  /**
   * The permissions saved for an agent (Impostazioni → Permessi), without what
   * its project adds: saving them never grants a project's folder for good.
   */
  savedPermissionsFor(agentId: string): Required<AgentPermissions> {
    return fullPermissions(this.#policy.agents?.[agentId] ?? this.#policy);
  }

  /**
   * Why an agent has no web tool, for the card (D-132), or undefined when it has one: its web
   * permission is off, its project's web search is off, or its squad has researchers and it
   * delegates to them (D-026, `covered`).
   */
  webOff(agentId: string): 'permission' | 'project' | 'covered' | undefined {
    const def = this.#agents.get(agentId);
    if (!def || def.config.tools.includes('web_search')) return undefined;
    // Pages only (D-161): the search is covered by the squad, nothing is off.
    if (def.config.tools.includes('web_fetch')) return 'covered';
    if (!this.savedPermissionsFor(agentId).web) return 'permission';
    if (this.projectOf(agentId)?.webSearch === false) return 'project';
    return 'covered';
  }

  /** The agent has permissions of its own (not the team's defaults). */
  hasOwnPermissions(agentId: string): boolean {
    return this.#policy.agents?.[agentId] !== undefined;
  }

  /** Applies new permissions to every agent: the files stay as they are, the tools follow. */
  setPolicy(policy: ToolPolicy): void {
    this.#policy = {
      ...fullPermissions(policy),
      ...(policy.agents
        ? {
            agents: Object.fromEntries(
              Object.entries(policy.agents).map(([id, p]) => [id, fullPermissions(p)]),
            ),
          }
        : {}),
    };
    this.#applyPolicy();
  }

  /**
   * Tools of every agent: declared ones, minus the policy, plus what the
   * permissions give (web, terminal, files), minus the web for a covered
   * orchestrator or lead (its own squad decides, D-097).
   */
  #applyPolicy(): void {
    for (const def of this.#agents.values()) {
      const id = def.config.id;
      const declared = this.#declared.get(id) ?? def.config.tools;
      const permissions = this.permissionsFor(id);
      const tools = allowedTools(declared, permissions);
      for (const t of webTools(permissions)) {
        if (!tools.includes(t)) tools.push(t);
      }
      for (const t of systemTools(permissions, isFreeChain(def.config.models))) {
        if (!tools.includes(t)) tools.push(t);
      }
      for (const t of previewTools(tools)) {
        if (!tools.includes(t)) tools.push(t);
      }
      def.config = { ...def.config, tools };
    }
    // A researcher of the squad (web in its agent.yaml, "Fa ricerche sul web") with the web
    // permission covers the capo (D-026). Every monster with the permission has the web now
    // (D-128), but the capo still delegates research only to whoever does it for a living.
    const squadHasWeb = (project: string | undefined) =>
      this.members(project).some(
        (d) =>
          d.config.kind === 'subagent' &&
          (this.#declared.get(d.config.id) ?? []).some((t) => WEB.has(t)) &&
          d.config.tools.some((t) => WEB.has(t)),
      );
    const projects = this.activeProjects().length > 0;
    const folders = this.activeProjects().some((p) => p.folder !== undefined);
    for (const def of this.#agents.values()) {
      // CLAUDE.md and AGENTS.md of a project's folder: proposed, never written (D-113).
      const own = this.projectOf(def.config.id);
      if (
        def.config.kind === 'orchestrator'
          ? folders
          : own?.status === 'active' && own.folder !== undefined
      ) {
        if (!def.config.tools.includes(DOCS_PROPOSE_TOOL)) {
          def.config = { ...def.config, tools: [...def.config.tools, DOCS_PROPOSE_TOOL] };
        }
      }
      if (def.config.kind === 'orchestrator') {
        const tools = orchestratorTools(def.config.tools, squadHasWeb(undefined));
        // `project_send` and `project_status` while a project is active (D-097).
        if (projects) for (const t of PROJECT_TOOLS) if (!tools.includes(t)) tools.push(t);
        for (const t of ORCHESTRATOR_DRAFT_TOOLS) if (!tools.includes(t)) tools.push(t);
        if (!tools.includes(ACCESS_REQUEST_TOOL)) tools.push(ACCESS_REQUEST_TOOL);
        def.config = { ...def.config, tools };
      } else if (def.config.kind === 'lead') {
        // A lead coordinates its project as the orchestrator its squad (D-097).
        const project = this.projectOf(def.config.id)?.id;
        const tools = orchestratorTools(def.config.tools, squadHasWeb(project));
        for (const t of LEAD_DRAFT_TOOLS) if (!tools.includes(t)) tools.push(t);
        if (!tools.includes(ACCESS_REQUEST_TOOL)) tools.push(ACCESS_REQUEST_TOOL);
        def.config = { ...def.config, tools };
      }
    }
  }

  /** Loads the projects and every agent folder. Invalid ones are skipped and logged. */
  async load(): Promise<AgentDefinition[]> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.#agents.clear();
    this.#declared.clear();
    for (const bad of this.#projects.load()) {
      this.#log.append({
        agent: 'system',
        type: 'error',
        data: { code: 'project_invalid', message: `${bad.file}: ${bad.message}` },
      });
    }
    const entries = await readdir(this.dir, { withFileTypes: true });
    for (const e of entries
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const def = await loadAgentDefinition(join(this.dir, e.name));
        if (this.#agents.has(def.config.id)) throw new Error(`duplicate agent id ${def.config.id}`);
        if (isReservedActor(def.config.id)) throw new Error(`reserved agent id ${def.config.id}`);
        await this.#upgrade(def);
        this.#declared.set(def.config.id, def.config.tools);
        this.#agents.set(def.config.id, def);
      } catch (err) {
        this.#log.append({
          agent: 'system',
          type: 'error',
          data: { code: 'agent_invalid', message: (err as Error).message },
        });
      }
    }
    this.#applyPolicy();
    for (const id of this.#agents.keys()) this.#rt(id);
    return this.list();
  }

  /**
   * An AGENTS.md rendered by an older template and never edited by hand gets
   * the current template (D-065); one edited by hand stays as it is.
   */
  async #upgrade(def: AgentDefinition): Promise<void> {
    try {
      const next = await upgradeInstructions(def.dir!, def.config);
      if (next !== null) def.instructions = next;
    } catch (err) {
      this.#log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'agent_invalid',
          message: teamStrings().agentNotUpdated(def.config.name, (err as Error).message),
        },
      });
    }
  }

  /**
   * Creates the default team when there is no agent: the orchestrator (Titan
   * by default) plus Rhea and Dione (DECISIONS D-006), with the roster genomes.
   * Returns false when the team already exists.
   */
  async bootstrap(options: BootstrapOptions): Promise<boolean> {
    if (this.#agents.size > 0) return false;
    const orchestrator = options.orchestratorName ?? 'Titan';
    const layout = this.layout;
    const base: ArchetypeOptions = {
      user: options.user,
      orchestrator,
      layout,
      ...(options.models ? { models: options.models } : {}),
    };
    const genome = (name: RosterName) =>
      options.variant ? { ...ROSTER[name].variants[options.variant] } : { ...monsterFor(name) };
    const orchestratorGenome =
      orchestrator.toLowerCase() in ROSTER
        ? genome(orchestrator.toLowerCase() as RosterName)
        : genome('titan');
    const blueprints = [
      { ...orchestratorBlueprint({ ...base, name: orchestrator }), genome: orchestratorGenome },
      { ...rheaBlueprint(base), genome: genome('rhea') },
      { ...dioneBlueprint(base), genome: genome('dione') },
    ];
    const reserved = blueprints.find((bp) => isReservedActor(bp.id));
    if (reserved) {
      throw Object.assign(new Error(`the name ${reserved.name} is reserved: choose another one`), {
        code: 'invalid_name',
      });
    }
    for (const bp of blueprints) await writeAgentFolder(join(this.dir, bp.id), bp, { layout });
    await this.load();
    return true;
  }

  /** Every monster of every squad: the orchestrator first, then the leads, then by name. */
  list(): AgentDefinition[] {
    const rank = (a: AgentDefinition) =>
      a.config.kind === 'orchestrator' ? 0 : a.config.kind === 'lead' ? 1 : 2;
    return [...this.#agents.values()].sort(
      (a, b) => rank(a) - rank(b) || a.config.name.localeCompare(b.config.name),
    );
  }

  // --- projects (D-097) -----------------------------------------------------------

  /** The project store (ProjectService writes it). */
  get projectStore(): ProjectStore {
    return this.#projects;
  }

  /** Every project, archived ones too, oldest first. */
  projects(): Project[] {
    return this.#projects.list();
  }

  /** Projects in use: confirmed and not archived. */
  activeProjects(): Project[] {
    return this.projects().filter((p) => p.status === 'active' && p.archivedAt === undefined);
  }

  /** A project by id or name (case-insensitive). */
  project(idOrName: string): Project | undefined {
    const key = idOrName.trim().replace(/^@/, '').toLowerCase();
    return this.#projects.get(key) ?? this.projects().find((p) => p.name.toLowerCase() === key);
  }

  /**
   * The project of an agent: the one in its agent.yaml, when it exists and is
   * not archived. A monster whose project is gone works as one of the Squadra
   * personale (its folder and area are not granted any more).
   */
  projectOf(agentId: string): Project | undefined {
    const id = this.#agents.get(agentId)?.config.project;
    if (!id) return undefined;
    const p = this.#projects.get(id);
    return p && p.archivedAt === undefined ? p : undefined;
  }

  /**
   * The monsters of a squad: without `project` the Squadra personale (the
   * orchestrator and the monsters of no project), with it the project's
   * (its lead and its monsters).
   */
  members(project?: string): AgentDefinition[] {
    return this.list().filter((a) => this.projectOf(a.config.id)?.id === project);
  }

  /** The lead of a project, or undefined (a draft, an archived project). */
  lead(project: string): AgentDefinition | undefined {
    const p = this.#projects.get(project);
    if (!p || p.archivedAt !== undefined) return undefined;
    const named = p.lead ? this.#agents.get(p.lead) : undefined;
    if (named && named.config.kind === 'lead' && named.config.project === p.id) return named;
    return this.members(p.id).find((a) => a.config.kind === 'lead');
  }

  /** Where a project's monster works (shell, files, harness): its project's folder, if any. */
  workdirOf(agentId: string): string | undefined {
    return this.projectOf(agentId)?.folder;
  }

  /**
   * A connection assigned to the whole team (`*`): every monster, in every
   * project, unless the user turned it off for the project (D-164, before
   * D-097's choice by project). `kind`: an MCP server or a service through Claude.
   */
  wildcardAllows(agentId: string, kind: 'mcp' | 'claude', id: string): boolean {
    const project = this.projectOf(agentId);
    return !project?.connectionsOff[kind].includes(id);
  }

  /** By id or display name (case-insensitive). */
  get(idOrName: string): AgentDefinition | undefined {
    const key = idOrName.trim().replace(/^@/, '').toLowerCase();
    return this.#agents.get(key) ?? this.list().find((a) => a.config.name.toLowerCase() === key);
  }

  /** By id only (routes: `/api/team/agents/:id`). */
  byId(id: string): AgentDefinition | undefined {
    return this.#agents.get(id);
  }

  /** Fields the agent's AGENTS.md was rendered from (`blueprint.json`, or read back), or null. */
  async instructionFields(idOrName: string): Promise<InstructionFields | null> {
    const def = this.get(idOrName);
    if (!def) return null;
    return (
      (def.dir ? await readFields(def.dir) : null) ??
      parseInstructions(def.instructions, def.config)
    );
  }

  /** Tools written in the agent's agent.yaml, before permissions and policy. */
  declaredTools(id: string): string[] {
    return [...(this.#declared.get(id) ?? this.#agents.get(id)?.config.tools ?? [])];
  }

  /** Names of the agents with work in progress (a run, a delegation, a blocking question). */
  working(): string[] {
    return this.list()
      .filter((a) => ['working', 'waiting'].includes(this.state(a.config.id).state))
      .map((a) => a.config.name);
  }

  orchestrator(): AgentDefinition | undefined {
    return this.list().find((a) => a.config.kind === 'orchestrator');
  }

  /**
   * Replaces the fallback chain of an agent in its `agent.yaml` (the rest of
   * the file, comments included, stays as it is). Runs already started keep
   * their session; the next one uses the new chain.
   */
  async setModels(
    idOrName: string,
    models: (ModelRef & { tier?: 'light' | 'strong' | undefined })[],
    auto?: AutoModels,
  ): Promise<AgentDefinition> {
    const def = this.get(idOrName);
    if (!def?.dir) throw new Error(`unknown agent ${idOrName}`);
    const chain = z.array(ModelRefSchema).min(1).parse(models);
    const path = join(def.dir, AGENT_YAML);
    const doc = parseDocument(await readFile(path, 'utf8'));
    // The tier of each link stays (D-067, D-093): the instinct reads it at every request.
    doc.set(
      'models',
      doc.createNode(
        chain.map((m) => ({
          provider: m.provider,
          model: m.model,
          ...(m.tier ? { tier: m.tier } : {}),
        })),
      ),
    );
    if (auto) doc.set('autoModels', doc.createNode({ base: auto.base }));
    else doc.delete('autoModels');
    await writeFile(path, doc.toString(), 'utf8');
    const { autoModels: _old, ...rest } = def.config;
    def.config = { ...rest, models: chain, ...(auto ? { autoModels: { base: auto.base } } : {}) };
    // Free models get fewer system tools: the toolset follows the new chain.
    this.#applyPolicy();
    return def;
  }

  /**
   * A model gone upstream is replaced by its successor in the chain of every agent (D-165),
   * the tiers kept. Best effort: when `agent.yaml` cannot be written (read-only file, full disk,
   * a file locked by a sync tool) the chain is replaced in memory only, the run uses the new
   * model and the next start tries again; the core starts either way. One line in Activity
   * per replaced agent. Returns whether the chain changed.
   */
  async replaceRetiredModels(def: AgentDefinition): Promise<boolean> {
    const next = replaceRetired(def.config.models);
    if (!next) return false;
    const was = def.config.models.find((m) => RETIRED_MODELS[`${m.provider}/${m.model}`])!;
    const from = `${was.provider}/${was.model}`;
    const successor = RETIRED_MODELS[from]!;
    const to = `${successor.provider}/${successor.model}`;
    const name = def.config.name;
    try {
      if (!def.dir) throw new Error('no folder');
      await this.setModels(def.config.id, next, def.config.autoModels);
      // Done and saved: news for the user, not a failure (a notice, the leftover of C-11).
      this.#log.append({
        agent: 'system',
        type: 'notice',
        data: {
          code: 'retired_model',
          message: teamStrings().retiredModelReplaced(name, from, to),
        },
      });
    } catch (err) {
      def.config = { ...def.config, models: next };
      this.#applyPolicy();
      this.#log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'retired_model_unsaved',
          message: teamStrings().retiredModelNotSaved(name, from, to, (err as Error).message),
        },
      });
    }
    return true;
  }

  /**
   * Vault permissions derived from the team (orchestrator id, areas, extra
   * globs). A project's monsters also write in the project's area, and its
   * lead deletes and moves there too (D-097); none of them is privileged: they
   * read everything but the private folder (`Privato/`) and private notes, like every monster.
   */
  vaultPermissions(): VaultPermissionsConfig {
    const agents: NonNullable<VaultPermissionsConfig['agents']> = {};
    for (const a of this.#agents.values()) {
      if (a.config.kind === 'orchestrator') continue;
      const area = this.projectOf(a.config.id)?.vaultArea;
      const glob = area ? `${area}/**` : undefined;
      const write =
        glob && !a.config.vault.write.includes(glob)
          ? [...a.config.vault.write, glob]
          : a.config.vault.write;
      agents[a.config.id] = {
        name: a.config.name,
        write,
        ...(glob && a.config.kind === 'lead' ? { delete: [glob] } : {}),
      };
    }
    const orchestrator = this.orchestrator()?.config.id;
    return { ...(orchestrator ? { orchestrator } : {}), agents };
  }

  /** Connects the vault (memories) once it is open. */
  setVault(vault: VaultService): void {
    this.#vault = vault;
  }

  /** The names of the vault's folders and notes (D-154): its memories, its inbox, its profile. */
  get layout(): VaultLayout {
    return this.#vault?.layout ?? this.#layout ?? vaultLayout();
  }

  /** `Agenti/<Name>/MEMORY.md` (`Agents/<Name>/MEMORY.md` in an English vault). */
  memoryPath(agent: AgentDefinition): string {
    return agentMemoryPath(this.layout, agent.config.name);
  }

  /**
   * The agent's MEMORY.md from the vault as the prompt shows it, created when
   * missing; empty without a vault. Past `MAX_MEMORY_CHARS` the title and the
   * newest lines stay (the agents add at the end), and a `memory` `over_limit`
   * event says so (AG-05).
   */
  async memory(idOrName: string, signal?: AbortSignal): Promise<string> {
    const agent = this.get(idOrName);
    const vault = this.#vault;
    if (!agent || !vault) return '';
    const path = this.memoryPath(agent);
    const id = agent.config.id;
    try {
      const note = await vault.read({ agentId: 'system', signal }, { path, max_chars: READ_ALL });
      const content = note.content ?? '';
      const window = memoryWindow(content, MAX_MEMORY_CHARS);
      if (window.dropped > 0 && this.#overLimit.get(id) !== content.length) {
        this.#overLimit.set(id, content.length);
        this.#log.append({
          agent: id,
          type: 'memory',
          data: { action: 'over_limit', path, chars: content.length, dropped: window.dropped },
        });
      }
      return window.text;
    } catch (err) {
      if ((err as { code?: string }).code !== 'NOT_FOUND') {
        this.#logError(teamStrings().memoryUnreadable(agent.config.name, (err as Error).message));
        return '';
      }
    }
    const content = teamPrompts().memoryIndex(agent.config.name);
    try {
      await vault.write(
        {
          agentId: id,
          signal,
          emit: (e) =>
            this.#log.append(EventInputSchema.parse({ agent: id, type: e.type, data: e.data })),
        },
        { path, content, frontmatter: { type: 'memory' } },
      );
    } catch (err) {
      this.#logError(teamStrings().memoryNotCreated(agent.config.name, (err as Error).message));
    }
    return content;
  }

  /**
   * Appends lines to the agent's MEMORY.md in one write (D-065): lines already
   * there (same words, whatever the case and punctuation) are skipped, then
   * `filter` (the System 1 hook, `shouldRemember`) decides line by line, at
   * most `MAX_REMEMBER_LINES` per call. Writes of the same agent go one at a
   * time. Returns the lines added; errors are logged, never thrown.
   */
  async appendMemory(
    idOrName: string,
    lines: readonly string[],
    options: AppendMemoryOptions = {},
  ): Promise<string[]> {
    const agent = this.get(idOrName);
    if (!agent || !this.#vault || lines.length === 0) return [];
    const id = agent.config.id;
    const previous = this.#memoryWrites.get(id) ?? Promise.resolve();
    const write = previous.then(() => this.#appendMemory(agent, lines, options));
    const settled = write.catch(() => undefined);
    this.#memoryWrites.set(id, settled);
    void settled.finally(() => {
      if (this.#memoryWrites.get(id) === settled) this.#memoryWrites.delete(id);
    });
    return write;
  }

  /**
   * The lines of `lines` that `appendMemory` would add now (not there yet, kept
   * by `filter`), without writing: what a draft of memory proposes (review of
   * 18/10, A2). Errors are logged; the lines then pass as they are.
   */
  async newMemory(
    idOrName: string,
    lines: readonly string[],
    options: Omit<AppendMemoryOptions, 'mark' | 'proposal'> = {},
  ): Promise<string[]> {
    const agent = this.get(idOrName);
    if (!agent || !this.#vault || lines.length === 0) return [];
    let memory = '';
    try {
      const note = await this.#vault.read(
        { agentId: 'system' },
        { path: this.memoryPath(agent), max_chars: READ_ALL },
      );
      memory = note.content ?? '';
    } catch (err) {
      if ((err as { code?: string }).code !== 'NOT_FOUND') {
        this.#logError(teamStrings().memoryUnreadable(agent.config.name, (err as Error).message));
      }
    }
    const candidates = newMemoryLines(memory, lines, lines.length);
    const filter = options.filter ?? this.#rememberFilter ?? shouldRemember;
    const kept = new Set(
      await filter(candidates, {
        agent: agent.config.id,
        runId: options.runId ?? '',
        parentId: options.parentId ?? null,
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    );
    return candidates.filter((l) => kept.has(l)).slice(0, MAX_REMEMBER_LINES);
  }

  /**
   * «È mia» (review of the waves 3 and 4): the user says a marked line of the memory is theirs,
   * and the mark goes. Every marked line with the same words (`memoryKey`) loses it; the
   * runs that read the memory no longer start tainted for it. Returns the lines changed.
   */
  async ownMemoryLine(idOrName: string, line: string): Promise<number> {
    const agent = this.get(idOrName);
    const vault = this.#vault;
    if (!agent || !vault) return 0;
    const key = memoryKey(line);
    if (!key) return 0;
    const id = agent.config.id;
    const path = this.memoryPath(agent);
    const previous = this.#memoryWrites.get(id) ?? Promise.resolve();
    const write = previous.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const note = await vault.read({ agentId: 'system' }, { path, max_chars: READ_ALL });
        const content = note.content ?? '';
        const marked = [
          ...new Set(
            content
              .split('\n')
              .filter((l) => l.includes(MEMORY_TAINT_MARK) && memoryKey(l) === key),
          ),
        ];
        if (marked.length === 0) return 0;
        try {
          await vault.edit(
            {
              agentId: 'user',
              emit: (e) =>
                this.#log.append(
                  EventInputSchema.parse({ agent: 'user', type: e.type, data: e.data }),
                ),
            },
            {
              path,
              base_hash: note.hash,
              ops: marked.map((l) => ({ str_replace: { old: l, new: unmarkedMemoryLine(l) } })),
            },
          );
        } catch (err) {
          if ((err as { code?: string }).code === 'CONFLICT' && attempt === 0) continue;
          throw err;
        }
        this.#log.append({
          agent: id,
          type: 'memory',
          data: { action: 'owned', path, lines: marked.map(unmarkedMemoryLine), by: 'ui' },
        });
        return marked.length;
      }
    });
    const settled = write.catch(() => undefined);
    this.#memoryWrites.set(id, settled);
    void settled.finally(() => {
      if (this.#memoryWrites.get(id) === settled) this.#memoryWrites.delete(id);
    });
    return write;
  }

  async #appendMemory(
    agent: AgentDefinition,
    lines: readonly string[],
    options: AppendMemoryOptions,
  ): Promise<string[]> {
    const vault = this.#vault!;
    const id = agent.config.id;
    const path = this.memoryPath(agent);
    const runId = options.runId ?? null;
    const parentId = options.parentId ?? null;
    const actor = {
      agentId: id,
      signal: options.signal,
      emit: (e: { type: string; data: unknown }) =>
        this.#log.append(
          EventInputSchema.parse({ agent: id, runId, parentId, type: e.type, data: e.data }),
        ),
    };
    const filter = options.filter ?? this.#rememberFilter ?? shouldRemember;
    let filtered: string[] | undefined;
    try {
      for (let attempt = 0; ; attempt++) {
        let note;
        try {
          note = await vault.read({ agentId: 'system' }, { path, max_chars: READ_ALL });
        } catch (err) {
          if ((err as { code?: string }).code !== 'NOT_FOUND') throw err;
          await this.memory(id, options.signal);
          note = await vault.read({ agentId: 'system' }, { path, max_chars: READ_ALL });
        }
        const memory = note.content ?? '';
        const candidates = newMemoryLines(memory, lines, lines.length);
        // Only new lines reach the instinct, all in one call (D-067); asked once.
        filtered ??= await filter(candidates, {
          agent: id,
          runId: runId ?? '',
          parentId,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        const allowed = new Set(filtered);
        const kept = candidates.filter((l) => allowed.has(l)).slice(0, MAX_REMEMBER_LINES);
        const answered = options.proposal
          ? { proposalId: options.proposal.id, by: options.proposal.by }
          : {};
        if (kept.length === 0) {
          // A draft confirmed whose lines are there already: it is closed all the same.
          if (options.proposal) {
            this.#log.append({
              agent: id,
              runId,
              parentId,
              type: 'memory',
              data: { action: 'remembered', path, lines: [], ...answered },
            });
          }
          return [];
        }
        // Third-party text: the mark goes at the end of each line (review of 18/10, A2).
        const written = options.mark ? kept.map((l) => `${l} ${MEMORY_TAINT_MARK}`) : kept;
        try {
          await vault.edit(actor, {
            path,
            base_hash: note.hash,
            ops: [{ append: { text: written.map((l) => `- ${l}`).join('\n') } }],
          });
        } catch (err) {
          // Someone wrote the note meanwhile (the agent itself, Obsidian): read it again once.
          if ((err as { code?: string }).code === 'CONFLICT' && attempt === 0) continue;
          throw err;
        }
        this.#log.append({
          agent: id,
          runId,
          parentId,
          type: 'memory',
          data: { action: 'remembered', path, lines: written, ...answered },
        });
        return kept;
      }
    } catch (err) {
      this.#logError(teamStrings().memoryNotUpdated(agent.config.name, (err as Error).message));
      return [];
    }
  }

  #logError(message: string): void {
    this.#log.append({ agent: 'system', type: 'error', data: { code: 'memory', message } });
  }

  // --- runtime state ---------------------------------------------------------

  #rt(id: string): Runtime {
    let rt = this.#runtime.get(id);
    if (!rt) {
      rt = { work: new Set(), waiting: new Map(), parked: new Map(), rest: 'idle' };
      this.#runtime.set(id, rt);
    }
    return rt;
  }

  state(id: string): { state: AgentState; activity?: string; confusedSince?: number } {
    const rt = this.#rt(id);
    const busy = {
      ...(rt.activity ? { activity: rt.activity } : {}),
      ...(rt.confusedSince !== undefined ? { confusedSince: rt.confusedSince } : {}),
    };
    if (rt.waiting.size > 0) return { state: 'waiting', ...busy };
    if (rt.work.size > 0) return { state: 'working', ...busy };
    const parked = [...rt.parked.values()].at(-1);
    if (parked !== undefined) {
      return { state: 'waiting', activity: clip(teamStrings().waitingAnswer(parked)) };
    }
    return { state: rt.rest };
  }

  /** A work item of the agent ended (`workChangeOf`): how it ended is its state at rest. */
  #closeWork(rt: Runtime, key: string, status: WorkChange['status']): void {
    rt.work.delete(key);
    rt.rest =
      status === 'completed' || status === 'waiting_user'
        ? 'idle'
        : status === 'failed'
          ? 'error'
          : 'stopped';
    if (rt.work.size === 0) rt.activity = undefined;
  }

  /** The agent waits on a parked question (D-078): seeded at startup from the question store. */
  noteWaiting(agentId: string, questionId: string, question: string): void {
    this.#rt(agentId).parked.set(questionId, question);
  }

  /** A confused agent moves on (a tool, words): after the minimum time its face is normal again. */
  #movesOn(rt: Runtime, at: number): void {
    if (rt.confusedSince !== undefined && at - rt.confusedSince >= CONFUSED_MIN_MS) {
      rt.confusedSince = undefined;
    }
  }

  summaries(): AgentSummary[] {
    return this.list().map((a) => ({
      id: a.config.id,
      name: a.config.name,
      role: a.config.role,
      color: a.config.color,
      isOrchestrator: a.config.kind === 'orchestrator',
      ...(this.projectOf(a.config.id)
        ? { project: this.projectOf(a.config.id)!.id, isLead: a.config.kind === 'lead' }
        : {}),
      genome: a.genome ?? null,
      ...(a.config.models[0] ? { provider: a.config.models[0].provider } : {}),
      models: a.config.models.map((m) => ({ provider: m.provider, model: m.model })),
      ...this.state(a.config.id),
      work: [...this.#rt(a.config.id).work],
    }));
  }

  #haltAll(): void {
    for (const rt of this.#runtime.values()) {
      rt.work.clear();
      rt.waiting.clear();
      rt.parked.clear();
      rt.rest = 'stopped';
      rt.activity = undefined;
      rt.confusedSince = undefined;
    }
    this.#haltedAtStart = true;
  }

  /** Follows the event log to keep the runtime state up to date. */
  attach(): () => void {
    this.#unsubscribe?.();
    if (this.#haltedAtStart) {
      for (const id of this.#agents.keys()) this.#rt(id).rest = 'stopped';
    }
    this.#unsubscribe = this.#log.subscribe((e) => this.#onEvent(e));
    return () => {
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
    };
  }

  #onEvent(e: LogEvent): void {
    switch (e.type) {
      case 'run': {
        const change = workChangeOf(e);
        if (!change) return;
        const rt = this.#rt(e.agent);
        if (change.open) {
          rt.work.add(change.key);
          rt.activity = clip(e.data.goal ?? teamStrings().atWork);
          return;
        }
        // Only the questions of the run that ended: a monster may have two jobs at once (D-157)
        // and the other one is still waiting for its answer (C-6).
        for (const [id, runId] of rt.waiting) {
          if (runId === undefined || runId === change.runId) rt.waiting.delete(id);
        }
        rt.confusedSince = undefined;
        this.#closeWork(rt, change.key, change.status);
        // A run takes the tasks given within it along (D-157): its scope killed their
        // processes, and a task whose end never reached the log (a crash) stays open no more.
        for (const other of this.#runtime.values()) {
          for (const key of [...other.work]) {
            if (change.runId && workOfRun(key, change.runId)) {
              this.#closeWork(other, key, change.status);
            }
          }
        }
        return;
      }
      case 'delegation': {
        const change = workChangeOf(e)!;
        const rt = this.#rt(e.data.to);
        // Who delegates has found a way; who gets the task starts fresh.
        rt.confusedSince = undefined;
        this.#rt(e.data.from).confusedSince = undefined;
        if (change.open) {
          rt.work.add(change.key);
          rt.activity = clip(e.data.goal);
        } else {
          this.#closeWork(rt, change.key, change.status);
        }
        return;
      }
      case 'tool_call': {
        const rt = this.#rt(e.agent);
        if (rt.work.size > 0) rt.activity = describeToolCall(e.data.tool, e.data.input);
        this.#movesOn(rt, e.ts);
        return;
      }
      case 'message': {
        if (e.data.role !== 'agent' || e.data.status || isReservedActor(e.agent)) return;
        const rt = this.#rt(e.agent);
        // Words while writing move it on; the final answer ends it at once.
        if (e.data.partial) this.#movesOn(rt, e.ts);
        else rt.confusedSince = undefined;
        return;
      }
      case 'instinct': {
        const id = e.data.subject;
        if (!id || !STUCK_ACTIONS.has(e.data.action) || !this.#agents.has(id)) return;
        const rt = this.#rt(id);
        if (rt.work.size > 0 || rt.waiting.size > 0) rt.confusedSince = e.ts;
        return;
      }
      case 'question': {
        this.#asked.set(e.data.questionId, e.data.question);
        if (!e.data.blocking) return;
        const rt = this.#rt(e.agent);
        rt.waiting.set(e.data.questionId, e.runId ?? undefined);
        rt.confusedSince = undefined;
        rt.activity = clip(teamStrings().waitingAnswer(e.data.question));
        return;
      }
      case 'question_parked': {
        // Nothing holds it anymore: the monster waits for the user without a run (D-078).
        const rt = this.#rt(e.agent);
        rt.waiting.delete(e.data.questionId);
        rt.parked.set(e.data.questionId, this.#asked.get(e.data.questionId) ?? '');
        return;
      }
      case 'answer': {
        this.#asked.delete(e.data.questionId);
        for (const rt of this.#runtime.values()) {
          if (rt.waiting.delete(e.data.questionId)) rt.activity = teamStrings().backToWork;
          rt.parked.delete(e.data.questionId);
        }
        return;
      }
      case 'question_expired': {
        this.#asked.delete(e.data.questionId);
        for (const rt of this.#runtime.values()) {
          rt.waiting.delete(e.data.questionId);
          rt.parked.delete(e.data.questionId);
        }
        return;
      }
      case 'kill': {
        if (e.data.scope !== 'global') return;
        for (const id of this.#agents.keys()) this.#rt(id);
        this.#haltAll();
        return;
      }
      case 'resume': {
        for (const rt of this.#runtime.values()) {
          if (rt.work.size === 0) rt.rest = 'idle';
        }
        this.#haltedAtStart = false;
        return;
      }
      default:
        return;
    }
  }
}
