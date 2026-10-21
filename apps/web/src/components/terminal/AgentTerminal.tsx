import { dotPalette } from '@monsters/monster-kit';
import { MagnifyingGlass } from '@phosphor-icons/react';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useApp } from '../../store/app.ts';
import {
  agentFileText,
  baseName,
  describeTool,
  errorSentence,
  formatDuration,
  isStopText,
  modelLabel,
  taskText,
  toolShort,
} from '../../store/derive.ts';
import { plainText } from '../../lib/markdown.ts';
import { instinctSentence, receiptSummary, securitySentence } from '../../store/instinct.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { moodText, useAgent, useLive, useNameOf } from '../../store/hooks.ts';
import { cn, domId, formatTime, prettyJson } from '../../lib/utils.ts';
import { formatNumber } from '@monsters/shared';
import { Monster, expressionFor } from '../monster/Monster.tsx';
import { fitDots } from '../monster/MonsterScreen.tsx';
import {
  buildTerminal,
  entryMatches,
  entryText,
  type TermEntry,
  type TermFilter,
} from './entries.ts';
import { useTerminalFocus } from './focus.ts';
import { terminalStrings } from './terminal.strings.ts';
import { openPreview } from '../../store/preview.ts';
import { filesIn, useFileMeta, useFileUrl } from '../preview/files.ts';
import '../chat/chat.css';

/*
 * "Dietro le quinte" (docs/design.md): the terminal of one monster is a big
 * screen of the instrument. Black, static scan lines, Martian Mono in the
 * light of the screen; the tools in the monster's own light, the problems in
 * light red, the times dim. One line per step, oldest first, live at the
 * bottom.
 */

const FILTERS: readonly TermFilter[] = ['all', 'thoughts', 'tools', 'delegations', 'errors'];

/** The marks at the start of a line: what kind of step it is, in one glyph. */
const MARK = {
  thought: '·',
  message: '›',
  tool: '▸',
  out: '→',
  in: '←',
  error: '✕',
  stop: '■',
  vault: '◆',
  question: '?',
  run: '─',
  usage: '≈',
  instinct: '◇',
  security: '!',
  receipt: '═',
} as const;

function Line({
  ts,
  mark,
  tone = 'default',
  run,
  focus,
  children,
}: {
  ts: number;
  mark: string;
  tone?: 'default' | 'error' | 'muted' | 'lit';
  run?: string | undefined;
  focus?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className="term-row grid grid-cols-[44px_14px_minmax(0,1fr)] items-start gap-x-2 rounded-[4px] px-2 py-[3px]"
      data-run={run}
      data-focus={focus ? '' : undefined}
    >
      <time className="text-screen-muted tabular-nums" dateTime={new Date(ts).toISOString()}>
        {formatTime(ts)}
      </time>
      <span
        aria-hidden
        className={cn(
          'text-center',
          tone === 'error'
            ? 'text-screen-stop'
            : tone === 'lit'
              ? 'text-[var(--lit)]'
              : 'text-screen-muted',
        )}
      >
        {mark}
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-2">
      <p className="label mb-1 text-screen-muted">{label}</p>
      <pre className="term-pre scroll-screen max-h-64 overflow-auto rounded-[8px] p-3 text-micro leading-[1.6] whitespace-pre-wrap break-words text-screen-ink">
        {prettyJson(value)}
      </pre>
    </div>
  );
}

const seconds = (ms: number) => formatDuration(ms);

