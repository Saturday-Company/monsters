import {
  EventInputSchema,
  TOOL_CAUSE_NOTE,
  ToolError,
  toolFailureCause,
  type ToolFailureCause,
  trimUrlEnd,
  URL_IN_TEXT,
  type MonstersTool,
  type ToolContext,
  type ToolEmittedEvent,
} from '@monsters/shared';
import { jsonSchema, tool, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { KilledError, type ControlScope } from '../kill/control-scope.ts';
import type { EventLog } from '../log/event-log.ts';
import type { CallTracker } from './call-tracker.ts';
import { stripInvisible } from './invisible.ts';
import { normalizeInput, type ObjectSchema } from './repair.ts';
import { runtimePrompts } from './runtime.prompts.ts';
import { runAgentStrings } from './run-agent.strings.ts';

/*
 * MonstersTool → AI SDK tool. Every execution is logged (`tool_call` before,
 * `tool_result` after). Failures never crash the loop: `ToolError`s (and
 * unexpected errors) become a readable result the model can react to.
 */

/** What the model receives when a tool fails. */
export interface ToolFailureResult {
  /**
   * `cause`: who said no and who can change it, in plain words (D-132), next to every failure
   * that is not the user's no: the model reports it as it is instead of guessing one.
   */
  error: { code: string; message: string; hint?: string; cause?: string };
}

/** The cause of a failed call (D-132): the error's own, or the one its code stands for. */
export function causeOfFailure(err: unknown): ToolFailureCause {
  if (err instanceof ToolError) return err.failureCause ?? toolFailureCause(err.code);
  return 'error';
}

export interface ToolAdapterContext {
  log: EventLog;
  agentId: string;
  runId: string;
  /** Run/agent signal from the kill switch. */
  signal: AbortSignal;
  /**
   * Scope of the agent in the run: tools that start processes (`shell`) get
   * a child scope per call, so the kill switch and the end of the run reach
   * them and their descendants. Without it `ctx.spawn` is absent.
   */
  scope?: ControlScope;
  /** Parent event for the tool calls (e.g. the delegation). */
  parentId?: string | null;
  /** Max characters of a tool output stored in the log. Default 4000. */
  maxLoggedChars?: number;
  /**
   * Cost limits of the run: once exhausted, every tool call gets `LIMIT_REACHED`
   * (with the agent: its spending cap too, D-070). A tool's own `provider_usage`
   * (a paid web search, D-071) adds its cost.
   */
  budget?: { assertActive(agentId?: string): void; addCost?(costUsd: number): void };
  /** The project of the run, written on a tool's `provider_usage` (F-B13). */
  projectId?: string | null;
  /**
   * Text the agent received besides tool results (system prompt, task): its
   * URLs count as known for the link check of `vault_write`/`vault_edit`.
   */
  knownText?: string;
  /**
   * Calls of this agent in this run (D-064): identical read-only calls,
   * failures in a row, calls repaired by the SDK hook.
   */
  calls?: CallTracker;
  /** The instinct around the calls (D-067): the brake on outbound actions, injections. */
  guard?: ToolGuard;
}

/**
 * What the instinct does around a call (D-067). Both hooks are optional and
 * never block local, reversible work.
 */
export interface ToolGuard {
  /**
   * Before every call, read-only ones too (a page opened can carry data out,
   * and a server's "read-only" is its own word, D-070): resolves to go on,
   * throws a `ToolError` to refuse (the user said no). It may wait for the
   * user's answer to a card, for this action only.
   */
  beforeCall?(call: {
    tool: MonstersTool;
    input: unknown;
    callEventId: string;
    signal: AbortSignal;
  }): Promise<void>;
  /**
   * Third-party text before it reaches the model: the same text, or with the
   * blocks that give orders to the agents removed, and a warning for the envelope.
   */
  external?(call: {
    tool: MonstersTool;
    source: string;
    body: string;
    callEventId: string;
    signal: AbortSignal;
  }): Promise<{ body: string; warning?: string }>;
  /** After a call that worked: what it read (the run's taint, D-070). */
  afterCall?(call: { tool: MonstersTool; input: unknown; output: unknown }): void;
  /** What the model reads when a card waited too long, with the true cause (D-142). */
  noAnswer?(): string;
}

// --- link check ------------------------------------------------------------------

/** Tools whose input is checked for links the agent never saw (agents with web tools only). */
const LINK_CHECKED_TOOLS = new Set(['vault_write', 'vault_edit']);

/** Brackets of other scripts end an address too («…», 【…】, D-073). */
const URL_RE = URL_IN_TEXT;

/** Same page for the check: no scheme, `www.`, fragment or trailing slash; decoded path. */
export function normalizeUrl(raw: string): string {
  const url = trimUrlEnd(raw);
  try {
    const u = new URL(url);
    let path = u.pathname;
    try {
      path = decodeURI(path);
    } catch {
      // keep the encoded path
    }
    path = path.replace(/\/+$/, '');
    return `${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}`;
  } catch {
    return url.toLowerCase();
  }
}

/** Distinct URLs in a text, as written (trailing punctuation removed). */
export function extractUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_RE)) out.add(trimUrlEnd(m[0]));
  return [...out];
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/** What a vault tool writes: the content and the new side of the edits, not the text replaced. */
function writtenText(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  if (tool === 'vault_write') return `${textOf(i.content ?? '')}\n${textOf(i.frontmatter ?? '')}`;
  if (!Array.isArray(i.ops)) return textOf(input);
  return i.ops
    .map((op: unknown) => {
      if (!op || typeof op !== 'object') return '';
      const o = op as Record<string, Record<string, unknown> | undefined>;
      return [
        o.str_replace?.new,
        o.append?.text,
        o.prepend?.text,
        o.replace_section?.text,
        o.set_props ? textOf(o.set_props) : undefined,
      ]
        .filter((x) => x !== undefined)
        .map(textOf)
        .join('\n');
    })
    .join('\n');
}

