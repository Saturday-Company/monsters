import { UI_BLOCK_MAX_CHARS, UI_MAX_ROWS, UI_MAX_SERIES, parseUiBlock } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UiTree } from '../src/components/chat/ui-block/UiBlock.tsx';
import {
  cap,
  donutModel,
  ellipsize,
  niceScale,
  resolveUiBlock,
  seriesModel,
  tableModel,
} from '../src/components/chat/ui-block/model.ts';
import { MarkdownRenderer } from '../src/components/ui/MarkdownRenderer.tsx';

const node = (source: string) => {
  const root = parseUiBlock(source).root;
  if (!root) throw new Error('no root');
  return root;
};
const part = (source: string, i = 0) => {
  const view = resolveUiBlock(source, false);
  if (view.kind !== 'tree') throw new Error(`not a tree: ${view.kind}`);
  return view.parts[i]!;
};

const OK = `root = Block([t])
t = Table(["Name", "Units"], [["a", 1], ["b", 2]], "Sales")`;

describe('resolveUiBlock', () => {
  it('draws a block that parses', () => {
    const view = resolveUiBlock(OK, false);
    expect(view.kind).toBe('tree');
  });

  it('falls back to the text form when nothing can be drawn', () => {
    const view = resolveUiBlock('just some words', false);
    expect(view).toEqual({ kind: 'fallback', text: '```\njust some words\n```' });
    // A root whose parts are all unknown draws nothing either.
    expect(resolveUiBlock('root = Block([Foo("a")])', false).kind).toBe('fallback');
    expect(resolveUiBlock('', false)).toEqual({ kind: 'fallback', text: '' });
  });

  it('shows a block that is too large as text even though it would parse', () => {
    const big = `${OK}\n${'x'.repeat(UI_BLOCK_MAX_CHARS)}`;
    const view = resolveUiBlock(big, false);
    expect(view.kind).toBe('fallback');
  });

  it('streams: the partial tree as soon as a part exists, a skeleton before, never the source', () => {
    expect(resolveUiBlock('roo', true).kind).toBe('skeleton');
    expect(resolveUiBlock('', true).kind).toBe('skeleton');
    const half = resolveUiBlock('root = Block([t])\nt = Table(["Name", "Un', true);
    expect(half.kind === 'tree' || half.kind === 'skeleton').toBe(true);
    const more = resolveUiBlock(OK, true);
    expect(more.kind).toBe('tree');
    // Too large while streaming: wait, do not flash the source.
    expect(resolveUiBlock('x'.repeat(UI_BLOCK_MAX_CHARS + 1), true).kind).toBe('skeleton');
  });
});

describe('the data of the parts', () => {
  it('cuts a table to the row limit and counts the rest', () => {
    const rows = Array.from({ length: UI_MAX_ROWS + 7 }, (_, i) => `["r${i}", ${i}]`).join(', ');
    const m = tableModel(part(`root = Block([t])\nt = Table(["A", "B"], [${rows}])`));
    expect(m.rows).toHaveLength(UI_MAX_ROWS);
    expect(m.hidden).toBe(7);
    expect(m.numeric).toEqual([false, true]);
  });

  it('pads a short row and keeps columns apart from numbers', () => {
    const m = tableModel(
      part('root = Block([t])\nt = Table(["A", "B", "C"], [["x"], ["y", 2, "z"]])'),
    );
    expect(m.rows[0]).toEqual(['x', '', '']);
    expect(m.numeric).toEqual([false, true, false]);
  });

  it('cuts the series of a chart to the limit', () => {
    const series = Array.from(
      { length: UI_MAX_SERIES + 2 },
      (_, i) => `{label: "s${i}", values: [${i + 1}, ${i + 2}]}`,
    ).join(', ');
    const m = seriesModel(part(`root = Block([c])\nc = BarChart(["a", "b"], [${series}])`));
    expect(m.series).toHaveLength(UI_MAX_SERIES);
    expect(m.hiddenSeries).toBe(2);
  });

  it('cuts the points to the row limit and pads the labels', () => {
    const values = Array.from({ length: UI_MAX_ROWS + 3 }, (_, i) => i).join(', ');
    const m = seriesModel(
      part(`root = Block([c])\nc = LineChart(["a"], [{label: "s", values: [${values}]}])`),
    );
    expect(m.labels).toHaveLength(UI_MAX_ROWS);
    expect(m.series[0]!.values).toHaveLength(UI_MAX_ROWS);
    expect(m.hiddenPoints).toBe(3);
  });

  it('keeps only the positive slices of a donut', () => {
    const m = donutModel(
      part(
        'root = Block([d])\nd = Donut([{label: "a", value: 3}, {label: "b", value: 0}, {label: "c", value: 1}])',
      ),
    );
    expect(m.slices.map((s) => s.label)).toEqual(['a', 'c']);
    expect(m.total).toBe(4);
  });

  it('cap and ellipsize', () => {
    expect(cap([1, 2, 3], 2)).toEqual({ shown: [1, 2], hidden: 1 });
    expect(ellipsize('abcdefgh', 5)).toBe('abcd…');
    expect(ellipsize('abc', 5)).toBe('abc');
  });
});

