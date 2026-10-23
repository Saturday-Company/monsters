import type { UiNode } from '@monsters/shared';
import { useId } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Circle,
  Info,
  Minus,
  PlayCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  MAX_OPTIONS,
  MAX_POINTS,
  MAX_STATS,
  cap,
  fullNumber,
  nodesOf,
  strOf,
  strings,
  tableModel,
} from './model.ts';
import { UI_MAX_ROWS } from '@monsters/shared';
import { uiBlockViewStrings } from './ui-block.strings.ts';

/* The text parts of a block (D-162): numbers, table, comparison, steps, checklist, timeline, card, callout. */

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const records = (v: unknown): Record<string, unknown>[] =>
  arr(v).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');

function Title({ text }: { text: string }) {
  return text ? <p className="ui-title">{text}</p> : null;
}

function More({ text }: { text: string }) {
  return <p className="ui-more">{text}</p>;
}

// ------------------------------------------------------------------------------------ stats

const TRENDS = ['up', 'down', 'flat'] as const;
type Trend = (typeof TRENDS)[number];
const trendOf = (v: unknown): Trend | null =>
  (TRENDS as readonly unknown[]).includes(v) ? (v as Trend) : null;

export function Stats({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const { shown, hidden } = cap(
    nodesOf(node.props['items']).filter((n) => n.typeName === 'Stat'),
    MAX_STATS,
  );
  if (shown.length === 0) return null;
  const trendWord = { up: s.trendUp, down: s.trendDown, flat: s.trendFlat };
  const icon = { up: ArrowUp, down: ArrowDown, flat: Minus };
  return (
    <div className="ui-part" data-testid="ui-stats">
      <dl className="ui-stats">
        {shown.map((stat, i) => {
          const change = strOf(stat.props['change']);
          const trend = trendOf(stat.props['trend']);
          const Icon = trend ? icon[trend] : null;
          return (
            <div key={i} className="ui-tile" data-testid="ui-stat">
              <dt className="ui-tile-label">{strOf(stat.props['label'])}</dt>
              <dd className="ui-tile-value">{strOf(stat.props['value'])}</dd>
              {change && (
                <dd className="ui-tile-change" data-trend={trend ?? undefined}>
                  {Icon && <Icon size={13} weight="bold" aria-hidden />}
                  <span>{change}</span>
                  {trend && <span className="sr-only">{`(${trendWord[trend]})`}</span>}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
      {hidden > 0 && <More text={s.moreItems(hidden)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------ table

export function Table({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const m = tableModel(node);
  const titleId = useId();
  if (m.columns.length === 0) return null;
  return (
    <div className="ui-part" data-testid="ui-table">
      {m.caption && (
        <p id={titleId} className="ui-title">
          {m.caption}
        </p>
      )}
      <div className="md-table ui-table scroll-soft">
        <table aria-labelledby={m.caption ? titleId : undefined}>
          <thead>
            <tr>
              {m.columns.map((c, i) => (
                <th key={i} scope="col" className={m.numeric[i] ? 'ui-num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} className={m.numeric[i] ? 'ui-num' : undefined}>
                    {typeof cell === 'number' ? fullNumber(cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.hidden > 0 && <More text={s.moreRows(m.hidden)} />}
    </div>
  );
}

// ----------------------------------------------------------------------------------- compare

export function Compare({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const { shown, hidden } = cap(
    nodesOf(node.props['options']).filter((n) => n.typeName === 'Option'),
    MAX_OPTIONS,
  );
  if (shown.length === 0) return null;
  return (
    <div className="ui-part" data-testid="ui-compare">
      <Title text={strOf(node.props['title'])} />
      <ul className="ui-compare">
        {shown.map((option, i) => {
          const best = option.props['best'] === true;
          const points = cap(strings(option.props['points']).filter(Boolean), MAX_POINTS);
          const verdict = strOf(option.props['verdict']);
          return (
            <li
              key={i}
              className="ui-option"
              data-best={best ? 'true' : undefined}
              data-testid="ui-option"
            >
              <div className="ui-option-head">
                <span className="ui-option-name">{strOf(option.props['name'])}</span>
                {best && (
                  <span className="label ui-best">
                    <span aria-hidden className="led" data-tone="signal" />
                    {s.best}
                  </span>
                )}
              </div>
              {points.shown.length > 0 && (
                <ul className="ui-points">
                  {points.shown.map((p, k) => (
                    <li key={k}>{p}</li>
                  ))}
                </ul>
              )}
              {points.hidden > 0 && <More text={s.moreItems(points.hidden)} />}
              {verdict && <p className="ui-verdict">{verdict}</p>}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <More text={s.moreItems(hidden)} />}
    </div>
  );
}

// -------------------------------------------------------------------------------------- steps

const STATUSES = ['done', 'doing', 'todo'] as const;
type Status = (typeof STATUSES)[number];
const statusOf = (v: unknown): Status | null =>
  (STATUSES as readonly unknown[]).includes(v) ? (v as Status) : null;

export function Steps({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const { shown, hidden } = cap(
    nodesOf(node.props['items']).filter((n) => n.typeName === 'Step'),
    UI_MAX_ROWS,
  );
  if (shown.length === 0) return null;
  return (
    <div className="ui-part" data-testid="ui-steps">
      <Title text={strOf(node.props['title'])} />
      <ol className="ui-steps">
        {shown.map((step, i) => {
          const status = statusOf(step.props['status']);
          const detail = strOf(step.props['detail']);
          return (
            <li key={i} data-status={status ?? undefined} data-testid="ui-step">
              <span className="ui-step-mark" aria-hidden>
                {status === 'done' ? (
                  <CheckCircle size={22} weight="fill" />
                ) : status === 'doing' ? (
                  <PlayCircle size={22} weight="fill" />
                ) : status === 'todo' ? (
                  <Circle size={22} weight="bold" />
                ) : (
                  <span className="ui-step-number">{i + 1}</span>
                )}
              </span>
              <span className="ui-step-body">
                <span className="ui-step-title">{strOf(step.props['title'])}</span>
                {status && <span className="sr-only">{` (${s.status[status]})`}</span>}
                {detail && <span className="ui-step-detail">{detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {hidden > 0 && <More text={s.moreItems(hidden)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------- checklist

export function Checklist({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const items = records(node.props['items']).map((i) => ({
    text: strOf(i['text']),
    done: i['done'] === true,
  }));
  const { shown, hidden } = cap(
    items.filter((i) => i.text),
    UI_MAX_ROWS,
  );
  if (shown.length === 0) return null;
  return (
    <div className="ui-part" data-testid="ui-checklist">
      <Title text={strOf(node.props['title'])} />
      <ul className="ui-checklist">
        {shown.map((item, i) => (
          <li key={i} data-done={item.done ? 'true' : undefined}>
            <label>
              <input type="checkbox" checked={item.done} disabled readOnly className="md-check" />
              <span>{item.text}</span>
              <span className="sr-only">{` (${item.done ? s.checked : s.unchecked})`}</span>
            </label>
          </li>
        ))}
      </ul>
      {hidden > 0 && <More text={s.moreItems(hidden)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------- timeline

export function Timeline({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const events = records(node.props['events']).map((e) => ({
    date: strOf(e['date']),
    label: strOf(e['label']),
    detail: strOf(e['detail']),
  }));
  const { shown, hidden } = cap(
    events.filter((e) => e.label || e.date),
    UI_MAX_ROWS,
  );
  if (shown.length === 0) return null;
  return (
    <div className="ui-part" data-testid="ui-timeline">
      <Title text={strOf(node.props['title'])} />
      <ol className="ui-timeline">
        {shown.map((e, i) => (
          <li key={i}>
            {e.date && <span className="label ui-timeline-date">{e.date}</span>}
            <span className="ui-timeline-label">{e.label}</span>
            {e.detail && <span className="ui-timeline-detail">{e.detail}</span>}
          </li>
        ))}
      </ol>
      {hidden > 0 && <More text={s.moreItems(hidden)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------- card

export function Card({ node }: { node: UiNode }) {
  const title = strOf(node.props['title']);
  const body = strOf(node.props['body']);
  const tag = strOf(node.props['tag']);
  if (!title && !body) return null;
  return (
    <section className="ui-part ui-card" data-testid="ui-card">
      <div className="ui-card-head">
        <h4 className="ui-card-title">{title}</h4>
        {tag && <span className="label ui-tag">{tag}</span>}
      </div>
      {body && <p className="ui-card-body">{body}</p>}
    </section>
  );
}

// ----------------------------------------------------------------------------------- callout

const TONES = ['info', 'success', 'warning'] as const;
type Tone = (typeof TONES)[number];

export function Callout({ node }: { node: UiNode }) {
  const s = uiBlockViewStrings();
  const text = strOf(node.props['text']);
  const raw = node.props['tone'];
  const tone: Tone = (TONES as readonly unknown[]).includes(raw) ? (raw as Tone) : 'info';
  if (!text) return null;
  const Icon = tone === 'warning' ? WarningCircle : tone === 'success' ? CheckCircle : Info;
  return (
    <div className="ui-part ui-callout" data-tone={tone} role="note" data-testid="ui-callout">
      <Icon size={20} weight="fill" aria-hidden className="ui-callout-icon" />
      <p>
        <span className="sr-only">{`${s.tone[tone]}: `}</span>
        {text}
      </p>
    </div>
  );
}
