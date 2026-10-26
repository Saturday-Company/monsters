import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_PLAN_MODELS, settingsPath } from '@monsters/shared';
import { providerTexts } from '../providers.strings.ts';
import { RateBudget } from '../rate-budget.ts';
import type {
  HarnessEvent,
  HarnessProvider,
  HarnessTask,
  HarnessUsageEvent,
  ListModelsOptions,
  ModelInfo,
} from '../types.ts';
import { filterModels } from '../http.ts';
import { claudeRejection, parseClaudeRateLimit, resetPhrase } from './limits.ts';
import {
  collectStderr,
  directMcpEnv,
  exited,
  exitedWithin,
  HARNESS_TOOL_TIMEOUT_MS,
  harnessEnv,
  parseJsonLine,
  plainSpawn,
  readLines,
  runOnce,
  stopChild,
  type HarnessBinary,
} from './common.ts';

/*
 * Harness "Claude Agent" (D-005 with the recheck of 14/10/2026, research 06
 * §1, D-035): Monsters runs the official, unmodified Claude Code binary — the
 * `claude` the user already has, or the one bundled with
 * `@anthropic-ai/claude-agent-sdk`, installed only when the user asks (its
 * license is proprietary) — with the login the user made in a terminal
 * (`claude`, then `/login`).
 *
 * What Monsters never does: offer a Claude login, run `setup-token`, set or
 * read `CLAUDE_CODE_OAUTH_TOKEN`, read anything under `~/.claude`, pass
 * `--bare` (it skips the subscription login). The login is checked by asking
 * the binary (`claude auth status`). The child's environment loses
 * `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` (in `-p` an API key always
 * wins over the subscription and bills per use) and every key or setting of
 * Monsters.
 *
 * The run speaks the binary's documented stream-json protocol (`-p
 * --input-format stream-json --output-format stream-json --verbose`), the same
 * the Agent SDK drives. Monsters' tools arrive through MCP (`--mcp-config`,
 * `--strict-mcp-config`); in `dontAsk` mode only those are pre-approved, plus
 * the built-in terminal and file tools when the agent has the `shell`
 * permission, and the built-in `WebSearch` when it has the web (D-069).
 *
 * D-069: a `--settings` file of the run (0600, like the MCP config) holds
 * HTTP hooks to the core (`PreToolUse` on the terminal, the web search and the
 * services reached through Claude, then every other built-in so that at a
 * limit the core refuses all of them and asks for the report (D-170),
 * `PostToolUse` on the web search and the services (D-073: taint and
 * injections), `Stop` for "finito davvero?") and, when
 * the user chose claude.ai connectors, the `allowedMcpServers` list that
 * admits only those: then `--strict-mcp-config` is left out, because it
 * excludes the connectors too.
 *
 * D-079: `--setting-sources ""` loads no settings file at all, neither the
 * user's nor the working folder's: with `project,local` a run could write
 * `{"disableAllHooks":true}` in `.claude/settings.local.json` of its own
 * folder and the next run lost the hooks (lockout, brake, taint), checked on
 * 2.1.301; `env`, `apiKeyHelper` or hooks of its own would have loaded too.
 * Only the run's `--settings` file applies (it also says
 * `disableAllHooks: false`), and the agent's AGENTS.md reaches the model in
 * the appended system prompt, since CLAUDE.md is not read without `project`.
 * The `PreToolUse` hook fails closed (`onFailure: "block"`): a core that
 * cannot answer stops the tool instead of letting it run.
 */

/** No settings files (D-079): only `--settings`, and managed policy, apply. */
export const CLAUDE_SETTING_SOURCES = '';

/**
 * Files of a working folder that Claude Code (or Codex) would read as its own
 * configuration or instructions: the run never writes them (D-079), and the
 * core removes them before each run.
 */
export const HARNESS_CONFIG_FILES = [
  '.claude',
  '.mcp.json',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
  '.codex',
] as const;

export const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
/** Exact version, published at least two weeks before it was pinned (30/09/2026). */
export const CLAUDE_AGENT_SDK_VERSION = '0.3.286';
/** `dist.integrity` of that version on registry.npmjs.org (checked after the install). */
export const CLAUDE_AGENT_SDK_INTEGRITY =
  'sha512-InL/UNmRGSwBM/81PME0J0TZDsDBBlweWqRZgq2XSViSIg2hBi8nIL8j9Hm6MHRH85wgDJQE5n6Vo/r9hIO0NQ==';

/** Variables removed from the Claude child in subscription mode (besides Monsters' own). */
export const CLAUDE_DROPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

/** `MCP_TIMEOUT` of a run: how long the `monsters` server may take to connect (D-160). */
export const CLAUDE_MCP_STARTUP_MS = 60_000;

/** Built-in tools pre-approved when the agent may use the terminal and files. */
const SYSTEM_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'LS'];
/**
 * Built-in tools that take a path: the core's `PreToolUse` hook keeps them out
 * of the data folder of Monsters (D-078). Only `SYSTEM_TOOLS` run (`dontAsk`),
 * the others are listed in case a version allows them.
 */
const FILE_TOOLS = ['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep', 'LS'];

/**
 * Environment of a run for Monsters' MCP tools (D-078): Claude Code 2.1.301
 * cut a call of a streamable-HTTP server after 60 s; a delegation lasts
 * minutes. `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`: a long call is never
 * turned into a background task the run would not wait for.
 *
 * The auto-compact window is left as it is (D-082): 2.1.301 takes
 * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (or `autoCompactWindow`) only as `auto` or
 * 100k-1M tokens and calls `auto` the right one for the model; every run of
 * Monsters is a new session, the conversation goes in the appended prompt
 * (summary first, 6000 characters), so a run only grows with its own steps.
 */