/** What the agent is told when a note cites links no tool result of the run contains. */
export const UNVERIFIED_LINKS_NOTE =
  'These links do not come from your searches or from the pages you read: they may not exist. ' +
  'Check them with web_fetch or remove them from the note (vault_edit).';

/**
 * URLs the agent has seen in the results of its tools during the run. A note
 * that cites others gets a warning in the tool result (never a block): free
 * models rebuild plausible URLs from memory, and they 404 (DECISIONS D-026).
 */
export class SourceTracker {
  readonly #seen = new Set<string>();
  /** Page titles by normalized URL: `{ url, title }` in results (web_search, web_fetch). */
  readonly #titles = new Map<string, string>();

  constructor(knownText = '') {
    this.add(knownText);
  }

  add(value: unknown): void {
    for (const url of extractUrls(textOf(value))) this.#seen.add(normalizeUrl(url));
    this.#collectTitles(value, 0);
  }

  /** Title of a page seen in the run, for the links of the notes (M2.0). */
  titleOf(url: string): string | undefined {
    return this.#titles.get(normalizeUrl(url));
  }

  #collectTitles(value: unknown, depth: number): void {
    if (depth > 3 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) this.#collectTitles(item, depth + 1);
      return;
    }
    const o = value as Record<string, unknown>;
    if (typeof o.url === 'string' && typeof o.title === 'string' && o.title.trim() !== '') {
      const key = normalizeUrl(o.url);
      if (!this.#titles.has(key)) this.#titles.set(key, o.title);
    }
    for (const v of Object.values(o)) this.#collectTitles(v, depth + 1);
  }

  /** URLs written by a vault tool that no tool result contained; each is reported once. */
  unverified(tool: string, input: unknown): string[] {
    const unknown = extractUrls(writtenText(tool, input)).filter(
      (url) => !this.#seen.has(normalizeUrl(url)),
    );
    for (const url of unknown) this.#seen.add(normalizeUrl(url));
    return unknown;
  }
}

function withLinkWarning(output: unknown, links: string[]): unknown {
  const warning = { unverified_links: links, links_note: UNVERIFIED_LINKS_NOTE };
  return output && typeof output === 'object' && !Array.isArray(output)
    ? { ...output, ...warning }
    : { result: output, ...warning };
}

function toFailure(err: unknown, cause: ToolFailureCause = causeOfFailure(err)): ToolFailureResult {
  if (err instanceof ToolError) {
    const note = TOOL_CAUSE_NOTE[cause];
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.hint ? { hint: err.hint } : {}),
        ...(note ? { cause: note } : {}),
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    error: {
      code: 'INTERNAL',
      message,
      hint: 'The tool failed unexpectedly: try a different input or another approach.',
    },
  };
}

function preview(value: unknown, max: number): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    return String(value);
  }
  if (json.length <= max) return value;
  return { truncated: true, preview: `${json.slice(0, max)}…`, chars: json.length };
}

/**
 * The arguments of a tool in one line, for the model that called it wrong:
 * `{ path: string, max_chars?: integer, ops: array }`.
 */
