import {
  MonsterGenomeSchema,
  hashString,
  hueDistance,
  isRosterName,
  randomGenome,
  slugify,
  type MonsterGenome,
} from '@monsters/monster-kit';
import {
  ASK_ALWAYS_EXTRAS,
  ASK_ALWAYS_FIXED,
  MAX_TEAM_MEMBERS,
  MOON_NAMES,
  ONBOARDING_QUESTIONS,
  PasswordChangeRequestSchema,
  ProfileUpdateSchema,
  TeamDraftRequestSchema,
  TeamLookRequestSchema,
  TeamLooksRequestSchema,
  TeamMemberCreateRequestSchema,
  TeamMemberUpdateSchema,
  TeamRestoreRequestSchema,
  type AgentSummary,
  type ArchivedMemberView,
  type DraftView,
  type EventInput,
  type ProfileView,
  type TeamDraft,
  type TeamMemberView,
  type TeamSuggestions,
} from '@monsters/shared';
import type { z } from 'zod';
import type { RawResponse } from '../transport.ts';
import { colorOf, monsterFor } from '../monsters.ts';

/*
 * Settings → Squadra in the mock core: the team after the onboarding, the
 * profile and the password (contract in packages/shared/src/team.ts). Kept in
 * memory and close enough to the core to build the UI: same validation, same
 * errors (busy while a scripted scenario runs, the capo squadra kept, names
 * unique, archived monsters restorable), `team_change` events in the log. The
 * AGENTS.md "edited by hand" case is Enceladus's.
 */

interface Details {
  title: string;
  mission: string;
  duties: string[];
  area: string;
  web: boolean;
  instructionsEdited: boolean;
}

interface Archived {
  agent: AgentSummary;
  details: Details;
  archivedAt: number;
}

export interface SquadHost {
  agents: () => AgentSummary[];
  setAgents: (list: AgentSummary[]) => void;
  log: (event: EventInput) => void;
  /** A scripted scenario is running: structural changes answer 409 `busy`. */
  busy: () => boolean;
  halted: () => boolean;
  checkPassword: (password: string) => boolean;
  setPassword: (password: string) => void;
}

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

const LABELS: Record<string, string> = {
  publish: 'Pubblicare',
  contact: 'Scrivere ad altri (messaggi, mail)',
  spend: 'Pagare o comprare',
  delete: 'Cancellare',
  goal: 'Cambiare un obiettivo',
};

const IDEAS: TeamSuggestions['ideas'] = [
  {
    id: 'ricerche',
    label: 'Ricerche online',
    description: 'Fa ricerche online e le riassume in note con le fonti.',
  },
  {
    id: 'bozze',
    label: 'Bozze di post e mail',
    description: 'Scrive bozze di post e mail pronte da usare, nel mio tono.',
  },
  {
    id: 'riassunti',
    label: 'Riassunti',
    description: 'Riassume documenti e note lunghe in pochi punti chiari.',
  },
  {
    id: 'note',
    label: 'Note in ordine',
    description: 'Mette in ordine note e idee: collega, raggruppa, toglie i doppioni.',
  },
  {
    id: 'piano',
    label: 'Piano dei contenuti',
    description: 'Pianifica i contenuti della settimana e tiene il calendario editoriale.',
  },
  {
    id: 'numeri',
    label: 'Numeri e dati',
    description: 'Analizza numeri e dati e ne ricava indicazioni pratiche.',
  },
];

const DEFAULT_DETAILS: Record<string, Details> = {
  rhea: {
    title: 'la ricercatrice',
    mission: 'trovi informazioni affidabili e aggiornate e le trasformi in note utili',
    duties: [
      'Usi più fonti, preferisci quelle primarie e controlli le date.',
      'Bastano 3-5 fonti buone.',
    ],
    area: 'Risorse/Ricerche',
    web: true,
    instructionsEdited: false,
  },
  dione: {
    title: 'la scrittrice',
    mission: 'trasformi note e richieste in testi chiari, pronti da usare',
    duties: ['Per i testi creativi scrivi 2 varianti di taglio o di tono.'],
    area: 'Inbox/Bozze',
    web: false,
    instructionsEdited: false,
  },
  enceladus: {
    title: 'il bibliotecario',
    mission: 'tieni in ordine le note: collegamenti, cartelle, doppioni',
    duties: ['Non cancelli mai una nota: la sposti in Archivio.'],
    area: 'Archivio/Ordine',
    web: false,
    instructionsEdited: true,
  },
};

