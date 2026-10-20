import { slugify, type MonsterGenome } from '@monsters/monster-kit';
import {
  MOON_NAMES,
  ProjectNameSchema,
  type ProjectPlanMember,
  type ProjectView,
} from '@monsters/shared';
import { PERSONAL_SQUAD } from './automations.ts';
import { monsterFor } from './monsters.ts';

/*
 * Projects in the UI (plan of 17/10 §3 B1, D-097, D-100): the squads of the
 * sidebar (the personal one, then one per active project with its lead
 * first), the free name a copied monster gets (as the core proposes it), the
 * folder a new project would get, and the plan of a proposed project in
 * words for "Da rivedere".
 */

/** What the squads need of a monster (an `AgentView`, or a summary in the tests). */
export interface SquadMember {
  id: string;
  name: string;
  isOrchestrator: boolean;
  project?: string | undefined;
  isLead?: boolean | undefined;
}

export interface Squad<T extends SquadMember> {
  /** The project's id, or '' for the personal squad. */
  key: string;
  label: string;
  /** The project, once the list has arrived (absent for the personal squad). */
  project?: ProjectView;
  /** The lead first, then the others in the team's order. */
  members: T[];
}

/** Whether a project is in use: confirmed and not archived (drafts and archived ones have no squad). */
export function isLive(p: Pick<ProjectView, 'status' | 'archived'>): boolean {
  return p.status === 'active' && !p.archived;
}

/**
 * The orchestrator (the God of the monsters, above every squad) and the
 * squads: the personal one (its monsters without a project), then the active
 * projects in the core's order. A monster of a project the list does not
 * have yet (it arrives after the team) still gets its group, named by id.
 */
export function squadsOf<T extends SquadMember>(
  agents: readonly T[],
  projects: readonly ProjectView[] | null,
): { god: T | null; squads: Squad<T>[] } {
  const god = agents.find((a) => a.isOrchestrator) ?? null;
  const personal: Squad<T> = { key: '', label: PERSONAL_SQUAD, members: [] };
  const byProject = new Map<string, Squad<T>>();
  for (const p of projects ?? []) {
    if (isLive(p)) byProject.set(p.id, { key: p.id, label: p.name, project: p, members: [] });
  }
  const archived = new Set((projects ?? []).filter((p) => !isLive(p)).map((p) => p.id));
  for (const a of agents) {
    if (a === god) continue;
    if (!a.project) {
      personal.members.push(a);
      continue;
    }
    if (archived.has(a.project)) continue;
    let g = byProject.get(a.project);
    if (!g) {
      g = { key: a.project, label: a.project, members: [] };
      byProject.set(a.project, g);
    }
    g.members.push(a);
  }
  for (const g of byProject.values()) {
    // The lead first; the others keep the team's order.
    g.members.sort((x, y) => Number(y.isLead === true) - Number(x.isLead === true));
  }
  const squads = [personal, ...[...byProject.values()].filter((g) => g.members.length > 0)];
  return { god, squads };
}

/** Names and ids compared as the core does: case and accents apart, the id they would get. */
function keyOf(name: string): string {
  return slugify(name.replace(/\s+/g, ' ').trim());
}

/**
 * The free name of a copy in a project, as the core proposes it (`TeamManager.freeName`):
 * a free name of the moons, like a new monster's; null when none is free (the user picks one).
 */
export function freeCopyName(taken: readonly string[]): string | null {
  const used = new Set(taken.flatMap((n) => [n.toLowerCase(), keyOf(n)]));
  return MOON_NAMES.find((c) => !used.has(c.toLowerCase()) && !used.has(keyOf(c))) ?? null;
}

/**
 * The free name of a monster restored into a project, as the core proposes it (D-097,
 * `TeamManager.copyName`): "Rhea · Saturday", then "Rhea di Saturday", then a
 * free name of the moons; null when none is free (the user picks one).
 * Names are unique across every squad, and at most 24 characters.
 */