export function compactSchema(schema: ObjectSchema | undefined, maxChars = 600): string {
  const props = schema?.properties;
  if (!props) return '{}';
  const required = new Set(schema.required ?? []);
  const typeText = (p: Record<string, unknown> | undefined): string => {
    if (!p) return 'any';
    if (Array.isArray(p.enum)) return p.enum.map((v) => JSON.stringify(v)).join(' | ');
    const t = p.type;
    if (Array.isArray(t)) return t.join(' | ');
    if (typeof t === 'string') return t;
    if (Array.isArray(p.anyOf)) {
      return (p.anyOf as Record<string, unknown>[]).map((x) => typeText(x)).join(' | ');
    }
    return 'any';
  };
  const fields = Object.entries(props).map(
    ([name, p]) =>
      `${name}${required.has(name) ? '' : '?'}: ${typeText(p as Record<string, unknown>)}`,
  );
  const text = `{ ${fields.join(', ')} }`;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function inputJsonSchema(schema: z.ZodType): Parameters<typeof jsonSchema>[0] {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Parameters<
      typeof jsonSchema
    >[0];
  } catch {
    return { type: 'object' };
  }
}

/** Tag of the envelope around third-party data given to the model. */
export const EXTERNAL_DATA_TAG = 'dati_esterni';

/** Any opening or closing envelope tag, also with spaces or another case. */
const ENVELOPE_TAG = new RegExp(`<(\\s*/?\\s*${EXTERNAL_DATA_TAG})`, 'gi');

const escapeAttr = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

/**
 * Wraps a tool output in `<dati_esterni fonte="…">…</dati_esterni>`. Envelope
 * tags inside the content are escaped, so the data can never close the
 * envelope and pose as the system or the user.
 */
export function wrapExternalData(source: string, output: unknown, warning?: string): string {
  // Hidden characters never reach a model (D-070): the text it reads is the text a person sees.
  const safe = stripInvisible(externalBody(output)).text.replace(ENVELOPE_TAG, '&lt;$1');
  const tag = EXTERNAL_DATA_TAG;
  const head = warning ? `[${warning.replace(ENVELOPE_TAG, '&lt;$1')}]\n` : '';
  return `<${tag} fonte="${escapeAttr(source)}">\n${head}${safe}\n</${tag}>`;
}

/** The text of a tool output as the model reads it. */
export function externalBody(output: unknown): string {
  try {
    return typeof output === 'string' ? output : (JSON.stringify(output) ?? 'null');
  } catch {
    return String(output);
  }
}

/**
 * The `notice` fields Monsters' own web tools add to a result (D-071), taken
 * out of the third-party data: at the top and on every page of `pages`.
 */
export function splitNotices(output: unknown): { data: unknown; notices: string[] } {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { data: output, notices: [] };
  }
  const notices: string[] = [];
  const { notice, ...rest } = output as Record<string, unknown>;
  if (typeof notice === 'string' && notice.trim()) notices.push(notice.trim());
  const pages = rest['pages'];
  if (Array.isArray(pages)) {
    rest['pages'] = pages.map((page: unknown, i) => {
      if (!page || typeof page !== 'object') return page;
      const { notice: n, ...p } = page as Record<string, unknown>;
      // The page by its place, not its address: an address (after a redirect,
      // too) is not Monsters' word and stays in the data (D-074).
      if (typeof n === 'string' && n.trim()) notices.push(`Page ${i + 1}: ${n.trim()}`);
      return p;
    });
  }
  return { data: notices.length > 0 ? rest : output, notices };
}

/** Marks a tool as a source of third-party data (see `MonstersTool.externalSource`). */
export function markExternal<I, O>(
  t: MonstersTool<I, O>,
  source: (input: I, output: O) => string,
): MonstersTool<I, O> {
  return { ...t, externalSource: source };
}

function externalSourceOf(t: MonstersTool, input: unknown, output: unknown): string | null {
  if (!t.externalSource) return null;
  try {
    return t.externalSource(input, output);
  } catch {
    return t.name;
  }
}

/**
 * Validation happens inside `execute` (not in the AI SDK) so that invalid input
 * becomes an INVALID_INPUT result the model can fix, logged like any failure.
 */
