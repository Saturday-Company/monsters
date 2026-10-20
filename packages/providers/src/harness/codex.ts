import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chatgptUnreachableText, SiwcError } from '../chatgpt/siwc.ts';
import { filterModels } from '../http.ts';
import { RateBudget } from '../rate-budget.ts';
import { parseCodexRateLimits } from './limits.ts';
import type {
  HarnessEvent,
  HarnessProvider,
  HarnessTask,
  ListModelsOptions,
  ModelInfo,
} from '../types.ts';
import {
  collectStderr,
  exited,
  exitedWithin,
  HARNESS_TOOL_TIMEOUT_MS,
  harnessEnv,
  parseJsonLine,
  readLines,
  stopChild,
  type HarnessBinary,
} from './common.ts';

/*
 * Harness Codex (D-005 point 2, research 06 §2.2, D-035): the official Codex
 * app-server (`@openai/codex`, Apache-2.0) started with the token of Sign in
 * with ChatGPT, as documented in "Codex app-server" of the SIWC docs:
 *
 *   ACCESS_TOKEN=<SIWC access token> codex app-server --listen stdio:// \
 *     -c model_provider=openai_chatgpt_plan \
 *     -c model_providers.openai_chatgpt_plan.{name,base_url,env_key=ACCESS_TOKEN,
 *        wire_api=responses,requires_openai_auth=false,supports_websockets=false}
 *
 * Never `codex login`: `CODEX_HOME` is a folder of Monsters, so the user's own
 * Codex login and config are not used, and OpenAI keys are removed from the
 * environment. `clientInfo.name` is "Monsters", like `agent_name_hint`.
 * Monsters' tools arrive through MCP (streamable HTTP, bearer from an env var).
 * The protocol is JSON-RPC 2.0 without the `jsonrpc` field, one JSON per line.
 */

export const CODEX_PACKAGE = '@openai/codex';
/** Exact version, published at least two weeks before it was pinned (30/09/2026). */
export const CODEX_VERSION = '0.159.2';
/** `dist.integrity` of that version on registry.npmjs.org (checked after the install). */
export const CODEX_INTEGRITY =
  'sha512-SE13C3nZCYoVL569BdegoOl6vwjb7o2sXOo7ivwVzaVoY0cswwi0/6pIE0TyO/C0vIkQh3jslExitET7PBTfIg==';
export const CODEX_PROVIDER_ID = 'openai_chatgpt_plan';
/** Environment variable holding the run's MCP token (read by Codex, `bearer_token_env_var`). */
export const CODEX_MCP_TOKEN_ENV = 'MONSTERS_MCP_TOKEN';

/** OpenAI variables removed from the Codex child: it must use the ChatGPT plan only. */
export const CODEX_DROPPED_ENV = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'ACCESS_TOKEN',
  // The user's Claude credential has nothing to do in Codex.
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;
/**
 * Every `CODEX_*` of the user's environment goes (`CODEX_API_KEY`, `CODEX_HOME`,
 * those of a Codex session the core was started from): the child gets only ours.
 */
export const CODEX_DROPPED_PREFIXES = ['CODEX_'] as const;

export interface CodexHarnessOptions {
  id?: string;
  binary: () => HarnessBinary | null;
  /** A SIWC access token valid at least `minValidityMs` (refreshed by the caller). */
  accessToken: (options: { minValidityMs: number }) => Promise<string>;
  /** `CODEX_HOME` of Monsters (threads, logs): never the user's `~/.codex`. */
  codexHome: string;
  /** Inference base URL (the SIWC resource). */
  baseURL?: string;
  /** Models of the ChatGPT account (the `chatgpt` provider's list). */
  models?: () => Promise<ModelInfo[]>;
  env?: NodeJS.ProcessEnv;
  isSecret?: (name: string, value: string) => boolean;
  /** Version sent in `clientInfo`. */
  clientVersion?: string;
  /** How long app-server may take to exit after the turn before it is killed (default 5 s). */
  exitGraceMs?: number;
  /** How long app-server may take to answer one JSON-RPC request (default 90 s, F-M3). */
  rpcTimeoutMs?: number;
  /**
   * How long app-server may send nothing during a turn before it counts as hung (default 15 min).
   * The clock waits while an item that acts is open (one of Monsters' tools, a command, a file
   * change): a delegation or a build lasts minutes (F-M3). The core's own watchdog
   * (`HARNESS_IDLE_MS`, 20 min) is longer, so this more precise one stops a silent turn first.
   */
  idleTimeoutMs?: number;
}

