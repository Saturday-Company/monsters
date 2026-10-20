import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MonsterGenomeSchema } from '@monsters/monster-kit';
import { fake } from '@monsters/providers/testing';
import {
  ASK_ALWAYS_FIXED,
  type AgentSummary,
  type LogEvent,
  type ProfileView,
  type TeamArchiveResponse,
  type TeamDraft,
  type TeamLooksResponse,
  type TeamMemberView,
  type TeamSuggestions,
  type TeamView,
} from '@monsters/shared';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_JSON,
  parseInstructions,
  readSettingsFile,
  rheaBlueprint,
  renderAgentFiles,
  type AgentConfig,
  type Generate,
} from '../src/index.ts';
import { never, startTestHub, type TestHub } from './hub-helpers.ts';

type Sent = { runId: string };

const agentsMd = (t: TestHub, id: string) =>
  readFileSync(join(t.home, 'agents', id, 'AGENTS.md'), 'utf8');
const agentYaml = (t: TestHub, id: string) =>
  parseYaml(readFileSync(join(t.home, 'agents', id, 'agent.yaml'), 'utf8')) as AgentConfig;
const teamEvents = (t: TestHub) =>
  t.events().filter((e): e is LogEvent<'team_change'> => e.type === 'team_change');

/** Waits for `predicate` on the team state (runtime states follow the log). */
async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('team after the onboarding: view and instructions', () => {
  it('lists the team with the fields of each AGENTS.md, also for teams without blueprint.json', async () => {
    const t = await startTestHub({});
    const view = await t.json<TeamView>('GET', '/api/team');
    expect(view.members.map((m) => [m.id, m.name, m.isOrchestrator])).toEqual([
      ['titan', 'Titan', true],
      ['dione', 'Dione', false],
      ['rhea', 'Rhea', false],
    ]);
    const rhea = view.members.find((m) => m.id === 'rhea')!;
    expect(rhea).toMatchObject({
      title: 'la ricercatrice',
      area: 'Risorse/Ricerche',
      web: true,
      instructionsEdited: false,
    });
    expect(rhea.duties).toHaveLength(3);
    expect(view.archived).toEqual([]);
    expect(view.maxMembers).toBe(7);
  });

  it('reads the fields back from an AGENTS.md of the template, never from one edited by hand', () => {
    const bp = rheaBlueprint({ user: 'Giulio', context: 'Giulio cucina. Ama la zucca.' });
    const files = renderAgentFiles(bp);
    const config = parseYaml(files['agent.yaml']) as AgentConfig;
    const fields = parseInstructions(files['AGENTS.md'], config);
    expect(fields).toMatchObject({
      kind: 'subagent',
      name: 'Rhea',
      user: 'Giulio',
      orchestrator: 'Titan',
      outputArea: 'Risorse/Ricerche',
      web: true,
    });
    expect(parseInstructions(`${files['AGENTS.md']}\n- Una regola mia.\n`, config)).toBeNull();
  });
});

