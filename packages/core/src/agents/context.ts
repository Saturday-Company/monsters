import { defineTool, ToolError, type MonstersTool } from '@monsters/shared';
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import { runtimePrompts } from './runtime.prompts.ts';
import { EXTERNAL_DATA_TAG } from './tool-adapter.ts';

/*
 * Bounded run context (C.2 of the plan of 16/10, D-075): tool results pile up
 * step after step (web pages, notes, lists of another program). Measured
 * practice (JetBrains, NeurIPS 2025) is to mask old observations rather than
 * summarise them, and to keep long results out of the context with a reference
 * to read them again:
 *
 * - **offload**: a result longer than `offloadChars` reaches the model as its
 *   first `offloadHead` characters and a note; the whole text stays in the
 *   run's store (memory only: it dies with the run, no copy of private data on
 *   disk) and `result_read` pages through it;
 * - **masking**: results older than the last `recentSteps` tool steps become
 *   one line ("[risultato tolto dal contesto … result_read r12]"). The boundary
 *   moves `maskChunk` steps at a time, so between moves the prefix of the
 *   conversation stays the same and the providers' prompt cache holds; the
 *   recent results also share a budget in characters, and past it the oldest
 *   are masked until half the budget is free (fewer, larger changes);
 * - what is masked stays masked: the set only grows within a run.
 *
 * Applied before every step through `prepareStep`, by tool call id, so the
 * same messages always give the same text (deterministic and idempotent).
 */

export interface ContextLimits {
  /**
   * Characters of the recent tool results kept in the context, newest first;
   * past it the oldest are masked. The last step's results always stay.
   * Default 24 000.
   */
  recentToolResultChars?: number;
  /** Tool steps kept whole before masking starts. Default 4. */
  recentSteps?: number;
  /** The masking boundary moves this many tool steps at a time. Default 4. */
  maskChunk?: number;
  /** A result longer than this is shown cut, the rest in the store. Default 8000. */
  offloadChars?: number;
  /** Characters of an offloaded result shown to the model. Default 6000. */
  offloadHead?: number;
  /** Results shorter than this are never masked: the line would be as long. Default 400. */
  minMaskChars?: number;
  /** Most characters `result_read` gives at once (below `offloadChars`). Default 7000. */
  readChars?: number;
  /** Reads of one stored result, at most: past them the model filters or goes on. Default 8. */
  readsPerResult?: number;
}

export const DEFAULT_CONTEXT_LIMITS: Required<ContextLimits> = {
  recentToolResultChars: 24_000,
  recentSteps: 4,
  maskChunk: 4,
  offloadChars: 8000,
  offloadHead: 6000,
  minMaskChars: 400,
  readChars: 7000,
  readsPerResult: 8,
};

/**
 * Limits for a model's window (D-163): a model with a big window reads a long list in a few
 * pieces, not in fifty (Haiku paged a list of 40 clients with 50 `result_read` on 23/10).
 * The defaults stay for small windows and when the window is not known.
 */
export function contextLimitsFor(window: number | undefined): ContextLimits {
  if (!window || window < 120_000) return {};
  if (window < 400_000) {
    return {
      offloadChars: 16_000,
      offloadHead: 12_000,
      readChars: 12_000,
      recentToolResultChars: 48_000,
    };
  }
  return {
    offloadChars: 32_000,
    offloadHead: 24_000,
    readChars: 24_000,
    recentToolResultChars: 96_000,
  };
}

/** The tool that reads a stored result again. */
export const RESULT_READ = 'result_read';
/** Most characters `result_read` gives at once by default (below `offloadChars`: never offloaded again). */
export const RESULT_READ_MAX = 7000;
/** Most characters the store of one run keeps; past it the oldest results go. */
const STORE_MAX_CHARS = 20_000_000;

type ToolMessage = Extract<ModelMessage, { role: 'tool' }>;
type ToolPart = ToolMessage['content'][number];
type ResultPart = Extract<ToolPart, { type: 'tool-result' }>;
type Output = ResultPart['output'];

function outputText(output: Output): string | null {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    default:
      return null;
  }
}

/**
 * `<dati_esterni fonte="…">\n` body `\n</dati_esterni>` and what follows it
 * (Monsters' notices). The body never holds a raw closing tag (escaped by
 * `wrapExternalData`), so the first one closes it and any slice of the body is
 * safe inside a new envelope.
 */
const ENVELOPE = new RegExp(
  `^(<${EXTERNAL_DATA_TAG}[^>]*>\\n)([\\s\\S]*?)(\\n</${EXTERNAL_DATA_TAG}>)([\\s\\S]*)$`,
);

interface Stored {
  ref: string;
  tool: string;
  /** Whole text as the model first got it. */
  text: string;
  /** For third-party data: the envelope around the body, kept on every slice. */
  open?: string;
  body?: string;
  close?: string;
  after?: string;
  error: boolean;
}

function parse(ref: string, tool: string, text: string, error: boolean): Stored {
  const m = ENVELOPE.exec(text);
  if (!m) return { ref, tool, text, error };
  const [, open, body, close, after] = m as unknown as [string, string, string, string, string];
  return { ref, tool, text, open, body, close, after, error };
}

