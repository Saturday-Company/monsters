import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  CORE_VERSION,
  DEFAULT_HOST,
  homePaths,
  installProcessGuard,
  languageOfHome,
  loadHubSettings,
  newVaultLayout,
  resolveHome,
  startCore,
  type ServerInfo,
} from '@monsters/core';
import {
  DEFAULT_PORT,
  setAppLang,
  systemLang,
  VAULT_LAYOUTS,
  type Lang,
  type StatusResponse,
  type VaultLayout,
} from '@monsters/shared';
import { detectVaultLayout } from '@monsters/vault';
import { checkTunnelProof, newTunnelProofNonce, prepareCoreProcess } from '@monsters/shared/node';
import { cmdAutomations } from './automations.ts';
import { cmdAnswer, cmdChat, cmdVault, terminalSafe, type CoreAccess } from './chat.ts';
import { runVaultMcp } from './mcp.ts';
import { cmdLog } from './log.ts';
import { ignoreBrokenPipe } from './broken-pipe.ts';
import { cmdChatInteractive } from './repl.ts';
import { cmdPassword } from './password.ts';
import { cmdSecrets } from './secrets.ts';
import {
  attachDesktopBridge,
  desktopKeychain,
  parentPort,
  reportStartFailure,
} from './desktop-bridge.ts';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Raw output (streamed answers of the interactive chat). */
  write?: (text: string) => void;
  /** Lines typed by the user, for the interactive chat. Default stdin. */
  input?: NodeJS.ReadableStream;
  tty?: boolean;
}

const defaultIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  write: (text) => process.stdout.write(text),
};

// i18n-ignore: the help is English; the chat commands are English first (the Italian names work too)
const HELP = `monsters ${CORE_VERSION} - local agentic hub

Usage: monsters <command> [options]

Commands:
  start      Start the core in the foreground (Ctrl+C to stop)
  status     Show whether the core is running and what it is doing
  kill       Stop every agent now (kill switch); nothing runs until resume
  resume     Allow agents to run again after a kill
  stop <monster>          Stop the work of one monster (its chat, its automations, its tasks
                          for others); the other monsters go on, nothing stays stopped
  chat                    Interactive chat in the terminal (also over SSH): answers as they are
                          written, questions with numbered options, /stop, /new, /status
  chat <text>             Send a message (to the orchestrator, or --to / @Name) and follow the run
  chat /new [@Name]       Start a new conversation (alias /nuova): the agents no longer see
                          the earlier messages, which stay in the log
  answer <id> <n|text>    Answer a question of an agent
  vault reindex           Rebuild the search index of the vault
  automations [list]      The automations: schedule, next run, last run
  automations run <id>    Run an automation now (or as soon as its capo is free)
  log [status]            The archive of the event log: where it is, the monthly files
  log archive             Move the bulky old events (usage, tool results, streamed text…)
                          to ~/.monsters/archive/events-YYYY-MM.jsonl.gz now, then VACUUM
                          (--dry-run: only count them). The core does it once a day by itself
  log read --month YYYY-MM
                          Print the archived events of a month (--type t1,t2; --json)
  secrets                 Where keys and tokens are kept: system keychain or protected files
  secrets export          Decrypt them back to plain files (core stopped; e.g. before moving
                          the data directory to another computer)
  secrets reset           The keychain lost the key of this data directory for good: set the
                          encrypted secrets aside and make a new key (core stopped)
  password                Set a new password for the account, on this computer, with
                          Monsters stopped (asks it twice; every browser session is
                          logged out)
  mcp        MCP server (stdio) with the vault tools, for Claude Desktop, Codex, Cursor…
             (needs the core running; see docs/mcp-vault.md)
  help       Show this help
  version    Print the version

Options:
  --home <dir>            Data directory (default: $MONSTERS_HOME or ~/.monsters)
  --port <n>              Port of the core (default: ${DEFAULT_PORT})
  --prefer-port <n>       Try this port first; if it is taken, take any free one (start only;
                          the desktop app uses it to keep the same address between launches)
  --host <addr>           Address to bind (start only, default: ${DEFAULT_HOST})
  --allow-non-loopback    Allow binding to a non-loopback address (start only)
  --dev                   Also trust the web UI dev server on port 5173 (start only;
                          same as MONSTERS_DEV=1)
  --reason <text>         Why you are stopping (kill only)
  --to <name>             Agent to talk to (chat only)
  --month <YYYY-MM>       Month of the archive to read (log read only)
  --type <t1,t2>          Only these event types (log read only)
  --dry-run               Only count what would move (log archive only)
  --client <name>         Name of the MCP client in the log (mcp only; default: the
                          name the client gives)
  --json                  Machine-readable output (status, kill, resume, automations, log)
`;

