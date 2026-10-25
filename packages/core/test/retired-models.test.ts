import { chmodSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '@monsters/providers';
import { FakeProvider } from '@monsters/providers/testing';
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

  it('keeps the stronger tier when two links collapse into one (C-11)', () => {
    expect(
      replaceRetired([
        { ...OLD, tier: 'light' as const },
        { ...NEW, tier: 'strong' as const },
      ]),
    ).toEqual([{ ...NEW, tier: 'strong' }]);
    expect(
      replaceRetired([
        { ...OLD, tier: 'strong' as const },
        { ...NEW, tier: 'light' as const },
      ]),
    ).toEqual([{ ...NEW, tier: 'strong' }]);
  });

  it('leaves one line in Activity per replaced agent (C-11)', async () => {
    const t = await startTestHub({});
    await t.core.hub.team.setModels('rhea', [OLD]);
    await t.core.close();
    const again = await startTestHub({}, { withoutTeam: true, home: t.home });
    const lines = again.core.log
      .query({ type: 'error' })
      .filter((e) => e.data.code === 'retired_model');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.agent).toBe('system');
    expect(lines[0]!.data.message).toContain('Rhea');
    expect(lines[0]!.data.message).toContain(NEW.model);
    await again.core.close();
  });

  it('an agent.yaml that cannot be written does not stop the start (C-4)', async () => {
    const t = await startTestHub({});
    await t.core.hub.team.setModels('rhea', [
      { ...OLD, tier: 'strong' },
      { provider: 'openrouter', model: 'openrouter/free' },
    ]);
    await t.core.close();
    const file = join(t.home, 'agents', 'rhea', 'agent.yaml');
    const before = readFileSync(file, 'utf8');
    chmodSync(file, 0o444);
    try {
      // Root, Windows: the file stays writable and there is nothing to prove.
      let writable = true;
      try {
        accessSync(file, constants.W_OK);
      } catch {
        writable = false;
      }
      if (writable) return;
      const again = await startTestHub({}, { withoutTeam: true, home: t.home });
      expect(again.core.hub.team.get('rhea')!.config.models).toEqual([
        { ...NEW, tier: 'strong' },
        { provider: 'openrouter', model: 'openrouter/free' },
      ]);
      expect(readFileSync(file, 'utf8')).toBe(before);
      const lines = again.core.log
        .query({ type: 'error' })
        .filter((e) => e.data.code === 'retired_model');
      expect(lines).toHaveLength(1);
      expect(lines[0]!.data.message).toContain('could not be saved');
      // The other agents are untouched and the core answers.
      expect(again.core.hub.team.get('dione')!.config.models).toEqual([
        { provider: 'fake', model: 'dione' },
      ]);
      await again.core.close();
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it('a draft proposed with the old model is confirmed on the successor (C-11)', async () => {
    const providers = new ProviderRegistry()
      .register(new FakeProvider({ models: {} }))
      .register(new FakeProvider({ id: 'openrouter', models: {} }));
    const t = await startTestHub({}, { hub: { providers } });
    const { models } = t.core.hub.squad.draftOf({
      name: 'Bruno',
      role: 'Research',
      mission: 'Find things',
      web: false,
      model: `${OLD.provider}/${OLD.model}`,
    });
    expect(models).toEqual([NEW]);
    await t.core.close();
  });

  it('an archived monster comes back with the successor (C-11)', async () => {
    const t = await startTestHub({});
    await t.json('DELETE', '/api/team/agents/rhea');
    const file = join(t.home, 'archive', 'agents', 'rhea', 'agent.yaml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(/models:[\s\S]*?\n(?=\S|$)/, '') +
        `models:\n  - provider: ${OLD.provider}\n    model: ${OLD.model}\n`,
    );
    await t.json('POST', '/api/team/archived/rhea/restore', {});
    expect(t.core.hub.team.get('rhea')!.config.models).toEqual([NEW]);
    expect(readFileSync(join(t.home, 'agents', 'rhea', 'agent.yaml'), 'utf8')).toContain(NEW.model);
    await t.core.close();
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