const idOf = (name: string) => {
  const slug = slugify(name);
  return /^[a-z]/.test(slug) ? slug : `a-${slug}`;
};
const cap = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.charAt(0).toUpperCase() + one.slice(1);
};
const hueOf = (g: unknown) => MonsterGenomeSchema.safeParse(g).data?.palette.hue;
const firstIssue = (e: z.ZodError) => e.issues[0]?.message;

export class MockSquad {
  private readonly host: SquadHost;
  private readonly details = new Map<string, Details>();
  private readonly archived = new Map<string, Archived>();
  private profile = {
    userName: 'Giulio',
    tone: 'amichevole',
    language: 'it',
    style: '',
    extras: [] as string[],
    text: '',
  };

  /** Proposals of the capo squadra (D-075): id of the `proposed` event → who and whether open. */
  private readonly proposals = new Map<
    string,
    { from: string; name: string; open: boolean; draft?: TeamDraft; at?: number }
  >();

  constructor(host: SquadHost) {
    this.host = host;
  }

  /** The draft of a proposal of the capo squadra, as the core builds it (`source: 'proposal'`). */
  proposalDraft(d: {
    name: string;
    title: string;
    role: string;
    mission: string;
    duties: string[];
    area: string;
    web: boolean;
  }): TeamDraft {
    const genome = this.genomeFor(d.name, this.hues());
    return {
      ...d,
      context: `${this.profile.userName} ti ha affidato una parte del suo lavoro.`,
      genome: { ...genome, id: idOf(d.name) },
      color: colorOf(genome),
      archetype: null,
      source: 'proposal',
    };
  }

  /** A proposal logged by the mock core: open until the user creates it or leaves it. */
  registerProposal(id: string, from: string, name: string, draft?: TeamDraft): void {
    this.proposals.set(id, { from, name, open: true, ...(draft ? { draft, at: Date.now() } : {}) });
  }

  /** The open proposals for `/api/drafts` (D-098). */
  drafts(): DraftView[] {
    const nameOf = (id: string) => this.host.agents().find((a) => a.id === id)?.name ?? id;
    return [...this.proposals.entries()]
      .filter(([, p]) => p.open && p.draft)
      .map(([id, p]) => ({
        kind: 'monster' as const,
        id,
        title: p.name,
        summary: `${nameOf(p.from)} propone un nuovo mostro, ${p.name}: ${p.draft!.role}.`,
        from: p.from,
        fromName: nameOf(p.from),
        createdAt: p.at ?? 0,
        monster: { draft: p.draft! },
      }));
  }

  /** "Conferma" (the monster as proposed) or "Scarta" on a proposal. */
  draftAction(id: string, action: 'confirm' | 'discard'): RawResponse {
    const p = this.proposals.get(id);
    if (!p) return fail(404, 'unknown_draft', 'Questa bozza non c’è.');
    if (!p.open || !p.draft) return fail(409, 'draft_closed', 'Bozza già chiusa.');
    if (action === 'discard') {
      return this.handle('POST', `/api/team/proposals/${encodeURIComponent(id)}/discard`, {})!;
    }
    const d = p.draft;
    const res = this.create({
      name: d.name,
      title: d.title,
      role: d.role,
      mission: d.mission,
      ...(d.context ? { context: d.context } : {}),
      duties: d.duties,
      area: d.area,
      web: d.web,
      genome: d.genome,
      archetype: d.archetype,
      proposal: id,
    });
    if (res.status !== 201) return res;
    return ok({ kind: 'monster', id, agent: (res.body as TeamMemberView).id });
  }

  /** The monsters of the Squadra personale (D-097): Impostazioni → Squadra shows only these. */
  private personal(): AgentSummary[] {
    return this.host.agents().filter((a) => !a.project);
  }

