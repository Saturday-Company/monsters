import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MonsterGenomeSchema } from '@monsters/monster-kit';
import type { ProjectView, TeamLooksResponse, TeamMemberView } from '@monsters/shared';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../src/index.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';
import { langHome } from './lang-home.ts';
import { inLang } from './prompt-lang.ts';

/*
 * The monsters of a project (members and lead) are edited with the same
 * operations as the Squadra personale: rename, look, role and duties.
 */

const agentsMd = (t: TestHub, id: string) =>
  readFileSync(join(t.home, 'agents', id, 'AGENTS.md'), 'utf8');
const agentYaml = (t: TestHub, id: string) =>
  parseYaml(readFileSync(join(t.home, 'agents', id, 'agent.yaml'), 'utf8')) as AgentConfig;

const distance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
const hueOf = (genome: unknown) => MonsterGenomeSchema.parse(genome).palette.hue;

/** A project "Saturday" with its lead Leda and a copy of Rhea in it. */
async function withSquad(): Promise<{ t: TestHub; member: string }> {
  // The assertions below are those of the Italian family (D-153): the templates are written in it.
  inLang('it');
  const t = await startTestHub({}, { home: langHome('it') });
  await t.json<ProjectView>('POST', '/api/projects', { name: 'Saturday', lead: { name: 'Leda' } });
  const p = await t.json<ProjectView>('POST', '/api/projects/saturday/members', {
    copyOf: 'rhea',
    name: 'Ricercatrice',
  });
  return { t, member: p.members.find((m) => !m.isLead)!.id };
}

