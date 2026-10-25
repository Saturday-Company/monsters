import { isAbsolute, resolve } from 'node:path';
import { settingsLabel, ToolError, type MonstersTool } from '@monsters/shared';
import {
  instructionFileIn,
  lockedCommand,
  lockedPath,
  lockedSearch,
  realPathOf,
  type DataDirLock,
  type LockVerdict,
} from '@monsters/tools';
import { z } from 'zod';
import type { EventLog } from '../log/event-log.ts';
import {
  BRAKE_HOLD_MS,
  brakeNoAnswer,
  INJECTION_REMOVED_MARKS,
  injectionRemoved,
  injectionWarning,
} from '../team/instinct/guard.ts';
import { commandWritesConfig } from './command-writes-config.ts';
import { stripInvisible } from './invisible.ts';
import { runAgentPrompts } from './run-agent.prompts.ts';
import { runAgentStrings } from './run-agent.strings.ts';
import { listWords, runHarnessPrompts } from './run-harness.prompts.ts';
import type { FinalAnswerHook } from './run-agent.ts';
import type { ToolGuard } from './tool-adapter.ts';

/*
 * The hooks of an agent running on Claude Code (D-069): the binary asks the
 * core, over HTTP on 127.0.0.1 with the run's token, before its own tools
 * and before it stops. The same instinct as our own loop:
 * - `PreToolUse` on the terminal (`Bash`), the web search (`WebSearch`) and
 *   the services reached through Claude (`mcp__claude_ai_…`): the brake of
 *   `InstinctGuard` (rules of `outbound.ts`, the instinct on candidates, the
 *   card "Rhea vuole …: procedo?" for the categories in "Chiedi sempre"),
 *   holding the tool until the user answers. Monsters' own tools
 *   (`mcp__monsters__*`) are checked inside the core: never twice.
 * - `PostToolUse` on the web search and the services reached through Claude
 *   (D-073): their results are third-party text like ours. The run's taint
 *   learns them (`afterCall`: after a hostile page or result the data that
 *   leave are checked, D-070), hidden characters go, and the injection check
 *   of our loop (`external`) runs on their text: a block that gives orders to
 *   the agents is replaced in the output (`updatedToolOutput`, Claude Code
 *   2.1.301), a doubtful one gets the warning as `additionalContext`. Since
 *   D-074 the run is tainted already in `PreToolUse` (a `PostToolUse` that
 *   times out leaves no clean run), only the blocks flagged go (as in our
 *   loop), and `PostToolUseFailure` (the error of a service, which Claude
 *   Code does not send to `PostToolUse`) taints and gets the warning too.
 * - `Stop`: the stop hook of the agent (`onFinalAnswer`: "finito davvero?"
 *   after a delegation, the question left in the text of the capo), once per
 *   turn, like `FOLLOW_UP_STEPS` in our loop.
 *
 * - D-078: `PreToolUse` on the terminal and the file tools (`Read`, `Write`,
 *   `Edit`, `Glob`, `Grep`, `LS`…) keeps them out of the data folder of
 *   Monsters, except the agent's own working folder: "I file interni di
 *   Monsters non sono accessibili" (`lockout.ts` of `@monsters/tools`).
 *
 * - D-079: no run writes the harness configuration of its working folder
 *   (`.claude/`, `.mcp.json`, CLAUDE.md, AGENTS.md, `.codex/`): Claude Code no
 *   longer reads it (`--setting-sources ""`) and the core removes it before
 *   each run, this is the third layer (a brake on Bash, exact on the file
 *   tools).
 *
 * - D-170: past a limit of the run or of the agent, `PreToolUse` refuses every
 *   tool with the words that ask for the report (the matchers cover all the
 *   run's built-ins; Monsters' own tools answer `LIMIT_REACHED` in the core),
 *   and `Stop` sends no reminder.
 *
 * A hook never answers `allow` (that would skip the permission rules of the
 * run): nothing means "go on as the rules say", `deny` stops that tool only.
 */

