import {
  formatNumber,
  UI_BLOCK_MAX_CHARS,
  UI_MAX_ROWS,
  UI_MAX_SERIES,
  parseUiBlock,
  uiBlockToText,
  uiStreamParser,
  type UiNode,
} from '@monsters/shared';

/*
 * What a drawn block (D-162) becomes in the web app, decided apart from React: which view to
 * show (the tree, a skeleton, the text), and the data of each part cleaned up and cut to the
 * limits. A streaming parse can hand over half a component: every reader here takes what is
 * valid and ignores the rest, never throws.
 */

export type UiStream = ReturnType<typeof uiStreamParser>;

/** The parts the app draws; any other node is ignored. */
export const DRAWN = new Set([
  'Stats',
  'Table',
  'BarChart',
  'LineChart',
  'Donut',
  'Compare',
  'Steps',
  'Checklist',
  'Timeline',
  'Card',
  'Callout',
]);

export type BlockView =
  | { kind: 'tree'; root: UiNode; parts: UiNode[] }
  | { kind: 'skeleton' }
  | { kind: 'fallback'; text: string };

const isNode = (v: unknown): v is UiNode =>
  !!v && typeof v === 'object' && (v as UiNode).type === 'element';

export const nodesOf = (v: unknown): UiNode[] => (Array.isArray(v) ? v.filter(isNode) : []);
export const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');
export const numOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strings = (v: unknown): string[] =>
  arr(v).map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : ''));

/** The parts of the root that the app can draw. */
export function drawnParts(root: UiNode): UiNode[] {
  return nodesOf(root.props['children']).filter((n) => DRAWN.has(n.typeName));
}

/**
 * The view of a block. While streaming: the partial tree, or a skeleton until a part can be
 * drawn (never the raw source). Final: the tree, or the text form when nothing can be drawn or
 * the block is too large. `stream` is the block's own streaming parser, fed the whole text.
 */
export function resolveUiBlock(source: string, streaming: boolean, stream?: UiStream): BlockView {
  if (source.length > UI_BLOCK_MAX_CHARS) {
    return streaming ? { kind: 'skeleton' } : { kind: 'fallback', text: textForm(source) };
  }
  try {
    const result = streaming ? (stream ?? uiStreamParser()).set(source) : parseUiBlock(source);
    const parts = result.root ? drawnParts(result.root) : [];
    if (result.root && parts.length > 0) return { kind: 'tree', root: result.root, parts };
  } catch {
    // a parser that throws is the same as a block that does not parse
  }
  return streaming ? { kind: 'skeleton' } : { kind: 'fallback', text: textForm(source) };
}

function textForm(source: string): string {
  return source.trim() ? uiBlockToText(source) : '';
}

/** The first `max` of a list and how many were left out. */
export function cap<T>(items: T[], max: number): { shown: T[]; hidden: number } {
  return items.length > max
    ? { shown: items.slice(0, max), hidden: items.length - max }
    : { shown: items, hidden: 0 };
}

export const MAX_STATS = 6;
export const MAX_OPTIONS = 4;
export const MAX_POINTS = 12;

// ------------------------------------------------------------------------------------ table

export interface TableModel {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  hidden: number;
  /** A column of numbers (right-aligned). */
  numeric: boolean[];
}

export function tableModel(node: UiNode): TableModel {
  const columns = strings(node.props['columns']);
  const raw = arr(node.props['rows']).filter(Array.isArray) as unknown[][];
  const { shown, hidden } = cap(raw, UI_MAX_ROWS);
  const width = Math.max(columns.length, ...shown.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => columns[i] ?? '');
  const rows = shown.map((r) =>
    cols.map((_, i): string | number => {
      const cell = r[i];
      return typeof cell === 'number' && Number.isFinite(cell)
        ? cell
        : typeof cell === 'string'
          ? cell
          : '';
    }),
  );
  const numeric = cols.map((_, i) => {
    const cells = rows.map((r) => r[i]).filter((c) => c !== '');
    return cells.length > 0 && cells.every((c) => typeof c === 'number');
  });
  return { caption: strOf(node.props['caption']), columns: cols, rows, hidden, numeric };
}

