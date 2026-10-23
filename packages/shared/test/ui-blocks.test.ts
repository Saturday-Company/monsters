import { afterEach, describe, expect, it } from 'vitest';
import { setAppLang } from '../src/i18n.ts';
import {
  hasUiBlock,
  isUiFence,
  parseUiBlock,
  replaceUiBlocks,
  tableText,
  uiBlockButtons,
  uiBlocksToText,
  uiBlockToText,
  uiButtonLabel,
  uiButtons,
  uiSignatures,
  UI_BLOCK_MAX_CHARS,
  UI_BUTTON_MAX_CHARS,
  UI_LIBRARY,
  UI_MAX_BUTTONS,
} from '../src/ui-blocks.ts';

/*
 * The drawn blocks (D-162): the library shared by the prompt, the app and the text fallback.
 * What is checked here is what the surfaces that cannot draw (Telegram, the terminal) rely on.
 */

afterEach(() => setAppLang('en'));

const fence = (source: string, lang = 'ui') => `\`\`\`${lang}\n${source}\n\`\`\``;
const code = (text: string) => `\`\`\`\n${text}\n\`\`\``;

describe('the library', () => {
  it('has a signature for every component, in the order of the props', () => {
    const signatures = uiSignatures();
    expect(signatures).toHaveLength(Object.keys(UI_LIBRARY.toSpec().components).length);
    expect(signatures.some((s) => s.startsWith('Table(columns: string[], rows:'))).toBe(true);
    expect(signatures.some((s) => s.startsWith('Stat(label: string, value: string, change?'))).toBe(
      true,
    );
  });

  it('parses a block: root present, no errors, every name defined', () => {
    const parsed = parseUiBlock(
      'root = Block([k, t])\nk = Stats([Stat("Open rate", "42%", "+3%", "up")])\nt = Table(["A"], [[1]])',
    );
    expect(parsed.root?.typeName).toBe('Block');
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
  });
});

describe('replaceUiBlocks', () => {
  const draw = (s: string) => `<${s.trim().split('\n').length} lines>`;

  it('replaces blocks and leaves other fences and prose as they are', () => {
    const md = [
      'Intro',
      fence('root = Block([])'),
      '```ts',
      'const a = 1;',
      '```',
      'Middle',
      fence('root = Block([])\nx = 1', 'openui'),
      'End',
    ].join('\n');
    expect(replaceUiBlocks(md, draw)).toBe(
      ['Intro', '<1 lines>', '```ts', 'const a = 1;', '```', 'Middle', '<2 lines>', 'End'].join(
        '\n',
      ),
    );
  });

  it('knows the names a model may write for the fence', () => {
    for (const lang of ['ui', 'openui', 'openui-lang', 'UI']) expect(isUiFence(lang)).toBe(true);
    for (const lang of ['', 'ts', 'uix', undefined, null]) expect(isUiFence(lang)).toBe(false);
  });

  it('a ui fence inside another fence is code, not a block', () => {
    const md = '````md\n```ui\nroot = Block([])\n```\n````';
    expect(replaceUiBlocks(md, () => 'X')).toBe(md);
    expect(hasUiBlock(md)).toBe(false);
  });

  it('a block left open at the end of the reply (cut short) is replaced too', () => {
    expect(replaceUiBlocks('Text\n```ui\nroot = Block([a', draw)).toBe('Text\n<1 lines>');
  });

  it('tilde fences and a longer closing fence work; the text around stays', () => {
    expect(replaceUiBlocks('a\n~~~ui\nroot = Block([])\n~~~\nb', () => 'X')).toBe('a\nX\nb');
    expect(replaceUiBlocks('a\n````ui\nroot = Block([])\n`````\nb', () => 'X')).toBe('a\nX\nb');
  });

  it('hasUiBlock', () => {
    expect(hasUiBlock(`Hello\n${fence('root = Block([])')}`)).toBe(true);
    expect(hasUiBlock('```ts\nconst a = 1;\n```')).toBe(false);
    expect(hasUiBlock('no code at all')).toBe(false);
  });
});

