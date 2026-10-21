import { findSettingsPlaces } from '@monsters/shared';
import { CaretDown, CaretUp, NotePencil, WarningCircle } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { openTerminal } from '../../store/app.ts';
import { openTerminalAt } from '../terminal/focus.ts';
import {
  capitalize,
  delegationGroupLabel,
  doneSummary,
  errorSentence,
  fileSentence,
  reportOutcome,
  taskText,
  type ChatItem,
} from '../../store/derive.ts';
import { useAgent, useNameOf } from '../../store/hooks.ts';
import { useProject } from '../../store/projects.ts';
import { clipText, plainText } from '../../lib/markdown.ts';
import { openPage, PATHS, projectPath } from '../../lib/router.ts';
import { cn, formatTime } from '../../lib/utils.ts';
import { NoteChip } from '../ui/MarkdownRenderer.tsx';
import { FileById } from '../files/FileChip.tsx';
import { chatStrings } from './chat.strings.ts';
import { CHATGPT_USAGE_URL } from './Composer.tsx';

/*
 * The rows of a chat that are not bubbles: events among monsters (small
 * centred lines, folded when they come in a row), errors, stops and the start
 * of a new conversation (docs/design.md, audit 3.1 and 3.4).
 */

/** “Task”, clipped: the task of a delegation in the lines of the chat. */
const quoted = (goal: string, n = 90) => chatStrings().events.quote(taskText(goal, n));

/** A short piece of a task or result for a label: one line, clipped. */
const brief = (s: string, n = 54) => taskText(s, n).replace(/[.!]$/, '');

/*
 * One family for every service line of a chat (UX 7): a head in `.label` between two seams, short
 * (up to HEAD_MAX characters: "TITAN → RHEA · 21:53"), and under it the content in normal case,
 * Instrument Sans 13 in `--ink-muted`, never cut. One accent of colour per row: its light. What
 * does not fit a head goes under it as content.
 */
const HEAD_MAX = 40;
const SERVICE_BODY = 'max-w-[600px] text-center text-caption leading-snug text-ink-muted';

type LineTone = 'ok' | 'signal' | 'stop' | undefined;

/** The head: a `.label` between the seams, with the time after it when there is one. */
function ServiceHead({ head, time, tone }: { head: string; time?: number; tone?: LineTone }) {
  return (
    <span className="event-line label w-full text-ink-muted" aria-hidden>
      {tone && <span className="led shrink-0" data-tone={tone} />}
      <span className="min-w-0 text-center">{head}</span>
      {time !== undefined && <span className="shrink-0 text-ink-faint">· {formatTime(time)}</span>}
    </span>
  );
}

/** The content under the head: the light of the row, then the words. */
function ServiceBody({ tone, children }: { tone?: LineTone; children: ReactNode }) {
  return (
    <span className={SERVICE_BODY}>
      {tone && <span aria-hidden className="led mr-2 align-middle" data-tone={tone} />}
      {children}
    </span>
  );
}

/** A line of the family: `head` between the seams (or only the time, when the words are long). */
function ServiceLine({
  head,
  time,
  tone,
  children,
  onOpen,
  title,
  sr,
  testId,
  status,
}: {
  head: string | null;
  time?: number;
  tone?: LineTone;
  children?: ReactNode;
  onOpen?: () => void;
  title?: string;
  /** What a screen reader says in place of the visual line (the head is upper case on screen). */
  sr?: string;
  testId?: string;
  status?: string;
}) {
  const inner = (
    <>
      {head !== null ? (
        <ServiceHead head={head} time={time} tone={children === undefined ? tone : undefined} />
      ) : time !== undefined ? (
        <ServiceHead head={formatTime(time)} />
      ) : null}
      {children !== undefined && (
        <ServiceBody tone={tone}>
          <span aria-hidden={sr ? true : undefined}>{children}</span>
        </ServiceBody>
      )}
      {sr && <span className="sr-only">{sr}</span>}
    </>
  );
  const cls = 'flex w-full flex-col items-center gap-1 px-2';
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      data-testid={testId}
      data-status={status}
      className={cn(
        cls,
        'rounded-[6px] hover:[&_.text-ink-muted]:text-ink focus-visible:outline-2 focus-visible:outline-signal-ink',
      )}
    >
      {inner}
    </button>
  ) : (
    <p className={cls} data-testid={testId} data-status={status}>
      {inner}
    </p>
  );
}

/** A head of the family only when the words are short enough; else the time is the head. */
const asHead = (text: string): string | null => (text.length <= HEAD_MAX ? text : null);