function ToolLine({ e, focus }: { e: Extract<TermEntry, { kind: 'tool' }>; focus: boolean }) {
  const [open, setOpen] = useState(false);
  const id = domId(useId());
  const failed = e.result?.ok === false;
  const running = !e.result;
  const stopped = failed && isStopText(e.result?.error);
  const files = useMemo(() => (e.result?.ok ? filesIn(e.result.output) : []), [e.result]);
  const s = terminalStrings();
  return (
    <Line
      ts={e.ts}
      mark={failed ? MARK.error : MARK.tool}
      tone={failed ? 'error' : 'lit'}
      run={e.run}
      focus={focus}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="row-key w-full rounded-[4px] text-left focus-visible:outline-2 focus-visible:outline-signal"
        data-testid="tool-line"
      >
        <span className="mr-2 font-semibold uppercase tracking-[0.04em] text-[var(--lit)]">
          {toolShort(e.tool)}
        </span>
        <span className="text-screen-ink">{describeTool(e.tool, e.input)}</span>
        <span className={cn('ml-2', failed && !stopped ? 'text-screen-stop' : 'text-screen-muted')}>
          {running
            ? s.running
            : failed
              ? stopped
                ? s.stoppedMidway
                : s.failed
              : e.result?.durationMs !== undefined
                ? seconds(e.result.durationMs)
                : s.done}
        </span>
        <span aria-hidden className="ml-2 text-screen-muted">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {files.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="term-files">
          {files.map((id) => (
            <TermFile key={id} fileId={id} />
          ))}
        </div>
      )}
      {failed && e.result?.error && !open && (
        <p className={cn('mt-0.5', stopped ? 'text-screen-muted' : 'text-screen-stop')}>
          {stopped ? s.stoppedByStop : e.result.error}
        </p>
      )}
      {open && (
        <div id={id}>
          <p className="mt-1.5 text-screen-muted">
            {s.tool} <span className="text-screen-ink">{e.tool}</span>
          </p>
          {e.input !== undefined && <CodeBlock label={s.dataSent} value={e.input} />}
          {e.result && (
            <CodeBlock
              label={e.result.ok ? s.result : s.problem}
              value={e.result.ok ? (e.result.output ?? 'ok') : (e.result.error ?? e.result.output)}
            />
          )}
        </div>
      )}
    </Line>
  );
}

/** A file a tool made (a browser screenshot): a small copy that opens in Anteprima. */
function TermFile({ fileId }: { fileId: string }) {
  const meta = useFileMeta(fileId);
  const ready = meta.state === 'ready' ? meta.meta : null;
  const image = ready?.kind === 'image';
  const picture = useFileUrl(image ? fileId : null);
  const s = terminalStrings();
  return (
    <button
      type="button"
      onClick={() => openPreview({ kind: 'file', fileId })}
      className="term-file flex items-center gap-2 rounded-[6px] p-1 pr-2 text-left"
      title={s.openFile(ready?.name ?? null)}
      data-testid="term-file"
    >
      {image ? (
        <img
          src={picture.src}
          alt=""
          loading="lazy"
          onError={() => picture.retry(() => {})}
          className="h-12 w-20 rounded-[4px] object-cover"
        />
      ) : (
        <span aria-hidden className="px-1 text-[var(--lit)]">
          ▣
        </span>
      )}
      <span className="max-w-[200px] truncate text-screen-ink">
        {ready?.name ?? (meta.state === 'missing' ? s.fileGone : s.file)}
      </span>
    </button>
  );
}

