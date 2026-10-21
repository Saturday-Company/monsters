import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  claudePlanFallback,
  fetchOpenRouterPrices,
  OpenRouterProvider,
  ProviderRegistry,
  providerSpec,
  UnknownProviderError,
  type HarnessBinary,
  type HarnessProvider,
  type ModelRef,
  type SiwcEndpoints,
} from '@monsters/providers';
import { pinNodeRuntime } from '@monsters/shared/node';
import {
  appLang,
  autoEffort,
  EventInputSchema,
  MCP_CATALOG,
  OPENROUTER_FREE_ROUTER,
  ToolError,
  type Channel,
  type FileMeta,
  type Lang,
  type MonstersTool,
  type Project,
  type Question,
  type SecretsStatus,
  type SettingsResponse,
  type StoppedRequest,
  type TelegramOrigin,
  type UndoRunResult,
  type WebSearchSettingsRequest,
  spendCapPath,
} from '@monsters/shared';
import {
  createFsTools,
  createSearchBackend,
  createShellTool,
  createWebFetchTool,
  createWebSearchTool,
  defaultSearchBackends,
  FS_WRITE_TOOLS,
  monstersUserAgent,
  type SearchBackend,
} from '@monsters/tools';
import {
  INBOX_FOLDER,
  VaultService,
  SemanticUnavailableError,
  WorkerEmbedder,
  defaultIndexPath,
  vaultTools,
  withVaultScope,
  type EmbedderLoader,
  type VaultActor,
  type VaultWarning,
  type VcsKind,
} from '@monsters/vault';
import { DEFAULT_FREE_CHAIN, isDefaultChain, WEB_TOOLS } from './agents/archetypes.ts';
import { automationRunOf } from './automations/run-index.ts';
import { AutomationService, type AutomationServiceOptions } from './automations/service.ts';
import { AUTOMATIONS_DIR } from './automations/store.ts';
import { FileStore, filesDirFor, filesMigrations } from './files/store.ts';
import {
  ARTIFACT_TOOL,
  artifactTool,
  fileEvent,
  fileReadTool,
  inFileScope,
  TOOL_IMAGE_MAX_BYTES,
  TOOL_IMAGES_PER_RUN,
  toolImageName,
  toolImageTooLarge,
  type FileReadScope,
} from './files/tools.ts';
import {
  attachmentParts,
  harnessAttachments,
  modelSight,
  PAST_ATTACHMENT_MARK,
  type AttachmentSource,
  type ModelSight,
} from './files/model-input.ts';
import { coordinates, type AgentDefinition } from './agents/definition.ts';
import { projectDocsChanged, projectSection, type ProjectAccessNotes } from './projects/context.ts';
import { ProjectService } from './projects/service.ts';
import { projectTools } from './projects/tools.ts';
import { HarnessToolSessions } from './agents/harness-tools.ts';
import { runAgent, type AgentRunResult, type RunAgentOptions } from './agents/run-agent.ts';
import type { CardContext } from './agents/monsters-card.ts';
import {
  HARNESS_PROVIDER_IDS,
  harnessHookUrl,
  harnessMcpUrl,
  harnessUnavailable,
  runHarnessAgent,
} from './agents/run-harness.ts';
import { markExternal } from './agents/tool-adapter.ts';
import type { CoreServices } from './core.ts';
import type { EventLog } from './log/event-log.ts';
import { CORE_VERSION } from './server/app.ts';
import { TelegramChannel, type TelegramChannelOptions } from './channels/telegram/channel.ts';
import { REPLY_KEY_REASON, TelegramBots } from './channels/telegram/bots.ts';
import { isGroupThread, runsOfThread, threadOfRun } from './channels/telegram/threads.ts';
import { isUserWords } from './team/user-words.ts';
import { saveAppLanguage } from './i18n.ts';
import { patchSettingsFile } from './onboarding/settings-file.ts';
import { migrate } from './db/migrations.ts';
import { KilledError } from './kill/control-scope.ts';
import { McpManager } from './mcp/manager.ts';
import { restoreRateBudgets } from './log/rate-history.ts';
import { OnboardingService } from './onboarding/service.ts';
import { removeProviderKey } from './providers/keys.ts';
import {
  openSecretStore,
  registerSecretStore,
  type OpenSecretStoreOptions,
} from './secrets/store.ts';
import { ProviderManager, ProviderSetupError } from './providers/manager.ts';
import { ClaudeConnectionService } from './providers/claude-connections.ts';
import { PlanLimits } from './providers/plan-limits.ts';
import { SubscriptionService } from './providers/subscriptions.ts';
import type { Generate } from './onboarding/proposal.ts';
import { readBraveKey, saveBraveKey } from './team/brave-key.ts';
import { PaidSearch, searchRegion } from './team/paid-search.ts';
import { answerText, conversationTurns, mergeTurns } from './team/conversation.ts';
import { ConversationCompactor, fixedContextTokens, runsTainted } from './team/compaction.ts';
import { projectProposeTool } from './projects/propose.ts';
import { automationProposeTool, AUTOMATION_PROPOSE } from './automations/propose.ts';
import { DraftService } from './projects/drafts.ts';
import { DocsProposals, docsProposeTool, DOCS_PROPOSE } from './projects/docs-proposals.ts';
import { createSummarizer } from './team/summarizer.ts';
import { DecisionGate, resolveDecisionRules, type DecisionPort } from './team/decision.ts';
import { DecisionEngineService } from './team/decision-engine.ts';
import {
  Dispatcher,
  type Conversation,
  type DispatcherOptions,
  type InboxItem,
  type TurnOutcome,
} from './team/dispatcher.ts';
import {
  continueRequests,
  haltedRequests,
  requeueWaiting,
  senderBudgetFromLog,
  type ContinuedRun,
} from './team/resume-work.ts';
import {
  configureOpenRouter,
  noteOpenRouterKey,
  readOpenRouterKey,
  saveOpenRouterKey,
  verifyOpenRouterKey,
  type OpenRouterKeyInfo,
  type VerifyResult,
} from './team/openrouter-key.ts';
import {
  FILES_TRASH_DIR,
  PermissionsService,
  agentWorkspace,
  installFolders,
} from './team/permissions.ts';
import {
  PARKED_ANSWER_WINDOW_MS,
  readsAsAnswer,
  pickedOption,
  QuestionStore,
  teamMigrations,
  type QuestionAnswer,
} from './team/questions.ts';
import {
  defaultProjectsDir,
  loadHubSettings,
  type HubSettings,
  type HubSettingsInput,
} from './team/settings.ts';
import { TeamService } from './team/team-service.ts';
import { TeamManager } from './team/team-manager.ts';
import { finalQuestionHook } from './team/final-question.ts';
import { runBudget, type RunBudget } from './team/run-limits.ts';
import {
  instinctRememberFilter,
  keepMemoryFrom,
  memoryLineNeedsReview,
  memoryTainted,
} from './team/memory.ts';
import { MemoryProposals } from './team/memory-proposals.ts';
import { withProvenance } from './team/vault-provenance.ts';
import { ASK_USER_WAIT_MS, teamTools } from './team/team-tools.ts';
import { needsRareTools, pinnedChain, withTurnDeferrals } from './team/toolsets.ts';
import { previewShowTool } from './team/preview-show.ts';
import { ACCESS_REQUEST_TOOL, isFreeChain } from './team/team-service.ts';
import { AccessRequests } from './team/access-requests.ts';
import { accessCheck, isAccessClaim, withAccessHook } from './team/access-claims.ts';
import {
  accessCaps,
  accessChangeNote,
  accessState,
  claimContext,
  type AccessStateDeps,
} from './team/access-state.ts';
import { DoneChecker } from './team/instinct/done-check.ts';
import { InstinctGuard } from './team/instinct/guard.ts';
import { NOTE_LEAK_CHARS, RunTaint, THIRD_PARTY_PROP } from './team/instinct/taint.ts';
import { SpendMeter, type UsageClass } from './team/spend.ts';
import { AgentUsage } from './team/usage.ts';
import { ModelWindows, type ModelWindowsOptions } from './providers/windows.ts';
import { BANDS } from './team/instinct/questions.ts';
import { buildReceipt, undoRun } from './team/instinct/receipt.ts';
import { Scorecard } from './team/instinct/scorecard.ts';
import { StuckWatcher } from './team/instinct/stuck.ts';
import { System1 } from './team/instinct/system1.ts';
import {
  hasTiers,
  tieredChain,
  Triage,
  type TierLevel,
  type TriageOutcome,
} from './team/instinct/triage.ts';
import { accessStrings } from './team/access.strings.ts';
import { hubPrompts } from './hub.prompts.ts';
import { hubStrings } from './hub.strings.ts';

/*
 * Composition of the agentic side of the core (M1.3): vault, providers, team,
 * DecisionGate, questions and message routing, wired to the event log and the
 * kill switch. `startCore` creates it at startup; tests can create it on top of
 * `createCoreServices`.
 */

export interface HubOptions {
  /** Overrides of `settings.json`. */
  settings?: HubSettingsInput;
  /** Provider registry to use instead of the configured ones (tests). */
  providers?: ProviderRegistry;
  /** Web tools to use instead of `web_search`/`web_fetch` (tests). */
  webTools?: MonstersTool[];
  /** Fixed System 1 model of the gate instead of the configured engine (tests); `null` = rules only. */
  decisionPort?: DecisionPort | null;
  /** Used to verify the OpenRouter key and by the provider (tests). */
  fetch?: typeof fetch;
  /**
   * OpenRouter's public prices, for the direct keys (D-114). Default: read from openrouter.ai,
   * none when `providers` is given (tests never go on the network for it).
   */
  publicPrices?: ModelWindowsOptions['publicPrices'];
  /**
   * OpenRouter key of the paid web search instead of the models' key (the
   * eval: free models, paid search on another key). Default: the same key.
   */
  searchKey?: string;
  /** Git backend of the vault. Default isomorphic-git. */
  git?: VcsKind | false;
  env?: NodeJS.ProcessEnv;
  /** How long a native run holds a blocking `ask_user` (tests). Default `ASK_USER_WAIT_MS`. */
  askWaitMs?: number;
  /** How long a plain message answers a parked question (tests). Default `PARKED_ANSWER_WINDOW_MS`. */
  parkedAnswerWindowMs?: number;
  /**
   * Create the default team (Titan, Rhea, Dione) at startup when there is none.
   * Default false: the team comes from the onboarding; until then messages are
   * refused (`onboarding_pending`).
   */
  bootstrap?: boolean;
  /** Models of the agents created by the onboarding or the fallback (tests). Default: the free chain. */
  teamModels?: ModelRef[];
  /** Model call of the team proposal (tests); `null` always uses the fallback team. */
  onboardingGenerate?: Generate | null;
  /** Model call of a made-to-measure monster after the onboarding (tests); `null` = fallback. */
  teamGenerate?: Generate | null;
  /**
   * Embedding model of the vault (tests: a fake one); `null` = full-text only.
   * Default: granite in a worker thread, downloaded into `<home>/models`, unless
   * `settings.semanticSearch` is false or `MONSTERS_EMBEDDINGS=off`.
   */
  embedder?: EmbedderLoader | null;
  /**
   * Telegram bot (M2.6): test hooks (`apiRoot` of a fake Bot API, short
   * timeouts), or `false` to never start it at boot. Default: starts when a
   * token is configured, unless `MONSTERS_TELEGRAM=off` (tests, CI).
   */
  telegram?:
    | false
    | Pick<
        TelegramChannelOptions,
        | 'apiRoot'
        | 'pollTimeoutS'
        | 'retryBaseMs'
        | 'retryMaxMs'
        | 'activeWindowMs'
        | 'sendGiveUpMs'
        | 'sendQueueMax'
        | 'chatGapMs'
        | 'typingIntervalMs'
        | 'now'
      >;
  /**
   * Where secrets are kept (D-042): keychain options (tests: a fake keychain,
   * a test service name). Default: `MONSTERS_SECRETS`, native keychain.
   */
  secrets?: Omit<OpenSecretStoreOptions, 'home' | 'env'>;
  /** The scheduler of the automations (tests: a fake clock, short waits). */
  automations?: Pick<AutomationServiceOptions, 'clock' | 'waitPollMs' | 'maxWaitMs' | 'timezone'>;
  /** Subscriptions (M2.7): fake OpenAI, fake harness binaries, fake installs (tests). */
  subscriptions?: {
    siwcEndpoints?: Partial<SiwcEndpoints>;
    callbackPort?: number;
    binaries?: { claude?: HarnessBinary | null; codex?: HarnessBinary | null };
    install?: (dir: string, spec: string) => Promise<void>;
  };
}

