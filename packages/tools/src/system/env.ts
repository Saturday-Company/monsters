import { posix, win32 } from 'node:path';

/*
 * Environment of the commands an agent runs: the user's environment without
 * the secrets of Monsters and the variables of a Claude Code or Codex session
 * the core was started from, plus the agent's own folders for CLIs (installed
 * without sudo, in the agent's folder) and settings that keep programs from
 * waiting for input or paging their output.
 */

/** Variables that hold secrets or configuration of Monsters itself. */
const MONSTERS_SECRET_NAMES = new Set([
  'OPENROUTER_API_KEY',
  'BRAVE_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  // Provider keys Monsters may read from the environment (Phase 2 providers).
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
]);

/** True for `MONSTERS_*` and the keys Monsters uses: never passed to a child process. */
export function isMonstersEnv(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.startsWith('MONSTERS_') || MONSTERS_SECRET_NAMES.has(upper);
}

const CLAUDE_SESSION_NAMES = new Set(['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT']);
const CLAUDE_USER_NAMES = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH']);
const CODEX_SESSION_NAMES = new Set([
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_THREAD_ID',
]);

/**
 * True for a variable of the Claude Code or Codex session the core was started
 * from (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, the socket and token of its
 * messaging, `AI_AGENT`, `CODEX_SANDBOX`…): an agent's command or an MCP server
 * has nothing to do with that session and must not reach it. The user's own
 * `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_GIT_BASH_PATH` stay. Same list as
 * `isAgentSessionVar` of `@monsters/providers` (harness processes).
 */
export function isAgentSessionEnv(name: string): boolean {
  const upper = name.toUpperCase();
  if (CLAUDE_SESSION_NAMES.has(upper) || CODEX_SESSION_NAMES.has(upper)) return true;
  return upper.startsWith('CLAUDE_CODE_') && !CLAUDE_USER_NAMES.has(upper);
}

/** Path rules of the platform the commands run on (separator and PATH delimiter). */
function pathOf(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/** Folders of an agent's CLIs, in PATH order. */
export function agentBinDirs(workspace: string, platform: NodeJS.Platform): string[] {
  const path = pathOf(platform);
  const tools = path.join(workspace, '.tools');
  return [
    path.join(workspace, 'bin'),
    path.join(tools, 'bin'),
    // npm puts global commands in the prefix itself on Windows, pip in Scripts.
    ...(platform === 'win32' ? [tools, path.join(tools, 'Scripts')] : []),
  ];
}

export interface ChildEnvOptions {
  workspace: string;
  base: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** Further variables to drop (e.g. a value equal to a known secret). */
  isSecret?: (name: string, value: string) => boolean;
}

export function childEnv(options: ChildEnvOptions): Record<string, string> {
  const { workspace, base, platform } = options;
  const path = pathOf(platform);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || isMonstersEnv(name) || isAgentSessionEnv(name)) continue;
    if (options.isSecret?.(name, value)) continue;
    env[name] = value;
  }
  // Windows variables are case-insensitive: keep whatever spelling PATH has.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [...agentBinDirs(workspace, platform), env[pathKey]]
    .filter((p): p is string => Boolean(p))
    .join(path.delimiter);
  const tools = path.join(workspace, '.tools');
  const bin = path.join(tools, 'bin');
  Object.assign(env, {
    // Global installs land in the agent's folder (no sudo, removed with the agent).
    NPM_CONFIG_PREFIX: tools,
    PYTHONUSERBASE: tools,
    PIPX_HOME: path.join(tools, 'pipx'),
    PIPX_BIN_DIR: bin,
    UV_TOOL_DIR: path.join(tools, 'uv'),
    UV_TOOL_BIN_DIR: bin,
    CARGO_INSTALL_ROOT: tools,
    GOBIN: bin,
    // No colours, pagers or prompts: nobody can answer them.
    NO_COLOR: '1',
    TERM: 'dumb',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    DEBIAN_FRONTEND: 'noninteractive',
    npm_config_yes: 'true',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  });
  return env;
}