export function claudeMcpEnv(): Record<string, string> {
  const ms = String(HARNESS_TOOL_TIMEOUT_MS);
  return {
    // How long a server may take to connect (D-160): 30 s by default on 2.1.308, then
    // `failed`. A core busy at that moment (many runs starting at once) gets twice as long.
    MCP_TIMEOUT: String(CLAUDE_MCP_STARTUP_MS),
    MCP_TOOL_TIMEOUT: ms,
    CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: ms,
    CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '0',
  };
}

/**
 * A path as Claude Code's permission rules write an absolute one: `//` and
 * the path with `/` (on Windows `C:\x` becomes `//c/x`).
 */
export function claudeRulePath(path: string): string {
  const posix = path.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\//.exec(posix);
  const abs = drive ? `/${drive[1]!.toLowerCase()}/${posix.slice(3)}` : posix;
  return `/${abs.startsWith('/') ? abs : `/${abs}`}`.replace(/\/+$/, '');
}
/** The built-in web search (D-069): on the user's plan, for agents with the web. */
const WEB_SEARCH_TOOL = 'WebSearch';
/**
 * Claude Code's own ToolSearch (C.2, D-075): with it, the MCP tools past its
 * threshold wait for a search instead of filling every request. `--tools ''`
 * took it away too: a run with Anteiku's 124 tools sent ~61k tokens at the
 * first request on haiku, ~7.5k with it (probe of 16/10/2026).
 */
const TOOL_SEARCH_TOOL = 'ToolSearch';

/**
 * The built-in tools a run sees (`--tools`, D-127): exactly the ones it may
 * use. `--tools default` showed every built-in (WebSearch, WebFetch, Task,
 * Cron*, Workflow…) to an agent with the terminal, pre-approved or not: the
 * model picked one, `dontAsk` refused it with "STOP and explain to the user…
 * Let the user decide", and the monster told the user the web was denied
 * (19/10/2026, Claude Code 2.1.303). Nothing visible is ever refused by the
 * mode: TodoWrite and MultiEdit stay out (not pre-approved; 2.1.303 lists no
 * TodoWrite, and `LS` is dropped by it without error).
 */
export function claudeBuiltinTools(
  task: Pick<HarnessTask, 'systemTools' | 'webSearch' | 'readFiles' | 'plain' | 'sessionOutputs'>,
): string[] {
  if (task.plain) return [];
  // Without the terminal, `Read` opens the attached files and what the harness saved for the session.
  const reads =
    !task.systemTools && ((task.readFiles?.length ?? 0) > 0 || task.sessionOutputs !== undefined);
  return [
    ...(task.systemTools ? SYSTEM_TOOLS : reads ? ['Read'] : []),
    ...(task.webSearch ? [WEB_SEARCH_TOOL] : []),
    TOOL_SEARCH_TOOL,
  ];
}

const DONT_ASK_DENIAL =
  /Permission to use (\S+?) has been denied because Claude Code is running in don't ask mode/;

/**
 * The tool a refusal of `dontAsk` names (Claude Code 2.1.303: "Permission to
 * use WebSearch has been denied because Claude Code is running in don't ask
 * mode…"), or null. A tool outside the run's list: never the user's refusal.
 */
export function claudeDontAskDenial(text: string): string | null {
  return DONT_ASK_DENIAL.exec(text)?.[1] ?? null;
}

const RULE_DENIAL = /denied by your permission settings/i;

/**
 * A refusal of the run's deny rules (Claude Code 2.1.303: "File is in a
 * directory that is denied by your permission settings."): Monsters' fixed
 * rules (its data folder, the harness configuration of a folder, the folders
 * closed to the run, D-078/D-079), never a setting of the user. The binary
 * checks them before any hook (probe of 19/10/2026): only the words of the
 * log and the run's instructions can say it.
 */
export function claudeRuleDenial(text: string): boolean {
  return RULE_DENIAL.test(text);
}

/**
 * The `PreToolUse` matcher of the built-ins outside the run (D-127): a later
 * version may show a tool `--tools` does not name; the core then answers
 * "not one of your tools" instead of the mode's "let the user decide".
 * Checked on 2.1.303: matchers are JavaScript regular expressions (lookahead).
 */
export function claudeOutsideMatcher(builtins: readonly string[]): string {
  return `^(?!mcp__)(?!(?:${builtins.map(escapeRegex).join('|')})$).+$`;
}

/** How long a hook may hold a tool: the brake waits for the user's answer (the core answers first). */
export const CLAUDE_HOOK_TIMEOUT_S = 3600;
/** How long the check of a result may take (the injection check waits 1.5 s at most). */
const POST_HOOK_TIMEOUT_S = 30;
/** How long the stop hook may take ("finito davvero?" answers in seconds). */
const STOP_HOOK_TIMEOUT_S = 60;
/**
 * claude.ai connectors arrive after the start (fetched from the account): the
 * first request waits for them, at most this long (`CLAUDE_CODE_MCP_STARTUP_WAIT_MS`).
 */
const CONNECTOR_WAIT_MS = 10_000;

/**
 * The prefix of a server's tools as Claude Code names them: every character
 * outside letters, digits, `_` and `-` becomes `_` (`claude.ai Figma` →
 * `mcp__claude_ai_Figma`).
 */
