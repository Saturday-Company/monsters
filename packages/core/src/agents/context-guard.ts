import { runtimePrompts } from './runtime.prompts.ts';

/*
 * The guard of the window inside a run (C.3 of the plan of 16/10, D-082).
 * Before every step of our loop the context is estimated (the characters of
 * D-076, calibrated on the input the provider reported for the step before);
 * past the window minus the room for the answer it shrinks in two levels that
 * stay for the rest of the run:
 *
 * 1. **mask harder**: every tool result except those of the last
 *    `KEEP_TOOL_STEPS` steps becomes its one line (`RunContext.squeeze`);
 * 2. **fold the steps**: the monster's own earlier steps of this turn (its
 *    calls and their results) become one "progress so far" message, written
 *    from the calls themselves, no model: each call in a line with its outcome
 *    and the `result_read` ref to read the result again.
 *
 * A provider that still refuses the request as too long gets the same fold
 * once, on the prompt as sent (`ModelSession.setContextRescue`), and the same
 * model is asked again before the chain moves on.
 *
 * The functions here work on the AI SDK's messages and on the provider prompt
 * alike: both have `role` and parts with `toolCallId`.
 */

/** Room kept for the answer when the agent sets no `maxOutputTokens`. */
export const OUTPUT_RESERVE_TOKENS = 4096;
/** Tool steps whose results stay whole when the guard acts. */
export const KEEP_TOOL_STEPS = 2;
/** Tool steps folded at once, past the kept ones: the progress changes now and then, not every step. */
export const FOLD_CHUNK = 3;
/** Longest "progress so far" message, in characters. */
const PROGRESS_MAX_CHARS = 4000;

/** Most room kept for an answer on a large window. */
const OUTPUT_RESERVE_MAX = 16_384;

/**
 * The room for the answer on a model with this window: the agent's
 * `maxOutputTokens`, else an eighth of the window between 4096 and 16 384. It
 * is also sent as the request's `maxOutputTokens` (review of D-082): without
 * it a provider may ask for its own maximum and pass the window anyway.
 */
export function outputReserve(window: number, maxOutputTokens?: number): number {
  if (maxOutputTokens !== undefined) return maxOutputTokens;
  return Math.min(OUTPUT_RESERVE_MAX, Math.max(OUTPUT_RESERVE_TOKENS, Math.round(window / 8)));
}

/**
 * Tokens a request may hold on a model with this window: the window minus the
 * answer (`outputReserve`) and a margin for the error of the estimate (3%, at
 * least 1024).
 */
export function contextLimit(window: number, maxOutputTokens?: number): number {
  const margin = Math.max(1024, Math.round(window * 0.03));
  return Math.max(0, window - outputReserve(window, maxOutputTokens) - margin);
}

interface AnyPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
}

interface AnyMessage {
  role: string;
  content: unknown;
}

function partsOf(m: AnyMessage): AnyPart[] {
  return Array.isArray(m.content) ? (m.content as AnyPart[]) : [];
}

const hasToolCall = (m: AnyMessage) =>
  m.role === 'assistant' && partsOf(m).some((p) => p.type === 'tool-call');

/** Indexes of the tool messages (one per step that called tools). */
export function toolStepIndexes(messages: readonly AnyMessage[]): number[] {
  const out: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'tool') out.push(i);
  });
  return out;
}