export interface Hub {
  /**
   * Whether the app has a window open on the core now (the WebSocket stream, D-142): a card
   * of the brake left unanswered says the user could not see it. Without it: always open.
   */
  setAppPresence(open: () => boolean): void;
  settings: HubSettings & { vault: string };
  vault: VaultService;
  team: TeamService;
  providers: ProviderRegistry;
  questions: QuestionStore;
  gate: DecisionGate;
  /** Engine of the instinct and of the gate, the modes of its uses, the TypeSafe key (D-037, D-067). */
  decisions: DecisionEngineService;
  /** The instinct's service and the pagella dei mostri (D-067). */
  instinct: { system1: System1; scorecard: Scorecard };
  /** "Annulla tutto il lavoro": undoes every note change of a run, newest first (D-067). */
  undoRun(runId: string): Promise<UndoRunResult>;
  dispatcher: Dispatcher;
  /** First start: questions, permissions, team proposal (M1.6). */
  onboarding: OnboardingService;
  /** What each agent may do, editable after the onboarding (M2.1). */
  permissions: PermissionsService;
  /** The team and the profile after the onboarding (Settings → Squadra). */
  squad: TeamManager;
  /** Telegram bot: whitelist, pairing, notifications (M2.6). */
  telegram: TelegramChannel;
  /** Bots dedicated to one monster, each with its loop (D-107). */
  telegramBots: TelegramBots;
  /** External MCP servers and the browser (M2.5). */
  mcp: McpManager;
  /** Spending caps in euros per day and month (D-070). */
  spend: SpendMeter;
  /** The Consumi panel of each monster: context, conversation, spend (D-075). */
  usage: AgentUsage;
  /** Summaries of the older turns (D-082): `idle()` waits for those being written. */
  compactor: ConversationCompactor;
  /** Files of the user and of the monsters, in the notes folder under `File/` (D-075). */
  files: FileStore;
  /** Automations (D-094): `start()` once the core can run monsters. */
  automations: AutomationService;
  /** Projects (D-097): their definitions, monsters, messages and the reports of their leads. */
  projects: ProjectService;
  /** What the monsters proposed and waits for the user: "Da rivedere" and Telegram (D-098). */
  drafts: DraftService;
  /** The proposals for CLAUDE.md and AGENTS.md of the projects' folders (D-113). */
  docsProposals: DocsProposals;
  /** True when at least one model provider is configured. */
  hasModelProvider(): boolean;
  send(params: {
    text: string;
    to?: string | undefined;
    channel: Channel;
    resumeOf?: string | undefined;
    attachments?: string[] | undefined;
    telegram?: TelegramOrigin | undefined;
    /** Through the CLI token (review of 18/10, M1): see `Dispatcher.send`. */
    notOwner?: boolean | undefined;
  }): ReturnType<Dispatcher['send']>;
  /** The requests the latest global stop left halfway ("Riprendi e continua", D-072). */
  haltedRequests(): StoppedRequest[];
  /** Starts them again, after `resume`: one new run each, marked `resumeOf`. */
  continueRequests(requests: readonly StoppedRequest[], channel: Channel): ContinuedRun[];
  /** At the start: the user's messages a previous core left waiting start now (M8). */
  requeueWaiting(): string[];
  answer(id: string, answer: QuestionAnswer, channel: Channel): Question;
  /** Starts a new conversation (every agent, or only `to`): see `Dispatcher.newConversation`. */
  newConversation(params: {
    to?: string | undefined;
    channel: Channel;
  }): ReturnType<Dispatcher['newConversation']>;
  /** What `GET /api/settings` shows: never the key itself. */
  settingsView(): SettingsResponse;
  /** The app's language (D-153): saved and applied at once to the texts written from now on. */
  setLanguage(language: Lang): SettingsResponse;
  /** Verifies, saves and activates an OpenRouter key. The key is never logged. */
  setOpenRouterKey(key: string): Promise<VerifyResult>;
  /**
   * Paid OpenRouter models on (`freeOnly: false`) or off: saved in
   * `settings.json` and applied at once, also to the agents already working.
   */
  setOpenRouterFreeOnly(freeOnly: boolean): SettingsResponse;
  /** Keys and local servers of the other providers, model lists (M2.2). */
  providerSetup: ProviderManager;
  /** ChatGPT, Claude Agent, Codex (M2.7). */
  subscriptions: SubscriptionService;
  /** Services connected through the user's Claude account (D-069). */
  claudeConnections: ClaudeConnectionService;
  /** MCP sessions of the agents running on a harness (route `/api/harness/mcp`). */
  harnessSessions: HarnessToolSessions;
  /** Saves the Brave Search key and puts Brave first in the `web_search` chain. */
  setBraveKey(key: string): void;
  /** Paid web search on OpenRouter (D-071): on, off or "like the models", and the engine. */
  setWebSearch(change: WebSearchSettingsRequest): SettingsResponse;
  undo(
    actionId: string,
    options?: { force?: boolean | undefined },
  ): Promise<{ commit: string | null; files: string[] }>;
  close(): Promise<void>;
}

const OPENROUTER_INFO_KEY = 'openrouter_key_info';
/** A request that asks for a page (the free chains get `artifact_create` only then). */
const ARTIFACT_REQUEST =
  /\b(pagin\w*|html|grafic\w*|tabell\w*|dashboard|report|presentazion\w*|artefatt\w*|sito|page|chart|table|artifact)\b/i;

/** Tells the log where the secrets are and what could not be read (names only, never values). */
/** Runs of a Telegram chat read for its history (each brings a few turns, D-107). */
const THREAD_RUNS = 40;
/**
 * Closed when people other than the user ask in a Telegram chat (D-114): the terminal, and
 * writing, moving and deleting files. Reading the granted folders stays.
 */
const GROUP_CLOSED_TOOLS: ReadonlySet<string> = new Set(['shell', ...FS_WRITE_TOOLS]);

/** What a monster reads when a run of a Telegram chat reaches `Privato/` (D-107). */
/**
 * Where Claude Code keeps the transcripts of its sessions (prompts, memory and
 * notes read, also from `Privato/`): closed to every monster's terminal and files (M6).
 */
export function claudeTranscriptsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'), 'projects');
}
const TRANSCRIPTS_HINT = 'Use the vault_* tools for the notes you may read.';

/**
 * The data folders of the desktop app (Electron's `userData`): its session cookie is the user
 * in person, and on Linux without a keyring Chromium keeps it with a known key (review of the
 * waves 3 and 4, docs/security-model.md). Closed to every monster's terminal and files, like the
 * transcripts. The name is `Monsters` (`app.setName`), `@monsters/desktop` from the sources.
 */
export function desktopUserDataDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const home = homedir();
  const base =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? env['APPDATA'] || join(home, 'AppData', 'Roaming')
        : env['XDG_CONFIG_HOME'] || join(home, '.config');
  const custom = env['MONSTERS_DESKTOP_USER_DATA'];
  return [
    ...new Set([
      ...(custom ? [custom] : []),
      join(base, 'Monsters'),
      join(base, '@monsters', 'desktop'),
    ]),
  ];
}
function logSecretsStatus(log: EventLog, status: SecretsStatus): void {
  const error = (code: string, message: string) =>
    log.append({ agent: 'system', type: 'error', data: { code, message } });
  if (status.backend === 'file' && status.reason !== 'forced') {
    error('secrets_fallback', hubStrings().secretsFallback(status.reason, status.detail));
  }
  if (status.quarantined?.length) {
    error('secrets_quarantined', hubStrings().secretsQuarantined(status.quarantined.join(', ')));
  }
  if (status.unreadable.length > 0) {
    error('secrets_unreadable', hubStrings().secretsUnreadable(status.unreadable.join(', ')));
  }
}
const PROFILE_NOTE = 'profilo.md';
const PROFILE_MAX_CHARS = 3000;

function isNonEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).some((n) => n !== '.DS_Store');
  } catch {
    return false;
  }
}

/**
 * The folders where a monster can write a file at start: the data directory (their homes and
 * tool folders), the vault, the default projects folder and every folder granted for writing.
 */
export function monsterWritableFolders(
  home: string,
  settings: HubSettings & { vault: string },
): string[] {
  const p = settings.permissions;
  const granted = [p, ...Object.values(p.agents)].flatMap((a) =>
    a.folders.filter((f) => f.write).map((f) => f.path),
  );
  return [home, settings.vault, defaultProjectsDir(home), ...granted];
}

