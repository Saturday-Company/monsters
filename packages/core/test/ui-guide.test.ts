import { parseUiBlock, replaceUiBlocks, uiSignatures, UI_LIBRARY } from '@monsters/shared';
import type { ToolContext } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { uiBlocksOf } from '../eval/metrics.ts';
import { monstersCard } from '../src/agents/monsters-card.ts';
import { UI_GUIDE_TOOL, uiGuideHint, uiGuideText, uiGuideTool } from '../src/agents/ui-guide.ts';
import { orchestratorBlueprint, orchestratorTools } from '../src/index.ts';
import { inLang } from './prompt-lang.ts';

/*
 * The manual of the drawn blocks (D-162): what a monster reads to write a ```ui block. It is a
 * text of ours, small, that names every component of the library and whose examples are blocks
 * the library really parses; the card has one short line about it.
 */

/** ~3.6 characters per token: the same upper bound the card's tests use. */
const tokens = (s: string) => Math.ceil(s.length / 3.6);

const COMPONENTS = Object.keys(UI_LIBRARY.toSpec().components);

/** The ```ui blocks written in a text. */
function blocksOf(text: string): string[] {
  const found: string[] = [];
  replaceUiBlocks(text, (source) => {
    found.push(source);
    return '';
  });
  return found;
}

describe('ui_guide: the manual', () => {
  it.each(['en', 'it'] as const)('names every component, in %s', (lang) => {
    inLang(lang);
    const guide = uiGuideText();
    expect(COMPONENTS.length).toBeGreaterThan(10);
    for (const name of COMPONENTS) expect(guide, name).toContain(`${name}(`);
    // The signatures are the library's own, never retyped.
    for (const signature of uiSignatures()) expect(guide).toContain(signature.split(' — ')[0]);
  });

  it.each(['en', 'it'] as const)('stays small (about 700 tokens), in %s', (lang) => {
    inLang(lang);
    const size = tokens(uiGuideText());
    expect(size).toBeGreaterThan(300);
    expect(size).toBeLessThanOrEqual(850);
  });

  it.each(['en', 'it'] as const)('its examples are valid blocks, in %s', (lang) => {
    inLang(lang);
    const examples = blocksOf(uiGuideText());
    expect(examples.length).toBeGreaterThanOrEqual(1);
    for (const source of examples) {
      const parsed = parseUiBlock(source);
      expect(parsed.root, source).toBeTruthy();
      expect(parsed.meta.errors, source).toEqual([]);
      expect(parsed.meta.unresolved, source).toEqual([]);
      expect(parsed.meta.incomplete, source).toBe(false);
    }
  });

  it('says when to draw and when not, and sends choices and long reports elsewhere', () => {
    inLang('en');
    const guide = uiGuideText();
    expect(guide).toContain('data to compare');
    expect(guide).toContain('steps to follow');
    expect(guide).toMatch(/Do not draw: chat, a text to write or send, one fact, an explanation/);
    expect(guide).toContain('`ask_user`');
    expect(guide).toContain('`artifact_create`');
    expect(guide).toContain('root = Block([...])');
    expect(guide).toContain('one per topic');
    // Not the generic prompt of lang-core: the block lives inside a Markdown reply.
    expect(guide).not.toMatch(/ENTIRE response/i);
    inLang('it');
    const it = uiGuideText();
    expect(it).toContain('Non disegnare');
    expect(it).toContain('root = Block([...])');
  });

  it('the attached turn manual is the manual with a one-line header', () => {
    inLang('en');
    const hint = uiGuideHint();
    expect(hint.endsWith(uiGuideText())).toBe(true);
    expect(hint.split('\n')[0]).toContain('reads better drawn');
  });
});

describe('ui_guide: the tool', () => {
  it('has no arguments, only reads, and gives the manual', async () => {
    inLang('en');
    const tool = uiGuideTool();
    expect(tool.name).toBe(UI_GUIDE_TOOL);
    expect(tool.readOnly).toBe(true);
    expect(tool.destructive).toBe(false);
    expect(tool.inputSchema.safeParse({}).success).toBe(true);
    expect(tool.description).toContain('```ui');
    const out = await tool.execute({}, {} as ToolContext);
    expect(out).toBe(uiGuideText());
  });

  it('follows the app’s language when it is made', () => {
    inLang('it');
    expect(uiGuideTool().description).toContain('manuale dei blocchi disegnati');
  });
});

describe('the Monsters card line about drawn blocks', () => {
  const user = { user: 'Giulio' };
  const tools = orchestratorTools(orchestratorBlueprint(user).tools ?? [], true);

  it.each(['en', 'it'] as const)('is one short line that names ui_guide, in %s', (lang) => {
    inLang(lang);
    const without = monstersCard({ toolNames: tools });
    const withLine = monstersCard({ toolNames: [...tools, UI_GUIDE_TOOL] });
    expect(without).not.toContain('ui_guide');
    expect(withLine).toContain('`ui_guide`');
    expect(withLine).toContain('```ui');
    const added = withLine.split('\n').filter((l) => !without.split('\n').includes(l));
    expect(added).toHaveLength(1);
    expect(tokens(added[0]!)).toBeLessThanOrEqual(45);
  });
});

describe('the eval metric of drawn blocks', () => {
  it('counts the blocks of an answer and the ones the library reads whole', () => {
    const good = '```ui\nroot = Block([c])\nc = Callout("ok")\n```';
    const noRoot = '```ui\nc = Callout("ok")\n```';
    const unresolved = '```ui\nroot = Block([c])\n```';
    const cut = '```ui\nroot = Block([c';
    const wrongType = '```ui\nroot = Block([c])\nc = Callout(12)\n```';
    expect(uiBlocksOf('Only prose.')).toEqual({ drawn: 0, valid: 0 });
    expect(uiBlocksOf(`Intro\n${good}\nEnd`)).toEqual({ drawn: 1, valid: 1 });
    expect(uiBlocksOf([good, noRoot, unresolved, wrongType, cut].join('\n'))).toEqual({
      drawn: 5,
      valid: 1,
    });
  });
});
