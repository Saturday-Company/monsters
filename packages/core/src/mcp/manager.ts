import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Client,
  InsufficientScopeError,
  OAuthError,
  OAuthErrorCode,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
  type FetchLike,
  type Tool,
  type Transport,
} from '@modelcontextprotocol/client';
import {
  BROWSER_SERVER,
  McpServerNameSchema,
  ToolError,
  launcherOf,
  projectPagePath,
  settingsPath,
  MCP_CATALOG,
  toolHintsOf,
  type Channel,
  type McpOAuthStartResponse,
  type McpPausedTool,
  type McpServerRequest,
  type McpServerStatus,
  type McpServerView,
  type McpServersResponse,
  type McpTestResponse,
  type McpToolView,
  type MonstersTool,
  type ToolContext,
} from '@monsters/shared';
import { requireNodeRuntime } from '@monsters/shared/node';
import { isAgentSessionEnv, isMonstersEnv, type Resolver } from '@monsters/tools';
import type { AgentDefinition } from '../agents/definition.ts';
import { wrapExternalData } from '../agents/tool-adapter.ts';
import { writeSensitiveFile } from '../config.ts';
import type { StateStore } from '../db/state-store.ts';
import type { ControlScope } from '../kill/control-scope.ts';
import { HaltedError, type RunController } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { readSettingsFile } from '../onboarding/settings-file.ts';
import { SETTINGS_FILE } from '../team/settings.ts';
import { isFreeChain, type TeamService } from '../team/team-service.ts';
import {
  BROWSER_BLOCKED_TOOLS,
  BROWSER_CORE_TOOLS,
  McpServerSettingSchema,
  PLAYWRIGHT_MCP_PACKAGE,
  browserDir,
  browserEnv,
  browserFilesDir,
  assertPublicBrowserUrl,
  browserLaunch,
  inspectMcpSecrets,
  readMcpSecrets,
  removeMcpSecrets,
  saveMcpSecrets,
  type McpSecrets,
  type McpServerSetting,
} from './config.ts';
import { installBrowserPackage } from './browser-package.ts';
import {
  installPinnedPackage,
  pinnedEntry,
  pinnedServerOf,
  withUvDateLimit,
  type PinnedNpmServer,
} from './pinned-npm.ts';
import {
  PINNED_PYTHON_START_TIMEOUT_MS,
  installPinnedPython,
  pinnedPythonArgs,
  pinnedPythonExe,
  pinnedPythonServerOf,
  type PinnedPythonServer,
} from './pinned-python.ts';
import {
  McpOAuth,
  OAuthFlowError,
  OAuthServiceUnreachable,
  OAuthSignInNeeded,
  OAUTH_CALLBACK_PATH,
} from './oauth.ts';
import {
  agentToolNames,
  checkInputSchema,
  resultText,
  splitAgentToolName,
  type SchemaCheck,
} from './convert.ts';
import { mcpPrompts } from './mcp.prompts.ts';
import { mcpStrings } from './mcp.strings.ts';
import { ChildStdioTransport } from './stdio-transport.ts';

/*
 * Client of the MCP servers the user added (M2.5). One connection per server,
 * started lazily: at the first run of an agent that uses it when its tools are
 * not known yet, otherwise at the first call. A stdio server is a process of
 * the global kill scope (`RunController.serviceScope`): the kill switch stops it
 * with its descendants, and the next call after a resume starts it again.
 * Tools reach the agents as `mcp__<server>__<tool>`, with their results inside
 * `<dati_esterni fonte="mcp:<server>">`.
 *
 * Fingerprints (D-070, research 07 §5.9): at the first listing of a server
 * (and after the user changes how it starts) the name, description and
 * arguments of every tool are pinned. A later listing (reconnection,
 * `tools/list_changed`) that brings a new or changed tool pauses it until the
 * user accepts it ("Accetta" / "Scollega"), with a `security` event; a tool
 * taken away just goes. Gallery services are official servers that grow
 * often: their new tools and new arguments pass (with a line in Attività), a
 * changed description pauses like everywhere else, because the description is
 * what the model reads as instructions.
 */

export class McpError extends Error {
  readonly code: 'unknown_server' | 'invalid_server' | 'unknown_agent' | 'oauth_failed';
  constructor(code: McpError['code'], message: string) {
    super(message);
    this.name = 'McpError';
    this.code = code;
  }
}

/** Most MCP tools one agent gets: free models are confused by long tool lists (ARCHITECTURE §5.7). */
export const MAX_MCP_TOOLS = 40;
export const MAX_MCP_TOOLS_FREE = 12;
/**
 * A native monster loads MCP tools when it needs them (`tools_search`, C.2):
 * it may know many more than it is sent; this only bounds a server gone wild.
 */
export const MAX_MCP_TOOLS_DEFERRED = 400;
/** First start of a server: the browser preset downloads its package the first time. */
const START_TIMEOUT_MS = 60_000;
const BROWSER_START_TIMEOUT_MS = 180_000;
/** After a failed start, runs do not try again before this (the test button always does). */
const RETRY_AFTER_MS = 30_000;
/**
 * Failed starts in a row after which a server's tools stay out of the runs that start within
 * `RETRY_AFTER_MS`: before that its known tools stay in (a call in the pause says "not
 * available", one after it starts the server again), so a run that starts right after a
 * passing error has them back as soon as the server is (review of 18/10, item 10).
 */
const BROKEN_AFTER_FAILED_STARTS = 3;
/** Calls that time out in a row before the server process is restarted. */
const MAX_CONSECUTIVE_TIMEOUTS = 2;
/** Wait before the one new try of a read-only call that got a 5xx. */
export const RETRY_5XX_MS = 1_000;
/** What the card of a server says when its sign-in is gone. */
export const signInNeeded = (): string => mcpStrings().signInNeeded;

/** The sign-in button of the card, quoted in a hint for the model, in the app's language. */
const connectButton = (): string => mcpPrompts().button(mcpStrings().connectButton);
/** After a timeout, how long a ping may take before the process counts as stuck. */
const STUCK_PING_MS = 5_000;
/**
 * The timeout every server of the settings had before the gallery set its own (D-092): a
 * gallery server still on it gets the entry's (Blender: 600 s), once (review of 18/10, item 9).
 */
const DEFAULT_TIMEOUT_SEC = 60;
const TIMEOUT_RAISED_KEY = (name: string) => `mcp_timeout_raised:${name}`;
const MAX_DESCRIPTION = 1000;
const TOOLS_CACHE_KEY = (name: string) => `mcp_tools:${name}`;
const PINS_KEY = (name: string) => `mcp_pins:${name}`;
/** Longest description kept in a paused tool (for the card). */
const PAUSED_DESCRIPTION = 600;

/**
 * The read-only, destructive and file-writing hints of a tool: the gallery's
 * own (D-092: a move of Blender's view reads, a render writes a file the brake
 * checks like the monsters' writes) over the server's, but only on the server
 * of the entry itself: a tag on another program changes nothing.
 */
export function toolHintsFor(
  setting: Pick<McpServerSetting, 'catalog' | 'transport' | 'command' | 'args'>,
  tool: string,
  ann: Tool['annotations'],
): Pick<MonstersTool, 'readOnly' | 'destructive' | 'writesPath'> {
  const entry = MCP_CATALOG.find(
    (x) =>
      x.id === setting.catalog &&
      x.transport === 'stdio' &&
      setting.transport === 'stdio' &&
      x.command === setting.command &&
      x.args.join('\0') === setting.args.join('\0'),
  );
  const hint = toolHintsOf(entry?.toolHints, tool);
  if (hint === undefined) {
    return {
      ...(ann?.readOnlyHint !== undefined ? { readOnly: ann.readOnlyHint } : {}),
      ...(ann?.destructiveHint !== undefined ? { destructive: ann.destructiveHint } : {}),
    };
  }
  return 'readOnly' in hint
    ? { readOnly: true, destructive: false }
    : { readOnly: false, destructive: false, writesPath: hint.writesPath };
}

interface ToolPin {
  hash: string;
  /** Description as compared (spaces collapsed). */
  description: string;
  /** Hash of the arguments and the read-only/destructive hints. */
  schema: string;
  /**
   * The `description` fields inside the arguments, as compared (pins of before
   * the review of 16/10 do not have it). A model reads them like the tool's own.
   */
  argDescriptions?: string;
  /**
   * Hash of all the words of the arguments the model reads (D-074: titles,
   * defaults, examples, allowed values, names). Pins of before do not have it.
   */
  argText?: string;
  /** Hash of every string of the schema but types and references (`$comment`, `pattern`, `x-*`…). */
  argWords?: string;
}

interface PinState {
  /** Hash of how the server starts: another command or address pins again. */
  launch: string;
  tools: Record<string, ToolPin>;
  paused: Record<string, McpPausedTool & { pin: ToolPin }>;
}

/** JSON with sorted keys: the same schema always gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24);

const collapse = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Words of a schema the model reads besides `description` (D-074). */
const MODEL_TEXT_KEYS = new Set(['title', 'default', 'examples', 'example', 'enum', 'const']);
/** Strings of a schema that are structure, not words for the model. */
const STRUCTURE_KEYS = new Set([
  'type',
  'format',
  '$ref',
  '$schema',
  '$id',
  '$anchor',
  'contentEncoding',
  'contentMediaType',
]);
/** Keys whose own keys are names the model reads (the arguments' names). */
const NAMED_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

/**
 * Everything in a schema that reaches the model as words, with where it is:
 * descriptions, titles, defaults, examples, allowed values and the names of
 * the arguments. A change in any of them pauses a gallery tool too (review
 * of 16/10, D-074); a change of types or limits alone does not.
 */
