import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, posix, resolve, win32 } from 'node:path';
import {
  AgentAreaSchema,
  autoChain,
  isUserChannel,
  MAX_PROJECT_MEMBERS,
  MAX_PROPOSED_AUTOMATIONS,
  MAX_PROPOSED_MEMBERS,
  projectsVaultFolder,
  ProjectCreateRequestSchema,
  ProjectNameSchema,
  ProjectUpdateRequestSchema,
  type AutoBase,
  type Channel,
  type LogEvent,
  type Project,
  type ProjectCreateRequest,
  type ProjectLeadPlan,
  type ProjectMemberRequest,
  type ProjectPlan,
  type ProjectPlanAutomation,
  type ProjectPlanMember,
  type ProjectSpendView,
  type ProjectStopResponse,
  type ProjectUpdateRequest,
  type ProjectView,
  type SpendAgentCaps,
} from '@monsters/shared';
import { expandHome, mayBeInside, realPathOf } from '@monsters/tools';
import type { VaultService } from '@monsters/vault';
import type { AgentDefinition } from '../agents/definition.ts';
import type { AutomationService } from '../automations/service.ts';
import type { RunController } from '../kill/run-controller.ts';
import { agentId } from '../onboarding/proposal.ts';
import type { EventLog } from '../log/event-log.ts';
import type { Dispatcher, SendResult } from '../team/dispatcher.ts';
import { checkFolders, PermissionsError, type ForbiddenFolder } from '../team/permissions.ts';
import type { MonsterProposalInput } from '../team/propose-monster.ts';
import { OBJECTIVE_TEXT_TAIL, proposalText } from '../team/proposal-text.ts';
import type { SpendMeter } from '../team/spend.ts';
import { createRequestOf, TeamError, type TeamManager } from '../team/team-manager.ts';
import type { TeamService } from '../team/team-service.ts';
import { projectDocs, projectDocsChanged, projectDocsHash } from './context.ts';
import { fromLine } from './lines.ts';
import { projectStrings } from './projects.strings.ts';
import { projectIdFor } from './store.ts';

/*
 * Projects (D-097, contract in shared/src/projects.ts): the definitions in
 * `projects/<id>/project.yaml`, their monsters through the one TeamManager
 * (a lead `kind: lead`, copies and new monsters with `project` in their
 * agent.yaml), the messages to a project through the dispatcher (to its
 * lead), and the loop of `project_send`: the orchestrator writes in the lead's
 * chat, the lead works in a run of its own, its last answer comes back as a
 * `project_report` event the orchestrator reads at its next turn.
 */

export type ProjectErrorCode =
  | 'unknown_project'
  | 'invalid_request'
  | 'invalid_folder'
  | 'name_taken'
  | 'project_draft'
  | 'project_archived'
  | 'not_draft'
  | 'not_archived';

const STATUS: Record<ProjectErrorCode, 400 | 404 | 409> = {
  unknown_project: 404,
  invalid_request: 400,
  invalid_folder: 400,
  name_taken: 409,
  project_draft: 409,
  project_archived: 409,
  not_draft: 409,
  not_archived: 409,
};

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  readonly status: 400 | 404 | 409;
  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export interface ProjectServiceOptions {
  team: TeamService;
  squad: TeamManager;
  vault: VaultService;
  log: EventLog;
  dispatcher: Dispatcher;
  spend: SpendMeter;
  /** Folders a project can never work in: the notes and the data folder of Monsters. */
  forbiddenFolders: () => ForbiddenFolder[];
  /** "Ferma progetto" stops the runs of its monsters (D-098). */
  runs: RunController;
  /** The automations: a proposal's first ones become drafts, "Ferma" skips the giri waiting. */
  automations?: () => AutomationService | undefined;
  /** Where a new project folder goes when a proposal asks for one (`<parent>/Monsters Progetti`, `Monsters Projects`). */
  projectsDir?: () => string;
  /** Connected MCP servers and services through Claude a proposal may name (D-098). */
  connections?: () => { mcp: string[]; claude: { id: string; name: string }[] };
  /**
   * The connections given to the whole team (`*`): a new project starts with
   * them chosen, unless the request says otherwise (D-129).
   */
  teamConnections?: () => { mcp: string[]; claude: string[] };
  now?: () => number;
}

/** What `project_propose` gives (D-098), already checked by the tool's schema. */
export interface ProjectProposalInput {
  name: string;
  goal: string;
  /** An existing absolute folder to work in. */
  folder?: string | undefined;
  /** A new folder under `projectsDir` (created at the confirmation). */
  newFolder?: boolean | undefined;
  lead?: { name?: string | undefined; copyOf?: string | undefined } | undefined;
  monsters: ({ copyOf: string; name?: string | undefined } | MonsterProposalInput)[];
  /** Names of connected servers or services. */
  connections?: string[] | undefined;
  webSearch?: boolean | undefined;
  spend?: SpendAgentCaps | undefined;
  automations?:
    | {
        name: string;
        cron: string;
        timezone?: string | undefined;
        objective: string;
        participants?: string[] | undefined;
        resultsFolder?: string | undefined;
      }[]
    | undefined;
  why?: string | undefined;
}

export interface ProjectProposal {
  project: ProjectView;
  /** The same project was already proposed and waits for the user. */
  repeated?: boolean;
  /** The names the monsters will have (free in every squad now). */
  names: { lead: string; monsters: string[] };
  /** Monsters whose name was taken (by another monster or in the proposal): the one they got. */
  renamed?: { asked: string; got: string }[];
  /** The first automations in Italian ("ogni domenica alle 23:00"). */
  schedules: { name: string; when: string }[];
}

/** Proposals look this far back after a restart for work of `project_send` left behind. */
const RESTART_LOOKBACK_MS = 7 * 24 * 3600_000;

/** What `project_status` and Telegram's `/stato` tell of a project. */
export interface ProjectStatusLine {
  id: string;
  name: string;
  lead?: { id: string; name: string; state: string; activity?: string };
  members: number;
  /** Work sent with `project_send` and not reported yet. */
  pending: number;
  /** `runId`: the lead's run that wrote it (its taint goes with it, D-103). */
  lastReport?: { status: string; summary: string; ts: number; runId: string | null };
}

/** The longest report of a lead that goes back to the orchestrator. */
const REPORT_CHARS = 3000;

interface PendingSend {
  request: string;
  from: string;
  project: string;
  lead: string;
  runId: string;
}

export class ProjectService {
  readonly #o: ProjectServiceOptions;
  readonly #now: () => number;
  /** Runs of a lead that carry work of `project_send`, by run id (D-097). */
  readonly #sends = new Map<string, PendingSend[]>();
  readonly #off: () => void;
  /** Changes of a project, one at a time by id (two taps on "Conferma", D-103). */
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(options: ProjectServiceOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#off = options.log.subscribe((e) => this.#onEvent(e));
  }

  close(): void {
    this.#off();
  }

