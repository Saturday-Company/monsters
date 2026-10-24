import {
  CONTEXT_PARTS,
  type ContextParts,
  type ContextUsage,
  type MonstersTool,
} from '@monsters/shared';
import type { ModelMessage, ToolSet } from 'ai';
import { z } from 'zod';

/*
 * The context of every step, part by part (C.1 of the plan of 16/10, D-075).
 * No tokenizer: each part is estimated from its characters (prose and JSON at
 * different rates), then the estimate is scaled to the input the provider
 * reports for that step, cache reads and writes included, so the parts add up
 * to the real total and the proportions are the only estimate. Nothing here
 * goes into the prompt: the system prompt and the tools stay as they are, and
 * the cache with them.
 */

/** Characters per token of prose (Italian and English, the tokenizers we meet). */
const PROSE_CHARS = 3.6;
/** Characters per token of JSON (schemas, tool arguments and results). */
const JSON_CHARS = 3.1;
/** Framing of a message (role, separators) in the chat templates. */
const MESSAGE_OVERHEAD = 4;
/** An image or a file part: a flat guess, the scaling does the rest. */
const MEDIA_TOKENS = 800;

export function estimateTokens(text: string, charsPerToken = PROSE_CHARS): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / charsPerToken);
}

function json(value: unknown): string {
  try {
    return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  } catch {
    return '';
  }
}

/** Tokens of each tool definition as the model gets it: name, description, JSON schema. */
export function toolTokensByName(tools: ToolSet): Map<string, number> {
  const out = new Map<string, number>();
  for (const [name, t] of Object.entries(tools)) {
    const schema = (t as { inputSchema?: { jsonSchema?: unknown } }).inputSchema?.jsonSchema;
    const shown =
      schema && typeof (schema as { then?: unknown }).then !== 'function' ? json(schema) : '';
    out.set(
      name,
      estimateTokens(name) +
        estimateTokens(typeof t.description === 'string' ? t.description : '') +
        estimateTokens(shown, JSON_CHARS) +
        MESSAGE_OVERHEAD,
    );
  }
  return out;
}

/** Tokens of the tool definitions as the model gets them. */
export function toolDefinitionTokens(tools: ToolSet): number {
  let total = 0;
  for (const n of toolTokensByName(tools).values()) total += n;
  return total;
}

type Part = Exclude<ModelMessage['content'], string>[number];

function partTokens(part: Part): { tokens: number; result: boolean } {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return { tokens: estimateTokens(part.text), result: false };
    case 'tool-call':
      return {
        tokens: estimateTokens(part.toolName) + estimateTokens(json(part.input), JSON_CHARS),
        result: false,
      };
    case 'tool-result': {
      const o = part.output as { type: string; value?: unknown };
      const text = typeof o.value === 'string' ? o.value : json(o.value);
      return { tokens: estimateTokens(text, JSON_CHARS), result: true };
    }
    case 'image':
    case 'file':
      return { tokens: MEDIA_TOKENS, result: false };
    default:
      return { tokens: estimateTokens(json(part)), result: false };
  }
}

/**
 * Splits the messages of a step: the earlier turns (`history` first messages)
 * and the monster's own steps of this turn are the conversation, the tools'
 * results their own part, the user's messages of this turn (the task, the
 * brief, what arrived while it worked, the system's reminders) the current one.
 */
export function messageParts(
  messages: readonly ModelMessage[],
  historyLength: number,
): Pick<ContextParts, 'conversation' | 'tool_results' | 'current'> {
  let conversation = 0;
  let results = 0;
  let current = 0;
  messages.forEach((m, i) => {
    const add = (tokens: number, result: boolean) => {
      if (result) results += tokens;
      else if (i < historyLength || m.role === 'assistant') conversation += tokens;
      else current += tokens;
    };
    add(MESSAGE_OVERHEAD, m.role === 'tool');
    if (typeof m.content === 'string') {
      add(estimateTokens(m.content), false);
      return;
    }
    for (const part of m.content as Part[]) {
      const { tokens, result } = partTokens(part);
      add(tokens, result || m.role === 'tool');
    }
  });
  return { conversation, tool_results: results, current };
}

/** "## Profilo dell'utente\n…": the size of a section of the system prompt. */
function sectionTokens(text: string | undefined): number {
  const t = text?.trim();
  return t ? estimateTokens(t) + 8 : 0;
}