export function schemaModelText(
  value: unknown,
  path = '',
  out: string[] = [],
  depth = 0,
  all = false,
): string[] {
  if (depth > 12 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => schemaModelText(v, `${path}[${i}]`, out, depth + 1, all));
    return out;
  }
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    const at = path ? `${path}.${k}` : k;
    if (k === 'description' && typeof v === 'string') out.push(`${path}: ${collapse(v)}`);
    else if (MODEL_TEXT_KEYS.has(k)) out.push(`${at}= ${collapse(canonical(v))}`);
    else if (all && typeof v === 'string' && !STRUCTURE_KEYS.has(k))
      out.push(`${at}~ ${collapse(v)}`);
    else {
      if (NAMED_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        out.push(`${at}# ${Object.keys(v).sort().join(',')}`);
      }
      schemaModelText(v, at, out, depth + 1, all);
    }
  }
  return out;
}

/** Every `description` string inside a schema, with where it is (`properties.to`). */
function nestedDescriptions(value: unknown, path = '', out: string[] = [], depth = 0): string[] {
  if (depth > 12 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => nestedDescriptions(v, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (k === 'description' && typeof v === 'string') out.push(`${path}: ${collapse(v)}`);
    else nestedDescriptions(v, path ? `${path}.${k}` : k, out, depth + 1);
  }
  return out;
}

/** The fingerprint of a tool: spaces and line breaks of the description do not count. */
export function toolPin(
  t: Pick<Tool, 'name' | 'description' | 'inputSchema' | 'annotations'>,
): ToolPin {
  const description = collapse(t.description ?? '');
  const schema = sha(
    canonical({
      input: t.inputSchema ?? null,
      readOnly: t.annotations?.readOnlyHint ?? null,
      destructive: t.annotations?.destructiveHint ?? null,
    }),
  );
  const argDescriptions = nestedDescriptions(t.inputSchema ?? null).join('\n');
  return {
    hash: sha(`${t.name}\n${description}\n${schema}`),
    description,
    schema,
    argDescriptions,
    argText: sha(schemaModelText(t.inputSchema ?? null).join('\n')),
    argWords: sha(schemaModelText(t.inputSchema ?? null, '', [], 0, true).join('\n')),
  };
}

interface CachedTools {
  /** Hash of what decides the tool list: a changed command or address invalidates it. */
  hash: string;
  server?: string;
  tools: Pick<Tool, 'name' | 'description' | 'inputSchema' | 'annotations'>[];
}

interface ToolEntry {
  tool: CachedTools['tools'][number];
  agentName: string;
  check: SchemaCheck;
}

type Launch =
  | {
      transport: 'stdio';
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    }
  | { transport: 'http'; url: string; headers: Record<string, string>; oauth: boolean };

function lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  ).slice(0, 300);
}

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  if (typeof e?.cause?.code === 'string') return e.cause.code;
  return typeof e?.code === 'string' ? e.code : undefined;
}

function isTimeout(err: unknown): boolean {
  return (
    (err instanceof SdkError && err.code === SdkErrorCode.RequestTimeout) ||
    (err as { name?: string } | null)?.name === 'TimeoutError'
  );
}

function isConnectionLost(err: unknown): boolean {
  return (
    err instanceof SdkError &&
    (err.code === SdkErrorCode.ConnectionClosed ||
      err.code === SdkErrorCode.NotConnected ||
      err.code === SdkErrorCode.SendFailed)
  );
}

/**
 * An HTTP server answered 404 to a request with our session id: it restarted
 * (or dropped the session) and did not run the request. The spec asks for a new
 * session; repeating the request once is safe.
 */
function isSessionExpired(err: unknown): boolean {
  return err instanceof SdkHttpError && err.status === 404;
}

const UNREACHABLE_OAUTH_CODES: ReadonlySet<string> = new Set([
  OAuthErrorCode.ServerError,
  OAuthErrorCode.TemporarilyUnavailable,
]);

/**
 * The tokens could not be renewed because the authorization server did not
 * answer (network, 5xx, `temporarily_unavailable`): the sign-in is still good.
 */
function isAuthUnreachable(err: unknown): boolean {
  return (
    err instanceof OAuthServiceUnreachable ||
    (err instanceof OAuthError && UNREACHABLE_OAUTH_CODES.has(err.code))
  );
}

/**
 * The service refused the credentials (sign-in gone, token revoked, 401/403):
 * only the user can fix it, retrying or changing the arguments never helps.
 */
function isAuthRefused(err: unknown): boolean {
  return (
    err instanceof OAuthSignInNeeded ||
    err instanceof UnauthorizedError ||
    err instanceof InsufficientScopeError ||
    (err instanceof OAuthError && !isAuthUnreachable(err)) ||
    (err instanceof SdkHttpError && (err.status === 401 || err.status === 403))
  );
}

/**
 * A 403 on one call (a resource the access does not reach, a scope it lacks, a firewall): the
 * sign-in or the headers are still good, the connection stays (review of 19/10, item 7).
 * At the start the same answer means the credentials are refused (`isAuthRefused`).
 */
function isCallForbidden(err: unknown): boolean {
  return (
    err instanceof InsufficientScopeError || (err instanceof SdkHttpError && err.status === 403)
  );
}

/**
 * A remote server answered the call with 429 or 5xx: the arguments are fine,
 * the service is not. The model must wait or move on, not rephrase and retry.
 */
export function httpFailure(server: string, err: unknown): ToolError | undefined {
  if (!(err instanceof SdkHttpError)) return undefined;
  if (err.status === 429) {
    return new ToolError(
      'RATE_LIMITED',
      `The MCP server "${server}" is rate limiting (HTTP 429).`,
      {
        hint: 'Too many requests: wait a while before calling it again, do not change the arguments.',
      },
    );
  }
  if (err.status >= 500) {
    return new ToolError(
      'UNAVAILABLE',
      `The MCP server "${server}" is having problems (HTTP ${err.status}).`,
      { hint: 'The service is in trouble, not your arguments: retry later or use another source.' },
    );
  }
  return undefined;
}

/** Waits for a promise shared with other callers, giving up (alone) when `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * One configured server and its live connection.
 *
 * Every start, stop and loss bumps `#generation`: an attempt or a client of an
 * older generation never touches the current state, so a call that comes in
 * while the server is being stopped starts a fresh connection with the current
 * setting, and the old one goes away on its own.
 */
class Connection {
  readonly name: string;
  setting: McpServerSetting;
  status: McpServerStatus = 'idle';
  error: string | undefined;
  serverInfo: string | undefined;
  /**
   * The service refused the credentials of a working sign-in (or headers):
   * nothing starts it again until the user signs in, changes it or tests it.
   */
  needsSignIn = false;
  #client: Client | undefined;
  /** Scope and transport of the current attempt or connection, for `stop`. */
  #scope: ControlScope | undefined;
  #transport: Transport | undefined;
  #connecting: Promise<void> | undefined;
  #entries: ToolEntry[] | undefined;
  #failedAt = 0;
  /** Starts that failed in a row (0 after a start that worked). */
  #failedStarts = 0;
  /** Calls in a row that hit the time limit: a process that never answers is restarted. */
  #timeouts = 0;