// ----------------------------------------------------------------------------------- charts

export interface SeriesModel {
  title: string;
  unit: string;
  labels: string[];
  series: { label: string; values: (number | null)[] }[];
  hiddenSeries: number;
  hiddenPoints: number;
}

/** Labels and series of a bar or line chart, cut to the limits and padded to the same length. */
export function seriesModel(node: UiNode): SeriesModel {
  const rawSeries = arr(node.props['series'])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      label: strOf(s['label']),
      values: arr(s['values']).map(numOf),
    }))
    .filter((s) => s.values.some((v) => v !== null));
  const { shown, hidden: hiddenSeries } = cap(rawSeries, UI_MAX_SERIES);
  const rawLabels = strings(node.props['labels']);
  const total = Math.max(rawLabels.length, ...shown.map((s) => s.values.length), 0);
  const n = Math.min(total, UI_MAX_ROWS);
  return {
    title: strOf(node.props['title']),
    unit: strOf(node.props['unit']),
    labels: Array.from({ length: n }, (_, i) => rawLabels[i] ?? ''),
    series: shown.map((s) => ({
      label: s.label,
      values: Array.from({ length: n }, (_, i) => s.values[i] ?? null),
    })),
    hiddenSeries,
    hiddenPoints: total - n,
  };
}

export interface DonutModel {
  title: string;
  unit: string;
  slices: { label: string; value: number }[];
  total: number;
  hidden: number;
}

export function donutModel(node: UiNode): DonutModel {
  const raw = arr(node.props['slices'])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ label: strOf(s['label']), value: numOf(s['value']) }))
    .filter((s): s is { label: string; value: number } => s.value !== null && s.value > 0);
  const { shown, hidden } = cap(raw, UI_MAX_SERIES);
  return {
    title: strOf(node.props['title']),
    unit: strOf(node.props['unit']),
    slices: shown,
    total: shown.reduce((sum, s) => sum + s.value, 0),
    hidden,
  };
}

export interface Scale {
  lo: number;
  hi: number;
  ticks: number[];
}

const niceStep = (range: number, round: boolean): number => {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  const nice = round
    ? f < 1.5
      ? 1
      : f < 3
        ? 2
        : f < 7
          ? 5
          : 10
    : f <= 1
      ? 1
      : f <= 2
        ? 2
        : f <= 5
          ? 5
          : 10;
  return nice * 10 ** exp;
};

/** A readable axis for [min, max]: round ticks around the data, about `target` of them. */
export function niceScale(min: number, max: number, target = 4): Scale {
  let lo = min;
  let hi = max;
  if (!(hi > lo)) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(niceStep(hi - lo, false) / target, true);
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start, i = 0; v <= end + step / 2 && i < 20; v = start + ++i * step) {
    ticks.push(Number(v.toFixed(decimals)));
  }
  return { lo: ticks[0] ?? start, hi: ticks[ticks.length - 1] ?? end, ticks };
}

/** The range of every value of the series (null when there is none). */
export function valueRange(series: SeriesModel['series']): { min: number; max: number } | null {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  return all.length ? { min: Math.min(...all), max: Math.max(...all) } : null;
}

/** A label cut to `max` characters, with an ellipsis. */
export function ellipsize(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= Math.max(1, max) ? s : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

// --------------------------------------------------------------------------------- numbers

/** A number as the reader's language writes it (tooltips, table cells, legends). */
export const fullNumber = (n: number): string => formatNumber(n, { maximumFractionDigits: 2 });
/** The short form for axes and labels on bars: 1.2K. */
export const compactNumber = (n: number): string =>
  formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 });
/** A unit that is itself a share of the whole: a percent next to it would say it twice. */
export const isPercentUnit = (unit: string): boolean => unit.trim() === '%';
export const withUnit = (n: number, unit: string): string =>
  isPercentUnit(unit) ? `${fullNumber(n)}%` : unit ? `${fullNumber(n)} ${unit}` : fullNumber(n);
export const percent = (part: number, whole: number): string =>
  formatNumber(whole > 0 ? part / whole : 0, { style: 'percent', maximumFractionDigits: 1 });
