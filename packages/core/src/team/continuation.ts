import type { LogEvent } from '@monsters/shared';
import type { EventLog } from '../log/event-log.ts';
import { continuationPrompts, PREVIOUS_JOB_TAGS } from './continuation.prompts.ts';
import type { TierLevel } from './instinct/triage.ts';
import { unicodeWords } from './word-boundary.ts';

/*
 * A short follow-up that continues the previous job (D-195): "finisci pure" after a job that
 * stopped at its step cap, "ok procedi" after a proposal. Two things went wrong on 26/10: the
 * tier question read "finisci pure" alone and sent a hard job (Opus, high effort) to Sonnet at
 * medium effort; and the new turn started a new harness session with only the conversation (the
 * user's messages and the final answers), so everything the job had read and made with its
 * tools was gone.
 *
 * Here: whether a request continues the previous job (judged on the conversation: how that job
 * ended and what it last said, plus a short list of go-ahead words), what that job was (its
 * level, its end, its last context), the harness session it ran in (kept in memory, as the tool
 * set of D-168), and the notes of its steps for when that session cannot be resumed.
 */

/** A follow-up longer than this is a new request, whatever its words. */
export const CONTINUATION_MAX_WORDS = 12;
export const CONTINUATION_MAX_CHARS = 160;
/** A job older than this is not continued by a short message. */
export const CONTINUATION_WINDOW_MS = 24 * 60 * 60_000;
/** Characters of the notes of a job (about 3-4k tokens): the facts, not the whole log. */
export const JOB_NOTES_MAX_CHARS = 12_000;

const LEVELS: readonly TierLevel[] = ['simple', 'medium', 'hard'];

/** The higher of two levels (a continuation never goes below the job it continues). */
export function higherTier(
  a: TierLevel | undefined,
  b: TierLevel | undefined,
): TierLevel | undefined {
  if (!a) return b;
  if (!b) return a;
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

// i18n-ignore: words of the user asking to go on with the work, Italian and English
const GO_WORDS =
  "continua\\w*|prosegu\\w*|procedi|procedete|procediamo|andiamo|avanti|finisci|finiscilo|finiscila|termina|terminalo|terminala|completa|completalo|completala|riprendi\\w*|fallo|falla|fai pure|vai pure|go on|go ahead|carry on|keep going|continue|proceed|finish|finish it|complete it|resume|do it|let'?s go";
const GO_AHEAD = unicodeWords(new RegExp(`\\b(?:${GO_WORDS})\\b`, 'i'));
// i18n-ignore: a go-ahead word negated ("non continuare", "don't finish")
const NEGATED = unicodeWords(
  new RegExp(`\\b(?:non|don'?t|do not|not)\\s+(?:\\w+\\s+)?(?:${GO_WORDS})\\b`, 'i'),
);
// i18n-ignore: words that close or drop a job rather than continue it, Italian and English
const CLOSING = unicodeWords(
  /\b(grazie|perfetto|basta|stop|fermati|lascia stare|lascia perdere|non serve|annulla|niente|no|thanks|thank you|perfect|never mind|forget it|cancel|nope)\b/i,
);

/** What the previous job of a monster's conversation was, from the log. */
export interface PreviousJob {
  runId: string;
  /** It stopped before finishing: a cap (steps, tokens, budget), a stop, a failure. */
  cut: boolean;
  /** Its last answer asks the user something (a question, a "procedo?"). */
  asked: boolean;
  /** The level its request had (its `tier` event), when the monster has levels. */
  tier?: TierLevel;
  /** When it ended (its `run` event), or its last event. */
  endedAt: number;
  /** The context of its last measured step. */
  context?: { total: number; window?: number };
}

/** Codes of the monster's own errors that mean the job stopped before its end. */
const CUT_CODES: ReadonlySet<string> = new Set([
  'max_steps',
  'run_limit',
  'token_limit',
  'aborted',
  'harness_stalled',
  'harness_tools_unavailable',
  'agent_failed',
  'context_guard',
]);

/** The last characters of an answer that asks something (a question mark before any closing). */
const ASKS = /\?[\s*_)\]»"”'’.!\p{Extended_Pictographic}]*$/u;

/**
 * The job `runId` as `agentId`'s turn: how it ended, what it asked, its level. Null when the
 * run left nothing of the agent's in the log.
 */
