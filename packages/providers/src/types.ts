import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { ModelPrice } from './cost.ts';
import type { Effort, PlanLimitsReading } from '@monsters/shared';
import type { RateBudget } from './rate-budget.ts';

/*
 * Provider interface (ARCHITECTURE §5.6, research 02 §"Interfaccia provider").
 * Two kinds behind the same base: `model` providers plug a language model into
 * our own loop (AI SDK); `harness` providers run an external official agent
 * (Claude Code, Codex) and we only read its events.
 */

/** How the user authenticates with the provider. */
export type ProviderAuth = 'none' | 'api-key' | 'oauth-siwc' | 'external-login';

export interface ModelInfo {
  id: string;
  name?: string;
  /** One line on what the model is ("veloce", "il più capace"), when the service has it. */
  description?: string;
  /** Supports tool calling. */
  tools: boolean;
  /** Free of charge (e.g. OpenRouter `:free` models and the free router). */
  free: boolean;
  /** Context window in tokens, when known. */
  context?: number;
  /** What the model reads besides text, when the provider says (`image`, `file`, `audio`…). */
  input?: string[];
  /** Price in USD per million tokens, when the provider's list says it (OpenRouter). */
  price?: ModelPrice;
}

export interface ListModelsOptions {
  /** Only models that support tool calling. */
  tools?: boolean;
  /** Only free models. */
  free?: boolean;
  /** Bypass the cache. */
  refresh?: boolean;
  signal?: AbortSignal;
}

interface ProviderBase {
  /** Stable id used in `agent.yaml` (e.g. `openrouter`, `groq`, `claude-code`). */
  readonly id: string;
  readonly auth: ProviderAuth;
  /** Shared by every agent using this provider: requests queue here instead of failing. */
  readonly budget: RateBudget;
  /**
   * Fingerprint of the credentials in use (`keyFingerprint`), when the quota
   * belongs to them: logged with each request so a restart only restores the
   * requests of the same key.
   */
  readonly keyId?: string | undefined;
  listModels(options?: ListModelsOptions): Promise<ModelInfo[]>;
}

export interface ModelProvider extends ProviderBase {
  readonly kind: 'model';
  /** Returns the language model used by our loop. Must be cheap: called per request. */
  model(modelId: string): LanguageModelV4;
  /**
   * Maps the model that actually served a request (as reported by the response)
   * to the id to pin for the session, e.g. a router answer to a concrete
   * `:free` model. Returning `undefined` keeps the requested id.
   */
  servedModelId?(requested: string, served: string | undefined): string | undefined;
  /**
   * Any failure ends the chain instead of moving to the next link: a plan the
   * user pays for (ChatGPT) must never switch silently to another way of
   * paying (OpenAI's SIWC rules, D-035). The error reaches the user as it is.
   */
  readonly stopsChain?: boolean;
  /**
   * How long a request may wait for the first token before the session tries
   * the next link (D-064). Default `DEFAULT_FIRST_CHUNK_MS`; local servers set
   * more, they may have to load the model first.
   */
  readonly firstChunkTimeoutMs?: number;
  /**
   * The model caches prompts only with explicit breakpoints (Anthropic, also
   * through OpenRouter): the session marks the system prompt and the last
   * message of every request (D-064).
   */
  promptCache?(modelId: string): boolean;
}

/**
 * Starts a child process tied to the kill switch (`ControlScope.spawn` in the
 * core): its whole process group is stopped by a kill, a `killRun` or the end
 * of the run.
 */
export type HarnessSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** The MCP endpoint of the core that serves this agent's Monsters tools for one run. */
export interface HarnessMcpServer {
  /** Server name seen by the harness (`monsters`): its tools are `mcp__monsters__<tool>`. */
  name: string;
  /** Streamable HTTP URL on 127.0.0.1. */
  url: string;
  /** Bearer token valid for this run only. */
  token: string;
}

/**
 * The core's hook endpoint for one run (D-069): the harness asks it before
 * its own tools that may leave the computer (terminal, web search, services
 * reached through it) and before it stops, with the run's bearer token.
 */
