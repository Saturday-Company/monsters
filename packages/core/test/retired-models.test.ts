import { describe, expect, it } from 'vitest';
import { DEFAULT_FREE_CHAIN, RETIRED_MODELS, replaceRetired } from '../src/agents/archetypes.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * A free model gone upstream (D-165): the default chain no longer has it, and
 * the chains saved with it get its successor at the next start.
 */

const OLD = { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' };
const NEW = { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' };

describe('retired models (D-165)', () => {
  it('the default free chain has none of them', () => {
    for (const m of DEFAULT_FREE_CHAIN) {
      expect(RETIRED_MODELS[`${m.provider}/${m.model}`]).toBeUndefined();
    }
    expect(DEFAULT_FREE_CHAIN[0]).toEqual(NEW);
  });

  it('replaces each one in place, keeps the tiers, never twice the same model', () => {
    expect(replaceRetired([{ provider: 'fake', model: 'a' }])).toBeNull();
    expect(
      replaceRetired([
        { ...OLD, tier: 'strong' as const },
        { provider: 'openrouter', model: 'x' },
      ]),
    ).toEqual([
      { ...NEW, tier: 'strong' },
      { provider: 'openrouter', model: 'x' },
    ]);
    expect(replaceRetired([OLD, NEW])).toEqual([NEW]);
  });

  it('a chain saved with one gets its successor at the next start', async () => {
    const t = await startTestHub({});
    await t.core.hub.team.setModels('rhea', [
      OLD,
      { provider: 'openrouter', model: 'openrouter/free' },
    ]);
    await t.core.close();
    const again = await startTestHub({}, { withoutTeam: true, home: t.home });
    expect(again.core.hub.team.get('rhea')!.config.models).toEqual([
      NEW,
      { provider: 'openrouter', model: 'openrouter/free' },
    ]);
    expect(again.core.hub.team.get('dione')!.config.models).toEqual([
      { provider: 'fake', model: 'dione' },
    ]);
    await again.core.close();
  });
});