/** What Claude Code posts to an HTTP hook (the fields Monsters reads). */
export const ClaudeHookInputSchema = z.looseObject({
  hook_event_name: z.string(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  tool_response: z.unknown().optional(),
  /** `PostToolUseFailure`: what the tool answered instead of a result (Claude Code 2.1.301). */
  error: z.unknown().optional(),
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
});
export type ClaudeHookInput = z.infer<typeof ClaudeHookInputSchema>;

/** The answer of a hook: `{}` lets the run's own rules decide. */
export type ClaudeHookOutput = Record<string, unknown>;

/** A tool of a server reached through Claude whose name says it only reads. */
const READ_VERB =
  /^(get|list|search|read|fetch|find|query|view|describe|whoami|show|lookup|download|preview|count|check|resolve|help|retrieve|browse|inspect|explain)$/;

function firstWord(tool: string): string {
  return (
    tool
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find(Boolean) ?? ''
  );
}

/** A server name for people: `claude_ai_Google_Drive` → `Google Drive`. */
export function serverLabel(server: string): string {
  return server.replace(/^claude_ai_/, '').replace(/_/g, ' ');
}

function pseudoTool(name: string, description: string, readOnly?: boolean): MonstersTool {
  return {
    name,
    description,
    inputSchema: z.unknown(),
    ...(readOnly ? { readOnly } : {}),
    execute: () => Promise.reject(new Error('a tool of the harness: it runs there')),
  };
}

/**
 * A tool of the harness as the brake knows it: the terminal as `shell`, the
 * web search as `web_search`, a server reached through Claude as
 * `mcp__<server>__<tool>` (read-only when its name says so: the harness does
 * not pass the server's annotations). Null for the rest (files, Monsters').
 */
export function harnessToolForGuard(
  name: string,
  input: unknown,
  monstersServer: string,
): { tool: MonstersTool; input: unknown } | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (name === 'Bash') {
    return {
      tool: pseudoTool('shell', 'A command in the terminal of the computer'),
      input: { command: typeof i['command'] === 'string' ? i['command'] : '' },
    };
  }
  if (name === 'WebSearch') {
    return {
      tool: pseudoTool('web_search', 'A web search', true),
      input: { query: typeof i['query'] === 'string' ? i['query'] : '' },
    };
  }
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m || m[1] === monstersServer) return null;
  const server = serverLabel(m[1]!);
  const tool = m[2]!;
  return {
    tool: pseudoTool(
      `mcp__${server}__${tool}`,
      `A tool of ${server}, reached through Claude`,
      READ_VERB.test(firstWord(tool)),
    ),
    input,
  };
}

export interface HarnessHookContext {
  log: Pick<EventLog, 'append'>;
  agentId: string;
  runId: string;
  parentId: string | null;
  /** Name of Monsters' own MCP server in the run (`monsters`). */
  monstersServer: string;
  guard?: ToolGuard;
  onFinalAnswer?: (text: string) => FinalAnswerHook | Promise<FinalAnswerHook>;
  /** A call the hook refused and recorded as `internal_denied` (D-166), by its tool use id. */
  refused?: (toolUseId: string) => void;
  /** The `tool_call` event of a harness tool call: logged once, by the stream or the hook. */
  callEvent: (toolUseId: string, name: string, input: unknown) => string;
  /** The last complete answer seen in the stream (older binaries send no `last_assistant_message`). */
  lastText: () => string;
  /**
   * Past a limit (D-170): the words that refuse any tool and ask for the report, or null while
   * the run may work. Called once per `PreToolUse`, with the call's id.
   */
  wrapUp?: (toolUseId: string) => string | null;
  /** The data folder of Monsters is off limits (D-078); `cwd`: the agent's working folder. */
  lockout?: { lock: DataDirLock; cwd: string };
  /**
   * Folders closed to this run, with the words for the model: the vault's
   * `Privato/` in a run of a Telegram chat (D-107), Claude Code's transcripts
   * (M6). The same speed bump.
   */
  closed?: readonly { lock: DataDirLock; cwd: string; message: string }[];
  /** The agent's working folder, whose harness configuration the run never writes (D-079). */
  workspace?: string;
  /** The projects' folders: their CLAUDE.md, AGENTS.md and configuration are not written either (D-103). */
  instructionFolders?: readonly string[];
  /**
   * The built-in tools of the run (`--tools`, D-127): a `PreToolUse` for any
   * other built-in is refused with `reason`, never left to `dontAsk`, whose
   * refusal tells the model to let the user decide.
   */
  outside?: {
    builtins: readonly string[];
    reason: (tool: string) => string;
    /** Without the terminal, `Read` opens only these files (the attachments). */
    readable?: readonly string[];
  };
}