  /**
   * `work` after the changes of the same project that came before it (D-103):
   * two confirmations at once (the app and Telegram, a double tap) never run
   * together; the second one reads the state the first one left.
   */
  #serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const key = (this.#o.team.project(id)?.id ?? id).toLowerCase();
    const before = this.#locks.get(key) ?? Promise.resolve();
    const next = before.then(work, work);
    const tail = next.catch(() => undefined);
    this.#locks.set(key, tail);
    void tail.then(() => {
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    });
    return next;
  }

  /**
   * After a restart (D-098): the work of `project_send` a previous core left
   * behind. Never started (it waited for the lead): it waits again or starts
   * now. Started: the core closed in the middle of it, so the orchestrator
   * gets a report that says so. Call once the core can run monsters.
   */
  async start(): Promise<void> {
    const { log, team } = this.#o;
    if (this.#demoteUnconfirmed()) await this.#reload();
    // Projects made before D-103 have no approval of their folder's instructions: as they are now.
    for (const p of team.projects()) {
      if (p.status !== 'active' || !p.folder || p.folderDocs || p.archivedAt !== undefined)
        continue;
      try {
        team.projectStore.save({ ...p, folderDocs: docsApproval(p.folder, this.#now()) });
      } catch {
        // A folder that cannot be read: nothing reaches the prompt either.
      }
    }
    const since = this.#now() - RESTART_LOOKBACK_MS;
    const reported = new Set(
      log
        .query({ type: 'project_report', since, limit: 5000 })
        .map((e) => (e.type === 'project_report' ? e.data.request : '')),
    );
    const known = new Set([...this.#sends.values()].flat().map((s) => s.request));
    const left = log
      .query({ type: 'message', agent: 'user', since, order: 'desc', limit: 5000 })
      .filter(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' &&
          e.data.from !== undefined &&
          e.data.to !== undefined &&
          e.runId !== null &&
          !reported.has(e.id) &&
          !known.has(e.id),
      )
      .reverse();
    for (const m of left) {
      const lead = team.byId(m.data.to!);
      const project = team.projectOf(m.data.to!);
      if (!lead || lead.config.kind !== 'lead' || !project) continue;
      const send: PendingSend = {
        request: m.id,
        from: m.data.from!,
        project: project.id,
        lead: lead.config.id,
        runId: m.runId!,
      };
      const runs = log.query({ runId: m.runId!, type: 'run', limit: 50 });
      if (runs.length > 0) {
        // It ran and its end was not reported: the core closed during it.
        const end = runs.filter((r) => r.type === 'run' && r.data.status !== 'started').at(-1);
        const status = end?.type === 'run' ? end.data.status : 'aborted';
        this.#report(send, status === 'started' ? 'aborted' : status, m.runId!, 'restart');
        continue;
      }
      // It never started: it goes on as if just sent.
      this.#track(send);
      try {
        this.#o.dispatcher.requeue(lead.config.id, m.runId!, {
          eventId: m.id,
          text: `${fromLine(team.byId(m.data.from!)?.config.name ?? m.data.from!)}\n\n${m.data.text}`,
        });
      } catch {
        this.#untrack(send);
        this.#report(send, 'aborted', m.runId!, 'restart');
      }
    }
  }

  /**
   * A project is `active` only by the user (D-103): created active, confirmed or
   * restored from the app, the terminal or Telegram. A project.yaml that says
   * `active` without such an event (by hand, or a monster through the data
   * folder, D-078) goes back to a draft, with a line in the log. True if any did.
   */
  #demoteUnconfirmed(): boolean {
    const { log, team } = this.#o;
    const approved = new Map<string, boolean>();
    for (const e of log.query({ type: 'project_change', limit: 100_000 })) {
      if (e.type !== 'project_change') continue;
      const user = isUserChannel(e.data.by);
      switch (e.data.action) {
        case 'created':
          approved.set(e.data.project, user && e.data.status !== 'draft');
          break;
        case 'confirmed':
        case 'restored':
          if (user) approved.set(e.data.project, true);
          break;
        case 'discarded':
          approved.set(e.data.project, false);
          break;
        default:
          break;
      }
    }
    let demoted = false;
    for (const p of team.projects()) {
      if (p.status !== 'active' || approved.get(p.id) === true) continue;
      const { lead: _lead, ...rest } = p;
      team.projectStore.save({
        ...rest,
        status: 'draft',
        plan: p.plan ?? { lead: {}, members: [], automations: [] },
        updatedAt: this.#now(),
      });
      log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'project_unconfirmed',
          message: projectStrings().unconfirmed(p.name, p.id),
        },
      });
      demoted = true;
    }
    return demoted;
  }

  #track(s: PendingSend): void {
    const list = this.#sends.get(s.runId) ?? [];
    if (!list.some((x) => x.request === s.request)) list.push(s);
    this.#sends.set(s.runId, list);
  }

  #untrack(s: PendingSend): void {
    const list = (this.#sends.get(s.runId) ?? []).filter((x) => x.request !== s.request);
    if (list.length > 0) this.#sends.set(s.runId, list);
    else this.#sends.delete(s.runId);
  }

  // --- views ---------------------------------------------------------------------------

  #require(id: string): Project {
    const p = this.#o.team.project(id);
    if (!p) throw new ProjectError('unknown_project', projectStrings().unknownProject(id));
    return p;
  }

  #active(id: string): Project {
    const p = this.#require(id);
    if (p.archivedAt !== undefined) {
      throw new ProjectError('project_archived', projectStrings().archived(p.name));
    }
    return p;
  }

  view(p: Project): ProjectView {
    const { team } = this.#o;
    const members =
      p.archivedAt === undefined
        ? team.members(p.id).map((a) => {
            const s = team.state(a.config.id);
            return {
              id: a.config.id,
              name: a.config.name,
              role: a.config.role,
              color: a.config.color,
              genome: a.genome ?? null,
              isLead: a.config.kind === 'lead',
              state: s.state,
              ...(s.activity ? { activity: s.activity } : {}),
            };
          })
        : [];
    const folderExists = p.folder !== undefined && isFolder(p.folder);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      archived: p.archivedAt !== undefined,
      ...(p.archivedAt !== undefined ? { archivedAt: p.archivedAt } : {}),
      ...(p.folder ? { folder: p.folder } : {}),
      folderExists,
      vaultArea: p.vaultArea,
      ...(team.lead(p.id) ? { lead: team.lead(p.id)!.config.id } : {}),
      ...(p.plan ? { plan: p.plan } : {}),
      members,
      maxMembers: MAX_PROJECT_MEMBERS,
      spend: p.spend,
      connections: { mcp: [...p.connections.mcp], claude: [...p.connections.claude] },
      webSearch: p.webSearch,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      ...(p.folder && folderExists
        ? {
            folderDocs: {
              files: projectDocs(p.folder).map((d) => d.file),
              changed: p.status === 'active' && projectDocsChanged(p),
            },
          }
        : {}),
    };
  }

  /** Every project: in use first (oldest first), then the drafts, then the archived ones. */
  list(): ProjectView[] {
    const rank = (p: Project) => (p.archivedAt !== undefined ? 2 : p.status === 'draft' ? 1 : 0);
    return this.#o.team
      .projects()
      .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
      .map((p) => this.view(p));
  }

  get(id: string): ProjectView {
    return this.view(this.#require(id));
  }

  // --- changes -------------------------------------------------------------------------

  #event(
    action: LogEvent<'project_change'>['data']['action'],
    p: Project,
    by: Channel,
    extra: Partial<LogEvent<'project_change'>['data']> = {},
  ): void {
    // A monster's draft (D-098): its outcome goes back to it.
    const from = p.createdBy !== 'user' && this.#o.team.byId(p.createdBy) ? p.createdBy : undefined;
    this.#o.log.append({
      agent: 'user',
      type: 'project_change',
      data: {
        action,
        project: p.id,
        name: p.name,
        by,
        ...(from && ['created', 'confirmed', 'discarded'].includes(action) ? { from } : {}),
        ...extra,
      },
    });
  }

  /** The team, the vault permissions and the spending caps after a change of the projects. */
  async #reload(): Promise<void> {
    const { team, vault } = this.#o;
    await team.load();
    vault.setPermissions({
      ...team.vaultPermissions(),
      external: vault.permissions.config.external,
    });
    this.#o.spend.rearm();
  }

  /**
   * A project's name is unique among the projects (names and ids) and the
   * monsters (D-103): `@Nome`, `to` and `project_send` find one thing only.
   */
  #checkName(name: string, self?: string): void {
    const key = name.trim().toLowerCase();
    const other = this.#o.team
      .projects()
      .find((p) => p.id !== self && (p.name.toLowerCase() === key || p.id === key));
    if (other) throw new ProjectError('name_taken', projectStrings().nameTakenProject(other.name));
    const monster = this.#o.team.get(key) ?? this.#o.team.byId(agentId(name));
    if (monster) {
      throw new ProjectError('name_taken', projectStrings().nameTakenMonster(monster.config.name));
    }
  }

  /** A free id: no project has it as id or as name (D-103). */
  #freeId(name: string): string {
    const store = this.#o.team.projectStore;
    const names = new Set(this.#o.team.projects().map((p) => p.name.toLowerCase()));
    return projectIdFor(name, (id) => store.has(id) || names.has(id));
  }

  #checkArea(area: string, self?: string): void {
    const other = this.#o.team
      .projects()
      .find(
        (p) =>
          p.id !== self &&
          p.archivedAt === undefined &&
          (inArea(p.vaultArea, area) || inArea(area, p.vaultArea)),
      );
    if (other) {
      throw new ProjectError(
        'invalid_request',
        projectStrings().areaTaken(other.name, other.vaultArea),
      );
    }
  }

  /**
   * A folder every monster of the project will read and write (review of 18/10, M2): not the
   * home or a folder that holds it, not a root, not a dotfolder of the home (`~/.ssh`,
   * `~/.config`), not a folder that holds the notes or Monsters' data, nor one inside them.
   * Checked on the path as given and on its real path.
   */
  async #assertProjectFolder(path: string, forbidden: ForbiddenFolder[]): Promise<void> {
    const real = await realPathOf(path).catch(() => path);
    for (const candidate of new Set([path, real])) {
      const why = projectFolderRefusal(candidate, homedir());
      if (why) throw new ProjectError('invalid_folder', why);
      for (const f of forbidden) {
        const fr = await realPathOf(f.path).catch(() => resolve(f.path));
        for (const root of new Set([resolve(f.path), fr])) {
          if (mayBeInside(root, candidate)) throw new ProjectError('invalid_folder', f.why);
          if (mayBeInside(candidate, root)) {
            throw new ProjectError('invalid_folder', projectStrings().folderHoldsData);
          }
        }
      }
    }
  }

  /** An absolute folder that exists (or is created now), outside the notes and Monsters' data. */
  async #folder(req: { path: string; create?: boolean | undefined }): Promise<string> {
    const expanded = expandHome(req.path.trim());
    if (!isAbsolute(expanded)) {
      throw new ProjectError('invalid_folder', projectStrings().folderAbsolute);
    }
    const path = resolve(expanded);
    const forbidden = this.#o.forbiddenFolders();
    // Checked before creating anything: never a folder made inside the notes or the data.
    await this.#assertProjectFolder(path, forbidden);
    if (!existsSync(path)) {
      if (!req.create) {
        throw new ProjectError('invalid_folder', projectStrings().folderMissing(path));
      }
      await mkdir(path, { recursive: true });
    }
    try {
      const [ok] = await checkFolders([{ path, write: true }], forbidden);
      // Saved as its real path (review of 18/10, B3): the checks on the project's instructions
      // compare real paths, a folder given through a link is the folder it leads to.
      return await realPathOf(ok!.path);
    } catch (err) {
      if (err instanceof PermissionsError) throw new ProjectError('invalid_folder', err.message);
      throw err;
    }
  }

  /**
   * A new project. `active` (the default): its lead is created now; `draft`:
   * saved with the lead it will get, no monster until it is confirmed (a
   * proposal of the orchestrator, plan B2, waits for the user's tap).
   */
  async create(input: ProjectCreateRequest, by: Channel, createdBy = 'user'): Promise<ProjectView> {
    const req = ProjectCreateRequestSchema.parse(input);
    const { team } = this.#o;
    this.#checkName(req.name);
    const area =
      req.vaultArea ??
      AgentAreaSchema.parse(`${projectsVaultFolder(this.#o.vault.layout)}/${req.name}`);
    this.#checkArea(area);
    const folder = req.folder ? await this.#folder(req.folder) : undefined;
    const store = team.projectStore;
    const now = this.#now();
    const project = store.save({
      id: this.#freeId(req.name),
      name: req.name,
      ...(folder ? { folder } : {}),
      vaultArea: area,
      status: req.status,
      ...(req.status === 'draft' ? { plan: { lead: req.lead, members: [], automations: [] } } : {}),
      spend: cleanCaps(req.spend ?? {}),
      // What the whole team has, unless the user chose otherwise at the creation (D-129).
      connections: {
        mcp: req.connections?.mcp ?? this.#teamConnections().mcp,
        claude: req.connections?.claude ?? this.#teamConnections().claude,
      },
      webSearch: req.webSearch ?? true,
      createdBy,
      createdAt: now,
      updatedAt: now,
      // The user chose this folder: its CLAUDE.md and AGENTS.md as they are now are approved (D-103).
      ...(folder && req.status === 'active' ? { folderDocs: docsApproval(folder, now) } : {}),
    });
    if (project.status === 'active') {
      try {
        await this.#withLead(project, req.lead, by);
      } catch (err) {
        // No half project: without its lead the folder goes (nothing else was written).
        rmSync(join(store.dir, project.id), { recursive: true, force: true });
        await this.#reload();
        throw err;
      }
    } else {
      await this.#reload();
    }
    const saved = this.#require(project.id);
    this.#event('created', saved, by, { status: saved.status });
    return this.view(saved);
  }

  /** Creates the lead of a project and writes it in project.yaml. */
  async #withLead(project: Project, plan: ProjectLeadPlan, by: Channel): Promise<void> {
    await this.#reload();
    const lead = await this.#o.squad.createLead(project, plan, by);
    const current = this.#require(project.id);
    const { plan: _plan, ...rest } = current;
    this.#o.team.projectStore.save({
      ...rest,
      status: 'active',
      lead: lead.id,
      updatedAt: this.#now(),
    });
    await this.#reload();
  }

  update(id: string, input: ProjectUpdateRequest, by: Channel): Promise<ProjectView> {
    const u = ProjectUpdateRequestSchema.parse(input);
    return this.#serial(id, () => this.#update(id, u, by));
  }

  async #update(
    id: string,
    u: ReturnType<typeof ProjectUpdateRequestSchema.parse>,
    by: Channel,
  ): Promise<ProjectView> {
    const current = this.#active(id);
    if (u.name !== undefined) this.#checkName(u.name, current.id);
    if (u.vaultArea !== undefined) this.#checkArea(u.vaultArea, current.id);
    if (u.lead !== undefined && current.status !== 'draft') {
      throw new ProjectError('invalid_request', projectStrings().leadFixed);
    }
    const folder =
      u.folder === null ? undefined : u.folder ? await this.#folder(u.folder) : current.folder;
    const next: Project = {
      ...current,
      ...(u.name !== undefined ? { name: u.name } : {}),
      ...(u.vaultArea !== undefined ? { vaultArea: u.vaultArea } : {}),
      ...(u.spend !== undefined ? { spend: cleanCaps({ ...current.spend, ...u.spend }) } : {}),
      connections: {
        mcp: u.connections?.mcp ?? current.connections.mcp,
        claude: u.connections?.claude ?? current.connections.claude,
      },
      ...(u.webSearch !== undefined ? { webSearch: u.webSearch } : {}),
      ...(u.lead !== undefined
        ? { plan: { members: [], automations: [], ...current.plan, lead: u.lead } }
        : {}),
      updatedAt: this.#now(),
    };
    if (folder === undefined) delete next.folder;
    else next.folder = folder;
    // A folder the user gives now: its instructions as they are (D-103). The same folder given
    // again (saved before B3 through a link) is no new folder.
    const sameFolder =
      folder === current.folder ||
      (folder !== undefined &&
        current.folder !== undefined &&
        folder === (await realPathOf(current.folder).catch(() => current.folder)));
    if (!sameFolder) {
      if (folder !== undefined && current.status === 'active') {
        next.folderDocs = docsApproval(folder, this.#now());
      } else delete next.folderDocs;
    }
    this.#o.team.projectStore.save(next);
    await this.#reload();
    // A draft confirmed: everything it plans, or nothing (D-098).
    if (u.status === 'active' && current.status === 'draft') return this.#confirm(current.id, by);
    await this.#o.squad.refreshLead(current.id, current);
    const saved = this.#require(current.id);
    this.#event('updated', saved, by);
    return this.view(saved);
  }

  /** Archives a project: its monsters are archived (never deleted), its notes and folder stay. */
  archive(id: string, by: Channel): Promise<ProjectView> {
    return this.#serial(id, () => this.#archive(id, by));
  }

  async #archive(id: string, by: Channel): Promise<ProjectView> {
    const current = this.#active(id);
    if (current.status === 'draft') {
      throw new ProjectError('project_draft', projectStrings().draftNotArchivable(current.name));
    }
    const agents = await this.#o.squad.archiveSquad(current.id, by);
    // Its automations would find no lead at every slot: paused with it (D-103).
    const automations = this.#o.automations?.()?.pauseProject(current.id, by) ?? [];
    this.#o.team.projectStore.save({ ...current, archivedAt: this.#now(), updatedAt: this.#now() });
    await this.#reload();
    const saved = this.#require(current.id);
    this.#event('archived', saved, by, {
      agents,
      ...(automations.length > 0 ? { automations } : {}),
    });
    return this.view(saved);
  }

  /**
   * An archived project comes back (D-098): its file without `archivedAt`, and
   * the monsters archived with it (its lead first). Without its lead it stays
   * archived.
   */
  restore(id: string, by: Channel): Promise<ProjectView> {
    return this.#serial(id, () => this.#restore(id, by));
  }

  /** The monsters an archived project would bring back with it (empty when it is not archived). */
  archivedSquad(id: string): string[] {
    const current = this.#o.team.project(id);
    if (!current || current.archivedAt === undefined) return [];
    return this.#archivedEvent(id)?.data.agents ?? [...(current.lead ? [current.lead] : [])];
  }

  #archivedEvent(id: string): LogEvent<'project_change'> | undefined {
    return this.#o.log
      .query({ type: 'project_change', order: 'desc', limit: 1000 })
      .find(
        (e): e is LogEvent<'project_change'> =>
          e.type === 'project_change' && e.data.project === id && e.data.action === 'archived',
      );
  }

  async #restore(id: string, by: Channel): Promise<ProjectView> {
    const current = this.#require(id);
    if (current.archivedAt === undefined) {
      throw new ProjectError('not_archived', projectStrings().notArchived(current.name));
    }
    this.#checkName(current.name, current.id);
    this.#checkArea(current.vaultArea, current.id);
    const archived = this.#archivedEvent(current.id);
    const ids = archived?.data.agents ?? [...(current.lead ? [current.lead] : [])];
    const { archivedAt: _at, ...rest } = current;
    this.#o.team.projectStore.save({ ...rest, updatedAt: this.#now() });
    await this.#reload();
    let back: string[];
    try {
      back = await this.#o.squad.restoreSquad(current.id, ids, by);
    } catch (err) {
      this.#o.team.projectStore.save(current);
      await this.#reload();
      throw err;
    }
    await this.#reload();
    if (!this.#o.team.lead(current.id)) {
      this.#o.team.projectStore.save({ ...current, updatedAt: this.#now() });
      await this.#reload();
      throw new ProjectError('invalid_request', projectStrings().leadGone(current.name));
    }
    // The automations paused with the archive run again (D-103).
    this.#o.automations?.()?.resumeProject(archived?.data.automations ?? [], by);
    const saved = this.#require(current.id);
    this.#event('restored', saved, by, { agents: back });
    return this.view(saved);
  }

  /** A draft left aside (D-098): its file goes; nothing else was created. */
  discard(id: string, by: Channel): Promise<{ ok: true }> {
    return this.#serial(id, () => this.#discard(id, by));
  }

  async #discard(id: string, by: Channel): Promise<{ ok: true }> {
    const p = this.#require(id);
    if (p.status !== 'draft') {
      throw new ProjectError('not_draft', projectStrings().notDraft(p.name));
    }
    rmSync(join(this.#o.team.projectStore.dir, p.id), { recursive: true, force: true });
    await this.#reload();
    this.#event('discarded', p, by);
    return { ok: true };
  }

  // --- proposals of the orchestrator (D-098) ---------------------------------------------

  /** A free folder name for a new project folder under `projectsDir`. */
  #newFolderPath(name: string): string {
    const base = this.#o.projectsDir?.();
    if (!base) {
      throw new ProjectError('invalid_folder', projectStrings().newFolderUnknown);
    }
    const clean = name.replace(/[\\/:*?"<>|]/g, '').trim();
    return join(base, clean || this.#o.vault.layout.untitledProject);
  }

  /** The folder of a proposal, checked; nothing is created until the confirmation. */
  async #proposalFolder(input: ProjectProposalInput): Promise<{ path?: string; create?: boolean }> {
    if (!input.folder && !input.newFolder) return {};
    const raw =
      input.folder && input.folder.trim().toLowerCase() !== 'new' ? input.folder : undefined;
    const path = raw ? resolve(expandHome(raw.trim())) : this.#newFolderPath(input.name);
    if (raw && !isAbsolute(expandHome(raw.trim()))) {
      throw new ProjectError('invalid_folder', projectStrings().folderPathAbsolute);
    }
    await this.#assertProjectFolder(path, this.#o.forbiddenFolders());
    if (existsSync(path)) {
      if (!isFolder(path))
        throw new ProjectError('invalid_folder', projectStrings().notAFolder(path));
      return { path };
    }
    if (raw) {
      throw new ProjectError('invalid_folder', projectStrings().folderMissingOrNew(path));
    }
    return { path, create: true };
  }

  /** The connections given to the whole team (`*`), without duplicates. */
  #teamConnections(): { mcp: string[]; claude: string[] } {
    const team = this.#o.teamConnections?.() ?? { mcp: [], claude: [] };
    return { mcp: [...new Set(team.mcp)], claude: [...new Set(team.claude)] };
  }

  /**
   * Server and service names of a proposal → the project's connections: the
   * ones of the whole team (D-129: the user takes away what the project does
   * not need, on the draft's page) plus the ones it names.
   */
  #proposalConnections(names: readonly string[]): { mcp: string[]; claude: string[] } {
    const have = this.#o.connections?.() ?? { mcp: [], claude: [] };
    const mcp: string[] = [...this.#teamConnections().mcp];
    const claude: string[] = [...this.#teamConnections().claude];
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/^claude\.ai\s+/, '')
        .trim();
    for (const raw of names) {
      const n = norm(raw);
      const server = have.mcp.find((m) => norm(m) === n);
      const service = have.claude.find((c) => norm(c.id) === n || norm(c.name) === n);
      if (server) mcp.push(server);
      else if (service) claude.push(service.id);
      else {
        const all = [...have.mcp, ...have.claude.map((c) => c.name)];
        throw new ProjectError(
          'invalid_request',
          projectStrings().connectionUnknown(raw, all.join(', ') || projectStrings().none),
        );
      }
    }
    return { mcp: [...new Set(mcp)], claude: [...new Set(claude)] };
  }

  /**
   * `project_propose` (D-098): a whole project as a draft. The same checks as
   * the creation (name, area, folder, names of the monsters free in every
   * squad, schedules), nothing created: the user confirms it (`confirm`) or
   * leaves it aside (`discard`). The proposal of the same name by the same
   * monster, still open, is returned as it is.
   */
  async propose(
    input: ProjectProposalInput,
    origin: {
      agent: string;
      runId?: string | null;
      parentId?: string | null;
      /** The proposing run had read third-party text (D-103). */
      taint?: string | undefined;
    },
  ): Promise<ProjectProposal> {
    const { team, squad } = this.#o;
    const parsed = ProjectNameSchema.safeParse(input.name);
    if (!parsed.success) {
      throw new ProjectError(
        'invalid_request',
        `name: ${parsed.error.issues[0]?.message ?? projectStrings().nameInvalid}`,
      );
    }
    const name = parsed.data;
    const open = team
      .projects()
      .find(
        (p) =>
          p.status === 'draft' &&
          p.createdBy === origin.agent &&
          p.name.toLowerCase() === name.toLowerCase(),
      );
    if (open) return { ...this.#proposalView(open), repeated: true };
    this.#checkName(name);
    const area = AgentAreaSchema.parse(`${projectsVaultFolder(this.#o.vault.layout)}/${name}`);
    this.#checkArea(area);
    const goal = clean('goal', input.goal);
    const folder = await this.#proposalFolder(input);
    if (input.monsters.length < 1 || input.monsters.length > MAX_PROPOSED_MEMBERS) {
      throw new ProjectError(
        'invalid_request',
        projectStrings().monstersCount(MAX_PROPOSED_MEMBERS),
      );
    }
    if ((input.automations?.length ?? 0) > MAX_PROPOSED_AUTOMATIONS) {
      throw new ProjectError(
        'invalid_request',
        projectStrings().automationsMax(MAX_PROPOSED_AUTOMATIONS),
      );
    }
    try {
      // The lead: new, or a copy of a monster (its look and models).
      const leadSource = input.lead?.copyOf ? team.get(input.lead.copyOf) : undefined;
      if (input.lead?.copyOf && !leadSource) {
        throw new ProjectError(
          'invalid_request',
          projectStrings().leadCopyUnknown(input.lead.copyOf),
        );
      }
      const named = input.lead?.name ? squad.checkName(input.lead.name) : undefined;
      const names = named ? [named] : [];
      // A copy is still "Dione" for whoever proposes it: the participants of the
      // first automations may name the source (name or id) of a copy, or of the
      // lead, which mean the copy (collaudo of 17/10). A source copied twice is
      // ambiguous and is not an alias.
      const aliases = new Map<string, string | null>();
      const alias = (source: AgentDefinition, copy: string) => {
        for (const key of [source.config.name, source.config.id].map((k) => k.toLowerCase())) {
          aliases.set(key, aliases.has(key) && aliases.get(key) !== copy ? null : copy);
        }
      };
      const hues: number[] = [];
      const renamed: { asked: string; got: string }[] = [];
      // A name already taken (anywhere, or earlier in this proposal) is not worth the
      // whole proposal: the monster gets a free one and the tool result says so.
      const free = (asked: string): string => {
        const inProposal = names.some((n) => n.toLowerCase() === asked.trim().toLowerCase());
        if (!inProposal && !squad.nameTaken(asked)) return asked;
        const got = squad.freeName(names);
        renamed.push({ asked: asked.trim(), got });
        return got;
      };
      const members: ProjectPlanMember[] = [];
      for (const [i, m] of input.monsters.entries()) {
        if ('copyOf' in m) {
          const source = team.get(m.copyOf);
          if (!source || source.config.kind !== 'subagent') {
            throw new ProjectError(
              'invalid_request',
              source
                ? projectStrings().copyOfLead(i, source.config.name)
                : projectStrings().copyOfUnknown(i, m.copyOf),
            );
          }
          const copyName = squad.checkName(m.name ? free(m.name) : squad.freeName(names));
          if (names.some((n) => n.toLowerCase() === copyName.toLowerCase())) {
            throw new ProjectError('invalid_request', projectStrings().copyNameTwice(i, copyName));
          }
          names.push(copyName);
          alias(source, copyName);
          members.push({ copyOf: source.config.id, name: copyName });
          continue;
        }
        const { draft, models } = squad.draftOf(
          { ...m, name: free(m.name), area: m.area ?? area },
          { taken: names, hues },
        );
        names.push(draft.name);
        const hue = (draft.genome as { palette?: { hue?: number } }).palette?.hue;
        if (typeof hue === 'number') hues.push(hue);
        members.push({ draft, ...(models ? { models } : {}) });
      }
      // A lead without a name gets a free one, not one of its monsters'.
      const leadName = named ?? squad.freeName(names);
      if (!named) names.push(leadName);
      if (leadSource) alias(leadSource, leadName);
      const participant = (w: string): string | undefined => {
        const key = w.trim().toLowerCase();
        return names.find((n) => n.toLowerCase() === key) ?? aliases.get(key) ?? undefined;
      };
      const automations: ProjectPlanAutomation[] = [];
      const schedules: { name: string; when: string }[] = [];
      for (const [i, a] of (input.automations ?? []).entries()) {
        const svc = this.#o.automations?.();
        if (!svc)
          throw new ProjectError('invalid_request', projectStrings().automationsUnavailable);
        const preview = svc.preview({ cron: a.cron, timezone: a.timezone });
        const wanted = a.participants ?? [];
        const unknown = wanted.find((w) => !participant(w));
        if (unknown) {
          throw new ProjectError(
            'invalid_request',
            projectStrings().participantUnknown(i, unknown, names.join(', ')),
          );
        }
        automations.push({
          name: a.name.trim(),
          schedule: { cron: preview.cron, timezone: preview.timezone },
          objective: cleanObjective(`automations[${i}].objective`, a.objective),
          participants: [...new Set(wanted.map((w) => participant(w)!))],
          ...(a.resultsFolder ? { resultsFolder: a.resultsFolder } : {}),
        });
        schedules.push({ name: a.name.trim(), when: preview.text });
      }
      const connections = this.#proposalConnections(input.connections ?? []);
      const plan: ProjectPlan = {
        lead: {
          name: leadName,
          ...(leadSource ? { from: leadSource.config.id } : {}),
          goal,
        },
        members,
        automations,
        ...(folder.create ? { createFolder: true } : {}),
        ...(input.why ? { why: clean('why', input.why) } : {}),
        ...(origin.taint ? { taint: { source: origin.taint.slice(0, 200) } } : {}),
      };
      const store = team.projectStore;
      const now = this.#now();
      const project = store.save({
        id: this.#freeId(name),
        name,
        ...(folder.path ? { folder: folder.path } : {}),
        vaultArea: area,
        status: 'draft',
        plan,
        spend: cleanCaps(input.spend ?? {}),
        connections,
        webSearch: input.webSearch ?? true,
        createdBy: origin.agent,
        createdAt: now,
        updatedAt: now,
      });
      await this.#reload();
      // In the orchestrator's run: the chat shows the card where it was proposed.
      this.#o.log.append({
        agent: origin.agent,
        runId: origin.runId ?? null,
        parentId: origin.parentId ?? null,
        type: 'project_change',
        data: {
          action: 'created',
          project: project.id,
          name: project.name,
          from: origin.agent,
          status: 'draft',
        },
      });
      return {
        ...this.#proposalView(project),
        schedules,
        ...(renamed.length > 0 ? { renamed } : {}),
      };
    } catch (err) {
      if (err instanceof TeamError)
        throw new ProjectError(
          err.code === 'invalid_name' ? 'name_taken' : 'invalid_request',
          err.message,
        );
      throw err;
    }
  }

  #proposalView(p: Project): ProjectProposal {
    const plan = p.plan;
    return {
      project: this.view(p),
      names: {
        lead: plan?.lead.name ?? '',
        monsters: (plan?.members ?? []).map((m) =>
          'draft' in m ? m.draft.name : (m.name ?? m.copyOf),
        ),
      },
      schedules: (plan?.automations ?? []).map((a) => ({ name: a.name, when: a.schedule.cron })),
    };
  }

  /**
   * A draft confirmed (D-098): its folder (when new), its lead, its monsters
   * (copies and new ones) and its first automations (as drafts) are created
   * together. If one fails, what was made goes and the draft stays as it was.
   */
  confirm(id: string, by: Channel): Promise<ProjectView> {
    return this.#serial(id, () => this.#confirm(id, by));
  }

  /** The confirmation, inside the lock: the state is read again here. */
  async #confirm(id: string, by: Channel): Promise<ProjectView> {
    const { team, squad } = this.#o;
    const draft = this.#active(id);
    if (draft.status !== 'draft') {
      throw new ProjectError('not_draft', projectStrings().alreadyConfirmed(draft.name));
    }
    const plan: ProjectPlan = draft.plan ?? { lead: {}, members: [], automations: [] };
    // Every name checked before anything is written.
    const planned = [
      ...(plan.lead.name ? [plan.lead.name] : []),
      ...plan.members
        .map((m) => ('draft' in m ? m.draft.name : m.name))
        .filter((n): n is string => !!n),
    ];
    try {
      for (const n of planned) squad.checkName(n);
    } catch (err) {
      if (err instanceof TeamError) {
        throw new ProjectError('name_taken', projectStrings().renameInDraft(err.message));
      }
      throw err;
    }
    const madeFolder =
      plan.createFolder && draft.folder && !existsSync(draft.folder) ? draft.folder : undefined;
    const created: string[] = [];
    const automationDrafts: string[] = [];
    const orchestrator = team.orchestrator();
    try {
      if (draft.folder && plan.createFolder) {
        const path = await this.#folder({ path: draft.folder, create: true });
        this.#o.team.projectStore.save({ ...draft, folder: path });
      } else if (draft.folder) {
        // A draft saved before these rules, or edited on disk: the same checks at the tap.
        await this.#assertProjectFolder(resolve(draft.folder), this.#o.forbiddenFolders());
      }
      await this.#withLead(this.#require(id), plan.lead, by);
      // The user confirms the project with its folder: the instructions there as they are (D-103).
      const confirmed = this.#require(id);
      if (confirmed.folder) {
        this.#o.team.projectStore.save({
          ...confirmed,
          folderDocs: docsApproval(confirmed.folder, this.#now()),
        });
      }
      const lead = team.lead(id)!;
      created.push(lead.config.id);
      // Automatica (D-093) where the models come from it: the lead's base is Media (D-110).
      const leadModelsFrom = plan.lead.from ? team.byId(plan.lead.from) : orchestrator;
      if (!plan.lead.models && leadModelsFrom?.config.autoModels) {
        await team.setModels(lead.config.id, autoChain('medium'), { base: 'medium' });
      }
      for (const m of plan.members) {
        if ('copyOf' in m) {
          const view = await squad.copyInto(id, m.copyOf, m.name, by);
          created.push(view.id);
          continue;
        }
        const view = await squad.create(createRequestOf(squad.fitColor(m.draft, id)), by, {
          project: id,
          ...(m.models ? { models: m.models } : {}),
        });
        created.push(view.id);
        const base: AutoBase = 'medium';
        if (!m.models && (team.lead(id)?.config.autoModels || orchestrator?.config.autoModels)) {
          await team.setModels(view.id, autoChain(base), { base });
        }
      }
      const automations = this.#o.automations?.();
      for (const a of plan.automations) {
        if (!automations) break;
        const participants = a.participants
          .map((n) => team.get(n)?.config.id)
          .filter((x): x is string => x !== undefined && x !== lead.config.id);
        const made = automations.create(
          {
            name: a.name,
            project: id,
            participants,
            schedule: a.schedule,
            objective: a.objective,
            ...(a.resultsFolder ? { resultsFolder: a.resultsFolder } : {}),
            ...(a.notify ? { notify: a.notify } : {}),
            status: 'draft',
          },
          by,
          draft.createdBy,
          plan.taint ? { taint: plan.taint.source } : undefined,
        );
        automationDrafts.push(made.id);
      }
    } catch (err) {
      await this.#undo(draft, created, automationDrafts, madeFolder);
      if (err instanceof TeamError) {
        throw new ProjectError(
          err.code === 'invalid_name' ? 'name_taken' : 'invalid_request',
          err.message,
        );
      }
      throw err;
    }
    await this.#reload();
    const saved = this.#require(id);
    this.#event('confirmed', saved, by, { agents: created });
    return this.view(saved);
  }

  /** A confirmation that failed halfway: what it made goes, the draft is saved again. */
  async #undo(
    draft: Project,
    agents: string[],
    automations: string[],
    folder?: string,
  ): Promise<void> {
    const svc = this.#o.automations?.();
    for (const a of automations) {
      try {
        svc?.remove(a, 'system');
      } catch {
        // already gone
      }
    }
    // Monsters made a moment ago: no memory, no work; their folders go.
    for (const a of agents) rmSync(join(this.#o.team.dir, a), { recursive: true, force: true });
    // Never back to the draft over a project that another confirmation made real (D-103).
    const now = this.#o.team.project(draft.id);
    const otherLead =
      now?.status === 'active' && now.lead !== undefined && !agents.includes(now.lead);
    if (!otherLead) this.#o.team.projectStore.save(draft);
    if (folder) {
      try {
        if (readdirSync(folder).length === 0) rmSync(folder, { recursive: true, force: true });
      } catch {
        // not there
      }
    }
    await this.#reload();
  }

  /**
   * "Approva" (D-103): CLAUDE.md and AGENTS.md of the folder, as they are now,
   * are the user's again; the runs of the project's monsters start clean.
   */
  approveDocs(id: string, by: Channel): Promise<ProjectView> {
    return this.#serial(id, async () => {
      const p = this.#confirmed(id);
      if (!p.folder) {
        throw new ProjectError('invalid_request', projectStrings().noFolder(p.name));
      }
      this.#o.team.projectStore.save({
        ...p,
        folderDocs: docsApproval(p.folder, this.#now()),
        updatedAt: this.#now(),
      });
      await this.#reload();
      const saved = this.#require(p.id);
      this.#event('docs_approved', saved, by);
      return this.view(saved);
    });
  }

  /**
   * A change to CLAUDE.md or AGENTS.md of the folder that the user applied
   * (D-113): `write` checks the proposal, writes the file and answers with the
   * hash of the instructions to approve now, or null when they stay to
   * approve (the decision is `write`'s, from the texts it read and wrote:
   * never a new read of the folder).
   */
  applyFolderDoc(
    id: string,
    write: (p: Project & { folder: string }) => string | null,
    by: Channel,
  ): Promise<ProjectView> {
    return this.#serial(id, async () => {
      const p = this.#confirmed(id);
      if (!p.folder || !isFolder(p.folder)) {
        throw new ProjectError('invalid_folder', projectStrings().folderGone(p.name));
      }
      const hash = write({ ...p, folder: p.folder });
      if (hash === null) return this.view(this.#require(p.id));
      this.#o.team.projectStore.save({
        ...p,
        folderDocs: { hash, approvedAt: this.#now() },
        updatedAt: this.#now(),
      });
      await this.#reload();
      const saved = this.#require(p.id);
      this.#event('docs_approved', saved, by);
      return this.view(saved);
    });
  }

  // --- "Ferma progetto" (D-098) -----------------------------------------------------------

  /**
   * Stops the work of a project's monsters: their runs (with what they
   * delegated), the work of `project_send` that waited for the lead, the giri
   * of automations that waited. Not the kill switch: the rest of Monsters goes on.
   */
  async stop(id: string, by: Channel): Promise<ProjectStopResponse> {
    const p = this.#active(id);
    const agents = new Set(this.#o.team.members(p.id).map((a) => a.config.id));
    const runs = this.#o.runs.activeRuns().filter((r) => agents.has(r.agent));
    const reason = projectStrings().stoppedReason(p.name);
    for (const r of runs) await this.#o.runs.killRun(r.id, { by, reason });
    const dropped = this.#o.dispatcher.dropOwnDeferred(agents);
    for (const runId of dropped) {
      for (const s of this.#sends.get(runId) ?? []) this.#report(s, 'aborted', runId, 'stopped');
      this.#sends.delete(runId);
    }
    const giri =
      this.#o.automations?.()?.cancelWaiting(agents, projectStrings().giroNotStarted(reason)) ?? 0;
    this.#event('stopped', p, by, { runs: runs.length });
    return { runsStopped: runs.length, sendsDropped: dropped.length, giriSkipped: giri };
  }

  #confirmed(id: string): Project {
    const p = this.#active(id);
    if (p.status === 'draft') {
      throw new ProjectError('project_draft', projectStrings().stillDraftConfirm(p.name));
    }
    return p;
  }

  /** A copy of a monster, or a new one, joins the project. */
  async addMember(id: string, req: ProjectMemberRequest, by: Channel): Promise<ProjectView> {
    const p = this.#confirmed(id);
    if ('copyOf' in req) await this.#o.squad.copyInto(p.id, req.copyOf, req.name, by);
    else await this.#o.squad.create(req, by, { project: p.id });
    return this.get(p.id);
  }

  async removeMember(id: string, agent: string, by: Channel): Promise<ProjectView> {
    const p = this.#active(id);
    await this.#o.squad.removeFromProject(p.id, agent, by);
    return this.get(p.id);
  }

  /** A message of the user to the project: its lead receives it (D-097). */
  send(
    id: string,
    params: { text: string; channel: Channel; attachments?: string[] | undefined },
  ): SendResult {
    const p = this.#confirmed(id);
    const lead = this.#o.team.lead(p.id);
    if (!lead) throw new ProjectError('project_draft', projectStrings().noLead(p.name));
    return this.#o.dispatcher.send({
      text: params.text,
      to: lead.config.id,
      channel: params.channel,
      ...(params.attachments?.length ? { attachments: params.attachments } : {}),
    });
  }

  spend(id: string): ProjectSpendView {
    const p = this.#require(id);
    return this.#o.spend.projectView(p.id);
  }

  // --- project_send and project_report (D-097) -------------------------------------------

  /**
   * The orchestrator gives a project some work: a message in the lead's chat
   * (channel `system`, `from` the orchestrator), a run of the lead (or its run
   * already at work). The lead's last answer comes back as `project_report`.
   */
  sendFrom(
    from: string,
    project: string,
    text: string,
    /** The orchestrator's run: the lead's run inherits its taint (D-098). */
    fromRun?: string,
  ): SendResult & { project: Project } {
    const p = this.#o.team.project(project);
    if (!p || p.archivedAt !== undefined) {
      throw new ProjectError('unknown_project', projectStrings().unknownProject(project));
    }
    if (p.status === 'draft') {
      throw new ProjectError('project_draft', projectStrings().stillDraft(p.name));
    }
    const lead = this.#o.team.lead(p.id);
    if (!lead) throw new ProjectError('project_draft', projectStrings().noLead(p.name));
    const sent = this.#o.dispatcher.send({
      text,
      to: lead.config.id,
      channel: 'system',
      from,
      ...(fromRun ? { fromRun } : {}),
    });
    return { ...sent, project: p };
  }

  #onEvent(e: LogEvent): void {
    if (e.type === 'message' && e.agent === 'user' && e.data.from && e.data.to && e.runId) {
      const project = this.#o.team.projectOf(e.data.to);
      if (!project || this.#o.team.byId(e.data.to)?.config.kind !== 'lead') return;
      this.#track({
        request: e.id,
        from: e.data.from,
        project: project.id,
        lead: e.data.to,
        runId: e.runId,
      });
      return;
    }
    // The kill switch: what waited for a lead never starts (the runs at work end on their own).
    if (e.type === 'kill' && e.data.scope === 'global') {
      for (const [runId, sends] of [...this.#sends]) {
        // Started: its own `run aborted` reports it.
        if (this.#o.log.query({ runId, type: 'run', limit: 1 }).length > 0) continue;
        this.#sends.delete(runId);
        for (const s of sends) this.#report(s, 'aborted', runId, 'stopped');
      }
      return;
    }
    if (e.type !== 'run' || !e.runId || e.data.status === 'started') return;
    const sends = this.#sends.get(e.runId);
    if (!sends) return;
    this.#sends.delete(e.runId);
    // Cut by the closing of the core: the report says so (D-098).
    const reason =
      e.data.reason === 'shutdown' || e.data.reason === 'restart' ? 'restart' : undefined;
    for (const s of sends) this.#report(s, e.data.status, e.runId, reason);
  }

  /** The lead's last answer after the request goes back to the orchestrator as `project_report`. */
  #report(
    s: PendingSend,
    status: 'completed' | 'failed' | 'aborted' | 'waiting_user',
    runId: string,
    reason?: 'restart' | 'stopped',
  ): void {
    const answer = this.#o.log
      .query({ runId, type: 'message', agent: s.lead, order: 'desc', limit: 200 })
      .find(
        (m): m is LogEvent<'message'> =>
          m.type === 'message' &&
          m.data.role === 'agent' &&
          !m.data.partial &&
          m.parentId === null &&
          m.id > s.request,
      );
    const text = answer?.data.text.trim() ?? '';
    const empty =
      reason === 'restart'
        ? projectStrings().reportRestart
        : reason === 'stopped'
          ? projectStrings().reportStopped
          : projectStrings().reportNoAnswer;
    // Written by the system (the lead is in `data`): the orchestrator's chat reads it.
    this.#o.log.append({
      agent: 'system',
      runId,
      type: 'project_report',
      data: {
        project: s.project,
        lead: s.lead,
        to: s.from,
        request: s.request,
        status,
        summary: text.length > REPORT_CHARS ? `${text.slice(0, REPORT_CHARS - 1)}…` : text || empty,
        ...(reason ? { reason } : {}),
      },
    });
  }

  /** The lead's report of this request is written (its run `runId` ended). */
  reported(runId: string, request: string): boolean {
    return this.#o.log
      .query({ runId, type: 'project_report', limit: 50 })
      .some((e) => e.type === 'project_report' && e.data.request === request);
  }

  /** Every project in use with what its lead is doing (`project_status`, `/stato`). */
  status(to?: string): ProjectStatusLine[] {
    const { team, log } = this.#o;
    const reports = log
      .query({ type: 'project_report', order: 'desc', limit: 200 })
      .filter((e): e is LogEvent<'project_report'> => e.type === 'project_report')
      .filter((e) => to === undefined || e.data.to === to);
    const pending = [...this.#sends.values()].flat();
    return team.activeProjects().map((p) => {
      const lead = team.lead(p.id);
      const s = lead ? team.state(lead.config.id) : undefined;
      const last = reports.find((r) => r.data.project === p.id);
      return {
        id: p.id,
        name: p.name,
        ...(lead && s
          ? {
              lead: {
                id: lead.config.id,
                name: lead.config.name,
                state: s.state,
                ...(s.activity ? { activity: s.activity } : {}),
              },
            }
          : {}),
        members: team.members(p.id).length,
        pending: pending.filter((x) => x.project === p.id).length,
        ...(last
          ? {
              lastReport: {
                status: last.data.status,
                summary: last.data.summary,
                ts: last.ts,
                runId: last.runId,
              },
            }
          : {}),
      };
    });
  }
}