const fmt = (n: number) => String(n);

/** The results of one run of an agent, by reference (`r1`, `r2`…), in memory. */
export class ResultStore {
  readonly #byRef = new Map<string, Stored>();
  /** Reads of each result so far. */
  readonly #reads = new Map<string, number>();
  readonly #readChars: number;
  readonly #readsPerResult: number;
  #chars = 0;

  constructor(readChars = RESULT_READ_MAX, readsPerResult = DEFAULT_CONTEXT_LIMITS.readsPerResult) {
    this.#readChars = readChars;
    this.#readsPerResult = readsPerResult;
  }

  put(entry: Stored): void {
    this.#byRef.set(entry.ref, entry);
    this.#chars += entry.text.length;
    for (const [ref, old] of this.#byRef) {
      if (this.#chars <= STORE_MAX_CHARS || ref === entry.ref) break;
      this.#byRef.delete(ref);
      this.#chars -= old.text.length;
    }
  }

  get(ref: string): Stored | undefined {
    return this.#byRef.get(ref);
  }

  /** A slice of a stored result, inside its envelope when it had one. */
  read(ref: string, offset: number, length: number): string {
    const s = this.#byRef.get(ref);
    if (!s) {
      throw new ToolError('NOT_FOUND', `no stored result "${ref}" in this task`, {
        hint: 'Use the ref written in the note of the result (r1, r2…), or call the tool again.',
      });
    }
    // Past the reads of one result, a hint instead of the next page (D-163): a list read in
    // pieces again and again costs the whole list at every step.
    const reads = (this.#reads.get(ref) ?? 0) + 1;
    if (reads > this.#readsPerResult) {
      throw new ToolError('LIMIT_REACHED', runtimePrompts().readsOver(ref, this.#readsPerResult), {
        hint: runtimePrompts().readsOverHint(s.tool),
      });
    }
    this.#reads.set(ref, reads);
    const body = s.body ?? s.text;
    const start = Math.min(Math.max(0, offset), body.length);
    const end = Math.min(body.length, start + Math.min(length, this.#readChars));
    const slice = body.slice(start, end);
    const where = runtimePrompts().readRange(
      fmt(start),
      fmt(end),
      fmt(body.length),
      end < body.length ? end : null,
    );
    const note = `[Monsters] ${ref} (${s.tool}): ${where}.`;
    return s.open !== undefined ? `${s.open}${slice}${s.close}\n${note}` : `${slice}\n${note}`;
  }
}

/** The text of an offloaded result: its head, in its envelope, and where the rest is. */
function offloaded(s: Stored, head: number, filters: readonly string[]): string {
  const body = s.body ?? s.text;
  const shown = body.slice(0, head);
  const note =
    runtimePrompts().offloadedNote(fmt(body.length), fmt(shown.length), s.ref, shown.length) +
    (filters.length > 0 ? ` ${runtimePrompts().filtersHint(s.tool, filters.join(', '))}` : '');
  return s.open !== undefined
    ? `${s.open}${shown}${s.close}${s.after ?? ''}\n${note}`
    : `${shown}\n${note}`;
}

/** The one line of a masked result. */
function masked(s: Stored): string {
  return runtimePrompts().maskedNote(s.tool, fmt(s.text.length), s.ref);
}

/**
 * The context of one agent's run: what was stored, what is masked. One per
 * `runAgent` call; `compact` before every step, `tool` for the agent.
 */
export class RunContext {
  readonly store: ResultStore;
  readonly #limits: Required<ContextLimits>;
  /** The filters a tool takes (its optional arguments), named in the note of a long result. */
  readonly #filtersOf: (tool: string) => readonly string[];
  /** Tool call id → stored result. */
  readonly #seen = new Map<string, Stored>();
  readonly #masked = new Set<string>();
  #next = 1;

  constructor(
    limits: ContextLimits = {},
    filtersOf: (tool: string) => readonly string[] = () => [],
  ) {
    this.#limits = { ...DEFAULT_CONTEXT_LIMITS, ...limits };
    this.#limits.readChars = Math.min(this.#limits.readChars, this.#limits.offloadChars - 1);
    this.store = new ResultStore(this.#limits.readChars, this.#limits.readsPerResult);
    this.#filtersOf = filtersOf;
  }

  /** Ids of the masked results so far (for tests and measures). */
  get maskedCount(): number {
    return this.#masked.size;
  }

  #remember(part: ResultPart): Stored | undefined {
    const known = this.#seen.get(part.toolCallId);
    if (known) return known;
    const text = outputText(part.output);
    if (text === null) return undefined;
    const error = part.output.type === 'error-text' || part.output.type === 'error-json';
    const entry = parse(`r${this.#next++}`, part.toolName, text, error);
    this.#seen.set(part.toolCallId, entry);
    this.store.put(entry);
    return entry;
  }

  /** What the model reads of a stored result now. */
  #shown(s: Stored, id: string): string {
    const l = this.#limits;
    if (this.#masked.has(id) && s.text.length >= l.minMaskChars) return masked(s);
    // A slice read with result_read is already short: never offloaded again.
    if (s.text.length > l.offloadChars && s.tool !== RESULT_READ)
      return offloaded(s, l.offloadHead, this.#filtersOf(s.tool));
    return s.text;
  }

  /**
   * Returns `messages` with the tool results offloaded and masked, or the same
   * array when nothing changed.
   */
  compact(messages: ModelMessage[]): ModelMessage[] {
    const l = this.#limits;
    const toolIdx: number[] = [];
    messages.forEach((m, i) => {
      if (m.role === 'tool') toolIdx.push(i);
    });
    if (toolIdx.length === 0) return messages;
    const steps = toolIdx.map((i) =>
      (messages[i] as ToolMessage).content.flatMap((part) => {
        if (part.type !== 'tool-result') return [];
        const s = this.#remember(part);
        return s ? [{ id: part.toolCallId, s }] : [];
      }),
    );
    // The boundary in chunks: steps before it are masked.
    const boundary = Math.max(
      0,
      Math.floor((steps.length - l.recentSteps) / l.maskChunk) * l.maskChunk,
    );
    for (const step of steps.slice(0, boundary)) for (const r of step) this.#masked.add(r.id);
    // The budget of the recent results, newest first; the last step always stays.
    const visible = (r: { id: string; s: Stored }) =>
      this.#masked.has(r.id) ? 0 : this.#shown(r.s, r.id).length;
    const recent = steps.slice(boundary, -1).flat();
    const last = steps.at(-1)!.reduce((n, r) => n + visible(r), 0);
    let used = last + recent.reduce((n, r) => n + visible(r), 0);
    if (used > l.recentToolResultChars) {
      // Oldest first, until half the budget is free: one change now, not one per step.
      for (const r of recent) {
        if (used <= l.recentToolResultChars / 2) break;
        if (this.#masked.has(r.id) || r.s.text.length < l.minMaskChars) continue;
        used -= visible(r);
        this.#masked.add(r.id);
      }
    }
    let changed = false;
    const out = messages.map((m) => {
      if (m.role !== 'tool') return m;
      let touched = false;
      const content = m.content.map((part) => {
        if (part.type !== 'tool-result') return part;
        const s = this.#seen.get(part.toolCallId);
        if (!s) return part;
        const value = this.#shown(s, part.toolCallId);
        if (outputText(part.output) === value) return part;
        touched = true;
        const output: Output = s.error ? { type: 'error-text', value } : { type: 'text', value };
        return { ...part, output };
      });
      if (!touched) return m;
      changed = true;
      return { ...m, content };
    });
    return changed ? out : messages;
  }

  /**
   * The guard of the window (D-082): every result except those of the last
   * `keepSteps` tool steps is masked from now on (the next `compact` shows it).
   * True when something new was masked.
   */
  squeeze(messages: readonly ModelMessage[], keepSteps: number): boolean {
    const tools = messages.filter((m): m is ToolMessage => m.role === 'tool');
    let changed = false;
    for (const m of tools.slice(0, Math.max(0, tools.length - keepSteps))) {
      for (const part of m.content) {
        if (part.type !== 'tool-result') continue;
        const s = this.#remember(part);
        if (!s || s.text.length < this.#limits.minMaskChars || this.#masked.has(part.toolCallId))
          continue;
        this.#masked.add(part.toolCallId);
        changed = true;
      }
    }
    return changed;
  }

  /** What the progress message says of a result (D-082): its size and ref, or its start. */
  resultLine(callId: string): string | null {
    const s = this.#seen.get(callId);
    if (!s) return null;
    const kind = s.error ? runtimePrompts().resultErrorKind : '';
    if (s.text.length < this.#limits.minMaskChars) {
      return `${kind}${s.text.replace(/\s+/g, ' ').trim().slice(0, 200)}`;
    }
    return `${kind}${runtimePrompts().resultSize(fmt(s.text.length), s.ref)}`;
  }

  /** `result_read`: pages through a result that was shortened or masked. */
  tool(): MonstersTool<{ ref: string; offset: number; length: number }, string> {
    return defineTool({
      name: RESULT_READ,
      description:
        'Reads again a tool result that was shortened or taken out of the context: its note gives the ref (r1, r2…). ' +
        `Returns up to ${this.#limits.readChars} characters from offset; read on with the offset the note gives.`,
      inputSchema: z.object({
        ref: z.string().regex(/^r\d{1,6}$/),
        offset: z.number().int().min(0).default(0),
        length: z
          .number()
          .int()
          .min(200)
          .max(this.#limits.readChars)
          .default(this.#limits.readChars),
      }),
      readOnly: true,
      // A rejected promise, not a throw: an unknown ref is a result the model reads.
      execute: ({ ref, offset, length }) =>
        new Promise((resolve) => resolve(this.store.read(ref, offset, length))),
    });
  }
}

/**
 * One pass of the masking over `messages` with fresh state (tests and tools
 * that do not keep a run): the same rules as `RunContext.compact`.
 */
export function compactToolResults(
  messages: ModelMessage[],
  limits: ContextLimits = {},
): ModelMessage[] {
  return new RunContext(limits).compact(messages);
}