export function claudeToolPrefix(server: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The settings file of a run (`--settings`, D-069), or null when nothing is
 * needed: HTTP hooks to the core (before the terminal, the web search and the
 * services reached through Claude; before stopping) and, when claude.ai
 * connectors are used, the allowlist that admits only those and Monsters'
 * own servers. Monsters' tools (`mcp__monsters__*`) are checked by the core
 * itself: no hook for them.
 */
export function claudeRunSettings(task: HarnessTask): Record<string, unknown> {
  const connectors = task.connectors ?? [];
  const claudeAi = connectors.filter((c) => c.kind === 'claude-ai');
  // Claude Code's automatic memory is off in a run (review of 18/10, M6): what it wrote in the
  // working folder would be loaded again outside D-079 and the run's taint.
  const settings: Record<string, unknown> = { autoMemoryEnabled: false };
  // A plain run (a summary: one turn, no tool) copies and condenses; extended thinking only adds
  // output tokens (D-169).
  if (task.plain) settings['alwaysThinkingEnabled'] = false;
  if (task.hooks) {
    const { url, token } = task.hooks;
    const http = (timeout: number, failClosed = false) => ({
      type: 'http',
      url,
      headers: { Authorization: `Bearer ${token}` },
      timeout,
      // A core that cannot answer (down, error, timeout) blocks the tool (D-079).
      ...(failClosed ? { onFailure: 'block' } : {}),
    });
    const watched = [
      ...(task.systemTools ? ['Bash'] : []),
      ...(task.webSearch ? [WEB_SEARCH_TOOL] : []),
      ...connectors.map((c) => `${escapeRegex(claudeToolPrefix(c.name))}__.*`),
    ];
    // The file tools pass the hook too: the core keeps them out of Monsters' data (D-078).
    const before = [...watched, ...(task.systemTools ? FILE_TOOLS : [])];
    const hooks: Record<string, unknown> = {};
    const pre: Record<string, unknown>[] = [];
    if (before.length > 0) {
      pre.push({ matcher: `^(${before.join('|')})$`, hooks: [http(CLAUDE_HOOK_TIMEOUT_S, true)] });
    }
    if (!task.plain) {
      const readsOnly = !task.systemTools && claudeBuiltinTools(task).includes('Read');
      /*
       * The run's built-ins no other matcher covers (`ToolSearch`): with them every tool of the
       * run reaches a hook (Monsters' own are checked by the core), so at a limit the core can
       * refuse them all and ask for the report (D-170). One call on 127.0.0.1 per use, a few a
       * run; it fails open, since it guards nothing but the wrap-up.
       */
      const unwatched = claudeBuiltinTools(task).filter(
        (t) => !before.includes(t) && !(readsOnly && t === 'Read'),
      );
      if (unwatched.length > 0) {
        pre.push({
          matcher: `^(${unwatched.map(escapeRegex).join('|')})$`,
          hooks: [http(POST_HOOK_TIMEOUT_S)],
        });
      }
      // A built-in outside the run's list (D-127): the core says it is not the run's, not the user's no.
      pre.push({
        matcher: claudeOutsideMatcher(claudeBuiltinTools(task)),
        hooks: [http(POST_HOOK_TIMEOUT_S, true)],
      });
      // `Read` of the attached files only (no terminal): another path gets the core's words too.
      if (readsOnly) {
        pre.push({ matcher: '^Read$', hooks: [http(POST_HOOK_TIMEOUT_S, true)] });
      }
    }
    if (pre.length > 0) hooks['PreToolUse'] = pre;
    // Third-party results (D-073): the run's taint and the injection check, never the terminal.
    const read = watched.filter((w) => w !== 'Bash');
    if (read.length > 0) {
      hooks['PostToolUse'] = [
        { matcher: `^(${read.join('|')})$`, hooks: [http(POST_HOOK_TIMEOUT_S)] },
      ];
      // A failed call (the error of a service: Claude Code 2.1.301 sends it here,
      // not to PostToolUse, with `error` in place of `tool_response`), D-074.
      hooks['PostToolUseFailure'] = [
        { matcher: `^(${read.join('|')})$`, hooks: [http(POST_HOOK_TIMEOUT_S)] },
      ];
    }
    if (task.hooks.stop) hooks['Stop'] = [{ hooks: [http(STOP_HOOK_TIMEOUT_S)] }];
    if (Object.keys(hooks).length > 0) {
      settings['hooks'] = hooks;
      // Nothing else may switch them off (D-079): flag settings win over the others.
      settings['disableAllHooks'] = false;
    }
  }
  const forbidden = task.systemTools ? (task.forbiddenPaths ?? []) : [];
  const saved = task.sessionOutputs ? claudeRulePath(task.sessionOutputs) : undefined;
  const deny = forbidden.flatMap((p) => {
    // A second layer under the hook (D-078): Read rules cover Grep, Glob and LS, Edit rules every edit.
    const rule = claudeRulePath(p);
    if (rule === saved) {
      // Claude Code's own sessions: a deny always wins over the hook, so reading is left to the hook
      // (the current session's `tool-results/` only, D-198); writing stays denied, and so do the
      // transcripts (`<project>/<session>.jsonl`), the part with the prompts and the notes read.
      return [`Read(${rule}/*/*.jsonl)`, `Edit(${rule})`, `Edit(${rule}/**)`];
    }
    return [`Read(${rule})`, `Read(${rule}/**)`, `Edit(${rule})`, `Edit(${rule}/**)`];
  });
  if (task.systemTools) {
    // The configuration of the working folder is never written by the run (D-079).
    for (const name of HARNESS_CONFIG_FILES) {
      const rule = claudeRulePath(join(task.cwd, name));
      const folder = name === '.claude' || name === '.codex';
      deny.push(`Edit(${rule})`, ...(folder ? [`Edit(${rule}/**)`] : []));
    }
  }
  if (deny.length > 0) settings['permissions'] = { deny };
  if (claudeAi.length > 0) {
    // Without --strict-mcp-config every connector of the account would load:
    // only Monsters' servers and the connectors the user chose are admitted.
    // Once the list holds a `serverUrl`, Claude Code admits a remote server only by its address:
    // a `serverName` alone left Monsters' own server out, and the run went on without the vault,
    // the web and the delegation (2.1.308, 26/10/2026). Each server goes in by name and address.
    const http = connectors.filter((c) => c.kind === 'http');
    settings['allowedMcpServers'] = [
      { serverName: task.mcp.name },
      { serverUrl: task.mcp.url },
      ...http.flatMap((c) => [{ serverName: c.name }, { serverUrl: c.url }]),
      ...claudeAi.map((c) => ({ serverUrl: c.url })),
    ];
  }
  return settings;
}

/**
 * Model aliases the binary understands (it resolves them to the current
 * models). Verified on Claude Code 2.1.302, 17/10/2026: `haiku` →
 * claude-haiku-5-5, `sonnet` → claude-sonnet-5-5, `opus` → claude-opus-5-5,
 * each with a 1M window (the compaction at 75% counts on it).
 */
function claudeModels(): ModelInfo[] {
  return (
    [...CLAUDE_PLAN_MODELS]
      // The default first (the onboarding and a new link take the first one): Sonnet.
      .sort((a, b) => Number(b.id === 'sonnet') - Number(a.id === 'sonnet'))
      // The description follows the app's language: picked each time the list is asked.
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        tools: true,
        free: false,
        context: m.context,
      }))
  );
}

