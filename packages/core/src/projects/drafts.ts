import type {
  Channel,
  DraftConfirmResponse,
  DraftKind,
  DraftView,
  LogEvent,
  Project,
} from '@monsters/shared';
import type { AutomationService } from '../automations/service.ts';
import { MemoryProposalError, type MemoryProposals } from '../team/memory-proposals.ts';
import { createRequestOf, TeamError, type TeamManager } from '../team/team-manager.ts';
import type { TeamService } from '../team/team-service.ts';
import { DocsError, type DocsProposals } from './docs-proposals.ts';
import { projectStrings } from './projects.strings.ts';
import { ProjectError, type ProjectService } from './service.ts';

/*
 * Drafts in one list (D-098, contract in shared/src/drafts.ts): the new
 * monsters proposed with `team_propose_monster`, the projects proposed with
 * `project_propose` (or saved as drafts from the app), the automations
 * proposed with `automation_propose` (or saved as drafts), the changes to
 * CLAUDE.md and AGENTS.md proposed with `project_docs_propose` (D-113), the lines of memory
 * of a run that is not only the user's (review of 18/10, A2). "Da rivedere" and
 * Telegram show them; confirming or discarding goes through the flow each
 * kind already had, so the checks are the same as from the app.
 */

export type DraftErrorCode = 'unknown_draft' | 'draft_closed' | 'docs_changed';

export class DraftError extends Error {
  readonly code: DraftErrorCode;
  readonly status: 404 | 409;
  constructor(code: DraftErrorCode, message: string) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
    this.status = code === 'unknown_draft' ? 404 : 409;
  }
}

export interface DraftServiceOptions {
  team: TeamService;
  squad: TeamManager;
  projects: ProjectService;
  automations: () => AutomationService | undefined;
  /** The proposals for CLAUDE.md and AGENTS.md of the projects' folders (D-113). */
  docs: DocsProposals;
  /** Lines of memory waiting for the user (review of 18/10, A2). */
  memory?: MemoryProposals;
}

export class DraftService {
  readonly #o: DraftServiceOptions;

  constructor(options: DraftServiceOptions) {
    this.#o = options;
  }

