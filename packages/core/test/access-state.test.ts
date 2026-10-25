import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentConfig, type AgentDefinition } from '../src/agents/definition.ts';
import {
  accessCaps,
  accessChangeNote,
  accessState,
  claimContext,
  type AccessStateDeps,
} from '../src/team/access-state.ts';

// The texts the models read are tested in Italian (the family of the app language, byte for byte
// what they were); the English ones are checked in the blocks that switch the language.
beforeEach(() => setAppLang('it'));
afterEach(() => setAppLang('en'));

/* The accesses of a monster now, with their causes (D-140, D-141). */

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
    role: 'Prova',
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
const project = {
  id: 'tp',
  name: 'Progetto Social',
  webSearch: true,
  connectionsOff: { mcp: [] as string[], claude: [] as string[] },
};

function deps(over: Partial<AccessStateDeps> = {}, web = true): AccessStateDeps {
  const all = [luna, nova, pixel];
  return {
    team: {
      projectOf: () => project as never,
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

describe('accessState', () => {
  // C-15: a server given to the monster but missing from the run says the cause the run had;
  // "not responding" only for a server that is not answering (or a core that cannot tell).
  it.each([
    ['unlinked', 'Notion non risponde ora'],
    ['paused', 'i suoi strumenti sono in pausa finché l’utente non li accetta'],
    ['cut', 'non sono entrati in questo lavoro'],
    ['unlisted', 'nessuno dei suoi strumenti è in questo lavoro'],
    [undefined, 'Notion non risponde ora'],
  ] as const)('a given server not in the run, because %s', (missing, why) => {
    const state = accessState(
      deps({ allowed: () => true, ...(missing ? { missingWhy: () => missing } : {}) }),
      { agent: pixel, runId: 'r', toolNames: ['vault_read'] },
    );
    const notion = state.services.find((s) => s.name === 'Notion');
    expect(notion).toMatchObject({ has: false, off: true });
    expect(notion!.why).toContain(why);
  });

  it('Luna of 19/10: no web for D-026, Canva and Notion not ticked in the project', () => {
    const state = accessState(deps(), {
      agent: luna,
      runId: 'r',
      toolNames: ['vault_read', 'delegate'],
      harness: 'claude-agent',
      terminal: true,
    });
    expect(state.web).toMatchObject({ has: false, off: false });
    expect(state.web.why).toContain('ce l’hanno Pixel');
    expect(state.web.why).toContain('non per un no dell’utente');
    const canva = state.services.find((s) => s.name === 'Canva')!;
    expect(canva).toMatchObject({ has: false, off: false, project: true });
    expect(canva.why).toContain('pagina del progetto «Progetto Social»');
    expect(canva.why).toContain('access_request');
    expect(state.services.find((s) => s.name === 'Notion')).toMatchObject({ project: true });
    // A service of the gallery nobody connected: "non è collegato" is true.
    expect(state.services.find((s) => s.aliases?.includes('Gmail'))).toMatchObject({
      has: false,
      off: true,
    });
    expect(state.members.find((m) => m.name === 'Pixel')?.web.has).toBe(true);
    expect(state.terminal.has).toBe(true);
  });

  it('the web permission off is a true cause', () => {
    const state = accessState(deps({}, false), {
      agent: nova,
      runId: 'r',
      toolNames: ['vault_read', 'shell'],
    });
    expect(state.web).toMatchObject({ has: false, off: true });
    expect(state.web.why).toContain('Impostazioni → Permessi');
  });

  it('a Telegram chat with other people closes the terminal: a true cause', () => {
    const state = accessState(deps({ othersAsk: () => 'Marco scrive nella chat' }), {
      agent: nova,
      runId: 'r',
      toolNames: ['vault_read'],
    });
    expect(state.terminal).toMatchObject({ has: false, off: true });
  });

  it('the names of a claim: the services, every other monster, the user', () => {
    const ctx = claimContext(deps(), luna);
    expect(ctx.services?.map((s) => s.name)).toEqual(expect.arrayContaining(['Notion', 'Canva']));
    expect(ctx.members).toEqual(['Nova', 'Pixel']);
    expect(ctx.userNames).toEqual(['Giulio']);
  });
});

describe('accessCaps and accessChangeNote', () => {
  it('a change of the settings gives one note; the first run and no change give none', () => {
    const before = accessCaps(deps(), pixel, {});
    expect(before).toEqual(['il web']);
    expect(accessChangeNote(undefined, before)).toBeNull();
    expect(accessChangeNote(before, before)).toBeNull();
    const now = accessCaps(deps({ allowed: () => true }), pixel, {
      connectors: ['claude.ai Canva'],
    });
    expect(now).toEqual(['Canva', 'il web', 'Notion']);
    expect(accessChangeNote(before, now)).toContain('da ora hai Canva e Notion');
    expect(accessChangeNote(now, ['il web'])).toContain('non hai più Canva e Notion');
  });
});