export function previousJob(log: EventLog, agentId: string, runId: string): PreviousJob | null {
  const ends = log.query({ runId, type: 'run', limit: 50 });
  const end = ends.find((e) => e.type === 'run' && e.data.status !== 'started');
  const cut =
    (end?.type === 'run' && (end.data.status === 'aborted' || end.data.status === 'failed')) ||
    log
      .query({ runId, type: 'error', agent: agentId, limit: 1000 })
      .some((e) => e.type === 'error' && CUT_CODES.has(e.data.code ?? ''));
  const answer = log
    .query({ runId, type: 'message', agent: agentId, order: 'desc', limit: 500 })
    .find(
      (e) =>
        e.type === 'message' &&
        e.data.role === 'agent' &&
        !e.data.partial &&
        e.parentId === null &&
        e.data.text.trim() !== '',
    );
  // The request's level: the first `tier` event of the run about this monster, not a delegation's.
  const tierEvent = log
    .query({ runId, type: 'instinct', agent: 'system', limit: 1000 })
    .find(
      (e) =>
        e.type === 'instinct' &&
        e.data.use === 'tier' &&
        e.data.subject === agentId &&
        e.parentId === null,
    );
  const level = tierEvent?.type === 'instinct' ? tierEvent.data.details?.['level'] : undefined;
  const tier = level === 'simple' || level === 'medium' || level === 'hard' ? level : undefined;
  const usage = log
    .query({ runId, type: 'provider_usage', agent: agentId, order: 'desc', limit: 50 })
    .find((e) => e.type === 'provider_usage' && e.data.context && e.data.purpose === undefined);
  const measured = usage?.type === 'provider_usage' ? usage.data.context : undefined;
  const last = end ?? answer ?? ends.at(-1) ?? usage;
  if (!last) return null;
  return {
    runId,
    cut,
    asked: answer?.type === 'message' && ASKS.test(answer.data.text.trim()),
    ...(tier ? { tier } : {}),
    endedAt: last.ts,
    ...(measured
      ? {
          context: {
            total: measured.total,
            ...(measured.window ? { window: measured.window } : {}),
          },
        }
      : {}),
  };
}

/**
 * The request continues `job`: a short message (no files) within a day of it, and either the
 * words ask to go on ("continua", "ok procedi", "finisci pure"), or the job was left open (cut
 * at a cap or stopped, or it ended asking the user) and the words do not close it ("grazie",
 * "lascia stare"). A long message is a new request: its own level, its own context.
 */
export function continuesJob(
  request: string,
  job: PreviousJob | null,
  options: { now: number; files?: number } = { now: Date.now() },
): boolean {
  if (!job || (options.files ?? 0) > 0) return false;
  const text = request.trim();
  if (!text || text.length > CONTINUATION_MAX_CHARS) return false;
  if (text.split(/\s+/).length > CONTINUATION_MAX_WORDS) return false;
  if (options.now - job.endedAt > CONTINUATION_WINDOW_MS) return false;
  if (GO_AHEAD.test(text) && !NEGATED.test(text)) return true;
  if (CLOSING.test(text) || NEGATED.test(text)) return false;
  return job.cut || job.asked;
}

/** The harness session a monster's last turn ran in. */
export interface JobSession {
  runId: string;
  harness: string;
  session: string;
  /** Where the harness worked: a session is found again only from the same folder. */
  cwd: string;
}

/**
 * The harness session of each monster's latest turn, in memory: a restart forgets it, and the
 * continuation then gets the notes of the job instead (`jobNotes`).
 */
export class JobSessions {
  readonly #byAgent = new Map<string, JobSession>();

  remember(agentId: string, session: JobSession): void {
    this.#byAgent.set(agentId, session);
  }

  /** The session of `runId`, when it was the monster's latest turn on this harness and folder. */
  of(agentId: string, runId: string, harness: string, cwd: string): string | undefined {
    const s = this.#byAgent.get(agentId);
    return s && s.runId === runId && s.harness === harness && s.cwd === cwd ? s.session : undefined;
  }

  forget(agentId: string): void {
    this.#byAgent.delete(agentId);
  }
}

