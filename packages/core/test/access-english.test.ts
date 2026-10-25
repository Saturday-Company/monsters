import { fake } from '@monsters/providers/testing';
import { setAppLang, type LogEvent, type ProjectView } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentConfig, type AgentDefinition } from '../src/agents/definition.ts';
import {
  accessCorrection,
  accessReminder,
  findAccessClaims,
  isAccessClaim,
  judgeAccessClaims,
  withoutAccessClaims,
  type AccessState,
  type ClaimContext,
  type RunAccessFacts,
} from '../src/team/access-claims.ts';
import {
  accessCaps,
  accessChangeNote,
  accessState,
  type AccessStateDeps,
} from '../src/team/access-state.ts';
import { tempHome } from './helpers.ts';
import { promptText, startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * The accesses in English (D-153, wave 3): the words that read what a monster or the user wrote
 * (English phrases match, the Italian ones still do), and the English family of the reasons, the
 * reminder, the note after a change and the notes of an access request. The Italian family is
 * tested, byte for byte, in access-claims, access-state and access-requests.
 */

beforeEach(() => setAppLang('en'));
afterEach(() => setAppLang('en'));

const CTX: ClaimContext = {
  services: [{ name: 'Canva' }, { name: 'Notion' }],
  members: ['Nova', 'Pixel'],
  userNames: ['Alice'],
};
const NO_FACTS: RunAccessFacts = { userNo: [], toolCauses: [] };

/** Canva through Claude, given to the whole team (the state the app writes). */
function canvaForTeam(t: TestHub): void {
  t.core.state.set('claude.connections', [{ id: 'canva', agents: ['*'] }]);
}

/** A project “Saturday” led by Leda (fake model `leda`). */
async function project(t: TestHub): Promise<ProjectView> {
  const p = await t.json<ProjectView>('POST', '/api/projects', {
    name: 'Saturday',
    lead: { name: 'Leda' },
    connectionsOff: { claude: ['canva'] },
  });
  await t.core.hub.team.setModels('leda', [{ provider: 'fake', model: 'leda' }]);
  return p;
}

describe('findAccessClaims in English', () => {
  it('finds what an English monster writes about a missing access', () => {
    for (const text of [
      'The web search was denied, so I could not look anything up.',
      "I don't have access to the web, so the numbers have to come from you.",
      "Canva isn't connected, so I can't see your graphics.",
      'Web access is turned off for me in this session.',
      'The terminal permission is missing.',
      'No monster can access the web, so you need to send me the data.',
      'It was blocked by the permissions of this session ("don\'t ask" mode).',
      'I am unable to browse right now.',
    ]) {
      expect(findAccessClaims(text, CTX).length, text).toBeGreaterThan(0);
    }
    expect(findAccessClaims("Canva isn't connected.", CTX)[0]).toMatchObject({
      services: ['Canva'],
      cause: true,
      user: false,
    });
    expect(findAccessClaims('No monster can access the web.', CTX)[0]).toMatchObject({
      squad: true,
      web: true,
    });
    expect(findAccessClaims('Web access was denied in this session.', CTX)[0]).toMatchObject({
      session: true,
      web: true,
    });
    expect(findAccessClaims('Nova has no permission for web search.', CTX)[0]).toMatchObject({
      member: 'Nova',
      web: true,
    });
  });

  it('leaves out what is not a claim, in English', () => {
    for (const text of [
      'I did not work around any block and I did not publish anything.',
      'It was not a refusal from the user: the web was not denied, Pixel has it.',
      'The site blocked the request (403): I will try another source later.',
      'Is the web blocked?',
      'If the web is denied I will use the notes.',
      // Somebody it does not name.
      "She doesn't have web access, so I did the search.",
    ]) {
      expect(findAccessClaims(text, CTX), text).toEqual([]);
    }
  });

  it('reads a refusal of the user, by name too', () => {
    for (const text of [
      'You said no to the email, so I did not send it.',
      'The user refused access to Canva.',
      'You did not give me permission for the terminal.',
      'Access was denied by the user.',
    ]) {
      expect(findAccessClaims(text, CTX)[0], text).toMatchObject({ user: true });
    }
    expect(findAccessClaims('Alice refused access to Canva.', CTX)[0]).toMatchObject({
      user: true,
      services: ['Canva'],
    });
    // The Italian ones still work in an English app.
    expect(
      findAccessClaims('Hai detto no alla mail, quindi non l’ho mandata.', CTX)[0],
    ).toMatchObject({ user: true });
  });

  it('a line about accesses is not memory; the decision of the user stays', () => {
    expect(
      isAccessClaim('- Web search is blocked by session permissions: get it granted first.', CTX),
    ).toBe(true);
    expect(isAccessClaim('- Tone: warm and short.', CTX)).toBe(false);
    const text = [
      '# Notes',
      '- Canva is not connected.',
      '- The user decided not to connect Canva.',
      '- Reports go on Friday.',
    ].join('\n');
    const out = withoutAccessClaims(text, CTX);
    expect(out.dropped).toEqual(['- Canva is not connected.']);
    expect(out.text).toContain('The user decided not to connect Canva');
    // Italian lines go in an English app too.
    expect(withoutAccessClaims('- Canva non è collegato.', CTX).dropped).toHaveLength(1);
  });
});

describe('the reminder and the facts in English', () => {
  const state: AccessState = {
    web: { has: true },
    terminal: { has: true },
    services: [{ name: 'Canva', has: true }],
    members: [{ name: 'Nova', web: { has: true } }],
  };

  it('a claim the facts do not back is answered in English', () => {
    const claims = findAccessClaims('The web was denied to me in this session. Alice said no.', {
      ...CTX,
    });
    const found = judgeAccessClaims(claims, state, NO_FACTS);
    expect(found.length).toBeGreaterThan(0);
    const truth = found.flatMap((u) => u.truth);
    expect(truth).toContain(
      'There is no “no” from the user in the log of this job: they have not refused or denied anything.',
    );
    expect(truth.join('\n')).toContain('web access: you have it in this job');
    expect(truth.join('\n')).toContain('In Monsters there is no “don’t ask” mode');
    const reminder = accessReminder(found, { userNo: [], toolCauses: ['SETTING_OFF: web is off'] });
    expect(reminder).toContain('[System check] Your answer says things about accesses');
    expect(reminder).toContain('How things really are:');
    expect(reminder).toContain('What the tools answered:\n- SETTING_OFF: web is off');
    expect(reminder).toContain('Rewrite the answer with these causes');
    expect(accessCorrection(found)).toMatch(/^\[Note from Monsters\] What this answer says/);
  });

  it('the squad’s web and a member’s web are named in English', () => {
    const squad = judgeAccessClaims(
      findAccessClaims('No monster can access the web.', CTX),
      state,
      NO_FACTS,
    );
    expect(squad[0]!.truth).toEqual(['In the squad, web access is had by: you, Nova.']);
    const nova = judgeAccessClaims(
      findAccessClaims('Nova has no permission for web search.', CTX),
      state,
      NO_FACTS,
    );
    expect(nova[0]!.truth).toEqual(['Nova’s web access: Nova has it']);
  });
});

describe('the reasons an access is missing, in English', () => {
  const monster = (
    id: string,
    name: string,
    tools: string[],
    kind = 'subagent',
  ): AgentDefinition => ({
    dir: `/agents/${id}`,
    instructions: '',
    config: parseAgentConfig({
      id,
      name,
      role: 'Test',
      color: '#336699',
      kind,
      models: [{ provider: 'fake', model: id }],
      tools,
      limits: { maxSteps: 10 },
    }),
  });
  const luna = monster('luna', 'Luna', ['vault_read', 'delegate', 'access_request'], 'lead');
  const nova = monster('nova', 'Nova', ['vault_read', 'shell']);
  const pixel = monster('pixel', 'Pixel', ['vault_read', 'web_search', 'web_fetch']);
  const social = {
    id: 'tp',
    name: 'Social project',
    webSearch: true,
    connectionsOff: { mcp: [] as string[], claude: [] as string[] },
  };
  function deps(over: Partial<AccessStateDeps> = {}, web = true): AccessStateDeps {
    const all = [luna, nova, pixel];
    return {
      team: {
        projectOf: () => social as never,
        members: () => all,
        list: () => all,
        get: (id: string) => all.find((d) => d.config.id === id),
        permissionsFor: () => ({ web, shell: true, vault: true, folders: [] }),
        savedPermissionsFor: () => ({ web, shell: true, vault: true, folders: [] }),
      },
      servers: () => [{ name: 'notion', label: 'Notion', enabled: true }],
      allowed: () => false,
      claude: () => [{ id: 'canva', added: true, state: 'connected', parts: [] }] as never,
      notHere: () => ['Notion', 'Canva (tramite Claude)'],
      othersAsk: () => undefined,
      userName: () => 'Giulio',
      ...over,
    };
  }

  it('says why the web is missing and where it is turned on, with the English places', () => {
    const state = accessState(deps(), {
      agent: luna,
      runId: 'r',
      toolNames: ['vault_read', 'delegate'],
      harness: 'claude-agent',
      terminal: true,
    });
    expect(state.web).toMatchObject({ has: false, off: false });
    expect(state.web.why).toBe(
      'it is not among the tools of this job (not because the user said no: the permission is on), Pixel has it',
    );
    const canva = state.services.find((s) => s.name === 'Canva')!;
    expect(canva).toMatchObject({ has: false, off: false, project: true });
    expect(canva.why).toBe(
      'Canva is connected to the user’s account but not to this project: it is given on the “Social project” project page, Settings tab (you can ask for it with `access_request`)',
    );
    const gallery = state.services.find((s) => s.aliases?.includes('Gmail'))!;
    expect(gallery.why).toBe(
      `${gallery.name} is not connected to the account: the user connects it in Settings → Connections`,
    );
  });

  it('the permissions that are off name the English places', () => {
    const off = accessState(deps({}, false), {
      agent: nova,
      runId: 'r',
      toolNames: ['vault_read', 'shell'],
    });
    expect(off.web.why).toBe(
      'the web permission is off: the user turns it on in Settings → Permissions → The web',
    );
    const telegram = accessState(deps({ othersAsk: () => 'Marco writes in the chat' }), {
      agent: nova,
      runId: 'r',
      toolNames: ['vault_read'],
    });
    expect(telegram.terminal.why).toBe(
      'other people write in this Telegram chat: the terminal and files are closed',
    );
    const browser = accessState(
      deps({
        servers: () => [{ name: 'browser', label: 'Browser', preset: 'browser', enabled: false }],
      }),
      { agent: nova, runId: 'r', toolNames: ['vault_read'] },
    );
    expect(browser.browser?.why).toBe(
      'the Monsters browser is off: the user turns it on in Settings → Connections → Apps and services',
    );
    const lead = monster('lea', 'Lea', ['vault_read'], 'lead');
    const noAsk = accessState(deps(), {
      agent: lead,
      runId: 'r',
      toolNames: ['vault_read'],
      harness: 'claude-agent',
    });
    expect(noAsk.services.find((s) => s.name === 'Canva')?.why).not.toContain('access_request');
    const sub = accessState(deps(), {
      agent: nova,
      runId: 'r',
      toolNames: ['vault_read'],
      harness: 'claude-agent',
    });
    expect(sub.services.find((s) => s.name === 'Canva')?.why).toContain('(ask your squad lead)');
  });

  it('the note after a change of accesses is English, and a language change is not a change', () => {
    const before = accessCaps(deps(), pixel, {});
    expect(before).toEqual(['web access']);
    const now = accessCaps(deps({ allowed: () => true }), pixel, {
      connectors: ['claude.ai Canva'],
    });
    expect(now).toEqual(['Canva', 'Notion', 'web access']);
    expect(accessChangeNote(before, now)).toBe(
      '[Access changed] The user has changed your accesses: from now on you have Canva and Notion. The “## Monsters” section as it is now applies: what memory, notes and the conversation say about accesses is from before the change.',
    );
    expect(accessChangeNote(now, ['web access'])).toContain('you no longer have Canva and Notion');
    // What an Italian app saved is the same access.
    expect(accessChangeNote(['il web'], before)).toBeNull();
    expect(accessChangeNote(['il web', 'terminale e file'], ['web access'])).toContain(
      'you no longer have terminal and files',
    );
    setAppLang('it');
    expect(accessChangeNote(['web access'], ['il web'])).toBeNull();
  });
});

describe('access_request in English', () => {
  it('the card, the note after the answer and the hints are English', async () => {
    const home = tempHome();
    const t = await startTestHub(
      {
        leda: [
          fake.toolCall('access_request', {
            access: 'service',
            service: 'canva',
            why: 'To read the club’s graphics',
          }),
          fake.toolCall('access_request', { access: 'service', service: 'Figma', why: 'Files' }),
          fake.text('I asked for Canva, I wait.'),
          fake.text('Canva is on for the project.'),
        ],
      },
      { home, hub: { askWaitMs: 5_000 }, lang: 'en' },
    );
    canvaForTeam(t);
    await project(t);
    const sent = await t.json<{ runId: string }>('POST', '/api/projects/saturday/messages', {
      text: 'Get the graphics from Canva',
    });
    let q = t.core.hub.questions.list({ status: 'open' })[0];
    for (let i = 0; i < 200 && !q; i++) {
      await new Promise((r) => setTimeout(r, 10));
      q = t.core.hub.questions.list({ status: 'open' })[0];
    }
    expect(q!.question).toBe(
      'Can I give Canva to the project “Saturday”? To read the club’s graphics',
    );
    // Leda gains Canva herself: parked at once (D-163), the tap starts her next run with the note.
    await t.runEnded(sent.runId);
    const results = t
      .events(sent.runId)
      .filter((e) => e.type === 'tool_result' && e.data.tool === 'access_request')
      .map((e) => JSON.stringify(e.data));
    expect(results[0]).toContain('"status":"waiting_user"');
    expect(results[0]).toContain('The request is now with the user, as a card with');
    const resumed = t.waitEvent(
      (e): e is LogEvent<'run'> =>
        e.type === 'run' && e.runId !== sent.runId && e.data.status !== 'started',
    );
    await t.json('POST', `/api/questions/${q!.id}/answer`, { optionId: 'grant' });
    await resumed;
    expect(promptText(t.provider.callsTo('leda').at(-1)!.options.prompt)).toContain(
      'Done: Monsters has granted Canva to the project “Saturday”. It applies from the next job of whoever uses it',
    );
    expect(results[1]).toContain(
      'tell Giulio to connect Figma in Settings → Connections (“Connect through Claude”, with the Claude subscription)',
    );
  });
});