function Entry({ e, agentId, focus }: { e: TermEntry; agentId: string; focus: boolean }) {
  const nameOf = useNameOf();
  const s = terminalStrings();
  switch (e.kind) {
    case 'thought':
      return (
        <Line ts={e.ts} mark={MARK.thought} run={e.run} focus={focus}>
          <Markdown text={e.text} streaming={e.live} className="text-screen-muted" />
        </Line>
      );
    case 'message':
      return (
        <Line ts={e.ts} mark={MARK.message} tone="lit" run={e.run} focus={focus}>
          <Markdown text={e.text} className="text-screen-ink" />
        </Line>
      );
    case 'tool':
      return <ToolLine e={e} focus={focus} />;
    case 'delegation': {
      return (
        <Line
          ts={e.ts}
          mark={e.dir === 'out' ? MARK.out : MARK.in}
          tone={e.status === 'failed' ? 'error' : 'lit'}
          run={e.run}
          focus={focus}
        >
          <p className="text-screen-ink">
            <span className="mr-2 font-semibold uppercase tracking-[0.04em] text-[var(--lit)]">
              {s.delegation(e.dir, e.status, nameOf(e.other))}
            </span>
            {taskText(e.status === 'completed' && e.summary ? e.summary : e.goal, 220)}
          </p>
          {e.error && !isStopText(e.error) && <p className="mt-0.5 text-screen-stop">{e.error}</p>}
        </Line>
      );
    }
    case 'error': {
      const quiet = e.code === 'aborted' || isStopText(e.message);
      const text = errorSentence(
        { agent: agentId, data: { code: e.code, message: e.message } },
        nameOf,
      );
      return (
        <Line
          ts={e.ts}
          mark={quiet ? MARK.stop : MARK.error}
          tone={quiet ? 'muted' : 'error'}
          run={e.run}
          focus={focus}
        >
          <p className={quiet ? 'text-screen-muted' : 'text-screen-stop'}>{text}</p>
        </Line>
      );
    }
    case 'vault':
      return (
        <Line ts={e.ts} mark={MARK.vault} tone="lit" run={e.run} focus={focus}>
          <p className="text-screen-ink">
            {agentFileText(e.path, e.action) ?? (
              <>{s.noteDone(s.vault[e.action] ?? s.noteTouched, baseName(e.path))}</>
            )}
          </p>
          <p className="truncate text-screen-muted">
            {e.path.replace(/\.md$/i, '').split('/').join(' › ')}
          </p>
        </Line>
      );
    case 'question':
      return (
        <Line ts={e.ts} mark={MARK.question} tone="lit" run={e.run} focus={focus}>
          <p className="text-screen-ink">
            <span className="mr-2 font-semibold tracking-[0.04em] text-signal uppercase">
              {s.question}
            </span>
            {plainText(e.text)}
          </p>
        </Line>
      );
    case 'run':
      return (
        <Line ts={e.ts} mark={MARK.run} tone="muted" run={e.run} focus={focus}>
          {/* A short head in `.label`, the rest in normal case: a long task is never shouted. */}
          <p className="text-screen-muted">
            <span className="label mr-2">
              {e.status === 'started'
                ? s.run.started
                : e.status === 'completed'
                  ? s.run.completed
                  : e.status === 'failed'
                    ? s.run.failed
                    : s.run.aborted}
            </span>
            {e.status === 'started' && e.goal ? taskText(e.goal, 120) : null}
          </p>
        </Line>
      );
    case 'usage':
      return (
        <Line ts={e.ts} mark={MARK.usage} tone="muted" run={e.run} focus={focus}>
          <p className="text-screen-muted">
            {s.usage(
              modelLabel(e.model),
              formatNumber(e.tokens),
              e.tokens,
              e.durationMs !== undefined ? seconds(e.durationMs) : null,
            )}
          </p>
        </Line>
      );
    case 'instinct':
      return (
        <Line ts={e.ts} mark={MARK.instinct} tone="lit" run={e.run} focus={focus}>
          <p className="text-screen-ink" data-testid="term-instinct">
            <span className="mr-2 font-semibold tracking-[0.04em] text-screen-muted uppercase">
              {s.decision}
            </span>
            {instinctSentence(e.data, nameOf)}
          </p>
        </Line>
      );
    case 'security':
      return (
        <Line ts={e.ts} mark={MARK.security} tone="error" run={e.run} focus={focus}>
          <p className="text-screen-ink">{securitySentence(e.data)}</p>
        </Line>
      );
    case 'receipt':
      return (
        <Line ts={e.ts} mark={MARK.receipt} tone="muted" run={e.run} focus={focus}>
          <p className="text-screen-muted" data-testid="term-receipt">
            <span className="label mr-2">{s.receipt}</span>
            {receiptSummary(e.data)}
          </p>
        </Line>
      );
  }
}

