import {
  MAX_PROJECT_MEMBERS,
  MOON_NAMES,
  PROJECTS_VAULT_FOLDER,
  ProjectCreateRequestSchema,
  ProjectMemberRequestSchema,
  ProjectUpdateRequestSchema,
  SPEND_WARN_AT,
  type AgentSummary,
  type DraftConfirmResponse,
  type DraftView,
  type EventInput,
  type Project,
  type ProjectLeadPlan,
  type ProjectPlan,
  type ProjectSpendView,
  type ProjectView,
  type SpendAgentCaps,
  type SpendMeterView,
  type SpendView,
} from '@monsters/shared';
import { copyName, freeCopyName } from '../projects.ts';
import { colorOf, monsterFor } from '../monsters.ts';
import type { RawResponse } from '../transport.ts';
import { tr } from './lang.ts';

/*
 * `/api/projects` of the mock core (D-097, D-098; contract in
 * shared/src/projects.ts), and the project drafts of `/api/drafts`. The
 * projects live here, their monsters in the mock's team with `project` (and
 * `isLead` for the lead), as the core's `agent.yaml`. The demo has "Social di
 * Saturday" (Iapetus the lead, Calypso the social media manager, Pandora the
 * graphic designer, "Post della settimana" every Sunday) and a draft the
 * orchestrator proposed, "Sito di Saturday".
 */

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

export const DEMO_PROJECT_ID = 'social-di-saturday';
export const DEMO_DRAFT_ID = 'sito-di-saturday';

/** The demo project's folder in the notes (the demo draft's is `Projects/Saturday website`). */
export const DEMO_AREA = () => tr('Projects/Saturday Social', 'Progetti/Social di Saturday');

export interface MockProjectsHost {
  agents: () => AgentSummary[];
  setAgents: (list: AgentSummary[]) => void;
  log: (event: EventInput, ts?: number) => void;
  spend: () => SpendView;
  /** Ids of the monsters at work now (a scripted run). */
  working: () => string[];
  /** A first automation of a confirmed proposal, as a draft (D-098). */
  automationDraft: (input: {
    name: string;
    lead: string;
    project: string;
    participants: string[];
    cron: string;
    objective: string;
    createdBy: string;
  }) => string;
}

interface Stored extends Project {
  /** The monsters archived with it (a restore brings them back). */
  archivedAgents?: AgentSummary[];
}