const OPTIONS = {
  home: { type: 'string' },
  port: { type: 'string' },
  'prefer-port': { type: 'string' },
  host: { type: 'string' },
  'allow-non-loopback': { type: 'boolean' },
  dev: { type: 'boolean' },
  reason: { type: 'string' },
  to: { type: 'string' },
  month: { type: 'string' },
  type: { type: 'string' },
  'dry-run': { type: 'boolean' },
  client: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values'];

class CliError extends Error {}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new CliError(`invalid port: ${raw}`);
  return port;
}

/** Finds the URL of the running core: --port, then server.json, then the default. */
function coreUrl(values: Values, home: string): string {
  const port = parsePort(values.port);
  if (port !== undefined) return `http://127.0.0.1:${port}`;
  const infoPath = homePaths(home).serverInfo;
  if (existsSync(infoPath)) {
    try {
      const info = JSON.parse(readFileSync(infoPath, 'utf8')) as ServerInfo;
      if (typeof info.url === 'string') return info.url;
    } catch {
      // Ignore a corrupt file and fall back to the default.
    }
  }
  const envPort = parsePort(process.env['MONSTERS_PORT']);
  return `http://127.0.0.1:${envPort ?? DEFAULT_PORT}`;
}

/** `proofKey` of this start of the core, from `server.json` (600); null when there is none. */
function readProofKey(home: string): string | null {
  try {
    const info = JSON.parse(readFileSync(homePaths(home).serverInfo, 'utf8')) as {
      proofKey?: unknown;
    };
    return typeof info.proofKey === 'string' && info.proofKey ? info.proofKey : null;
  } catch {
    return null;
  }
}

/**
 * Before the CLI token goes anywhere: whoever listens at `url` must prove it is the core of
 * this data folder (HMAC with the `proofKey` of `server.json`, like the SSH tunnel). Another
 * process on the port, or another user's, never receives the token (review of 18/10, B12).
 */
export async function verifyCore(
  url: string,
  home: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  // No server.json at all: no core of this folder has started (or it was stopped).
  if (!existsSync(homePaths(home).serverInfo)) {
    throw new CliError(`Monsters is not running at ${url} (start it with "monsters start")`);
  }
  const key = readProofKey(home);
  if (key === null) {
    throw new CliError(
      `cannot check that ${url} is the core of ${home}: no proof key in server.json (start the core with "monsters start")`,
    );
  }
  const nonce = newTunnelProofNonce();
  let body: { ok?: unknown; proof?: unknown };
  try {
    const res = await doFetch(`${url}/api/health?proof=${nonce}`, {
      signal: AbortSignal.timeout(5_000),
    });
    body = (await res.json()) as typeof body;
  } catch {
    throw new CliError(`Monsters is not running at ${url} (start it with "monsters start")`);
  }
  if (body.ok !== true || !checkTunnelProof(key, nonce, body.proof)) {
    throw new CliError(
      `the program at ${url} is not the Monsters core of ${home}: the token was not sent`,
    );
  }
}

function readToken(home: string): string {
  const path = homePaths(home).cliToken;
  if (!existsSync(path)) {
    throw new CliError(`no CLI token in ${path}: start the core first with "monsters start"`);
  }
  return readFileSync(path, 'utf8').trim();
}