  private proposal(id: string): { from: string; name: string; open: boolean } | RawResponse {
    const p = this.proposals.get(id);
    if (!p) return fail(404, 'unknown_proposal', `no proposal ${id}`);
    if (!p.open) {
      return fail(409, 'proposal_closed', 'Questa proposta è già stata usata o lasciata stare.');
    }
    return p;
  }

  get userName(): string {
    return this.profile.userName;
  }

  private detailsOf(a: AgentSummary): Details {
    let d = this.details.get(a.id);
    if (!d) {
      d = DEFAULT_DETAILS[a.id] ?? {
        title: 'l’aiutante',
        mission: a.role.charAt(0).toLowerCase() + a.role.slice(1),
        duties: [`${a.role}.`],
        area: `Risorse/${a.name}`,
        web: false,
        instructionsEdited: false,
      };
      this.details.set(a.id, d);
    }
    return d;
  }

  private view(a: AgentSummary): TeamMemberView {
    const base = {
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      genome: a.genome,
      isOrchestrator: a.isOrchestrator,
      state: a.state,
    };
    const squad = a.project ? { project: a.project, isLead: a.isLead === true } : {};
    if (a.isOrchestrator || a.isLead) {
      return { ...base, ...squad, web: false, instructionsEdited: false };
    }
    const d = this.detailsOf(a);
    return {
      ...base,
      ...squad,
      title: d.title,
      mission: d.mission,
      duties: d.duties,
      area: d.area,
      web: d.web,
      instructionsEdited: d.instructionsEdited,
    };
  }

  private archivedView(x: Archived): ArchivedMemberView {
    const { id, name, role, color, genome } = x.agent;
    return { id, name, role, color, genome, archivedAt: x.archivedAt };
  }

  private nameProblem(raw: string, self?: string): RawResponse | null {
    const name = cap(raw);
    const id = idOf(name);
    if (id === 'user' || id === 'system') {
      return fail(400, 'invalid_name', `Il nome ${name} è riservato: scegline un altro.`);
    }
    for (const o of this.host.agents()) {
      if (o.id === self) continue;
      if (o.name.toLowerCase() === name.toLowerCase()) {
        return fail(400, 'invalid_name', `C'è già un mostro che si chiama ${o.name}.`);
      }
      if (o.id === id || idOf(o.name) === id) {
        return fail(
          400,
          'invalid_name',
          `Il nome ${name} è troppo simile a quello di ${o.name}: scegline un altro.`,
        );
      }
    }
    return null;
  }

  private busy(): RawResponse | null {
    return this.host.busy()
      ? fail(
          409,
          'busy',
          'La squadra sta ancora lavorando: aspetta che finisca o fermala, poi cambiala.',
        )
      : null;
  }

  /** The colours a monster keeps away from: those of its squad (D-097), the personal one by default. */
  private hues(except?: string, project?: string): number[] {
    return this.host
      .agents()
      .filter((a) => a.id !== except && (a.project ?? '') === (project ?? ''))
      .map((a) => hueOf(a.genome))
      .filter((h): h is number => h !== undefined);
  }

  private replace(id: string, change: (a: AgentSummary) => AgentSummary): AgentSummary {
    let next: AgentSummary | undefined;
    this.host.setAgents(
      this.host.agents().map((a) => {
        if (a.id !== id) return a;
        next = change(a);
        return next;
      }),
    );
    return next!;
  }

  private event(data: {
    action: 'add' | 'rename' | 'edit' | 'look' | 'archive' | 'restore' | 'profile';
    agent?: string;
    name?: string;
    from?: string;
    fields?: string[];
  }): void {
    this.host.log({ agent: 'user', type: 'team_change', data: { ...data, by: 'ui' } });
  }

  private freeNames(): string[] {
    const taken = new Set(this.host.agents().flatMap((a) => [a.id, idOf(a.name)]));
    return ['Rhea', 'Dione', ...MOON_NAMES].filter((n) => !taken.has(idOf(n)));
  }

