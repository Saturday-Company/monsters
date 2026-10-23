import {
  createLibrary,
  createParser,
  createStreamingParser,
  defineComponent,
} from '@openuidev/lang-core';
import type { ElementNode, ParseResult, StreamParser } from '@openuidev/lang-core';
import { z } from 'zod';
import { isUiFence } from './ui-fence.ts';
import { uiBlockStrings } from './ui-blocks.strings.ts';

/*
 * Drawn blocks in a reply (D-162): a monster writes prose and, where data reads better drawn,
 * a fenced block in OpenUI Lang (openui.com, `@openuidev/lang-core`, MIT). The block lives in
 * the text of the message: saved, reloaded and sent to the model as any reply. The library is
 * ours and read-only: no actions, no queries, no tools from the block (they would skip the
 * brake, the permissions and the log). The web app draws it (`UiBlock`); Telegram and the
 * terminal get it as text (`uiBlocksToText`). The positional order of the props is the order
 * of the zod keys: never reorder them, a block already in the log would read differently.
 */

export { UI_FENCE, UI_FENCE_LANGS, isUiFence } from './ui-fence.ts';

/** Largest block drawn; past it the source is shown as text. */
export const UI_BLOCK_MAX_CHARS = 20_000;
/** Rows of a table, points of a series, items of a list drawn (the rest is counted). */
export const UI_MAX_ROWS = 50;
export const UI_MAX_SERIES = 6;

const c = <T extends z.ZodObject>(name: string, description: string, props: T) =>
  defineComponent({ name, description, props, component: null });

const Trend = z.enum(['up', 'down', 'flat']);
const Tone = z.enum(['info', 'success', 'warning']);
const StepStatus = z.enum(['done', 'doing', 'todo']);
const Cell = z.union([z.string(), z.number()]);
const SeriesSchema = z.object({ label: z.string(), values: z.array(z.number()) });

export const Stat = c(
  'Stat',
  'One key number: label, value as written, change ("+8%"), trend',
  z.object({
    label: z.string(),
    value: z.string(),
    change: z.string().optional(),
    trend: Trend.optional(),
  }),
);
export const Stats = c('Stats', 'A row of 2-4 key numbers', z.object({ items: z.array(Stat.ref) }));
export const Table = c(
  'Table',
  'Rows and columns; numbers as numbers',
  z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(Cell)),
    caption: z.string().optional(),
  }),
);
export const BarChart = c(
  'BarChart',
  'Bars: amounts by category, one series per thing compared',
  z.object({
    labels: z.array(z.string()),
    series: z.array(SeriesSchema),
    title: z.string().optional(),
    unit: z.string().optional(),
  }),
);
export const LineChart = c(
  'LineChart',
  'Lines: how values change over time (labels are the dates or periods)',
  z.object({
    labels: z.array(z.string()),
    series: z.array(SeriesSchema),
    title: z.string().optional(),
    unit: z.string().optional(),
  }),
);
export const Donut = c(
  'Donut',
  'Parts of a whole (2-6 slices)',
  z.object({
    slices: z.array(z.object({ label: z.string(), value: z.number() })),
    title: z.string().optional(),
    unit: z.string().optional(),
  }),
);
export const Option = c(
  'Option',
  'One option of a comparison: its name, points, a short verdict; best marks the recommended one',
  z.object({
    name: z.string(),
    points: z.array(z.string()),
    verdict: z.string().optional(),
    best: z.boolean().optional(),
  }),
);
export const Compare = c(
  'Compare',
  'Two to four options side by side',
  z.object({ options: z.array(Option.ref), title: z.string().optional() }),
);
export const Step = c(
  'Step',
  'One step: title, detail, status',
  z.object({ title: z.string(), detail: z.string().optional(), status: StepStatus.optional() }),
);
export const Steps = c(
  'Steps',
  'Ordered steps or the status of the work',
  z.object({ items: z.array(Step.ref), title: z.string().optional() }),
);
export const Checklist = c(
  'Checklist',
  'Things to do or bring, with the ones done',
  z.object({
    items: z.array(z.object({ text: z.string(), done: z.boolean().optional() })),
    title: z.string().optional(),
  }),
);
export const Timeline = c(
  'Timeline',
  'Dated events in order',
  z.object({
    events: z.array(
      z.object({ date: z.string(), label: z.string(), detail: z.string().optional() }),
    ),
    title: z.string().optional(),
  }),
);
export const Card = c(
  'Card',
  'A titled box of short text, with an optional tag',
  z.object({ title: z.string(), body: z.string(), tag: z.string().optional() }),
);
export const Callout = c(
  'Callout',
  'One sentence to notice',
  z.object({ text: z.string(), tone: Tone.optional() }),
);