export interface HarnessHooks {
  /** `POST` address on 127.0.0.1 (`/api/harness/hook`). */
  url: string;
  token: string;
  /** Ask the core before the agent ends its turn ("finito davvero?", a question left in the text). */
  stop: boolean;
}

/** A command a harness wants to run outside its sandbox (Codex escalation, D-158). */
export interface HarnessCommandCall {
  /** Id of the harness's item, the same as its `tool-call` event. */
  id: string;
  /** The command line as the model wrote it (the harness's shell wrapper removed). */
  command: string;
  cwd?: string;
  /** Why the model asks, in its words (Codex's `justification`). */
  reason?: string;
}

/**
 * Asked before a command leaves the harness's sandbox (D-158): null runs it,
 * a text refuses it with Monsters' own words for the model.
 */
export type HarnessCommandApproval = (
  call: HarnessCommandCall,
  signal: AbortSignal,
) => Promise<string | null>;

/**
 * A service the harness reaches with its own sign-in (D-069), never through
 * Monsters: a claude.ai connector the user connected on claude.ai, or a
 * first-party server Claude Code authenticates itself (Claude Design).
 */
export interface HarnessConnector {
  /**
   * Server name as the harness knows it: `claude.ai Figma` for a connector,
   * a plain name (`claude-design`) for a server of the run's MCP config.
   */
  name: string;
  kind: 'claude-ai' | 'http';
  /** claude-ai: the address pattern that admits it (`https://mcp.figma.com/*`); http: the server. */
  url: string;
}

export interface HarnessTask {
  prompt: string;
  /** Working folder of the agent: AGENTS.md (and CLAUDE.md for Claude) are here. */
  cwd: string;
  /**
   * `cwd` is a folder of the user (a project's, D-097), not the agent's own:
   * the harness reads no instructions file of it (Codex: no project docs; the
   * agent's AGENTS.md comes in `instructions`).
   */
  foreignCwd?: boolean;
  /** Text appended to the harness's own system prompt (brief, rules of Monsters). */
  instructions?: string;
  /** Model id on the harness (`sonnet`, …); the harness default otherwise. */
  model?: string;
  /** Effort of the run (D-110): Claude Code `--effort`; Codex ignores it. The harness default otherwise. */
  effort?: Effort;
  mcp: HarnessMcpServer;
  /** The agent may use the harness's own terminal and file tools (`shell` permission). */
  systemTools: boolean;
  /**
   * The harness's own web search (Claude Code `WebSearch`, Codex `web_search`):
   * only for an agent with the web tools (D-026). Pages are still read with
   * Monsters' `web_fetch`.
   */
  webSearch?: boolean;
  /** Where the harness asks the core before acting on its own (Claude Code hooks). */
  hooks?: HarnessHooks;
  /**
   * Codex (D-158): the core's check before a command leaves the sandbox, the
   * same Claude Code's `Bash` gets from the `PreToolUse` hook (data folder,
   * harness configuration, the brake). Without it Codex never escalates and its
   * commands have no network.
   */
  approveCommand?: HarnessCommandApproval;
  /**
   * Absolute paths the harness's own file tools must never touch (D-078: the
   * data folder of Monsters minus the agent's workspace). The certain check
   * is the core's `PreToolUse` hook; these become deny rules of the run too.
   */
  forbiddenPaths?: string[];
  /**
   * Absolute paths of files the user attached that the harness reads itself
   * (Claude Code: `Read` allowed on exactly these, also without the terminal).
   */
  readFiles?: string[];
  /** Absolute paths of attached images given to the model as images (Codex `localImage`). */
  images?: string[];
  /** Services reached through the harness's sign-in (Claude Code only). */
  connectors?: HarnessConnector[];
  /** Session/thread of an earlier turn to continue. */
  resume?: string;
  /**
   * A one-shot answer with no tool at all (the summary of a conversation,
   * D-082): no MCP server is configured and the harness's own tools are off.
   * Claude Code only; `mcp` is then ignored.
   */
  plain?: boolean;
  maxTurns?: number;
  spawn: HarnessSpawn;
  /** Private folder for this run (MCP config file, 0700): removed by the caller. */
  scratchDir: string;
  /**
   * Called synchronously when the run's signal aborts, with the usage of the
   * model request still in flight (as far as it is known): the caller records
   * it before a kill closes the run. That usage is then not yielded.
   */
  onAbortUsage?: (usage: HarnessUsageEvent) => void;
  /**
   * Hands the caller a way to tell the model something during the turn (D-170: the wrap-up at
   * a limit). `send` adds `text` before the next model request and resolves to false when it
   * could not. Codex only (a `developer` note in the thread); Claude Code's stdin is closed
   * after the first message, there the core's hooks say it.
   */
  steer?: (send: (text: string) => Promise<boolean>) => void;
}