  private genomeFor(name: string, hues: number[], seed?: number): MonsterGenome {
    const key = name.toLowerCase();
    const official = isRosterName(key) ? monsterFor(name) : null;
    if (
      seed === undefined &&
      official &&
      !hues.some((h) => hueDistance(h, official.palette.hue) < 30)
    ) {
      return official;
    }
    return randomGenome(seed ?? hashString(key), slugify(name), { avoidHues: hues });
  }

  private profileView(): ProfileView {
    const tono = ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!;
    const group = (id: string) => tono.groups.find((g) => g.id === id)!.options;
    return {
      userName: this.profile.userName,
      orchestratorName: this.host.agents().find((a) => a.isOrchestrator)?.name ?? 'Titan',
      tone: this.profile.tone,
      language: this.profile.language,
      style: this.profile.style,
      askAlways: {
        fixed: ASK_ALWAYS_FIXED.map((id) => ({ id, label: LABELS[id] ?? id })),
        extras: ASK_ALWAYS_EXTRAS.filter((id) => this.profile.extras.includes(id)),
        text: this.profile.text,
      },
      options: {
        tones: group('tono'),
        languages: group('lingua'),
        extras: ASK_ALWAYS_EXTRAS.map((id) => ({ id, label: LABELS[id] ?? id })),
      },
    };
  }