describe('uiBlockToText: each component as text', () => {
  const text = (source: string) => uiBlockToText(`root = Block([x])\n${source}`);

  it('Stat and Stats: a list of key numbers with the change', () => {
    expect(text('x = Stats([Stat("Open rate", "42%", "+3%", "up"), Stat("Clicks", "1.2k")])')).toBe(
      '- Open rate: **42%** (+3%)\n- Clicks: **1.2k**',
    );
  });

  it('Table: aligned columns in a code block, numbers as numbers, with its caption', () => {
    expect(text('x = Table(["Plan", "Price"], [["Free", 0], ["Pro", 12.5]], "Plans")')).toBe(
      '**Plans**\n```\nPlan  Price\n────  ─────\nFree  0\nPro   12.5\n```',
    );
    expect(tableText(['A'], [['x']])).toBe('A\n─\nx');
  });

  it('BarChart and LineChart: the values, one line per label, and that the chart is in the app', () => {
    expect(
      text('x = BarChart(["Jan", "Feb"], [{label: "Sales", values: [3, 5]}], "Sales", "€")'),
    ).toBe('**Sales**\n- Jan: 3 €\n- Feb: 5 €\n_The chart is in the app._');
    expect(
      text(
        'x = LineChart(["Q1", "Q2"], [{label: "A", values: [1, 2]}, {label: "B", values: [3, 4]}])',
      ),
    ).toBe('- Q1: A 1, B 3\n- Q2: A 2, B 4\n_The chart is in the app._');
  });

  it('Donut', () => {
    expect(
      text('x = Donut([{label: "Rent", value: 60}, {label: "Food", value: 40}], "Budget", "%")'),
    ).toBe('**Budget**\n- Rent: 60 %\n- Food: 40 %\n_The chart is in the app._');
  });

  it('Compare and Option: points, verdict, and the recommended one', () => {
    expect(
      text(
        'x = Compare([Option("A", ["cheap", "slow"], "ok"), Option("B", ["fast"], "best value", true)], "Plans")',
      ),
    ).toBe(
      '**Plans**\n- **A**\n  - cheap\n  - slow\n  ok\n\n- **B** — recommended\n  - fast\n  best value',
    );
  });

  it('Steps and Step: numbered, with the status marks', () => {
    expect(
      text(
        'x = Steps([Step("Open", "online", "done"), Step("Fill", null, "doing"), Step("Send")], "VAT")',
      ),
    ).toBe('**VAT**\n1. ✓ Open — online\n2. ▶ Fill\n3. Send');
  });

  it('Checklist', () => {
    expect(
      text('x = Checklist([{text: "Passport", done: true}, {text: "Tickets"}], "Bring")'),
    ).toBe('**Bring**\n- ☑ Passport\n- ☐ Tickets');
  });

  it('Timeline', () => {
    expect(
      text(
        'x = Timeline([{date: "1 Nov", label: "Launch", detail: "web"}, {date: "8 Nov", label: "Review"}], "Plan")',
      ),
    ).toBe('**Plan**\n- 1 Nov: Launch — web\n- 8 Nov: Review');
  });

  it('Card and Callout', () => {
    expect(text('x = Card("Tip", "Save early", "new")')).toBe('**Tip** · new\nSave early');
    expect(text('x = Callout("Mind the deadline", "warning")')).toBe('> Mind the deadline');
  });

  it('Buttons: one line, "You can reply", each label in guillemets', () => {
    expect(
      text('x = Buttons([Button("Go deeper on Metricool", true), Button("Draft the note")])'),
    ).toBe('You can reply: «Go deeper on Metricool» · «Draft the note»');
    setAppLang('it');
    expect(text('x = Buttons([Button("Approfondisci Metricool")])')).toBe(
      'Puoi rispondere: «Approfondisci Metricool»',
    );
  });

  it('Buttons: at most four, no empty label, no repeat, labels as the user would send them', () => {
    const six = ['A', 'B', ' ', 'A', 'C', 'D', 'E'].map((l) => `Button("${l}")`).join(', ');
    expect(text(`x = Buttons([${six}])`)).toBe('You can reply: «A» · «B» · «C» · «D»');
    // Nothing to say: the block is shown as its source, never as nothing.
    expect(text('x = Buttons([Button("  ")])')).toBe(
      code('root = Block([x])\nx = Buttons([Button("  ")])'),
    );
  });

  it('Buttons shown apart (Telegram’s keyboard): the line is left out, the rest stays', () => {
    const block = 'root = Block([c, b])\nc = Callout("Note")\nb = Buttons([Button("Go")])';
    expect(uiBlockToText(block, { omitButtons: true })).toBe('> Note');
    expect(uiBlockToText(block)).toBe('> Note\n\nYou can reply: «Go»');
    // A block of buttons only is not a failed block: nothing to say, nothing shown as source.
    const only = 'root = Block([b])\nb = Buttons([Button("Go")])';
    expect(uiBlockToText(only, { omitButtons: true })).toBe('');
    expect(uiBlocksToText(`Pick one.\n\n${fence(only)}`, { omitButtons: true }).trim()).toBe(
      'Pick one.',
    );
    // Buttons with no label have nothing to show apart: the source is shown, as always.
    const empty = 'root = Block([b])\nb = Buttons([Button("")])';
    expect(uiBlockToText(empty, { omitButtons: true })).toBe(code(empty));
  });

  it('a block with several parts: one after the other, a blank line between', () => {
    const out = uiBlockToText(
      'root = Block([k, c])\nk = Stats([Stat("A", "1")])\nc = Callout("Note")',
    );
    expect(out).toBe('- A: **1**\n\n> Note');
  });

  it('follows the language: the Italian words of the chart line and of the best option', () => {
    setAppLang('it');
    expect(text('x = Donut([{label: "A", value: 1}])')).toContain('Il grafico è nell’app.');
    expect(text('x = Compare([Option("A", ["x"], null, true)])')).toContain('consigliata');
  });
});