/** The longest app-server may sit on a request (`initialize`, `thread/start`, `turn/start`). */
const RPC_TIMEOUT_MS = 90_000;
/** Silence during a turn after which app-server counts as hung. */
const IDLE_TIMEOUT_MS = 15 * 60_000;
/** At most one `heartbeat` event in this time. */
const HEARTBEAT_EVERY_MS = 5_000;

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

const toml = (value: string) => JSON.stringify(value);

/** A string field of a JSON event, or the fallback. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

export function codexArgs(
  baseURL: string,
  mcp: HarnessTask['mcp'],
  options: { foreignCwd?: boolean | undefined } = {},
): string[] {
  const p = `model_providers.${CODEX_PROVIDER_ID}`;
  const sets = [
    // A project's folder (D-097): its AGENTS.md is the project's, never the agent's rules.
    ...(options.foreignCwd ? ['project_doc_max_bytes=0'] : []),
    `model_provider=${toml(CODEX_PROVIDER_ID)}`,
    `${p}.name=${toml('ChatGPT plan')}`,
    `${p}.base_url=${toml(baseURL)}`,
    `${p}.env_key=${toml('ACCESS_TOKEN')}`,
    `${p}.wire_api=${toml('responses')}`,
    `${p}.requires_openai_auth=false`,
    `${p}.supports_websockets=false`,
    `mcp_servers.${mcp.name}.url=${toml(mcp.url)}`,
    `mcp_servers.${mcp.name}.bearer_token_env_var=${toml(CODEX_MCP_TOKEN_ENV)}`,
    // A delegation lasts minutes (D-078): Codex's own default would cut the call.
    `mcp_servers.${mcp.name}.tool_timeout_sec=${HARNESS_TOOL_TIMEOUT_MS / 1000}`,
  ];
  return ['app-server', '--listen', 'stdio://', ...sets.flatMap((s) => ['-c', s])];
}

/** The environment of the Codex child: the user's, minus keys, plus the SIWC token. */
export function codexEnv(
  base: NodeJS.ProcessEnv,
  set: { accessToken: string; codexHome: string; mcpToken: string },
  isSecret?: (name: string, value: string) => boolean,
): Record<string, string> {
  return harnessEnv(base, {
    drop: CODEX_DROPPED_ENV,
    dropPrefixes: CODEX_DROPPED_PREFIXES,
    ...(isSecret ? { isSecret } : {}),
    set: {
      ACCESS_TOKEN: set.accessToken,
      CODEX_HOME: set.codexHome,
      [CODEX_MCP_TOKEN_ENV]: set.mcpToken,
    },
  });
}

class RpcPeer {
  readonly #child: ChildProcess;
  #next = 1;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(child: ChildProcess) {
    this.#child = child;
    child.stdin?.on('error', () => {});
  }

  send(message: Record<string, unknown>): void {
    if (this.#child.stdin?.writable) this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Sends a request; it fails when app-server does not answer within `timeoutMs` (hung process). */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.#next++;
    const p = new Promise<unknown>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#pending.delete(id);
              reject(
                new Error(
                  `codex app-server non risponde a ${method} (${Math.round(timeoutMs / 1000)} s)`,
                ),
              );
            }, timeoutMs);
      timer?.unref();
      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    p.catch(() => {});
    this.send({ id, method, params });
    return p;
  }

  /** Settles a pending request; true when the message was a response. */
  settle(msg: Record<string, unknown>): boolean {
    if (msg['method'] !== undefined || typeof msg['id'] !== 'number') return false;
    const waiting = this.#pending.get(msg['id']);
    if (!waiting) return true;
    this.#pending.delete(msg['id']);
    const err = msg['error'] as { message?: string } | undefined;
    if (err) waiting.reject(new Error(err.message ?? 'codex app-server error'));
    else waiting.resolve(msg['result']);
    return true;
  }

  failAll(err: Error): void {
    for (const w of this.#pending.values()) w.reject(err);
    this.#pending.clear();
  }
}