export function copyName(
  source: string,
  projectName: string,
  taken: readonly string[],
): string | null {
  const used = new Set(taken.flatMap((n) => [n.toLowerCase(), keyOf(n)]));
  const words = projectName
    .replace(/[^\p{L}\p{M}' -]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidates: string[] = [];
  if (words) {
    for (const sep of [' · ', ' di ']) {
      const room = 24 - source.length - sep.length;
      if (room >= 2) candidates.push(`${source}${sep}${words.slice(0, room).trim()}`);
    }
  }
  candidates.push(...MOON_NAMES);
  return candidates.find((c) => !used.has(c.toLowerCase()) && !used.has(keyOf(c))) ?? null;
}

/** Where a new folder goes when the user does not say (the core's `~/Monsters Progetti/<name>`). */
export function newFolderPath(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Progetto';
  return `~/Monsters Progetti/${clean}`;
}

/**
 * A new folder named after the project inside `parent` (a folder chosen with the system's
 * dialog), with the separator `parent` already uses (`\` on Windows).
 */
export function newFolderIn(parent: string, name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Progetto';
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${sep}${clean}`;
}

/** Why a project's name will not do, in Italian; null when it is fine. */
export function projectNameProblem(
  name: string,
  others: readonly Pick<ProjectView, 'id' | 'name'>[],
  self?: string,
): string | null {
  const parsed = ProjectNameSchema.safeParse(name);
  if (!parsed.success) {
    return name.trim()
      ? 'Solo lettere, numeri, spazi, apostrofi e trattini (al massimo 40).'
      : 'Dai un nome al progetto.';
  }
  const lower = parsed.data.toLowerCase();
  const other = others.find((p) => p.id !== self && p.name.toLowerCase() === lower);
  return other ? `C’è già un progetto che si chiama ${other.name}.` : null;
}

/** Whether a path is written in full (`/…`, `~/…`, `C:\…`): the core wants an absolute folder. */
export function looksAbsolute(path: string): boolean {
  const p = path.trim();
  return p.startsWith('/') || p === '~' || p.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(p);
}

/** A monster a proposal brings: a new one (its draft) or a copy of a monster of another squad. */
export interface PlannedMember {
  name: string;
  /** The role in a few words (a new one), or "copia di Rhea". */
  detail: string;
  /** The look: the draft's genome, or the copied monster's id (its look comes from the team). */
  genome?: unknown;
  copyOf?: string;
}

/** The monsters of a plan in words, the names a copy will have when the plan does not say. */
export function plannedMembers(
  members: readonly ProjectPlanMember[],
  projectName: string,
  nameOf: (id: string) => string,
  taken: readonly string[],
): PlannedMember[] {
  const given: string[] = [];
  return members.map((m) => {
    if ('draft' in m) {
      given.push(m.draft.name);
      return { name: m.draft.name, detail: m.draft.role, genome: m.draft.genome };
    }
    const source = nameOf(m.copyOf);
    const name = m.name ?? freeCopyName([...taken, ...given]) ?? source;
    given.push(name);
    return {
      name,
      detail: `con il ruolo e le regole di ${source}; nome, aspetto e memoria suoi`,
      genome: monsterFor(name),
      copyOf: m.copyOf,
    };
  });
}

/** What the lead of a plan will be, in words: "Atlas, nuovo" or "copia di Rhea". */
export function plannedLead(
  draft: Pick<ProjectView, 'plan' | 'name'>,
  nameOf: (id: string) => string,
): { name: string | null; detail: string; copyOf?: string } {
  const lead = draft.plan?.lead ?? {};
  if (lead.from) {
    return {
      name: lead.name ?? null,
      detail: `con il ruolo e le regole di ${nameOf(lead.from)}; nome, aspetto e memoria suoi`,
      copyOf: lead.from,
    };
  }
  return { name: lead.name ?? null, detail: 'nuovo, con una memoria sua' };
}

/**
 * The look of a plan's lead before it is born (D-102): the one its name gives (`monsterFor`: the roster's monster or one
 * generated from the name, the same the core gives a new lead at the
 * confirmation, `monsterForMember(name, [])`; core/test/projects.test.ts keeps
 * them equal). A lead without a name yet gets one at the confirmation: until
 * then the look comes from the project's name. Nothing is saved.
 */
export function plannedLeadLook(draft: Pick<ProjectView, 'plan' | 'name'>): {
  genome: MonsterGenome;
  name: string;
} {
  const lead = draft.plan?.lead ?? {};
  const name = lead.name ?? draft.name;
  return { genome: monsterFor(name), name };
}