async function callCore(
  values: Values,
  home: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<StatusResponse & Record<string, unknown>> {
  const url = coreUrl(values, home);
  await verifyCore(url, home);
  // The core accepts state changes only as JSON.
  const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${readToken(home)}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload !== undefined ? { body: payload } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`Monsters is not running at ${url} (start it with "monsters start")`);
  }
  if (res.status === 401) {
    throw new CliError('the core rejected the CLI token: is it running with the same --home?');
  }
  if (!res.ok) {
    const text = await res.text();
    let message: unknown;
    try {
      message = (JSON.parse(text) as { message?: unknown }).message;
    } catch {
      // not JSON: show the raw answer
    }
    throw new CliError(
      typeof message === 'string' && message ? message : `the core answered ${res.status}: ${text}`,
    );
  }
  return (await res.json()) as StatusResponse & Record<string, unknown>;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}

function printStatus(io: Io, s: StatusResponse): void {
  io.out(`Monsters ${s.version}: running, up ${formatDuration(s.uptimeMs)}`);
  if (s.halted) {
    const when = s.haltedAt ? new Date(s.haltedAt).toLocaleString() : 'unknown time';
    io.out(`Kill switch: ENGAGED since ${when}${s.haltedReason ? ` (${s.haltedReason})` : ''}`);
    io.out('Nothing will run until you type "monsters resume".');
  } else {
    io.out('Kill switch: off');
  }
  if (s.runs.length === 0) {
    io.out('Runs: none');
  } else {
    io.out(`Runs: ${s.runs.length}`);
    for (const r of s.runs) {
      io.out(
        `  ${r.id}  ${r.agent}  ${r.goal ?? ''}  calls=${r.pendingCalls} processes=${r.processes}`,
      );
    }
  }
}

async function cmdStart(values: Values, io: Io, signal?: AbortSignal): Promise<number> {
  // Started by the desktop app in a utility process (M3.1, D-045): it listens on this port.
  const desktop = parentPort();
  // A stop is heard from the very start (SIGINT, SIGTERM, the app's "stop", the test
  // signal): while the core starts it may wait for the login shell or for the password
  // prompt of a locked keyring; the stop kills the keychain helper and ends the start.
  const starting = new AbortController();
  let onStop: () => void = () => starting.abort();
  const requestStop = () => onStop();
  // SIGHUP: the terminal or the SSH session that started the core went away. A stop like SIGTERM,
  // but only once: a second signal (Ctrl+C twice) is what forces the exit, not a repeated hang-up.
  let hungUp = false;
  const onHangup = () => {
    if (hungUp) return;
    hungUp = true;
    requestStop();
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  process.on('SIGHUP', onHangup);
  signal?.addEventListener('abort', requestStop, { once: true });
  if (signal?.aborted) requestStop();
  const earlyStop = (event: { data: unknown }) => {
    if ((event.data as { type?: unknown } | null)?.type === 'stop') requestStop();
  };
  desktop?.on('message', earlyStop);
  const cleanup = () => {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    process.off('SIGHUP', onHangup);
    signal?.removeEventListener('abort', requestStop);
    desktop?.off('message', earlyStop);
  };
  const stoppedWhileStarting = () => {
    cleanup();
    io.out('Stopped before the core was ready.');
    // An Electron utility process does not end with an empty event loop (its port stays open).
    if (desktop && process.versions['electron'] !== undefined) process.exit(0);
    return 0;
  };

  // Started from the desktop: the PATH of the login shell, so node, npm, claude and
  // the MCP servers are found (and no ELECTRON_RUN_AS_NODE for the children).
  const prepared = await prepareCoreProcess();
  if (starting.signal.aborted) return stoppedWhileStarting();
  let core: Awaited<ReturnType<typeof startCore>>;
  const startOn = (port: number | undefined) =>
    startCore({
      home: values.home,
      port,
      host: values.host,
      allowNonLoopback: values['allow-non-loopback'] ?? false,
      dev: values.dev,
      // In the app the keychain calls go to the app (its binary is never a Node, S-M8).
      hub: {
        secrets: {
          signal: starting.signal,
          ...(desktop ? { keychain: desktopKeychain(desktop) } : {}),
        },
      },
    });
  try {
    const preferred = parsePort(values['prefer-port']);
    if (preferred === undefined) {
      core = await startOn(parsePort(values.port));
    } else {
      try {
        core = await startOn(preferred);
      } catch (err) {
        // Taken by someone else: any free port rather than no core (the failed start has
        // released the lock and everything else it had opened).
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || starting.signal.aborted) {
          throw err;
        }
        io.out(`Port ${preferred} is in use, taking a free one.`);
        core = await startOn(0);
      }
    }
  } catch (err) {
    if (starting.signal.aborted) return stoppedWhileStarting();
    cleanup();
    if (desktop) reportStartFailure(desktop, err);
    throw err;
  }
  if (starting.signal.aborted) {
    await core.close();
    return stoppedWhileStarting();
  }
  io.out(`Monsters ${CORE_VERSION} is running at ${core.url}`);
  // The system's certificates and the proxy (shared/node/network.ts), set before the start.
  for (const line of prepared.network) io.out(line);
  if (core.webUi?.available()) io.out(`Open ${core.url}/ in your browser.`);
  else if (core.webUi)
    io.out(
      `Web UI not built yet (${core.webUi.dir}): run "pnpm --filter @monsters/web build", then open ${core.url}/`,
    );
  io.out(`Data: ${core.config.home}`);
  io.out(`Vault: ${core.hub.vault.root}`);
  if (!core.hub.hasModelProvider())
    io.out('No model yet: add your OpenRouter key in the web UI (Settings).');
  if (core.setupCode) {
    io.out('No account yet: create it from the web UI with this one-time setup code:');
    io.out(`  Setup code: ${core.setupCode}`);
  }
  if (core.runs.halted)
    io.out('Kill switch is engaged: run "monsters resume" to allow agents to work.');

  // A rejection nobody handled must not take every run down with the core (F-M2).
  const guard = installProcessGuard({
    log: core.log,
    onStorm: (reason) => {
      io.err(reason);
      requestStop();
    },
  });
  await new Promise<void>((resolve) => {
    let stopping = false;
    let detach: (() => void) | undefined;
    onStop = () => {
      if (stopping) {
        process.exit(130);
      }
      stopping = true;
      io.out('Stopping...');
      // The port's listener would keep the process alive after the core is closed.
      detach?.();
      void core.close().then(resolve, resolve);
    };
    // From here the bridge answers the app (its own "stop" included).
    desktop?.off('message', earlyStop);
    if (desktop) {
      detach = attachDesktopBridge(desktop, { ...core, version: CORE_VERSION }, requestStop);
    }
  });
  // Kept until the process ends, writing only to stderr now: a late rejection of the shutdown
  // must not turn a clean stop into exit code 1 (review of 18/10, item 13).
  guard.closed();
  cleanup();
  io.out('Stopped.');
  // An Electron utility process does not end with an empty event loop (its port stays open).
  if (desktop && process.versions['electron'] !== undefined) process.exit(0);
  return 0;
}