function idFor(name: string, taken: (id: string) => boolean): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'progetto';
  const base = /^[a-z]/.test(slug) ? slug : `p-${slug}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

const agentId = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'mostro';

const projectNameTaken = (name: string) =>
  tr(`There’s already a project called ${name}.`, `C’è già un progetto che si chiama ${name}.`);
const archivedMessage = (name: string) =>
  tr(`The project ${name} is archived.`, `Il progetto ${name} è archiviato.`);
const fullPath = () =>
  tr(
    'Write the full path of the project folder.',
    'Scrivi il percorso completo della cartella del progetto.',
  );

const looksAbsolute = (p: string) => p.startsWith('/') || p.startsWith('~/') || p === '~';

export class MockProjects {
  private readonly h: MockProjectsHost;
  private readonly defs = new Map<string, Stored>();

  constructor(host: MockProjectsHost) {
    this.h = host;
  }

  /* ---------------------------------------------------------------- demo */

  /**
   * The demo's project with its three monsters (before the automations: they use them);
   * `seedDraft` after the rest of the demo, so the log stays in order.
   */
  seedDemo(now = Date.now()): void {
    const created = now - 21 * 86_400_000;
    const id = DEMO_PROJECT_ID;
    const team = [
      this.monster(
        'Iapetus',
        tr('Leads Saturday’s social', 'Guida i social di Saturday'),
        id,
        true,
      ),
      this.monster(
        'Calypso',
        tr(
          'Runs the social accounts: plan, copy and hashtags',
          'Gestisce i social: piano, testi e hashtag',
        ),
        id,
      ),
      this.monster(
        'Pandora',
        tr('Makes the graphics for the posts', 'Fa le grafiche dei post'),
        id,
      ),
    ];
    this.h.setAgents([...this.h.agents(), ...team]);
    this.defs.set(id, {
      id,
      name: tr('Saturday Social', 'Social di Saturday'),
      folder: `/home/andrea/${tr('Projects', 'Progetti')}/social-saturday`,
      vaultArea: DEMO_AREA(),
      lead: 'iapetus',
      status: 'active',
      spend: { monthlyEur: 20 },
      connections: { mcp: [], claude: [] },
      webSearch: true,
      createdBy: 'user',
      createdAt: created,
      updatedAt: created,
    });
  }

  /** The orchestrator's proposal (`project_propose`, D-098): a whole project as a draft. */
  seedDraft(ts = Date.now()): void {
    const p: Stored = {
      id: DEMO_DRAFT_ID,
      name: tr('Saturday website', 'Sito di Saturday'),
      folder: tr(
        '/home/andrea/Monsters Projects/Saturday website',
        '/home/andrea/Monsters Progetti/Sito di Saturday',
      ),
      vaultArea: tr('Projects/Saturday website', 'Progetti/Sito di Saturday'),
      status: 'draft',
      plan: {
        lead: {
          name: 'Atlas',
          goal: tr(
            'Redo the Saturday website by the end of the month',
            'Rifare il sito di Saturday entro fine mese',
          ),
        },
        members: [
          {
            draft: {
              name: 'Telesto',
              title: tr('the copywriter', 'la copywriter'),
              role: tr('writes the copy of the pages', 'scrive i testi delle pagine'),
              mission: tr(
                'you write the website copy, clear and in Saturday’s tone',
                'scrivi i testi del sito, chiari e nel tono di Saturday',
              ),
              context: tr(
                'Giulio has entrusted you with the website copy.',
                'Giulio ti ha affidato i testi del sito.',
              ),
              duties: [
                tr(
                  'One note per page, with title and text.',
                  'Una nota per pagina, con titolo e testo.',
                ),
              ],
              area: tr('Projects/Saturday website/Copy', 'Progetti/Sito di Saturday/Testi'),
              web: false,
              genome: { ...monsterFor('Telesto'), id: 'telesto' },
              color: colorOf(monsterFor('Telesto')),
              archetype: null,
              source: 'proposal',
            },
          },
          { copyOf: 'rhea' },
        ],
        automations: [
          {
            name: tr('Website check', 'Controllo del sito'),
            schedule: { cron: '0 9 * * 1', timezone: 'Europe/Rome' },
            objective: tr(
              'Check that the website pages work and sum up what to fix.',
              'Controlla che le pagine del sito funzionino e riassumi cosa sistemare.',
            ),
            participants: ['Telesto'],
          },
        ],
        createFolder: true,
        why: tr(
          'You asked me to redo the website: a squad of its own keeps copy and research in one place.',
          'Mi hai chiesto di rifare il sito: una squadra sua tiene testi e ricerche in un posto solo.',
        ),
      },
      spend: { monthlyEur: 15 },
      connections: { mcp: [], claude: [] },
      webSearch: true,
      createdBy: 'titan',
      createdAt: ts,
      updatedAt: ts,
    };
    this.defs.set(p.id, p);
    this.h.log(
      {
        agent: 'user',
        type: 'project_change',
        data: { action: 'created', project: p.id, name: p.name, from: 'titan', status: 'draft' },
      },
      ts,
    );
  }

  /* --------------------------------------------------------------- views */

  /** Name and folder of an active project (the proposals of its instructions, D-113). */
  activeInfo(id: string): { name: string; folder?: string | undefined } | null {
    const p = this.defs.get(id);
    if (!p || p.status !== 'active' || p.archivedAt !== undefined) return null;
    return { name: p.name, folder: p.folder };
  }

  private members(id: string): AgentSummary[] {
    const list = this.h.agents().filter((a) => a.project === id);
    return [...list.filter((a) => a.isLead), ...list.filter((a) => !a.isLead)];
  }

  view(p: Stored): ProjectView {
    const archived = p.archivedAt !== undefined;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      archived,
      ...(archived ? { archivedAt: p.archivedAt } : {}),
      ...(p.folder ? { folder: p.folder } : {}),
      folderExists: p.folder !== undefined && !(p.status === 'draft' && p.plan?.createFolder),
      vaultArea: p.vaultArea,
      ...(p.lead && !archived ? { lead: p.lead } : {}),
      ...(p.plan ? { plan: p.plan } : {}),
      members: archived
        ? []
        : this.members(p.id).map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            color: a.color,
            genome: a.genome,
            isLead: a.isLead === true,
            state: a.state,
          })),
      maxMembers: MAX_PROJECT_MEMBERS,
      spend: p.spend,
      connections: { mcp: [...p.connections.mcp], claude: [...p.connections.claude] },
      webSearch: p.webSearch,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private list(): ProjectView[] {
    const rank = (p: Stored) => (p.archivedAt !== undefined ? 2 : p.status === 'draft' ? 1 : 0);
    return [...this.defs.values()]
      .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
      .map((p) => this.view(p));
  }

  /** The project drafts for `/api/drafts` (D-098). */
  drafts(): DraftView[] {
    const nameOf = (id: string) => this.h.agents().find((a) => a.id === id)?.name ?? id;
    return [...this.defs.values()]
      .filter((p) => p.status === 'draft' && p.archivedAt === undefined)
      .map((p) => {
        const who = p.createdBy !== 'user' ? nameOf(p.createdBy) : undefined;
        const names = (p.plan?.members ?? []).map((m) =>
          'draft' in m ? m.draft.name : (m.name ?? nameOf(m.copyOf)),
        );
        const autos = p.plan?.automations.length ?? 0;
        return {
          kind: 'project' as const,
          id: p.id,
          title: p.name,
          summary: tr(
            `${who ? `${who} suggests the` : 'Draft of the'} project “${p.name}”: ${
              p.plan?.lead.name ? `lead ${p.plan.lead.name}` : 'a lead'
            }${names.length ? `, with ${names.join(', ')}` : ''}${
              autos ? `; ${autos === 1 ? 'an automation' : `${autos} automations`}` : ''
            }.`,
            `${who ? `${who} propone il` : 'Bozza del'} progetto «${p.name}»: ${
              p.plan?.lead.name ? `capo ${p.plan.lead.name}` : 'un capo'
            }${names.length ? `, con ${names.join(', ')}` : ''}${
              autos ? `; ${autos === 1 ? 'un’automazione' : `${autos} automazioni`}` : ''
            }.`,
          ),
          from: p.createdBy,
          ...(who ? { fromName: who } : {}),
          project: p.id,
          createdAt: p.createdAt,
          projectDraft: this.view(p),
        };
      });
  }

  /** Confirms or discards a project draft (`/api/drafts/project/:id/…`). */
  draftAction(id: string, action: 'confirm' | 'discard'): RawResponse {
    const p = this.defs.get(id);
    if (!p)
      return fail(404, 'unknown_draft', tr('This draft doesn’t exist.', 'Questa bozza non c’è.'));
    if (p.status !== 'draft') {
      return fail(409, 'draft_closed', tr('Draft already closed.', 'Bozza già chiusa.'));
    }
    if (action === 'discard') return this.discard(p);
    const res = this.confirm(p);
    if (res.status !== 200) return res;
    const drafts = (res.body as { automationDrafts?: string[] }).automationDrafts;
    return ok({
      kind: 'project',
      id,
      project: id,
      ...(drafts?.length ? { automationDrafts: drafts } : {}),
    } satisfies DraftConfirmResponse);
  }

  /* -------------------------------------------------------------- monsters */

  private monster(name: string, role: string, project: string, lead = false): AgentSummary {
    const genome = { ...monsterFor(name), id: agentId(name) };
    return {
      id: agentId(name),
      name,
      role,
      color: colorOf(genome),
      isOrchestrator: false,
      genome,
      state: 'idle',
      project,
      ...(lead ? { isLead: true } : {}),
    };
  }

  private taken(name: string): boolean {
    const n = name.toLowerCase();
    return this.h.agents().some((a) => a.name.toLowerCase() === n || a.id === agentId(name));
  }

  private freeName(): string | null {
    return MOON_NAMES.find((n) => !this.taken(n)) ?? null;
  }

  private add(a: AgentSummary): void {
    this.h.setAgents([...this.h.agents(), a]);
    this.h.log({
      agent: 'user',
      type: 'team_change',
      data: { action: 'add', agent: a.id, name: a.name, by: 'ui' },
    });
  }

  private copy(
    p: Stored,
    from: string,
    wanted?: string,
    given: readonly string[] = [],
    lead = false,
  ): AgentSummary | RawResponse {
    const source = this.h.agents().find((a) => a.id === from);
    if (!source)
      return fail(
        404,
        'unknown_agent',
        tr(
          'There’s no monster to copy with this name.',
          'Non c’è nessun mostro da copiare con questo nome.',
        ),
      );
    const taken = [...this.h.agents().map((a) => a.name), ...given];
    const name = wanted ?? freeCopyName(taken) ?? this.freeName();
    if (!name || this.taken(name)) {
      return fail(
        400,
        'invalid_name',
        tr(
          `There’s already a monster called ${name ?? source.name}.`,
          `C’è già un mostro che si chiama ${name ?? source.name}.`,
        ),
      );
    }
    const genome = { ...monsterFor(name), id: agentId(name) };
    return {
      ...source,
      id: agentId(name),
      name,
      color: colorOf(genome),
      genome,
      state: 'idle',
      isOrchestrator: false,
      project: p.id,
      ...(lead
        ? {
            isLead: true,
            role: tr(`Leads the project ${p.name}`, `Guida il progetto ${p.name}`),
          }
        : { isLead: false }),
    };
  }

  private newLead(p: Stored, plan: ProjectLeadPlan): AgentSummary | RawResponse {
    if (plan.from) return this.copy(p, plan.from, plan.name, [], true);
    const name = plan.name ?? this.freeName();
    if (!name || this.taken(name)) {
      return fail(
        400,
        'invalid_name',
        tr(
          `There’s already a monster called ${name ?? 'that'}.`,
          `C’è già un mostro che si chiama ${name ?? 'così'}.`,
        ),
      );
    }
    return this.monster(
      name,
      tr(`Leads the project ${p.name}`, `Guida il progetto ${p.name}`),
      p.id,
      true,
    );
  }

  /* --------------------------------------------------------------- routes */

  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (!path.startsWith('/api/projects')) return null;
    const [id, sub, agent] = path.split('/').slice(3).map(decodeURIComponent);
    if (!id) {
      if (method === 'GET') return ok(this.list());
      if (method === 'POST') return this.create(body);
      return null;
    }
    const p = this.defs.get(id);
    if (!p) {
      return fail(
        404,
        'unknown_project',
        tr(`There’s no project "${id}".`, `Non c’è un progetto "${id}".`),
      );
    }
    if (sub === undefined) {
      if (method === 'GET') return ok(this.view(p));
      if (method === 'PATCH') return this.update(p, body);
      if (method === 'DELETE') {
        if (p.status !== 'draft') {
          return fail(
            409,
            'not_draft',
            tr(
              `${p.name} isn’t a draft: archive it, don’t discard it.`,
              `${p.name} non è una bozza: si archivia, non si lascia stare.`,
            ),
          );
        }
        return this.discard(p);
      }
      return null;
    }
    if (method === 'POST' && sub === 'confirm') {
      if (p.status !== 'draft')
        return fail(
          409,
          'not_draft',
          tr(
            `The project ${p.name} is already confirmed.`,
            `Il progetto ${p.name} è già confermato.`,
          ),
        );
      return this.confirm(p);
    }
    if (method === 'POST' && sub === 'archive') return this.archive(p);
    if (method === 'POST' && sub === 'restore') return this.restore(p);
    if (method === 'POST' && sub === 'stop') return this.stop(p);
    if (method === 'GET' && sub === 'spend') return ok(this.spend(p));
    if (sub === 'members' && method === 'POST' && !agent) return this.addMember(p, body);
    if (sub === 'members' && method === 'DELETE' && agent) return this.removeMember(p, agent);
    return null;
  }

  private change(p: Stored, action: string, extra: Record<string, unknown> = {}): void {
    this.h.log({
      agent: 'user',
      type: 'project_change',
      data: {
        action,
        project: p.id,
        name: p.name,
        by: 'ui',
        ...(p.createdBy !== 'user' && ['created', 'confirmed', 'discarded'].includes(action)
          ? { from: p.createdBy }
          : {}),
        ...extra,
      },
    } as EventInput);
  }

  private create(body: unknown): RawResponse {
    const r = ProjectCreateRequestSchema.safeParse(body);
    if (!r.success) return fail(400, 'invalid_request', r.error.issues[0]?.message);
    const req = r.data;
    const other = [...this.defs.values()].find(
      (x) => x.name.toLowerCase() === req.name.toLowerCase(),
    );
    if (other) return fail(409, 'name_taken', projectNameTaken(other.name));
    if (req.folder && !looksAbsolute(req.folder.path)) {
      return fail(400, 'invalid_folder', fullPath());
    }
    const now = Date.now();
    const p: Stored = {
      id: idFor(req.name, (x) => this.defs.has(x)),
      name: req.name,
      ...(req.folder ? { folder: req.folder.path.replace(/^~(?=\/|$)/, '/home/andrea') } : {}),
      vaultArea: req.vaultArea ?? `${PROJECTS_VAULT_FOLDER}/${req.name}`,
      status: req.status,
      ...(req.status === 'draft' ? { plan: { lead: req.lead, members: [], automations: [] } } : {}),
      spend: req.spend ?? {},
      connections: { mcp: req.connections?.mcp ?? [], claude: req.connections?.claude ?? [] },
      webSearch: req.webSearch ?? true,
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
    };
    if (p.status === 'active') {
      const lead = this.newLead(p, req.lead);
      if ('status' in lead) return lead;
      p.lead = lead.id;
      this.defs.set(p.id, p);
      this.add(lead);
    } else this.defs.set(p.id, p);
    this.change(p, 'created', { status: p.status });
    return ok(this.view(p), 201);
  }

  private update(p: Stored, body: unknown): RawResponse {
    const r = ProjectUpdateRequestSchema.safeParse(body);
    if (!r.success) return fail(400, 'invalid_request', r.error.issues[0]?.message);
    const u = r.data;
    if (p.archivedAt !== undefined) return fail(409, 'project_archived', archivedMessage(p.name));
    if (u.name !== undefined) {
      const other = [...this.defs.values()].find(
        (x) => x.id !== p.id && x.name.toLowerCase() === u.name!.toLowerCase(),
      );
      if (other) return fail(409, 'name_taken', projectNameTaken(other.name));
      p.name = u.name;
    }
    if (u.folder === null) delete p.folder;
    else if (u.folder) {
      if (!looksAbsolute(u.folder.path)) {
        return fail(400, 'invalid_folder', fullPath());
      }
      p.folder = u.folder.path.replace(/^~(?=\/|$)/, '/home/andrea');
      if (p.plan) p.plan = { ...p.plan, createFolder: u.folder.create === true };
    }
    if (u.spend) {
      const merged = { ...p.spend, ...u.spend };
      const clean: SpendAgentCaps = {};
      if (merged.dailyEur != null) clean.dailyEur = merged.dailyEur;
      if (merged.monthlyEur != null) clean.monthlyEur = merged.monthlyEur;
      p.spend = clean;
    }
    if (u.connections) {
      p.connections = {
        mcp: u.connections.mcp ?? p.connections.mcp,
        claude: u.connections.claude ?? p.connections.claude,
      };
    }
    if (u.webSearch !== undefined) p.webSearch = u.webSearch;
    if (u.lead && p.plan) p.plan = { ...p.plan, lead: u.lead };
    p.updatedAt = Date.now();
    if (u.status === 'active' && p.status === 'draft') return this.confirm(p);
    this.change(p, 'updated');
    return ok(this.view(p));
  }

  /** A draft becomes real: its lead, its monsters and its first automations (as drafts). */
  private confirm(p: Stored): RawResponse {
    const plan: ProjectPlan = p.plan ?? { lead: {}, members: [], automations: [] };
    const lead = this.newLead(p, plan.lead);
    if ('body' in lead) return lead;
    const made: AgentSummary[] = [lead];
    for (const m of plan.members) {
      const name = 'draft' in m ? m.draft.name : m.name;
      if (name && (this.taken(name) || made.some((x) => x.name === name))) {
        return fail(
          409,
          'name_taken',
          tr(
            `There’s already a monster called ${name}. Change the name in the draft and confirm again.`,
            `C’è già un mostro che si chiama ${name}. Cambia il nome nella bozza e conferma di nuovo.`,
          ),
        );
      }
      const a: AgentSummary | RawResponse =
        'draft' in m
          ? {
              ...this.monster(m.draft.name, m.draft.role, p.id),
              genome: m.draft.genome,
              color: m.draft.color,
            }
          : this.copy(
              p,
              m.copyOf,
              m.name,
              made.map((x) => x.name),
            );
      if ('body' in a) return a;
      made.push(a);
    }
    this.h.setAgents([...this.h.agents(), ...made]);
    const { plan: _plan, ...rest } = p;
    const next: Stored = { ...rest, status: 'active', lead: lead.id, updatedAt: Date.now() };
    this.defs.set(p.id, next);
    for (const a of made) {
      this.h.log({
        agent: 'user',
        type: 'team_change',
        data: { action: 'add', agent: a.id, name: a.name, by: 'ui' },
      });
    }
    const automationDrafts = plan.automations.map((a) =>
      this.h.automationDraft({
        name: a.name,
        lead: lead.id,
        project: p.id,
        participants: a.participants
          .map((n) => made.find((x) => x.name === n)?.id)
          .filter((x): x is string => x !== undefined && x !== lead.id),
        cron: a.schedule.cron,
        objective: a.objective,
        createdBy: p.createdBy,
      }),
    );
    this.change(next, 'confirmed', { agents: made.map((a) => a.id) });
    return ok({ ...this.view(next), automationDrafts });
  }

  private discard(p: Stored): RawResponse {
    this.defs.delete(p.id);
    this.change(p, 'discarded');
    return ok({ ok: true });
  }

  private archive(p: Stored): RawResponse {
    if (p.status === 'draft')
      return fail(
        409,
        'project_draft',
        tr(
          `${p.name} is a draft: discard it instead of archiving it.`,
          `${p.name} è una bozza: lasciala stare invece di archiviarla.`,
        ),
      );
    if (p.archivedAt !== undefined) return fail(409, 'project_archived', archivedMessage(p.name));
    const members = this.members(p.id);
    this.h.setAgents(this.h.agents().filter((a) => a.project !== p.id));
    p.archivedAgents = members;
    p.archivedAt = Date.now();
    p.updatedAt = p.archivedAt;
    for (const a of members) {
      this.h.log({
        agent: 'user',
        type: 'team_change',
        data: { action: 'archive', agent: a.id, name: a.name, by: 'ui' },
      });
    }
    this.change(p, 'archived', { agents: members.map((a) => a.id) });
    return ok(this.view(p));
  }

  private restore(p: Stored): RawResponse {
    if (p.archivedAt === undefined)
      return fail(
        409,
        'not_archived',
        tr(`The project ${p.name} isn’t archived.`, `Il progetto ${p.name} non è archiviato.`),
      );
    const back = (p.archivedAgents ?? []).map((a) =>
      this.taken(a.name)
        ? {
            ...a,
            name:
              copyName(
                a.name,
                p.name,
                this.h.agents().map((x) => x.name),
              ) ?? a.name,
          }
        : a,
    );
    this.h.setAgents([...this.h.agents(), ...back]);
    delete p.archivedAt;
    delete p.archivedAgents;
    p.updatedAt = Date.now();
    this.change(p, 'restored', { agents: back.map((a) => a.id) });
    return ok(this.view(p));
  }

  private stop(p: Stored): RawResponse {
    const working = new Set(this.h.working());
    const runs = this.members(p.id).filter((a) => working.has(a.id)).length;
    this.change(p, 'stopped', { runs });
    return ok({ runsStopped: runs, sendsDropped: 0, giriSkipped: 0 });
  }

  private addMember(p: Stored, body: unknown): RawResponse {
    if (p.status === 'draft')
      return fail(
        409,
        'project_draft',
        tr(
          `The project ${p.name} is still a draft: confirm it first.`,
          `Il progetto ${p.name} è ancora una bozza: confermalo prima.`,
        ),
      );
    if (p.archivedAt !== undefined) return fail(409, 'project_archived', archivedMessage(p.name));
    const r = ProjectMemberRequestSchema.safeParse(body);
    if (!r.success) return fail(400, 'invalid_request', r.error.issues[0]?.message);
    if (this.members(p.id).filter((a) => !a.isLead).length >= MAX_PROJECT_MEMBERS) {
      return fail(
        409,
        'team_full',
        tr(
          `The project already has ${MAX_PROJECT_MEMBERS} monsters besides the lead.`,
          `Il progetto ha già ${MAX_PROJECT_MEMBERS} mostri oltre al capo.`,
        ),
      );
    }
    const req = r.data;
    let a: AgentSummary | RawResponse;
    if ('copyOf' in req) a = this.copy(p, req.copyOf, req.name);
    else if (this.taken(req.name))
      a = fail(
        400,
        'invalid_name',
        tr(
          `There’s already a monster called ${req.name}.`,
          `C’è già un mostro che si chiama ${req.name}.`,
        ),
      );
    else {
      a = {
        ...this.monster(req.name, req.role, p.id),
        genome: { ...req.genome, id: agentId(req.name) },
        color: colorOf(monsterFor(req.name)),
      };
    }
    if ('body' in a) return a;
    this.add(a);
    this.change(p, 'member_added', { agent: a.id });
    return ok(this.view(p), 201);
  }

  private removeMember(p: Stored, agent: string): RawResponse {
    const a = this.members(p.id).find((x) => x.id === agent);
    if (!a) {
      return fail(
        404,
        'unknown_agent',
        tr('That’s not a monster of this project.', 'Non è un mostro di questo progetto.'),
      );
    }
    if (a.isLead) {
      return fail(
        400,
        'orchestrator',
        tr(
          'The lead can’t be taken off the project: archive the project.',
          'Il capo non si toglie dal progetto: archivia il progetto.',
        ),
      );
    }
    this.h.setAgents(this.h.agents().filter((x) => x.id !== agent));
    this.h.log({
      agent: 'user',
      type: 'team_change',
      data: { action: 'archive', agent: a.id, name: a.name, by: 'ui' },
    });
    this.change(p, 'member_removed', { agent: a.id });
    return ok(this.view(p));
  }

  private spend(p: Stored): ProjectSpendView {
    const team = this.h.spend();
    const ids = new Set(this.members(p.id).map((a) => a.id));
    const agents = team.agents.filter((a) => ids.has(a.id));
    const meter = (period: 'day' | 'month'): SpendMeterView => {
      const spentEur = agents.reduce((s, a) => s + a[period].spentEur, 0);
      const capEur = (period === 'day' ? p.spend.dailyEur : p.spend.monthlyEur) ?? null;
      return { spentEur, capEur, ratio: capEur ? spentEur / capEur : null };
    };
    const day = meter('day');
    const month = meter('month');
    const worst = Math.max(day.ratio ?? 0, month.ratio ?? 0);
    return {
      project: p.id,
      caps: p.spend,
      day,
      month,
      status: worst >= 1 ? 'stopped' : worst >= SPEND_WARN_AT ? 'warning' : 'ok',
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        paid: a.paid,
        day: a.day,
        month: a.month,
        ...(a.estimated ? { estimated: a.estimated } : {}),
      })),
    };
  }
}