export function adaptTool(t: MonstersTool, ctx: ToolAdapterContext, sources?: SourceTracker): Tool {
  const maxChars = ctx.maxLoggedChars ?? 4000;
  const schema =
    (t.inputJsonSchema as Parameters<typeof jsonSchema>[0] | undefined) ??
    inputJsonSchema(t.inputSchema);
  /**
   * Arguments as the schema wants them, after the deterministic fixes (AG-17):
   * a key in the other case would otherwise be dropped without a word.
   */
  const parseInput = (rawInput: unknown) => {
    const normalized = normalizeInput(rawInput, schema as ObjectSchema);
    const parsed = t.inputSchema.safeParse(normalized.input);
    return { parsed, fixed: parsed.success ? normalized.fixed : [] };
  };
  return tool({
    description: t.description,
    inputSchema: jsonSchema<unknown>(schema),
    execute: async (rawInput: unknown, options) => {
      const callId = options.toolCallId;
      const { parsed, fixed } = parseInput(rawInput);
      const repaired = [...new Set([...(ctx.calls?.takeRepaired(callId) ?? []), ...fixed])];
      const call = ctx.log.append({
        agent: ctx.agentId,
        runId: ctx.runId,
        parentId: ctx.parentId ?? null,
        type: 'tool_call',
        data: {
          callId,
          tool: t.name,
          input: rawInput,
          ...(repaired.length > 0 ? { repaired } : {}),
        },
      });
      const started = Date.now();
      const signal = options.abortSignal
        ? AbortSignal.any([ctx.signal, options.abortSignal])
        : ctx.signal;
      const toolCtx: ToolContext = {
        agentId: ctx.agentId,
        runId: ctx.runId,
        callEventId: call.id,
        signal,
        ...(sources ? { linkTitle: (url: string) => sources.titleOf(url) } : {}),
        emit: (event: ToolEmittedEvent) => {
          const input = {
            agent: ctx.agentId,
            runId: ctx.runId,
            parentId: call.id,
            type: event.type,
            data:
              event.type === 'provider_usage' &&
              ctx.projectId !== undefined &&
              event.data &&
              typeof event.data === 'object'
                ? { ...(event.data as Record<string, unknown>), project: ctx.projectId }
                : event.data,
          };
          const parsed = EventInputSchema.parse(input);
          ctx.log.append(parsed);
          if (parsed.type === 'provider_usage' && parsed.data.costUsd) {
            ctx.budget?.addCost?.(parsed.data.costUsd);
          }
        },
      };
      // One scope per call, created on the first spawn and closed with the call:
      // whatever the tool left running is stopped then (SIGINT, then SIGKILL).
      let callScope: ControlScope | undefined;
      if (ctx.scope) {
        const parent = ctx.scope;
        toolCtx.spawn = (command, args, spawnOptions) => {
          callScope ??= parent.toolCall(callId);
          const scope = callScope;
          const child = scope.spawn(command, args, spawnOptions);
          return {
            child,
            stop: async () => {
              // A later spawn of the same call gets a fresh scope.
              if (callScope === scope) callScope = undefined;
              await scope.abort(new KilledError('tool', 'stopped by the tool'));
            },
          };
        };
      }
      /** One result per call: the first outcome logged is the call's outcome. */
      let resulted = false;
      const finish = (
        ok: boolean,
        output: unknown,
        error?: string,
        repeated = false,
        cause?: ToolFailureCause,
      ) => {
        if (resulted) return;
        resulted = true;
        ctx.calls?.result(ok);
        ctx.log.append({
          agent: ctx.agentId,
          runId: ctx.runId,
          parentId: call.id,
          type: 'tool_result',
          data: {
            callId,
            tool: t.name,
            ok,
            output: preview(output, maxChars),
            ...(error !== undefined ? { error } : {}),
            ...(cause ? { cause } : {}),
            durationMs: Date.now() - started,
            ...(repeated ? { repeated: true } : {}),
          },
        });
      };
      /** Third-party text reaches the model inside a visible envelope; the log keeps the raw output. */
      const forModel = async (input: unknown, output: unknown) => {
        const source = externalSourceOf(t, input, output);
        if (source === null) return output;
        // Monsters' own notices ("you already read this page…") are not third-party text:
        // outside the envelope, and never seen by the injection check (D-073: Jev read one as
        // an order to the agents and a whole page went).
        const { data, notices } = splitNotices(output);
        const withNotices = (wrapped: string) =>
          notices.length > 0 ? `${wrapped}\n[Monsters] ${notices.join(' ')}` : wrapped;
        const visible = stripInvisible(externalBody(data));
        if (visible.hidden > 0) {
          ctx.log.append({
            agent: 'system',
            runId: ctx.runId,
            parentId: call.id,
            type: 'security',
            data: {
              action: 'invisible_removed',
              source: source.slice(0, 300),
              tool: t.name,
              chars: visible.hidden,
              message: runAgentStrings().invisibleRemoved(visible.hidden, source.slice(0, 120)),
            },
          });
        }
        if (!ctx.guard?.external) return withNotices(wrapExternalData(source, visible.text));
        const checked = await ctx.guard
          .external({ tool: t, source, body: visible.text, callEventId: call.id, signal })
          .catch(() => null);
        return withNotices(
          checked
            ? wrapExternalData(source, checked.body, checked.warning)
            : wrapExternalData(source, visible.text),
        );
      };

      /*
       * A stop logs the call's result at once, inside the abort: the kill switch logs the
       * run's end right after aborting, while the tool may settle much later (a shell resolves
       * on the close of its pipes, a tool may not listen to the signal at all). The result is
       * then in the log before the end of the run, whatever the tool does after the stop.
       */
      const onStop = () => {
        try {
          finish(false, undefined, 'aborted');
        } catch {
          // A log that cannot write (a closing core) never breaks the abort of the others.
        }
      };
      ctx.signal.addEventListener('abort', onStop, { once: true });

      let executed = false;
      /** The brake is holding the call: an ABORTED from it is a card nobody answered. */
      let braking = false;
      try {
        signal.throwIfAborted();
        ctx.budget?.assertActive(ctx.agentId);
        if (!parsed.success) {
          throw new ToolError(
            'INVALID_INPUT',
            runtimePrompts().invalidArguments(t.name, z.prettifyError(parsed.error)),
            {
              hint: runtimePrompts().invalidArgumentsHint(
                t.name,
                compactSchema(schema as ObjectSchema),
              ),
            },
          );
        }
        if (t.readOnly) {
          // The same read again: the earlier result, no I/O (a third time is refused).
          const again = ctx.calls?.repeat(t.name, parsed.data);
          if (again) {
            finish(true, again.output, undefined, true);
            return await forModel(parsed.data, again.output);
          }
        }
        // The brake on actions that leave the computer (D-067, D-070): may wait for the user.
        if (ctx.guard?.beforeCall) {
          braking = true;
          await ctx.guard.beforeCall({ tool: t, input: parsed.data, callEventId: call.id, signal });
          braking = false;
        }
        executed = true;
        let output: unknown = await t.execute(parsed.data, toolCtx);
        ctx.guard?.afterCall?.({ tool: t, input: parsed.data, output });
        if (sources) {
          const unknown = LINK_CHECKED_TOOLS.has(t.name)
            ? sources.unverified(t.name, parsed.data)
            : [];
          if (unknown.length > 0) output = withLinkWarning(output, unknown);
          else sources.add(output);
        }
        ctx.calls?.remember(t.name, parsed.data, output, t.readOnly === true);
        finish(true, output);
        return await forModel(parsed.data, output);
      } catch (err) {
        // The kill switch stops the loop: let the abort propagate.
        if (ctx.signal.aborted) {
          finish(false, undefined, 'aborted');
          throw err;
        }
        // The brake's card expired (D-132): nobody answered, which is not the user's no.
        const cause =
          braking && err instanceof ToolError && err.code === 'ABORTED' && !err.failureCause
            ? 'user_no_answer'
            : causeOfFailure(err);
        const failure = toFailure(err, cause);
        // A failure of a third-party source carries its text to the model too (an
        // MCP `isError` with hostile words): it taints the run like a result (review of 16/10).
        if (executed && parsed.success) {
          ctx.guard?.afterCall?.({ tool: t, input: parsed.data, output: failure });
        }
        finish(false, failure, `${failure.error.code}: ${failure.error.message}`, false, cause);
        return failure;
      } finally {
        ctx.signal.removeEventListener('abort', onStop);
        callScope?.close();
      }
    },
  });
}

/**
 * Adapts a toolset; names must be unique. An agent with web tools gets the
 * link check on its notes (`SourceTracker`), for the whole run of the agent.
 */
export function adaptTools(
  tools: MonstersTool[],
  ctx: ToolAdapterContext,
  /** The tracker to use (a harness also feeds it the results of its own web search). */
  tracker?: SourceTracker,
): ToolSet {
  const set: ToolSet = {};
  const sources =
    tracker ??
    (tools.some((t) => t.name.startsWith('web_')) ? new SourceTracker(ctx.knownText) : undefined);
  for (const t of tools) {
    if (set[t.name]) throw new Error(`duplicate tool name: ${t.name}`);
    set[t.name] = adaptTool(t, ctx, sources);
  }
  return set;
}