/** The session is worth resuming: its last context still had room (the compaction mark, D-082). */
export function sessionHasRoom(job: PreviousJob, threshold: number): boolean {
  const c = job.context;
  return !c?.window || c.total <= c.window * threshold;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;

/** A value of the log as one line: escapes of nested JSON undone, spaces collapsed. */
function flat(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (
    value &&
    typeof value === 'object' &&
    (value as { truncated?: unknown }).truncated === true &&
    typeof (value as { preview?: unknown }).preview === 'string'
  ) {
    text = (value as { preview: string }).preview;
  } else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      text = String(value);
    }
  }
  for (let i = 0; i < 3 && /\\["n]/.test(text); i++) {
    text = text.replace(/\\+"/g, '"').replace(/\\+n/g, ' ');
  }
  // Images and other base64 come back as data: nothing a model reads in an excerpt.
  return text
    .replace(/[A-Za-z0-9+/=]{120,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tools that only load other tools (Claude Code's ToolSearch, D-169): no finding of the job. */
const PLUMBING: ReadonlySet<string> = new Set(['ToolSearch', 'tools_search']);

/** A tool's name as the model knows it: without the harness's prefix (`claude-agent.Bash`). */
function toolName(tool: string): string {
  const dot = tool.indexOf('.');
  return dot > 0 && !tool.startsWith('mcp__') ? tool.slice(dot + 1) : tool;
}

type Step =
  | { kind: 'said'; text: string }
  | { kind: 'call'; tool: string; input: string; ok: boolean | null; result: string };

/** Every event of a type in a run, oldest first (pages of the log). */
function allOf<T extends LogEvent['type']>(
  log: EventLog,
  runId: string,
  type: T[],
  pages = 5,
): LogEvent[] {
  const out: LogEvent[] = [];
  let after: string | undefined;
  for (let p = 0; p < pages; p++) {
    const page = log.query({ runId, type, after, limit: 1000 });
    out.push(...page);
    if (page.length < 1000) break;
    after = page.at(-1)!.id;
  }
  return out;
}

/**
 * The notes of a job for its continuation when its harness session cannot be resumed (another
 * harness, the API path, a restart, a session gone from the harness's disk): the request, how it
 * ended, and its steps from the log, oldest first: what the monster wrote while working, each
 * tool with its input and an excerpt of its result. Within `max` characters: the excerpts get
 * shorter first, then the steps in the middle go. As data inside a tag (third-party text).
 * Null when the job left no step.
 */
export function jobNotes(
  log: EventLog,
  agentId: string,
  runId: string,
  max = JOB_NOTES_MAX_CHARS,
): string | null {
  const p = continuationPrompts();
  const events = allOf(log, runId, ['message', 'tool_call', 'tool_result', 'error']);
  const request = events.find(
    (e) => e.type === 'message' && e.agent === 'user' && e.data.role === 'user',
  );
  const steps: Step[] = [];
  const calls = new Map<string, Extract<Step, { kind: 'call' }>>();
  const ended: string[] = [];
  for (const e of events) {
    if (e.agent !== agentId) continue;
    if (e.type === 'message' && e.data.role === 'agent' && e.data.text.trim()) {
      const text = flat(e.data.text);
      // The final answer often repeats the last words written while working.
      const last = steps.at(-1);
      if (last?.kind !== 'said' || last.text !== text) steps.push({ kind: 'said', text });
    } else if (e.type === 'tool_call') {
      if (PLUMBING.has(toolName(e.data.tool))) continue;
      const step: Extract<Step, { kind: 'call' }> = {
        kind: 'call',
        tool: toolName(e.data.tool),
        input: flat(e.data.input),
        ok: null,
        result: '',
      };
      calls.set(e.data.callId, step);
      steps.push(step);
    } else if (e.type === 'tool_result') {
      const step = calls.get(e.data.callId);
      if (!step) continue;
      step.ok = e.data.ok;
      step.result = flat(e.data.ok ? (e.data.output ?? '') : (e.data.error ?? e.data.output ?? ''));
    } else if (e.type === 'error' && CUT_CODES.has(e.data.code ?? '') && e.data.message) {
      ended.push(flat(e.data.message));
    }
  }
  if (steps.length === 0) return null;
  const line = (s: Step, room: number): string =>
    s.kind === 'said'
      ? p.said(clip(s.text, Math.max(room * 2, 200)))
      : p.call(
          s.tool,
          clip(s.input, 200),
          s.ok === false
            ? p.failed(clip(s.result, room))
            : s.result
              ? clip(s.result, room)
              : p.noResult,
        );
  const head = [
    p.head,
    ...(request?.type === 'message' ? [p.request(clip(flat(request.data.text), 600))] : []),
    ...(ended.length > 0 ? [p.ended(clip(ended.join(' '), 400))] : []),
    p.steps,
  ];
  const size = (lines: string[]) => lines.reduce((n, l) => n + l.length + 1, 0);
  const budget = Math.max(0, max - size(head) - 200);
  // Shorter excerpts first (down to 120 characters each), then the steps in the middle go.
  let room = 800;
  let lines = steps.map((s) => line(s, room));
  while (size(lines) > budget && room > 120) {
    room = Math.max(120, Math.floor(room * 0.75));
    lines = steps.map((s) => line(s, room));
  }
  if (size(lines) > budget) {
    let left = 0;
    // Keep the first steps (what was read at the start) and as many of the latest as fit.
    const firstKeep = Math.min(3, lines.length);
    const kept = lines.slice(0, firstKeep);
    const tail: string[] = [];
    for (let i = lines.length - 1; i >= firstKeep; i--) {
      if (size([...kept, ...tail, lines[i]!]) + 60 > budget) {
        left = i - firstKeep + 1;
        break;
      }
      tail.unshift(lines[i]!);
    }
    lines = [...kept, ...(left > 0 ? [p.skipped(left)] : []), ...tail];
  }
  return wrapNotes([...head, ...lines].join('\n'));
}

const TAG_PATTERN = new RegExp(`</?\\s*(?:${PREVIOUS_JOB_TAGS.join('|')})`, 'gi');

/** The notes as data: inside their tag, a closing tag of either family neutralised. */
function wrapNotes(body: string): string {
  const p = continuationPrompts();
  return `<${p.tag} ${p.attr}="${p.note}">\n${body.replace(TAG_PATTERN, p.neutralised)}\n</${p.tag}>`;
}