/** The web of a run, for the words about a built-in it does not have (D-127). */
export interface RunWeb {
  /** Monsters' `web_search`. */
  search: boolean;
  /** Monsters' `web_fetch`. */
  fetch: boolean;
  /** The harness's own search (`WebSearch`) is the run's (D-069). */
  own: boolean;
  /** The monsters of the squad that have the web, when this one has none. */
  elsewhere?: readonly string[];
  /** Built-in `Read` opens only the files the user attached (no terminal). */
  attachmentsOnly?: boolean;
}

const WEB_BUILTINS = new Set(['WebSearch', 'WebFetch']);

/** "A", "A and B", "A, B and C" (`and` in the language of the text). */
function names(items: readonly string[], and: string): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)!}`;
}

/**
 * What the user reads when one of Monsters' fixed rules refused a built-in
 * (D-127): Claude Code says "denied by your permission settings", which
 * blames the user (a monster and a project's CLAUDE.md, 18/10/2026).
 */
export function monstersRuleRefusal(tool: string): string {
  return runAgentStrings().monstersRuleRefusal(tool);
}

/**
 * What the model and the user read when a built-in tool of Claude Code is not
 * the run's (D-127): not a refusal of the user, and what to use instead. Before
 * it, `dontAsk`'s own words ("STOP and explain to the user… Let the user
 * decide") became "il web mi è stato negato" (19/10/2026).
 */
export function unavailableBuiltin(
  tool: string,
  web: RunWeb,
  server: string,
): { model: string; user: string } {
  const readOnly = tool === 'Read' && web.attachmentsOnly === true;
  let model = readOnly
    ? 'In this run the built-in Read opens only the files the user attached.'
    : `${tool} is not one of your tools in this run: Monsters gives you only the tools you see listed.`;
  model += ' This is not a refusal of the user and asking the user for it does not help.';
  const words = runAgentStrings();
  let user = readOnly ? words.builtinOnlyAttached : words.builtinNotInJob(tool);
  if (WEB_BUILTINS.has(tool)) {
    const search = web.own ? 'WebSearch' : web.search ? `\`web_search\` of \`${server}\`` : '';
    const fetch = web.fetch ? `\`web_fetch\` of \`${server}\`` : '';
    const elsewhere = web.elsewhere ?? [];
    if (search || fetch) {
      model += ` For the web use ${[
        ...(search ? [`${search} to search`] : []),
        ...(fetch ? [`${fetch} to read a page`] : []),
      ].join(' and ')}.`;
      user += words.builtinWebTools;
    } else if (elsewhere.length > 0) {
      model += ` You have no web tools: ${names(elsewhere, 'and')} ${elsewhere.length > 1 ? 'have' : 'has'} them. Delegate the search if you can, otherwise say in your answer what must be looked up.`;
      user += words.builtinWebElsewhere(listWords(elsewhere), elsewhere.length);
    } else {
      model += ' You have no web tools in this run: say in your answer what must be looked up.';
      user += words.builtinNoWeb;
    }
  } else if (!readOnly) {
    model += ` Work with the tools you have (Monsters' are in the \`${server}\` server).`;
  }
  return { model, user };
}

/** What the model reads when a call would write the harness configuration (D-079). */
export const harnessConfigDenied = (): string => runHarnessPrompts().configDenied(settingsLabel());

/**
 * A call of Claude Code's terminal or file tools that would write the
 * harness configuration of the working folder (D-079), or null. Reading
 * AGENTS.md stays possible.
 */