const PARTS = [
  Stats,
  Table,
  BarChart,
  LineChart,
  Donut,
  Compare,
  Steps,
  Checklist,
  Timeline,
  Card,
  Callout,
] as const;

export const Block = c(
  'Block',
  'The drawn part of the reply: its parts top to bottom',
  z.object({ children: z.array(z.union(PARTS.map((p) => p.ref))) }),
);

/** The library of the blocks: the same for the prompt, the app and the text fallback. */
export const UI_LIBRARY = createLibrary({
  root: 'Block',
  components: [Block, ...PARTS, Stat, Option, Step],
});

export type UiNode = ElementNode;
export type UiParseResult = ParseResult;

let schema: ReturnType<typeof UI_LIBRARY.toJSONSchema> | undefined;
const librarySchema = () => (schema ??= UI_LIBRARY.toJSONSchema());

/** Parses a whole block. */
export function parseUiBlock(source: string): UiParseResult {
  return createParser(librarySchema(), 'Block').parse(source);
}

/** A parser for a block still streaming: `set(text)` at each chunk. */
export function uiStreamParser(): StreamParser {
  return createStreamingParser(librarySchema(), 'Block');
}

/** The signatures of the components, for the model's guide (`Name(arg, arg?) — what it is`). */
export function uiSignatures(): string[] {
  const spec = UI_LIBRARY.toSpec();
  return Object.values(spec.components).map((s) =>
    s.description ? `${s.signature} — ${s.description}` : s.signature,
  );
}

const OPEN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;

/**
 * Replaces each block of a reply with `draw(source)`, leaving the rest of the Markdown as it is
 * (other fences included). A block still open at the end (a reply cut short) is replaced too.
 */
export function replaceUiBlocks(markdown: string, draw: (source: string) => string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i] ?? '');
    if (!open) {
      out.push(lines[i] ?? '');
      continue;
    }
    const fence = open[1] ?? '```';
    let end = i + 1;
    while (end < lines.length) {
      const close = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[end] ?? '');
      if (close && close[1]?.[0] === fence[0] && (close[1]?.length ?? 0) >= fence.length) break;
      end++;
    }
    const body = lines.slice(i + 1, end);
    if (isUiFence(open[2])) out.push(draw(body.join('\n')));
    else out.push(...lines.slice(i, Math.min(end + 1, lines.length)));
    i = end;
  }
  return out.join('\n');
}

/** Does a reply contain a block? */
export const hasUiBlock = (markdown: string): boolean => {
  let found = false;
  replaceUiBlocks(markdown, () => {
    found = true;
    return '';
  });
  return found;
};

const cellText = (v: unknown): string =>
  typeof v === 'number' ? v.toLocaleString() : typeof v === 'string' ? v : '';

function isNode(v: unknown): v is UiNode {
  return !!v && typeof v === 'object' && (v as UiNode).type === 'element';
}

const nodes = (v: unknown): UiNode[] => (Array.isArray(v) ? v.filter(isNode) : []);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A table as aligned columns of plain text (for a `<pre>` or a terminal). */
export function tableText(columns: string[], rows: unknown[][]): string {
  const all = [columns, ...rows.map((r) => r.map(cellText))];
  const widths = columns.map((_, i) => Math.max(...all.map((r) => [...(r[i] ?? '')].length)));
  const line = (r: string[]) =>
    r
      .map((cell, i) => cell + ' '.repeat(Math.max(0, (widths[i] ?? 0) - [...cell].length)))
      .join('  ')
      .trimEnd();
  return [line(columns), widths.map((w) => '─'.repeat(w)).join('  '), ...all.slice(1).map(line)]
    .join('\n')
    .trimEnd();
}