describe('niceScale', () => {
  it('rounds the axis around the data', () => {
    const s = niceScale(0, 27);
    expect(s.lo).toBe(0);
    expect(s.hi).toBeGreaterThanOrEqual(27);
    expect(s.ticks.length).toBeGreaterThanOrEqual(3);
    expect(s.ticks.length).toBeLessThanOrEqual(8);
  });

  it('survives flat and negative data', () => {
    expect(niceScale(5, 5).hi).toBeGreaterThan(niceScale(5, 5).lo);
    const neg = niceScale(-20, 10);
    expect(neg.ticks).toContain(0);
    expect(neg.lo).toBeLessThanOrEqual(-20);
  });
});

describe('rendering', () => {
  it('draws the parts and ignores a node it does not know', () => {
    const root = node(OK);
    const unknown = { type: 'element', typeName: 'Mystery', props: {}, partial: false } as const;
    const html = renderToStaticMarkup(createElement(UiTree, { parts: [unknown, part(OK)] }));
    expect(root.typeName).toBe('Block');
    expect(html).toContain('data-testid="ui-table"');
    expect(html).not.toContain('Mystery');
    expect(html).toContain('<th scope="col" class="ui-num">Units</th>');
    expect(html).toContain('aria-labelledby');
  });

  it('draws a chart as an svg with a name and the values in a table', () => {
    const html = renderToStaticMarkup(
      createElement(UiTree, {
        parts: [
          part(
            'root = Block([c])\nc = BarChart(["Jan", "Feb"], [{label: "2026", values: [3, 5]}], "Sales", "k")',
          ),
        ],
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Bar chart: Sales. 2 categories.');
    expect(html).toContain('<title>Jan · 2026: 3 k</title>');
    expect(html).toContain('class="sr-only"');
  });

  it('says how many rows were left out', () => {
    const rows = Array.from({ length: UI_MAX_ROWS + 2 }, (_, i) => `["r${i}"]`).join(', ');
    const html = renderToStaticMarkup(
      createElement(UiTree, { parts: [part(`root = Block([t])\nt = Table(["A"], [${rows}])`)] }),
    );
    expect(html).toContain('+2 more rows');
  });

  it('never puts raw source in a reply: the Markdown shows a skeleton while the block loads', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownRenderer, { text: `Hi\n\n\`\`\`ui\n${OK}\n\`\`\`\n` }),
    );
    expect(html).toContain('ui-skeleton');
    expect(html).not.toContain('root = Block');
  });

  it('leaves other code blocks as they were', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownRenderer, { text: '```ts\nconst a = 1;\n```' }),
    );
    expect(html).toContain('<pre><code class="language-ts">const a = 1;\n</code></pre>');
    expect(html).not.toContain('ui-skeleton');
  });

  it('shows a fence still being typed as a skeleton while streaming', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownRenderer, { text: 'Hi\n\n```ope', streaming: true }),
    );
    expect(html).toContain('ui-skeleton');
  });
});