  handle(method: string, path: string, body: unknown): RawResponse | null {
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/team':
        return ok({
          members: this.personal().map((a) => this.view(a)),
          archived: [...this.archived.values()]
            .sort((a, b) => b.archivedAt - a.archivedAt)
            .map((x) => this.archivedView(x)),
          maxMembers: MAX_TEAM_MEMBERS,
        });
      case 'GET /api/team/suggestions': {
        const live = this.host.agents();
        const has = (id: string) => live.some((a) => a.id === id || a.name.toLowerCase() === id);
        return ok({
          archetypes: [
            {
              archetype: 'rhea' as const,
              name: 'Rhea',
              title: 'la ricercatrice',
              role: 'ricerche online e sintesi con fonti',
            },
            {
              archetype: 'dione' as const,
              name: 'Dione',
              title: 'la scrittrice',
              role: 'testi pronti da usare (post, mail, riassunti, piani)',
            },
          ].filter((a) => !has(a.archetype)),
          ideas: IDEAS,
          names: this.freeNames(),
        } satisfies TeamSuggestions);
      }
      case 'POST /api/team/looks':
        return this.looks(body);
      case 'POST /api/team/drafts':
        return this.draft(body);
      case 'POST /api/team/agents':
        return this.create(body);
      case 'GET /api/profile':
        return ok(this.profileView());
      case 'PUT /api/profile':
        return this.updateProfile(body);
      case 'POST /api/auth/password':
        return this.password(body);
      case 'POST /api/auth/password/reset':
        return fail(403, 'forbidden');
      default:
        break;
    }
    const agent = /^\/api\/team\/agents\/([^/]+)$/.exec(path);
    if (agent && method === 'GET') {
      const a = this.host.agents().find((x) => x.id === decodeURIComponent(agent[1]!));
      return a ? ok(this.view(a)) : fail(404, 'unknown_agent');
    }
    if (agent && method === 'PATCH') return this.update(decodeURIComponent(agent[1]!), body);
    if (agent && method === 'DELETE') return this.archive(decodeURIComponent(agent[1]!));
    const look = /^\/api\/team\/agents\/([^/]+)\/look$/.exec(path);
    if (look && method === 'PUT') return this.setLook(decodeURIComponent(look[1]!), body);
    const discard = /^\/api\/team\/proposals\/([^/]+)\/discard$/.exec(path);
    if (discard && method === 'POST') {
      const id = decodeURIComponent(discard[1]!);
      const p = this.proposal(id);
      if ('status' in p) return p;
      p.open = false;
      this.host.log({
        agent: 'user',
        type: 'monster_proposal',
        data: { action: 'discarded', from: p.from, proposalId: id, name: p.name, by: 'ui' },
      });
      return ok({ ok: true });
    }
    const restore = /^\/api\/team\/archived\/([^/]+)\/restore$/.exec(path);
    if (restore && method === 'POST') return this.restore(decodeURIComponent(restore[1]!), body);
    return null;
  }

  private update(id: string, body: unknown): RawResponse {
    const p = TeamMemberUpdateSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const a = this.host.agents().find((x) => x.id === id);
    if (!a) return fail(404, 'unknown_agent');
    const r = p.data;
    const edits = (['role', 'title', 'mission', 'duties', 'area', 'web'] as const).filter(
      (k) => r[k] !== undefined,
    );
    if (a.isOrchestrator && edits.length > 0) {
      return fail(
        400,
        'orchestrator',
        'Il tuo capo coordina gli altri: il suo ruolo non si cambia, solo il nome.',
      );
    }
    if (a.isLead && edits.length > 0) {
      return fail(
        400,
        'orchestrator',
        'Il capo del progetto coordina i mostri del progetto: il suo ruolo non si cambia, solo il nome.',
      );
    }
    const rename = r.name !== undefined && cap(r.name) !== a.name;
    if (!rename && edits.length === 0) return ok(this.view(a));
    const busy = this.busy();
    if (busy) return busy;
    if (rename) {
      const problem = this.nameProblem(r.name!, id);
      if (problem) return problem;
    }
    const d = a.isOrchestrator || a.isLead ? null : this.detailsOf(a);
    if (d && edits.length > 0 && d.instructionsEdited && !r.force) {
      return fail(
        409,
        'instructions_edited',
        `Le istruzioni di ${a.name} (AGENTS.md) sono state modificate a mano: per riscriverle con il nuovo ruolo conferma (la copia vecchia resta in AGENTS.md.bak).`,
      );
    }
    const name = rename ? cap(r.name!) : a.name;
    const next = this.replace(id, (x) => ({ ...x, name, ...(r.role ? { role: r.role } : {}) }));
    if (d && edits.length > 0) {
      this.details.set(id, {
        title: r.title ?? d.title,
        mission: r.mission ?? d.mission,
        duties: r.duties ?? d.duties,
        area: r.area ?? d.area,
        web: r.web ?? d.web,
        instructionsEdited: false,
      });
    }
    if (rename) this.event({ action: 'rename', agent: id, name, from: a.name });
    if (edits.length > 0) this.event({ action: 'edit', agent: id, name, fields: [...edits] });
    return ok(this.view(next));
  }

  private looks(body: unknown): RawResponse {
    const p = TeamLooksRequestSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const self = p.data.agent ? this.host.agents().find((a) => a.id === p.data.agent) : undefined;
    if (p.data.agent && !self) return fail(404, 'unknown_agent');
    const name = self?.name ?? cap(p.data.name ?? 'Mostro');
    const hues = this.hues(self?.id, self ? self.project : p.data.project);
    const looks = Array.from({ length: p.data.count }, () => {
      const genome = this.genomeFor(name, hues, (Math.random() * 2 ** 32) >>> 0);
      return { genome: { ...genome, id: self?.id ?? idOf(name) }, color: colorOf(genome) };
    });
    return ok({ looks });
  }

  private checkGenome(raw: unknown, id: string): RawResponse | MonsterGenome {
    const g = MonsterGenomeSchema.safeParse({ ...(raw as object), id });
    if (!g.success) return fail(400, 'invalid_request', `genome: ${firstIssue(g.error)}`);
    const project = this.host.agents().find((a) => a.id === id)?.project;
    if (this.hues(id, project).some((h) => hueDistance(h, g.data.palette.hue) < 30)) {
      return fail(
        400,
        'color_too_close',
        'Questo colore è troppo vicino a quello di un altro mostro: scegline un altro.',
      );
    }
    return g.data;
  }

  private setLook(id: string, body: unknown): RawResponse {
    const p = TeamLookRequestSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const a = this.host.agents().find((x) => x.id === id);
    if (!a) return fail(404, 'unknown_agent');
    const genome = this.checkGenome(p.data.genome, id);
    if ('status' in genome) return genome;
    const next = this.replace(id, (x) => ({ ...x, genome, color: colorOf(genome) }));
    this.event({ action: 'look', agent: id, name: a.name });
    return ok(this.view(next));
  }

  private archive(id: string): RawResponse {
    const a = this.host.agents().find((x) => x.id === id);
    if (!a) return fail(404, 'unknown_agent');
    if (a.isOrchestrator) {
      return fail(
        400,
        'orchestrator',
        'Il tuo capo non si può togliere: coordina gli altri. Puoi cambiargli nome.',
      );
    }
    const busy = this.busy();
    if (busy) return busy;
    const x: Archived = { agent: a, details: this.detailsOf(a), archivedAt: Date.now() };
    this.archived.set(id, x);
    this.host.setAgents(this.host.agents().filter((o) => o.id !== id));
    this.event({ action: 'archive', agent: id, name: a.name });
    return ok({ ok: true, archived: this.archivedView(x), questionsClosed: 0 });
  }

  private restore(id: string, body: unknown): RawResponse {
    const p = TeamRestoreRequestSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const x = this.archived.get(id);
    if (!x) return fail(404, 'unknown_agent');
    if (this.personal().filter((a) => !a.isOrchestrator).length >= MAX_TEAM_MEMBERS) {
      return fail(409, 'team_full', `La squadra ha già ${MAX_TEAM_MEMBERS} mostri oltre al capo.`);
    }
    const busy = this.busy();
    if (busy) return busy;
    const name = p.data.name ? cap(p.data.name) : x.agent.name;
    const problem = this.nameProblem(name, id);
    if (problem) {
      return p.data.name
        ? problem
        : fail(
            409,
            'name_taken',
            `${(problem.body as { message: string }).message} Scegli un altro nome per ${x.agent.name}.`,
          );
    }
    this.archived.delete(id);
    const agent = { ...x.agent, name, state: 'idle' as const };
    this.details.set(id, x.details);
    this.host.setAgents([...this.host.agents(), agent]);
    this.event({ action: 'restore', agent: id, name });
    return ok(this.view(agent));
  }

  private draft(body: unknown): RawResponse {
    const p = TeamDraftRequestSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const r = p.data;
    if (r.name) {
      const problem = this.nameProblem(r.name);
      if (problem) return problem;
    }
    const free = this.freeNames();
    const context = `${this.profile.userName} ti ha affidato una parte del suo lavoro.`;
    const finish = (d: Omit<TeamDraft, 'color' | 'genome' | 'context'>): RawResponse => {
      const genome = this.genomeFor(d.name, this.hues());
      return ok({
        ...d,
        context,
        genome: { ...genome, id: idOf(d.name) },
        color: colorOf(genome),
      } satisfies TeamDraft);
    };
    if ('archetype' in r) {
      const rhea = r.archetype === 'rhea';
      const wanted = rhea ? 'Rhea' : 'Dione';
      return finish({
        name: r.name ? cap(r.name) : free.includes(wanted) ? wanted : (free[0] ?? 'Tethys'),
        title: rhea ? 'la ricercatrice' : 'la scrittrice',
        role: rhea
          ? 'ricerche online e sintesi con fonti'
          : 'testi pronti da usare (post, mail, riassunti, piani)',
        mission: DEFAULT_DETAILS[r.archetype]!.mission,
        duties: DEFAULT_DETAILS[r.archetype]!.duties,
        area: DEFAULT_DETAILS[r.archetype]!.area,
        web: rhea,
        archetype: r.archetype,
        source: 'archetype',
      });
    }
    if (this.host.halted()) {
      return fail(409, 'halted', 'Monsters è fermo: riprendi prima di creare un nuovo mostro.');
    }
    const name = r.name
      ? cap(r.name)
      : (free.find((n) => n !== 'Rhea' && n !== 'Dione') ?? free[0] ?? 'Tethys');
    const role = r.description.replace(/\s+/g, ' ').trim().slice(0, 120);
    return finish({
      name,
      title: 'l’aiutante',
      role,
      mission: role.charAt(0).toLowerCase() + role.slice(1).replace(/\.$/, ''),
      duties: [role],
      area: `Risorse/${name}`,
      web: r.web ?? /ricerc|cerca|web|online/i.test(r.description),
      archetype: null,
      source: 'model',
    });
  }

  private create(body: unknown): RawResponse {
    const p = TeamMemberCreateRequestSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const r = p.data;
    if (this.personal().filter((a) => !a.isOrchestrator).length >= MAX_TEAM_MEMBERS) {
      return fail(409, 'team_full', `La squadra ha già ${MAX_TEAM_MEMBERS} mostri oltre al capo.`);
    }
    const proposal = r.proposal ? this.proposal(r.proposal) : undefined;
    if (proposal && 'status' in proposal) return proposal;
    const problem = this.nameProblem(r.name);
    if (problem) return problem;
    const name = cap(r.name);
    let id = idOf(name);
    for (let i = 2; this.archived.has(id) || this.host.agents().some((a) => a.id === id); i++) {
      id = `${idOf(name)}-${i}`;
    }
    const genome = this.checkGenome(r.genome, id);
    if ('status' in genome) return genome;
    const agent: AgentSummary = {
      id,
      name,
      role: r.role,
      color: colorOf(genome),
      isOrchestrator: false,
      genome,
      state: 'idle',
    };
    this.details.set(id, {
      title: r.title,
      mission: r.mission,
      duties: r.duties,
      area: r.area,
      web: r.web,
      instructionsEdited: false,
    });
    this.host.setAgents([...this.host.agents(), agent]);
    this.event({ action: 'add', agent: id, name });
    if (proposal && r.proposal) {
      proposal.open = false;
      this.host.log({
        agent: 'user',
        type: 'monster_proposal',
        data: {
          action: 'created',
          from: proposal.from,
          proposalId: r.proposal,
          agent: id,
          name,
          by: 'ui',
        },
      });
    }
    return ok(this.view(agent), 201);
  }

  private updateProfile(body: unknown): RawResponse {
    const p = ProfileUpdateSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    const r = p.data;
    const view = this.profileView();
    if (r.tone !== undefined && !view.options.tones.some((o) => o.id === r.tone)) {
      return fail(400, 'invalid_request', `unknown tone ${r.tone}`);
    }
    if (r.language !== undefined && !view.options.languages.some((o) => o.id === r.language)) {
      return fail(400, 'invalid_request', `unknown language ${r.language}`);
    }
    const orchestrator = this.host.agents().find((a) => a.isOrchestrator);
    if (
      r.orchestratorName !== undefined &&
      orchestrator &&
      cap(r.orchestratorName) !== orchestrator.name
    ) {
      const res = this.update(orchestrator.id, { name: r.orchestratorName });
      if (res.status !== 200) return res;
    }
    const fields: string[] = [];
    if (r.userName !== undefined && cap(r.userName) !== this.profile.userName) {
      this.profile.userName = cap(r.userName);
      fields.push('userName');
    }
    if (r.tone !== undefined && r.tone !== this.profile.tone) {
      this.profile.tone = r.tone;
      fields.push('tone');
    }
    if (r.language !== undefined && r.language !== this.profile.language) {
      this.profile.language = r.language;
      fields.push('language');
    }
    if (r.style !== undefined && r.style !== this.profile.style) {
      this.profile.style = r.style;
      fields.push('style');
    }
    if (r.askAlways) {
      this.profile.extras = [...new Set(r.askAlways.extras)];
      this.profile.text = r.askAlways.text;
      fields.push('askAlways');
    }
    if (fields.length > 0) this.event({ action: 'profile', fields });
    return ok(this.profileView());
  }

  private password(body: unknown): RawResponse {
    const p = PasswordChangeRequestSchema.safeParse(body ?? {});
    if (!p.success) return fail(400, 'invalid_request', firstIssue(p.error));
    if (p.data.currentPassword === p.data.newPassword) {
      return fail(400, 'same_password', 'La nuova password è uguale a quella di adesso.');
    }
    if (!this.host.checkPassword(p.data.currentPassword)) {
      this.host.log({
        agent: 'system',
        type: 'auth',
        data: { action: 'password_change_failed', channel: 'ui' },
      });
      return fail(400, 'wrong_password', 'La password attuale non è giusta.');
    }
    this.host.setPassword(p.data.newPassword);
    this.host.log({
      agent: 'system',
      type: 'auth',
      data: { action: 'password_changed', channel: 'ui' },
    });
    return ok({ ok: true, sessionsClosed: 0 });
  }
}
