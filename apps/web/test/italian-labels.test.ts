import { describe, expect, it } from 'vitest';
import { chainModelName } from '../src/store/instinct.ts';
import { modelShort } from '../src/store/derive.ts';
import { modelWords, toName } from '../src/lib/utils.ts';

/*
 * Labels the release tester read wrong (16/10): "Accedi a Anteiku" and the
 * model on the screen as "QWEN 2.5.7B".
 */

describe('the preposition before a name', () => {
  it('takes the euphonic d only before an a', () => {
    expect(toName('Anteiku')).toBe('ad Anteiku');
    expect(toName('Asana')).toBe('ad Asana');
    expect(toName('atlas')).toBe('ad atlas');
    expect(toName('Àlba')).toBe('ad Àlba');
    expect(toName('Notion')).toBe('a Notion');
    expect(toName('Elena')).toBe('a Elena');
    expect(toName('Ofelia')).toBe('a Ofelia');
    expect(toName('WitDesk')).toBe('a WitDesk');
  });
});

describe('model names', () => {
  const cases: [string, string][] = [
    ['qwen/qwen-2.5-7b-instruct', 'qwen 2.5 7b'],
    ['qwen/qwen-2.5-72b-instruct:free', 'qwen 2.5 72b'],
    ['qwen/qwen3.7-flash', 'qwen3.7 flash'],
    ['meta-llama/llama-3.3-70b-instruct:free', 'llama 3.3 70b'],
    ['meta-llama/llama-3-8b-instruct', 'llama 3 8b'],
    ['claude-sonnet-4-5', 'claude sonnet 4.5'],
    ['anthropic/claude-3-5-sonnet', 'claude 3.5 sonnet'],
    ['claude-opus-4-1-20250805', 'claude opus 4.1 20250805'],
    ['google/gemini-2-0-flash', 'gemini 2.0 flash'],
    ['deepseek/deepseek-v3-1', 'deepseek v3.1'],
    ['gpt-4o-mini', 'gpt 4o mini'],
  ];
  it.each(cases)('%s → %s', (id, words) => {
    expect(modelShort(id)).toBe(words);
    expect(chainModelName(`openrouter:${id}`)).toBe(words);
    expect(
      modelWords(
        id
          .split('/')
          .pop()!
          .replace(/:free$/, ''),
      ),
    ).toBe(words);
  });
  it('shows "QWEN 2.5 7B" on the screen, not "QWEN 2.5.7B"', () => {
    expect(modelShort('qwen/qwen-2.5-7b-instruct')!.toUpperCase()).toBe('QWEN 2.5 7B');
  });
});