/**
 * The model of the same plan to try when `model` reached the plan's limit
 * (`usage_limit`, D-093): Opus → Sonnet. Never another service (D-035).
 */
export function claudePlanFallback(model: string): string | undefined {
  return /(^|[-_])opus($|[-_])/i.test(model) ? 'sonnet' : undefined;
}

export type ClaudeLoginState =
  /** No `claude` found and the SDK is not installed. */
  | 'not_found'
  /** The binary answers but nobody is logged in. */
  | 'logged_out'
  /** Logged in with a Claude plan (`claude.ai`, or a token the user set up). */
  | 'subscription'
  /** The binary would use an API key: per-use billing, not the subscription. */
  | 'api_key'
  /** Cloud provider or another method set up by the user. */
  | 'other'
  | 'error';

export interface ClaudeStatus {
  state: ClaudeLoginState;
  /** `authMethod` reported by `claude auth status`. */
  authMethod?: string;
  version?: string;
  binary?: { source: HarnessBinary['source']; path: string };
  message?: string;
}

export interface ClaudeAgentHarnessOptions {
  id?: string;
  /** Where the binary is (configured path, PATH, SDK installed by Monsters). */
  binary: () => HarnessBinary | null;
  /** The user's environment (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Values equal to Monsters' secrets are removed from the child's environment. */
  isSecret?: (name: string, value: string) => boolean;
  /** How long the binary may take to exit after its answer before it is killed (default 5 s). */
  exitGraceMs?: number;
}

/** A claude.ai connector as `claude mcp get` describes it (D-069). */
export interface ClaudeConnectorStatus {
  /**
   * connected; needs_login (on the account, to sign in again); missing (not on the account);
   * error (the binary said it failed); unknown (the text was not recognised: not an error).
   */
  state: 'connected' | 'needs_login' | 'missing' | 'error' | 'unknown';
  message?: string;
}

/** Reads the answer of `claude mcp get "claude.ai <name>"` (exit code and text). */
export function parseConnectorStatus(code: number | null, text: string): ClaudeConnectorStatus {
  if (/no mcp server named/i.test(text)) return { state: 'missing' };
  const status = /status:\s*(.+)/i.exec(text)?.[1]?.trim() ?? '';
  if (/needs authentication|needs auth|authenticate/i.test(status)) return { state: 'needs_login' };
  if (code === 0 && /connected/i.test(status) && !/disconnected|not connected/i.test(status)) {
    return { state: 'connected' };
  }
  const message = (status || text.trim().split('\n').at(-1) || providerTexts().noAnswer).slice(
    0,
    200,
  );
  // A refusal the binary words itself is an error; wording we do not know (a new version of the
  // CLI) is "unknown": it says nothing about the account (C-10).
  if (
    /fail|error|unreachable|timed? ?out|disconnected|not connected|refused|✗|✘/i.test(
      status || text,
    )
  ) {
    return { state: 'error', message };
  }
  return { state: 'unknown', ...(status ? { message } : {}) };
}

/** The environment of the Claude child in subscription mode. */
export function claudeEnv(
  base: NodeJS.ProcessEnv,
  isSecret?: (name: string, value: string) => boolean,
): Record<string, string> {
  return harnessEnv(base, { drop: CLAUDE_DROPPED_ENV, ...(isSecret ? { isSecret } : {}) });
}

function stateOf(authMethod: string | undefined, loggedIn: boolean): ClaudeLoginState {
  switch (authMethod) {
    case 'claude.ai':
    case 'oauth_token':
      return 'subscription';
    case 'api_key':
    case 'api_key_helper':
      return 'api_key';
    case 'third_party':
      return 'other';
    case 'none':
      return 'logged_out';
    default:
      return loggedIn ? 'other' : 'logged_out';
  }
}

/** How long the binary may take to exit after its result (or the end of its output). */
const EXIT_GRACE_MS = 5000;
/** At most one `heartbeat` event in this time. */
const HEARTBEAT_EVERY_MS = 5_000;

/** Signed out: the CLI's `authentication_error` or its «/login» hint, not any mention of authentication (an MCP connector's error). */
const NOT_LOGGED_IN = /not logged in|\/login|invalid api key|authentication_error/i;
/** The plan's limit by its words; a transient 429 («rate limit») is not it. */
const USAGE_LIMIT = /usage limit|limit reached/i;
/**
 * `--resume` of a session the binary no longer has (its transcript was cleaned up, another
 * config folder): it exits before the init with these words (2.1.308), nothing was asked.
 */
const RESUME_NOT_FOUND = /No conversation found with session ID/i;

/** Token counts of the Anthropic API (`usage` of a message, of `message_delta`, of `result`). */
interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

