import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rmSync } from 'node:fs';
import { getRequestListener } from '@hono/node-server';
import { setAppLang } from '@monsters/shared';
import { newTunnelProofKey } from '@monsters/shared/node';
import { AuthService } from './auth/auth-service.ts';
import {
  defaultAllowedOrigins,
  ensureHome,
  homePaths,
  isLoopbackHost,
  loadConfig,
  writeSensitiveFile,
  type ConfigOverrides,
  type CoreConfig,
} from './config.ts';
import { migrate } from './db/migrations.ts';
import { coreMigrations } from './db/schema.ts';
import { openDb, type Db } from './db/sqlite.ts';
import { StateStore } from './db/state-store.ts';
import { ProcessRegistry } from './kill/process-registry.ts';
import { RunController } from './kill/run-controller.ts';
import { LogArchiver } from './log/archive.ts';
import { EventLog } from './log/event-log.ts';
import { acquireHomeLock, type HomeLock } from './home-lock.ts';
import { languageOfHome, resolveAppLanguage } from './i18n.ts';
import { createHub, type Hub, type HubOptions } from './hub.ts';
import { registerOnboardingRoutes } from './server/routes/onboarding.ts';
import { oauthCallbackHost } from './mcp/oauth.ts';
import { registerMcpRoutes } from './server/routes/mcp.ts';
import { registerPermissionRoutes } from './server/routes/permissions.ts';
import { registerSquadRoutes } from './server/routes/squad.ts';
import { registerProviderRoutes } from './server/routes/providers.ts';
import { registerTeamRoutes } from './server/routes/team.ts';
import { registerTelegramRoutes } from './server/routes/telegram.ts';
import { registerDecisionRoutes } from './server/routes/decisions.ts';
import { registerInstinctRoutes } from './server/routes/instinct.ts';
import { registerSpendRoutes } from './server/routes/spend.ts';
import { registerUsageRoutes } from './server/routes/usage.ts';
import { registerVaultToolRoutes } from './server/routes/vault-tools.ts';
import { registerHarnessMcpRoutes } from './server/routes/harness-mcp.ts';
import { registerClaudeConnectionRoutes } from './server/routes/claude-connections.ts';
import { registerSubscriptionRoutes } from './server/routes/subscriptions.ts';
import { registerVaultRoutes } from './server/routes/vault.ts';
import { registerFileRoutes } from './server/routes/files.ts';
import { registerAutomationRoutes } from './server/routes/automations.ts';
import { registerDraftRoutes } from './server/routes/drafts.ts';
import { registerLogArchiveRoutes } from './server/routes/log-archive.ts';
import { registerProjectRoutes } from './server/routes/projects.ts';
import { CORE_VERSION, createApp } from './server/app.ts';
import { attachStream, type StreamHandle } from './server/stream.ts';
import { DEFAULT_WEB_DIST, webUiAvailable } from './server/web-ui.ts';
import { coreStrings } from './core.strings.ts';

export { CSRF_HEADER, CSRF_HEADER_VALUE, DEVICE_COOKIE } from './server/guards.ts';
export {
  ProcessRegistry,
  type ProcessGroupRecord,
  type ReapReport,
} from './kill/process-registry.ts';

export interface CoreServices {
  config: CoreConfig;
  paths: ReturnType<typeof homePaths>;
  db: Db;
  log: EventLog;
  state: StateStore;
  auth: AuthService;
  runs: RunController;
  /** Exclusive lock on the data directory, released by `close()` (or by hand). */
  lock: HomeLock;
}

export interface CoreServer extends CoreServices {
  url: string;
  port: number;
  httpServer: Server;
  stream: StreamHandle;
  /**
   * One-time code required by `POST /api/setup` while no account exists (also
   * written to `setup-code` with mode 600); null once the user is configured.
   */
  setupCode: string | null;
  /** Vault, providers, team, decisions and conversation (M1.3). */
  hub: Hub;
  /** Archive of the bulky old events of the log (`monsters log archive`, daily pass). */
  archiver: LogArchiver;
  /** The web UI served at `url`: its folder, and whether a build is there right now. */
  webUi: { dir: string; available(): boolean } | null;
  /** The routes of the API (method and path as registered): what the tests check is classified. */
  routes: readonly { method: string; path: string }[];
  /**
   * Stops the server, aborts running work (without halting), revokes the CLI
   * token and closes the db.
   */
  close(): Promise<void>;
}

export interface StartCoreOptions extends ConfigOverrides {
  /** Grace period between SIGINT and SIGKILL for child processes. */
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  hub?: HubOptions;
  /**
   * Folder of the built web UI to serve on the core's origin, or false to serve
   * none. Default: `MONSTERS_WEB_DIST`, else `apps/web/dist` of the repo.
   */
  webDist?: string | false;
}

/** Contents of `server.json`, used by the CLI to find a running core. */
export interface ServerInfo {
  pid: number;
  host: string;
  port: number;
  url: string;
  startedAt: number;
  version: string;
  /**
   * Random key of this start (the file is 600): the SSH tunnel of the app reads it and
   * checks that `/api/health?proof=` answers with its HMAC before trusting the port.
   */
  proofKey: string;
}