export async function harnessConfigWrite(
  name: string,
  input: unknown,
  workspace: string,
  /** Further folders whose configuration stays closed: the projects' folders (D-103). */
  folders: readonly string[] = [],
): Promise<boolean> {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  // At any depth, on the path given and on the real one (review of 18/10, M3 and B3): `ln -s . x`
  // then `x/CLAUDE.md`, a project saved through a link, `CLAUDE.md.` and `::$DATA` on Windows.
  const configPath = async (raw: string | undefined) => {
    if (!raw?.trim()) return false;
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(workspace, raw);
    const roots = [workspace, ...folders];
    const realRoots = await Promise.all(roots.map((f) => realPathOf(f).catch(() => resolve(f))));
    const all = [...roots, ...realRoots];
    const real = await realPathOf(abs).catch(() => abs);
    return instructionFileIn(abs, all) || instructionFileIn(real, all);
  };
  switch (name) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return configPath(str(i['file_path']));
    case 'NotebookEdit':
      return configPath(str(i['notebook_path']));
    case 'Bash': {
      const command = str(i['command']) ?? '';
      return commandWritesConfig(command);
    }
    default:
      return false;
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * A call of Claude Code's terminal or file tools that reaches the data
 * folder of Monsters (D-078), or null. Paths are those of the tools' inputs.
 */
export function lockedHarnessCall(
  name: string,
  input: unknown,
  cwd: string,
  lock: DataDirLock,
): LockVerdict | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const path = (key: string) => {
    const v = str(i[key]);
    return v ? lockedPath(v, cwd, lock) : null;
  };
  switch (name) {
    case 'Bash':
      return lockedCommand(str(i['command']) ?? '', cwd, lock);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return path('file_path');
    case 'NotebookEdit':
      return path('notebook_path');
    case 'LS':
      return path('path') ?? lockedPath(cwd, cwd, lock);
    case 'Glob':
      return lockedSearch(
        { path: str(i['path']), pattern: str(i['pattern']), recursive: false },
        cwd,
        lock,
      );
    case 'Grep':
      return lockedSearch(
        { path: str(i['path']), pattern: str(i['glob']), recursive: true },
        cwd,
        lock,
      );
    default:
      return null;
  }
}

/**
 * The longest a tool waits for the user's answer to a card, below the hook's
 * own timeout (`CLAUDE_HOOK_TIMEOUT_S`): past it the binary would go on
 * without the answer, so the core says no first.
 */
export const HOOK_HOLD_MS = BRAKE_HOLD_MS;

const deny = (reason: string): ClaudeHookOutput => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
});

/**
 * A command Codex wants to run outside its sandbox (D-158): the very check Claude Code's
 * `Bash` gets from `PreToolUse` (data folder, closed folders, harness configuration, the
 * brake), never a second copy of it. Null lets it run; otherwise the words of the refusal.
 */
export async function checkHarnessCommand(
  call: { id: string; command: string },
  ctx: HarnessHookContext,
  signal: AbortSignal,
  holdMs = HOOK_HOLD_MS,
): Promise<string | null> {
  const out = await answerHarnessHook(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: call.command },
      tool_use_id: call.id,
    },
    ctx,
    signal,
    holdMs,
  );
  const specific = out['hookSpecificOutput'] as
    { permissionDecision?: unknown; permissionDecisionReason?: unknown } | undefined;
  if (specific?.permissionDecision !== 'deny') return null;
  const reason = specific.permissionDecisionReason;
  return typeof reason === 'string' && reason.trim() ? reason : 'The command was stopped.';
}

/** Answers one hook call of a run. Never throws: a failure becomes "go on" or "deny". */
export async function answerHarnessHook(
  raw: unknown,
  ctx: HarnessHookContext,
  signal: AbortSignal,
  holdMs = HOOK_HOLD_MS,
): Promise<ClaudeHookOutput> {
  const parsed = ClaudeHookInputSchema.safeParse(raw);
  if (!parsed.success) return {};
  const input = parsed.data;
  switch (input.hook_event_name) {
    case 'PreToolUse':
      return preToolUse(input, ctx, signal, holdMs);
    case 'PostToolUse':
      return postToolUse(input, ctx, signal);
    case 'PostToolUseFailure':
      return postToolUseFailure(input, ctx, signal);
    case 'Stop':
      return stop(input, ctx);
    default:
      return {};
  }
}

/**
 * A call the core refuses (D-078, D-079): the `internal_denied` record under its `tool_call`. It is
 * information, not a failure: the monster is told why and goes on (D-166), so the runner does not add an
 * error for it at the end (`refused`).
 */
