import type { DraftView, ProjectView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { mentionTarget } from '../src/components/chat/Composer.tsx';
import {
  copyName,
  freeCopyName,
  looksAbsolute,
  newFolderIn,
  newFolderPath,
  plannedLead,
  plannedLeadLook,
  plannedMembers,
  projectNameProblem,
  squadsOf,
  type SquadMember,
} from '../src/lib/projects.ts';
import { projectPath, projectTabOf, routeOf } from '../src/lib/router.ts';
import { MockCore } from '../src/lib/mock/core.ts';
import { monsterFor } from '../src/lib/monsters.ts';

const m = (id: string, extra: Partial<SquadMember> = {}): SquadMember => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  isOrchestrator: false,
  ...extra,
});

const project = (id: string, extra: Partial<ProjectView> = {}): ProjectView => ({
  id,
  name: id,
  status: 'active',
  archived: false,
  folderExists: false,
  vaultArea: `Progetti/${id}`,
  members: [],
  maxMembers: 7,
  spend: {},
  connections: { mcp: [], claude: [] },
  webSearch: true,
  createdBy: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('the squads of the sidebar', () => {
  it('puts the orchestrator above, the personal squad first, each project with its lead first', () => {
    const agents = [
      m('titan', { isOrchestrator: true }),
      m('rhea'),
      m('calypso', { project: 'social' }),
      m('iapetus', { project: 'social', isLead: true }),
      m('dione'),
    ];
    const { god, squads } = squadsOf(agents, [project('social', { name: 'Social di Saturday' })]);
    expect(god?.id).toBe('titan');
    expect(squads.map((s) => [s.key, s.label, s.members.map((x) => x.id)])).toEqual([
      ['', 'Squadra personale', ['rhea', 'dione']],
      ['social', 'Social di Saturday', ['iapetus', 'calypso']],
    ]);
  });

  it('leaves out drafts and archived projects, and names a project not loaded yet by its id', () => {
    const agents = [
      m('titan', { isOrchestrator: true }),
      m('atlas', { project: 'nuovo', isLead: true }),
    ];
    expect(squadsOf(agents, null).squads.map((s) => s.label)).toEqual([
      'Squadra personale',
      'nuovo',
    ]);
    const archived = project('nuovo', { archived: true });
    expect(squadsOf(agents, [archived]).squads.map((s) => s.key)).toEqual(['']);
    const draft = project('bozza', { status: 'draft' });
    expect(squadsOf(agents, [draft]).squads.map((s) => s.key)).toEqual(['', 'nuovo']);
  });
});

describe('the name of a copy', () => {
  it('in a project is a free moon, never the source name', () => {
    expect(freeCopyName(['Rhea'])).toBe('Tethys');
    expect(freeCopyName(['Rhea', 'tethys'])).not.toBe('Tethys');
  });

  it('is "Rhea · Progetto", then "Rhea di Progetto", then a free moon', () => {
    expect(copyName('Rhea', 'Saturday', ['Rhea'])).toBe('Rhea · Saturday');
    expect(copyName('Rhea', 'Saturday', ['Rhea', 'Rhea · Saturday'])).toBe('Rhea di Saturday');
    expect(copyName('Rhea', 'Saturday', ['Rhea', 'rhea · saturday', 'Rhea di Saturday'])).toBe(
      'Tethys',
    );
  });

  it('keeps to 24 characters and to the letters of a name', () => {
    const name = copyName('Rhea', 'Social di Saturday 2026', []);
    expect(name).toBe('Rhea · Social di Saturda');
    expect(name!.length).toBeLessThanOrEqual(24);
    // A name too long for the project's words goes straight to a free name.
    expect(copyName('Prometheus-Epimetheus', 'Sito', [])).toBe('Tethys');
  });
});

describe('the form of a new project', () => {
  it('suggests the folder of the core and wants a full path', () => {
    expect(newFolderPath('Sito: nuovo')).toBe('~/Monsters Progetti/Sito nuovo');
    expect(newFolderPath('  ')).toBe('~/Monsters Progetti/Progetto');
    // A new folder inside the one chosen with "Scegli…", with that folder's separator.
    expect(newFolderIn('/home/g/Progetti/', 'Sito: nuovo')).toBe('/home/g/Progetti/Sito nuovo');
    expect(newFolderIn('C:\\Users\\g\\Progetti', 'Sito')).toBe('C:\\Users\\g\\Progetti\\Sito');
    expect(looksAbsolute('~/Progetti/Sito')).toBe(true);
    expect(looksAbsolute('/srv/progetti')).toBe(true);
    expect(looksAbsolute('C:\\Progetti')).toBe(true);
    expect(looksAbsolute('Progetti/Sito')).toBe(false);
  });

  it('checks the name as the core does, and against the other projects', () => {
    const others = [project('social', { name: 'Social di Saturday' })];
    expect(projectNameProblem('', others)).toBe('Dai un nome al progetto.');
    expect(projectNameProblem('Sito/nuovo', others)).toMatch(/^Solo lettere/);
    expect(projectNameProblem('social di saturday', others)).toMatch(/^C’è già un progetto/);
    expect(projectNameProblem('Social di Saturday', others, 'social')).toBeNull();
    expect(projectNameProblem('Newsletter', others)).toBeNull();
  });
});

describe('the plan of a proposed project', () => {
  const nameOf = (id: string) => ({ rhea: 'Rhea', dione: 'Dione' })[id] ?? id;
  it('names the copies as the core will, after the new monsters', () => {
    const list = plannedMembers(
      [
        { draft: { name: 'Telesto', role: 'scrive i testi' } as never },
        { copyOf: 'rhea' },
        { copyOf: 'dione', name: 'Dione la grafica' },
      ],
      'Sito',
      nameOf,
      ['Rhea', 'Dione'],
    );
    const words = (n: string) => `con il ruolo e le regole di ${n}; nome, aspetto e memoria suoi`;
    expect(list.map((x) => [x.name, x.detail])).toEqual([
      ['Telesto', 'scrive i testi'],
      ['Tethys', words('Rhea')],
      ['Dione la grafica', words('Dione')],
    ]);
    // A look of its own, not the source's.
    expect(list[1]!.genome).toEqual(monsterFor('Tethys'));
  });

  it('says whether the lead is new or a copy', () => {
    const p = (lead: object) =>
      project('sito', { status: 'draft', plan: { lead, members: [], automations: [] } });
    expect(plannedLead(p({ name: 'Atlas' }), nameOf)).toEqual({
      name: 'Atlas',
      detail: 'nuovo, con una memoria sua',
    });
    expect(plannedLead(p({ from: 'rhea' }), nameOf)).toMatchObject({
      name: null,
      detail: 'con il ruolo e le regole di Rhea; nome, aspetto e memoria suoi',
    });
  });

  it('gives a new lead a look before it is born, the same every time (D-102)', () => {
    const p = (lead: object, name = 'sito') =>
      project(name, { status: 'draft', plan: { lead, members: [], automations: [] } });
    // A roster name: the roster's monster, as the core gives it at the confirmation.
    const atlas = plannedLeadLook(p({ name: 'Atlas' }));
    expect(atlas).toEqual({ genome: monsterFor('Atlas'), name: 'Atlas' });
    expect(plannedLeadLook(p({ name: 'Atlas' }))).toEqual(atlas);
    // Another name, or none yet: generated from it (or from the project's name), still stable.
    const other = plannedLeadLook(p({ name: 'Zefiro' }));
    expect(other).toEqual({ genome: monsterFor('Zefiro'), name: 'Zefiro' });
    expect(plannedLeadLook(p({}, 'Orto'))).toEqual({ genome: monsterFor('Orto'), name: 'Orto' });
    // A copy has a look of its own too, from its name.
    expect(plannedLeadLook(p({ from: 'rhea', name: 'Atlas' }))).toEqual(atlas);
  });
});

describe('the page of a project in the address', () => {
  it('has its own route, its tabs and the form of a new one', () => {
    expect(routeOf('#/progetto?id=social')).toBe('project');
    expect(projectPath('social')).toBe('#/progetto?id=social');
    expect(projectPath('social', 'spesa')).toBe('#/progetto?id=social&sezione=spesa');
    expect(projectPath(null)).toBe('#/progetto?vista=nuovo');
    expect(projectTabOf('cartella')).toBe('cartella');
    expect(projectTabOf('altro')).toBe('chat');
  });
});

describe('@Nome in the composer', () => {
  const agents = [
    { id: 'rhea', name: 'Rhea' },
    { id: 'rhea-saturday', name: 'Rhea · Saturday' },
    { id: 'dione', name: 'Dione' },
  ];
  it('finds the copy of a project by its whole name, not the monster it was copied from', () => {
    expect(mentionTarget('@Rhea · Saturday guarda qui', agents)?.id).toBe('rhea-saturday');
    expect(mentionTarget('@Rhea guarda qui', agents)?.id).toBe('rhea');
    expect(mentionTarget('chiedi a @rhea-saturday', agents)?.id).toBe('rhea-saturday');
    expect(mentionTarget('@Rheana ciao', agents)).toBeNull();
    expect(mentionTarget('ciao @Dione, e @Rhea', agents)?.id).toBe('dione');
  });
});

describe('the projects of the mock core', () => {
  const call = (core: MockCore, method: string, path: string, body?: unknown) =>
    core.handle(method, path, body);

  it('has "Social di Saturday" with its lead, two monsters and the orchestrator’s draft', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const list = call(core, 'GET', '/api/projects').body as ProjectView[];
    expect(list.map((p) => [p.id, p.status])).toEqual([
      ['social-di-saturday', 'active'],
      ['sito-di-saturday', 'draft'],
    ]);
    expect(list[0]!.members.map((x) => [x.id, x.isLead])).toEqual([
      ['iapetus', true],
      ['calypso', false],
      ['pandora', false],
    ]);
    const drafts = call(core, 'GET', '/api/drafts').body as DraftView[];
    expect(drafts.map((d) => [d.kind, d.fromName])).toEqual([
      ['project', 'Titan'],
      ['docs', 'Iapetus'],
      ['docs', 'Calypso'],
    ]);
  });

  it('has the work Titan sent the project and the report of its lead (D-102)', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const sent = core.events.find(
      (e) => e.type === 'message' && e.data.role === 'user' && e.data.from === 'titan',
    );
    expect(sent).toMatchObject({ data: { to: 'iapetus', channel: 'system' } });
    const report = core.events.find((e) => e.type === 'project_report');
    expect(report).toMatchObject({
      agent: 'system',
      runId: sent!.runId,
      data: {
        project: 'social-di-saturday',
        lead: 'iapetus',
        to: 'titan',
        request: sent!.id,
        status: 'completed',
      },
    });
    // In the order of the log, after the lead's answer.
    const ids = core.events.map((e) => e.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('confirms a draft with its plan, its automation a draft of its own', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const r = call(core, 'POST', '/api/drafts/project/sito-di-saturday/confirm');
    expect(r.body).toMatchObject({ kind: 'project', project: 'sito-di-saturday' });
    const p = call(core, 'GET', '/api/projects/sito-di-saturday').body as ProjectView;
    expect(p.status).toBe('active');
    expect(p.members.map((x) => x.name)).toEqual(['Atlas', 'Telesto', 'Tethys']);
    const drafts = call(core, 'GET', '/api/drafts').body as DraftView[];
    expect(drafts.filter((d) => d.kind !== 'docs').map((d) => [d.kind, d.title])).toEqual([
      ['automation', 'Controllo del sito'],
    ]);
    expect(call(core, 'POST', '/api/drafts/project/sito-di-saturday/confirm').status).toBe(409);
  });

  it('creates a project with a lead, copies, archives and restores, keeps names unique', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const made = call(core, 'POST', '/api/projects', {
      name: 'Newsletter',
      folder: { path: '~/Monsters Progetti/Newsletter', create: true },
      lead: { name: 'Atlas' },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      id: 'newsletter',
      lead: 'atlas',
      folder: '/home/andrea/Monsters Progetti/Newsletter',
    });
    const copy = call(core, 'POST', '/api/projects/newsletter/members', { copyOf: 'rhea' });
    expect((copy.body as ProjectView).members.map((x) => x.name)).toEqual(['Atlas', 'Tethys']);
    // The personal squad of Impostazioni does not see the project's monsters.
    const team = call(core, 'GET', '/api/team').body as { members: { id: string }[] };
    expect(team.members.map((x) => x.id)).not.toContain('atlas');
    expect(call(core, 'POST', '/api/projects', { name: 'newsletter' }).status).toBe(409);
    expect(call(core, 'DELETE', '/api/projects/newsletter/members/atlas').status).toBe(400);
    const archived = call(core, 'POST', '/api/projects/newsletter/archive').body as ProjectView;
    expect(archived.archived).toBe(true);
    const agents = call(core, 'GET', '/api/agents').body as { id: string }[];
    expect(agents.map((a) => a.id)).not.toContain('atlas');
    const back = call(core, 'POST', '/api/projects/newsletter/restore').body as ProjectView;
    expect(back.members).toHaveLength(2);
    expect(call(core, 'POST', '/api/projects/newsletter/stop').body).toEqual({
      runsStopped: 0,
      sendsDropped: 0,
      giriSkipped: 0,
    });
  });
});