describe('rename', () => {
  it('keeps the chat and the delegations (same id), moves the memory, rewrites the AGENTS.md files', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Cerca le tendenze' }),
        fake.text('Fatto.'),
      ],
      rhea: [fake.text('Trovate tre tendenze.'), fake.text('Sono Rea, ciao!'), fake.text('Sì.')],
    });
    // Teams created before blueprint.json: read back from the template.
    rmSync(join(t.home, 'agents', 'rhea', BLUEPRINT_JSON));
    rmSync(join(t.home, 'agents', 'titan', BLUEPRINT_JSON));
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Tendenze autunnali' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const vault = t.core.hub.vault.root;
    expect(existsSync(join(vault, 'Agenti/Rhea/MEMORY.md'))).toBe(true);

    const renamed = await t.json<TeamMemberView>('PATCH', '/api/team/agents/rhea', { name: 'rea' });
    expect(renamed).toMatchObject({ id: 'rhea', name: 'Rea', instructionsEdited: false });
    expect(agentYaml(t, 'rhea')).toMatchObject({ id: 'rhea', name: 'Rea' });
    expect(agentYaml(t, 'rhea').vault.write).toContain('Agenti/Rea/**');
    expect(agentYaml(t, 'rhea').vault.write).not.toContain('Agenti/Rhea/**');
    expect(agentsMd(t, 'rhea')).toMatch(/^# Rea\n\nSei Rea, la ricercatrice/);
    expect(agentsMd(t, 'rhea')).not.toContain('Rhea');
    expect(agentsMd(t, 'titan')).toContain('**Rea**: ricerche online');
    expect(agentsMd(t, 'titan')).not.toContain('**Rhea**');
    // Memory moved with git, the old folder gone; the vault knows the new area.
    expect(existsSync(join(vault, 'Agenti/Rea/MEMORY.md'))).toBe(true);
    expect(existsSync(join(vault, 'Agenti/Rhea'))).toBe(false);
    expect(t.core.hub.vault.permissions.writableAreas('rhea')).toContain('Agenti/Rea/');
    expect(t.events().some((e) => e.type === 'vault_change' && e.data.action === 'move')).toBe(
      true,
    );
    const event = teamEvents(t).at(-1)!;
    expect(event).toMatchObject({
      agent: 'user',
      data: { action: 'rename', agent: 'rhea', name: 'Rea', from: 'Rhea', by: 'ui' },
    });

    // History by id: the delegation and Rhea's run are still hers.
    const delegation = t
      .events(sent.runId)
      .find((e): e is LogEvent<'delegation'> => e.type === 'delegation');
    expect(delegation?.data.to).toBe('rhea');
    const agents = await t.json<AgentSummary[]>('GET', '/api/agents');
    expect(agents.find((a) => a.id === 'rhea')?.name).toBe('Rea');
    // @Rea reaches her, with the conversation so far.
    const direct = await t.json<Sent & { agent: string }>('POST', '/api/messages', {
      text: '@Rea ciao',
    });
    expect(direct.agent).toBe('rhea');
    expect((await t.runEnded(direct.runId)).data.status).toBe('completed');
    const prompt = JSON.stringify(t.provider.callsTo('rhea').at(-1)!.options.prompt);
    expect(prompt).toContain('# Rea');
    // The id is still hers: the old name keeps reaching her.
    const old = await t.json<Sent & { agent: string }>('POST', '/api/messages', {
      text: 'ancora tu?',
      to: 'Rhea',
    });
    expect(old.agent).toBe('rhea');
  });

  it('refuses a duplicate, a too similar, a reserved or an invalid name', async () => {
    const t = await startTestHub({});
    const status = async (id: string, name: string) =>
      (await t.api('PATCH', `/api/team/agents/${id}`, { name })).status;
    const error = async (id: string, name: string) =>
      (
        (await (await t.api('PATCH', `/api/team/agents/${id}`, { name })).json()) as {
          error: string;
        }
      ).error;
    expect(await error('dione', 'Rhea')).toBe('invalid_name');
    expect(await error('dione', 'titan')).toBe('invalid_name');
    expect(await error('dione', 'Rhéa')).toBe('invalid_name');
    expect(await error('dione', 'User')).toBe('invalid_name');
    expect(await status('dione', 'R2-D2')).toBe(400);
    expect(await status('nessuno', 'Ciao')).toBe(404);
    // After a rename the old id still blocks the name: "@Rhea" must not reach two monsters.
    await t.json('PATCH', '/api/team/agents/rhea', { name: 'Rea' });
    expect(await error('dione', 'Rhea')).toBe('invalid_name');
    expect(teamEvents(t)).toHaveLength(1);
  });

  it('refuses while a monster is working (busy); a new look is fine', async () => {
    const t = await startTestHub({ rhea: [fake.text('…', { gate: never })] });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'cerca', to: 'rhea' });
    await until(() => t.core.hub.team.working().length > 0);
    const res = await t.api('PATCH', '/api/team/agents/dione', { name: 'Diana' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('busy');
    expect((await t.api('DELETE', '/api/team/agents/dione')).status).toBe(409);
    const looks = await t.json<TeamLooksResponse>('POST', '/api/team/looks', { agent: 'dione' });
    expect(
      (await t.api('PUT', '/api/team/agents/dione/look', { genome: looks.looks[0]!.genome }))
        .status,
    ).toBe(200);
    // Stopping frees the team: changes are allowed while stopped.
    await t.json('POST', '/api/kill', {});
    expect((await t.runEnded(sent.runId)).data.status).toBe('aborted');
    expect((await t.api('PATCH', '/api/team/agents/dione', { name: 'Diana' })).status).toBe(200);
  });

  it('a hand-edited AGENTS.md keeps its own lines on a rename; a new role needs force', async () => {
    const t = await startTestHub({});
    const path = join(t.home, 'agents', 'dione', 'AGENTS.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n- Dione firma sempre i testi.\n`);
    const view = await t.json<TeamView>('GET', '/api/team');
    expect(view.members.find((m) => m.id === 'dione')?.instructionsEdited).toBe(true);
    await t.json('PATCH', '/api/team/agents/dione', { name: 'Diana' });
    expect(agentsMd(t, 'dione')).toContain('- Diana firma sempre i testi.');
    expect(agentsMd(t, 'dione')).toMatch(/^# Diana/);

    const edit = { role: 'testi brevi per i social', duties: ['Scrivi testi sotto le 80 parole.'] };
    const refused = await t.api('PATCH', '/api/team/agents/dione', edit);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('instructions_edited');
    const forced = await t.json<TeamMemberView>('PATCH', '/api/team/agents/dione', {
      ...edit,
      force: true,
    });
    expect(forced).toMatchObject({
      role: edit.role,
      duties: edit.duties,
      instructionsEdited: false,
    });
    expect(readFileSync(`${path}.bak`, 'utf8')).toContain('firma sempre i testi');
    expect(agentsMd(t, 'dione')).not.toContain('firma sempre');
  });
});