function refusedCall(
  ctx: HarnessHookContext,
  input: ClaudeHookInput,
  source: string,
  message: string,
): void {
  const name = input.tool_name ?? '';
  const callEventId = ctx.callEvent(input.tool_use_id ?? '', name, input.tool_input ?? {});
  ctx.log.append({
    agent: 'system',
    runId: ctx.runId,
    parentId: callEventId,
    type: 'security',
    data: { action: 'internal_denied', source, tool: name, message },
  });
  ctx.refused?.(input.tool_use_id ?? '');
}

async function preToolUse(
  input: ClaudeHookInput,
  ctx: HarnessHookContext,
  signal: AbortSignal,
  holdMs: number,
): Promise<ClaudeHookOutput> {
  const name = input.tool_name ?? '';
  // Past a limit (D-170): nothing runs any more, whatever the tool; the model writes its report.
  const limit = ctx.wrapUp?.(input.tool_use_id ?? '');
  if (limit) return deny(limit);
  // A built-in the run does not have (D-127): its own words, before `dontAsk`'s "let the user decide".
  if (ctx.outside && name && !name.startsWith('mcp__') && !ctx.outside.builtins.includes(name)) {
    return deny(ctx.outside.reason(name));
  }
  if (name === 'Read' && ctx.outside?.readable) {
    const path = str((input.tool_input as Record<string, unknown> | undefined)?.['file_path']);
    const wanted = path ? resolve(path) : '';
    if (!ctx.outside.readable.some((f) => resolve(f) === wanted)) {
      return deny(ctx.outside.reason(name));
    }
  }
  const locked = ctx.lockout
    ? lockedHarnessCall(name, input.tool_input, ctx.lockout.cwd, ctx.lockout.lock)
    : null;
  if (
    !locked &&
    ctx.workspace &&
    (await harnessConfigWrite(name, input.tool_input, ctx.workspace, ctx.instructionFolders))
  ) {
    refusedCall(ctx, input, 'harness_config', runAgentStrings().configWriteStopped);
    return deny(harnessConfigDenied());
  }
  if (locked) {
    refusedCall(ctx, input, locked.path.slice(0, 300), runAgentStrings().internalFilesStopped);
    return deny(`${locked.message} ${locked.hint}`);
  }
  for (const folder of ctx.closed ?? []) {
    const closed = lockedHarnessCall(name, input.tool_input, folder.cwd, folder.lock);
    if (!closed) continue;
    refusedCall(ctx, input, closed.path.slice(0, 300), folder.message);
    return deny(folder.message);
  }
  const mapped = ctx.guard?.beforeCall
    ? harnessToolForGuard(name, input.tool_input, ctx.monstersServer)
    : null;
  if (!mapped || !ctx.guard?.beforeCall) return {};
  const callEventId = ctx.callEvent(input.tool_use_id ?? '', name, input.tool_input ?? {});
  const timeout = AbortSignal.timeout(holdMs);
  try {
    await ctx.guard.beforeCall({
      tool: mapped.tool,
      input: mapped.input,
      callEventId,
      signal: AbortSignal.any([signal, timeout]),
    });
    // The search and the services bring third-party text: the run is tainted
    // now, before the result (D-074), so a `PostToolUse` that times out or a
    // binary that skips it never leaves the run clean. The result still comes
    // to `PostToolUse` for its links and the injection check.
    if (mapped.tool.name !== 'shell') {
      try {
        ctx.guard.afterCall?.({ tool: mapped.tool, input: mapped.input, output: null });
      } catch {
        // The taint never stops a tool.
      }
    }
    return {};
  } catch (err) {
    if (err instanceof ToolError) {
      const hint = err.hint ? ` ${err.hint}` : '';
      return deny(`${err.message}.${hint}`);
    }
    if (timeout.aborted && !signal.aborted) {
      // Never "the user did not answer" when the user could not see the card (D-142).
      return deny(ctx.guard.noAnswer?.() ?? brakeNoAnswer(undefined, holdMs));
    }
    // The run is being stopped: the binary goes with it.
    return deny('The work was stopped.');
  }
}

/** Text the injection check reads in a result: its strings, one per line. */
function leaves(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) leaves(v, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) leaves(v, out, depth + 1);
  }
  return out;
}

/**
 * The most text of one result the hooks check (D-074): the injection check
 * reads its first blocks anyway, and a result of megabytes must not hold the
 * core. The rest reaches the model as it is, as in our loop.
 */