/**
 * Opens the data directory and the database and wires the core services,
 * without starting the HTTP server. Useful for tests and embedding.
 */
export function createCoreServices(options: StartCoreOptions = {}): CoreServices {
  // OpenUI (the drawn blocks, D-162) has an opt-in runtime telemetry (`OPENUI_RUNTIME_TELEMETRY_ENABLED`)
  // that Monsters never sets. This turns it off for good in this process even if the user's
  // environment has it on: `OPENUI_TELEMETRY_DISABLED` wins over it. The install-time one is
  // blocked in `pnpm-workspace.yaml` (`allowBuilds`), and no child process inherits any `OPENUI_*`.
  process.env['OPENUI_TELEMETRY_DISABLED'] ??= '1';
  delete process.env['OPENUI_RUNTIME_TELEMETRY_ENABLED'];
  const config = loadConfig(options, options.env);
  if (!isLoopbackHost(config.host) && !config.allowNonLoopback) {
    throw new Error(
      `refusing to listen on ${config.host}: Monsters only binds to loopback addresses. ` +
        'Use SSH to reach it remotely, or pass --allow-non-loopback if you know what you are doing.',
    );
  }
  ensureHome(config.home);
  // Before the lock, whose refusal ("already running") is text: the language the data folder is in
  // (the core writes it in `wireServices`, once it holds the lock).
  setAppLang(languageOfHome(config.home, options.env ?? process.env));
  // Before touching any state: a second core would expire the live one's
  // questions, rotate its tokens and reap its processes.
  const lock = acquireHomeLock(config.home);
  try {
    return wireServices(config, options, lock);
  } catch (err) {
    lock.release();
    throw err;
  }
}

function wireServices(config: CoreConfig, options: StartCoreOptions, lock: HomeLock): CoreServices {
  const paths = homePaths(config.home);
  const db = openDb(paths.db);
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db);
  const state = new StateStore(db);
  const processRegistry = new ProcessRegistry(paths.processGroups);
  // Process groups left by a core that crashed: terminate them before anything starts.
  const reaped = processRegistry.reapOrphans();
  if (reaped.killed.length > 0) {
    log.append({
      agent: 'system',
      type: 'error',
      data: {
        message: `terminated ${reaped.killed.length} orphan process group(s) left by a previous run of the core`,
        code: 'orphan_processes',
      },
    });
  }
  const auth = new AuthService(db, log, {
    sessionTtlMs: config.sessionTtlMs,
    cliTokenPath: paths.cliToken,
  });
  // The desktop app's own sessions belong to the core that opened them (always recent).
  auth.closeBridgeSessions();
  // Before any text is written (D-153): an install with an account stays Italian.
  resolveAppLanguage(paths.home, !auth.needsSetup(), options.env ?? process.env);
  const runs = new RunController({
    log,
    state,
    processRegistry,
    ...(options.killGraceMs !== undefined ? { killGraceMs: options.killGraceMs } : {}),
  });
  // Runs left open by a core that crashed: nothing is working on them anymore.
  runs.closeLeftoverRuns();
  return { config, paths, db, log, state, auth, runs, lock };
}