  async #answersPing(client: Client, signal: AbortSignal): Promise<boolean> {
    try {
      await client.ping({
        signal,
        timeout: Math.min(STUCK_PING_MS, this.setting.timeoutSec * 1000),
      });
      return true;
    } catch {
      return false;
    }
  }
  #generation = 0;
  /** Removed, or the core is shutting down: nothing starts any more. */
  #closed = false;
  #relisting: Promise<void> | undefined;
  #relistAgain = false;
  readonly #m: McpManager;

  constructor(name: string, setting: McpServerSetting, manager: McpManager) {
    this.name = name;
    this.setting = setting;
    this.#m = manager;
  }

  /** Failed to start less than `RETRY_AFTER_MS` ago: nobody tries again yet. */
  get failedRecently(): boolean {
    return this.status === 'error' && Date.now() - this.#failedAt < RETRY_AFTER_MS;
  }

  /** Failed to start `BROKEN_AFTER_FAILED_STARTS` times in a row, the last one just now. */
  get brokenNow(): boolean {
    return this.failedRecently && this.#failedStarts >= BROKEN_AFTER_FAILED_STARTS;
  }

  get connected(): boolean {
    return this.#client !== undefined && this.status === 'running';
  }

  /** The name the user knows the server by. */
  get label(): string {
    return this.setting.label ?? (this.setting.preset === 'browser' ? 'Browser' : this.name);
  }

  /** The service wants a new sign-in (or new headers): the model must ask the user, not retry. */
  signInError(): ToolError {
    return this.setting.oauth
      ? new ToolError(
          'NOT_LINKED',
          `${this.label} (MCP server "${this.name}") needs the user to sign in again.`,
          {
            hint: `Ask the user to reconnect ${this.label} (${settingsPath('altriProgrammi')} → ${connectButton()}); do not retry.`,
          },
        )
      : new ToolError(
          'NOT_LINKED',
          `${this.label} (MCP server "${this.name}") refused the access key.`,
          {
            hint: `Ask the user to check the access key of ${this.label} in ${settingsPath('altriProgrammi')}; do not retry.`,
          },
        );
  }

  get entries(): ToolEntry[] | undefined {
    return this.#entries;
  }

  /** Tools known for this configuration: from memory, the cache of the last connection, or a start. */
  async catalog(signal?: AbortSignal, force = false): Promise<ToolEntry[]> {
    if (!force && this.#entries) return this.#entries;
    if (!force) {
      const cached = this.#m.cachedTools(this);
      if (cached) {
        this.#entries = this.#m.toEntries(this.name, cached.tools);
        this.serverInfo ??= cached.server;
        return this.#entries;
      }
    }
    await this.ensure(signal, force);
    return this.#entries ?? [];
  }

  /**
   * Connects if needed. One attempt at a time, shared by every caller and not
   * tied to any caller's signal: a run that stops gives up waiting, the start
   * goes on for the others. After a failed start nobody tries again for
   * `RETRY_AFTER_MS`, except `force` (the test button), which also lists the
   * tools again on a live connection.
   */
  async ensure(signal?: AbortSignal, force = false): Promise<void> {
    if (this.#closed) {
      throw new ToolError('UNAVAILABLE', `The MCP server "${this.name}" was removed.`);
    }
    if (this.connected) {
      if (force) await this.#refresh(signal);
      return;
    }
    // Refused credentials do not come back by themselves: no new attempt (and no new notice).
    if (!force && !this.#connecting && this.needsSignIn) throw this.signInError();
    if (!force && !this.#connecting && this.failedRecently) {
      throw new Error(this.error ?? 'server not available');
    }
    if (!this.#connecting) {
      const attempt: Promise<void> = this.#connect().finally(() => {
        if (this.#connecting === attempt) this.#connecting = undefined;
      });
      // Whoever gave up waiting, the outcome is handled.
      attempt.catch(() => {});
      this.#connecting = attempt;
    }
    await untilAborted(this.#connecting, signal);
  }

  async #connect(): Promise<void> {
    const generation = ++this.#generation;
    const current = () => generation === this.#generation;
    this.status = 'starting';
    this.error = undefined;
    this.#timeouts = 0;
    let launch: Launch;
    try {
      launch = this.#m.launchOf(this);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.error = message;
      this.#failedAt = Date.now();
      this.#failedStarts++;
      throw new Error(message, { cause: err });
    }
    const pinned = pinnedServerOf(this.setting);
    const pinnedPy = pinnedPythonServerOf(this.setting);
    const timeout = pinnedPy
      ? PINNED_PYTHON_START_TIMEOUT_MS
      : this.setting.preset === 'browser' || pinned
        ? BROWSER_START_TIMEOUT_MS
        : START_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeout);
    let scope: ControlScope | undefined;
    let transport: Transport | undefined;
    let client: Client | undefined;
    let stdio: ChildStdioTransport | undefined;
    /** Saved tokens or headers were offered: a refusal now means they died. */
    let credentials = false;
    try {
      if (launch.transport === 'stdio') {
        mkdirSync(launch.cwd, { recursive: true, mode: 0o700 });
        // Halted: refused here, nothing starts while the kill switch is engaged.
        scope = this.#m.runs.serviceScope(`mcp:${this.name}`);
        this.#scope = scope;
        if (this.setting.preset === 'browser') {
          // First start: the package is installed once (npm is in the scope too).
          await this.#m.installBrowser(scope, timeoutSignal);
          if (!current()) throw new Error('stopped while starting');
        } else if (pinned) {
          // Same for a gallery server with a pinned install (M10).
          await this.#m.installPinned(pinned, scope, timeoutSignal);
          if (!current()) throw new Error('stopped while starting');
        } else if (pinnedPy) {
          // And a Python one, in its own environment (M10).
          await this.#m.installPinnedPython(pinnedPy, scope, timeoutSignal);
          if (!current()) throw new Error('stopped while starting');
        }
        const child = scope.spawn(launch.command, launch.args, {
          cwd: launch.cwd,
          env: launch.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        stdio = new ChildStdioTransport(child);
        transport = stdio;
      } else {
        if (this.#m.runs.halted) throw new HaltedError();
        // Not signed in yet: nothing to ask the server.
        if (launch.oauth && !this.#m.oauth.connected(this.name)) throw new OAuthSignInNeeded();
        credentials = launch.oauth;
        // One refresh at a time for the server, whatever the calls (connettori 2).
        const runtime = launch.oauth
          ? this.#m.oauth.runtime(this.name, this.#m.oauthRedirect(), this.#m.fetchFn)
          : undefined;
        transport = new StreamableHTTPClientTransport(new URL(launch.url), {
          requestInit: { headers: launch.headers },
          ...(runtime
            ? { authProvider: runtime.authProvider, fetch: runtime.fetch }
            : this.#m.fetchFn
              ? { fetch: this.#m.fetchFn }
              : {}),
        });
      }
      this.#transport = transport;
      client = new Client({ name: 'monsters', version: '0.0.0' });
      client.onerror = () => {};
      client.onclose = () => this.#lost(generation);
      client.setNotificationHandler('notifications/tools/list_changed', () =>
        this.#toolsChanged(generation),
      );
      await client.connect(transport, { timeout, signal: timeoutSignal });
      const v = client.getServerVersion();
      if (current()) this.serverInfo = v ? `${v.name} ${v.version}` : undefined;
      await this.#listTools(client, generation);
      if (!current()) throw new Error('stopped while starting');
      this.#client = client;
      this.status = 'running';
      this.needsSignIn = false;
      this.#failedStarts = 0;
      this.#m.logConnection(this, 'connected', { tools: this.#entries?.length ?? 0 });
    } catch (err) {
      const message = this.#m.describeStartError(this, launch, err, stdio?.stderr ?? '');
      // Only what this attempt started: a newer one may be running already.
      await release(client, transport, scope);
      if (current()) {
        this.#scope = undefined;
        this.#transport = undefined;
        this.status = 'error';
        this.error = message;
        this.#failedAt = Date.now();
        this.#failedStarts++;
        // A sign-in that worked and is refused now (a night with the core restarted).
        if (credentials && isAuthRefused(err)) this.#signInLost();
        else this.#m.logConnection(this, 'failed', { message });
      }
      throw new Error(message, { cause: err });
    }
  }

  /**
   * The service refused the credentials: the card says what to do, and the
   * user is told once (app and Telegram) instead of finding out from a run.
   */
  #signInLost(): void {
    this.needsSignIn = true;
    if (this.setting.oauth) {
      this.error = signInNeeded();
      this.#m.logConnection(this, 'needs_signin', {
        message: mcpStrings().signInAskedAgain(this.label, settingsPath('altriProgrammi')),
      });
    } else {
      this.error = mcpStrings().headersRefused;
      this.#m.logConnection(this, 'failed', { message: mcpStrings().headersRefused });
    }
  }

  /**
   * A call was refused for a scope the access lacks (`403 insufficient_scope`): the connection
   * stays for the other tools, the card asks for «Collega» with the wider scope, and the user is
   * told once for each new scope (app and Telegram).
   */
  #scopeNeeded(): void {
    const scope = this.#m.oauth.scopeNeeded(this.name);
    if (scope === undefined || scope === this.#toldScope) return;
    this.#toldScope = scope;
    this.#m.logConnection(this, 'needs_signin', {
      message: mcpStrings().moreScope(this.label, settingsPath('altriProgrammi')),
    });
  }
  #toldScope: string | undefined;

  /**
   * A live connection fails on its credentials: closed, in error with `message`
   * (the next start waits `RETRY_AFTER_MS`). False when an older or newer
   * connection was the one that failed: nothing to do.
   */
  #failLive(generation: number, message: string): boolean {
    if (!this.#lost(generation, true, true)) return false;
    this.status = 'error';
    this.error = message;
    this.#failedAt = Date.now();
    return true;
  }

  /** Lists the tools; the result counts only if the connection is still the current one. */
  async #listTools(client: Client, generation: number, signal?: AbortSignal): Promise<void> {
    const { tools } = await client.listTools(undefined, {
      timeout: this.setting.timeoutSec * 1000,
      cacheMode: 'refresh',
      ...(signal ? { signal } : {}),
    });
    if (generation !== this.#generation) return;
    const kept = tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }));
    this.#m.saveTools(this, kept);
    this.#m.pinTools(this, kept);
    this.#entries = this.#m.toEntries(this.name, kept);
  }

  /** The test button on a live connection: list again, on a new session if the old one is gone. */
  async #refresh(signal?: AbortSignal): Promise<void> {
    const generation = this.#generation;
    try {
      await this.#listTools(this.#client!, generation, signal);
    } catch (err) {
      // A process that is alive but silent is restarted too (the test button is the way out).
      if (signal?.aborted || !(isSessionExpired(err) || isConnectionLost(err) || isTimeout(err))) {
        throw err;
      }
      this.#lost(generation, true);
      await this.ensure(signal);
    }
  }

  /** `notifications/tools/list_changed`: list again (one at a time); the next runs see the change. */
  #toolsChanged(generation: number): void {
    if (generation !== this.#generation) return;
    if (this.#relisting) {
      this.#relistAgain = true;
      return;
    }
    this.#relisting = (async () => {
      do {
        this.#relistAgain = false;
        const client = this.#client;
        if (!client || generation !== this.#generation) return;
        await this.#listTools(client, generation).catch(() => {});
      } while (this.#relistAgain);
    })().finally(() => {
      this.#relisting = undefined;
    });
  }

  /**
   * The connection is gone (process ended, kill switch, HTTP session lost):
   * restart at the next call. `close` also closes the client, when it was not
   * the client that reported the loss. While starting, the attempt itself
   * handles a closed transport. `quiet`: the caller says why (no
   * `disconnected`). False when this connection was already gone.
   */
  #lost(generation: number, close = false, quiet = false): boolean {
    if (generation !== this.#generation || !this.#client) return false;
    this.#generation++;
    const wasRunning = this.status === 'running';
    const client = this.#client;
    const scope = this.#scope;
    this.#client = undefined;
    this.#transport = undefined;
    this.#scope = undefined;
    if (close) void client?.close().catch(() => {});
    scope?.close();
    if (this.status !== 'error') this.status = 'idle';
    if (wasRunning && !quiet) this.#m.logConnection(this, 'disconnected', {});
    return true;
  }

  async call(
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    image?: (block: { mimeType: string; data: string }) => string | undefined,
    options: { readOnly?: boolean } = {},
  ): Promise<string> {
    let result: CallToolResult | undefined;
    let retried5xx = false;
    for (let attempt = 0; !result; attempt++) {
      try {
        await this.ensure(signal);
      } catch (err) {
        // Not signed in (any more): the model asks the user, it does not retry.
        if (
          !signal.aborted &&
          !(err instanceof ToolError) &&
          this.setting.oauth &&
          !this.#m.oauth.connected(this.name)
        ) {
          throw this.signInError();
        }
        throw err;
      }
      const client = this.#client;
      const generation = this.#generation;
      if (!client) {
        throw new ToolError('UNAVAILABLE', `The MCP server "${this.name}" is not running.`);
      }
      try {
        result = await client.callTool(
          { name: tool, arguments: args },
          { signal, timeout: this.setting.timeoutSec * 1000 },
        );
      } catch (err) {
        if (signal.aborted) throw err;
        if (isTimeout(err)) {
          // A process that still answers a ping is working (a long render), not stuck: its
          // timeouts do not count. Two in a row without an answer: stuck, the next call starts
          // a new one (review of 18/10, item 9).
          if (await this.#answersPing(client, signal)) {
            this.#timeouts = 0;
          } else if (++this.#timeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
            this.#timeouts = 0;
            this.#lost(generation, true);
          }
          throw new ToolError(
            'UNAVAILABLE',
            `The MCP server "${this.name}" did not answer within ${this.setting.timeoutSec} s.`,
            {
              hint: 'The call may still complete on the server: do not repeat it (a render, a write, a send) before checking the result, for example the output file.',
            },
          );
        }
        if (isSessionExpired(err) && attempt === 0) {
          // The server restarted and did not run the call: new session, same call.
          this.#lost(generation, true);
          continue;
        }
        if (isConnectionLost(err) || isSessionExpired(err)) {
          this.#lost(generation, true);
          throw new ToolError(
            'UNAVAILABLE',
            `The connection to the MCP server "${this.name}" was lost.`,
            {
              hint: 'It restarts at the next call: check whether the action was done, then retry.',
            },
          );
        }
        if (this.setting.transport === 'http') {
          // Checked before the refusals: a sign-in that could not be renewed is still good.
          if (this.setting.oauth && isAuthUnreachable(err)) {
            if (this.#failLive(generation, mcpStrings().oauthUnreachable)) {
              this.#m.logConnection(this, 'failed', { message: mcpStrings().oauthUnreachable });
            }
            throw new ToolError(
              'UNAVAILABLE',
              `${this.label} (MCP server "${this.name}") is not reachable now: the sign-in could not be renewed.`,
              {
                hint: 'The service is down, not your arguments: retry later or go on without it.',
              },
            );
          }
          if (isCallForbidden(err)) {
            // The server says which scope is missing: the next «Collega» asks for it.
            if (
              this.setting.oauth &&
              err instanceof InsufficientScopeError &&
              this.#m.oauth.needScope(this.name, err.requiredScope)
            ) {
              this.#scopeNeeded();
              throw new ToolError(
                'NOT_LINKED',
                `${this.label} (MCP server "${this.name}") refused this call: the access lacks a permission the service asks for.`,
                {
                  hint: `The user must reconnect ${this.label} to give it (${settingsPath('altriProgrammi')} → ${connectButton()}); they have been told. Do not retry this call; the other tools still work.`,
                },
              );
            }
            throw new ToolError(
              'SITE_REFUSED',
              `${this.label} (MCP server "${this.name}") refused this call (HTTP 403): the access does not allow it.`,
              {
                hint: 'Do not retry the same call: try another resource or action, or tell the user what access is missing.',
              },
            );
          }
          if (isAuthRefused(err)) {
            if (this.#failLive(generation, signInNeeded())) this.#signInLost();
            throw this.signInError();
          }
        }
        // A read-only call changes nothing: one new try after a 5xx, after a pause.
        if (options.readOnly && !retried5xx && err instanceof SdkHttpError && err.status >= 500) {
          retried5xx = true;
          await sleep(RETRY_5XX_MS, undefined, { signal });
          continue;
        }
        const http = httpFailure(this.name, err);
        if (http) throw http;
        const message = this.#m.redact(err instanceof Error ? err.message : String(err));
        throw new ToolError(
          'UNAVAILABLE',
          `The MCP server "${this.name}" refused the call: ${wrapExternalData(`mcp:${this.name}`, message)}`,
          { hint: 'Check the arguments against the tool description, or try another approach.' },
        );
      }
    }
    this.#timeouts = 0;
    const text = resultText(result, undefined, result.isError ? undefined : image);
    if (result.isError) {
      // Written by the server: data inside the envelope even when it is an error.
      throw new ToolError('UNAVAILABLE', wrapExternalData(`mcp:${this.name}`, text || 'error'), {
        hint: 'The external tool reported an error: read it and try differently.',
      });
    }
    return text;
  }

  /**
   * Stops the server (configuration changed, disabled). Callers set the new
   * setting first: a call that comes in meanwhile starts with it.
   */
  async stop(): Promise<void> {
    const generation = ++this.#generation;
    this.#entries = undefined;
    this.#connecting = undefined;
    const client = this.#client;
    const transport = this.#transport;
    const scope = this.#scope;
    this.#client = undefined;
    this.#transport = undefined;
    this.#scope = undefined;
    await release(client, transport, scope);
    if (generation === this.#generation) {
      this.status = this.setting.enabled && !this.#closed ? 'idle' : 'off';
      this.error = undefined;
      // A new sign-in or a changed setting: worth a new try.
      this.needsSignIn = false;
    }
  }

  /** Removed or shutdown: stops the server for good, no call starts it again. */
  async dispose(): Promise<void> {
    this.#closed = true;
    await this.stop();
  }

  /** The kill switch stopped the process: forget the connection, keep the tool list. */
  killed(): void {
    this.#generation++;
    this.#connecting = undefined;
    const client = this.#client;
    this.#client = undefined;
    this.#transport = undefined;
    this.#scope = undefined;
    if (this.status === 'running' || this.status === 'starting') this.status = 'idle';
    void client?.close().catch(() => {});
  }
}