const MAX_HOOK_TEXT_CHARS = 200_000;

/** Fields of a result that are not text to read: kept as they are when a block goes. */
const STRUCTURAL = new Set(['url', 'query', 'tool_use_id', 'type', 'id']);

/** The same value with every string passed through `f` (with its field name). */
function mapLeaves(
  value: unknown,
  f: (s: string, key: string | undefined) => string,
  depth = 0,
  key?: string,
): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') return f(value, key);
  if (Array.isArray(value)) return value.map((v) => mapLeaves(v, f, depth + 1, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mapLeaves(v, f, depth + 1, k)]),
    );
  }
  return value;
}

/** Where a result comes from, for the envelope and the Activity, in the app's language. */
function sourceOf(tool: MonstersTool, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (tool.name === 'web_search') {
    return runHarnessPrompts()
      .sourcePlanSearch(typeof i['query'] === 'string' ? i['query'] : '')
      .trim();
  }
  const m = /^mcp__(.+?)__(.+)$/.exec(tool.name);
  return m ? runHarnessPrompts().sourceViaClaude(m[1]!, m[2]!) : tool.name;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How the check marks a block it took away in the text it returns: the mark of either family
 * (D-153), the language may change between the check and the reading.
 */
const REMOVED_IN_BODY = new RegExp(
  INJECTION_REMOVED_MARKS.map((m) => `\\n${escapeRegex(m)}\\n`).join('|'),
);

/**
 * The parts of `original` the injection check took away: `checked` is the
 * same text with some blocks replaced by `REMOVED_IN_BODY` (blocks of 6,000
 * characters in our loop). An answer of another shape counts as all removed.
 */
export function removedRanges(original: string, checked: string): [number, number][] {
  if (checked === original) return [];
  const kept = checked.split(REMOVED_IN_BODY);
  if (kept.length === 1) return [[0, original.length]];
  const out: [number, number][] = [];
  let at = 0;
  for (const piece of kept) {
    const found = piece === '' ? at : original.indexOf(piece, at);
    if (found === -1) return [[0, original.length]];
    if (found > at) out.push([at, found]);
    at = found + piece.length;
  }
  if (at < original.length) out.push([at, original.length]);
  return out;
}

/**
 * A string with the parts in `ranges` (relative to it) replaced by the mark of a removed block
 * (as in our loop), once per run of them.
 */
function withoutRanges(s: string, ranges: readonly [number, number][]): string {
  const REMOVED = injectionRemoved();
  const out: string[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    const from = Math.max(a, 0);
    const to = Math.min(b, s.length);
    if (to <= from) continue;
    if (from > at) out.push(s.slice(at, from).replace(/\n$/, ''));
    if (out.at(-1) !== REMOVED) out.push(REMOVED);
    at = to;
  }
  if (at < s.length) out.push(s.slice(at).replace(/^\n/, ''));
  return out.join('\n');
}

async function postToolUse(
  input: ClaudeHookInput,
  ctx: HarnessHookContext,
  signal: AbortSignal,
): Promise<ClaudeHookOutput> {
  const name = input.tool_name ?? '';
  const mapped = harnessToolForGuard(name, input.tool_input, ctx.monstersServer);
  // The terminal is the user's computer, not a third party: like our loop, never checked.
  if (!mapped || mapped.tool.name === 'shell' || input.tool_response === undefined) return {};
  const output = input.tool_response;
  try {
    ctx.guard?.afterCall?.({ tool: mapped.tool, input: mapped.input, output });
  } catch {
    // The taint never stops a result.
  }
  const source = sourceOf(mapped.tool, mapped.input);
  let hidden = 0;
  let cleaned = mapLeaves(output, (s) => {
    const r = stripInvisible(s);
    hidden += r.hidden;
    return r.text;
  });
  const callEventId = ctx.callEvent(input.tool_use_id ?? '', name, input.tool_input ?? {});
  if (hidden > 0) {
    ctx.log.append({
      agent: 'system',
      runId: ctx.runId,
      parentId: callEventId,
      type: 'security',
      data: {
        action: 'invisible_removed',
        source: source.slice(0, 300),
        tool: mapped.tool.name,
        chars: hidden,
        message: runAgentStrings().invisibleRemoved(hidden, source.slice(0, 120)),
      },
    });
  }
  let warning: string | undefined;
  const parts = leaves(cleaned);
  if (ctx.guard?.external && parts.length > 0) {
    const joined = parts.join('\n').slice(0, MAX_HOOK_TEXT_CHARS);
    const checked = await ctx.guard
      .external({ tool: mapped.tool, source, body: joined, callEventId, signal })
      .catch(() => null);
    if (checked) {
      warning = checked.warning;
      // Only the blocks the check took away go, as in our loop (D-074: a result of
      // one long text lost all of it for one bad block); the addresses and the
      // query stay, so Claude Code still reads its own shape.
      const removed = removedRanges(joined, checked.body);
      if (removed.length > 0) {
        const starts: number[] = [];
        let offset = 0;
        for (const p of parts) {
          starts.push(offset);
          offset += p.length + 1;
        }
        let k = 0;
        cleaned = mapLeaves(cleaned, (s, key) => {
          if (!s.trim()) return s;
          const start = starts[k++] ?? 0;
          if (key && STRUCTURAL.has(key)) return s;
          const local = removed
            .filter(([a, b]) => b > start && a < start + s.length)
            .map(([a, b]): [number, number] => [a - start, b - start]);
          return local.length > 0 ? withoutRanges(s, local) : s;
        });
      }
    }
  }
  const changed = hidden > 0 || JSON.stringify(cleaned) !== JSON.stringify(output);
  if (!changed && !warning) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      ...(changed ? { updatedToolOutput: cleaned } : {}),
      ...(warning ? { additionalContext: `[Monsters] ${warning}.` } : {}),
    },
  };
}