export interface ContextMeterOptions {
  /** The system prompt as sent. */
  system: string;
  /** The parts of it that are the monster's memory and the user's profile. */
  memory?: string | undefined;
  profile?: string | undefined;
  tools: ToolSet;
  /** How many of the first messages are the earlier turns. */
  historyLength: number;
  /** The summary of the older turns at the start of them (C.3, D-082): its own part. */
  summary?: string | undefined;
}

/**
 * Estimates for the steps of one turn: the system prompt and the tools are
 * measured once (they do not change between steps), the messages every time.
 */
export function createContextMeter(o: ContextMeterOptions): {
  /** `tools`: all of them, none, or the names sent at this step (deferred loading, C.2). */
  measure(messages: readonly ModelMessage[], tools: boolean | readonly string[]): ContextParts;
} {
  const memory = sectionTokens(o.memory) + sectionTokens(o.profile);
  const instructions = Math.max(0, estimateTokens(o.system) - memory);
  const byName = toolTokensByName(o.tools);
  let all = 0;
  for (const n of byName.values()) all += n;
  const toolTokens = (tools: boolean | readonly string[]) =>
    tools === true
      ? all
      : tools === false
        ? 0
        : tools.reduce((n, name) => n + (byName.get(name) ?? 0), 0);
  const summary = o.summary?.trim() && o.historyLength > 0 ? estimateTokens(o.summary) + 8 : 0;
  return {
    measure: (messages, tools) => {
      const m = messageParts(messages, o.historyLength);
      const moved = Math.min(summary, m.conversation ?? 0);
      return {
        instructions,
        memory,
        tools: toolTokens(tools),
        ...(moved > 0 ? { summary: moved } : {}),
        ...m,
        conversation: (m.conversation ?? 0) - moved,
      };
    },
  };
}

/**
 * Integer parts proportional to `estimate` that add up to `total` exactly
 * (largest remainder). An estimate of zero spreads nothing: all goes to the
 * conversation, the only part every step has.
 */