/** A browser tool no agent gets (see `BROWSER_BLOCKED_TOOLS`). */
function blocked(c: Connection, e: ToolEntry): boolean {
  return c.setting.preset === 'browser' && BROWSER_BLOCKED_TOOLS.has(e.tool.name);
}

/** Closes a client (or just its transport) and stops its processes. */
async function release(
  client: Client | undefined,
  transport: Transport | undefined,
  scope: ControlScope | undefined,
): Promise<void> {
  try {
    if (client) await client.close();
    else await transport?.close();
  } catch {
    // closing anyway
  }
  if (scope) {
    scope.close();
    await scope.settled;
  }
}

export interface McpManagerOptions {
  home: string;
  secretsDir: string;
  /** `settings.mcpServers`, kept up to date by the manager. */
  servers: Record<string, McpServerSetting>;
  log: EventLog;
  runs: RunController;
  team: TeamService;
  state: StateStore;
  /** Environment the stdio servers start from (the user's, without Monsters' secrets). */
  env?: NodeJS.ProcessEnv;
  /** HTTP of the remote servers and their sign-in (tests). */
  fetchFn?: FetchLike;
  /** DNS of the check on the browser's addresses (tests). */
  resolver?: Resolver;
  /**
   * Keeps an image a server returned (a browser screenshot) as a file of the
   * monster (D-075); the text returned tells the model its name, instead of
   * "[immagine …]". Null when it was not kept.
   */
  saveImage?: (image: {
    server: string;
    preset: string | undefined;
    tool: string;
    mimeType: string;
    data: string;
    ctx: ToolContext;
  }) => string | null;
}

export class McpManager {
  readonly runs: RunController;
  readonly oauth: McpOAuth;
  readonly fetchFn: FetchLike | undefined;
  /** Origin of the core on loopback, for the OAuth callback (set by the server once listening). */
  #callbackOrigin: () => string = () => 'http://127.0.0.1';
  readonly #o: McpManagerOptions;
  readonly #connections = new Map<string, Connection>();
  /** Agents already told that their MCP tools were cut, by count. */
  readonly #limited = new Set<string>();
  /**
   * The elements of the browser's page by ref, from the snapshots in its results (D-131):
   * the brake reads what a click hits from here, not from the model's description.
   */
  readonly #browserRefs = new Map<string, string>();
  #browserUrl: string | undefined;
  readonly #offKill: () => void;