/**
 * A tool of a service reached through Claude failed (D-074): Claude Code
 * sends `PostToolUseFailure` with the error, not `PostToolUse`. The error of
 * a third-party server is third-party text the model reads: it taints the
 * run and goes through the injection check. It cannot be replaced (the
 * event takes only `additionalContext`): a block that gives orders gets the
 * warning next to it.
 */
async function postToolUseFailure(
  input: ClaudeHookInput,
  ctx: HarnessHookContext,
  signal: AbortSignal,
): Promise<ClaudeHookOutput> {
  const name = input.tool_name ?? '';
  const mapped = harnessToolForGuard(name, input.tool_input, ctx.monstersServer);
  if (!mapped || mapped.tool.name === 'shell') return {};
  const raw = typeof input.error === 'string' ? input.error : leaves(input.error).join('\n');
  try {
    ctx.guard?.afterCall?.({ tool: mapped.tool, input: mapped.input, output: { error: raw } });
  } catch {
    // The taint never stops a result.
  }
  const visible = stripInvisible(raw.slice(0, MAX_HOOK_TEXT_CHARS));
  if (!visible.text.trim() || !ctx.guard?.external) return {};
  const source = sourceOf(mapped.tool, mapped.input);
  const callEventId = ctx.callEvent(input.tool_use_id ?? '', name, input.tool_input ?? {});
  const checked = await ctx.guard
    .external({ tool: mapped.tool, source, body: visible.text, callEventId, signal })
    .catch(() => null);
  if (!checked?.warning && visible.hidden === 0) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: `[Monsters] ${checked?.warning ?? injectionWarning()}.`,
    },
  };
}

async function stop(input: ClaudeHookInput, ctx: HarnessHookContext): Promise<ClaudeHookOutput> {
  // Once per turn: the second stop after a reminder ends the turn.
  if (input.stop_hook_active || !ctx.onFinalAnswer) return {};
  const text = input.last_assistant_message ?? ctx.lastText();
  if (!text.trim()) return {};
  let hooked: FinalAnswerHook;
  try {
    hooked = await ctx.onFinalAnswer(text);
  } catch {
    return {};
  }
  const reminder = typeof hooked === 'string' ? hooked : hooked?.text;
  if (!reminder) return {};
  ctx.log.append({
    agent: ctx.agentId,
    runId: ctx.runId,
    parentId: ctx.parentId,
    type: 'message',
    data: { role: 'system', text: reminder },
  });
  return { decision: 'block', reason: runAgentPrompts().systemReminder(reminder) };
}