export function scaleParts(estimate: ContextParts, total: number): ContextParts {
  const keys = CONTEXT_PARTS.filter((k) => (estimate[k] ?? 0) > 0);
  const sum = keys.reduce((n, k) => n + (estimate[k] ?? 0), 0);
  if (total <= 0) return {};
  if (sum === 0) return { conversation: total };
  const exact = keys.map((k) => ({ k, v: ((estimate[k] ?? 0) * total) / sum }));
  const out: ContextParts = {};
  let used = 0;
  for (const { k, v } of exact) {
    out[k] = Math.floor(v);
    used += out[k];
  }
  const order = [...exact].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)));
  for (let i = 0; used < total; i++, used++) {
    const k = order[i % order.length]!.k;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * The `context` of a step's `provider_usage`: the estimate scaled to the input
 * the provider reported (the AI SDK's `inputTokens` already holds the cache
 * reads and writes), or the estimate alone when it reported none.
 */
export function stepContext(
  estimate: ContextParts | null,
  reportedInput: number | undefined,
  window: number | undefined,
): ContextUsage | undefined {
  if (!estimate) return undefined;
  const measured = reportedInput !== undefined && reportedInput > 0;
  const total = measured
    ? reportedInput
    : CONTEXT_PARTS.reduce((n, k) => n + (estimate[k] ?? 0), 0);
  if (total <= 0) return undefined;
  return {
    total,
    ...(window ? { window } : {}),
    parts: measured ? scaleParts(estimate, total) : dropZeros(estimate),
    source: measured ? 'measured' : 'estimated',
  };
}

function dropZeros(parts: ContextParts): ContextParts {
  const out: ContextParts = {};
  for (const k of CONTEXT_PARTS) if ((parts[k] ?? 0) > 0) out[k] = parts[k]!;
  return out;
}

/**
 * A harness step (Claude Code, Codex): only the total is known. Our parts are
 * estimated from what we give it (AGENTS.md and the appended instructions,
 * Monsters' MCP tools, the task); what the first step holds beyond them is the
 * harness's own prompt and tools (`base`, ~22k tokens on Claude Code), the
 * same at every step of the run; what later steps add beyond the first is the
 * work of the turn (tool calls and their results).
 *
 * A resumed session (`task.resume`, D-079) starts with its earlier turns: the
 * first step's excess over our parts is the harness's base (as known from an
 * earlier run, else `HARNESS_BASE_TOKENS`) and, beyond it, the conversation.
 */
export class HarnessContextMeter {
  readonly #ours: ContextParts;
  readonly #oursTotal: number;
  readonly #resumed: { base: number } | null;
  #base: number | null = null;
  /** Earlier turns of a resumed session, fixed at the first step. */
  #history = 0;

  constructor(ours: ContextParts, options: { resumed?: { base: number } } = {}) {
    this.#ours = dropZeros(ours);
    this.#oursTotal = CONTEXT_PARTS.reduce((n, k) => n + (this.#ours[k] ?? 0), 0);
    this.#resumed = options.resumed ?? null;
  }

  measure(total: number, window: number | undefined): ContextUsage | undefined {
    if (total <= 0) return undefined;
    let ours = this.#ours;
    let oursTotal = this.#oursTotal;
    if (oursTotal > total) {
      // The estimate is above the real count: ours is all there is.
      ours = scaleParts(ours, total);
      oursTotal = total;
    }
    if (this.#base === null) {
      const excess = total - oursTotal;
      this.#base = this.#resumed ? Math.min(this.#resumed.base, excess) : excess;
      this.#history = excess - this.#base;
    }
    const base = Math.min(this.#base, total - oursTotal);
    const history = Math.min(this.#history, total - oursTotal - base);
    const work = total - oursTotal - base - history;
    const parts: ContextParts = { ...ours };
    if (base > 0) parts.base = base;
    if (history > 0) parts.conversation = (parts.conversation ?? 0) + history;
    if (work > 0) parts.tool_results = (parts.tool_results ?? 0) + work;
    return { total, ...(window ? { window } : {}), parts: dropZeros(parts), source: 'measured' };
  }
}

/**
 * The harness's own prompt and built-in tools when no earlier run measured it (D-076: ~22k tokens
 * on Claude Code 2.1.301); unknown harnesses count none. An estimate: a run measures it itself as
 * what its first request holds beyond our parts (`HarnessContextMeter`), so it also takes in what
 * the harness adds around Monsters' tools (the deferred list and ToolSearch, D-166).
 */
export const HARNESS_BASE_TOKENS: Readonly<Record<string, number>> = { 'claude-agent': 22_000 };

/**
 * Tokens of Monsters' tools as a harness sees them over MCP (`mcp__<server>__<name>`). With
 * `loaded`, only those tools count at schema size (name, description, input schema): the others
 * are deferred, Claude Code lists their names and loads a schema when the model asks for it
 * through ToolSearch (D-166), so they count at name size. Without `loaded` every tool is sent whole
 * (Codex, which gets the schemas of the tools it exposes).
 */
export function mcpToolTokens(
  tools: readonly Pick<MonstersTool, 'name' | 'description' | 'inputSchema' | 'inputJsonSchema'>[],
  server: string,
  loaded?: ReadonlySet<string>,
): number {
  let total = 0;
  for (const t of tools) {
    if (loaded && !loaded.has(t.name)) {
      // A line of the deferred list: the name and the break.
      total += estimateTokens(`mcp__${server}__${t.name}`) + 1;
      continue;
    }
    let schema: unknown = t.inputJsonSchema;
    if (schema === undefined) {
      try {
        schema = z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' });
      } catch {
        schema = {};
      }
    }
    total +=
      estimateTokens(`mcp__${server}__${t.name}`) +
      estimateTokens(t.description) +
      estimateTokens(json(schema), JSON_CHARS) +
      MESSAGE_OVERHEAD;
  }
  return total;
}

/** Our parts of a harness's prompt (see `HarnessContextMeter`). */
export function harnessParts(o: {
  agentsMd: string;
  /** The appended prompt: AGENTS.md (when in it), memory, profile, rules; not the conversation. */
  instructions: string;
  memory?: string | undefined;
  profile?: string | undefined;
  /** The conversation, which goes in the message of the turn before the new request. */
  history: string;
  /** The part of `history` that is the summary of the older turns (D-082). */
  summary?: string | undefined;
  tools: number;
  /** The new request alone (task, hint, attached files): the conversation is `history`. */
  prompt: string;
}): ContextParts {
  const memory = sectionTokens(o.memory) + sectionTokens(o.profile);
  const all = o.history ? estimateTokens(o.history) + 8 : 0;
  const summary = o.summary ? Math.min(all, estimateTokens(o.summary)) : 0;
  const appended = estimateTokens(o.instructions);
  return {
    // The conversation is in the turn's message, not in the appended prompt (D-166).
    instructions: estimateTokens(o.agentsMd) + Math.max(0, appended - memory),
    memory,
    tools: o.tools,
    ...(summary > 0 ? { summary } : {}),
    conversation: all - summary,
    current: estimateTokens(o.prompt) + MESSAGE_OVERHEAD,
  };
}
