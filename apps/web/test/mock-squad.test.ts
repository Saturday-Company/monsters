import type {
  AgentSummary,
  ProfileView,
  TeamDraft,
  TeamLooksResponse,
  TeamMemberView,
  TeamView,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { MOCK_DEMO_USER, MockCore } from '../src/lib/mock/core.ts';

/** The mock core answers the Settings → Squadra API like the real one. */
describe('mock core: team, profile, password', () => {
  const core = () => {
    const c = new MockCore({ mode: 'demo', speed: 0.01 });
    const call = <T>(method: string, path: string, body?: unknown) => {
      const res = c.handle(method, path, body);
      return { status: res.status, body: res.body as T };
    };
    return { c, call };
  };

  it('renames, edits, re-skins, archives and restores', () => {
    const { c, call } = core();
    const team = call<TeamView>('GET', '/api/team').body;
    expect(team.members[0]).toMatchObject({ id: 'titan', isOrchestrator: true });
    expect(call('PATCH', '/api/team/agents/dione', { name: 'Rhea' }).status).toBe(400);
    expect(call('DELETE', '/api/team/agents/titan').status).toBe(400);
    const renamed = call<TeamMemberView>('PATCH', '/api/team/agents/rhea', { name: 'Rea' });
    expect(renamed.body).toMatchObject({ id: 'rhea', name: 'Rea' });
    expect(
      call<{ error: string }>('PATCH', '/api/team/agents/enceladus', { duties: ['Una regola.'] })
        .body.error,
    ).toBe('instructions_edited');
    const looks = call<TeamLooksResponse>('POST', '/api/team/looks', {
      agent: 'dione',
      count: 2,
    }).body;
    expect(
      call('PUT', '/api/team/agents/dione/look', { genome: looks.looks[0]!.genome }).status,
    ).toBe(200);
    expect(call('DELETE', '/api/team/agents/dione').status).toBe(200);
    expect(call<AgentSummary[]>('GET', '/api/agents').body.map((a) => a.id)).not.toContain('dione');
    expect(call<TeamView>('GET', '/api/team').body.archived.map((a) => a.id)).toEqual(['dione']);
    expect(call('POST', '/api/team/archived/dione/restore', {}).status).toBe(200);
    const actions = c.events.filter((e) => e.type === 'team_change').map((e) => e.data.action);
    expect(actions).toEqual(['rename', 'look', 'archive', 'restore']);
  });

  it('drafts and adds a monster; profile and password', () => {
    const { call } = core();
    const draft = call<TeamDraft>('POST', '/api/team/drafts', {
      description: 'Pianifica i contenuti della settimana',
    }).body;
    const added = call<TeamMemberView>('POST', '/api/team/agents', draft);
    expect(added.status).toBe(201);
    expect(added.body.name).toBe(draft.name);

    const profile = call<ProfileView>('PUT', '/api/profile', {
      userName: 'Giuliano',
      askAlways: { extras: ['goal'], text: '' },
    }).body;
    expect(profile).toMatchObject({ userName: 'Giuliano', askAlways: { extras: ['goal'] } });
    expect(profile.askAlways.fixed).toHaveLength(4);

    const wrong = call<{ error: string }>('POST', '/api/auth/password', {
      currentPassword: 'sbagliata',
      newPassword: 'nuova password',
    });
    expect(wrong.body.error).toBe('wrong_password');
    const ok = call('POST', '/api/auth/password', {
      currentPassword: MOCK_DEMO_USER.password,
      newPassword: 'nuova password',
    });
    expect(ok.status).toBe(200);
  });
});