/** The part of the input read from and written to the prompt cache (part of `inTok`). */
function cacheSplit(
  read: number,
  write: number,
): { cacheReadTok?: number; cacheWriteTok?: number } {
  return {
    ...(read > 0 ? { cacheReadTok: read } : {}),
    ...(write > 0 ? { cacheWriteTok: write } : {}),
  };
}

interface RequestUsage {
  model: string;
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
  done: boolean;
}

/**
 * Usage of the model requests of a run: one `usage` event per request, with
 * its final counts, as soon as the request ends. The `assistant` messages
 * carry the counts of the request's start (output ~1 token); `message_delta`
 * in the stream carries the final ones (every field is cumulative: the larger
 * value wins), and the `result` the total of the turn, which the events then
 * add up to (sub-agents included). Nothing is counted twice.
 */
class ClaudeUsage {
  readonly #requests = new Map<string, RequestUsage>();
  readonly #fallbackModel: string;
  #current: RequestUsage | null = null;
  #in = 0;
  #out = 0;
  #cacheRead = 0;
  #cacheWrite = 0;
  #model: string;
  #stopped = false;

  constructor(model: string) {
    this.#fallbackModel = model;
    this.#model = model;
  }

  /**
   * Counts of request `id` seen so far (`message_start`, `assistant`). Returns
   * the event of the previous request when this one is new and that one was
   * still open (no `message_stop` without the partial messages).
   */
  update(
    id: string,
    model: string | undefined,
    usage: ApiUsage | undefined,
  ): HarnessUsageEvent | null {
    let req = this.#requests.get(id);
    let previous: HarnessUsageEvent | null = null;
    if (!req) {
      previous = this.flush();
      req = {
        model: model ?? this.#fallbackModel,
        input: 0,
        cacheRead: 0,
        cacheCreation: 0,
        output: 0,
        done: false,
      };
      this.#requests.set(id, req);
      this.#current = req;
    }
    if (model) req.model = model;
    if (usage && !req.done) ClaudeUsage.#merge(req, usage);
    return previous;
  }