describe('editing the monsters of a project', () => {
  it('renames a member: files, write globs, memory folder and the lead’s list follow', async () => {
    const { t, member } = await withSquad();
    const vault = t.core.hub.vault.root;
    expect(agentYaml(t, member).vault.write).toContain('Agenti/Ricercatrice/**');
    await t.core.hub.vault.write(
      { agentId: member },
      { path: 'Agenti/Ricercatrice/MEMORY.md', content: '# Memoria\n' },
    );
    const renamed = await t.json<TeamMemberView>('PATCH', `/api/team/agents/${member}`, {
      name: 'Cercatrice',
    });
    expect(renamed).toMatchObject({ id: member, name: 'Cercatrice', project: 'saturday' });
    expect(agentYaml(t, member)).toMatchObject({ project: 'saturday', kind: 'subagent' });
    expect(agentYaml(t, member).vault.write).toContain('Agenti/Cercatrice/**');
    expect(agentYaml(t, member).vault.write).not.toContain('Agenti/Ricercatrice/**');
    expect(agentsMd(t, member)).toContain('Sei Cercatrice');
    expect(agentsMd(t, member)).toContain('Ricevi incarichi da Leda');
    expect(agentsMd(t, 'leda')).toContain('**Cercatrice**');
    expect(agentsMd(t, 'leda')).not.toContain('**Ricercatrice**');
    expect(agentsMd(t, 'titan')).not.toContain('Cercatrice');
    expect(existsSync(join(vault, 'Agenti/Cercatrice/MEMORY.md'))).toBe(true);
    expect(existsSync(join(vault, 'Agenti/Ricercatrice'))).toBe(false);
    expect(t.core.hub.team.projectOf(member)?.id).toBe('saturday');
  });

  it('reads one monster of a project, the lead too, with the fields its row edits', async () => {
    const { t, member } = await withSquad();
    const view = await t.json<TeamMemberView>('GET', `/api/team/agents/${member}`);
    expect(view).toMatchObject({
      id: member,
      project: 'saturday',
      isLead: false,
      isOrchestrator: false,
      area: 'Progetti/Saturday/Ricerche',
    });
    expect(view.duties?.length).toBeGreaterThan(0);
    expect(await t.json<TeamMemberView>('GET', '/api/team/agents/leda')).toMatchObject({
      project: 'saturday',
      isLead: true,
      isOrchestrator: false,
    });
    expect((await t.api('GET', '/api/team/agents/nessuno')).status).toBe(404);
  });

  it('names stay unique across every squad, in both directions', async () => {
    const { t, member } = await withSquad();
    for (const [id, name] of [
      [member, 'Dione'],
      [member, 'Leda'],
      [member, 'Saturday'],
      ['dione', 'Ricercatrice'],
      ['rhea', 'Ricercatrice'],
      ['leda', 'Rhea'],
      ['leda', 'Ricercatrice'],
    ] as const) {
      const r = await t.api('PATCH', `/api/team/agents/${id}`, { name });
      expect(r.status, `${id} → ${name}`).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe('invalid_name');
    }
  });

  it('edits role, duties, area and web of a member, and the lead’s list shows the new role', async () => {
    const { t, member } = await withSquad();
    const edited = await t.json<TeamMemberView>('PATCH', `/api/team/agents/${member}`, {
      role: 'Cerca idee per i post',
      duties: ['Cerchi idee per i post.', 'Le ordini per tema.'],
      mission: 'trovi idee per i post della settimana',
      area: 'Progetti/Saturday/Idee',
      web: false,
    });
    expect(edited).toMatchObject({
      role: 'Cerca idee per i post',
      duties: ['Cerchi idee per i post.', 'Le ordini per tema.'],
      area: 'Progetti/Saturday/Idee',
      web: false,
      project: 'saturday',
    });
    expect(agentYaml(t, member).vault.write).toContain('Progetti/Saturday/Idee/**');
    expect(agentYaml(t, member).tools).not.toContain('web_search');
    expect(agentsMd(t, member)).toContain('Ricevi incarichi da Leda');
    expect(agentsMd(t, 'leda')).toContain('Cerca idee per i post');
    // Rename and role in one go.
    const both = await t.json<TeamMemberView>('PATCH', `/api/team/agents/${member}`, {
      name: 'Idee',
      role: 'Trova idee per i post',
    });
    expect(both).toMatchObject({ name: 'Idee', role: 'Trova idee per i post' });
    expect(agentsMd(t, 'leda')).toContain('**Idee**: Trova idee per i post');
  });

  it('looks for a member keep away from its project’s colours, not from the personal squad’s', async () => {
    const { t, member } = await withSquad();
    const team = t.core.hub.team;
    const leda = hueOf(team.byId('leda')!.genome);
    const { looks } = await t.json<TeamLooksResponse>('POST', '/api/team/looks', {
      agent: member,
      count: 3,
    });
    expect(looks.length).toBeGreaterThan(0);
    for (const l of looks) expect(distance(hueOf(l.genome), leda)).toBeGreaterThanOrEqual(30);
    // Chosen: saved, still in the project.
    const set = await t.json<TeamMemberView>('PUT', `/api/team/agents/${member}/look`, {
      genome: looks[0]!.genome,
    });
    expect(set).toMatchObject({ id: member, project: 'saturday' });
    // A colour within 30° of the lead's is refused.
    const base = looks[0]!.genome as { palette: object };
    const close = { ...base, palette: { ...base.palette, hue: leda } };
    const refused = await t.api('PUT', `/api/team/agents/${member}/look`, { genome: close });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe('color_too_close');
    // The colour of a monster of the personal squad is fine: other squads do not count.
    const mine = await t.json<TeamLooksResponse>('POST', '/api/team/looks', {
      agent: 'dione',
      count: 3,
    });
    const dione = hueOf(mine.looks.find((l) => distance(hueOf(l.genome), leda) >= 30)!.genome);
    {
      const other = { ...base, palette: { ...base.palette, hue: dione } };
      expect(
        (await t.api('PUT', `/api/team/agents/${member}/look`, { genome: other })).status,
      ).toBe(200);
    }
  });

  it('the lead: renamed and new look, its role stays the lead’s template', async () => {
    const { t, member } = await withSquad();
    const before = agentsMd(t, 'leda');
    expect(before).toContain('«Saturday»');
    const renamed = await t.json<TeamMemberView>('PATCH', '/api/team/agents/leda', {
      name: 'Capitana',
    });
    expect(renamed).toMatchObject({
      id: 'leda',
      name: 'Capitana',
      project: 'saturday',
      isLead: true,
    });
    expect(agentYaml(t, 'leda')).toMatchObject({
      kind: 'lead',
      project: 'saturday',
      name: 'Capitana',
    });
    expect(agentYaml(t, 'leda').vault.write).not.toContain('Agenti/Leda/**');
    expect(agentsMd(t, 'leda')).toBe(before.replaceAll('Leda', 'Capitana'));
    expect(agentsMd(t, member)).toContain('Ricevi incarichi da Capitana');
    expect(agentsMd(t, member)).not.toContain('Leda');
    expect(t.core.hub.team.lead('saturday')?.config.id).toBe('leda');
    // A role or duties are not the lead's to change; the look is.
    for (const edit of [{ role: 'Fa altro per me' }, { duties: ['Fa altro.'] }, { web: false }]) {
      const r = await t.api('PATCH', '/api/team/agents/leda', edit);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe('orchestrator');
    }
    const { looks } = await t.json<TeamLooksResponse>('POST', '/api/team/looks', {
      agent: 'leda',
      count: 2,
    });
    const set = await t.json<TeamMemberView>('PUT', '/api/team/agents/leda/look', {
      genome: looks[0]!.genome,
    });
    expect(set).toMatchObject({ id: 'leda', isLead: true });
    expect(agentYaml(t, 'leda').kind).toBe('lead');
  });
});
