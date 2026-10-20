import { join } from 'node:path';
import type { ClaudeConnectorStatus } from '@monsters/providers';
import { MCP_CATALOG, type LogEvent, type MonstersTool } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_FREE_CHAIN, isDefaultChain } from '../src/agents/archetypes.ts';
import {
  ClaudeConnectionError,
  ClaudeConnectionService,
} from '../src/providers/claude-connections.ts';
import {
  classifyOutbound,
  createCoreServices,
  migrate,
  teamMigrations,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * D-069: services connected through the user's Claude account, the choice
 * kept by Monsters and the state asked to the binary; "abbonamento prima"
 * for chains Monsters chose; the web search's query on the brake.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function services(): CoreServices {
  const s = createCoreServices({ home: tempHome() });
  opened.push(s);
  migrate(s.db, 'team', teamMigrations);
  return s;
}

function service(
  s: CoreServices,
  opts: {
    ready?: boolean;
    connectors?: Record<string, ClaudeConnectorStatus['state']>;
    servers?: Record<string, string>;
  } = {},
) {
  const asked: string[] = [];
  let ready = opts.ready ?? true;
  const svc = new ClaudeConnectionService({
    state: s.state,
    log: s.log,
    claude: () => ({
      connectorStatus: (name: string) => {
        asked.push(name);
        return Promise.resolve({ state: opts.connectors?.[name] ?? 'missing' });
      },
      probeServers: (servers: { name: string }[]) => {
        asked.push(...servers.map((x) => x.name));
        return Promise.resolve(opts.servers ?? {});
      },
    }),
    ready: () => ready,
    dir: join(s.paths.home, 'checks'),
    agentExists: (id) => ['rhea', 'dione'].includes(id),
  });
  return { svc, asked, setReady: (v: boolean) => (ready = v) };
}

describe('services through Claude', () => {
  it('keeps what a run reported when the text of the check is not recognised (C-10)', async () => {
    const s = services();
    const known = service(s, { connectors: { Figma: 'unknown' } });
    known.svc.set('figma', undefined, 'ui');
    // Nothing known yet: "unknown", not an error.
    let view = await known.svc.check();
    expect(view.connections.find((c) => c.id === 'figma')).toMatchObject({ state: 'unknown' });
    // A run's init says it is connected; a later unrecognised check must not undo it.
    known.svc.noteRun([{ name: 'claude.ai Figma', status: 'connected' }]);
    view = await known.svc.check();
    expect(view.connections.find((c) => c.id === 'figma')).toMatchObject({ state: 'connected' });
  });

  it('lists the gallery entries reachable through Claude, none added at first', () => {
    const s = services();
    const view = service(s).svc.view();
    expect(view.claude).toBe(true);
    expect(view.connections.map((c) => c.id)).toEqual(
      MCP_CATALOG.filter((e) => e.viaClaude).map((e) => e.id),
    );
    expect(view.connections.map((c) => c.id)).toEqual(
      expect.arrayContaining(['slack', 'google', 'figma', 'canva', 'claude-design']),
    );
    expect(view.connections.every((c) => !c.added && c.state === 'unknown')).toBe(true);
    expect(view.connections.find((c) => c.id === 'google')!.parts.map((p) => p.name)).toEqual([
      'Gmail',
      'Google Drive',
      'Google Calendar',
    ]);
  });

  it('adds a service, asks the binary how it stands and hands it to the runs of its agents', async () => {
    const s = services();
    const { svc, asked } = service(s, {
      connectors: { Figma: 'connected', Gmail: 'connected', 'Google Drive': 'needs_login' },
      servers: { 'claude-design': 'failed' },
    });
    svc.set('figma', undefined, 'ui');
    svc.set('google', ['rhea'], 'ui');
    svc.set('claude-design', ['*'], 'ui');
    const view = await svc.check();
    expect(asked.sort()).toEqual(
      ['Figma', 'Gmail', 'Google Calendar', 'Google Drive', 'claude-design'].sort(),
    );
    const by = (id: string) => view.connections.find((c) => c.id === id)!;
    expect(by('figma')).toMatchObject({ added: true, agents: ['*'], state: 'connected' });
    // The worst part wins: Calendar is not on the account, Drive needs a new sign-in.
    expect(by('google')).toMatchObject({ added: true, agents: ['rhea'], state: 'missing' });
    expect(by('claude-design')).toMatchObject({ state: 'needs_login' });
    expect(by('claude-design').message).toContain('/design-login');

    expect(svc.connectorsFor('rhea').map((c) => c.name)).toEqual([
      'claude.ai Figma',
      'claude.ai Gmail',
      'claude.ai Google Drive',
      'claude.ai Google Calendar',
      'claude-design',
    ]);
    expect(svc.connectorsFor('dione')).toEqual([
      { name: 'claude.ai Figma', kind: 'claude-ai', url: 'https://mcp.figma.com/*' },
      { name: 'claude-design', kind: 'http', url: 'https://api.anthropic.com/v1/design/mcp' },
    ]);
    const added = s.log.query({ type: 'mcp_server', limit: 10 }) as LogEvent<'mcp_server'>[];
    expect(added.map((e) => e.data.action).sort()).toEqual(['added', 'added', 'added']);
  });

  it('a run updates the state; nothing reaches the runs while the plan is off', () => {
    const s = services();
    const { svc, setReady } = service(s);
    svc.set('figma', undefined, 'ui');
    svc.noteRun([
      { name: 'monsters', status: 'connected' },
      { name: 'claude.ai Figma', status: 'needs-auth' },
      { name: 'claude.ai Notion', status: 'connected' },
    ]);
    expect(svc.view().connections.find((c) => c.id === 'figma')!.state).toBe('needs_login');
    svc.noteRun([{ name: 'claude.ai Figma', status: 'pending' }]);
    expect(svc.view().connections.find((c) => c.id === 'figma')!.state).toBe('needs_login');
    setReady(false);
    expect(svc.connectorsFor('rhea')).toEqual([]);
    expect(svc.view().claude).toBe(false);
  });

  it('removes a service from the runs only, and refuses what is not reachable through Claude', () => {
    const s = services();
    const { svc } = service(s);
    svc.set('canva', undefined, 'ui');
    expect(svc.remove('canva', 'ui').connections.find((c) => c.id === 'canva')!.added).toBe(false);
    expect(svc.connectorsFor('rhea')).toEqual([]);
    const removed = s.log.query({
      type: 'mcp_server',
      order: 'desc',
      limit: 10,
    })[0] as LogEvent<'mcp_server'>;
    expect(removed.data.message).toContain('Resta collegato al tuo account Claude');
    expect(() => svc.set('github', undefined, 'ui')).toThrow(ClaudeConnectionError);
    expect(() => svc.set('figma', ['nessuno'], 'ui')).toThrow(/nessun mostro/);
  });
});

