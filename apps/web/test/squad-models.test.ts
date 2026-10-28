import type { AgentModels, ModelRefView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  sameChain,
  squadModels,
  trimChain,
  withFallback,
  withMain,
} from '../src/components/settings/squad-models.ts';

const link = (provider: string, model: string, tier?: 'light' | 'strong'): ModelRefView => ({
  provider,
  model,
  ...(tier ? { tier } : {}),
});

const agent = (id: string, models: ModelRefView[], auto?: AgentModels['auto']): AgentModels => ({
  id,
  name: id,
  color: '#000000',
  isOrchestrator: false,
  models,
  ...(auto ? { auto } : {}),
});

const free = link('openrouter', 'openrouter/free');
const sonnet = link('claude-agent', 'sonnet');
const opus = link('claude-agent', 'opus');

describe('squadModels: what the simple view may say about the squad', () => {
  it('has nothing to show without monsters', () => {
    expect(squadModels([])).toEqual({ kind: 'none' });
  });

  it('reads main and fallback off the first two links when everybody has the same chain', () => {
    const agents = [agent('a', [sonnet, free]), agent('b', [sonnet, free])];
    expect(squadModels(agents)).toEqual({ kind: 'shared', main: sonnet, fallback: free, more: 0 });
  });

  it('a single link is a main model with no fallback', () => {
    expect(squadModels([agent('a', [free]), agent('b', [free])])).toEqual({
      kind: 'shared',
      main: free,
      fallback: null,
      more: 0,
    });
  });

  it('counts the links after the second instead of hiding them', () => {
    const chain = [sonnet, free, opus, link('openrouter', 'x/y:free')];
    expect(squadModels([agent('a', chain)])).toMatchObject({ kind: 'shared', more: 2 });
  });

  it('a monster with another chain makes the squad "different", never one of the chains', () => {
    const agents = [agent('a', [sonnet]), agent('b', [free])];
    expect(squadModels(agents)).toEqual({ kind: 'different' });
  });

  it('the same models in another order are different chains', () => {
    const agents = [agent('a', [sonnet, free]), agent('b', [free, sonnet])];
    expect(squadModels(agents)).toEqual({ kind: 'different' });
  });

  it('a tier is part of a link: the same model with another tier is a different chain', () => {
    const agents = [
      agent('a', [link('claude-agent', 'haiku', 'light')]),
      agent('b', [link('claude-agent', 'haiku')]),
    ];
    expect(squadModels(agents)).toEqual({ kind: 'different' });
  });

  it('everybody on Automatic is one choice, whatever the base of each', () => {
    const agents = [
      agent('a', [sonnet, opus], { base: 'medium' }),
      agent('b', [opus, sonnet], { base: 'strong' }),
    ];
    expect(squadModels(agents)).toEqual({ kind: 'automatic' });
  });

  it('Automatic for some and a chain of their own for others is different', () => {
    const agents = [agent('a', [sonnet, opus], { base: 'medium' }), agent('b', [sonnet, opus])];
    expect(squadModels(agents)).toEqual({ kind: 'different' });
  });
});

describe('withMain and withFallback: the first two links, the rest untouched', () => {
  const chain = [
    link('claude-agent', 'haiku', 'light'),
    link('claude-agent', 'opus', 'strong'),
    free,
  ];

  it('a new main model replaces the first link and drops its tier, keeping the others', () => {
    expect(withMain(chain, sonnet)).toEqual([sonnet, link('claude-agent', 'opus', 'strong'), free]);
  });

  it('a main model on an empty chain is the chain', () => {
    expect(withMain([], free)).toEqual([free]);
  });

  it('a fallback is the second link; it appends when there was none', () => {
    expect(withFallback([sonnet], free)).toEqual([sonnet, free]);
    expect(withFallback([sonnet, opus, free], free)).toEqual([sonnet, free, free]);
  });

  it('taking the fallback away moves the links after it up', () => {
    expect(withFallback([sonnet, free, opus], null)).toEqual([sonnet, opus]);
    expect(withFallback([sonnet, free], null)).toEqual([sonnet]);
    expect(withFallback([sonnet], null)).toEqual([sonnet]);
  });

  it('without a main model there is no fallback to set', () => {
    expect(withFallback([], free)).toEqual([]);
  });

  it('does not change the chain it is given', () => {
    const before = JSON.stringify(chain);
    withMain(chain, sonnet);
    withFallback(chain, null);
    expect(JSON.stringify(chain)).toBe(before);
  });

  it('sameChain compares links in order, tiers included', () => {
    expect(sameChain([sonnet, free], [sonnet, free])).toBe(true);
    expect(sameChain([sonnet], [sonnet, free])).toBe(false);
    expect(sameChain([sonnet, free], [free, sonnet])).toBe(false);
  });
});

describe('a pasted space never reaches the chain (review of 28/10)', () => {
  it('trims the model id of the links a choice builds, tiers kept by trimChain', () => {
    expect(withMain([sonnet, free], link('openrouter', ' x/y:free '))).toEqual([
      link('openrouter', 'x/y:free'),
      free,
    ]);
    expect(withFallback([sonnet], link('openrouter', '\topenrouter/free '))).toEqual([
      sonnet,
      free,
    ]);
    expect(trimChain([link('claude-agent', ' opus', 'strong')])).toEqual([
      link('claude-agent', 'opus', 'strong'),
    ]);
  });
});
