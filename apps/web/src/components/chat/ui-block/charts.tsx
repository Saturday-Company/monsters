import { formatList, type UiNode } from '@monsters/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { seriesColor, useUiDrawing } from './context.ts';
import {
  compactNumber,
  donutModel,
  ellipsize,
  niceScale,
  percent,
  seriesModel,
  valueRange,
  withUnit,
  type SeriesModel,
} from './model.ts';
import { uiBlockViewStrings } from './ui-block.strings.ts';

/*
 * The charts of a block, drawn here as plain SVG (no chart library): the svg is as wide as its
 * box (measured, so the 11 px labels stay 11 px on a phone) and still scales through its
 * viewBox. Colours come from the vault palette (context.ts), text and rules from the bubble's
 * own colour, so a chart is right in both themes and on the terminal's black screen. Values are
 * in the `<title>` of every mark and, for screen readers, in a table beside the picture.
 */

const DEFAULT_WIDTH = 560;
const MONO_CHAR = 7; // width of one 11 px Martian Mono character, a little generous

/**
 * The width of an element, kept up to date while the window or the bubble resizes. Returns the
 * callback ref to put on it (a state, so the box may appear after the first render).
 */
function useBoxWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    if (!el) return;
    const read = () => setWidth(Math.max(200, Math.round(el.clientWidth)) || DEFAULT_WIDTH);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}

type Shape = 'square' | 'circle' | 'diamond' | 'triangle';
const SHAPES: Shape[] = ['circle', 'square', 'diamond', 'triangle'];

/** A mark centred on (x, y): the series of a line differ by shape as well as by colour. */
function Marker({
  shape,
  x,
  y,
  r,
  color,
}: {
  shape: Shape;
  x: number;
  y: number;
  r: number;
  color: string;
}) {
  switch (shape) {
    case 'square':
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} />;
    case 'diamond':
      return (
        <polygon
          points={`${x},${y - r * 1.3} ${x + r * 1.3},${y} ${x},${y + r * 1.3} ${x - r * 1.3},${y}`}
          fill={color}
        />
      );
    case 'triangle':
      return (
        <polygon
          points={`${x},${y - r * 1.25} ${x + r * 1.2},${y + r * 0.9} ${x - r * 1.2},${y + r * 0.9}`}
          fill={color}
        />
      );
    default:
      return <circle cx={x} cy={y} r={r} fill={color} />;
  }
}

function Swatch({ shape, color }: { shape: Shape; color: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden className="ui-swatch">
      <Marker shape={shape} x={6} y={6} r={4.5} color={color} />
    </svg>
  );
}