  #name(id: string): string | undefined {
    return id === 'user' ? undefined : this.#o.team.byId(id)?.config.name;
  }

  #projectSummary(p: Project): string {
    const plan = p.plan;
    const who = this.#name(p.createdBy);
    const names = (plan?.members ?? []).map((m) =>
      'draft' in m
        ? m.draft.name
        : (m.name ?? this.#o.team.byId(m.copyOf)?.config.name ?? m.copyOf),
    );
    // The folder its monsters get, read and write (review of ondate 3-4, n. 6).
    return projectStrings().projectDraftSummary({
      who,
      name: p.name,
      lead: plan?.lead.name,
      members: names,
      automations: plan?.automations.length ?? 0,
      folder: p.folder,
    });
  }

  /** Every open draft, newest first. */
  list(): DraftView[] {
    const { team, squad, projects } = this.#o;
    const out: DraftView[] = [];
    for (const e of squad.openProposals()) {
      const draft = e.data.draft;
      if (!draft) continue;
      const who = this.#name(e.data.from);
      out.push({
        kind: 'monster',
        id: e.id,
        title: draft.name,
        summary: projectStrings().monsterDraftSummary(who, draft.name, draft.role),
        from: e.data.from,
        ...(who ? { fromName: who } : {}),
        ...(e.data.project ? { project: e.data.project } : {}),
        createdAt: e.ts,
        monster: { draft, ...(e.data.models ? { models: e.data.models } : {}) },
      });
    }
    for (const p of team.projects()) {
      if (p.status !== 'draft' || p.archivedAt !== undefined) continue;
      const who = this.#name(p.createdBy);
      out.push({
        kind: 'project',
        id: p.id,
        title: p.name,
        summary: this.#projectSummary(p),
        from: p.createdBy,
        ...(who ? { fromName: who } : {}),
        project: p.id,
        createdAt: p.createdAt,
        projectDraft: projects.view(p),
      });
    }
    for (const a of this.#o.automations()?.list() ?? []) {
      if (a.status !== 'draft') continue;
      const who = this.#name(a.createdBy);
      out.push({
        kind: 'automation',
        id: a.id,
        title: a.name,
        summary: projectStrings().automationDraftSummary(who, a.name, a.scheduleText),
        from: a.createdBy,
        ...(who ? { fromName: who } : {}),
        ...(a.project ? { project: a.project } : {}),
        createdAt: a.createdAt,
        automation: a,
      });
    }
    out.push(...this.#docsDrafts());
    for (const e of this.#o.memory?.open() ?? []) {
      const v = this.#o.memory?.view(e);
      if (v) out.push(v);
    }
    return out.sort((x, y) => y.createdAt - x.createdAt);
  }

  /** The open proposals for the instructions of active projects, with the file as it is now. */
  #docsDrafts(): DraftView[] {
    const out: DraftView[] = [];
    for (const e of this.#o.docs.open()) {
      const v = this.#o.docs.view(e, this.#o.team.project(e.data.project), this.#name(e.data.from));
      if (v) out.push(v);
    }
    return out;
  }

  get(kind: DraftKind, id: string): DraftView | undefined {
    return this.list().find((d) => d.kind === kind && d.id === id);
  }

  /** The draft becomes real, as proposed (to change it first: its own form). */
  async confirm(kind: DraftKind, id: string, by: Channel): Promise<DraftConfirmResponse> {
    const d = this.#open(kind, id);
    if (d.kind === 'monster') {
      try {
        const made = await this.#o.squad.create(
          { ...createRequestOf(d.monster.draft), proposal: d.id },
          by,
        );
        return { kind, id, agent: made.id };
      } catch (err) {
        throw this.#closed(err);
      }
    }
    if (d.kind === 'project') {
      try {
        const p = await this.#o.projects.confirm(d.id, by);
        const drafts = (this.#o.automations()?.list() ?? [])
          .filter((a) => a.project === p.id && a.status === 'draft')
          .map((a) => a.id);
        return {
          kind,
          id,
          project: p.id,
          ...(drafts.length > 0 ? { automationDrafts: drafts } : {}),
        };
      } catch (err) {
        throw this.#closed(err);
      }
    }
    if (d.kind === 'docs') {
      try {
        const p = await this.#o.docs.apply(d.id, by);
        return { kind, id, project: p.id };
      } catch (err) {
        throw this.#closed(err);
      }
    }
    if (d.kind === 'memory') {
      try {
        const done = await this.#o.memory!.confirm(d.id, by);
        return { kind, id, agent: done.agent };
      } catch (err) {
        throw this.#closed(err);
      }
    }
    const automations = this.#o.automations();
    if (!automations) throw new DraftError('unknown_draft', projectStrings().automationsMissing);
    const a = automations.update(d.id, { status: 'active' }, by);
    return { kind, id, automation: a.id };
  }

  /** The draft is left aside: nothing is created, the proposer reads it at its next turn. */
  async discard(kind: DraftKind, id: string, by: Channel): Promise<{ ok: true }> {
    const d = this.#open(kind, id);
    if (d.kind === 'monster') {
      try {
        await this.#o.squad.discardProposal(d.id, by);
      } catch (err) {
        throw this.#closed(err);
      }
    } else if (d.kind === 'project') {
      await this.#o.projects.discard(d.id, by);
    } else if (d.kind === 'docs') {
      try {
        await this.#o.docs.discard(d.id, by);
      } catch (err) {
        throw this.#closed(err);
      }
    } else if (d.kind === 'memory') {
      try {
        await this.#o.memory!.discard(d.id, by);
      } catch (err) {
        throw this.#closed(err);
      }
    } else {
      this.#o.automations()?.discard(d.id, by);
    }
    return { ok: true };
  }

  #open(kind: DraftKind, id: string): DraftView {
    const d = this.get(kind, id);
    if (d) return d;
    // Gone, or already answered: say which.
    const known =
      (kind === 'project' && this.#o.team.project(id) !== undefined) ||
      (kind === 'automation' && (this.#o.automations()?.list() ?? []).some((a) => a.id === id)) ||
      (kind === 'docs' && this.#o.docs.known(id)) ||
      (kind === 'memory' && (this.#o.memory?.known(id) ?? false)) ||
      kind === 'monster';
    throw new DraftError(
      known && kind !== 'monster' ? 'draft_closed' : 'unknown_draft',
      known && kind !== 'monster'
        ? projectStrings().draftClosed
        : projectStrings().draftUnknownUsed,
    );
  }

  #closed(err: unknown): unknown {
    if (err instanceof TeamError && err.code === 'proposal_closed') {
      return new DraftError('draft_closed', projectStrings().draftClosed);
    }
    if (err instanceof TeamError && err.code === 'unknown_proposal') {
      return new DraftError('unknown_draft', projectStrings().draftUnknown);
    }
    if (err instanceof ProjectError && err.code === 'not_draft') {
      return new DraftError('draft_closed', projectStrings().draftClosed);
    }
    if (err instanceof MemoryProposalError) {
      if (err.code === 'unknown_proposal') return new DraftError('unknown_draft', err.message);
      if (err.code === 'proposal_closed')
        return new DraftError('draft_closed', projectStrings().draftClosed);
      return err;
    }
    if (err instanceof DocsError) {
      if (err.code === 'unknown_proposal') return new DraftError('unknown_draft', err.message);
      if (err.code === 'proposal_closed')
        return new DraftError('draft_closed', projectStrings().draftClosed);
      if (err.code === 'docs_changed') return new DraftError('docs_changed', err.message);
      return new ProjectError('invalid_folder', err.message);
    }
    return err;
  }
}

/** The key of a draft in Telegram's buttons and messages: `draft:<kind>:<id>`. */
export function draftKey(kind: DraftKind, id: string): string {
  return `draft:${kind}:${id}`;
}

/** Which draft an event opens or closes, for Telegram (D-098). */
export function draftOfEvent(e: LogEvent): {
  kind: DraftKind;
  id: string;
  open: boolean;
  outcome?: 'confirmed' | 'discarded' | 'superseded';
} | null {
  if (e.type === 'monster_proposal') {
    if (e.data.action === 'proposed') return { kind: 'monster', id: e.id, open: true };
    if (e.data.proposalId) {
      return {
        kind: 'monster',
        id: e.data.proposalId,
        open: false,
        outcome: e.data.action === 'created' ? 'confirmed' : 'discarded',
      };
    }
    return null;
  }
  if (e.type === 'project_change') {
    if (e.data.action === 'created' && e.data.status === 'draft') {
      return { kind: 'project', id: e.data.project, open: true };
    }
    if (e.data.action === 'confirmed' || e.data.action === 'discarded') {
      return { kind: 'project', id: e.data.project, open: false, outcome: e.data.action };
    }
    return null;
  }
  if (e.type === 'project_docs_proposal') {
    if (e.data.action === 'proposed') return { kind: 'docs', id: e.id, open: true };
    if (!e.data.proposalId) return null;
    return {
      kind: 'docs',
      id: e.data.proposalId,
      open: false,
      outcome:
        e.data.action === 'applied'
          ? 'confirmed'
          : e.data.action === 'superseded'
            ? 'superseded'
            : 'discarded',
    };
  }
  if (e.type === 'memory') {
    if (e.data.action === 'proposed') return { kind: 'memory', id: e.id, open: true };
    if (!e.data.proposalId) return null;
    return {
      kind: 'memory',
      id: e.data.proposalId,
      open: false,
      outcome: e.data.action === 'remembered' ? 'confirmed' : 'discarded',
    };
  }
  if (e.type === 'automation_change') {
    if (e.data.action === 'created' && e.data.status === 'draft') {
      return { kind: 'automation', id: e.data.automationId, open: true };
    }
    if (
      e.data.action === 'confirmed' ||
      e.data.action === 'discarded' ||
      e.data.action === 'deleted'
    ) {
      return {
        kind: 'automation',
        id: e.data.automationId,
        open: false,
        outcome: e.data.action === 'confirmed' ? 'confirmed' : 'discarded',
      };
    }
  }
  return null;
}