describe('role, duties, area', () => {
  it('re-renders AGENTS.md with the validation of the generation and updates the capo', async () => {
    const t = await startTestHub({});
    const bad = await t.api('PATCH', '/api/team/agents/rhea', { duties: ['una\nriga'] });
    expect(bad.status).toBe(400);
    const glob = await t.api('PATCH', '/api/team/agents/rhea', { area: 'Agenti/Rhea' });
    expect(glob.status).toBe(400);
    const tooMany = await t.api('PATCH', '/api/team/agents/rhea', {
      duties: ['uno a', 'due b', 'tre c', 'quattro d', 'cinque e'],
    });
    expect(tooMany.status).toBe(400);

    const view = await t.json<TeamMemberView>('PATCH', '/api/team/agents/rhea', {
      role: 'ricerche sul food e sui ristoranti',
      title: 'la cacciatrice di tendenze',
      duties: ['Cerchi prima nelle fonti italiane.'],
      area: 'Progetti/Food',
      web: false,
    });
    expect(view).toMatchObject({
      role: 'ricerche sul food e sui ristoranti',
      title: 'la cacciatrice di tendenze',
      area: 'Progetti/Food',
      web: false,
    });
    const md = agentsMd(t, 'rhea');
    expect(md).toContain('Sei Rhea, la cacciatrice di tendenze della squadra di Giulio');
    expect(md).toContain('- Cerchi prima nelle fonti italiane.');
    expect(md).toContain('Salvi i risultati in `Progetti/Food/`');
    expect(md).not.toContain('web_search');
    const yaml = agentYaml(t, 'rhea');
    expect(yaml.role).toBe('ricerche sul food e sui ristoranti');
    expect(yaml.vault.write).toContain('Progetti/Food/**');
    expect(yaml.vault.write).not.toContain('Risorse/Ricerche/**');
    expect(yaml.tools).not.toContain('web_search');
    expect(agentsMd(t, 'titan')).toContain('**Rhea**: ricerche sul food e sui ristoranti');
    expect(t.core.hub.vault.permissions.writableAreas('rhea')).toContain('Progetti/Food/');
    // The capo has the web again: nobody else on the team searches.
    expect(t.core.hub.team.get('titan')!.config.tools).toContain('web_search');
    expect(teamEvents(t).at(-1)?.data).toMatchObject({
      action: 'edit',
      agent: 'rhea',
      fields: ['role', 'title', 'duties', 'area', 'web'],
    });
  });

  it('the capo squadra keeps its role and cannot be archived', async () => {
    const t = await startTestHub({});
    const role = await t.api('PATCH', '/api/team/agents/titan', { role: 'un altro ruolo' });
    expect(role.status).toBe(400);
    expect(((await role.json()) as { error: string }).error).toBe('orchestrator');
    const del = await t.api('DELETE', '/api/team/agents/titan');
    expect(del.status).toBe(400);
    expect(((await del.json()) as { error: string }).error).toBe('orchestrator');
  });
});

