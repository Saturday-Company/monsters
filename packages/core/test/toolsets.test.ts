import { fake } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  ALL_VAULT_TOOLS,
  DEFAULT_FREE_CHAIN,
  TEAM_TOOLS,
  dioneBlueprint,
  needsRareTools,
  orchestratorBlueprint,
  pinnedChain,
  renderAgentFiles,
  turnTools,
  withTurnTools,
  type AgentConfig,
  type AgentDefinition,
} from '../src/index.ts';
import { parse as parseYaml } from 'yaml';
import { startTestHub } from './hub-helpers.ts';

function definition(bp: Parameters<typeof renderAgentFiles>[0]): AgentDefinition {
  const files = renderAgentFiles(bp);
  return {
    config: parseYaml(files['agent.yaml']) as AgentConfig,
    instructions: files['AGENTS.md'],
  };
}

const PAID = [{ provider: 'anthropic', model: 'claude-sonnet' }];
const orchestratorTools = [...ALL_VAULT_TOOLS, ...TEAM_TOOLS];

describe('tools of a turn (AG-07)', () => {
  it('free orchestrator: the core only, unless the request is about undoing, moving, deleting', () => {
    const titan = definition(orchestratorBlueprint({ user: 'Giulio', models: DEFAULT_FREE_CHAIN }));
    // The web is the permissions' business (D-026): left as it is.
    const plain = withTurnTools(
      titan,
      'Preparami 3 post per il menu autunnale',
    ).config.tools.filter((t) => !t.startsWith('web_'));
    expect(plain.sort()).toEqual(
      [
        'vault_search',
        'vault_read',
        'vault_list',
        'vault_write',
        'vault_edit',
        ...TEAM_TOOLS,
      ].sort(),
    );
    const undo = withTurnTools(titan, 'Annulla l’ultima modifica alla nota Menu').config.tools;
    expect(undo).toEqual(expect.arrayContaining(['vault_undo', 'vault_history', 'vault_restore']));
    expect(undo).not.toContain('vault_propose');
    expect(withTurnTools(titan, 'Sposta la nota in Archivio').config.tools).toContain('vault_move');
    // The definition of the team is not touched.
    expect(titan.config.tools).toContain('vault_undo');
  });

  it('paid chain: every tool, except vault_propose for who writes everywhere', () => {
    const titan = definition(orchestratorBlueprint({ user: 'Giulio', models: PAID }));
    const tools = withTurnTools(titan, 'ciao').config.tools.filter((t) => !t.startsWith('web_'));
    expect(tools).toEqual(orchestratorTools.filter((t) => t !== 'vault_propose'));
  });

  it('free sub-agent: no links and tags; vault_propose stays (it cannot write everywhere)', () => {
    const dione = definition(dioneBlueprint({ user: 'Giulio', models: DEFAULT_FREE_CHAIN }));
    const tools = withTurnTools(dione, 'Scrivi un post').config.tools;
    expect(tools).toContain('vault_propose');
    expect(tools).not.toContain('vault_links');
    expect(tools).not.toContain('vault_tags');
  });

  it('the System 1 hook can replace the rule', () => {
    const tools = turnTools(orchestratorTools, {
      request: 'qualcosa',
      free: true,
      writesEverywhere: true,
      needsRare: () => true,
    });
    expect(tools).toContain('vault_undo');
    expect(needsRareTools('Ripristina la versione di ieri')).toBe(true);
    expect(needsRareTools('Ciao, come va?')).toBe(false);
  });

  it('in the hub the orchestrator gets no vault_propose', async () => {
    const t = await startTestHub({ titan: [fake.text('Ciao!')] });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    await t.runEnded(sent.runId);
    const tools = (t.provider.calls[0]!.options.tools ?? []).map((x) => x.name);
    expect(tools).toContain('vault_write');
    expect(tools).not.toContain('vault_propose');
  });
});

describe('model pinned per agent and run (AG-25)', () => {
  const router = { provider: 'openrouter', model: 'openrouter/free' };
  const a = { provider: 'openrouter', model: 'a:free' };
  it('puts the model that served first, a router model only when free', () => {
    expect(pinnedChain([a, router], router)).toEqual([router, a]);
    expect(pinnedChain([a, router], { provider: 'openrouter', model: 'x/y:free' })).toEqual([
      { provider: 'openrouter', model: 'x/y:free' },
      a,
      router,
    ]);
    expect(pinnedChain([a, router], { provider: 'openrouter', model: 'x/paid' })).toEqual([
      a,
      router,
    ]);
    expect(pinnedChain([a], undefined)).toEqual([a]);
  });

  it('a second delegation to the same agent in the run starts from the model of the first', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Prima ricerca' }),
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Seconda ricerca' }),
        fake.text('Fatto.'),
      ],
      rhea: [fake.text('Uno.'), fake.text('Due.')],
    });
    // Rhea's chain has another model first: the first delegation falls back to `rhea`.
    await t.core.hub.team.setModels('rhea', [
      { provider: 'fake', model: 'missing' },
      { provider: 'fake', model: 'rhea' },
    ]);
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'Ricerche' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const fallbacks = t
      .events(sent.runId)
      .filter(
        (e): e is LogEvent<'error'> =>
          e.type === 'error' && e.agent === 'rhea' && e.data.code === 'provider_fallback',
      );
    // Only the first delegation tried the missing model.
    expect(fallbacks).toHaveLength(1);
  });
});