/** A text of a proposal that ends in the lead's AGENTS.md or on the card, checked (D-079). */
function clean(field: string, raw: string): string {
  const r = proposalText(field, raw);
  if (r.problem) throw new ProjectError('invalid_request', r.problem);
  return r.text;
}

/** An objective of a proposed automation, checked like the other proposals (lines kept, D-103). */
function cleanObjective(field: string, raw: string): string {
  const r = proposalText(field, raw, { multiline: true, tail: OBJECTIVE_TEXT_TAIL });
  if (r.problem) throw new ProjectError('invalid_request', r.problem);
  return r.text;
}

/** The instructions of a folder as they are now, approved (D-103). */
function docsApproval(folder: string, at: number): { hash: string; approvedAt: number } {
  return { hash: projectDocsHash(folder), approvedAt: at };
}

/**
 * Why `path` cannot be the folder of a project, or null: the home or a folder that holds it,
 * a root, a dotfolder of the home (keys and settings of the user's programs), or the folders
 * where the system keeps its settings (`Library`, `AppData`). A project's monsters all read and
 * write in it (D-097).
 *
 * The system temp folder is not a settings folder even where it lives under the home (on
 * Windows `%TEMP%` is `AppData\Local\Temp`): `tmp` (default `os.tmpdir()`) and its subfolders
 * are allowed, and so is any subfolder of `AppData\Local\Temp`. `AppData` itself and its
 * program folders (`Roaming`, `Local`, `LocalLow`, anything inside them) stay refused.
 */