function short(value: unknown, max: number): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  } catch {
    text = String(value);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function outputText(output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const o = output as { type?: string; value?: unknown };
  if (o.type === 'text' || o.type === 'error-text')
    return typeof o.value === 'string' ? o.value : '';
  if (o.type === 'json' || o.type === 'error-json') return short(o.value, 400);
  return '';
}

/** What the progress message says of a result (its ref when it is stored); null: its start. */
export type ResultLine = (callId: string, toolName: string, output: unknown) => string | null;

const defaultLine = (output: unknown): string => {
  const text = outputText(output);
  if (!text) return runtimePrompts().done;
  const isError =
    !!output &&
    typeof output === 'object' &&
    String((output as { type?: string }).type).startsWith('error');
  return `${isError ? runtimePrompts().errorPrefix : ''}${short(text, 120)}`;
};

/** The "progress so far" text of the folded messages. */
export function progressText(folded: readonly AnyMessage[], line?: ResultLine): string {
  const results = new Map<string, AnyPart>();
  for (const m of folded) {
    if (m.role !== 'tool') continue;
    for (const p of partsOf(m))
      if (p.type === 'tool-result' && p.toolCallId) results.set(p.toolCallId, p);
  }
  const lines: string[] = [];
  for (const m of folded) {
    if (m.role !== 'assistant') continue;
    const content =
      typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : partsOf(m);
    for (const p of content) {
      if (p.type === 'text' && p.text?.trim())
        lines.push(runtimePrompts().youWrote(short(p.text, 240)));
      if (p.type !== 'tool-call') continue;
      const r = p.toolCallId ? results.get(p.toolCallId) : undefined;
      const outcome = r
        ? (line?.(p.toolCallId!, p.toolName ?? '', r.output) ?? defaultLine(r.output))
        : runtimePrompts().noResult;
      lines.push(`- ${p.toolName ?? '?'} ${short(p.input, 140)} → ${outcome}`);
    }
  }
  const head = runtimePrompts().progressHead;
  let body = lines;
  let dropped = 0;
  while (body.length > 1 && head.length + body.join('\n').length > PROGRESS_MAX_CHARS) {
    body = body.slice(1);
    dropped++;
  }
  const more = dropped > 0 ? [runtimePrompts().olderStepsDropped(dropped)] : [];
  return [head, ...more, ...body].join('\n');
}

/**
 * The messages with the steps before the last `keep` tool steps folded into
 * one user message (placed where the first of them was), or the same array
 * when there is nothing to fold.
 */
export function foldSteps<M extends AnyMessage>(
  messages: readonly M[],
  options: {
    keep?: number;
    line?: ResultLine;
    make: (text: string) => M;
  },
): M[] {
  const tools = toolStepIndexes(messages);
  const count = tools.length - (options.keep ?? KEEP_TOOL_STEPS);
  if (count <= 0 || count > tools.length) return messages as M[];
  // The first kept tool step and the assistant message with its calls stay.
  let boundary = tools[count] ?? messages.length;
  if (count < tools.length) {
    for (let i = boundary - 1; i >= 0; i--) {
      if (hasToolCall(messages[i]!)) {
        boundary = i;
        break;
      }
    }
  }
  const folded: M[] = [];
  let at = -1;
  const out: M[] = [];
  messages.forEach((m, i) => {
    const fold = i < boundary && (m.role === 'tool' || hasToolCall(m));
    if (!fold) {
      out.push(m);
      return;
    }
    if (at < 0) at = out.length;
    folded.push(m);
  });
  if (folded.length === 0) return messages as M[];
  out.splice(at, 0, options.make(progressText(folded, options.line)));
  return out;
}

/** Level of the guard: what stays shrunk for the rest of the run. */
export type GuardLevel = 0 | 1 | 2;

/**
 * The guard's state for one run: the level reached. Monotonic: once the
 * window was near, it stays careful. The AI SDK carries the messages a step
 * was sent with into the next one, so a fold stays where it is: at level 2 the
 * tool steps past the kept ones are folded again `FOLD_CHUNK` at a time, into
 * a new progress message after the older ones (the prefix does not change).
 */
export class ContextGuard {
  #level: GuardLevel = 0;
  /** The level was just raised: the next `apply` folds at once. */
  #pending = false;
  /** Real input over estimated input at the latest step (D-076 calibration). */
  #ratio = 1;

  get level(): GuardLevel {
    return this.#level;
  }

  raise(level: GuardLevel): void {
    if (level <= this.#level) return;
    this.#level = level;
    if (level === 2) this.#pending = true;
  }

  /** The input the provider reported for a step whose estimate was `estimated`. */
  calibrate(estimated: number, reported: number | undefined): void {
    if (!reported || estimated <= 0) return;
    this.#ratio = Math.min(2.5, Math.max(0.6, reported / estimated));
  }

  /** An estimate of characters, scaled like the step before. */
  calibrated(estimate: number): number {
    return Math.ceil(estimate * this.#ratio);
  }

  /** At level 2: the earlier tool steps folded, all but the last `KEEP_TOOL_STEPS`. */
  apply<M extends AnyMessage>(
    messages: readonly M[],
    make: (text: string) => M,
    line?: ResultLine,
  ): M[] {
    if (this.#level < 2) return messages as M[];
    const steps = toolStepIndexes(messages).length;
    if (!this.#pending && steps <= KEEP_TOOL_STEPS + FOLD_CHUNK) return messages as M[];
    this.#pending = false;
    return foldSteps(messages, { keep: KEEP_TOOL_STEPS, make, ...(line ? { line } : {}) });
  }
}