describe('archive and restore', () => {
  it('archives without deleting: chat in the log, questions closed, back with a click', async () => {
    const t = await startTestHub({ dione: [fake.text('Ecco la bozza.')] });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'una bozza', to: 'dione' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const q = t.core.hub.questions.create({
      agent: 'dione',
      runId: sent.runId,
      question: 'Tono serio o scherzoso?',
      options: [],
      blocking: false,
    });

    const res = await t.json<TeamArchiveResponse>('DELETE', '/api/team/agents/dione');
    expect(res).toMatchObject({
      ok: true,
      archived: { id: 'dione', name: 'Dione' },
      questionsClosed: 1,
    });
    expect(t.core.hub.questions.get(q.id)?.status).toBe('expired');
    expect(
      t
        .events()
        .find(
          (e): e is LogEvent<'question_expired'> =>
            e.type === 'question_expired' && e.data.questionId === q.id,
        )?.data.reason,
    ).toBe('agent_archived');
    expect(existsSync(join(t.home, 'agents', 'dione'))).toBe(false);
    expect(existsSync(join(t.home, 'archive', 'agents', 'dione', 'AGENTS.md'))).toBe(true);
    expect((await t.json<AgentSummary[]>('GET', '/api/agents')).map((a) => a.id)).toEqual([
      'titan',
      'rhea',
    ]);
    expect(agentsMd(t, 'titan')).not.toContain('Dione');
    // Her chat stays in the log; her memory stays in the notes.
    expect(t.events(sent.runId).some((e) => e.agent === 'dione' && e.type === 'message')).toBe(
      true,
    );
    expect(existsSync(join(t.core.hub.vault.root, 'Agenti/Dione/MEMORY.md'))).toBe(true);
    const view = await t.json<TeamView>('GET', '/api/team');
    expect(view.archived.map((a) => a.id)).toEqual(['dione']);
    expect((await t.api('POST', '/api/messages', { text: 'x', to: 'dione' })).status).toBe(404);

    const back = await t.json<TeamMemberView>('POST', '/api/team/archived/dione/restore', {});
    expect(back).toMatchObject({ id: 'dione', name: 'Dione' });
    expect(agentsMd(t, 'titan')).toContain('**Dione**');
    expect(existsSync(join(t.home, 'agents', 'dione', 'archived.json'))).toBe(false);
    expect((await t.json<TeamView>('GET', '/api/team')).archived).toEqual([]);
    expect(teamEvents(t).map((e) => e.data.action)).toEqual(['archive', 'restore']);
    expect((await t.api('POST', '/api/team/archived/dione/restore', {})).status).toBe(404);
  });

  it('a new monster never takes the id of an archived one; restoring asks for a free name', async () => {
    const t = await startTestHub({});
    await t.json('DELETE', '/api/team/agents/dione');
    const draft = await t.json<TeamDraft>('POST', '/api/team/drafts', { archetype: 'dione' });
    expect(draft).toMatchObject({ name: 'Dione', source: 'archetype', archetype: 'dione' });
    const created = await t.json<TeamMemberView>('POST', '/api/team/agents', draft);
    expect(created).toMatchObject({ id: 'dione-2', name: 'Dione' });

    const taken = await t.api('POST', '/api/team/archived/dione/restore', {});
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe('name_taken');
    const back = await t.json<TeamMemberView>('POST', '/api/team/archived/dione/restore', {
      name: 'Diana',
    });
    expect(back).toMatchObject({ id: 'dione', name: 'Diana' });
    expect(agentsMd(t, 'dione')).toMatch(/^# Diana/);
    expect(existsSync(join(t.core.hub.vault.root, 'Agenti/Diana/MEMORY.md'))).toBe(true);
    expect(agentsMd(t, 'titan')).toContain('**Diana**');
    expect(agentsMd(t, 'titan')).toContain('**Dione**');
  });
});

describe('add', () => {
  it('suggests archetypes and ideas, drafts with the model, adds the monster', async () => {
    const answers: string[] = [
      'non è JSON',
      JSON.stringify({
        agents: [
          {
            name: 'Tethys',
            title: 'il pianificatore',
            role: 'tiene il calendario editoriale',
            mission: 'organizzi il calendario editoriale e ricordi le scadenze',
            context: 'Giulio pubblica ogni settimana.',
            duties: ['Tieni un piano settimanale.'],
            area: 'Progetti/Calendario',
            tools: [],
          },
        ],
      }),
    ];
    const generate: Generate = () => Promise.resolve({ text: answers.shift()!, requests: 1 });
    const t = await startTestHub({}, { hub: { teamGenerate: generate } });
    await t.json('DELETE', '/api/team/agents/rhea');
    const s = await t.json<TeamSuggestions>('GET', '/api/team/suggestions');
    expect(s.archetypes.map((a) => a.archetype)).toEqual(['rhea']);
    expect(s.ideas.length).toBeGreaterThan(3);
    expect(s.names).not.toContain('Dione');

    const draft = await t.json<TeamDraft>('POST', '/api/team/drafts', {
      description: 'Pianifica i contenuti della settimana',
    });
    expect(draft).toMatchObject({ name: 'Tethys', source: 'model', area: 'Progetti/Calendario' });
    const looks = await t.json<TeamLooksResponse>('POST', '/api/team/looks', {
      name: 'Tethys',
      count: 3,
    });
    expect(looks.looks.length).toBeGreaterThan(0);
    for (const l of looks.looks) expect(MonsterGenomeSchema.safeParse(l.genome).success).toBe(true);

    const created = await t.json<TeamMemberView>('POST', '/api/team/agents', {
      ...draft,
      genome: looks.looks[0]!.genome,
    });
    expect(created).toMatchObject({ id: 'tethys', name: 'Tethys', title: 'il pianificatore' });
    expect(agentsMd(t, 'tethys')).toContain('Salvi i risultati in `Progetti/Calendario/`');
    expect(agentsMd(t, 'titan')).toContain('**Tethys**: tiene il calendario editoriale');
    expect(agentYaml(t, 'tethys').models).toEqual([{ provider: 'fake', model: 'titan' }]);
    expect(teamEvents(t).at(-1)?.data).toMatchObject({ action: 'add', agent: 'tethys' });
    expect(t.core.hub.vault.permissions.writableAreas('tethys')).toContain('Progetti/Calendario/');

    // A colour on top of another monster's is refused.
    const close = await t.api('POST', '/api/team/agents', {
      ...draft,
      name: 'Phoebe',
      genome: looks.looks[0]!.genome,
    });
    expect(close.status).toBe(400);
    expect(((await close.json()) as { error: string }).error).toBe('color_too_close');
    const sameLook = await t.api('PUT', '/api/team/agents/dione/look', {
      genome: looks.looks[0]!.genome,
    });
    expect(sameLook.status).toBe(400);
  });

  it('falls back without a model, refuses the model call while stopped, caps the team', async () => {
    const t = await startTestHub({}, { hub: { teamGenerate: null } });
    const draft = await t.json<TeamDraft>('POST', '/api/team/drafts', {
      description: 'Riassume i documenti lunghi in cinque punti',
      name: 'Mimas',
    });
    expect(draft).toMatchObject({ name: 'Mimas', source: 'fallback', web: false });
    const dup = await t.api('POST', '/api/team/drafts', { description: 'qualcosa', name: 'Rhea' });
    expect(dup.status).toBe(400);
    for (const name of ['Mimas', 'Tethys', 'Phoebe', 'Janus', 'Pandora']) {
      const d = await t.json<TeamDraft>('POST', '/api/team/drafts', {
        description: 'Riassume i documenti lunghi',
        name,
      });
      await t.json('POST', '/api/team/agents', d);
    }
    const full = await t.json<TeamDraft>('POST', '/api/team/drafts', { archetype: 'dione' });
    const res = await t.api('POST', '/api/team/agents', full);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('team_full');

    await t.json('POST', '/api/kill', {});
    const halted = await t.api('POST', '/api/team/drafts', { description: 'Fa le ricerche' });
    expect(halted.status).toBe(409);
    expect(((await halted.json()) as { error: string }).error).toBe('halted');
  });
});

describe('profile', () => {
  it('reads and writes names, tone, language and the "always ask" extras', async () => {
    const t = await startTestHub({});
    let profile = await t.json<ProfileView>('GET', '/api/profile');
    expect(profile).toMatchObject({
      userName: 'Giulio',
      orchestratorName: 'Titan',
      language: 'it',
    });
    expect(profile.askAlways.fixed.map((f) => f.id)).toEqual([...ASK_ALWAYS_FIXED]);

    expect((await t.api('PUT', '/api/profile', { tone: 'urlato' })).status).toBe(400);
    expect(
      (await t.api('PUT', '/api/profile', { askAlways: { extras: ['publish'], text: '' } })).status,
    ).toBe(400);

    // A refused capo name leaves everything as it was.
    const clash = await t.api('PUT', '/api/profile', {
      userName: 'Pino',
      orchestratorName: 'Rhea',
    });
    expect(clash.status).toBe(400);
    expect((await t.json<ProfileView>('GET', '/api/profile')).userName).toBe('Giulio');

    profile = await t.json<ProfileView>('PUT', '/api/profile', {
      userName: 'Giuliano',
      orchestratorName: 'Atlas',
      tone: 'diretto',
      language: 'en',
      style: 'frasi corte',
      askAlways: { extras: ['goal'], text: 'contattare i fornitori' },
    });
    expect(profile).toMatchObject({
      userName: 'Giuliano',
      orchestratorName: 'Atlas',
      tone: 'diretto',
      language: 'en',
      style: 'frasi corte',
      askAlways: { extras: ['goal'], text: 'contattare i fornitori' },
    });
    expect(agentsMd(t, 'titan')).toMatch(
      /^# Atlas\n\nSei Atlas, il coordinatore della squadra di Giuliano/,
    );
    expect(agentsMd(t, 'titan')).toContain('in inglese.');
    expect(agentsMd(t, 'rhea')).toContain('Ricevi incarichi da Atlas');
    expect(agentsMd(t, 'rhea')).toContain('della squadra di Giuliano');
    expect(agentsMd(t, 'rhea')).toContain('Sempre in inglese');
    expect(agentYaml(t, 'titan').role).toBe('coordinatore della squadra di Giuliano');
    expect(readSettingsFile(t.home)).toMatchObject({
      userName: 'Giuliano',
      orchestratorName: 'Atlas',
    });
    // The four fixed kinds stay on, the extras follow the choice.
    const rules = t.core.hub.gate.rules.map((r) => `${r.id}:${r.effect}`);
    for (const id of [...ASK_ALWAYS_FIXED, 'goal', 'user-ask'])
      expect(rules).toContain(`${id}:ask`);
    const note = readFileSync(join(t.core.hub.vault.root, 'profilo.md'), 'utf8');
    expect(note).toContain('# Profilo di Giuliano');
    expect(note).toContain('- Coordinatore della squadra: Atlas');
    expect(note).toContain('- Tono: diretto');
    expect(note).toContain('- Lingua: inglese');
    expect(note).toContain('- Stile: frasi corte');
    expect(note).toContain('- contattare i fornitori');
    expect(existsSync(join(t.core.hub.vault.root, 'Agenti/Atlas/MEMORY.md'))).toBe(true);
    expect(teamEvents(t).map((e) => e.data.action)).toEqual(['rename', 'profile']);

    // The user's own lines in profilo.md survive the next change; extras can be turned off.
    const path = join(t.core.hub.vault.root, 'profilo.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n## Note mie\n- Odio le emoji.\n`);
    await t.core.hub.vault.reindex();
    await t.json('PUT', '/api/profile', { askAlways: { extras: [], text: '' } });
    const after = readFileSync(path, 'utf8');
    expect(after).toContain('- Odio le emoji.');
    expect(after).not.toContain('contattare i fornitori');
    const again = t.core.hub.gate.rules.map((r) => r.id);
    expect(again).not.toContain('goal');
    expect(again).not.toContain('user-ask');
    expect(again).toEqual(expect.arrayContaining([...ASK_ALWAYS_FIXED]));
  });
});