export function projectFolderRefusal(
  path: string,
  home: string,
  opts: { platform?: NodeJS.Platform; tmp?: string } = {},
): string | null {
  const platform = opts.platform ?? process.platform;
  const p = platform === 'win32' ? win32 : posix;
  const abs = p.resolve(path);
  if (p.dirname(abs) === abs) {
    return projectStrings().rootFolder;
  }
  const h = p.resolve(home);
  if (mayBeInside(abs, h, platform)) {
    return projectStrings().homeFolder;
  }
  if (mayBeInside(h, abs, platform)) {
    const tmp = p.resolve(opts.tmp ?? tmpdir());
    if (abs !== tmp && mayBeInside(tmp, abs, platform)) return null;
    const parts = abs
      .slice(h.length)
      .split(p.sep)
      .filter(Boolean)
      .map((x) => x.toLowerCase());
    const first = parts[0] ?? '';
    if (first === 'appdata' && parts[1] === 'local' && parts[2] === 'temp' && parts.length > 3) {
      return null;
    }
    if (first.startsWith('.') || first === 'library' || first === 'appdata') {
      return projectStrings().insideHome(first.startsWith('.'));
    }
  }
  return null;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `child` is the area `parent` or a folder inside it (notes' paths, case-insensitive). */
function inArea(parent: string, child: string): boolean {
  const a = parent.toLowerCase();
  const b = child.toLowerCase();
  return a === b || b.startsWith(`${a}/`);
}

/** Caps without empty values (as the spending settings keep them). */
function cleanCaps(caps: SpendAgentCaps): SpendAgentCaps {
  const out: SpendAgentCaps = {};
  if (caps.dailyEur != null) out.dailyEur = caps.dailyEur;
  if (caps.monthlyEur != null) out.monthlyEur = caps.monthlyEur;
  return out;
}