describe('"abbonamento prima": chains Monsters chose', () => {
  const on =
    (...ids: string[]) =>
    (p: string) =>
      ids.includes(p);
  it('the default free chain, the free router, a chain that cannot run; not a chain the user chose', () => {
    expect(isDefaultChain(DEFAULT_FREE_CHAIN, on('openrouter'))).toBe(true);
    expect(
      isDefaultChain([{ provider: 'openrouter', model: 'openrouter/free' }], on('openrouter')),
    ).toBe(true);
    expect(isDefaultChain([], on())).toBe(true);
    expect(
      isDefaultChain([{ provider: 'openrouter', model: 'qwen/qwen3:free' }], on('claude-agent')),
    ).toBe(true);
    expect(
      isDefaultChain([{ provider: 'openrouter', model: 'qwen/qwen3:free' }], on('openrouter')),
    ).toBe(false);
    expect(
      isDefaultChain(
        [{ provider: 'claude-agent', model: 'sonnet' }],
        on('claude-agent', 'chatgpt'),
      ),
    ).toBe(false);
  });
});

describe("the brake on a web search's query", () => {
  const tool = {
    name: 'web_search',
    description: '',
    inputSchema: z.unknown(),
  } as unknown as MonstersTool;
  it('only a key of the user sent as a query leaves for real', () => {
    const containsSecret = (t: string) => t.includes('sk-or-segreta');
    expect(classifyOutbound(tool, { query: 'ricette di pasta' }, { containsSecret })).toBeNull();
    expect(
      classifyOutbound(tool, { query: 'mario.rossi@example.com chi è' }, { containsSecret }),
    ).toBeNull();
    expect(
      classifyOutbound(tool, { query: 'errore sk-or-segreta-123' }, { containsSecret }),
    ).toMatchObject({ category: 'contact', certain: true });
  });

  it('git with global options first is still a push (seen on Claude Code: `git -C <dir> push`)', () => {
    const shell = { ...tool, name: 'shell' } as MonstersTool;
    const cmd = (command: string) => classifyOutbound(shell, { command });
    expect(cmd('git -C /tmp/ws push origin main')).toMatchObject({ category: 'publish' });
    expect(cmd('git -c user.name=x --no-pager push')).toMatchObject({ category: 'publish' });
    expect(cmd('git -C repo push --force origin main')).toMatchObject({ category: 'delete' });
    expect(cmd('git -C repo reset --hard HEAD~3')).toMatchObject({ category: 'delete' });
    expect(cmd('git -C repo status')).toBeNull();
    expect(cmd('git -C repo log --oneline')).toBeNull();
  });
});