export async function createHub(services: CoreServices, options: HubOptions = {}): Promise<Hub> {
  const { db, log, runs, state, paths } = services;
  const env = options.env ?? process.env;
  const settings = loadHubSettings(paths.home, options.settings ?? {}, env);
  // Inside the app: the `node` of the JavaScript children, found once now and kept (review of
  // wave 5, n. 9), never in a folder the monsters can write.
  pinNodeRuntime({ env, exclude: monsterWritableFolders(paths.home, settings) });
  // Version 2 applied now: the open questions come from a core before D-078.
  const fromBeforeParking = migrate(db, 'team', teamMigrations).includes(2);

  // Secrets first (D-042): every service below reads its keys through this store.
  const { store: secretStore } = await openSecretStore({
    home: paths.home,
    env,
    ...options.secrets,
  });
  const unregisterSecrets = registerSecretStore(secretStore);
  logSecretsStatus(log, secretStore.status());

  const questions = new QuestionStore(db, log);
  // Questions left open by a previous process: their runs are gone. The
  // monster's questions wait for the user (parked), the brake's cards expire (D-078).
  // Those of a core before D-078 had no kind (a brake card read as `ask`
  // would be parked, and a late "Sì" would start a run with a stale
  // approval): they expire, as every restart did then (D-079).
  if (fromBeforeParking) questions.expireOpen({}, 'restart');
  questions.settleAtStartup();

  const team = new TeamService({
    dir: join(paths.home, 'agents'),
    log,
    halted: runs.halted,
    policy: settings.permissions,
  });
  await team.load();
  const bootstrapTeam = () =>
    team.bootstrap({
      user: settings.userName,
      orchestratorName: settings.orchestratorName,
      variant: settings.monsterVariant,
      ...(options.teamModels ? { models: options.teamModels } : {}),
    });
  if (options.bootstrap) await bootstrapTeam();

  const root = settings.vault;
  const indexPath = defaultIndexPath(paths.home, root);
  mkdirSync(dirname(indexPath), { recursive: true, mode: 0o700 });
  // MONSTERS_EMBEDDINGS=off in the process environment always wins (tests, CI).
  const embeddingsOff =
    !settings.semanticSearch ||
    env['MONSTERS_EMBEDDINGS'] === 'off' ||
    process.env['MONSTERS_EMBEDDINGS'] === 'off';
  let lastSemanticError: string | null = null;
  const embedder =
    options.embedder !== undefined
      ? options.embedder
      : embeddingsOff
        ? null
        : (signal: AbortSignal) =>
            WorkerEmbedder.create({ cacheDir: join(paths.home, 'models'), signal });
  // The folder of the files of Monsters (D-075): never a `File/` the user made.
  const filesDir = filesDirFor(root);
  const vaultOptions = {
    root,
    indexPath,
    filesDir,
    permissions: { ...team.vaultPermissions(), external: settings.mcp },
    // Folders without permission, watcher failures: in the log, never fatal.
    onWarning: (w: VaultWarning) =>
      log.append({ agent: 'system', type: 'error', data: { code: w.code, message: w.message } }),
    ...(options.git !== undefined ? { git: options.git } : {}),
    ...(embedder
      ? {
          embedder,
          semanticOptions: {
            // Offline or failed download: search stays full-text, the log says why
            // (once per distinct error: retries while offline are not logged again).
            // transformers.js not installed (packaged app, D-046): `semantic_off`, one
            // line, not shown as a failure.
            onError: (err: Error) => {
              if (err.message === lastSemanticError) return;
              lastSemanticError = err.message;
              log.append({
                agent: 'system',
                type: 'error',
                data: {
                  code:
                    err instanceof SemanticUnavailableError
                      ? 'semantic_off'
                      : 'semantic_unavailable',
                  message: err.message,
                },
              });
            },
          },
        }
      : {}),
  };
  const vault = isNonEmptyDir(root)
    ? await VaultService.open({ ...vaultOptions, initGit: true })
    : await VaultService.create({
        ...vaultOptions,
        orchestratorName: team.orchestrator()?.config.name ?? settings.orchestratorName,
        agentNames: team
          .list()
          .filter((a) => a.config.kind !== 'orchestrator')
          .map((a) => a.config.name),
      });
  team.setVault(vault);

  // Files of the user and of the monsters (D-075): in the notes folder under `File/`.
  migrate(db, 'files', filesMigrations);
  const files = new FileStore({
    db,
    root: vault.root,
    dirName: filesDir,
    // The text of a document is extracted in a worker after the upload answered (D-085).
    onText: (meta) =>
      log.append({
        agent: meta.source === 'user' ? 'user' : (meta.agent ?? 'system'),
        ...(meta.runId ? { runId: meta.runId } : {}),
        type: 'file',
        data: fileEvent(meta, {}, 'updated'),
      }),
  });
  // Created at once with its marker: the choice holds at the next start too.
  files.ensureDir();
  /** The files of a message, read only when a model needs them. */
  const sourcesOf = (ids: readonly string[]): AttachmentSource[] =>
    files.many(ids).map((meta) => ({
      meta,
      bytes: () => files.read(meta),
      text: () => files.text(meta.id),
    }));
  if (settings.watchVault) await vault.watch();

  const providers = options.providers ?? new ProviderRegistry();
  /** Since when unfingerprinted requests count for the OpenRouter key in use (D-019). */
  const legacySince: Record<string, number> = {};
  if (!options.providers) {
    const found = readOpenRouterKey(paths.secrets, env);
    if (found) {
      log.redactor.addSecret(found.key);
      const provider = configureOpenRouter(
        providers,
        found.key,
        settings.openrouter,
        state.get<OpenRouterKeyInfo>(OPENROUTER_INFO_KEY) ?? null,
        options.fetch ? { fetch: options.fetch } : {},
      );
      // The key may have changed while the core was stopped (file or env).
      legacySince['openrouter'] = noteOpenRouterKey(state, provider.keyId);
    }
  }
  const setOpenRouterKey = async (key: string): Promise<VerifyResult> => {
    const trimmed = key.trim();
    const verified = await verifyOpenRouterKey(
      trimmed,
      options.fetch ? { fetch: options.fetch } : {},
    );
    if (!verified.ok) return verified;
    log.redactor.addSecret(trimmed);
    saveOpenRouterKey(paths.secrets, trimmed);
    state.set(OPENROUTER_INFO_KEY, verified.info);
    paidSearch.refresh();
    if (!options.providers) {
      const provider = configureOpenRouter(
        providers,
        trimmed,
        settings.openrouter,
        verified.info,
        options.fetch ? { fetch: options.fetch } : {},
      );
      // Only the requests of this key come back: a new key may be another account.
      legacySince['openrouter'] = noteOpenRouterKey(state, provider.keyId);
      restoreRateBudgets(providers, log, { ids: ['openrouter'], legacySince });
    }
    return verified;
  };

  // Other providers (M2.2): keys of the paid ones, local servers.
  const providerSetup = new ProviderManager({
    registry: providers,
    home: paths.home,
    secretsDir: paths.secrets,
    settings: settings.providers,
    log,
    env,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    injected: options.providers !== undefined,
    restore: (id) => restoreRateBudgets(providers, log, { ids: [id] }),
    openRouter: {
      freeOnly: () => settings.openrouter.freeOnly,
      stored: () => {
        const found = readOpenRouterKey(paths.secrets, env);
        return found
          ? { ...found, ...(found.source === 'env' ? { envVar: 'OPENROUTER_API_KEY' } : {}) }
          : null;
      },
      setKey: async (key) => {
        const verified = await setOpenRouterKey(key);
        if (!verified.ok) {
          throw new ProviderSetupError(
            verified.status === 401 || verified.status === 403
              ? 'invalid_key'
              : 'verification_failed',
            verified.status === 401 || verified.status === 403
              ? hubStrings().openRouterRefused
              : hubStrings().openRouterUnverified,
          );
        }
      },
      removeKey: () => {
        removeProviderKey(paths.secrets, 'openrouter');
        paidSearch.refresh();
        state.delete(OPENROUTER_INFO_KEY);
        if (options.providers) return;
        if (providers.has('openrouter')) providers.unregister('openrouter');
        // A key in the environment takes over again.
        const fromEnv = readOpenRouterKey(paths.secrets, env);
        if (fromEnv) {
          const provider = configureOpenRouter(providers, fromEnv.key, settings.openrouter, null, {
            ...(options.fetch ? { fetch: options.fetch } : {}),
          });
          legacySince['openrouter'] = noteOpenRouterKey(state, provider.keyId);
          restoreRateBudgets(providers, log, { ids: ['openrouter'], legacySince });
        }
      },
    },
  });
  providerSetup.configureAll();

  // Subscriptions (M2.7): registered only when set up by the user.
  const planLimits = new PlanLimits(state);
  const subscriptions = new SubscriptionService({
    registry: providers,
    planLimits,
    home: paths.home,
    secretsDir: paths.secrets,
    log,
    state,
    // The user's environment, never the core's configuration (`options.env`).
    env: process.env,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.subscriptions?.siwcEndpoints
      ? { siwcEndpoints: options.subscriptions.siwcEndpoints }
      : {}),
    ...(options.subscriptions?.callbackPort !== undefined
      ? { callbackPort: options.subscriptions.callbackPort }
      : {}),
    ...(options.subscriptions?.binaries ? { binaries: options.subscriptions.binaries } : {}),
    ...(options.subscriptions?.install ? { install: options.subscriptions.install } : {}),
    onKill: (hook) => runs.onKill(() => hook()),
    version: CORE_VERSION,
    onReady: (id) => void preferPlan(id).catch(() => {}),
  });
  subscriptions.configure();
  /**
   * "Abbonamento prima" (D-069): when a plan becomes usable, the agents still
   * on Monsters' default chain (the free one, or one with no provider set up)
   * move to it, once per plan. A chain the user chose stays as it is, and a
   * team already on Claude is not moved to ChatGPT.
   */
  const preferPlan = async (id: 'claude-agent' | 'chatgpt'): Promise<void> => {
    const flag = `subscriptions.${id}.preferred`;
    const agents = team.list();
    if (agents.length === 0 || state.get<boolean>(flag) === true || !providers.has(id)) return;
    let chain: ModelRef[];
    if (id === 'claude-agent') {
      chain = [{ provider: 'claude-agent', model: 'sonnet' }];
    } else {
      const first = (await providers.get('chatgpt').listModels({ tools: true }))[0];
      if (!first) return;
      chain = [
        { provider: 'chatgpt', model: first.id },
        ...(providers.has('openrouter')
          ? [{ provider: 'openrouter', model: OPENROUTER_FREE_ROUTER }]
          : []),
      ];
    }
    state.set(flag, true);
    const moved: string[] = [];
    for (const a of agents) {
      if (!isDefaultChain(a.config.models, (p) => providers.has(p))) continue;
      await team.setModels(a.config.id, chain);
      moved.push(a.config.name);
    }
    if (moved.length === 0) return;
    const plan = id === 'claude-agent' ? 'Claude' : 'ChatGPT';
    log.append({
      agent: 'system',
      type: 'message',
      data: {
        role: 'system',
        text: hubStrings().movedToPlan(moved, moved.length === agents.length, plan),
      },
    });
  };
  const harnessSessions = new HarnessToolSessions(log);
  const mcpUrl = () => harnessMcpUrl(services.config.host, services.config.port);
  const hookUrl = () => harnessHookUrl(services.config.host, services.config.port);
  // Services reached through the user's Claude account (D-069).
  const claudeConnections = new ClaudeConnectionService({
    state,
    log,
    claude: () => subscriptions.claude,
    ready: () => subscriptions.claudeReady(),
    dir: join(subscriptions.runsDir, 'checks'),
    agentExists: (id) => team.get(id) !== undefined,
    // A service for the whole team reaches a project's monsters only when the project chose it (D-097).
    wildcard: (agentId, id) => team.wildcardAllows(agentId, 'claude', id),
  });
  /** Context windows of the models, for the `context` of every step (C.1, D-075). */
  const windows = new ModelWindows(providers, {
    state,
    // The price of a direct key's model is its OpenRouter twin's (D-114, review of 19/10).
    publicPrices:
      options.publicPrices !== undefined
        ? options.publicPrices
        : options.providers
          ? null
          : (signal) => fetchOpenRouterPrices(options.fetch ?? fetch, signal),
  });
  const contextWindow = (ref: { provider: string; model: string }) =>
    windows.get(ref.provider, ref.model);
  /** What the first model of an agent's chain reads besides text (files feature). */
  const sightOf = (agent: AgentDefinition): ModelSight => {
    const first = agent.config.models[0];
    if (!first) return { images: false, pdf: false };
    return modelSight(first.provider, first.model, windows.inputs(first.provider, first.model));
  };
  /** Stops the summaries in the background when the core closes. */
  const summaries = new AbortController();
  // The older turns of a conversation become a summary (C.3, D-082).
  const compactor = new ConversationCompactor({
    log,
    questions,
    maxTurns: () => settings.conversationTurns,
    enabled: () => settings.conversationSummary,
    summarize: createSummarizer({
      providers,
      log,
      price: (p, m) => priceOf({ provider: p, model: m }),
      freeOnly: () => settings.openrouter.freeOnly,
      scope: () => settings.conversationSummaryModels,
      capped: (id) => spend.stopReason(id) !== null,
      // A summary of a project's monster is the project's spending (F-B13).
      projectOf: (id) => team.projectOf(id)?.id ?? null,
      claude: () => {
        if (!providers.has('claude-agent')) return undefined;
        const p = providers.get('claude-agent');
        return p.kind === 'harness' ? p : undefined;
      },
      scratchRoot: subscriptions.runsDir,
    }),
  });
  /** The projects' folders: their CLAUDE.md, AGENTS.md and configuration are the user's (D-103). */
  const projectFolders = (): string[] =>
    team
      .projects()
      .filter((p) => p.folder !== undefined && p.archivedAt === undefined)
      .map((p) => p.folder!);
  /** The "## Progetto" section of a project's monster (D-097), read at every run. */
  const projectOf = (agent: AgentDefinition): string | undefined => {
    const p = team.projectOf(agent.config.id);
    if (!p) return undefined;
    const lead = agent.config.kind === 'lead' ? undefined : team.lead(p.id)?.config.name;
    return projectSection(p, { lead, access: accessNotesOf(agent, p, lead) });
  };
  /**
   * What the account has and the project does not give this monster (D-129): the section says
   * it, with where the user turns it on, instead of the monster saying "non è collegato".
   */
  const accessNotesOf = (
    agent: AgentDefinition,
    p: Project,
    lead: string | undefined,
  ): ProjectAccessNotes => {
    const id = agent.config.id;
    const servers = mcp.view().servers;
    const notHere = servers
      .filter(
        (s) =>
          s.enabled &&
          s.preset !== 'browser' &&
          s.agents.includes('*') &&
          !s.agents.includes(id) &&
          !p.connections.mcp.includes(s.name),
      )
      .map((s) => s.label);
    // Services through Claude reach the monsters on Claude; a lead asks them for its project.
    if (agent.config.kind === 'lead' || harnessOf(agent)?.id === 'claude-agent') {
      for (const c of claudeConnections.view().connections) {
        if (!c.added || !c.agents.includes('*') || c.agents.includes(id)) continue;
        if (p.connections.claude.includes(c.id)) continue;
        notHere.push(hubPrompts().viaClaude(MCP_CATALOG.find((e) => e.id === c.id)?.name ?? c.id));
      }
    }
    const browser = servers.find((s) => s.preset === 'browser');
    return {
      notHere,
      browser: browser !== undefined && browser.enabled && !mcp.allowed(id, browser.name),
      webOff: !p.webSearch,
      asker: agent.config.tools.includes(ACCESS_REQUEST_TOOL)
        ? { self: true }
        : { capo: lead ?? hubPrompts().yourLead },
    };
  };
  /** The harness of an agent whose first link is one (Claude Agent, Codex). */
  const harnessOf = (agent: AgentDefinition): HarnessProvider | undefined => {
    const first = agent.config.models[0];
    if (!first || !providers.has(first.provider)) return undefined;
    const p = providers.get(first.provider);
    return p.kind === 'harness' ? p : undefined;
  };
  /**
   * The monsters of an agent's squad that have the web, when it has none in this turn (D-127):
   * a capo whose squad searches (D-026), a monster without the permission. Its card and
   * instructions name them, so it never takes the missing web for a refusal of the user.
   */
  const webElsewhere = (agent: AgentDefinition): string[] | undefined => {
    if (agent.config.tools.some((t) => WEB_TOOLS.includes(t))) return undefined;
    const squad = team.projectOf(agent.config.id)?.id;
    return team
      .members(squad)
      .filter(
        (d) => d.config.id !== agent.config.id && d.config.tools.some((t) => WEB_TOOLS.includes(t)),
      )
      .map((d) => d.config.name);
  };
  /** The app has a window open on the core (the event stream), set by the server (D-142). */
  let appPresence: () => boolean = () => true;
  /** What the end-of-turn check and the note of changed accesses read (D-140, D-141). */
  const accessDeps: AccessStateDeps = {
    team,
    servers: () => mcp.view().servers,
    allowed: (agentId, server) => mcp.allowed(agentId, server),
    claude: () => claudeConnections.view().connections,
    notHere: (agent) => {
      const p = team.projectOf(agent.config.id);
      if (!p) return [];
      const lead = agent.config.kind === 'lead' ? undefined : team.lead(p.id)?.config.name;
      return accessNotesOf(agent, p, lead).notHere;
    },
    othersAsk: (runId) => othersAsk(runId),
    userName: () => settings.userName,
  };
  /**
   * The accesses of a run, said true (D-140, D-141): the check of the end of the turn on what
   * the monster says about them, and the note of the first run after they changed.
   */
  const accessOfRun = (o: RunAgentOptions, harness: HarnessProvider | undefined) => {
    const agent = o.agent;
    const id = agent.config.id;
    const connectors =
      harness?.id === 'claude-agent' ? claudeConnections.connectorsFor(id).map((c) => c.name) : [];
    const terminal = harness ? team.permissionsFor(id).shell && !othersAsk(o.runId) : undefined;
    const check = accessCheck({
      log: o.log,
      agent: { id, name: agent.config.name },
      runId: o.runId,
      ...(o.parentId !== undefined ? { parentId: o.parentId } : {}),
      context: () => claimContext(accessDeps, agent),
      state: () =>
        accessState(accessDeps, {
          agent,
          runId: o.runId,
          toolNames: [
            ...o.tools.map((t) => t.name).filter((n) => agent.config.tools.includes(n)),
            ...(o.extraTools ?? []).map((t) => t.name),
          ],
          connectors,
          ...(harness ? { harness: harness.id } : {}),
          ...(terminal !== undefined ? { terminal } : {}),
          ...(o.unlinked ? { unlinked: o.unlinked } : {}),
        }),
    });
    // Accesses changed since its last run: one note, this run only.
    const key = `access.caps.${id}`;
    const caps = accessCaps(accessDeps, agent, {
      ...(harness ? { harness: harness.id, terminal: team.permissionsFor(id).shell } : {}),
      connectors,
    });
    const before = state.get<string[]>(key);
    const note = accessChangeNote(before, caps);
    if (JSON.stringify(before) !== JSON.stringify(caps)) state.set(key, caps);
    const hint = [o.hint, note].filter(Boolean).join('\n\n');
    return {
      check,
      onFinalAnswer: withAccessHook(check.hook, o.onFinalAnswer),
      ...(hint ? { hint } : {}),
    };
  };
  /**
   * What the card says beyond the tools (D-132): why the web is missing, the project the
   * monster works for (its squad, services and cap are on the project's page), and the MCP
   * servers cut at the tools cap of this run. Asked after `toolsFor`.
   */
  const cardOf = (agent: AgentDefinition): CardContext => {
    const webOff = team.webOff(agent.config.id);
    const project = team.projectOf(agent.config.id)?.name;
    const cut = mcp.cutFor(agent.config.id);
    return {
      ...(webOff ? { webOff } : {}),
      ...(project ? { project } : {}),
      ...(cut.length > 0 ? { cut } : {}),
    };
  };
  /**
   * Runs an agent on its harness when the first link of its chain is one,
   * otherwise in our loop. A harness never falls back to a paid model (D-035).
   */
  const runAny = (
    o: RunAgentOptions & { files?: readonly AttachmentSource[] },
  ): Promise<AgentRunResult> => {
    const harness = harnessOf(o.agent);
    // The spending cap (D-070): a monster whose models cost money does not start past it.
    const capped = harness ? null : spend.stopReason(o.agent.config.id);
    if (capped) {
      // The project's cap is raised on the project's page, not in the settings (collaudo of 17/10).
      // (the reason is the spend meter's sentence: a project's says "del progetto" / "project")
      const inProject = capped.includes(' del progetto ') || /\bproject\b/i.test(capped);
      const path = inProject
        ? spendCapPath(team.projectOf(o.agent.config.id)?.name ?? true)
        : spendCapPath();
      const message = hubStrings().spendStop(o.agent.config.name, capped, path, inProject);
      o.log.append({
        agent: o.agent.config.id,
        runId: o.runId,
        parentId: o.parentId ?? null,
        type: 'error',
        data: { code: 'spend_cap', message },
      });
      return Promise.resolve({
        status: 'failed',
        text: '',
        finalText: '',
        steps: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        model: null,
        missingTools: [],
        error: message,
      });
    }
    if (!harness && HARNESS_PROVIDER_IDS.has(o.agent.config.models[0]?.provider ?? '')) {
      return Promise.resolve(
        harnessUnavailable({
          agent: o.agent,
          log: o.log,
          runId: o.runId,
          ...(o.parentId !== undefined ? { parentId: o.parentId } : {}),
        }),
      );
    }
    const attached = o.files ?? [];
    const project = projectOf(o.agent);
    const elsewhere = webElsewhere(o.agent);
    // The project the run works for: its spending stays the project's (F-B13). The run's owner
    // decides (the lead that delegates), not the monster at work, which may be of no project
    // (review of 19/10, item 15).
    const projectId =
      team.projectOf(runs.getRun(o.runId)?.agentId ?? o.agent.config.id)?.id ?? null;
    const access = accessOfRun(o, harness && o.scope ? harness : undefined);
    if (!harness || !o.scope) {
      return runAgent({
        contextWindow,
        price: priceOf,
        projectId,
        ...o,
        onFinalAnswer: access.onFinalAnswer,
        ...(access.hint ? { hint: access.hint } : {}),
        ...(project ? { project } : {}),
        ...(elsewhere ? { webElsewhere: elsewhere } : {}),
        ...(attached.length > 0
          ? { attachments: attachmentParts(attached, sightOf(o.agent)) }
          : {}),
      });
    }
    const ran = runHarnessAgent({
      contextWindow,
      projectId,
      ...(access.hint ? { hint: access.hint } : {}),
      ...(attached.length > 0
        ? { attachments: harnessAttachments(attached, harness.id, (m) => files.absPath(m)) }
        : {}),
      agent: o.agent,
      harness,
      model: o.agent.config.models[0]!.model,
      // "Automatica" (D-110): the effort of the first link goes to Claude Code (`--effort`).
      ...(o.agent.config.models[0]!.effort ? { effort: o.agent.config.models[0]!.effort } : {}),
      // Opus at the plan's limit: the same request on Sonnet, same plan, never another service (D-093).
      ...(harness.id === 'claude-agent'
        ? (() => {
            const next = claudePlanFallback(o.agent.config.models[0]!.model);
            if (!next) return {};
            // Sonnet works at its own effort (D-110), only where the run had one.
            const effort = o.agent.config.models[0]!.effort ? autoEffort(next) : undefined;
            return { fallbackModel: next, ...(effort ? { fallbackEffort: effort } : {}) };
          })()
        : {}),
      task: o.task,
      tools: o.tools,
      ...(o.extraTools ? { extraTools: o.extraTools } : {}),
      ...(o.unlinked?.length ? { unlinked: o.unlinked } : {}),
      ...(o.card ? { card: o.card } : {}),
      signal: o.signal,
      scope: o.scope,
      log: o.log,
      runId: o.runId,
      sessions: harnessSessions,
      mcpUrl,
      workspace: agentWorkspace(paths.home, o.agent.config.id),
      // A project's monster works in the project's folder (D-097).
      ...(team.workdirOf(o.agent.config.id) ? { cwd: team.workdirOf(o.agent.config.id)! } : {}),
      ...(project ? { project } : {}),
      instructionFolders: projectFolders,
      scratchRoot: subscriptions.runsDir,
      // Not when people other than the user ask in a Telegram chat (D-114).
      systemTools: team.permissionsFor(o.agent.config.id).shell && !othersAsk(o.runId),
      // Its terminal and files stay out of the data folder, except its own folder (D-078).
      dataDir: paths.home,
      // In a Telegram chat, out of the private notes too (D-107).
      closedFolders: [
        { path: claudeTranscriptsDir(), message: hubPrompts().transcriptsClosed },
        ...desktopUserDataDirs().map((path) => ({ path, message: hubPrompts().desktopDataClosed })),
        ...(threadOfRun(log, o.runId)
          ? [{ path: privateFolder(), message: hubPrompts().privateInChat }]
          : []),
      ],
      ...(o.memory !== undefined ? { memory: o.memory } : {}),
      ...(o.profile !== undefined ? { profile: o.profile } : {}),
      ...(o.parentId !== undefined ? { parentId: o.parentId } : {}),
      ...(o.history ? { history: o.history } : {}),
      ...(o.summary ? { summary: o.summary } : {}),
      ...(o.budget ? { budget: o.budget } : {}),
      // D-069: the plan's web search, the brake and the stop hook on the harness's own tools.
      webSearch: true,
      ...(elsewhere ? { webElsewhere: elsewhere } : {}),
      hookUrl,
      // D-111: the plan's limits the harness reports while it works.
      onPlanLimits: (reading) => planLimits.observe(reading),
      ...(o.guard ? { guard: o.guard } : {}),
      onFinalAnswer: access.onFinalAnswer,
      ...(harness.id === 'claude-agent'
        ? {
            connectors: claudeConnections.connectorsFor(o.agent.config.id),
            onMcpStatus: (servers: { name: string; status: string }[]) =>
              claudeConnections.noteRun(servers),
          }
        : {}),
    });
    // Codex has no stop hook: what it said about the accesses is corrected after the answer.
    if (harness.id === 'claude-agent') return ran;
    return ran.then((r) => {
      const note = r.status === 'completed' ? access.check.correct(r.text) : null;
      if (!note) return r;
      return {
        ...r,
        text: `${r.text}\n\n${note}`,
        finalText: `${r.finalText || r.text}\n\n${note}`,
      };
    });
  };

  // The budgets start from the requests the log still counts (restart, D-004).
  restoreRateBudgets(providers, log, { legacySince });

  const gate: DecisionGate = new DecisionGate({
    log,
    rules: resolveDecisionRules(settings.decisions.rules, settings.decisions.disabled),
    threshold: settings.decisions.threshold,
    jevMaxP: () => settings.instinct.jev.maxP,
    mode: () => decisions.mode('gate'),
  });
  // Engine of the gate (rules, small LLM, Jev): sets the gate's port (D-037).
  const decisions: DecisionEngineService = new DecisionEngineService({
    home: paths.home,
    secretsDir: paths.secrets,
    settings,
    gate,
    log,
    providers,
    llmModels: () => team.orchestrator()?.config.models ?? DEFAULT_FREE_CHAIN,
    env,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.decisionPort !== undefined ? { override: options.decisionPort } : {}),
  });

  const permissions = new PermissionsService({
    home: paths.home,
    settings,
    team,
    log,
    vaultRoot: () => vault.root,
    installDirs: installFolders(env),
  });

  const mcp = new McpManager({
    home: paths.home,
    secretsDir: paths.secrets,
    servers: settings.mcpServers,
    log,
    runs,
    team,
    state,
    // The user's environment, never the core's configuration (`options.env`).
    env: process.env,
    // A browser screenshot (or any image of another program) is kept among the File (D-075).
    saveImage: ({ server, preset, tool, data, ctx }) => {
      if (toolImageTooLarge(data)) return null;
      // At most so many per run: a loop of screenshots must not fill the user's disk.
      if (files.toolImagesOf(ctx.runId) >= TOOL_IMAGES_PER_RUN) return null;
      try {
        const meta = files.saveImageSync({
          bytes: Buffer.from(data, 'base64'),
          name: toolImageName(server, preset),
          source: 'tool',
          agent: ctx.agentId,
          runId: ctx.runId,
          tool,
          maxBytes: TOOL_IMAGE_MAX_BYTES,
        });
        ctx.emit({ type: 'file', data: fileEvent(meta, { tool }) });
        // The file id goes in the result: Dietro le quinte shows the picture (preview/files.ts `filesIn`).
        return hubPrompts().imageSaved(meta.name, meta.id);
      } catch {
        return null;
      }
    },
  });
  // A capo asks the user for an access a monster lacks (D-130): the user's tap, applied here.
  const access = new AccessRequests({
    team,
    questions,
    log,
    permissions,
    projects: () => projects,
    mcp,
    claude: () => claudeConnections.view(),
    userName: () => settings.userName,
  });
  /**
   * `artifact_create` (D-075): for the monsters that may write notes. On a free chain it waits
   * for `tools_search` unless the request asks for a page, a chart or a table (D-134:
   * deferred, never taken away: "infografica" did not match and the monster had no way).
   */
  const artifactDeferred = (agent: AgentDefinition, request: string): boolean =>
    isFreeChain(agent.config.models) && !ARTIFACT_REQUEST.test(request);
  /** One per run: its pages are saved without scripts once the run read third-party text (D-085). */
  const artifacts = new WeakMap<object, MonstersTool>();
  const artifactFor = (agent: AgentDefinition, _request: string, run: object): MonstersTool[] => {
    if (!agent.config.tools.includes('vault_write')) return [];
    let tool = artifacts.get(run);
    if (!tool) {
      tool = artifactTool(() => files, {
        // A request of a person of a Telegram group too (D-107).
        tainted: () => taintOf(run).tainted || taintOf(run).guarded !== undefined,
      });
      artifacts.set(run, tool);
    }
    return [tool];
  };

  /** Ids that may be files in a brief (ULIDs). */
  const ULID_IN_TEXT = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
  /**
   * `file_read` (review of 16/10): offered when the conversation has files —
   * attached now, or named in the history by their id — or a brief names one
   * the monster may read. `show` gives an image back with the next step.
   */
  const fileReadFor = (scope: FileReadScope, show?: (meta: FileMeta) => boolean): MonstersTool =>
    fileReadTool({ files: () => files, scope: () => scope, ...(show ? { show } : {}) });
  const briefNamesFile = (brief: unknown, scope: FileReadScope) =>
    [...JSON.stringify(brief ?? '').matchAll(ULID_IN_TEXT)].some((m) => {
      const meta = files.get(m[0]);
      return meta !== undefined && inFileScope(meta, scope);
    });

  const onboarding = new OnboardingService({
    home: paths.home,
    runs,
    state,
    log,
    team,
    vault,
    gate,
    providers,
    settings,
    hasModelProvider: () => providers.list().some((p) => p.kind === 'model'),
    checkFolders: (folders) => permissions.checkFolders(folders),
    ...(options.teamModels
      ? { proposalModels: () => options.teamModels!, agentModels: () => options.teamModels! }
      : {}),
    ...(options.onboardingGenerate !== undefined ? { generate: options.onboardingGenerate } : {}),
  });

  const squad = new TeamManager({
    home: paths.home,
    team,
    vault,
    log,
    runs,
    settings,
    gate,
    questions,
    onboarding,
    providers,
    ...(options.teamGenerate !== undefined ? { generate: options.teamGenerate } : {}),
  });

  // Paid search on OpenRouter (D-071): first in the chain when it is in use.
  if (options.searchKey) log.redactor.addSecret(options.searchKey);
  const paidSearch = new PaidSearch({
    home: paths.home,
    settings,
    readKey: () => options.searchKey ?? readOpenRouterKey(paths.secrets, env)?.key ?? null,
    keyInfo: () =>
      options.searchKey ? null : (state.get<OpenRouterKeyInfo>(OPENROUTER_INFO_KEY) ?? null),
    // The spending cap (D-070) stops the paid search too, also for monsters on free models.
    spendCap: (agentId) => spend.capReached(agentId ?? ''),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  // web_search chain (D-016): `settings.webSearch` when given, otherwise
  // DuckDuckGo → Wikipedia; a Brave key saved from the UI goes first.
  let braveKey = readBraveKey(paths.secrets, env)?.key ?? null;
  if (braveKey) log.redactor.addSecret(braveKey);
  const backendOptions = {
    userAgent: monstersUserAgent(CORE_VERSION),
    openrouterKey: () => paidSearch.key(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  const buildSearchChain = (): SearchBackend[] => {
    const configured = settings.webSearch;
    if (!configured?.length) return defaultSearchBackends({ ...backendOptions, braveKey });
    const chain = configured.map((b) => createSearchBackend(b, backendOptions));
    return braveKey && !configured.some((b) => b.backend === 'brave')
      ? [createSearchBackend({ backend: 'brave', apiKey: braveKey }, backendOptions), ...chain]
      : chain;
  };
  let searchChain = buildSearchChain();
  const webTools = options.webTools ?? [
    createWebSearchTool({
      // The user's language from the profile (not ready before onboarding: no hint).
      region: () => {
        try {
          return searchRegion(squad.profile().language);
        } catch {
          return undefined;
        }
      },
      backends: (agentId) => {
        const paid = paidSearch.backend(agentId);
        return paid ? [paid, ...searchChain] : searchChain;
      },
    }),
    createWebFetchTool(),
  ];
  // Note contents reach the model as external data, like web pages.
  const NOTE_READERS: Record<string, (input: unknown, output: unknown) => string> = {
    vault_read: (input, output) =>
      `vault ${(output as { path?: string }).path ?? (input as { path?: string }).path ?? ''}`,
    vault_search: (input) => `vault_search ${(input as { query?: string }).query ?? ''}`,
  };
  /**
   * Why a run works with the toolset of a Telegram chat (D-114): someone who is not the user
   * asks in it (its taint is `guarded`) and the bot does not give them the whole toolset.
   * Undefined: the monster's whole toolset (the user's own words, the app, an automation).
   */
  const othersAsk = (runId: string | null | undefined): string | undefined => {
    const thread = threadOfRun(log, runId);
    if (!thread || !runId) return undefined;
    const run = runs.getRun(runId);
    const reason = run ? taints.get(run)?.guarded : undefined;
    if (!reason) return undefined;
    return telegramBots.fullTools(thread) ? undefined : reason;
  };
  /** A tool closed in those runs: refused at every call, also when a person joins mid-run. */
  const closedToOthers = (t: MonstersTool): MonstersTool =>
    GROUP_CLOSED_TOOLS.has(t.name)
      ? {
          ...t,
          execute: (input, ctx) => {
            if (othersAsk(ctx.runId)) {
              throw new ToolError('BLOCKED_BY_POLICY', `${t.name} is off in this chat`, {
                hint: 'Other people take part in this chat: no terminal, no changes to files (a fixed rule of Monsters for chats with other people, not a no of the user). Do what you can with the other tools, and say what the user can do from the app.',
              });
            }
            return t.execute(input, ctx);
          },
        }
      : t;
  /** Without the tools closed to the people of a Telegram chat, when they ask (D-114). */
  const withoutClosedTools = (agent: AgentDefinition, runId: string): AgentDefinition =>
    othersAsk(runId) && agent.config.tools.some((t) => GROUP_CLOSED_TOOLS.has(t))
      ? {
          ...agent,
          config: {
            ...agent.config,
            tools: agent.config.tools.filter((t) => !GROUP_CLOSED_TOOLS.has(t)),
          },
        }
      : agent;
  /**
   * The vault of those runs (D-114): the project's area, the monster's own area and Inbox.
   * The tags of the whole vault stay out.
   */
  const vaultScopeOf = (agentId: string): string[] => {
    const def = team.get(agentId);
    const project = team.projectOf(agentId)?.vaultArea;
    const own = (def?.config.vault.write ?? [])
      .map((g) => g.replace(/\/\*\*$/, ''))
      .filter((g) => g !== '' && !/[*?[\]{}]/.test(g));
    return [
      ...new Set([
        vault.permissions.areaOf(agentId),
        INBOX_FOLDER,
        ...(project ? [project] : []),
        ...own,
      ]),
    ];
  };
  const scopedForOthers = (t: MonstersTool): MonstersTool => ({
    ...t,
    execute: (input, ctx) => {
      if (!othersAsk(ctx.runId)) return t.execute(input, ctx);
      if (t.name === 'vault_tags' || t.name === 'vault_apply_proposal') {
        throw new ToolError('BLOCKED_BY_POLICY', `${t.name} is off in this chat`, {
          hint: 'Other people take part in this chat: use vault_search and vault_list in the folders you may reach.',
        });
      }
      return withVaultScope(vaultScopeOf(ctx.agentId), () => t.execute(input, ctx));
    },
  });
  // Terminal and files outside the vault (M2.1): offered only to the agents
  // whose permissions allow them (TeamService), checked again at every call.
  const systemToolset: MonstersTool[] = [
    createShellTool({
      // A project's monster works in the project's folder (D-097).
      workspace: (id) => team.workdirOf(id) ?? agentWorkspace(paths.home, id),
      // Its CLIs always in its own folder: never a `bin/` of the project's repo first on PATH.
      toolsHome: (id) => agentWorkspace(paths.home, id),
      allowed: (id) => team.permissionsFor(id).shell,
      // The data folder of Monsters, except the agent's own folder in it (D-078).
      lockout: (id) => ({ dataDir: paths.home, allowed: [agentWorkspace(paths.home, id)] }),
      // A run of a Telegram chat never reaches the private notes (D-107).
      runLocks: ({ runId }) => [
        {
          lock: { dataDir: claudeTranscriptsDir(), allowed: [] },
          message: hubPrompts().transcriptsClosed,
          hint: TRANSCRIPTS_HINT,
        },
        ...desktopUserDataDirs().map((dataDir) => ({
          lock: { dataDir, allowed: [] },
          message: hubPrompts().desktopDataClosed,
          hint: 'Work in another folder.',
        })),
        ...(threadOfRun(log, runId)
          ? [
              {
                lock: { dataDir: privateFolder(), allowed: [] },
                message: hubPrompts().privateInChat,
                hint: 'Use the vault_* tools for the notes you may read.',
              },
            ]
          : []),
      ],
      instructionFolders: projectFolders,
      // The user's environment, never the core's configuration (`options.env`).
      env: process.env,
      isSecret: (_name, value) => log.redactor.containsKnown(value),
      redact: (text) => log.redactor.redactKnown(text),
    }),
    ...createFsTools({
      grants: (id) => team.permissionsFor(id).folders,
      // Without the terminal, files that run commands (git hooks, shell profiles) stay closed.
      canRunCommands: (id) => team.permissionsFor(id).shell,
      instructionFolders: projectFolders,
      protectedFolders: () => [
        {
          path: vault.root,
          reason:
            'This is the vault: notes are reachable only with the vault_* tools (history and undo).',
          hint: 'Use vault_search, vault_read, vault_write or vault_edit.',
        },
        {
          path: paths.home,
          reason: 'This is the data folder of Monsters (keys, log, agents): it is off limits.',
          hint: 'Work in another granted folder.',
        },
        // The installed app: its core runs outside the signed ASAR (review of 18/10, M9).
        ...installFolders(env).map((path) => ({
          path,
          reason:
            'This is the folder where Monsters is installed: its program files are off limits.',
          hint: 'Work in another granted folder.',
        })),
        {
          path: claudeTranscriptsDir(),
          reason: 'These are the transcripts of the Claude Code sessions: they are off limits.',
          hint: 'Work in another granted folder.',
        },
        ...desktopUserDataDirs().map((path) => ({
          path,
          reason: 'This is the data folder of the Monsters app (its session): it is off limits.',
          hint: 'Work in another granted folder.',
        })),
      ],
      trashDir: join(paths.home, FILES_TRASH_DIR),
      redact: (text) => log.redactor.redactKnown(text),
    }),
  ].map(closedToOthers);
  /** The live run of a tool call: its taint says where what it writes comes from (A2). */
  const liveTaint = (runId: string): RunTaint | undefined => {
    const run = runs.getRun(runId);
    return run ? taints.get(run) : undefined;
  };
  const provenance = {
    vault,
    thirdParty: (runId: string) => {
      const t = liveTaint(runId);
      return t?.tainted ? (t.source ?? hubStrings().thirdPartyText) : t?.guarded;
    },
    memoryHeld: (runId: string) => {
      const run = runs.getRun(runId);
      return run !== undefined && memoryRoute(run, runId) !== null;
    },
    // A line about its accesses never goes into a memory (D-141).
    accessLine: (line: string, agentId: string) => {
      const agent = team.get(agentId);
      return isAccessClaim(line, agent ? claimContext(accessDeps, agent) : {});
    },
  };
  const baseTools: MonstersTool[] = [
    ...vaultTools(vault).map((t) => {
      const source = NOTE_READERS[t.name];
      return withProvenance(scopedForOthers(source ? markExternal(t, source) : t), provenance);
    }),
    ...webTools,
    ...systemToolset,
    // The preview pane (D-075): given to the monsters that read notes (TeamService).
    previewShowTool({ vault, files: { get: (id) => files.get(id) ?? null } }),
  ];

  /** The vault's private folder, closed to the runs of a Telegram chat (D-107). */
  function privateFolder(): string {
    return join(vault.root, 'Privato');
  }
  const system: VaultActor = { agentId: 'system' };
  const readProfile = async (signal: AbortSignal): Promise<string | undefined> => {
    try {
      const note = await vault.read(
        { ...system, signal },
        { path: PROFILE_NOTE, max_chars: PROFILE_MAX_CHARS },
      );
      return note.content ?? undefined;
    } catch {
      return undefined;
    }
  };

  const noProvider = (err: unknown): string | undefined =>
    err instanceof UnknownProviderError ? hubStrings().noModel : undefined;

  /** Model that last served each agent in a run: the next turn or delegation starts there (AG-25). */
  const servedIn = new WeakMap<object, Map<string, ModelRef>>();
  const pinned = (run: object, agent: AgentDefinition): AgentDefinition => {
    const served = servedIn.get(run)?.get(agent.config.id);
    if (!served) return agent;
    const models = pinnedChain(agent.config.models, served);
    return { ...agent, config: { ...agent.config, models } };
  };
  const served = (run: object, agent: AgentDefinition, result: AgentRunResult) => {
    if (!result.model) return;
    let map = servedIn.get(run);
    if (!map) servedIn.set(run, (map = new Map<string, ModelRef>()));
    map.set(agent.config.id, result.model);
  };
  /** The user's request being worked on (`Conversation.request`), as text. */
  const requestOf = (c: Conversation): string | undefined => {
    const e = c.request ? log.get(c.request) : undefined;
    return e?.type === 'message' ? e.data.text : undefined;
  };
  // Lines of memory that wait for the user (review of 18/10, A2).
  const memoryProposals = new MemoryProposals({ log, team });
  /**
   * How the «Da ricordare:» lines of this run reach the memory (review of 18/10, A2, and of the
   * waves 3 and 4), or null for a run of the user's own words (written as they are):
   * - `draft`: a person who is not the user asked (D-107), or a chat of a Telegram group: every
   *   line waits for the user, since the memory reaches every later run of the monster;
   * - `marked`: a run of the user that read third-party text: the lines go by themselves with
   *   the mark (the prompt gives them as data), except those that name a site or an address or
   *   read as an order (`memoryLineNeedsReview`), which wait for the user.
   */
  const memoryRoute = (
    run: object,
    runId: string,
  ): { kind: 'draft' | 'marked'; source: string; tainted: boolean } | null => {
    const t = taintOf(run);
    if (t.guarded) return { kind: 'draft', source: t.guarded, tainted: true };
    if (isGroupThread(threadOfRun(log, runId))) {
      return t.tainted
        ? { kind: 'draft', source: t.source ?? hubStrings().thirdPartyText, tainted: true }
        : { kind: 'draft', source: hubStrings().telegramGroup, tainted: false };
    }
    if (t.tainted) {
      return { kind: 'marked', source: t.source ?? hubStrings().thirdPartyText, tainted: true };
    }
    return null;
  };
  /**
   * The «Da ricordare:» lines without those about permissions, connections and tools ("la
   * ricerca web è negata in modalità don't ask", 19/10): an event says what was left out.
   */
  const withoutAccessLines = (
    agent: AgentDefinition,
    lines: readonly string[],
    origin: { runId: string; parentId: string | null },
  ): string[] => {
    const ctx = claimContext(accessDeps, agent);
    const dropped = lines.filter((l) => isAccessClaim(l, ctx));
    if (dropped.length === 0) return [...lines];
    log.append({
      agent: 'system',
      runId: origin.runId,
      parentId: origin.parentId,
      type: 'instinct',
      data: {
        use: 'memory',
        action: 'memory_skipped',
        message: hubStrings().accessLinesSkipped(agent.config.name, dropped.length),
        subject: agent.config.id,
        details: { lines: dropped, reason: 'access_claim' },
      },
    });
    return lines.filter((l) => !dropped.includes(l));
  };
  /** «Da ricordare:» of a turn into the agent's MEMORY.md (AG-06); the result without it. */
  const remember = (
    agent: AgentDefinition,
    result: AgentRunResult,
    where: { run: object; runId: string; parentId?: string | null; signal: AbortSignal },
  ) =>
    keepMemoryFrom(result, async (all) => {
      const route = memoryRoute(where.run, where.runId);
      const origin = { runId: where.runId, parentId: where.parentId ?? null, signal: where.signal };
      // What it concluded about its accesses is not memory: the card says them at every run (D-141).
      const lines = withoutAccessLines(agent, all, origin);
      if (lines.length === 0) return;
      if (!route) return team.appendMemory(agent.config.id, lines, origin);
      const draft = route.kind === 'draft';
      const held = draft ? lines : lines.filter(memoryLineNeedsReview);
      const free = draft ? [] : lines.filter((l) => !memoryLineNeedsReview(l));
      // Marked: a run that reads them starts tainted and has them as data, not as its memory.
      if (free.length > 0)
        await team.appendMemory(agent.config.id, free, { ...origin, mark: true });
      if (held.length > 0) {
        // A draft for the user: confirmed, the lines are added (marked when tainted).
        await memoryProposals.propose(agent.config.id, held, {
          source: route.source,
          tainted: route.tainted,
          ...origin,
        });
      }
    });

  // Spending caps (D-070): what the providers report, in euros, per day and month.
  const usageClass = (provider: string, model: string, priced: boolean): UsageClass => {
    const spec = providerSpec(provider);
    if (HARNESS_PROVIDER_IDS.has(provider) || spec?.subscription || spec?.kind === 'harness') {
      return 'subscription';
    }
    if (spec?.local) return 'free';
    if (provider === 'openrouter') {
      return model.endsWith(':free') || model === 'openrouter/free' ? 'free' : 'paid';
    }
    if (spec?.paid && !priced) return 'unpriced';
    return 'paid';
  };
  /**
   * The price of a model that costs money, from its provider's list (F-A4, D-114):
   * a request whose provider reports no cost is counted with it. Free models and
   * subscriptions have none.
   */
  const priceOf = (ref: { provider: string; model: string }) => {
    const cls = usageClass(ref.provider, ref.model, false);
    return cls === 'paid' || cls === 'unpriced'
      ? windows.price(ref.provider, ref.model)
      : undefined;
  };
  /** The agent's chain can cost money (a subscription or free models never do). */
  const paidAgent = (id: string): boolean => {
    const agent = team.get(id);
    if (!agent || harnessOf(agent)) return false;
    return agent.config.models.some((m) => {
      const cls = usageClass(m.provider, m.model, true);
      if (cls !== 'paid' && cls !== 'unpriced') return false;
      return m.provider !== 'openrouter' || !settings.openrouter.freeOnly;
    });
  };
  const spend = new SpendMeter({
    log,
    state,
    settings: () => settings.spend,
    save: (next) => {
      patchSettingsFile(paths.home, { spend: next });
      settings.spend = next;
    },
    classify: usageClass,
    paidAgent,
    agents: () => team.list().map((a) => ({ id: a.config.id, name: a.config.name })),
    // The third level (D-097): each project's monsters and its own cap.
    projects: () =>
      team.activeProjects().map((p) => ({
        id: p.id,
        name: p.name,
        members: team.members(p.id).map((a) => a.config.id),
        caps: p.spend,
      })),
    // Paid models with no price: not counted, and the caps' cards say so (D-114).
    unpricedModels: () =>
      team.list().flatMap((a) =>
        paidAgent(a.config.id)
          ? a.config.models
              .filter((m) => usageClass(m.provider, m.model, false) === 'unpriced')
              .filter((m) => priceOf(m) === undefined)
              .map((m) => ({ agent: a.config.id, provider: m.provider }))
          : [],
      ),
    // Direct keys priced by OpenRouter's list: counted at an estimated cost, and they stop.
    estimatedModels: () =>
      team.list().flatMap((a) =>
        paidAgent(a.config.id)
          ? a.config.models
              .filter((m) => usageClass(m.provider, m.model, false) === 'unpriced')
              .filter((m) => priceOf(m) !== undefined)
              .map((m) => ({ agent: a.config.id, provider: m.provider }))
          : [],
      ),
    providerLabel: (id) => providerSpec(id)?.label ?? id,
  });
  const usage = new AgentUsage({
    log,
    spend,
    windows,
    classify: usageClass,
    planLimits: (id) => {
      const first = team.get(id)?.config.models[0]?.provider;
      if (first === 'claude-agent') return planLimits.view('claude');
      return first === 'codex' || first === 'chatgpt' ? planLimits.view('chatgpt') : null;
    },
    subscription: (id) => {
      const agent = team.get(id);
      const first = agent?.config.models[0];
      if (!agent || !first) return false;
      return (
        harnessOf(agent) !== undefined ||
        usageClass(first.provider, first.model, true) === 'subscription'
      );
    },
  });
  /** What each run has read and knows, shared by its agents (D-070). */
  const taints = new WeakMap<object, RunTaint>();
  /**
   * What the orchestrator's run knew when it wrote to a lead (`project_send`,
   * D-098), by the message's event: the lead's run starts from it.
   */
  const inheritedTaint = new Map<string, RunTaint>();
  /**
   * The orchestrator's run budget when it wrote to a lead (`project_send`, F-A6),
   * by the message's event: the lead's run counts its cost in that run's tree.
   */
  const inheritedBudget = new Map<string, RunBudget>();
  /**
   * The same, for work that starts again without its sender's live budget (requeued after a
   * restart, or by "Riprendi e continua"): rebuilt from the log, once per sending run, so the
   * work of one run keeps one tree (residual of F-A6).
   */
  const restoredBudgets = new Map<string, RunBudget>();
  const senderBudget = (eventId: string): RunBudget | undefined => {
    const live = inheritedBudget.get(eventId);
    if (live) return live;
    const m = log.get(eventId);
    if (m?.type !== 'message' || !m.data.from || !m.data.fromRun) return undefined;
    let b = restoredBudgets.get(m.data.fromRun);
    if (!b) {
      b = senderBudgetFromLog(log, m.data.fromRun, settings.limits);
      restoredBudgets.set(m.data.fromRun, b);
      while (restoredBudgets.size > 200) {
        restoredBudgets.delete(restoredBudgets.keys().next().value!);
      }
    }
    return b;
  };
  const taintOf = (run: object): RunTaint => {
    let t = taints.get(run);
    if (!t) taints.set(run, (t = new RunTaint()));
    return t;
  };
  /**
   * Where a draft of this run comes from when it is not only the user's (D-103): the third-party
   * text it read, or the person of a Telegram group who asked for it (`guarded`, D-107; review of
   * 18/10, M5). Undefined: the user's own request.
   */
  const draftTaintOf = (run: object): string | undefined => {
    const t = taintOf(run);
    return t.tainted ? (t.source ?? hubStrings().thirdPartyText) : t.guarded;
  };
  // The end event of a run says whether it was tainted, inherited taint too (D-103).
  runs.setEndFacts((r) => {
    const t = taints.get(r);
    if (!t?.tainted) return undefined;
    return { tainted: true, taintSource: (t.source ?? hubStrings().thirdPartyText).slice(0, 200) };
  });
  /** Any of these runs is tainted: a run still at work by its live taint, the others by the log. */
  const tainted = (runIds: Iterable<string>): boolean => {
    const ended: string[] = [];
    for (const id of new Set(runIds)) {
      const live = runs.getRun(id);
      if (live) {
        if (taints.get(live)?.tainted) return true;
      } else ended.push(id);
    }
    return ended.length > 0 && runsTainted(log, ended);
  };

  // The instinct (D-067): the quick decisions of the team, each use with its mode.
  const system1 = new System1({
    log,
    port: (use) => decisions.portFor(use),
    mode: (use) => decisions.mode(use),
  });
  const doneCheck = new DoneChecker(system1);
  const triage = new Triage(system1, log);
  const scorecard = new Scorecard({
    log,
    state,
    enabled: () => decisions.mode('scorecard') === 'on',
    freeOnly: () => settings.openrouter.freeOnly,
    agentName: (id) => team.get(id)?.config.name ?? id,
  });
  team.setRememberFilter(
    instinctRememberFilter(system1, log, (id) => {
      const a = team.get(id);
      return a ? { name: a.config.name, role: a.config.role } : undefined;
    }),
  );
  /**
   * Model tier the radiografia chose for the request of a run: the coordinator's own turns
   * follow it, and a delegation whose subtask got no level of its own (D-109).
   */
  const tierOfRun = new WeakMap<object, TierLevel>();
  /** Level that chose the model of a delegation (D-109), by its `delegation` event: read once. */
  const tierOfDelegation = new Map<string, TierLevel>();
  /** Agents whose first model failed in a run (a fallback served them): they stay where they landed. */
  const fellBackIn = new WeakMap<object, Set<string>>();
  /**
   * The chain of an agent for this turn: scorecard order, then the tier, then the pin.
   * A delegation (`subtask`) is a new piece of work with its own level (D-109): the tier
   * moves its chain even after the monster worked in the run, unless a fallback served it.
   */
  const chainFor = (
    run: object,
    agent: AgentDefinition,
    runId: string,
    subtask?: { level: TierLevel | undefined; delegation: string; own: boolean },
  ): AgentDefinition => withAutoEffort(chainForLevel(run, agent, runId, subtask));
  /**
   * "Automatica" (D-110): every link of the chain gets the effort of its model (Sonnet Medio,
   * Opus Alto), so the level that moves a model also moves the effort. A monster outside
   * "Automatica" keeps its chain as it is.
   */
  const withAutoEffort = (agent: AgentDefinition): AgentDefinition =>
    agent.config.autoModels
      ? {
          ...agent,
          config: {
            ...agent.config,
            models: agent.config.models.map((m) => {
              const effort = autoEffort(m.model);
              return effort ? { ...m, effort } : m;
            }),
          },
        }
      : agent;
  const chainForLevel = (
    run: object,
    agent: AgentDefinition,
    runId: string,
    subtask?: { level: TierLevel | undefined; delegation: string; own: boolean },
  ): AgentDefinition => {
    const ranked = scorecard.order(agent, runId);
    const level = subtask ? subtask.level : tierOfRun.get(run);
    // The model that served the run stays first: the tier never moves it (cache, `openrouter/free`).
    const stays = (subtask ? fellBackIn : servedIn).get(run)?.has(agent.config.id) ?? false;
    if (level && hasTiers(ranked.config.models, !!agent.config.autoModels) && !stays) {
      const moved = tieredChain(
        ranked.config.models,
        level,
        settings.openrouter.freeOnly,
        !!agent.config.autoModels,
      );
      const chain = moved ?? ranked.config.models;
      const first = chain[0]!;
      // Logged for every level (also when the base already fits): the receipt says why (D-093).
      log.append({
        agent: 'system',
        runId,
        parentId: subtask?.delegation ?? null,
        type: 'instinct',
        data: {
          use: 'tier',
          action: 'tier',
          message: hubStrings().tier(!!subtask?.own, level, agent.config.name, first.model),
          subject: agent.config.id,
          details: {
            level,
            model: `${first.provider}:${first.model}`,
            moved: moved !== null,
            // The effort the model works at in "Automatica" (D-110).
            ...(agent.config.autoModels && autoEffort(first.model)
              ? { effort: autoEffort(first.model) }
              : {}),
            // Whose level: the subtask's own (Jev on the brief) or the request's (D-109).
            ...(subtask
              ? { delegation: subtask.delegation, from: subtask.own ? 'subtask' : 'request' }
              : {}),
          },
        },
      });
      const tiered = moved ? { ...ranked, config: { ...ranked.config, models: moved } } : ranked;
      if (!subtask) return pinned(run, tiered);
      // The level chose this delegation's model: its event and the receipt say it.
      tierOfDelegation.set(subtask.delegation, level);
      return tiered;
    }
    return pinned(run, ranked);
  };
  const guardFor = (agent: AgentDefinition, run: { id: string }, parentId?: string | null) =>
    new InstinctGuard({
      system1,
      log,
      questions,
      rules: () => gate.rules,
      agent: { id: agent.config.id, name: agent.config.name },
      runId: run.id,
      ...(parentId !== undefined ? { parentId } : {}),
      containsSecret: (text) => log.redactor.containsKnown(text),
      taint: taintOf(run),
      // Other programs that act wait for the user when a person of a Telegram chat asks (D-114).
      othersAsk: () => othersAsk(run.id),
      // A click in the browser is read from the page's snapshot, not from the model's words (D-131).
      browserLabel: (ref) => mcp.browserLabel(ref),
      // Where a tool of another program may write a file without a card (D-092).
      writableFolders: () => [
        ...team
          .permissionsFor(agent.config.id)
          .folders.filter((f) => f.write)
          .map((f) => f.path),
        agentWorkspace(paths.home, agent.config.id),
      ],
      // A run that read third-party text asks before writing in a project's folder (B1).
      projectFolders,
      // Who could see the card: an automation, a chat with other people, nothing open (D-142).
      unseen: () => {
        if (automationRunOf(log, run.id)) return 'automation';
        if (othersAsk(run.id)) return 'others';
        const telegramOn = telegram.view().status === 'online' && telegram.users().length > 0;
        return appPresence() || telegramOn ? undefined : 'closed';
      },
    });
  const watcherFor = (
    agent: AgentDefinition,
    runId: string,
    goal: string,
    signal: AbortSignal,
    parentId?: string | null,
  ) =>
    new StuckWatcher({
      system1,
      log,
      agent: { id: agent.config.id, name: agent.config.name },
      runId,
      ...(parentId !== undefined ? { parentId } : {}),
      goal,
      signal,
    });
  const asText = (m: { content: unknown }) =>
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  /** A change to CLAUDE.md or AGENTS.md of a project's folder, proposed to the user (D-113). */
  const docsToolFor = (
    agent: AgentDefinition,
    run: Parameters<typeof docsProposeTool>[0]['run'],
  ) =>
    agent.config.tools.includes(DOCS_PROPOSE)
      ? [
          docsProposeTool({
            run,
            self: agent,
            team,
            proposals: docsProposals,
            userName: settings.userName,
            taint: () => draftTaintOf(run),
          }),
        ]
      : [];

  const execute = async (c: Conversation, batch: InboxItem[]): Promise<TurnOutcome> => {
    const { run } = c;
    const request = batch.map((b) => b.text).join('\n\n');
    // Messages without an addressee are the orchestrator's; a lead coordinates its project (D-097).
    const isOrchestrator = c.agent.config.kind === 'orchestrator';
    const coordinator = coordinates(c.agent.config);
    const squadId = team.projectOf(c.agent.config.id)?.id;
    /** Names of monsters and projects (`project:<id>`), for the lines of the projects. */
    const nameOf = (id: string) =>
      id.startsWith('project:')
        ? (team.project(id.slice('project:'.length))?.name ?? id.slice('project:'.length))
        : (team.get(id)?.config.name ?? id);
    // A run of an automation (D-094): its own limits, its giro as history, not the chat.
    const auto = c.automation;
    // A run of the Telegram chat of a dedicated bot (D-107): that chat as history, never the
    // user's profile, `Privato/` or the God's rights (the bot's monster is never the God).
    const thread = c.thread;
    if (thread && isOrchestrator) {
      return { status: 'failed', error: hubStrings().onlyMainBot(c.agent.config.name) };
    }
    const ownRuns = auto
      ? new Set(auto.runs)
      : thread
        ? // The latest runs of the chat are enough for its latest turns.
          new Set(runsOfThread(log, thread).slice(-THREAD_RUNS))
        : undefined;
    // One budget per run: every turn and every delegated agent of the run count. Work sent by
    // the orchestrator (`project_send`) has its own limits and counts its cost in the sender's tree (F-A6).
    const sender = batch.map((b) => senderBudget(b.eventId)).find((b) => b !== undefined);
    for (const b of batch) inheritedBudget.delete(b.eventId);
    const budget = runBudget(
      run,
      auto?.limits ? { ...settings.limits, ...auto.limits } : settings.limits,
      sender,
    );
    budget.spendCheck ??= (id) => spend.stopReason(id);
    const exclude = new Set(batch.flatMap((b) => [b.eventId, ...(b.related ?? [])]));
    // The latest turns as they are: for the radiografia and the user's known sites.
    const turns = conversationTurns(log, questions, {
      agentId: c.agent.config.id,
      isOrchestrator,
      exclude,
      turns: settings.conversationTurns,
      files: (ids) => files.many(ids),
      names: nameOf,
      ...(ownRuns ? { runs: ownRuns } : {}),
    });
    const history = mergeTurns(turns);
    while (history[0] && history[0].role !== 'user') history.shift();
    const attachedIds = batch.flatMap((b) => b.attachments ?? []);
    // A document just uploaded may still be in the extraction worker (D-085): its text first.
    await files.ready(attachedIds);
    const attached = sourcesOf(attachedIds);
    const firstModel = c.agent.config.models[0];
    const free = isFreeChain(c.agent.config.models);
    const hasWeb = c.agent.config.tools.some((t) => t.startsWith('web_'));
    // The squad of this monster: the Squadra personale, or its project (D-097).
    const members = team.members(squadId).filter((a) => a.config.id !== c.agent.config.id);
    // The radiografia of the request runs with the memory and the profile: no wait of its own.
    // What the monster reads of the conversation: the summary of the older turns, then the latest.
    // Nothing is written here: the summary is prepared after a turn, for the next one.
    const window = firstModel ? contextWindow(firstModel) : undefined;
    const compacted = compactor.history({
      agent: c.agent,
      isOrchestrator,
      exclude,
      files: (ids) => files.many(ids),
      names: nameOf,
      request,
      window,
      fixedTokens: fixedContextTokens(log, c.agent.config.id),
      ...(ownRuns ? { runs: ownRuns } : {}),
    });
    const [memory, profile, xray] = await Promise.all([
      team.memory(c.agent.config.id, run.signal),
      // "Chi è lui per voi" stays out of a chat with other people (D-107).
      thread ? Promise.resolve(undefined) : readProfile(run.signal),
      triage
        .run({
          agent: c.agent,
          members: coordinator ? members.filter((a) => a.config.kind === 'subagent') : [],
          request,
          history: history.map(asText),
          runId: run.id,
          parentId: batch[0]?.eventId ?? null,
          signal: run.signal,
          tier:
            !tierOfRun.has(run) &&
            [c.agent, ...members].some((a) => hasTiers(a.config.models, !!a.config.autoModels)),
          web: free && hasWeb,
          rare: free && !needsRareTools(request),
          rules: gate.rules,
        })
        .catch((err: unknown): TriageOutcome => {
          if (run.signal.aborted) throw err;
          return {};
        }),
    ]);
    // Medium too: the request has its level, the base stays (D-093).
    if (xray.tier && !tierOfRun.has(run)) tierOfRun.set(run, xray.tier);
    // The user's own words, the profile and the memory: their sites are known, their text stays here.
    const taint = taintOf(run);
    // Only the user's own words: an agent's earlier reply may quote a hostile page, and a
    // message a monster wrote (`project_send`) or a lead's report is not the user's (D-098).
    // The objective of an automation a monster proposed is that monster's text until the user
    // rewrites it (D-103): never the user's words, and tainted if its proposer had read terzi.
    const objectiveFrom = auto ? automations.objectiveFrom(auto.automationId) : undefined;
    // A person of a Telegram group is not the user: only the paired account's words count (D-107).
    const userMessage = (id: string) =>
      isUserWords(log.get(id), { objectiveFromMonster: objectiveFrom !== undefined });
    // CLAUDE.md and AGENTS.md of the project's folder reach the prompt as data, never as the
    // user's words; changed since the user approved them, they may carry anything (D-103).
    const squadProject = squadId ? team.project(squadId) : undefined;
    if (squadProject && projectDocsChanged(squadProject)) {
      taint.taint(hubStrings().projectDocsChanged);
    }
    if (objectiveFrom?.tainted) {
      taint.taint(hubStrings().automationAfter(nameOf(objectiveFrom.agent)));
    }
    taint.known(
      [
        ...batch.filter((b) => userMessage(b.eventId)).map((b) => b.text),
        ...turns.filter((t) => t.role === 'user' && userMessage(t.id)).map((t) => t.content),
      ].join('\n'),
    );
    // A person of a Telegram group (not the user) asks: their words are no known sites, and the
    // leak checks of a tainted run are on, without tainting it (D-107).
    // The reason names the person: a draft of this run says whose request it was (review of
    // 18/10, M5). The name is theirs to choose: no brackets, controls or invisible characters.
    const stranger = (id: string): string | undefined => {
      const e = log.get(id);
      if (e?.type !== 'message' || e.data.telegram === undefined || e.data.telegram.owner) {
        return undefined;
      }
      const name = e.data.telegram.sender.name
        .replace(/[\p{C}\p{Zl}\p{Zp}[\]()<>`*_]/gu, '')
        .trim()
        .slice(0, 40);
      return hubStrings().strangerRequest(name);
    };
    for (const id of [...batch.map((b) => b.eventId), ...turns.map((t) => t.id)]) {
      const reason = stranger(id);
      if (reason) taint.guard(reason);
    }
    // A message of the orchestrator carries what its run had read and knew (D-098).
    for (const b of batch) {
      const e = log.get(b.eventId);
      if (e?.type !== 'message' || !e.data.from) continue;
      const known = inheritedTaint.get(e.id);
      inheritedTaint.delete(e.id);
      if (known) taint.absorb(known);
      // After a restart the snapshot is gone: tainted unless its run surely read nothing.
      else if (!e.data.fromRun || tainted([e.data.fromRun])) {
        taint.taint(hubStrings().messageFrom(nameOf(e.data.from)));
      }
    }
    // A lead's report written after third-party text may carry it (as a summary, D-082).
    const reportRuns = turns
      .filter((t) => t.runId && log.get(t.id)?.type === 'project_report')
      .map((t) => t.runId!);
    if (reportRuns.length > 0 && tainted(reportRuns)) taint.taint(hubStrings().projectReport);
    // The monster's own recent answers written after third-party text may carry an instruction
    // of it (as a summary does, D-082): the run that reads them starts tainted (D-103).
    const answerRuns = turns
      .filter((t) => t.role === 'assistant' && t.runId && t.runId !== run.id)
      .map((t) => t.runId!);
    if (answerRuns.length > 0 && tainted(answerRuns)) taint.taint(hubStrings().recentConversation);
    // A summary of runs that read third-party text may carry an instruction of theirs (D-082).
    if (compacted.tainted) taint.taint(hubStrings().conversationSummary);
    if (profile) {
      // A profile a run wrote after third-party text (review of 18/10, A2): data, not the user's
      // words, and the run starts tainted.
      if (vault.index.pathsWithProp([PROFILE_NOTE], THIRD_PARTY_PROP).length > 0) {
        taint.taint(hubStrings().profileAfter);
      } else taint.known(profile);
      taint.sensitive(profile, 'profile');
    }
    // The memory is not the user's words: its sites are not known (a page or a person of a group
    // may have had a line written there, review of 18/10, A2). A line marked as third-party
    // text makes the run start tainted, as the turns written after a page do (D-103).
    if (memory) {
      taint.sensitive(memory, 'profile');
      if (memoryTainted(memory)) taint.taint(hubStrings().memoryAfter);
    }
    // The user's files are the user's data, like the notes: their text must not leave in a
    // query. A file a monster or a tool made carries third-party text: it taints the run.
    for (const f of attached) {
      if (f.meta.source !== 'user') taint.taint(`file:${f.meta.name}`);
      const text = f.text()?.text;
      if (text) taint.sensitive(text, 'note');
    }
    // Tools of this request (AG-07): the rare ones also when the instinct says so,
    // the web not for a free chain when the request surely does not need it.
    const rare =
      xray.rareTools !== undefined && xray.rareTools >= BANDS.rare.add ? () => true : undefined;
    // Taking away becomes deferring (D-134): the rare tools, the pages and, for a request that
    // surely does not need it, the web wait for `tools_search` on a free chain. The card names
    // them and a call by name loads them: never "non ho il web" for a tool the monster has.
    const turn = withTurnDeferrals(chainFor(run, c.agent, run.id), request, rare);
    const agent = withoutClosedTools(turn.agent, run.id);
    const deferOwn = new Map(turn.deferred);
    if (artifactDeferred(agent, request)) deferOwn.set(ARTIFACT_TOOL, 'pagine');
    if (free && hasWeb && xray.needsWeb !== undefined && xray.needsWeb < BANDS.web.drop) {
      for (const t of agent.config.tools) if (t.startsWith('web_')) deferOwn.set(t, 'web');
      log.append({
        agent: 'system',
        runId: run.id,
        type: 'instinct',
        data: {
          use: 'tools',
          action: 'tools',
          message: hubStrings().webToolsWait(agent.config.name),
          subject: agent.config.id,
          confidence: xray.needsWeb,
        },
      });
    }
    const runTier = tierOfRun.get(run);
    const tools = coordinator
      ? [
          ...baseTools,
          // The orchestrator's tools of the projects (D-097): only while a project is active.
          ...(isOrchestrator && team.activeProjects().length > 0
            ? projectTools({
                self: agent,
                team,
                projects,
                run,
                budget,
                // A report read now carries what the lead's run had read (D-103).
                onReports: (ids) => {
                  if (tainted(ids)) taintOf(run).taint(hubStrings().projectReport);
                },
                onSent: (id) => {
                  inheritedTaint.set(id, taintOf(run).clone());
                  inheritedBudget.set(id, budget);
                  // Never read (the lead was archived meanwhile): not kept forever.
                  while (inheritedTaint.size > 500) {
                    inheritedTaint.delete(inheritedTaint.keys().next().value!);
                  }
                  while (inheritedBudget.size > 500) {
                    inheritedBudget.delete(inheritedBudget.keys().next().value!);
                  }
                },
              })
            : []),
          // Drafts of the capi (D-098): never a project or an automation without the user's tap.
          ...(isOrchestrator
            ? [
                projectProposeTool({
                  run,
                  self: agent,
                  projects,
                  userName: settings.userName,
                  taint: () => draftTaintOf(run),
                }),
              ]
            : []),
          ...(agent.config.tools.includes(AUTOMATION_PROPOSE)
            ? [
                automationProposeTool({
                  run,
                  self: agent,
                  team,
                  automations,
                  userName: settings.userName,
                  taint: () => draftTaintOf(run),
                }),
              ]
            : []),
          ...docsToolFor(agent, run),
          // A capo asks the user for an access a monster of its squad lacks (D-130).
          ...(agent.config.tools.includes(ACCESS_REQUEST_TOOL)
            ? [
                access.tool({
                  run,
                  self: agent,
                  // A harness never holds the call (D-078): the request parks, the turn ends.
                  waitMs: () => (harnessOf(agent) ? 0 : (options.askWaitMs ?? ASK_USER_WAIT_MS)),
                }),
              ]
            : []),
          ...teamTools({
            run,
            self: agent,
            team,
            // `delegate` reaches its own squad only (D-097).
            members: () => team.members(squadId),
            log,
            questions,
            gate,
            budget,
            currentRequest: () => c.request,
            requestText: () => requestOf(c),
            userName: settings.userName,
            proposals: squad,
            projectName: team.projectOf(agent.config.id)?.name,
            doneCheck,
            tier: (delegation) => {
              const own = tierOfDelegation.get(delegation);
              tierOfDelegation.delete(delegation);
              const level = own ?? runTier;
              return level ? { level, chose: own !== undefined } : undefined;
            },
            // A harness never holds ask_user (D-078): the question parks, the turn ends.
            askWaitMs: () => (harnessOf(agent) ? 0 : (options.askWaitMs ?? ASK_USER_WAIT_MS)),
            runSubagent: async (p) => {
              // The level of this subtask (D-109): one question on the brief the coordinator
              // wrote (at most the use's timeout); without an answer, the request's level.
              const tiered = hasTiers(p.agent.config.models, !!p.agent.config.autoModels);
              const own = tiered
                ? await triage.subtaskTier({
                    agent: p.agent,
                    subtask: p.subtask,
                    runId: p.run.id,
                    parentId: p.parentId,
                    signal: p.scope.signal,
                  })
                : undefined;
              // Rare tools on a free chain wait for `tools_search` (D-134), never taken away.
              const turnOfSub = withTurnDeferrals(
                chainFor(p.run, p.agent, p.run.id, {
                  level: own ?? tierOfRun.get(p.run),
                  delegation: p.parentId,
                  own: own !== undefined,
                }),
                p.brief.goal,
              );
              const sub = withoutClosedTools(turnOfSub.agent, p.run.id);
              const subDeferred = new Map(turnOfSub.deferred);
              if (artifactDeferred(p.agent, p.brief.goal)) {
                subDeferred.set(ARTIFACT_TOOL, 'pagine');
              }
              // The files of the capo's conversation, when its brief names one by id; in a
              // Telegram chat, only that chat's (review of 18/10, B5).
              const fileScope: FileReadScope = thread
                ? { agents: [], runId: p.run.id, runs: ownRuns ?? new Set() }
                : { agents: [p.agent.config.id, c.agent.config.id], runId: p.run.id };
              // A native monster loads MCP tools when it needs them (C.2): all of them.
              const extraTools = [
                ...(await mcp.toolsFor(p.agent, p.scope.signal, {
                  deferred: !harnessOf(sub),
                  unbounded: harnessOf(sub)?.id === 'claude-agent',
                })),
                ...artifactFor(p.agent, p.brief.goal, p.run),
                ...(briefNamesFile(p.brief, fileScope) ? [fileReadFor(fileScope)] : []),
              ];
              const memory = await team.memory(p.agent.config.id, p.scope.signal);
              // The delegated monster's own memory: a marked line taints the run (A2).
              if (memoryTainted(memory)) {
                taintOf(p.run).taint(hubStrings().memoryOfAfter(p.agent.config.name));
              }
              // A fallback served it (the first model failed): later delegations start there.
              const offFallback = log.subscribe((e) => {
                if (
                  e.type === 'error' &&
                  e.data.code === 'provider_fallback' &&
                  e.runId === p.run.id &&
                  e.agent === p.agent.config.id
                ) {
                  let set = fellBackIn.get(p.run);
                  if (!set) fellBackIn.set(p.run, (set = new Set()));
                  set.add(p.agent.config.id);
                }
              });
              const result = await runAny({
                agent: sub,
                task: p.brief,
                tools: [...baseTools, ...docsToolFor(sub, p.run)],
                extraTools,
                // After `toolsFor`: a server that just failed to start counts too.
                unlinked: mcp.unlinkedFor(p.agent),
                ...(subDeferred.size > 0 ? { deferOwn: subDeferred } : {}),
                card: cardOf(p.agent),
                signal: p.scope.signal,
                scope: p.scope,
                log,
                runId: p.run.id,
                parentId: p.parentId,
                providers,
                budget,
                memory,
                ...(profile ? { profile } : {}),
                ...(p.onFinalAnswer ? { onFinalAnswer: p.onFinalAnswer } : {}),
                guard: guardFor(p.agent, p.run, p.parentId),
                watcher: watcherFor(p.agent, p.run.id, p.brief.goal, p.scope.signal, p.parentId),
              }).finally(offFallback);
              served(p.run, p.agent, result);
              // The report reaches the orchestrator without its memory section.
              return remember(p.agent, result, {
                run: p.run,
                runId: p.run.id,
                parentId: p.parentId,
                signal: p.scope.signal,
              });
            },
          }),
        ]
      : [...baseTools, ...docsToolFor(agent, run)];
    // Files read again with `file_read`: an image goes back to the model with the next step.
    const reshown: AttachmentSource[] = [];
    // In a Telegram chat anyone there writes the history: only real attachments of its
    // messages turn `file_read` on, never the words of the mark (review of 18/10, B5).
    const pastFiles = thread
      ? turns.some((t) => {
          const e = log.get(t.id);
          return e?.type === 'message' && (e.data.attachments?.length ?? 0) > 0;
        })
      : [compacted.summary ?? '', ...compacted.history.map(asText)].some((t) =>
          t.includes(PAST_ATTACHMENT_MARK),
        );
    const fileRead =
      attached.length > 0 || pastFiles
        ? [
            fileReadFor(
              thread
                ? { agents: [], runId: run.id, runs: ownRuns ?? new Set() }
                : { agents: [c.agent.config.id], runId: run.id },
              harnessOf(agent)
                ? undefined
                : (meta) => {
                    const sight = sightOf(agent);
                    if (meta.kind === 'image' ? !sight.images : !sight.pdf) return false;
                    reshown.push(...sourcesOf([meta.id]));
                    return true;
                  },
            ),
          ]
        : [];
    try {
      const result = await runAny({
        agent,
        task: request,
        history: compacted.history,
        ...(compacted.summary ? { summary: compacted.summary } : {}),
        tools,
        extraTools: [
          ...(await mcp.toolsFor(agent, run.signal, {
            deferred: !harnessOf(agent),
            unbounded: harnessOf(agent)?.id === 'claude-agent',
          })),
          ...artifactFor(agent, request, run),
          ...fileRead,
        ],
        // After `toolsFor` (the key above): a server that just failed to start counts too.
        unlinked: mcp.unlinkedFor(agent),
        ...(deferOwn.size > 0 ? { deferOwn } : {}),
        card: cardOf(agent),
        signal: run.signal,
        scope: run,
        log,
        runId: run.id,
        providers,
        budget,
        memory,
        ...(profile ? { profile } : {}),
        ...(coordinator && xray.hint ? { hint: xray.hint } : {}),
        inbox: () => [
          ...c.inbox.splice(0).map((i) => {
            const asked = stranger(i.eventId);
            if (asked) taint.guard(asked);
            const more = sourcesOf(i.attachments ?? []);
            for (const f of more) {
              if (f.meta.source !== 'user') taint.taint(`file:${f.meta.name}`);
              const text = f.text()?.text;
              if (text) taint.sensitive(text, 'note');
            }
            return more.length > 0
              ? { text: i.text, parts: attachmentParts(more, sightOf(agent)) }
              : i.text;
          }),
          ...(reshown.length > 0
            ? [
                {
                  text: hubPrompts().reopened,
                  parts: attachmentParts(reshown.splice(0), sightOf(agent)),
                },
              ]
            : []),
        ],
        ...(attached.length > 0 ? { files: attached } : {}),
        guard: guardFor(agent, run),
        watcher: watcherFor(agent, run.id, request, run.signal),
        // A question left in the text gets one reminder per run to use ask_user.
        ...(coordinator
          ? {
              onFinalAnswer: finalQuestionHook(
                log,
                { agentId: agent.config.id, runId: run.id, signal: run.signal },
                system1,
              ),
            }
          : {}),
      });
      served(run, c.agent, result);
      // The chat keeps the «Da ricordare:» line (the user sees what is saved); the memory gets it.
      await remember(c.agent, result, { run, runId: run.id, signal: run.signal });
      writeReceipt(c, batch, request, result.status);
      // The summary for the next turn, off the path of this one (D-082); a Telegram chat
      // keeps its latest turns only (D-107).
      if (!thread)
        void compactor.prepare({
          agent: c.agent,
          isOrchestrator,
          files: (ids) => files.many(ids),
          names: nameOf,
          runId: run.id,
          window,
          fixedTokens: fixedContextTokens(log, c.agent.config.id),
          // The kill switch and the closing of the core stop it.
          signal: AbortSignal.any([summaries.signal, runs.signal]),
          scope: () => {
            try {
              return runs.serviceScope(`summary:${c.agent.config.id}:${run.id}`);
            } catch {
              return undefined;
            }
          },
        });
      if (result.status === 'failed') return { status: 'failed', error: result.error ?? 'failed' };
      return { status: 'ok' };
    } catch (err) {
      const friendly = noProvider(err);
      if (!friendly) throw err;
      log.append({
        agent: agent.config.id,
        runId: run.id,
        type: 'error',
        data: { code: 'no_provider', message: friendly },
      });
      return { status: 'failed', error: friendly };
    }
  };

  /** The receipt of the turn (D-067), written by the core from the log. */
  const writeReceipt = (
    c: Conversation,
    batch: InboxItem[],
    request: string,
    status: AgentRunResult['status'],
  ) => {
    const first = batch[0]?.eventId;
    if (!first) return;
    try {
      const data = buildReceipt({
        log,
        runId: c.run.id,
        requestEventId: first,
        request,
        agent: c.agent.config.id,
        status: status === 'failed' ? 'failed' : status === 'aborted' ? 'aborted' : 'completed',
        agentName: (id) => team.get(id)?.config.name ?? id,
      });
      log.append({ agent: 'system', runId: c.run.id, parentId: first, type: 'receipt', data });
    } catch (err) {
      log.append({
        agent: 'system',
        runId: c.run.id,
        type: 'error',
        data: { code: 'receipt', message: hubStrings().receiptFailed((err as Error).message) },
      });
    }
  };

  const hasModelProvider = () => providers.list().some((p) => p.kind === 'model');
  const canRun = (agent: AgentDefinition) =>
    harnessOf(agent) !== undefined ||
    agent.config.models.some(
      (m) => providers.has(m.provider) && providers.get(m.provider).kind === 'model',
    );
  // A message typed while the agent waits on a blocking question answers it.
  const answerBlocking = (
    runId: string,
    text: string,
    channel: Channel,
    notOwner = false,
  ): string | null => {
    const open = questions.openBlocking(runId).at(-1);
    if (!open) return null;
    // A question with options takes only a message that reads as a choice: anything else is a
    // message for the monster (review of 18/10: "aspetta, prima scrivi a Marco" was a "no").
    // The brake reads the choice the same way (`pickedOption`): a message that picks neither
    // "Sì, procedi" nor "No, non farlo" for sure is not its answer (review of 18/10, item 3).
    // A request of an access (D-130) is read the same way: only the user's tap or a sure "sì".
    const brake = questions.ownerOnly(open.id);
    // A card of the brake is the user's in person: a message through the CLI token (which a
    // monster with the terminal can read) is a message, never its answer (review of 18/10, M1).
    if (brake && (notOwner || channel === 'cli')) return null;
    const optionId = brake ? pickedOption(open, text) : undefined;
    if (brake ? optionId === undefined : !readsAsAnswer(open, text)) return null;
    try {
      questions.answer(open.id, optionId !== undefined ? { optionId, text } : { text }, channel);
      return open.id;
    } catch {
      return null;
    }
  };
  /** Answers the dispatcher routes itself (a message that answered a parked question). */
  const routedBySend = new Set<string>();
  const answerEventOf = (q: Question) =>
    log
      .query({ runId: q.runId, type: 'answer', order: 'desc', limit: 20 })
      .find((e) => e.type === 'answer' && e.data.questionId === q.id);
  // A message to a monster that waits on a parked question is its answer (D-078):
  // the new run starts from the question and the answer. Only the latest
  // question links, and only within a window from when it was asked (D-079):
  // later the message is a new request, and the run reads one line about the
  // question still open, so the monster decides; the card stays answerable.
  const answerParked: DispatcherOptions['answerParked'] = (agentId, text, channel, messageId) => {
    // A question of an automation's run is answered from its card, not from the chat (D-094);
    // one of a Telegram chat's run, there (D-107).
    const q = questions
      .parked(agentId)
      .find((x) => x.blocking && !automationRunOf(log, x.runId) && !threadOfRun(log, x.runId));
    if (!q) return null;
    // A request of an access (D-130) is granted from its card only: the core applies it before
    // the monster's next run, and a message could not wait for that.
    if (questions.ownerOnly(q.id)) {
      const user = settings.userName?.trim() || hubPrompts().theUser;
      const card = accessStrings();
      return { note: hubPrompts().accessOpen(user, card.grant, card.deny) };
    }
    const window = options.parkedAnswerWindowMs ?? PARKED_ANSWER_WINDOW_MS;
    // A question with options takes only a message that picks one: anything else is a new
    // request, with the same line (review of 16/10: Haiku asked, the next request became
    // "Hai risposto: …").
    if (Date.now() - q.createdAt > window || !readsAsAnswer(q, text)) {
      const user = settings.userName?.trim() || hubPrompts().theUser;
      const asked = q.question.replace(/\s+/g, ' ').trim();
      return {
        note: hubPrompts().questionOpen(
          user,
          asked.length > 300 ? `${asked.slice(0, 299)}…` : asked,
        ),
      };
    }
    routedBySend.add(q.id);
    try {
      const answered = questions.answer(q.id, { text }, channel, undefined, messageId);
      const event = answerEventOf(answered);
      return {
        questionId: q.id,
        text: answerText(answered, answered.answer ?? { text }),
        related: event ? [event.id] : [],
      };
    } catch {
      return null;
    } finally {
      routedBySend.delete(q.id);
    }
  };
  // When a run ends, its open questions are parked or expire: never left open with nothing behind.
  const settleRun = (runId: string) => questions.settleRun(runId);
  const dispatcher = new Dispatcher({
    log,
    runs,
    team,
    execute,
    canRun,
    answerBlocking,
    answerParked,
    settleRun,
    onAttachments: (ids, messageId, agentId) => files.linkMessage(ids, messageId, agentId),
  });

  // Projects (D-097): the one TeamManager makes their monsters; their messages go to the lead.
  const projects = new ProjectService({
    team,
    squad,
    vault,
    log,
    dispatcher,
    spend,
    runs,
    forbiddenFolders: () => permissions.forbiddenFolders(),
    automations: () => automations,
    projectsDir: () => defaultProjectsDir(paths.home),
    connections: () => ({
      mcp: mcp.view().servers.map((s) => s.name),
      claude: claudeConnections
        .view()
        .connections.filter((c) => c.added)
        .map((c) => ({ id: c.id, name: MCP_CATALOG.find((e) => e.id === c.id)?.name ?? c.id })),
    }),
    // A new project starts with what the whole team has (D-129).
    teamConnections: () => ({
      mcp: mcp
        .view()
        .servers.filter((s) => s.agents.includes('*'))
        .map((s) => s.name),
      claude: claudeConnections
        .view()
        .connections.filter((c) => c.added && c.agents.includes('*'))
        .map((c) => c.id),
    }),
  });

  // CLAUDE.md and AGENTS.md of the projects' folders: proposed by the monsters, applied by the user (D-113).
  const docsProposals = new DocsProposals({ log, team, projects });

  // Automations (D-094): their runs are conversations of their own, the timers start with `start()`.
  const automations = new AutomationService({
    dir: join(paths.home, AUTOMATIONS_DIR),
    log,
    runs,
    team,
    dispatcher,
    questions,
    canRun,
    usdToEur: () => settings.spend.usdToEur,
    telegram: { announce: (kind, text, meta) => telegram.announce(kind, text, meta) },
    ...options.automations,
  });

  // An answer no wait received (a non-blocking question, a parked one, one a
  // harness left behind ending its turn) reaches its run if it is still
  // active; otherwise it starts a new run of the agent that asked (D-078).
  // A granted request of an access is applied first (D-130): its listener comes before this one.
  const offAccess = access.attach();
  const offAnswer = questions.onAnswer((q, { woke }) => {
    if (woke || !q.answer || routedBySend.has(q.id)) return;
    const answerEvent = answerEventOf(q);
    if (!answerEvent) return;
    const answer = q.answer;
    const go = (outcome: string) => {
      const item = {
        eventId: answerEvent.id,
        text: `${answerText(q, answer)}${outcome ? `\n${outcome}` : ''}`,
      };
      if (dispatcher.deliver(q.runId, item)) return;
      // A question of a run of an automation goes on in the automation (D-094).
      if (automations.continueAfterAnswer(q, item)) return;
      // A question of a Telegram chat's run goes on in that chat (D-107).
      dispatcher.resume(q.from, item, threadOfRun(log, q.runId) ?? undefined);
    };
    // The monster goes on once the core has applied what the user granted, and reads how it went.
    if (access.isRequest(q.id)) void access.settled(q.id).then(go, () => go(''));
    else go('');
  });

  // A stopped run takes its open questions with it. A run cut by the closing
  // of the core leaves them waiting for the user, as after a crash (D-078).
  const offLog = log.subscribe((e) => {
    if (e.type !== 'run' || e.data.status !== 'aborted' || !e.runId) return;
    if (e.data.reason === 'shutdown') {
      questions.expireOpen({ runId: e.runId, kind: 'brake' }, 'restart');
      for (const q of questions.list({ status: 'open', runId: e.runId })) {
        questions.park(q.id, 'restart');
      }
      return;
    }
    questions.expireOpen({ runId: e.runId }, 'run_aborted');
  });

  // Kill switch: queued provider requests, open questions and queued messages.
  const offKill = runs.onKill((reason) => {
    providers.clearQueues(new KilledError('global', reason));
    questions.expireOpen({}, 'kill');
    dispatcher.reset();
  });

  // Drafts (D-098): new monsters, projects and automations proposed, in one list.
  const drafts = new DraftService({
    team,
    squad,
    projects,
    automations: () => automations,
    docs: docsProposals,
    memory: memoryProposals,
  });

  const detachTeam = team.attach();
  // Monsters that wait for an answer since before this start (D-078).
  for (const q of questions.parked()) team.noteWaiting(q.from, q.id, q.question);

  // Telegram (M2.6): a client of the hub inside the core process, so the kill
  // switch, the log and the questions are the same objects the HTTP API uses.
  const telegramOptions = options.telegram === false ? {} : (options.telegram ?? {});
  const telegram: TelegramChannel = new TelegramChannel({
    projectsDir: () => defaultProjectsDir(paths.home),
    db,
    log,
    state,
    runs,
    questions,
    gate,
    team,
    secretsDir: paths.secrets,
    env,
    prefs: () => settings.telegram,
    savePrefs: (prefs) => {
      patchSettingsFile(paths.home, { telegram: prefs });
      settings.telegram = prefs;
    },
    send: (params) => dispatcher.send(params),
    answer: (id, answer, channel) => questions.answer(id, answer, channel),
    newConversation: (params) => dispatcher.newConversation(params),
    ready: () => onboarding.done,
    // An automation announces its own end; a Telegram chat's run answers in that chat (D-107).
    quietRun: (runId) => automationRunOf(log, runId) !== null || threadOfRun(log, runId) !== null,
    groupRun: (runId) => threadOfRun(log, runId) !== null,
    bots: () => telegramBots.views(),
    // The monsters with the terminal or other programs: a bot dedicated to one is warned of (D-114).
    toolRisks: () =>
      Object.fromEntries(
        team
          .list()
          .filter((a) => a.config.kind !== 'orchestrator')
          .map((a) => {
            const id = a.config.id;
            const programs =
              mcp.hasServersFor(id) ||
              (harnessOf(a)?.id === 'claude-agent' &&
                claudeConnections.connectorsFor(id).length > 0);
            return [id, { terminal: team.permissionsFor(id).shell, programs }] as const;
          })
          .filter(([, r]) => r.terminal || r.programs),
      ),
    dedicatedBot: (botId) => telegramBots.has(botId),
    sendHeld: (id) => telegramBots.sendHeld(id, 'telegram'),
    projects: () => projects.status(),
    drafts,
    ...telegramOptions,
  });
  // Bots dedicated to one monster (D-107): a loop each, next to the main bot's.
  const telegramBots: TelegramBots = new TelegramBots({
    db,
    log,
    state,
    runs,
    questions,
    team,
    secretsDir: paths.secrets,
    owners: () => telegram.users(),
    ownerName: () => settings.userName?.trim() || 'l’utente',
    mainBot: () => telegram.identity(),
    send: (params) => dispatcher.send(params),
    answer: (id, answer, channel, by) => questions.answer(id, answer, channel, by),
    ready: () => onboarding.done,
    spendStop: (agentId) => spend.stopReason(agentId),
    tellOwner: (text, meta, held) => telegram.announce('done', text, meta, held),
    // A reply to a chat with other people leaves like data sent out (D-114).
    // Whether or not the run read third-party text (review of the waves 3 and 4): a long stretch
    // equal to a note, not a few quotes; the notes of the bot's project are the group's own.
    replyCheck: (runId, text, agentId) => {
      if (log.redactor.containsKnown(text)) return REPLY_KEY_REASON;
      const thread = threadOfRun(log, runId);
      if (thread && telegramBots.fullTools(thread)) return null;
      const run = runs.getRun(runId);
      const area = team.projectOf(agentId)?.vaultArea?.replace(/\/+$/, '').toLowerCase();
      const shared = (path: string) =>
        area !== undefined && area !== '' && path.toLowerCase().startsWith(`${area}/`);
      const leak = run ? taints.get(run)?.replyLeak(text, shared) : null;
      if (!leak) return null;
      if (leak.kind === 'private') return hubStrings().replyPrivate;
      if (leak.chars < NOTE_LEAK_CHARS) return null;
      return leak.kind === 'profile' ? hubStrings().replyProfile : hubStrings().replyNotes;
    },
    ...telegramOptions,
  });
  const telegramOff =
    options.telegram === false ||
    (options.telegram === undefined &&
      (env['MONSTERS_TELEGRAM'] === 'off' || process.env['MONSTERS_TELEGRAM'] === 'off'));
  if (!telegramOff) {
    telegram.start();
    telegramBots.start();
  }

  const undoAction: Hub['undo'] = async (actionId, options = {}) => {
    const result = await vault.undo(
      {
        agentId: 'user',
        emit: (e) =>
          log.append(EventInputSchema.parse({ agent: 'user', type: e.type, data: e.data })),
      },
      { action_id: actionId, ...(options.force ? { force: true } : {}) },
    );
    return { commit: result.commit, files: result.files };
  };

  const settingsView = (): SettingsResponse => {
    const label = state.get<OpenRouterKeyInfo>(OPENROUTER_INFO_KEY)?.label;
    return {
      openrouterKey: {
        set: providers.has('openrouter') || readOpenRouterKey(paths.secrets, env) !== null,
        freeOnly: settings.openrouter.freeOnly,
        ...(label ? { label } : {}),
      },
      braveKey: { set: braveKey !== null },
      webSearch: paidSearch.status(),
      vaultPath: vault.root,
      userName: settings.userName,
      secrets: secretStore.status(),
      language: appLang(),
    };
  };

  return {
    setAppPresence: (open) => {
      appPresence = open;
    },
    settings,
    vault,
    team,
    providers,
    questions,
    gate,
    decisions,
    instinct: { system1, scorecard },
    dispatcher,
    onboarding,
    permissions,
    squad,
    telegram,
    telegramBots,
    mcp,
    spend,
    usage,
    compactor,
    files,
    automations,
    projects,
    drafts,
    docsProposals,
    hasModelProvider,
    send: (params) => dispatcher.send(params),
    haltedRequests: () => (onboarding.done ? haltedRequests(log) : []),
    continueRequests: (requests, channel) =>
      continueRequests(requests, {
        log,
        dispatcher,
        channel,
        isAgent: (id) => team.get(id) !== undefined,
      }),
    requeueWaiting: () =>
      onboarding.done ? requeueWaiting(log, dispatcher, { halted: runs.halted }) : [],
    newConversation: (params) => dispatcher.newConversation(params),
    answer: (id, answer, channel) => questions.answer(id, answer, channel),
    settingsView,
    setLanguage(language) {
      saveAppLanguage(paths.home, language, env);
      settings.language = language;
      return settingsView();
    },
    setBraveKey(key) {
      const trimmed = key.trim();
      log.redactor.addSecret(trimmed);
      saveBraveKey(paths.secrets, trimmed);
      braveKey = trimmed;
      searchChain = buildSearchChain();
    },
    setWebSearch(change) {
      paidSearch.set(change);
      return settingsView();
    },
    setOpenRouterKey,
    setOpenRouterFreeOnly(freeOnly) {
      patchSettingsFile(paths.home, { openrouter: { freeOnly } });
      // The same object configures a provider created later (new key).
      settings.openrouter.freeOnly = freeOnly;
      const current = providers.has('openrouter') ? providers.get('openrouter') : undefined;
      if (current instanceof OpenRouterProvider) {
        current.setFreeOnly(freeOnly);
        if (freeOnly) void current.syncDailyQuota();
      }
      return settingsView();
    },
    providerSetup,
    subscriptions,
    claudeConnections,
    harnessSessions,
    undo: undoAction,
    undoRun(runId) {
      return undoRun(log, runId, (actionId) => undoAction(actionId));
    },
    async close() {
      automations.stop();
      projects.close();
      scorecard.close();
      spend.close();
      await Promise.all([telegram.stop(), telegramBots.stop()]);
      offAnswer();
      offAccess();
      offLog();
      offKill();
      detachTeam();
      subscriptions.close();
      await dispatcher.idle();
      // A summary being written stops with the core (its turn already ended).
      summaries.abort();
      await compactor.idle();
      await mcp.close();
      await vault.close();
      unregisterSecrets();
    },
  };
}