  /** Final counts of the open request (`message_delta`). */
  delta(usage: ApiUsage | undefined): void {
    if (usage && this.#current && !this.#current.done) ClaudeUsage.#merge(this.#current, usage);
  }

  /** The open request is over (`message_stop`, `result`, end, abort): its event. */
  flush(): HarnessUsageEvent | null {
    const req = this.#current;
    this.#current = null;
    if (!req || req.done || this.#stopped) return null;
    req.done = true;
    const inTok = req.input + req.cacheRead + req.cacheCreation;
    if (inTok === 0 && req.output === 0) return null;
    this.#in += inTok;
    this.#out += req.output;
    this.#cacheRead += req.cacheRead;
    this.#cacheWrite += req.cacheCreation;
    this.#model = req.model;
    return {
      type: 'usage',
      model: req.model,
      inTok,
      outTok: req.output,
      ...cacheSplit(req.cacheRead, req.cacheCreation),
    };
  }

  /** The turn's total (`result.usage`): what the events have not counted yet. */
  total(usage: ApiUsage | undefined): HarnessUsageEvent | null {
    if (!usage || this.#stopped) return null;
    const inTok = Math.max(
      0,
      count(usage.input_tokens) +
        count(usage.cache_read_input_tokens) +
        count(usage.cache_creation_input_tokens) -
        this.#in,
    );
    const outTok = Math.max(0, count(usage.output_tokens) - this.#out);
    if (inTok === 0 && outTok === 0) return null;
    const read = Math.max(0, count(usage.cache_read_input_tokens) - this.#cacheRead);
    const write = Math.max(0, count(usage.cache_creation_input_tokens) - this.#cacheWrite);
    this.#in += inTok;
    this.#out += outTok;
    this.#cacheRead += read;
    this.#cacheWrite += write;
    return {
      type: 'usage',
      model: this.#model,
      inTok,
      outTok,
      ...cacheSplit(read, write),
      aggregate: true,
    };
  }

  /** No more events (the usage was handed over at the abort). */
  stop(): void {
    this.#stopped = true;
  }

  static #merge(req: RequestUsage, u: ApiUsage): void {
    req.input = Math.max(req.input, count(u.input_tokens));
    req.cacheRead = Math.max(req.cacheRead, count(u.cache_read_input_tokens));
    req.cacheCreation = Math.max(req.cacheCreation, count(u.cache_creation_input_tokens));
    req.output = Math.max(req.output, count(u.output_tokens));
  }
}

function textOfToolContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text : undefined))
    .filter((t): t is string => typeof t === 'string');
  return texts.length === content.length ? texts.join('\n') : content;
}

export class ClaudeAgentHarness implements HarnessProvider {
  readonly kind = 'harness';
  readonly auth = 'external-login';
  readonly id: string;
  readonly budget: RateBudget;
  readonly #o: ClaudeAgentHarnessOptions;

  constructor(options: ClaudeAgentHarnessOptions) {
    this.id = options.id ?? 'claude-agent';
    this.#o = options;
    // Limits belong to the user's plan and are enforced by Anthropic: none made up here.
    this.budget = new RateBudget({ id: this.id, windows: [], limitScope: 'account' });
  }

  get #env(): Record<string, string> {
    return claudeEnv(this.#o.env ?? process.env, this.#o.isSecret);
  }

  listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    return Promise.resolve(filterModels(claudeModels(), options));
  }

  /** Asks the binary (`claude auth status`, `claude --version`): never reads its files. */
  async status(): Promise<ClaudeStatus> {
    const binary = this.#o.binary();
    if (!binary) return { state: 'not_found' };
    const where = { source: binary.source, path: binary.args.at(-1) ?? binary.command };
    try {
      const env = this.#env;
      const version = await runOnce(binary, ['--version'], { env, timeoutMs: 15_000 });
      const auth = await runOnce(binary, ['auth', 'status'], { env, timeoutMs: 20_000 });
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(auth.stdout) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      const authMethod =
        typeof parsed?.['authMethod'] === 'string' ? parsed['authMethod'] : undefined;
      const loggedIn =
        typeof parsed?.['loggedIn'] === 'boolean' ? parsed['loggedIn'] : auth.code === 0;
      const v = version.stdout.trim().split(/\s+/)[0];
      return {
        state: auth.code === 0 || parsed ? stateOf(authMethod, loggedIn) : 'error',
        ...(authMethod ? { authMethod } : {}),
        ...(v ? { version: v } : {}),
        binary: where,
        ...(auth.code !== 0 && !parsed && auth.stderr.trim()
          ? { message: auth.stderr.trim().slice(0, 300) }
          : {}),
      };
    } catch (err) {
      return { state: 'error', binary: where, message: (err as Error).message };
    }
  }

  /**
   * State of a claude.ai connector on the user's account (D-069), asked to
   * the binary (`claude mcp get "claude.ai <name>"`, which also tries the
   * connection): never read from Claude Code's files.
   */
  async connectorStatus(name: string, cwd: string): Promise<ClaudeConnectorStatus> {
    const binary = this.#o.binary();
    if (!binary) return { state: 'error', message: providerTexts().claudeMissing };
    try {
      const r = await runOnce(binary, ['mcp', 'get', `claude.ai ${name}`], {
        env: this.#env,
        cwd,
        timeoutMs: 45_000,
      });
      return parseConnectorStatus(r.code, `${r.stdout}\n${r.stderr}`);
    } catch (err) {
      return { state: 'error', message: (err as Error).message };
    }
  }

  /**
   * State of first-party servers Claude Code signs in to itself (Claude
   * Design, D-069): a run that only starts them (`--strict-mcp-config`, no
   * tools) and stops at its `init`, which lists how each one connected.
   */
  async probeServers(
    servers: { name: string; url: string }[],
    dir: string,
  ): Promise<Record<string, string>> {
    const binary = this.#o.binary();
    if (!binary || servers.length === 0) return {};
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const config = join(dir, 'probe-mcp.json');
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: Object.fromEntries(servers.map((s) => [s.name, { type: 'http', url: s.url }])),
      }),
      { mode: 0o600 },
    );
    const child = plainSpawn(
      binary.command,
      [
        ...binary.args,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--mcp-config',
        config,
        '--strict-mcp-config',
        '--tools',
        '',
        '--setting-sources',
        CLAUDE_SETTING_SOURCES,
        '--permission-mode',
        'dontAsk',
        '--model',
        'haiku',
        '--max-turns',
        '1',
        '--no-session-persistence',
        'ok',
      ],
      { cwd: dir, env: { ...this.#env, ...binary.env }, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const exit = exited(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    const out: Record<string, string> = {};
    try {
      for await (const line of readLines(child.stdout!)) {
        const msg = parseJsonLine(line);
        if (msg?.['type'] !== 'system' || msg['subtype'] !== 'init') continue;
        for (const s of (msg['mcp_servers'] ?? []) as { name?: unknown; status?: unknown }[]) {
          if (typeof s.name === 'string' && typeof s.status === 'string') out[s.name] = s.status;
        }
        // Only the start was needed: no model request is left to run.
        break;
      }
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exitedWithin(child, exit, 2000);
    }
    return out;
  }

  /** Arguments of a run (exported for the tests: never `--bare`). */
  static args(
    task: HarnessTask,
    files: { mcpConfig: string; instructions?: string; settings?: string },
  ): string[] {
    const connectors = task.connectors ?? [];
    // claude.ai connectors are not loaded with --strict-mcp-config: the
    // allowlist of the settings file admits only the chosen ones instead.
    const strict = !connectors.some((c) => c.kind === 'claude-ai');
    // Files the user attached (images, PDF): `Read` on exactly those paths, also without the terminal.
    const reads = task.systemTools ? [] : (task.readFiles ?? []);
    // Exactly the built-ins the run may use, never `default` (D-127).
    const builtins = claudeBuiltinTools(task).join(',');
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--mcp-config',
      files.mcpConfig,
      ...(strict ? ['--strict-mcp-config'] : []),
      // Nobody answers prompts in a run: only what is listed below may run.
      '--permission-mode',
      'dontAsk',
      ...(task.plain
        ? []
        : [
            '--allowedTools',
            `mcp__${task.mcp.name}`,
            ...(task.systemTools ? SYSTEM_TOOLS : []),
            ...reads.map((p) => `Read(${claudeRulePath(p)})`),
            // Without the terminal: what the harness saved for the session (the hook narrows it to the current one).
            ...(!task.systemTools && task.sessionOutputs
              ? [`Read(${claudeRulePath(task.sessionOutputs)}/*/*/tool-results/**)`]
              : []),
            // WebFetch stays off: pages go through Monsters' web_fetch (SSRF, <dati_esterni>).
            ...(task.webSearch ? [WEB_SEARCH_TOOL] : []),
            ...connectors.map((c) => claudeToolPrefix(c.name)),
          ]),
      '--tools',
      builtins,
      // No settings file, the user's or the working folder's (D-079): only --settings.
      '--setting-sources',
      CLAUDE_SETTING_SOURCES,
    ];
    if (files.settings) args.push('--settings', files.settings);
    if (files.instructions) args.push('--append-system-prompt-file', files.instructions);
    if (task.model) args.push('--model', task.model);
    // Verified on 2.1.302 (`claude --help`): low, medium, high, xhigh, max (D-110).
    if (task.effort) args.push('--effort', task.effort);
    if (task.resume) args.push('--resume', task.resume);
    if (task.maxTurns) args.push('--max-turns', String(task.maxTurns));
    return args;
  }

  async *run(task: HarnessTask, signal: AbortSignal): AsyncGenerator<HarnessEvent> {
    const binary = this.#o.binary();
    if (!binary) {
      yield {
        type: 'done',
        reason: 'error',
        code: 'not_found',
        error: providerTexts().claudeMissingRun(settingsPath('modelli')),
      };
      return;
    }
    signal.throwIfAborted();
    mkdirSync(task.scratchDir, { recursive: true, mode: 0o700 });
    const mcpConfig = join(task.scratchDir, 'mcp.json');
    // The run's MCP token goes in a private file, not on the command line (visible in `ps`).
    const connectors = task.connectors ?? [];
    writeFileSync(
      mcpConfig,
      JSON.stringify({
        mcpServers: task.plain
          ? {}
          : {
              [task.mcp.name]: {
                type: 'http',
                url: task.mcp.url,
                headers: { Authorization: `Bearer ${task.mcp.token}` },
                // Per-server tool timeout (D-078): without it a call was cut at 60 s.
                timeout: HARNESS_TOOL_TIMEOUT_MS,
              },
              // First-party servers Claude Code signs in to with its own login (no header here).
              ...Object.fromEntries(
                connectors
                  .filter((c) => c.kind === 'http')
                  .map((c) => [c.name, { type: 'http', url: c.url }]),
              ),
            },
      }),
      { mode: 0o600 },
    );
    let instructions: string | undefined;
    if (task.instructions) {
      instructions = join(task.scratchDir, 'instructions.md');
      writeFileSync(instructions, task.instructions, { mode: 0o600 });
    }
    // The hook token too stays off the command line.
    const settings = join(task.scratchDir, 'settings.json');
    writeFileSync(settings, JSON.stringify(claudeRunSettings(task)), { mode: 0o600 });
    const child = task.spawn(
      binary.command,
      [
        ...binary.args,
        ...ClaudeAgentHarness.args(task, {
          mcpConfig,
          ...(instructions ? { instructions } : {}),
          settings,
        }),
      ],
      {
        cwd: task.cwd,
        env: {
          ...this.#env,
          ...binary.env,
          ...claudeMcpEnv(),
          // Behind a proxy the core's endpoint is still reached directly (D-160).
          ...directMcpEnv({ ...this.#env, ...binary.env }, task.mcp.url),
          // Belt and braces with `autoMemoryEnabled` of the run's settings (M6).
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          ...(connectors.some((c) => c.kind === 'claude-ai')
            ? { CLAUDE_CODE_MCP_STARTUP_WAIT_MS: String(CONNECTOR_WAIT_MS) }
            : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const stderr = collectStderr(child);
    const exit = exited(child);
    const usage = new ClaudeUsage(task.model ?? 'claude');
    const onAbort = () => {
      // The request in flight goes to the caller now, before a kill closes the run.
      if (task.onAbortUsage) {
        const last = usage.flush();
        usage.stop();
        if (last) task.onAbortUsage(last);
      }
      stopChild(child, 'SIGINT');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdin?.on('error', () => {});
    child.stdin?.end(
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: task.prompt },
        parent_tool_use_id: null,
        session_id: task.resume ?? '',
      })}\n`,
    );

    const toolNames = new Map<string, string>();
    let done: HarnessEvent | null = null;
    /** Reset time (ms) of the latest window that refused a request of this run. */
    let rejectedUntil: number | null = null;
    /** A `rate_limit_event` said the plan refused a request of this run: the only sure sign of the usage limit. */
    let planRejected = false;
    const monsters = `mcp__${task.mcp.name}__`;
    let lastBeat = 0;
    try {
      for await (const line of readLines(child.stdout!)) {
        // Stopped: what the binary still prints is not part of the run.
        if (signal.aborted) break;
        const msg = parseJsonLine(line);
        if (!msg) continue;
        // Sub-agents of Claude Code: their inner messages stay inside the harness, only a sign
        // of life for the runner's watchdog (their `Task` call is open meanwhile).
        if (msg['parent_tool_use_id']) {
          if (Date.now() - lastBeat >= HEARTBEAT_EVERY_MS) {
            lastBeat = Date.now();
            yield { type: 'heartbeat' };
          }
          continue;
        }
        switch (msg['type']) {
          case 'system':
            if (msg['subtype'] === 'init' && typeof msg['session_id'] === 'string') {
              yield {
                type: 'session',
                id: msg['session_id'],
                ...(typeof msg['model'] === 'string' ? { model: msg['model'] } : {}),
              };
              // The init comes once the servers settled (or `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`
              // passed: then `pending`), before any model request (D-160, checked on 2.1.308).
              const servers: Record<string, string> = {};
              for (const s of Array.isArray(msg['mcp_servers'])
                ? (msg['mcp_servers'] as { name?: unknown; status?: unknown }[])
                : []) {
                if (typeof s.name === 'string' && typeof s.status === 'string') {
                  servers[s.name] = s.status;
                }
              }
              // Left out of the init, Monsters' server is not coming: a setting kept it out (the
              // allowlist of 26/10/2026), and the run would go on without the vault, the web
              // and the team. Said as `missing`, the runner stops it as a failed server.
              if (!task.plain && !(task.mcp.name in servers)) servers[task.mcp.name] = 'missing';
              if (Object.keys(servers).length > 0) yield { type: 'mcp-status', servers };
            }
            break;
          case 'rate_limit_event': {
            // D-111: the plan's limits, as the binary prints them (nothing is asked for).
            const rejected = claudeRejection(msg);
            if (rejected) planRejected = true;
            if (rejected?.resetsAt) rejectedUntil = rejected.resetsAt;
            const reading = parseClaudeRateLimit(msg);
            if (reading) yield { type: 'plan-limits', reading };
            break;
          }
          case 'stream_event': {
            const ev = (msg['event'] ?? {}) as {
              type?: string;
              delta?: { type?: string; text?: string };
              message?: { id?: string; model?: string; usage?: ApiUsage };
              usage?: ApiUsage;
            };
            if (
              ev.type === 'content_block_delta' &&
              ev.delta?.type === 'text_delta' &&
              ev.delta.text
            ) {
              yield { type: 'text-delta', delta: ev.delta.text };
            } else if (ev.type === 'message_start' && ev.message?.id) {
              const previous = usage.update(ev.message.id, ev.message.model, ev.message.usage);
              if (previous) yield previous;
            } else if (ev.type === 'message_delta') {
              usage.delta(ev.usage);
            } else if (ev.type === 'message_stop') {
              const last = usage.flush();
              if (last) yield last;
            }
            break;
          }
          case 'assistant': {
            const m = (msg['message'] ?? {}) as {
              id?: string;
              model?: string;
              content?: {
                type?: string;
                text?: string;
                id?: string;
                name?: string;
                input?: unknown;
              }[];
              usage?: ApiUsage;
            };
            if (m.id) {
              const previous = usage.update(m.id, m.model, m.usage);
              if (previous) yield previous;
            }
            for (const block of m.content ?? []) {
              if (block.type === 'text' && block.text) yield { type: 'text', text: block.text };
              else if (block.type === 'tool_use' && block.id && block.name) {
                toolNames.set(block.id, block.name);
                yield {
                  type: 'tool-call',
                  id: block.id,
                  name: block.name.startsWith(monsters)
                    ? block.name.slice(monsters.length)
                    : block.name,
                  input: block.input ?? {},
                  ...(block.name.startsWith(monsters) ? { monsters: true } : {}),
                };
              }
            }
            break;
          }
          case 'user': {
            const m = (msg['message'] ?? {}) as {
              content?:
                | { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]
                | string;
            };
            if (!Array.isArray(m.content)) break;
            for (const block of m.content) {
              if (block.type !== 'tool_result' || !block.tool_use_id) continue;
              const name = toolNames.get(block.tool_use_id) ?? '';
              yield {
                type: 'tool-result',
                id: block.tool_use_id,
                output: textOfToolContent(block.content),
                ...(block.is_error ? { isError: true } : {}),
                ...(name.startsWith(monsters) ? { monsters: true } : {}),
              };
            }
            break;
          }
          case 'result': {
            const subtype = typeof msg['subtype'] === 'string' ? msg['subtype'] : '';
            const isError = msg['is_error'] === true;
            const text = typeof msg['result'] === 'string' ? msg['result'] : '';
            const errors = Array.isArray(msg['errors'])
              ? (msg['errors'] as unknown[]).map(String)
              : [];
            if (subtype === 'success' && !isError) {
              done = { type: 'done', reason: 'stop', text };
            } else if (subtype === 'error_max_turns') {
              done = { type: 'done', reason: 'max-steps', ...(text ? { text } : {}) };
            } else {
              let error = (errors.join('; ') || text || subtype || 'Claude Code failed').slice(
                0,
                2000,
              );
              // The window that refused the request says when it opens again.
              if (
                (planRejected || USAGE_LIMIT.test(error)) &&
                !/resets?\b|ripristin/i.test(error) &&
                rejectedUntil &&
                rejectedUntil > Date.now()
              ) {
                error = `${error} ${providerTexts().resetsAt(resetPhrase(rejectedUntil, Date.now()))}`;
              }
              done = {
                type: 'done',
                reason: 'error',
                error,
                ...(task.resume && RESUME_NOT_FOUND.test(error)
                  ? { code: 'resume_not_found' }
                  : NOT_LOGGED_IN.test(error)
                    ? { code: 'not_logged_in' }
                    : planRejected || USAGE_LIMIT.test(error)
                      ? { code: 'usage_limit' }
                      : {}),
              };
            }
            // Calls the run's rules refused (D-127): the core says why, never "the user denied".
            const denials = Array.isArray(msg['permission_denials'])
              ? (msg['permission_denials'] as { tool_name?: unknown; tool_use_id?: unknown }[])
                  .filter(
                    (d) => typeof d.tool_name === 'string' && typeof d.tool_use_id === 'string',
                  )
                  .map((d) => ({ tool: d.tool_name as string, id: d.tool_use_id as string }))
              : [];
            if (denials.length > 0) done = { ...done, denials };
            // The request still open, then what only the turn's total counts.
            const before = usage.flush();
            if (before) yield before;
            const rest = usage.total(msg['usage'] as ApiUsage | undefined);
            if (rest) yield rest;
            break;
          }
          default:
            break;
        }
        // The turn is over: nothing after the result matters, the process just has to go.
        if (done) break;
      }
      const last = usage.flush();
      if (last) yield last;
      const { code } = await exitedWithin(child, exit, this.#o.exitGraceMs ?? EXIT_GRACE_MS);
      // A complete answer stays one even when a stop arrived right after it.
      if (done?.reason === 'stop') {
        yield done;
      } else if (signal.aborted) {
        yield { type: 'done', reason: 'aborted' };
      } else if (done) {
        yield done;
      } else {
        const tail = stderr();
        yield {
          type: 'done',
          reason: 'error',
          error: providerTexts().claudeClosed(code, tail.slice(-500)),
          ...(task.resume && RESUME_NOT_FOUND.test(tail)
            ? { code: 'resume_not_found' }
            : NOT_LOGGED_IN.test(tail)
              ? { code: 'not_logged_in' }
              : {}),
        };
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (child.exitCode === null && child.signalCode === null) {
        stopChild(child, 'SIGINT');
        // One that ignores it is killed after the grace (never holds the run).
        void exitedWithin(child, exit, this.#o.exitGraceMs ?? EXIT_GRACE_MS);
      }
    }
  }
}