export type HarnessUsageEvent = Extract<HarnessEvent, { type: 'usage' }>;

/** Events a harness provider streams back; the runner turns them into log events. */
export type HarnessEvent =
  | { type: 'session'; id: string; model?: string }
  | { type: 'text-delta'; delta: string }
  /** A complete assistant message. */
  | { type: 'text'; text: string }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: unknown;
      /** Set when the tool is one of Monsters' (already logged by the MCP endpoint). */
      monsters?: boolean;
    }
  | { type: 'tool-result'; id: string; output: unknown; isError?: boolean; monsters?: boolean }
  | {
      type: 'usage';
      model: string;
      /** Input tokens of the request, cache reads and writes included. */
      inTok: number;
      outTok: number;
      costUsd?: number;
      /** Of `inTok`: read from the prompt cache (Claude Code reports it). */
      cacheReadTok?: number;
      /** Of `inTok`: written to the prompt cache. */
      cacheWriteTok?: number;
      /** The rest of a turn's total, not one request: its input is no context. */
      aggregate?: boolean;
    }
  /**
   * MCP servers of the run as the harness reports them while it starts (server name →
   * `connected` | `failed` | `pending` | `needs-auth`); Codex: `mcpServer/startupStatus/updated`
   * (several updates, `pending` first); Claude Code: the `init`, once, before the model's first
   * request (`pending` there means its tools miss that request). The runner stops or starts
   * again a run whose `monsters` server is not connected when the model starts (D-160).
   */
  | { type: 'mcp-status'; servers: Record<string, string> }
  /** The plan's limits as the official program reports them (D-111); nothing is asked for. */
  | { type: 'plan-limits'; reading: PlanLimitsReading }
  /**
   * The harness is working on something it does not report (a command printing output, a
   * sub-agent's steps): only a sign of life for the runner's watchdog, nothing to log.
   */
  | { type: 'heartbeat' }
  | {
      type: 'done';
      reason: 'stop' | 'max-steps' | 'aborted' | 'error';
      error?: string;
      /** Machine code of the failure (`not_logged_in`, `usage_limit`, …). */
      code?: string;
      /** Final answer when the harness reports it. */
      text?: string;
      /**
       * Calls the harness's own permission rules refused (Claude Code's
       * `permission_denials`, D-127): never the user's refusal.
       */
      denials?: { tool: string; id: string }[];
    };

/** Claude Agent, Codex: the loop belongs to an external official agent (D-005, M2.7). */
export interface HarnessProvider extends ProviderBase {
  readonly kind: 'harness';
  run(task: HarnessTask, signal: AbortSignal): AsyncIterable<HarnessEvent>;
}

export type Provider = ModelProvider | HarnessProvider;

/** One link of a fallback chain: a provider and a model id on it. */
export interface ModelRef {
  provider: string;
  model: string;
  /**
   * How hard the model thinks (D-110), set by the core for a monster in "Automatica":
   * Claude Code `--effort`, Anthropic `effort`, OpenRouter `reasoning.effort`. Ignored
   * by every other provider and when absent (the model's default).
   */
  effort?: Effort | undefined;
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}