  constructor(options: McpManagerOptions) {
    this.#o = options;
    this.runs = options.runs;
    this.fetchFn = options.fetchFn;
    this.oauth = new McpOAuth({
      secretsDir: options.secretsDir,
      onSecret: (v) => options.log.redactor.addSecret(v),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    });
    let raised = false;
    for (const [name, setting] of Object.entries(options.servers)) {
      raised = this.#raiseGalleryTimeout(name, setting) || raised;
      const c = new Connection(name, setting, this);
      if (!setting.enabled) c.status = 'off';
      this.#connections.set(name, c);
      this.#trustSecrets(readMcpSecrets(options.secretsDir, name));
      if (setting.oauth) {
        for (const v of this.oauth.secretValues(name)) options.log.redactor.addSecret(v);
      }
    }
    if (raised) this.#persist();
    this.#offKill = options.runs.onKill(() => {
      for (const c of this.#connections.values()) c.killed();
    });
  }

  /**
   * A server added from the gallery before its entry had a longer timeout (Blender, added
   * with 60 s) gets the entry's, once: a value the user sets later stays theirs.
   */
  #raiseGalleryTimeout(name: string, setting: McpServerSetting): boolean {
    const entry = MCP_CATALOG.find((x) => x.id === setting.catalog);
    const wanted = entry && 'timeoutSec' in entry ? entry.timeoutSec : undefined;
    if (wanted === undefined || this.#o.state.get<boolean>(TIMEOUT_RAISED_KEY(name))) return false;
    this.#o.state.set(TIMEOUT_RAISED_KEY(name), true);
    if (setting.timeoutSec !== DEFAULT_TIMEOUT_SEC || wanted <= setting.timeoutSec) return false;
    setting.timeoutSec = wanted;
    return true;
  }

  // --- helpers used by the connections -------------------------------------------

  /** Where the service sends the browser back after a sign-in. */
  oauthRedirect(): string {
    return `${this.#callbackOrigin()}${OAUTH_CALLBACK_PATH}`;
  }

  setCallbackOrigin(origin: () => string): void {
    this.#callbackOrigin = origin;
  }

  redact(text: string): string {
    return this.#o.log.redactor.redactKnown(text);
  }

  #trustSecrets(secrets: McpSecrets): void {
    for (const v of [...Object.values(secrets.env), ...Object.values(secrets.headers)]) {
      this.#o.log.redactor.addSecret(v);
    }
  }

  #hash(c: Connection): string {
    const s = c.setting;
    const launch =
      s.preset === 'browser'
        ? { preset: PLAYWRIGHT_MCP_PACKAGE }
        : {
            t: s.transport,
            c: s.command,
            a: s.args,
            u: s.url,
            e: s.envKeys,
            h: s.headerKeys,
            ...(s.oauth ? { o: true } : {}),
          };
    return createHash('sha256').update(JSON.stringify(launch)).digest('hex').slice(0, 16);
  }

  cachedTools(c: Connection): CachedTools | undefined {
    const cached = this.#o.state.get<CachedTools>(TOOLS_CACHE_KEY(c.name));
    return cached && cached.hash === this.#hash(c) ? cached : undefined;
  }

  saveTools(c: Connection, tools: CachedTools['tools']): void {
    this.#o.state.set(TOOLS_CACHE_KEY(c.name), {
      hash: this.#hash(c),
      ...(c.serverInfo ? { server: c.serverInfo } : {}),
      tools,
    } satisfies CachedTools);
  }

  #pins(c: Connection): PinState | undefined {
    return this.#o.state.get<PinState>(PINS_KEY(c.name));
  }

  /** Names of the tools paused until the user accepts them (D-070). */
  pausedNames(c: Connection): Set<string> {
    const pins = this.#pins(c);
    return new Set(pins && pins.launch === this.#hash(c) ? Object.keys(pins.paused) : []);
  }

  pausedTools(c: Connection): McpPausedTool[] {
    const pins = this.#pins(c);
    if (!pins || pins.launch !== this.#hash(c)) return [];
    return Object.values(pins.paused).map(({ pin, ...view }) => ({ ...view, hash: pin.hash }));
  }

  /**
   * Compares a new listing with the pinned tools: new or changed ones are
   * paused (or, for a gallery service, accepted when only the arguments
   * changed or the tool is new), removed ones are forgotten.
   */
  pinTools(c: Connection, tools: CachedTools['tools']): void {
    const launch = this.#hash(c);
    const before = this.#pins(c);
    const pins = tools.map((t) => ({ t, pin: toolPin(t) }));
    if (!before || before.launch !== launch) {
      // First listing of this configuration: trust on first use.
      this.#o.state.set(PINS_KEY(c.name), {
        launch,
        tools: Object.fromEntries(pins.map(({ t, pin }) => [t.name, pin])),
        paused: {},
      } satisfies PinState);
      return;
    }
    const gallery = c.setting.catalog !== undefined || c.setting.preset === 'browser';
    const next: PinState = { launch, tools: {}, paused: {} };
    const newlyPaused: { name: string; change: 'new' | 'changed' }[] = [];
    const updated: string[] = [];
    const now = Date.now();
    for (const { t, pin } of pins) {
      const old = before.tools[t.name];
      if (old && old.hash === pin.hash) {
        // The same tool: the new pin also carries what older pins did not store.
        next.tools[t.name] = pin;
        continue;
      }
      const change = old ? 'changed' : 'new';
      const descriptionChanged = old !== undefined && old.description !== pin.description;
      // The descriptions of the arguments are read by the model like the tool's own:
      // for a gallery service a changed one pauses the tool too (review of 16/10).
      // Since D-074 all their words count (titles, defaults, allowed values, names);
      // a pin of before has only the descriptions, compared until it learns the rest.
      // Each pin is compared with the most complete hash both sides have.
      const argsTextChanged =
        old?.argWords !== undefined
          ? old.argWords !== pin.argWords
          : old?.argText !== undefined
            ? old.argText !== pin.argText
            : old?.argDescriptions !== undefined && old.argDescriptions !== pin.argDescriptions;
      if (gallery && !descriptionChanged && !argsTextChanged) {
        next.tools[t.name] = pin;
        updated.push(t.name);
        continue;
      }
      if (old) next.tools[t.name] = old;
      const was = before.paused[t.name];
      next.paused[t.name] =
        was && was.pin.hash === pin.hash
          ? was
          : {
              name: t.name,
              change,
              description: pin.description.slice(0, PAUSED_DESCRIPTION),
              ...(descriptionChanged
                ? { before: old.description.slice(0, PAUSED_DESCRIPTION) }
                : {}),
              schemaChanged: old !== undefined && old.schema !== pin.schema,
              since: now,
              pin,
            };
      if (!was || was.pin.hash !== pin.hash) newlyPaused.push({ name: t.name, change });
    }
    this.#o.state.set(PINS_KEY(c.name), next);
    const label = c.setting.label ?? c.name;
    if (updated.length > 0) {
      this.#o.log.append({
        agent: 'system',
        type: 'mcp_server',
        data: {
          server: c.name,
          action: 'tools_updated',
          transport: c.setting.transport,
          tools: updated.length,
          message: mcpStrings().toolsUpdated(label, updated.length, updated[0] ?? ''),
        },
      });
    }
    if (newlyPaused.length > 0) {
      const n = newlyPaused.length;
      this.#o.log.append({
        agent: 'system',
        type: 'security',
        data: {
          action: 'mcp_tools_changed',
          source: `mcp:${c.name}`,
          tool: `mcp__${c.name}`,
          server: c.name,
          tools: newlyPaused,
          message: mcpStrings().toolsPaused(label, n, newlyPaused[0]!.change, newlyPaused[0]!.name),
        },
      });
    }
  }

  /**
   * "Accetta": the paused tools (or some of them) reach the agents again. With
   * `seen` (name → fingerprint shown on the card) only what the user saw is
   * accepted: a tool that changed again meanwhile stays paused (review of 16/10).
   */
  acceptTools(
    name: string,
    tools: string[] | undefined,
    by: Channel,
    seen?: Readonly<Record<string, string>>,
  ): McpServersResponse {
    const c = this.#connections.get(name);
    if (!c) throw new McpError('unknown_server', mcpStrings().unknownServer(name));
    const pins = this.#pins(c);
    if (pins && pins.launch === this.#hash(c)) {
      const accepted = Object.values(pins.paused).filter(
        (p) =>
          (tools === undefined || tools.includes(p.name)) &&
          (seen === undefined || seen[p.name] === p.pin.hash),
      );
      for (const p of accepted) {
        pins.tools[p.name] = p.pin;
        delete pins.paused[p.name];
      }
      this.#o.state.set(PINS_KEY(name), pins);
      if (accepted.length > 0) {
        this.#o.log.append({
          agent: 'user',
          type: 'security',
          data: {
            action: 'mcp_tools_accepted',
            source: `mcp:${name}`,
            tool: `mcp__${name}`,
            server: name,
            tools: accepted.map((p) => ({ name: p.name, change: p.change })),
            message: mcpStrings().toolsAccepted(
              accepted.length,
              accepted[0]!.name,
              c.setting.label ?? name,
              by === 'telegram',
            ),
          },
        });
      }
    }
    return this.view();
  }

  /** Tools with their agent names, which do not depend on the order the server lists them in. */
  toEntries(server: string, tools: CachedTools['tools']): ToolEntry[] {
    const seen = new Set<string>();
    const unique = tools.filter((t) => !seen.has(t.name) && Boolean(seen.add(t.name)));
    const names = agentToolNames(
      server,
      unique.map((t) => t.name),
    );
    return unique.map((tool) => ({
      tool,
      agentName: names.get(tool.name)!,
      check: checkInputSchema(tool.inputSchema),
    }));
  }

  /** The user's environment without Monsters' variables and secrets. */
  #baseEnv(): Record<string, string> {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.#o.env ?? process.env)) {
      if (v === undefined || isMonstersEnv(k) || isAgentSessionEnv(k)) continue;
      if (this.#o.log.redactor.containsKnown(v)) continue;
      base[k] = v;
    }
    return base;
  }

  launchOf(c: Connection): Launch {
    const s = c.setting;
    const { secrets, unreadable } = inspectMcpSecrets(this.#o.secretsDir, c.name);
    if (unreadable) {
      throw new Error(mcpStrings().secretsUnreadable(c.name));
    }
    this.#trustSecrets(secrets);
    if (s.transport === 'http') {
      return {
        transport: 'http',
        url: s.url ?? '',
        headers: { ...secrets.headers },
        oauth: s.oauth ?? false,
      };
    }
    const env = { ...this.#baseEnv(), ...secrets.env };
    if (s.preset === 'browser') {
      const launch = browserLaunch(
        this.#o.home,
        s.showWindow ?? false,
        requireNodeRuntime(this.#o.env ?? process.env),
      );
      // Its working directory is the only folder whose files it may touch.
      return {
        transport: 'stdio',
        command: launch.command,
        args: launch.args,
        cwd: browserFilesDir(this.#o.home),
        env: browserEnv(env),
      };
    }
    const pinned = pinnedServerOf(s);
    if (pinned) {
      // The installed package, run with the Node of the core (in the app, the one on the
      // PATH): never `npx` (M10).
      const runtime = requireNodeRuntime(this.#o.env ?? process.env);
      return {
        transport: 'stdio',
        command: runtime.command,
        args: [pinnedEntry(this.#o.home, pinned)],
        cwd: s.cwd ?? this.#serverDir(c.name),
        env,
      };
    }
    const pinnedPy = pinnedPythonServerOf(s);
    if (pinnedPy) {
      // The Python of its own environment: never `uvx` (M10).
      return {
        transport: 'stdio',
        command: pinnedPythonExe(this.#o.home, pinnedPy),
        args: pinnedPythonArgs(pinnedPy),
        cwd: s.cwd ?? this.#serverDir(c.name),
        env,
      };
    }
    return {
      transport: 'stdio',
      command: s.command ?? '',
      args: withUvDateLimit(s),
      cwd: s.cwd ?? this.#serverDir(c.name),
      env,
    };
  }

  /** Installs the package of a gallery server once (npm runs in the server's scope). */
  async installPinned(
    server: PinnedNpmServer,
    scope: ControlScope,
    signal: AbortSignal,
  ): Promise<void> {
    await installPinnedPackage(
      this.#o.home,
      server,
      this.#baseEnv(),
      (command, args, options) => scope.spawn(command, args, options),
      signal,
    );
  }

  /** Installs the environment of a Python gallery server once (uv runs in the server's scope). */
  async installPinnedPython(
    server: PinnedPythonServer,
    scope: ControlScope,
    signal: AbortSignal,
  ): Promise<void> {
    await installPinnedPython(
      this.#o.home,
      server,
      this.#baseEnv(),
      (command, args, options) => scope.spawn(command, args, options),
      signal,
    );
  }

  /** Installs the browser package once (npm runs in the server's scope). */
  async installBrowser(scope: ControlScope, signal: AbortSignal): Promise<void> {
    await installBrowserPackage(
      this.#o.home,
      this.#baseEnv(),
      (command, args, options) => scope.spawn(command, args, options),
      signal,
    );
  }

  #serverDir(name: string): string {
    return join(this.#o.home, 'mcp', name);
  }

  describeStartError(c: Connection, launch: Launch, err: unknown, stderr: string): string {
    const tail = lastLine(this.redact(stderr));
    if (err instanceof HaltedError) return mcpStrings().halted;
    const code = errorCode(err);
    if (launch.transport === 'stdio') {
      if (code === 'ENOENT') {
        // `uvx` or `npx` of a server of the gallery: what to install, not only what is missing.
        const launcher = launcherOf(launch.command);
        if (launcher) {
          return mcpStrings().programMissingNeeds(launch.command, launcher.needs, launcher.url);
        }
        return mcpStrings().programMissing(launch.command);
      }
      if (code === 'EACCES') return mcpStrings().noPermission(launch.command);
    } else {
      if (launch.oauth && isAuthUnreachable(err)) return mcpStrings().oauthUnreachable;
      if (launch.oauth && isAuthRefused(err)) return signInNeeded();
      if (err instanceof SdkHttpError) {
        if (err.status === 401 || err.status === 403) return mcpStrings().headersRefused;
        if (err.status === 404) return mcpStrings().noMcpHere;
        return mcpStrings().serverError(err.status);
      }
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
        return mcpStrings().noServerAt(launch.url ?? '');
      }
    }
    if (isTimeout(err)) {
      return mcpStrings().timedOut(tail);
    }
    if (isConnectionLost(err) || (err as Error | null)?.message?.includes('closed')) {
      return mcpStrings().closedAtOnce(tail);
    }
    const message = this.redact(err instanceof Error ? err.message : String(err)).slice(0, 300);
    return mcpStrings().cantConnect(c.name, message, tail);
  }

  logConnection(
    c: Connection,
    action: 'connected' | 'disconnected' | 'failed' | 'needs_signin',
    extra: { tools?: number; message?: string },
  ): void {
    this.#o.log.append({
      agent: 'system',
      type: 'mcp_server',
      data: { server: c.name, action, transport: c.setting.transport, ...extra },
    });
  }

  // --- agents ----------------------------------------------------------------------

  /**
   * Why this agent may not use this server now, with who changes it and where (D-132, review of
   * 19/10 B1): never "the settings (External tools)", a section that does not exist.
   */
  notAllowed(agentId: string, server: string): ToolError {
    const c = this.#connections.get(server);
    const label = c?.label ?? server;
    if (!c) return new ToolError('UNAVAILABLE', `The MCP server "${server}" was removed.`);
    const off = (message: string, hint: string) => new ToolError('SETTING_OFF', message, { hint });
    if (!c.setting.enabled) {
      return off(
        `${label} is turned off now.`,
        `Only the user turns it on again, in ${settingsPath('altriProgrammi')}. Go on without it and say so in your report.`,
      );
    }
    if (c.setting.preset === 'browser' && !this.#o.team.permissionsFor(agentId).web) {
      return off(
        `${label} needs the web, and the web is off for you.`,
        `Only the user turns it on, in ${settingsPath('ilWeb')}. Go on without it.`,
      );
    }
    const project = this.#o.team.projectOf(agentId);
    if (c.setting.agents.includes('*') && project) {
      return off(
        `${label} is not on for the project ${mcpPrompts().quoted(project.name)}.`,
        `The user turns it on in the app (${projectPagePath(project.name, 'collegamenti')}); a capo can ask for it with access_request. Go on without it.`,
      );
    }
    return off(
      `${label} is not given to you any more.`,
      `Only the user gives it back, in ${settingsPath('altriProgrammi')}. Go on without it.`,
    );
  }

  /** May this agent use this server now? (assignment, and the web permission for the browser) */
  allowed(agentId: string, server: string): boolean {
    const c = this.#connections.get(server);
    if (!c || !c.setting.enabled) return false;
    // `*` is the Squadra personale and the projects that chose the server (D-097); an id is that monster.
    const assigned =
      c.setting.agents.includes(agentId) ||
      (c.setting.agents.includes('*') && this.#o.team.wildcardAllows(agentId, 'mcp', server));
    if (!assigned) return false;
    if (c.setting.preset === 'browser' && !this.#o.team.permissionsFor(agentId).web) return false;
    return true;
  }

  /**
   * MCP tools of an agent for one run. A server whose tools are not known yet
   * is started now; a server that fails is skipped (the log says why) and the
   * run goes on without it. Free models get at most `MAX_MCP_TOOLS_FREE`;
   * with `deferred` (a native run, which loads the tools when it needs them,
   * C.2) up to `MAX_MCP_TOOLS_DEFERRED`; `unbounded` (Claude Code, whose own
   * ToolSearch defers them, D-075) all of them. What is cut is never silent
   * (M1 of the review of 19/10, D-134): `cutFor` gives it to the card.
   */
  async toolsFor(
    agent: AgentDefinition,
    signal?: AbortSignal,
    options: { deferred?: boolean; unbounded?: boolean } = {},
  ): Promise<MonstersTool[]> {
    const id = agent.config.id;
    this.#cut.delete(id);
    // Not connected (signed out, tokens gone) or failing again and again right now: no tools
    // that would all fail. After one passing error the known tools stay (`brokenNow`).
    const servers = [...this.#connections.values()].filter(
      (c) => this.allowed(id, c.name) && !this.#unlinked(c),
    );
    if (servers.length === 0) return [];
    const free = isFreeChain(agent.config.models);
    const lists = await Promise.all(
      servers.map(async (c) => {
        try {
          return { c, entries: await c.catalog(signal) };
        } catch {
          return { c, entries: [] as ToolEntry[] };
        }
      }),
    );
    const tools: MonstersTool[] = [];
    for (const { c, entries } of lists) {
      const only = c.setting.tools.length > 0 ? new Set(c.setting.tools) : null;
      const core =
        free && !only && c.setting.preset === 'browser' ? new Set(BROWSER_CORE_TOOLS) : null;
      const paused = this.pausedNames(c);
      for (const e of entries) {
        if (!e.check.ok || blocked(c, e)) continue;
        // New or changed since accepted (D-070): not until the user says so.
        if (paused.has(e.tool.name)) continue;
        if (only && !only.has(e.tool.name)) continue;
        if (core && !core.has(e.tool.name)) continue;
        tools.push(this.#toTool(c, e, e.check));
      }
    }
    const max = options.unbounded
      ? Infinity
      : options.deferred
        ? MAX_MCP_TOOLS_DEFERRED
        : free
          ? MAX_MCP_TOOLS_FREE
          : MAX_MCP_TOOLS;
    if (tools.length > max) {
      const kept = tools.slice(0, max);
      // Per server, by the name the user knows it by: the card says "di X vedi N su M".
      const label = new Map(lists.map(({ c }) => [c.name, c.label]));
      const count = (list: MonstersTool[]) => {
        const by = new Map<string, number>();
        for (const t of list) {
          const server = splitAgentToolName(t.name)?.server ?? '';
          by.set(server, (by.get(server) ?? 0) + 1);
        }
        return by;
      };
      const [all, shown] = [count(tools), count(kept)];
      this.#cut.set(
        id,
        [...all]
          .filter(([server, total]) => (shown.get(server) ?? 0) < total)
          .map(([server, total]) => ({
            server: label.get(server) ?? server,
            shown: shown.get(server) ?? 0,
            total,
          })),
      );
      const key = `${id}:${tools.length}`;
      if (!this.#limited.has(key)) {
        this.#limited.add(key);
        this.#o.log.append({
          agent: 'system',
          type: 'error',
          data: {
            code: 'mcp_tools_limited',
            message: mcpStrings().toolsLimited(agent.config.name, max, tools.length),
          },
        });
      }
      return kept;
    }
    return tools;
  }

  /** MCP servers whose tools the last `toolsFor` of this agent cut at the cap (M1, D-134). */
  cutFor(agentId: string): { server: string; shown: number; total: number }[] {
    return this.#cut.get(agentId) ?? [];
  }
  readonly #cut = new Map<string, { server: string; shown: number; total: number }[]>();

  /** Not signed in, refused, or failing to start again and again: its tools would all fail. */
  #unlinked(c: Connection): boolean {
    return (
      (c.setting.oauth === true && !this.oauth.connected(c.name)) || c.needsSignIn || c.brokenNow
    );
  }

  /** The agent has servers of other programs (signed in or not): the bots' settings warn (D-114). */
  hasServersFor(agentId: string): boolean {
    return [...this.#connections.values()].some((c) => this.allowed(agentId, c.name));
  }

  /**
   * Names of the servers given to this agent whose tools it does not get now
   * (not signed in, refused, failing): the card says it (connettori 6), so
   * the monster tells the user instead of looking for the tools. Asked after
   * `toolsFor`, it counts the servers that just failed to start too.
   */
  unlinkedFor(agent: AgentDefinition): string[] {
    const id = agent.config.id;
    return [...this.#connections.values()]
      .filter((c) => this.allowed(id, c.name) && this.#unlinked(c))
      .map((c) => c.label)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * What a ref of the browser's last snapshot is (`e42` → `button "Condividi"`), or
   * undefined when no snapshot seen since the page was opened has it (D-131).
   */
  browserLabel(ref: string): string | undefined {
    return this.#browserRefs.get(ref);
  }

  /** Reads the snapshot lines of a result of the browser: `- button "Condividi" [ref=e42]`. */
  noteBrowserPage(out: string): void {
    const url = /^\s*-\s*Page URL:\s*(\S+)/m.exec(out)?.[1];
    // Another page: the refs start again, the old ones would name other elements.
    if (url !== undefined && url !== this.#browserUrl) {
      this.#browserUrl = url;
      this.#browserRefs.clear();
    }
    for (const m of out.matchAll(/^\s*-\s+(.+?)\s*\[ref=([a-z]?\d*e\d+)\]/gim)) {
      this.#browserRefs.set(m[2]!, m[1]!.slice(0, 200));
    }
    // A page with very many elements: the oldest go first.
    while (this.#browserRefs.size > 5_000) {
      this.#browserRefs.delete(this.#browserRefs.keys().next().value!);
    }
  }

  #toTool(
    c: Connection,
    e: ToolEntry,
    check: Extract<SchemaCheck, { ok: true }>,
  ): MonstersTool<Record<string, unknown>, string> {
    const server = c.name;
    const raw = (e.tool.description ?? '').trim() || `Tool ${e.tool.name}.`;
    const description = `[External tool, MCP server "${server}"] ${raw}`.slice(0, MAX_DESCRIPTION);
    const hints = toolHintsFor(c.setting, e.tool.name, e.tool.annotations);
    return {
      name: e.agentName,
      description,
      inputSchema: check.input,
      inputJsonSchema: check.schema,
      ...hints,
      externalSource: () => `mcp:${server}`,
      execute: async (input, ctx) => {
        // A server taken away holds from the next call (like the other permissions).
        if (!this.allowed(ctx.agentId, server)) throw this.notAllowed(ctx.agentId, server);
        const conn = this.#connections.get(server);
        if (!conn) throw new ToolError('UNAVAILABLE', `The MCP server "${server}" was removed.`);
        // The tools that open a URL given by the agent: `browser_navigate`, and a new tab.
        if (
          c.setting.preset === 'browser' &&
          (e.tool.name === 'browser_navigate' || e.tool.name === 'browser_tabs')
        ) {
          const url = (input as { url?: unknown }).url;
          if (typeof url === 'string') {
            await assertPublicBrowserUrl(url, {
              ...(this.#o.resolver ? { resolver: this.#o.resolver } : {}),
              signal: ctx.signal,
            });
          }
        }
        try {
          const save = this.#o.saveImage;
          const out = await conn.call(
            e.tool.name,
            input,
            ctx.signal,
            save
              ? (block) =>
                  save({
                    server,
                    preset: c.setting.preset,
                    tool: e.agentName,
                    mimeType: block.mimeType,
                    data: block.data,
                    ctx,
                  }) ?? undefined
              : undefined,
            { readOnly: hints.readOnly === true },
          );
          if (c.setting.preset === 'browser') this.noteBrowserPage(out);
          return out;
        } catch (err) {
          if (err instanceof ToolError || ctx.signal.aborted) throw err;
          throw new ToolError('UNAVAILABLE', (err as Error).message, {
            hint: 'The external server is not available now: go on without it or try later.',
          });
        }
      },
    };
  }

  // --- settings ----------------------------------------------------------------------

  view(): McpServersResponse {
    return {
      servers: [...this.#connections.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => this.#viewOf(c)),
      agents: this.#o.team.list().map((a) => ({
        id: a.config.id,
        name: a.config.name,
        color: a.config.color,
        isOrchestrator: a.config.kind === 'orchestrator',
        web: this.#o.team.permissionsFor(a.config.id).web,
      })),
      browser: {
        package: PLAYWRIGHT_MCP_PACKAGE,
        profileDir: join(browserDir(this.#o.home), 'profile'),
      },
    };
  }

  #toolViews(c: Connection, entries: ToolEntry[]): McpToolView[] {
    const paused = this.pausedNames(c);
    return entries.map((e) => ({
      name: e.tool.name,
      agentName: e.agentName,
      description: (e.tool.description ?? '').slice(0, 300),
      ...(blocked(c, e)
        ? { skipped: mcpStrings().skippedUnsafe }
        : !e.check.ok
          ? { skipped: e.check.reason }
          : paused.has(e.tool.name)
            ? { skipped: mcpStrings().skippedPaused }
            : {}),
    }));
  }

  #viewOf(c: Connection): McpServerView {
    const s = c.setting;
    const launch =
      s.preset === 'browser' ? browserLaunch(this.#o.home, s.showWindow ?? false) : undefined;
    const entries =
      c.entries ??
      (() => {
        const cached = this.cachedTools(c);
        return cached ? this.toEntries(c.name, cached.tools) : undefined;
      })();
    return {
      name: c.name,
      label: s.label ?? (s.preset === 'browser' ? 'Browser' : c.name),
      ...(s.preset ? { preset: s.preset } : {}),
      transport: s.transport,
      ...(s.transport === 'stdio'
        ? { command: launch?.command ?? s.command ?? '', args: launch?.args ?? s.args }
        : { url: s.url ?? '' }),
      envKeys: s.envKeys,
      headerKeys: s.headerKeys,
      enabled: s.enabled,
      agents: s.agents,
      tools: s.tools,
      timeoutSec: s.timeoutSec,
      ...(s.preset === 'browser' ? { showWindow: s.showWindow ?? false } : {}),
      status: s.enabled ? c.status : 'off',
      ...(c.error ? { error: c.error } : {}),
      ...(entries ? { knownTools: this.#toolViews(c, entries) } : {}),
      ...(s.catalog ? { catalog: s.catalog } : {}),
      ...(() => {
        const paused = this.pausedTools(c);
        return paused.length > 0 ? { pausedTools: paused } : {};
      })(),
      ...(s.oauth
        ? {
            oauth: {
              connected: this.oauth.connected(c.name),
              pending: this.oauth.pending(c.name),
              // Refused at run time (connettori 1): the gallery says "Serve l’accesso".
              ...(c.needsSignIn || this.oauth.signInNeeded(c.name)
                ? { needsSignIn: true as const }
                : {}),
              // A call refused for its scope: «Collega» asks for more (it works for the rest).
              ...(() => {
                const scope = this.oauth.scopeNeeded(c.name);
                return scope !== undefined ? { moreScope: scope } : {};
              })(),
            },
          }
        : {}),
    };
  }

  #persist(): void {
    const servers: Record<string, McpServerSetting> = {};
    for (const [name, c] of this.#connections) servers[name] = c.setting;
    for (const k of Object.keys(this.#o.servers)) delete this.#o.servers[k];
    Object.assign(this.#o.servers, servers);
    const current = readSettingsFile(this.#o.home);
    writeSensitiveFile(
      join(this.#o.home, SETTINGS_FILE),
      `${JSON.stringify({ ...current, mcpServers: servers }, null, 2)}\n`,
    );
  }

  /** Adds or changes a server. A change of command, address or secrets restarts it at the next use. */
  async upsert(rawName: string, req: McpServerRequest, by: Channel): Promise<McpServersResponse> {
    const nameCheck = McpServerNameSchema.safeParse(rawName);
    if (!nameCheck.success) {
      throw new McpError('invalid_server', mcpStrings().invalidName);
    }
    const name = nameCheck.data;
    const existing = this.#connections.get(name);
    const prev = existing?.setting;
    const preset = req.preset ?? prev?.preset;
    if ((preset === 'browser') !== (name === BROWSER_SERVER)) {
      throw new McpError(
        'invalid_server',
        name === BROWSER_SERVER ? mcpStrings().browserNameTaken : mcpStrings().browserNameOnly,
      );
    }
    for (const id of req.agents ?? []) {
      if (id !== '*' && this.#o.team.get(id)?.config.id !== id) {
        throw new McpError('unknown_agent', mcpStrings().unknownAgent(id));
      }
    }
    const transport =
      preset === 'browser' ? 'stdio' : (req.transport ?? prev?.transport ?? 'stdio');
    const next: McpServerSetting = McpServerSettingSchema.parse({
      ...(prev ?? {}),
      ...(req.label !== undefined ? { label: req.label || undefined } : {}),
      ...(preset ? { preset } : {}),
      transport,
      ...(req.command !== undefined ? { command: req.command } : {}),
      ...(req.args !== undefined ? { args: req.args } : {}),
      ...(req.url !== undefined ? { url: req.url } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.agents !== undefined ? { agents: [...new Set(req.agents)] } : {}),
      ...(req.tools !== undefined ? { tools: [...new Set(req.tools)] } : {}),
      ...(req.timeoutSec !== undefined ? { timeoutSec: req.timeoutSec } : {}),
      ...(req.showWindow !== undefined && preset === 'browser'
        ? { showWindow: req.showWindow }
        : {}),
      ...(req.oauth !== undefined ? { oauth: req.oauth || undefined } : {}),
      ...(req.catalog !== undefined ? { catalog: req.catalog } : {}),
      ...(prev ? {} : { enabled: req.enabled ?? true }),
    });
    if (next.oauth && transport !== 'http') {
      throw new McpError('invalid_server', mcpStrings().oauthWebOnly);
    }
    if (preset === 'browser') {
      delete next.command;
      next.args = [];
      delete next.url;
    } else if (transport === 'stdio') {
      if (!next.command?.trim()) {
        throw new McpError('invalid_server', mcpStrings().commandMissing);
      }
      delete next.url;
    } else {
      let url: URL;
      try {
        url = new URL(next.url ?? '');
      } catch {
        throw new McpError('invalid_server', mcpStrings().urlFull);
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new McpError('invalid_server', mcpStrings().urlScheme);
      }
      if (url.username || url.password) {
        throw new McpError('invalid_server', mcpStrings().urlCredentials);
      }
      delete next.command;
      next.args = [];
    }

    // Secrets: an empty value keeps the saved one, a name left out is removed.
    const { secrets: stored, unreadable } = inspectMcpSecrets(this.#o.secretsDir, name);
    const merge = (
      incoming: Record<string, string> | undefined,
      saved: Record<string, string>,
      kind: 'variable' | 'header',
    ) => {
      if (incoming === undefined) return saved;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== '') out[k] = v;
        else if (saved[k] !== undefined) out[k] = saved[k];
        else throw new McpError('invalid_server', mcpStrings().missingValue(kind, k));
      }
      return out;
    };
    const secrets: McpSecrets = {
      env: transport === 'stdio' ? merge(req.env, stored.env, 'variable') : {},
      headers: transport === 'http' ? merge(req.headers, stored.headers, 'header') : {},
    };
    this.#trustSecrets(secrets);
    // Unreadable secrets that the request does not replace stay as they are,
    // names included: an empty result here is "unknown", not "none".
    if (unreadable && req.env === undefined && prev) next.envKeys = prev.envKeys;
    else next.envKeys = Object.keys(secrets.env);
    if (unreadable && req.headers === undefined && prev) next.headerKeys = prev.headerKeys;
    else next.headerKeys = Object.keys(secrets.headers);
    const secretsChanged = JSON.stringify(secrets) !== JSON.stringify(stored);

    // Tokens belong to one address: another address (or no OAuth) signs out.
    const signOut = Boolean(prev?.oauth) && (!next.oauth || prev?.url !== next.url);

    const relaunch =
      !prev ||
      secretsChanged ||
      signOut ||
      Boolean(prev.oauth) !== Boolean(next.oauth) ||
      JSON.stringify([
        prev.transport,
        prev.command,
        prev.args,
        prev.url,
        prev.cwd,
        prev.showWindow,
      ]) !==
        JSON.stringify([
          next.transport,
          next.command,
          next.args,
          next.url,
          next.cwd,
          next.showWindow,
        ]);

    if (secretsChanged) saveMcpSecrets(this.#o.secretsDir, name, secrets);
    if (signOut) await this.oauth.signOut(name);
    const conn = existing ?? new Connection(name, next, this);
    // The new setting first: a call that comes in while the old process stops
    // starts the new configuration, not the old one.
    conn.setting = next;
    if (existing && (relaunch || !next.enabled)) await existing.stop();
    if (!next.enabled) conn.status = 'off';
    else if (conn.status === 'off') conn.status = 'idle';
    this.#connections.set(name, conn);
    this.#persist();
    this.#o.log.append({
      agent: 'user',
      type: 'mcp_server',
      data: { server: name, action: existing ? 'changed' : 'added', transport, by },
    });
    return this.view();
  }

  async remove(name: string, by: Channel): Promise<McpServersResponse> {
    const c = this.#connections.get(name);
    if (!c) throw new McpError('unknown_server', mcpStrings().unknownServer(name));
    // Out of the list before stopping: no call can start it again meanwhile.
    this.#connections.delete(name);
    await c.dispose();
    removeMcpSecrets(this.#o.secretsDir, name);
    // Revoked where the service allows it, then forgotten.
    if (c.setting.oauth) await this.oauth.signOut(name);
    this.#o.state.delete(TOOLS_CACHE_KEY(name));
    this.#o.state.delete(PINS_KEY(name));
    this.#persist();
    this.#o.log.append({
      agent: 'user',
      type: 'mcp_server',
      data: { server: name, action: 'removed', transport: c.setting.transport, by },
    });
    return this.view();
  }

  /** Starts the server (if needed) and lists its tools again. */
  async test(name: string): Promise<McpTestResponse> {
    const c = this.#connections.get(name);
    if (!c) throw new McpError('unknown_server', mcpStrings().unknownServer(name));
    if (this.runs.halted) throw new HaltedError();
    try {
      const entries = await c.catalog(undefined, true);
      return {
        ok: true,
        tools: this.#toolViews(c, entries),
        ...(c.serverInfo ? { server: c.serverInfo } : {}),
      };
    } catch (err) {
      return { ok: false, tools: [], error: c.error ?? (err as Error).message };
    }
  }

  // --- OAuth sign-in (D-063) ------------------------------------------------------

  #oauthServer(name: string): Connection {
    const c = this.#connections.get(name);
    if (!c) throw new McpError('unknown_server', mcpStrings().unknownServer(name));
    if (c.setting.transport !== 'http' || !c.setting.oauth) {
      throw new McpError('invalid_server', mcpStrings().notOauth);
    }
    return c;
  }

  /**
   * Starts a sign-in: the page of the service, or `connected` when saved tokens
   * still work. `origin`: where the user's browser comes back (D-072).
   */
  async oauthStart(name: string, origin?: string): Promise<McpOAuthStartResponse> {
    const c = this.#oauthServer(name);
    const redirectUri = origin ? `${origin}${OAUTH_CALLBACK_PATH}` : this.oauthRedirect();
    try {
      const r = await this.oauth.start(name, c.setting.url ?? '', redirectUri);
      if (r.status === 'connected') {
        await c.stop();
        return { status: 'connected', redirectUri };
      }
      return { status: 'redirect', authorizationUrl: r.authorizationUrl, redirectUri };
    } catch (err) {
      if (err instanceof OAuthFlowError) {
        throw new McpError('oauth_failed', this.redact(err.message));
      }
      throw err;
    }
  }

  /**
   * The browser came back from the service. Never throws for the user's
   * mistakes: the answer is the page to show (`ok`, and a sentence).
   */
  async oauthCallback(params: URLSearchParams): Promise<{ ok: boolean; message: string }> {
    let name: string;
    try {
      name = await this.oauth.finish(params);
    } catch (err) {
      const message = err instanceof OAuthFlowError ? err.message : mcpStrings().wentWrong;
      return { ok: false, message: this.redact(message) };
    }
    const c = this.#connections.get(name);
    if (!c) {
      // Removed while the browser was away: nothing to keep.
      await this.oauth.signOut(name);
      return { ok: false, message: mcpStrings().removedMeanwhile };
    }
    // The next use connects with the new tokens.
    await c.stop();
    this.#o.log.append({
      agent: 'user',
      type: 'mcp_server',
      data: { server: name, action: 'signed_in', transport: 'http', by: 'ui' },
    });
    return { ok: true, message: mcpStrings().connected(c.setting.label ?? name) };
  }

  /** Revokes and forgets the tokens; the server stays, to sign in again. */
  async oauthSignOut(name: string, by: Channel): Promise<McpServersResponse> {
    const c = this.#oauthServer(name);
    await c.stop();
    await this.oauth.signOut(name);
    this.#o.log.append({
      agent: 'user',
      type: 'mcp_server',
      data: { server: name, action: 'signed_out', transport: 'http', by },
    });
    return this.view();
  }

  /** Stops every server (shutdown of the core). */
  async close(): Promise<void> {
    this.#offKill();
    await Promise.all([...this.#connections.values()].map((c) => c.dispose()));
  }
}