function seriesText(labels: string[], series: { label: string; values: number[] }[], unit: string) {
  const u = unit ? ` ${unit}` : '';
  if (series.length === 1) {
    return labels.map((l, i) => `- ${l}: ${cellText(series[0]?.values[i])}${u}`).join('\n');
  }
  return labels
    .map(
      (l, i) =>
        `- ${l}: ${series.map((s) => `${s.label} ${cellText(s.values[i])}${u}`).join(', ')}`,
    )
    .join('\n');
}

/**
 * A parsed node as Markdown text, for the surfaces that cannot draw (Telegram, the terminal)
 * and for the fallback of a block that cannot be drawn. Charts become their values, with a
 * line that the chart is in the app.
 */
export function uiNodeToText(node: UiNode): string {
  const t = uiBlockStrings();
  const p = node.props;
  const title = (s: unknown) => (str(s) ? `**${str(s)}**\n` : '');
  switch (node.typeName) {
    case 'Block':
      return nodes(p['children']).map(uiNodeToText).filter(Boolean).join('\n\n');
    case 'Stats':
      return nodes(p['items']).map(uiNodeToText).join('\n');
    case 'Stat': {
      const change = str(p['change']) ? ` (${str(p['change'])})` : '';
      return `- ${str(p['label'])}: **${str(p['value'])}**${change}`;
    }
    case 'Table': {
      const rows = list<unknown[]>(p['rows']).filter(Array.isArray);
      return `${title(p['caption'])}\`\`\`\n${tableText(list<string>(p['columns']), rows)}\n\`\`\``;
    }
    case 'BarChart':
    case 'LineChart':
      return `${title(p['title'])}${seriesText(
        list<string>(p['labels']),
        list<{ label: string; values: number[] }>(p['series']),
        str(p['unit']),
      )}\n_${t.chartInApp}_`;
    case 'Donut': {
      const u = str(p['unit']) ? ` ${str(p['unit'])}` : '';
      const slices = list<{ label: string; value: number }>(p['slices']);
      return `${title(p['title'])}${slices.map((s) => `- ${s.label}: ${cellText(s.value)}${u}`).join('\n')}\n_${t.chartInApp}_`;
    }
    case 'Compare':
      return `${title(p['title'])}${nodes(p['options']).map(uiNodeToText).join('\n\n')}`;
    case 'Option': {
      const best = p['best'] === true ? ` — ${t.best}` : '';
      const points = list<string>(p['points']).map((x) => `  - ${x}`);
      const verdict = str(p['verdict']) ? [`  ${str(p['verdict'])}`] : [];
      return [`- **${str(p['name'])}**${best}`, ...points, ...verdict].join('\n');
    }
    case 'Steps':
      return `${title(p['title'])}${nodes(p['items'])
        .map((s, i) => `${i + 1}. ${uiNodeToText(s)}`)
        .join('\n')}`;
    case 'Step': {
      const mark = p['status'] === 'done' ? '✓ ' : p['status'] === 'doing' ? '▶ ' : '';
      const detail = str(p['detail']) ? ` — ${str(p['detail'])}` : '';
      return `${mark}${str(p['title'])}${detail}`;
    }
    case 'Checklist':
      return `${title(p['title'])}${list<{ text: string; done?: boolean }>(p['items'])
        .map((i) => `- ${i.done ? '☑' : '☐'} ${i.text}`)
        .join('\n')}`;
    case 'Timeline':
      return `${title(p['title'])}${list<{ date: string; label: string; detail?: string }>(
        p['events'],
      )
        .map((e) => `- ${e.date}: ${e.label}${e.detail ? ` — ${e.detail}` : ''}`)
        .join('\n')}`;
    case 'Card':
      return `**${str(p['title'])}**${str(p['tag']) ? ` · ${str(p['tag'])}` : ''}\n${str(p['body'])}`;
    case 'Callout':
      return `> ${str(p['text'])}`;
    default:
      return '';
  }
}

/** A block's source as text: its drawing in words, or the source when it does not parse. */
export function uiBlockToText(source: string): string {
  if (source.length > UI_BLOCK_MAX_CHARS) return `\`\`\`\n${source}\n\`\`\``;
  const r = parseUiBlock(source);
  const text = r.root ? uiNodeToText(r.root).trim() : '';
  return text || `\`\`\`\n${source.trim()}\n\`\`\``;
}

/** A reply with its blocks written as text (Telegram, the terminal). */
export const uiBlocksToText = (markdown: string): string =>
  replaceUiBlocks(markdown, uiBlockToText);