/** Starts the core: services, HTTP API and WebSocket stream on 127.0.0.1. */
export async function startCore(options: StartCoreOptions = {}): Promise<CoreServer> {
  const services = createCoreServices(options);
  const { config, paths, db, log, auth, runs, lock } = services;
  const explicitOrigins =
    options.allowedOrigins !== undefined ||
    (options.env ?? process.env)['MONSTERS_ALLOWED_ORIGINS'] !== undefined;

  auth.purgeExpiredSessions();
  // Agents with a terminal can read these files: their values never reach the log or a model.
  log.redactor.addSecret(auth.issueCliToken());
  const setupCode = auth.issueSetupCode();
  if (setupCode) log.redactor.addSecret(setupCode);
  if (setupCode) writeSensitiveFile(paths.setupCode, `${setupCode}\n`);
  else rmSync(paths.setupCode, { force: true });
  let hub: Hub;
  try {
    hub = await createHub(services, {
      ...(options.env ? { env: options.env } : {}),
      ...options.hub,
    });
  } catch (err) {
    db.close();
    lock.release();
    throw err;
  }

  // The bulky old events move to monthly files (log/archive.ts): checked a minute after the
  // start, then every hour, at most one pass a day.
  const archiver = new LogArchiver({
    db,
    log,
    state: services.state,
    home: config.home,
    settings: () => hub.settings.logArchive,
    idle: () => runs.activeRuns().length === 0,
    onError: (err) => {
      log.append({
        agent: 'system',
        type: 'error',
        data: {
          message: coreStrings().archiveFailed(err instanceof Error ? err.message : String(err)),
          code: 'log_archive_failed',
        },
      });
    },
  });

  const webDist =
    options.webDist === false
      ? null
      : (options.webDist ?? (options.env ?? process.env)['MONSTERS_WEB_DIST'] ?? DEFAULT_WEB_DIST);

  const startedAt = Date.now();
  const proofKey = newTunnelProofKey();
  log.redactor.addSecret(proofKey);
  const app = createApp({
    tunnelProofKey: proofKey,
    config,
    auth,
    log,
    runs,
    startedAt,
    // `stream` is assigned below, before the server accepts any request.
    onSessionEnded: (sessionId) => stream.closeSession(sessionId),
    onSetupCompleted: () => rmSync(paths.setupCode, { force: true }),
    onLanguageChosen: () => hub.adoptVaultLayout(),
    continueWork: {
      pending: () => hub.haltedRequests(),
      start: (requests, by) => hub.continueRequests(requests, by),
    },
    extend: (a, helpers) => {
      registerTeamRoutes(a, helpers, hub);
      registerProviderRoutes(a, helpers, hub);
      registerOnboardingRoutes(a, helpers, hub.onboarding);
      registerPermissionRoutes(a, helpers, hub.permissions);
      registerSquadRoutes(a, helpers, hub.squad);
      registerVaultToolRoutes(a, helpers, { hub, log, runs });
      registerTelegramRoutes(a, helpers, hub.telegram, hub.telegramBots);
      registerDecisionRoutes(a, helpers, hub.decisions);
      registerInstinctRoutes(a, helpers, { hub, log });
      registerSpendRoutes(a, helpers, { hub });
      registerUsageRoutes(a, helpers, { hub });
      registerMcpRoutes(a, helpers, hub.mcp);
      registerSubscriptionRoutes(a, helpers, hub);
      registerClaudeConnectionRoutes(a, helpers, hub.claudeConnections);
      registerHarnessMcpRoutes(a, { sessions: hub.harnessSessions, version: CORE_VERSION });
      registerVaultRoutes(a, helpers, { hub, log });
      registerFileRoutes(a, helpers, { files: () => hub.files, log, team: hub.team });
      registerAutomationRoutes(a, helpers, hub.automations);
      registerProjectRoutes(a, helpers, hub);
      registerDraftRoutes(a, helpers, hub);
      registerLogArchiveRoutes(a, helpers, { archiver });
    },
    webUi: webDist ? { dir: webDist } : undefined,
  });
  // Keep Node's own Request/Response globals: by default node-server swaps them for its
  // lightweight classes for the whole process, and then a native `fetch` Response is no longer
  // `instanceof Response` (the MCP SDK's OAuth error parsing relies on that check).
  const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });
  const httpServer = createServer((req, res) => void listener(req, res));
  const stream: StreamHandle = attachStream(httpServer, { config, auth, log, runs });
  hub.setAppPresence(() => stream.clientCount > 0);

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    stream.close();
    await hub.close();
    db.close();
    lock.release();
    throw err;
  }

  const port = (httpServer.address() as AddressInfo).port;
  if (!explicitOrigins && port !== config.port) {
    config.allowedOrigins = defaultAllowedOrigins(port, config.dev);
  }
  config.port = port;
  const hostForUrl = config.host.includes(':') ? `[${config.host}]` : config.host;
  // OAuth callback of the MCP servers (D-063): the browser comes back on loopback.
  hub.mcp.setCallbackOrigin(() => `http://${oauthCallbackHost(config.host)}:${config.port}`);
  const url = `http://${hostForUrl}:${port}`;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      stream.close();
      await archiver.stop();
      await runs.shutdown();
      await hub.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
      rmSync(paths.serverInfo, { force: true });
      rmSync(paths.setupCode, { force: true });
      auth.revokeCliToken();
      db.close();
      lock.release();
    })();
    return closing;
  };

  try {
    // A confirmation of the team a previous core left half-way is finished first (M10).
    await hub.onboarding.finishPending();
    // The automations start once the port is known (a harness calls the core back, D-094).
    hub.automations.start();
    // The work of `project_send` a previous core left behind (D-098).
    await hub.projects.start();
    // The user's messages a previous core left waiting for a busy monster (M8).
    hub.requeueWaiting();
    archiver.start();
    const info: ServerInfo = {
      pid: process.pid,
      host: config.host,
      port,
      url,
      startedAt,
      version: CORE_VERSION,
      proofKey,
    };
    writeSensitiveFile(paths.serverInfo, `${JSON.stringify(info, null, 2)}\n`);
  } catch (err) {
    // The server is already listening: a start that fails here must not leave a zombie
    // holding the port and the lock (F-M1).
    await close().catch(() => {});
    throw err;
  }

  const webUi = webDist ? { dir: webDist, available: () => webUiAvailable(webDist) } : null;
  const routes = app.routes
    .filter((r) => r.method !== 'ALL')
    .map((r) => ({ method: r.method, path: r.path }));
  return {
    ...services,
    url,
    port,
    httpServer,
    stream,
    setupCode,
    hub,
    archiver,
    webUi,
    routes,
    close,
  };
}