describe('a block that cannot be drawn shows its source in a code fence', () => {
  it('broken source (a statement cut short)', () => {
    expect(uiBlockToText('root = Block([c')).toBe(code('root = Block([c'));
  });

  it('no root, nothing but prose, or an empty block', () => {
    expect(uiBlockToText('x = Callout("a")')).toBe(code('x = Callout("a")'));
    expect(uiBlockToText('just words')).toBe(code('just words'));
    expect(uiBlockToText('   ')).toBe(code(''));
  });

  it('too large a block is not parsed at all', () => {
    const big = `root = Block([c])\nc = Callout("${'x'.repeat(UI_BLOCK_MAX_CHARS)}")`;
    expect(uiBlockToText(big)).toBe(code(big));
  });
});

describe('uiBlocksToText: a whole reply', () => {
  it('draws the blocks as text, keeps the prose, the other fences and the model history untouched', () => {
    const reply = [
      'Here is the comparison:',
      fence('root = Block([t])\nt = Table(["A", "B"], [["x", 1]])'),
      'Then the code:',
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');
    expect(uiBlocksToText(reply)).toBe(
      [
        'Here is the comparison:',
        '```\nA  B\n─  ─\nx  1\n```',
        'Then the code:',
        '```ts',
        'const a = 1;',
        '```',
      ].join('\n'),
    );
    // Pure: the reply itself is not changed (the model keeps reading the block).
    expect(reply).toContain('```ui');
    // A reply without a block is the same text.
    expect(uiBlocksToText('Only prose, `code` and **bold**.')).toBe(
      'Only prose, `code` and **bold**.',
    );
  });

  it('a mix of a good block, a broken one and an open one', () => {
    const reply = [
      fence('root = Block([c])\nc = Callout("ok")'),
      fence('root = Block([c'),
      '```ui\nroot = Block([d])\nd = Callout("cut")',
    ].join('\n');
    expect(uiBlocksToText(reply)).toBe(['> ok', '```\nroot = Block([c\n```', '> cut'].join('\n'));
  });
});

describe('buttons: what a tap sends is the label the user sees', () => {
  const buttons = (source: string) => {
    const root = parseUiBlock(source).root!;
    const part = (root.props['children'] as { typeName: string }[]).find(
      (n) => n.typeName === 'Buttons',
    );
    return uiButtons(part as never);
  };

  it('uiButtonLabel: one line, trimmed, whitespace folded, nothing for a non-string', () => {
    expect(uiButtonLabel('  Go   deeper\n on\tMetricool  ')).toBe('Go deeper on Metricool');
    expect(uiButtonLabel('')).toBe('');
    expect(uiButtonLabel('   ')).toBe('');
    expect(uiButtonLabel(12)).toBe('');
    expect(uiButtonLabel(null)).toBe('');
    expect(uiButtonLabel(undefined)).toBe('');
  });

  it('uiButtonLabel: cut at the limit, by characters (an emoji is one)', () => {
    const long = 'a'.repeat(UI_BUTTON_MAX_CHARS + 30);
    expect(uiButtonLabel(long)).toBe('a'.repeat(UI_BUTTON_MAX_CHARS));
    expect([...uiButtonLabel('😀'.repeat(UI_BUTTON_MAX_CHARS + 5))]).toHaveLength(
      UI_BUTTON_MAX_CHARS,
    );
    // Cut, then trimmed? No: the label shown and the message sent are the same string.
    expect(uiButtonLabel(`${'a'.repeat(UI_BUTTON_MAX_CHARS - 1)} b`)).toBe(
      `${'a'.repeat(UI_BUTTON_MAX_CHARS - 1)} `,
    );
  });

  it('uiButtons: the labels drawn, the suggested one marked, the limits applied', () => {
    expect(
      buttons('root = Block([b])\nb = Buttons([Button("A", true), Button("B"), Button("B")])'),
    ).toEqual([
      { label: 'A', primary: true },
      { label: 'B', primary: false },
    ]);
    const many = Array.from({ length: 9 }, (_, i) => `Button("L${i}")`).join(', ');
    expect(buttons(`root = Block([b])\nb = Buttons([${many}])`)).toHaveLength(UI_MAX_BUTTONS);
  });

  it('uiBlockButtons: the labels of the last block that has buttons, none without', () => {
    const one = fence('root = Block([b])\nb = Buttons([Button("First"), Button("Second")])');
    const two = fence('root = Block([b])\nb = Buttons([Button("Third")])');
    const none = fence('root = Block([c])\nc = Callout("x")');
    expect(uiBlockButtons('Text')).toEqual([]);
    expect(uiBlockButtons(none)).toEqual([]);
    expect(uiBlockButtons(`${one}\n\nand\n\n${two}`)).toEqual(['Third']);
    expect(uiBlockButtons(`${one}\n\n${none}`)).toEqual(['First', 'Second']);
    // Not in a block, not buttons: a fence of another language is code.
    expect(uiBlockButtons(fence('Button("x")', 'js'))).toEqual([]);
    expect(uiBlockButtons('```ui\nroot = Block([b')).toEqual([]);
  });
});