/**
 * A delegation seen from who gave it (or from the orchestrator's chat): a
 * `.label` centred between two seams, "RHEA FINISHED · 5 IDEAS SAVED". The
 * whole sentence is its name and tooltip; a click opens the terminal of who did
 * the work.
 */
function DelegationLine({ item }: { item: Extract<ChatItem, { kind: 'delegation' }> }) {
  const s = chatStrings().events;
  const from = useAgent(item.from);
  const to = useAgent(item.to);
  const toName = to?.name ?? capitalize(item.to);
  const fromName = from?.name ?? capitalize(item.from);
  let head: string;
  let body: string;
  let sentence: string;
  let tone: LineTone;
  if (item.status === 'completed') {
    const extra = doneSummary(item.goal, item.summary);
    head = s.finishedHead(toName);
    body = extra ?? brief(item.goal, 90);
    tone = 'ok';
    sentence = s.finishedSentence(toName, quoted(item.goal), extra);
  } else if (item.status === 'aborted') {
    head = s.stoppedHead(toName);
    body = brief(item.goal, 90);
    sentence = s.stoppedSentence(toName, quoted(item.goal));
  } else if (item.status === 'failed') {
    head = s.failedHead(toName);
    body = brief(item.goal, 90);
    tone = 'stop';
    sentence = s.failedSentence(toName, quoted(item.goal));
  } else {
    head = `${fromName} → ${toName}`;
    body = brief(item.goal, 90);
    sentence = s.handedSentence(fromName, toName, quoted(item.goal));
  }
  return (
    <div className="flex flex-col items-center">
      <ServiceLine
        head={head}
        time={item.ts}
        tone={tone}
        onOpen={() => openTerminal(item.to)}
        title={s.behindTitle(sentence, toName)}
        sr={sentence}
        testId="delegation"
        status={item.status}
      >
        {body}
      </ServiceLine>
      {item.checks && <TaskChecks checks={item.checks} className="mt-1 px-2" />}
    </div>
  );
}