function Frame({
  testId,
  title,
  unit,
  children,
  legend,
  more,
  data,
}: {
  testId: string;
  title: string;
  unit: string;
  children: ReactNode;
  legend?: ReactNode;
  more: string[];
  data: { head: string[]; rows: string[][] };
}) {
  const s = uiBlockViewStrings();
  return (
    <figure className="ui-part ui-chart" data-testid={testId}>
      {(title || unit) && (
        <figcaption className="ui-title">
          <span>{title}</span>
          {unit && <span className="ui-unit">{unit}</span>}
        </figcaption>
      )}
      {children}
      {legend}
      {more.map((line) => (
        <p key={line} className="ui-more">
          {line}
        </p>
      ))}
      <table className="sr-only">
        <caption>{title || s.chartData}</caption>
        <thead>
          <tr>
            {data.head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Legend({ series }: { series: SeriesModel['series'] }) {
  const drawing = useUiDrawing();
  if (series.length < 2) return null;
  return (
    <ul className="ui-legend" data-testid="ui-legend">
      {series.map((s, i) => (
        <li key={i}>
          <Swatch shape={SHAPES[i % SHAPES.length]!} color={seriesColor(i, drawing)} />
          <span>{s.label || `#${i + 1}`}</span>
        </li>
      ))}
    </ul>
  );
}

interface Layout {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  pw: number;
  ph: number;
  y: (v: number) => number;
}

function layoutFor(width: number, scale: { lo: number; hi: number; ticks: number[] }): Layout {
  const labelChars = Math.max(...scale.ticks.map((t) => compactNumber(t).length), 1);
  const left = labelChars * MONO_CHAR + 12;
  const right = 8;
  const top = 16;
  const bottom = 26;
  const w = width;
  const h = Math.max(190, Math.min(260, Math.round(width * 0.5)));
  const pw = Math.max(40, w - left - right);
  const ph = h - top - bottom;
  const span = scale.hi - scale.lo || 1;
  return {
    w,
    h,
    left,
    right,
    top,
    bottom,
    pw,
    ph,
    y: (v) => top + ph * (1 - (v - scale.lo) / span),
  };
}

function Grid({ l, ticks, zero }: { l: Layout; ticks: number[]; zero: number }) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={l.left}
            x2={l.w - l.right}
            y1={l.y(t)}
            y2={l.y(t)}
            className={t === zero ? 'ui-baseline' : 'ui-grid'}
          />
          <text x={l.left - 6} y={l.y(t)} dy="0.32em" textAnchor="end" className="ui-axis">
            {compactNumber(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Every `stride`-th label under the plot, cut to the room it has. */
function XLabels({
  labels,
  xs,
  l,
  step,
}: {
  labels: string[];
  xs: number[];
  l: Layout;
  step: number;
}) {
  const longest = Math.min(14, Math.max(1, ...labels.map((x) => [...x].length)));
  const fit = Math.max(1, Math.floor(l.pw / (longest * MONO_CHAR + 10)));
  const stride = Math.ceil(labels.length / fit);
  const chars = Math.min(14, Math.max(3, Math.floor((step * stride) / MONO_CHAR) - 1));
  return (
    <g aria-hidden>
      {labels.map((label, i) =>
        i % stride === 0 && label ? (
          <text key={i} x={xs[i]} y={l.h - l.bottom + 16} textAnchor="middle" className="ui-axis">
            {ellipsize(label, chars)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function chartData(m: SeriesModel): { head: string[]; rows: string[][] } {
  const s = uiBlockViewStrings();
  return {
    head: [s.category, ...m.series.map((x, i) => x.label || `#${i + 1}`)],
    rows: m.labels.map((label, i) => [
      label,
      ...m.series.map((x) => {
        const v = x.values[i];
        return v === null || v === undefined ? '' : withUnit(v, m.unit);
      }),
    ]),
  };
}

function moreLines(m: SeriesModel): string[] {
  const s = uiBlockViewStrings();
  return [
    ...(m.hiddenSeries ? [s.moreSeries(m.hiddenSeries)] : []),
    ...(m.hiddenPoints ? [s.moreRows(m.hiddenPoints)] : []),
  ];
}

function summary(kind: 'barChart' | 'lineChart', m: SeriesModel): string {
  const s = uiBlockViewStrings();
  const range = valueRange(m.series);
  const names = formatList(m.series.map((x) => x.label).filter(Boolean));
  const detail = range
    ? s.seriesRange(names, compactNumber(range.min), compactNumber(range.max))
    : names;
  return s[kind](m.title, m.labels.length, detail);
}

const tip = (m: SeriesModel, label: string, name: string, v: number): string =>
  `${label ? `${label} · ` : ''}${name ? `${name}: ` : ''}${withUnit(v, m.unit)}`;

export function BarChart({ node }: { node: UiNode }) {
  const m = useMemo(() => seriesModel(node), [node]);
  const drawing = useUiDrawing();
  const [boxRef, width] = useBoxWidth();
  const range = valueRange(m.series);
  if (!range || m.labels.length === 0) return null;

  const scale = niceScale(Math.min(0, range.min), Math.max(0, range.max));
  const l = layoutFor(width, scale);
  const n = m.labels.length;
  const count = m.series.length;
  const band = l.pw / n;
  const barW = Math.max(2, Math.min(44, (band * 0.78 - (count - 1) * 2) / count));
  const groupW = barW * count + (count - 1) * 2;
  const base = l.y(Math.max(scale.lo, Math.min(0, scale.hi)));
  const xs = m.labels.map((_, i) => l.left + band * i + band / 2);
  const showValues = n * count <= 10 && barW >= 22;

  return (
    <Frame
      testId="ui-bar-chart"
      title={m.title}
      unit={m.unit}
      legend={<Legend series={m.series} />}
      more={moreLines(m)}
      data={chartData(m)}
    >
      <div ref={boxRef} className="ui-chart-box">
        <svg
          role="img"
          aria-label={summary('barChart', m)}
          viewBox={`0 0 ${l.w} ${l.h}`}
          width={l.w}
          height={l.h}
          className="ui-svg"
        >
          <Grid l={l} ticks={scale.ticks} zero={0} />
          {m.labels.map((label, i) =>
            m.series.map((s, k) => {
              const v = s.values[i];
              if (v === null || v === undefined) return null;
              const x = l.left + band * i + (band - groupW) / 2 + k * (barW + 2);
              const yv = l.y(v);
              const top = Math.min(yv, base);
              const height = Math.max(1.5, Math.abs(base - yv));
              return (
                <g key={`${i}-${k}`} className="ui-bar" data-testid="ui-bar">
                  <rect
                    x={x}
                    y={top}
                    width={barW}
                    height={height}
                    rx={Math.min(3, barW / 2)}
                    fill={seriesColor(k, drawing)}
                  >
                    <title>{tip(m, label, s.label, v)}</title>
                  </rect>
                  {showValues && (
                    <text
                      x={x + barW / 2}
                      y={v < 0 ? top + height + 12 : top - 4}
                      textAnchor="middle"
                      className="ui-value"
                      aria-hidden
                    >
                      {compactNumber(v)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          <XLabels labels={m.labels} xs={xs} l={l} step={band} />
        </svg>
      </div>
    </Frame>
  );
}

export function LineChart({ node }: { node: UiNode }) {
  const m = useMemo(() => seriesModel(node), [node]);
  const drawing = useUiDrawing();
  const [boxRef, width] = useBoxWidth();
  const range = valueRange(m.series);
  if (!range || m.labels.length === 0) return null;

  // Counts start at zero when the data is near it; otherwise the axis hugs the data.
  const zeroBased = range.min >= 0 && range.min <= range.max * 0.5;
  const scale = niceScale(zeroBased ? 0 : range.min, range.max);
  const l = layoutFor(width, scale);
  const n = m.labels.length;
  const pad = 10;
  const step = n > 1 ? (l.pw - 2 * pad) / (n - 1) : l.pw;
  const xs = m.labels.map((_, i) => (n > 1 ? l.left + pad + i * step : l.left + l.pw / 2));
  const markers = n <= 30;

  return (
    <Frame
      testId="ui-line-chart"
      title={m.title}
      unit={m.unit}
      legend={<Legend series={m.series} />}
      more={moreLines(m)}
      data={chartData(m)}
    >
      <div ref={boxRef} className="ui-chart-box">
        <svg
          role="img"
          aria-label={summary('lineChart', m)}
          viewBox={`0 0 ${l.w} ${l.h}`}
          width={l.w}
          height={l.h}
          className="ui-svg"
        >
          <Grid l={l} ticks={scale.ticks} zero={0} />
          {m.series.map((s, k) => {
            const color = seriesColor(k, drawing);
            // A missing value breaks the line instead of drawing a false one.
            let path = '';
            let pen = false;
            s.values.forEach((v, i) => {
              if (v === null) {
                pen = false;
                return;
              }
              path += `${pen ? 'L' : 'M'}${xs[i]!.toFixed(1)} ${l.y(v).toFixed(1)} `;
              pen = true;
            });
            return (
              <g key={k} data-testid="ui-line">
                <path d={path} className="ui-line" stroke={color} />
                {markers &&
                  s.values.map((v, i) =>
                    v === null ? null : (
                      <g key={i} className="ui-point">
                        <Marker
                          shape={SHAPES[k % SHAPES.length]!}
                          x={xs[i]!}
                          y={l.y(v)}
                          r={3.5}
                          color={color}
                        />
                        <title>{tip(m, m.labels[i] ?? '', s.label, v)}</title>
                      </g>
                    ),
                  )}
              </g>
            );
          })}
          {!markers &&
            m.labels.map((label, i) => (
              <rect
                key={i}
                x={xs[i]! - l.pw / n / 2}
                y={l.top}
                width={l.pw / n}
                height={l.ph}
                className="ui-hit"
              >
                <title>
                  {[
                    label,
                    ...m.series.flatMap((s) => {
                      const v = s.values[i];
                      return v === null || v === undefined
                        ? []
                        : [`${s.label ? `${s.label}: ` : ''}${withUnit(v, m.unit)}`];
                    }),
                  ].join(' · ')}
                </title>
              </rect>
            ))}
          <XLabels labels={m.labels} xs={xs} l={l} step={n > 1 ? step : l.pw} />
        </svg>
      </div>
    </Frame>
  );
}

const RADIUS = 54;
const STROKE = 24;
const SIZE = 2 * (RADIUS + STROKE / 2) + 4;

export function Donut({ node }: { node: UiNode }) {
  const m = useMemo(() => donutModel(node), [node]);
  const drawing = useUiDrawing();
  const s = uiBlockViewStrings();
  if (m.slices.length === 0) return null;

  const circumference = 2 * Math.PI * RADIUS;
  const gap = m.slices.length > 1 ? 2 : 0;
  const arcs = m.slices.map((slice, i) => ({
    slice,
    i,
    start: (m.slices.slice(0, i).reduce((sum, x) => sum + x.value, 0) / m.total) * circumference,
    length: (slice.value / m.total) * circumference,
  }));
  const detail = m.slices
    .map((x) => `${x.label} ${withUnit(x.value, m.unit)} (${percent(x.value, m.total)})`)
    .join('; ');

  return (
    <Frame
      testId="ui-donut"
      title={m.title}
      unit=""
      more={m.hidden ? [s.moreSlices(m.hidden)] : []}
      data={{
        head: [s.category, s.total],
        rows: m.slices.map((x) => [x.label, withUnit(x.value, m.unit)]),
      }}
    >
      <div className="ui-donut">
        <svg
          role="img"
          aria-label={s.donut(m.title, m.slices.length, detail)}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          className="ui-donut-svg"
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map(({ slice, i, start: from, length }) => (
              <circle
                key={i}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={seriesColor(i, drawing)}
                strokeWidth={STROKE}
                strokeDasharray={`${Math.max(0.5, length - gap)} ${circumference}`}
                strokeDashoffset={-from}
                className="ui-slice"
                data-testid="ui-slice"
              >
                <title>{`${slice.label}: ${withUnit(slice.value, m.unit)} (${percent(slice.value, m.total)})`}</title>
              </circle>
            ))}
          </g>
          <text
            x={SIZE / 2}
            y={SIZE / 2}
            dy="-0.1em"
            textAnchor="middle"
            className="ui-donut-total"
            aria-hidden
          >
            {compactNumber(m.total)}
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2}
            dy="1.6em"
            textAnchor="middle"
            className="ui-axis"
            aria-hidden
          >
            {s.total}
          </text>
        </svg>
        <ul className="ui-legend ui-legend-values" data-testid="ui-legend">
          {m.slices.map((x, i) => (
            <li key={i}>
              <Swatch shape="square" color={seriesColor(i, drawing)} />
              <span className="ui-legend-name">{x.label}</span>
              <span className="ui-legend-value">{withUnit(x.value, m.unit)}</span>
              <span className="ui-legend-pct">{percent(x.value, m.total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}