function TerminalBody({ agentId }: { agentId: string }) {
  const s = terminalStrings();
  const agent = useAgent(agentId);
  const live = useLive(agentId);
  const events = useApp((s) => s.events);
  const focus = useTerminalFocus();
  const [filter, setFilter] = useState<TermFilter>('all');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => buildTerminal(events, agentId), [events, agentId]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) => entryMatches(e, filter) && (!q || entryText(e).toLowerCase().includes(q)),
    );
  }, [entries, filter, query]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastKey = `${shown.length}:${entryText(shown.at(-1) ?? { kind: 'run', id: '', ts: 0, status: '' }).length}`;
  const focusRun = focus.runId && entries.some((e) => e.run === focus.runId) ? focus.runId : null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  // Asked for a run (from the instrumentation line): its first line in sight, near the top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !focusRun) return;
    const row = el.querySelector<HTMLElement>(`[data-run="${CSS.escape(focusRun)}"]`);
    if (!row) return;
    pinned.current = false;
    el.scrollTop = Math.max(0, row.offsetTop - 12);
  }, [focusRun, focus.nonce]);

  if (!agent) return null;
  const lit = dotPalette(agent.genome).lit;
  return (
    <div className="term flex min-h-0 flex-1 flex-col" style={{ '--lit': lit } as CSSProperties}>
      <header className="flex items-center gap-3.5 px-4 pt-4 pb-3">
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: fitDots(80, 34, 0), height: 34 }}
        >
          <Monster
            genome={agent.genome}
            size={fitDots(80, 34, 0)}
            expression={expressionFor(live.mood, live.confused)}
            title={agent.name}
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="terminal-title" className="flex min-w-0 items-baseline gap-3">
            <span className="sr-only">{s.behind(agent.name)}</span>
            <span
              aria-hidden
              className="dots truncate text-title2 leading-[26px]"
              style={{ color: lit }}
            >
              {agent.name}
            </span>
            <span aria-hidden className="label shrink-0 text-screen-muted">
              {s.behindLabel}
            </span>
          </h2>
          <p className="truncate text-screen-muted">
            {agent.role} · {moodText(live.mood)}
          </p>
        </div>
      </header>
      <div className="flex flex-col gap-2.5 px-4 pb-3 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
        <div
          role="radiogroup"
          aria-label={s.show}
          // On a phone the keys wrap: all five in sight, none cut at the edge.
          className="scroll-screen -mx-1 flex flex-wrap gap-1 px-1 sm:flex-nowrap sm:overflow-x-auto"
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className="term-filter label shrink-0"
            >
              {s.filters[f]}
            </button>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">{s.searchLabel(agent.name)}</span>
          <MagnifyingGlass
            size={15}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-screen-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={s.search}
            className="term-input h-9 w-full rounded-[8px] pr-3 pl-9 font-mono text-micro"
          />
        </label>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-screen relative min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-8"
      >
        {shown.length === 0 ? (
          <p className="px-2 py-10 text-center text-screen-muted">
            {entries.length === 0 ? s.emptyDay(agent.name) : s.emptyFilter}
          </p>
        ) : (
          <ol aria-label={s.log(agent.name)} data-testid="terminal-log">
            {shown.map((e) => (
              <Entry key={e.id} e={e} agentId={agentId} focus={!!focusRun && e.run === focusRun} />
            ))}
          </ol>
        )}
        {live.mood === 'working' && (
          <p aria-hidden className="px-2 pt-1 text-[var(--lit)]">
            <span className="screen-cursor inline-block h-[14px] w-[7px] translate-y-[2px] bg-current" />
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * "Dietro le quinte" (the terminal of a monster): the tab of the right-hand
 * pane (components/dock), with what one monster thought and did step by step.
 */
export function TerminalPanel({ agentId }: { agentId: string }) {
  return (
    <div
      role="region"
      aria-labelledby="terminal-title"
      data-testid="agent-terminal"
      className="flex min-h-0 flex-1 flex-col"
    >
      <TerminalBody key={agentId} agentId={agentId} />
    </div>
  );
}