/**
 * The app's language of a data folder, by the core's rule (D-153): settings.json, else Italian
 * when the folder has an account (an install the core has not restarted since the update), else
 * the system's.
 */
function cliLanguage(home: string): Lang {
  try {
    return languageOfHome(home, process.env);
  } catch {
    return systemLang(process.env);
  }
}

/** The layout of the notes folder of a data folder (D-154), as the core reads it at start. */
function cliVaultLayout(home: string): VaultLayout {
  try {
    const vault = loadHubSettings(home).vault;
    return VAULT_LAYOUTS[detectVaultLayout(vault) ?? newVaultLayout()];
  } catch {
    return VAULT_LAYOUTS.it;
  }
}

/** Runs the CLI. Returns the exit code. `signal` stops `start` (used by tests). */
export async function run(
  argv: string[],
  io: Io = defaultIo,
  signal?: AbortSignal,
): Promise<number> {
  // The terminal or the pipe the output goes to may close before the last line (D-166).
  if (io === defaultIo) ignoreBrokenPipe();
  // Nothing that reaches the terminal may carry control sequences (agent text, goals, errors).
  io = terminalSafe(io);
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    io.err((err as Error).message);
    io.err('Run "monsters help" for usage.');
    return 2;
  }
  const { values, positionals } = parsed;
  const command = values.help ? 'help' : values.version ? 'version' : (positionals[0] ?? 'help');
  const home = resolveHome(values.home);
  // `start` picks the language itself (the core). The other commands print in the language
  // the data folder is set to (D-153), else the system's.
  if (command !== 'start') setAppLang(cliLanguage(home));

  try {
    switch (command) {
      case 'help':
        io.out(HELP);
        return 0;
      case 'version':
        io.out(CORE_VERSION);
        return 0;
      case 'start':
        return await cmdStart(values, io, signal);
      case 'status': {
        const s = await callCore(values, home, 'GET', '/api/status');
        if (values.json) io.out(JSON.stringify(s));
        else printStatus(io, s);
        return 0;
      }
      case 'kill': {
        const s = await callCore(values, home, 'POST', '/api/kill', {
          ...(values.reason !== undefined ? { reason: values.reason } : {}),
        });
        if (values.json) {
          io.out(JSON.stringify(s));
        } else {
          const report = s['report'] as
            { runsAborted: number; processesKilled: number } | undefined;
          io.out(
            `Stopped. Runs aborted: ${report?.runsAborted ?? 0}, processes killed: ${report?.processesKilled ?? 0}.`,
          );
          io.out('Nothing will run until you type "monsters resume".');
        }
        return 0;
      }
      case 'chat':
      case 'answer':
      case 'vault': {
        await verifyCore(coreUrl(values, home), home);
        const access: CoreAccess = {
          url: coreUrl(values, home),
          token: readToken(home),
          request: (method, path, body) => callCore(values, home, method, path, body),
        };
        const args = positionals.slice(1);
        if (command === 'answer') return await cmdAnswer(args, access, io);
        if (command === 'vault') return await cmdVault(args, access, io);
        if (args.length === 0) {
          const input = io.input ?? process.stdin;
          return await cmdChatInteractive({ to: values.to }, access, {
            ...io,
            input,
            tty: io.tty ?? (input === process.stdin && process.stdin.isTTY === true),
          });
        }
        return await cmdChat(args.join(' '), { to: values.to }, access, io);
      }
      case 'automations':
        return await cmdAutomations(
          positionals.slice(1),
          (method, path, body) => callCore(values, home, method, path, body),
          io,
          values.json === true,
        );
      case 'log':
        return await cmdLog(
          positionals.slice(1),
          {
            home,
            request: (method, path, body) => callCore(values, home, method, path, body),
            month: values.month,
            type: values.type,
            dryRun: values['dry-run'] === true,
            json: values.json === true,
          },
          io,
        );
      case 'secrets':
        return await cmdSecrets(positionals.slice(1), home, io);
      case 'password':
        return await cmdPassword(home, io);
      case 'mcp':
        return await runVaultMcp(
          {
            url: () => coreUrl(values, home),
            token: () => readToken(home),
            verify: () => verifyCore(coreUrl(values, home), home),
          },
          { client: values.client, err: io.err, layout: cliVaultLayout(home) },
        );
      case 'stop': {
        // One monster's work (F-1), not the kill switch: the others go on.
        const agent = positionals[1];
        if (!agent) {
          io.err('Usage: monsters stop <monster>');
          return 2;
        }
        const s = await callCore(
          values,
          home,
          'POST',
          `/api/agents/${encodeURIComponent(agent)}/stop`,
        );
        if (values.json) io.out(JSON.stringify(s));
        else {
          const runs = Number(s['stopped'] ?? 0);
          const parts = Number(s['parts'] ?? 0);
          io.out(
            runs + parts > 0
              ? `Stopped ${agent}. Runs aborted: ${runs}, tasks stopped in other runs: ${parts}, processes killed: ${Number(s['processesKilled'] ?? 0)}.`
              : `Nothing of ${agent} was running.`,
          );
        }
        return 0;
      }
      case 'resume': {
        const s = await callCore(values, home, 'POST', '/api/resume');
        if (values.json) io.out(JSON.stringify(s));
        else io.out(s['resumed'] ? 'Resumed: agents can work again.' : 'Monsters was not stopped.');
        return 0;
      }
      default:
        io.err(`unknown command: ${command}`);
        io.err('Run "monsters help" for usage.');
        return 2;
    }
  } catch (err) {
    if (err instanceof CliError) {
      io.err(err.message);
      return 1;
    }
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