/** What the instinct said of a task, under it: "◇ Dione hadn’t finished the job…". */
function TaskChecks({
  checks,
  className,
}: {
  checks: NonNullable<Extract<ChatItem, { kind: 'delegation' }>['checks']>;
  className?: string;
}) {
  const s = chatStrings().events;
  return (
    <ul className={cn('flex flex-col items-center gap-0.5', className)}>
      {checks.map((c, i) => (
        <li key={i} data-testid="task-check" className={SERVICE_BODY}>
          <span
            aria-hidden
            className="led mr-2 align-middle"
            data-tone={c.tone === 'warn' ? 'signal' : c.tone === 'stop' ? 'stop' : undefined}
          />
          <span className="sr-only">{s.decision}</span>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * A delegation in the chat of the monster that received it (audit 3.4): who
 * asked what, and below the result, with the notes it wrote.
 */
function ReceivedTask({ item }: { item: Extract<ChatItem, { kind: 'delegation' }> }) {
  const s = chatStrings().events;
  const from = useAgent(item.from);
  const to = useAgent(item.to);
  const fromName = from?.name ?? capitalize(item.from);
  const toName = to?.name ?? capitalize(item.to);
  const done = item.status === 'completed';
  const result = done ? (doneSummary(item.goal, item.summary) ?? s.done) : null;
  return (
    <div
      className="flex flex-col items-center gap-2 px-2 text-center"
      data-testid="received-task"
      data-status={item.status}
    >
      <p className="event-line label w-full text-ink-muted">
        <span className="shrink-0" aria-hidden>
          {fromName} → {toName} · {formatTime(item.ts)}
        </span>
        <span className="sr-only normal-case">{s.taskFrom(fromName, toName)}</span>
      </p>
      <p className={SERVICE_BODY}>
        <span className="font-medium text-ink">{fromName}</span>{' '}
        {s.asked(toName, quoted(item.goal, 160))}
      </p>
      {done ? (
        <div className="flex max-w-[600px] flex-col items-center gap-1.5">
          <p className="flex items-start gap-2 text-caption leading-snug text-ink">
            <span aria-hidden className="led mt-1.5" data-tone="ok" />
            <span>{result}</span>
          </p>
          {item.notes && item.notes.length > 0 && (
            <div className="md flex flex-wrap justify-center gap-1.5 text-caption text-ink">
              {item.notes.slice(-3).map((n) => (
                <NoteChip key={n} target={n} />
              ))}
            </div>
          )}
        </div>
      ) : null}
      {item.checks && <TaskChecks checks={item.checks} />}
      {done ? null : (
        <p className="label text-ink-muted">
          {item.status === 'started'
            ? s.working
            : item.status === 'failed'
              ? s.failedShort
              : s.stoppedShort}
        </p>
      )}
    </div>
  );
}

export function DelegationRow({
  item,
  chat,
}: {
  item: Extract<ChatItem, { kind: 'delegation' }>;
  chat: string;
}) {
  return chat === item.to && item.from !== item.to ? (
    <ReceivedTask item={item} />
  ) : (
    <DelegationLine item={item} />
  );
}

/**
 * Several events among monsters in a row (tasks, and what the instinct said): one line that opens
 * ("4 tasks completed"), closed until the user opens it.
 */
export function DelegationGroup({ items, chat }: { items: ChatItem[]; chat: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-center gap-2.5" data-testid="delegation-group">
      <div className="event-line w-full px-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={delegationGroupLabel(items)}
          className="label flex shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-ink-muted hover:text-ink"
        >
          {delegationGroupLabel(items)}
          {open ? (
            <CaretUp size={12} weight="bold" aria-hidden />
          ) : (
            <CaretDown size={12} weight="bold" aria-hidden />
          )}
        </button>
      </div>
      {open && (
        <ol className="flex w-full flex-col gap-2">
          {items.map((it) =>
            it.kind === 'delegation' ? (
              <li key={it.id}>
                <DelegationRow item={it} chat={chat} />
              </li>
            ) : it.kind === 'instinct' ? (
              <li key={it.id}>
                <InstinctRow item={it} />
              </li>
            ) : null,
          )}
        </ol>
      )}
    </div>
  );
}

/**
 * Something the instinct did during a job (D-068): a line between seams like
 * the events among monsters, "RHEA IS THINKING", "DIONE HADN'T FINISHED THE
 * JOB: I ASKED TO COMPLETE IT". A doubt is in the signal ink, an order
 * removed or an action refused in red. A click opens Behind the scenes there.
 */
export function InstinctRow({ item }: { item: Extract<ChatItem, { kind: 'instinct' }> }) {
  const agent = useAgent(item.agent);
  const name = agent?.name ?? capitalize(item.agent);
  const s = chatStrings().events;
  return (
    <ServiceLine
      head={name}
      time={item.ts}
      tone={item.tone === 'stop' ? 'stop' : item.tone === 'warn' ? 'signal' : undefined}
      onOpen={() => openTerminalAt(item.agent, item.runId)}
      title={s.instinctTitle(item.text)}
      sr={`${item.about === 'defense' ? s.about.defense : item.about === 'spend' ? s.about.spend : s.about.other}: ${item.text}`}
      testId="instinct-line"
    >
      {item.text}
    </ServiceLine>
  );
}

/** Codes of a reached ChatGPT plan limit (ChatGPT provider or Codex). */
const PLAN_LIMIT = new Set([
  'subscription_sharing_usage_limit_exceeded',
  'harness_chatgpt_usage_limit',
]);

/** "… in Settings → Models …" (or "Impostazioni → Modelli": either language) with the place as a link to that tab. */
export function withSettingsLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of findSettingsPlaces(text)) {
    out.push(text.slice(at, m.index));
    out.push(
      <a
        key={m.index}
        href={`${PATHS.settings}?sezione=${m.tab}`}
        className="font-medium underline underline-offset-2"
      >
        {m.text}
      </a>,
    );
    at = m.index + m.text.length;
  }
  out.push(text.slice(at));
  return out;
}

export function ErrorRow({ item }: { item: Extract<ChatItem, { kind: 'error' }> }) {
  const s = chatStrings().events;
  const nameOf = useNameOf();
  if (item.code && PLAN_LIMIT.has(item.code)) {
    // OpenAI's usage-limit state: "Manage usage" is the primary action.
    return (
      <div className="flex justify-center px-2" data-testid="chatgpt-usage-limit">
        <div
          role="status"
          className="grid max-w-full gap-1 rounded-[18px] bg-danger-soft px-3.5 py-2.5 text-body leading-snug text-on-danger-soft"
        >
          <p className="flex items-center gap-2 font-semibold">
            <WarningCircle size={20} weight="fill" className="shrink-0" aria-hidden />
            {s.usageLimit}
          </p>
          <p>{s.usageLimitHint}</p>
          <p className="text-footnote opacity-80">{item.text}</p>
          <a
            href={CHATGPT_USAGE_URL}
            target="_blank"
            rel="noreferrer"
            className="key key-primary mt-1 inline-flex h-9 items-center justify-self-start rounded-[9px] px-3.5 text-footnote font-semibold"
          >
            {s.manageUsage}
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-center px-2">
      <p
        role="status"
        className="flex max-w-[600px] items-start gap-2 rounded-[14px] bg-danger-soft px-3 py-2 text-body leading-snug text-on-danger-soft"
      >
        <WarningCircle size={19} weight="fill" className="mt-px shrink-0" aria-hidden />
        <span>
          {withSettingsLinks(
            errorSentence(
              { agent: item.agent, data: { code: item.code, message: item.text } },
              nameOf,
            ),
          )}
        </span>
      </p>
    </div>
  );
}

export function SystemRow({ item }: { item: Extract<ChatItem, { kind: 'system' }> }) {
  const s = chatStrings().events;
  const tone = item.tone === 'stop' ? 'stop' : 'ok';
  const head = asHead(item.text);
  return (
    <ServiceLine
      head={head}
      time={item.ts}
      tone={tone}
      sr={s.timed(item.text, formatTime(item.ts))}
      testId="system-row"
    >
      {head === null ? item.text : undefined}
    </ServiceLine>
  );
}

/**
 * A file a monster or its tool saved (D-075): "RHEA SAVED A SCREENSHOT"
 * between the seams, and under it the file itself, which opens the preview.
 */
export function FileRow({ item }: { item: Extract<ChatItem, { kind: 'file' }> }) {
  const s = chatStrings().events;
  const agent = useAgent(item.agent);
  const sentence = fileSentence(item.file, agent?.name ?? capitalize(item.agent));
  const head = asHead(sentence);
  return (
    <div className="flex flex-col items-center gap-2" data-testid="file-row">
      <ServiceLine head={head} time={item.ts} sr={s.timed(sentence, formatTime(item.ts))}>
        {head === null ? sentence : undefined}
      </ServiceLine>
      <FileById id={item.file.id} image={item.file.kind === 'image'} />
    </div>
  );
}

/**
 * A lead's report in the chat of who sent it the work (`project_report`,
 * D-102): "REPORT FROM IAPETUS · SATURDAY SOCIAL" between the seams, the
 * outcome with its light and a short summary, and the way to the project's
 * chat, where the whole answer is.
 */
export function ReportRow({ item }: { item: Extract<ChatItem, { kind: 'report' }> }) {
  const s = chatStrings().events;
  const lead = useAgent(item.lead);
  const project = useProject(item.project);
  const leadName = lead?.name ?? capitalize(item.lead);
  const projectName = project?.name ?? item.project;
  const outcome = reportOutcome(item);
  // The lead's words only when it said something (not the core's own line of a stop).
  const said = item.reason ? null : clipText(plainText(item.summary), 280);
  const href = projectPath(item.project);
  // The project goes in the head when it fits; else under it, with the words of the report.
  const full = s.report(leadName, projectName);
  const reportHead = full.length <= HEAD_MAX ? full : s.reportShort(leadName);
  return (
    <div
      className="flex flex-col items-center gap-2 px-2 text-center"
      data-testid="report-row"
      data-status={item.status}
      data-reason={item.reason}
    >
      <ServiceLine
        head={reportHead}
        time={item.ts}
        sr={s.reportSr(leadName, projectName, formatTime(item.ts))}
      />
      <p className="flex max-w-[600px] items-start gap-2 text-caption leading-snug text-ink">
        <span
          aria-hidden
          className="led mt-1.5 shrink-0"
          data-tone={outcome.tone === 'off' ? undefined : outcome.tone}
        />
        <span className="min-w-0 text-left" data-testid="report-text">
          <span className="font-medium">
            {leadName} {outcome.text}
          </span>
          {full.length > HEAD_MAX ? <span className="text-ink-muted"> · {projectName}</span> : null}
          {said ? <span className="text-ink-muted">: {said}</span> : null}
        </span>
      </p>
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          openPage(href);
        }}
        data-testid="report-open"
        className="label inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-signal-ink hover:underline focus-visible:outline-2 focus-visible:outline-signal-ink"
      >
        {s.openProjectChat}
        <span aria-hidden>→</span>
      </a>
    </div>
  );
}

/** Where a new conversation starts (for everyone, or for this monster only). */
export function ResetRow({ item }: { item: Extract<ChatItem, { kind: 'reset' }> }) {
  const s = chatStrings().events;
  return (
    <div
      role="separator"
      aria-label={s.newConversation}
      data-testid="conversation-divider"
      className="event-line label px-2 pt-1 text-ink-muted"
    >
      <span className="flex shrink-0 items-center gap-2">
        <NotePencil size={14} aria-hidden />
        {s.newConversation}
        <span className="text-ink-faint">· {formatTime(item.ts)}</span>
      </span>
    </div>
  );
}