/**
 * The app-server request of Codex's own `request_user_input` tool (0.159.2 lists the tool to
 * the model whatever the thread's flags, M4 of the review of 19/10).
 */
export const CODEX_USER_INPUT_REQUEST = 'item/tool/requestUserInput';

/**
 * What `request_user_input` answers (D-135): Monsters' words, never put in the user's mouth.
 * The question did not reach anyone; questions go through `ask_user` of `monsters`. Before,
 * an error "not supported by Monsters" made a monster write "non ho potuto chiederti".
 */
export const CODEX_USER_INPUT_ANSWER =
  '[Monsters, non l’utente] Questa domanda non è arrivata all’utente: in Monsters le domande si fanno con `ask_user` del server `monsters` (se è tra i tuoi strumenti), altrimenti scrivi la domanda nel rapporto. Non è un no dell’utente.';

/** The answer to `request_user_input`: every question gets Monsters' words (D-135). */
export function codexUserInputResult(params: unknown): Record<string, unknown> {
  const questions = (params as { questions?: unknown } | undefined)?.questions;
  const ids = Array.isArray(questions)
    ? questions
        .map((q: unknown) => (q as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === 'string')
    : [];
  return {
    answers: Object.fromEntries(ids.map((id) => [id, { answers: [CODEX_USER_INPUT_ANSWER] }])),
  };
}

/** Answers the app-server's own requests: Monsters never approves anything on its own. */
function answerServerRequest(peer: RpcPeer, msg: Record<string, unknown>): void {
  const id = msg['id'];
  switch (msg['method']) {
    case CODEX_USER_INPUT_REQUEST:
      peer.send({ id, result: codexUserInputResult(msg['params']) });
      break;
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      peer.send({ id, result: { decision: 'decline' } });
      break;
    case 'execCommandApproval':
    case 'applyPatchApproval':
      peer.send({ id, result: { decision: 'denied' } });
      break;
    case 'mcpServer/elicitation/request':
      peer.send({ id, result: { action: 'decline', content: null, _meta: null } });
      break;
    default:
      peer.send({ id, error: { code: -32601, message: 'not supported by Monsters' } });
  }
}

/**
 * Configuration of a thread. The `read-only` sandbox only stops writes: a
 * command can still read the whole disk (`~/.monsters/secrets` included). An
 * agent without the `shell` permission therefore gets no command tool at all
 * (`shell_tool`, `unified_exec`), nor sub-agents or local image reading.
 * Codex's own web search (on the ChatGPT plan, D-069) is on only for an agent
 * with the web (D-026), `live` like Claude Code's; pages are still read with
 * Monsters' `web_fetch`. Checked on 0.159.2: with these flags the request to
 * the model lists only `request_user_input` and the goal tools besides MCP
 * (and `web_search` when on). The `workspace-write` sandbox keeps the network
 * closed to commands (`network_access` false by default, per the Codex docs): `git push`, `curl`
 * and the like fail there, so the brake has nothing to stop on the terminal.
 */
export function codexThreadConfig(
  systemTools: boolean,
  webSearch = false,
): Record<string, unknown> {
  return {
    web_search: webSearch ? 'live' : 'disabled',
    ...(systemTools
      ? {}
      : {
          features: {
            shell_tool: false,
            unified_exec: false,
            multi_agent: false,
            view_image: false,
          },
        }),
  };
}

const ERROR_CODES: Record<string, string> = {
  // Codex runs on the ChatGPT plan: the UI shows OpenAI's usage-limit state.
  usageLimitExceeded: 'chatgpt_usage_limit',
  unauthorized: 'unauthorized',
  rateLimitExceeded: 'rate_limit',
  contextWindowExceeded: 'context',
};

export class CodexHarness implements HarnessProvider {
  readonly kind = 'harness';
  readonly auth = 'oauth-siwc';
  readonly id: string;
  readonly budget: RateBudget;
  readonly #o: CodexHarnessOptions;

  constructor(options: CodexHarnessOptions) {
    this.id = options.id ?? 'codex';
    this.#o = options;
    this.budget = new RateBudget({ id: this.id, windows: [], limitScope: 'account' });
  }

  async listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    const models = this.#o.models ? await this.#o.models() : [];
    return filterModels(models, options);
  }

  async *run(task: HarnessTask, signal: AbortSignal): AsyncGenerator<HarnessEvent> {
    const binary = this.#o.binary();
    if (!binary) {
      yield {
        type: 'done',
        reason: 'error',
        code: 'not_found',
        error: 'Codex non è installato: attivalo in Impostazioni → Modelli.',
      };
      return;
    }
    let token: string;
    try {
      // A turn must not outlive its token: Codex reads it once at start.
      token = await this.#o.accessToken({ minValidityMs: 20 * 60_000 });
    } catch (err) {
      // Signed out only when the sign-in is really gone; otherwise OpenAI could not be reached.
      const code =
        err instanceof SiwcError && err.code === 'signed_out' ? 'signed_out' : 'unavailable';
      // OpenAI out of reach: the user reads why, in Italian (the English cause stays in `cause`).
      const error = chatgptUnreachableText(err, 'in_use') ?? (err as Error).message;
      yield { type: 'done', reason: 'error', code, error };
      return;
    }
    signal.throwIfAborted();
    mkdirSync(this.#o.codexHome, { recursive: true, mode: 0o700 });
    const baseURL = this.#o.baseURL ?? 'https://api.openai.com/v1';
    const child = task.spawn(
      binary.command,
      [...binary.args, ...codexArgs(baseURL, task.mcp, { foreignCwd: task.foreignCwd })],
      {
        cwd: task.cwd,
        env: {
          ...codexEnv(
            this.#o.env ?? process.env,
            { accessToken: token, codexHome: this.#o.codexHome, mcpToken: task.mcp.token },
            this.#o.isSecret,
          ),
          ...binary.env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const stderr = collectStderr(child);
    const exit = exited(child);
    const peer = new RpcPeer(child);
    const rpcMs = this.#o.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
    void exit.then(() => peer.failAll(new Error('codex app-server exited')));

    // Notifications are queued and yielded in order; requests are answered on the fly.
    const queue: Record<string, unknown>[] = [];
    const signals: { wake: (() => void) | null; ended: boolean } = { wake: null, ended: false };
    void (async () => {
      try {
        for await (const line of readLines(child.stdout!)) {
          const msg = parseJsonLine(line);
          if (!msg || peer.settle(msg)) continue;
          if (msg['id'] !== undefined && typeof msg['method'] === 'string') {
            answerServerRequest(peer, msg);
            continue;
          }
          queue.push(msg);
          signals.wake?.();
        }
      } catch {
        // The pipe broke: the process is going, the turn ends below.
      } finally {
        signals.ended = true;
        signals.wake?.();
      }
    })();
    /** Items that act (tools, commands, file changes) app-server started and has not finished. */
    const openActions = new Set<string>();
    /** Last sign of life given to the runner for a notification that has no event of its own. */
    let lastBeat = 0;
    const idleMs = this.#o.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    const nextNotification = async (): Promise<Record<string, unknown> | null> => {
      let quietSince = Date.now();
      while (queue.length === 0) {
        if (signals.ended) return null;
        let timer: NodeJS.Timeout | undefined;
        const timedOut = await Promise.race([
          new Promise<false>((r) => {
            signals.wake = () => r(false);
          }),
          new Promise<true>((r) => {
            timer = setTimeout(() => r(true), Math.max(5, Math.min(idleMs, 5000)));
          }),
        ]);
        clearTimeout(timer);
        signals.wake = null;
        if (openActions.size > 0) quietSince = Date.now();
        else if (timedOut && Date.now() - quietSince >= idleMs) {
          throw new Error(`codex app-server non dà segnali da ${Math.round(idleMs / 1000)} s`);
        }
      }
      return queue.shift()!;
    };

    let threadId: string | undefined;
    let turnId: string | undefined;
    let model = task.model ?? 'codex';
    /** Token totals of the thread already counted (a resumed thread starts with its past). */
    let counted: { in: number; out: number } | null = null;
    /** Model requests of this turn, against `maxTurns` (Codex has no such option). */
    let requests = 0;
    let maxed = false;
    /** An acting item (tool, command, file change) started since the last usage update. */
    let actedSinceUsage = false;
    /** Stops the turn once the steps are used up; true when it did just now. */
    const stopIfOutOfSteps = (): boolean => {
      if (!task.maxTurns || requests < task.maxTurns || maxed) return false;
      maxed = true;
      if (threadId && turnId)
        void peer.request('turn/interrupt', { threadId, turnId }, rpcMs).catch(() => {});
      return true;
    };
    const onAbort = () => {
      if (threadId && turnId)
        void peer.request('turn/interrupt', { threadId, turnId }, rpcMs).catch(() => {});
      setTimeout(() => {
        stopChild(child, 'SIGINT');
      }, 1000).unref();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await peer.request(
        'initialize',
        {
          clientInfo: {
            name: 'Monsters',
            title: 'Monsters',
            version: this.#o.clientVersion ?? '0.0.0',
          },
          capabilities: null,
        },
        rpcMs,
      );
      peer.send({ method: 'initialized', params: {} });
      const threadParams = {
        cwd: task.cwd,
        approvalPolicy: 'never',
        sandbox: task.systemTools ? 'workspace-write' : 'read-only',
        config: codexThreadConfig(task.systemTools, task.webSearch === true),
        ...(task.model ? { model: task.model } : {}),
        ...(task.instructions ? { developerInstructions: task.instructions } : {}),
      };
      const started = (await (task.resume
        ? peer.request('thread/resume', { threadId: task.resume, ...threadParams }, rpcMs)
        : peer.request('thread/start', { ...threadParams, serviceName: 'Monsters' }, rpcMs))) as {
        thread?: { id?: string };
        model?: string;
      };
      threadId = started.thread?.id;
      if (!threadId) throw new Error('codex app-server did not return a thread');
      if (started.model) model = started.model;
      yield { type: 'session', id: threadId, model };
      const turn = (await peer.request(
        'turn/start',
        {
          threadId,
          input: [
            { type: 'text', text: task.prompt, text_elements: [] },
            // Images the user attached (files feature, D-075): read by Codex from the disk.
            ...(task.images ?? []).map((path) => ({ type: 'localImage', path })),
          ],
        },
        rpcMs,
      )) as { turn?: { id?: string } };
      turnId = turn.turn?.id;
      if (signal.aborted) onAbort();

      let lastError: string | undefined;
      for (;;) {
        const msg = await nextNotification();
        if (!msg) break;
        const params = (msg['params'] ?? {}) as Record<string, unknown>;
        switch (msg['method']) {
          case 'item/agentMessage/delta':
            if (typeof params['delta'] === 'string')
              yield { type: 'text-delta', delta: params['delta'] };
            break;
          case 'item/started': {
            const item = (params['item'] ?? {}) as Record<string, unknown>;
            const id = str(item['id']);
            const acting = ['mcpToolCall', 'commandExecution', 'fileChange'].includes(
              str(item['type']),
            );
            if (acting) {
              actedSinceUsage = true;
              openActions.add(id);
            }
            // The command is already running (approval `never`): its call is always traced,
            // so the audit never has a result without its call (F-B10).
            if (acting) stopIfOutOfSteps();
            if (item['type'] === 'mcpToolCall') {
              const server = str(item['server']);
              yield {
                type: 'tool-call',
                id,
                name: str(item['tool']),
                input: item['arguments'] ?? {},
                ...(server === task.mcp.name ? { monsters: true } : {}),
              };
            } else if (item['type'] === 'commandExecution') {
              yield { type: 'tool-call', id, name: 'shell', input: { command: item['command'] } };
            } else if (item['type'] === 'fileChange') {
              yield {
                type: 'tool-call',
                id,
                name: 'file_change',
                input: { changes: item['changes'] },
              };
            }
            break;
          }
          case 'item/completed': {
            const item = (params['item'] ?? {}) as Record<string, unknown>;
            const id = str(item['id']);
            openActions.delete(id);
            if (item['type'] === 'agentMessage' && typeof item['text'] === 'string') {
              yield { type: 'text', text: item['text'] };
            } else if (item['type'] === 'mcpToolCall') {
              const failed = item['status'] === 'failed' || item['error'] != null;
              yield {
                type: 'tool-result',
                id,
                output: failed ? item['error'] : item['result'],
                ...(failed ? { isError: true } : {}),
                ...(str(item['server']) === task.mcp.name ? { monsters: true } : {}),
              };
            } else if (item['type'] === 'commandExecution') {
              const code = item['exitCode'];
              yield {
                type: 'tool-result',
                id,
                output: { output: item['aggregatedOutput'], exitCode: code },
                ...(typeof code === 'number' && code !== 0 ? { isError: true } : {}),
              };
            } else if (item['type'] === 'fileChange') {
              yield {
                type: 'tool-result',
                id,
                output: { status: item['status'] },
                ...(item['status'] === 'failed' ? { isError: true } : {}),
              };
            }
            break;
          }
          case 'thread/tokenUsage/updated': {
            // `total` is the thread's running count and the same update may come
            // twice: what grew since the last one is this request's usage.
            const usage = (params['tokenUsage'] ?? {}) as {
              total?: { inputTokens?: number; outputTokens?: number };
              last?: { inputTokens?: number; outputTokens?: number };
            };
            const total = {
              in: count(usage.total?.inputTokens),
              out: count(usage.total?.outputTokens),
            };
            counted ??= {
              in: Math.max(0, total.in - count(usage.last?.inputTokens)),
              out: Math.max(0, total.out - count(usage.last?.outputTokens)),
            };
            const inTok = Math.max(0, total.in - counted.in);
            const outTok = Math.max(0, total.out - counted.out);
            counted = { in: Math.max(counted.in, total.in), out: Math.max(counted.out, total.out) };
            if (inTok > 0 || outTok > 0) {
              requests++;
              yield { type: 'usage', model, inTok, outTok };
              // The request that used the last step asked for work: stop here, before the
              // command starts, not at its `item/started` when it is already running (F-B10).
              if (actedSinceUsage) stopIfOutOfSteps();
              actedSinceUsage = false;
            }
            break;
          }
          case 'account/rateLimits/updated': {
            // D-111: the plan's limits, as Codex announces them (never asked for).
            const reading = parseCodexRateLimits(params, Date.now());
            if (reading) yield { type: 'plan-limits', reading };
            break;
          }
          case 'error': {
            const e = (params['error'] ?? {}) as { message?: string };
            if (params['willRetry'] !== true && e.message) lastError = e.message;
            break;
          }
          case 'turn/completed': {
            const t = (params['turn'] ?? {}) as {
              status?: string;
              error?: { message?: string; codexErrorInfo?: unknown } | null;
            };
            if (t.status === 'completed') {
              yield { type: 'done', reason: 'stop' };
            } else if (maxed && !signal.aborted) {
              yield { type: 'done', reason: 'max-steps' };
            } else if (t.status === 'interrupted' || signal.aborted) {
              yield { type: 'done', reason: 'aborted' };
            } else {
              const info = t.error?.codexErrorInfo;
              const code = typeof info === 'string' ? ERROR_CODES[info] : undefined;
              const message = t.error?.message ?? lastError ?? 'Codex turn failed';
              yield {
                type: 'done',
                reason: 'error',
                // Codex reads the token once: a turn longer than its validity ends here.
                error:
                  code === 'unauthorized'
                    ? `Il token di ChatGPT non vale più a metà del turno: riprova (${message})`
                    : message,
                ...(code ? { code } : {}),
              };
            }
            return;
          }
          default:
            // Output of a running command, reasoning, plan updates: the turn is alive, though
            // nothing of it is logged. One sign of life every few seconds is enough.
            if (Date.now() - lastBeat >= HEARTBEAT_EVERY_MS) {
              lastBeat = Date.now();
              yield { type: 'heartbeat' };
            }
            break;
        }
      }
      await exit;
      if (signal.aborted) {
        yield { type: 'done', reason: 'aborted' };
      } else {
        const tail = stderr();
        yield {
          type: 'done',
          reason: 'error',
          error: `Codex si è chiuso prima della fine del turno${tail ? `: ${tail.slice(-500)}` : ''}`,
        };
      }
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }
      const tail = stderr();
      yield {
        type: 'done',
        reason: 'error',
        error: `${(err as Error).message}${tail ? `: ${tail.slice(-500)}` : ''}`,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      child.stdin?.end();
      if (child.exitCode === null && child.signalCode === null) {
        stopChild(child, 'SIGINT');
        // One that stays after its turn is killed (never holds the run).
        void exitedWithin(child, exit, this.#o.exitGraceMs ?? 5000);
      }
    }
  }
}
