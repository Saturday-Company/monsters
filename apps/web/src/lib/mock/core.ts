import {
  AnswerRequestSchema,
  ChatConversationsQuerySchema,
  chatConversations,
  chatConversationSpan,
  chatHistoryPage,
  KillRequestSchema,
  LoginRequestSchema,
  NewConversationRequestSchema,
  BraveKeyRequestSchema,
  WebSearchSettingsRequestSchema,
  OpenRouterKeyRequestSchema,
  OpenRouterSettingsRequestSchema,
  SendMessageRequestSchema,
  ResumeRequestSchema,
  UndoRequestSchema,
  haltedWork,
  resumeText,
  ulid,
  type AgentStopResponse,
  type AgentSummary,
  type ChatHistoryQuery,
  type EventInput,
  type LogEvent,
  type Question,
  type SettingsResponse,
  type PaidSearchEngineName,
  type PaidSearchMode,
  type WebSearchSettings,
  type StatusResponse,
  type StreamMessage,
  LanguageRequestSchema,
  type Lang,
} from '@monsters/shared';
import type { z } from 'zod';
import { SetupBodySchema } from '../api.ts';
import type { RawResponse, SocketLike, Transport } from '../transport.ts';
import { applyLive, type LiveState } from '../../store/derive.ts';
import { MOCK_DEMO_USER, MOCK_SETUP_CODE } from './constants.ts';
import { seedLongChat } from './long-chat.ts';

import { mockTeam } from './team.ts';
import { ambientJobs, type AmbientJob } from './ambient.ts';
import { createRng } from '@monsters/monster-kit';
import { MockOnboarding } from '../../onboarding/mock.ts';
import { MockMcp } from './mcp.ts';
import { MockPermissions } from './permissions.ts';
import { MockSquad } from './squad.ts';
import { MockProviders } from './providers.ts';
import { MOCK_GROUP, MOCK_LIVIO, MockTelegram } from './telegram.ts';
import { MockDecisions } from './decisions.ts';
import { MockInstinct, mockReceipt } from './instinct.ts';
import { MockRunLimits } from './limits.ts';
import { MockSpend } from './spend.ts';
import { handleUsage, MOCK_MODEL, MOCK_WINDOW, mockContext, turnsOf } from './usage.ts';
import { MockVault } from './vault.ts';
import { MockFiles } from './files.ts';
import { MockAutomations } from './automations.ts';
import { DEMO_PROJECT_ID, MockProjects } from './projects.ts';
import { CHANGELOG } from '../changelog-data.ts';
import { MockDocs } from './docs.ts';
import { seedPreviewScene } from './preview-scene.ts';
import { setMockLang, startLang, tr } from './lang.ts';
import { mockLayout, mockVaultDir, noteTitle, notePath } from './paths.ts';

/** The mock core reports the newest version of the changelog, so "Novità" has a current one. */
const MOCK_VERSION = CHANGELOG[0]?.version ?? '0.0.0-mock';

/*
 * In-memory pretend core. It follows the HTTP and WebSocket contract of
 * packages/shared/src/api.ts closely enough to develop and test the UI without
 * a real core: a team, streaming replies, a delegation, a question with options,
 * vault changes that can be undone, kill and resume.
 */

export { MOCK_DEMO_USER, MOCK_SETUP_CODE };
const STORAGE_KEY = 'monsters-mock-auth';

/** `fresh`: empty install (onboarding); `team`: empty install whose team already exists; `demo`: team with history. */
export type MockMode = 'fresh' | 'team' | 'demo';

export interface MockOptions {
  mode: MockMode;
  /** Multiplies every delay of the scripted scenarios (0.2 = five times faster). */
  speed?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Size of the team for `team` and `demo` (7 = the whole roster). */
  teamSize?: 5 | 7;
  /** Keeps the team busy: now and then a monster does a small job (`?vita=1`). */
  ambient?: boolean;
  /** Generated notes added to the vault (`?mockNotes=2000`: the graph on a big vault). */
  vaultNotes?: number;
  /** A chat with files and notes to open in Anteprima (`?anteprima=1`, D-075). */
  previewScene?: boolean;
  /**
   * Steps of one long job of Enceladus logged after the demo's history (`?mockNoise=500`):
   * the chats' own history lies beyond the first page of the log (W-1).
   */
  noise?: number;
  /**
   * Turns of mixed content seeded into the orchestrator's chat before the demo's own
   * (`?mockChat=1500`): the long chat the transcript is measured on (stream J).
   */
  chatTurns?: number;
}

interface AuthState {
  user: { email: string; password: string } | null;
  loggedIn: boolean;
}

type Step = [delayMs: number, run: () => void];

class MockSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private closed = false;
  private readonly core: MockCore;

  constructor(core: MockCore) {
    this.core = core;
  }

  deliver(msg: StreamMessage): void {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.core.detach(this);
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }
}

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

/** The three tones of the posts, asked after the research (ids stay, texts follow the language). */
function toneOptions(): Question['options'] {
  return [
    {
      id: 'amichevole',
      label: tr('Friendly', 'Amichevole'),
      description: tr('Like advice between friends', 'Come un consiglio tra amici'),
    },
    {
      id: 'ironico',
      label: tr('Ironic', 'Ironico'),
      description: tr('Light, with a joke', 'Leggero, con una battuta'),
    },
    {
      id: 'elegante',
      label: tr('Elegant', 'Elegante'),
      description: tr('Clean, travel-magazine style', 'Pulito, da rivista di viaggi'),
    },
  ];
}

export class MockCore {
  /** The app's language (D-153): `?lang=` of the page, else the browser's; set before any content is built. */
  private language: Lang = (() => {
    const lang = startLang();
    setMockLang(lang);
    return lang;
  })();
  readonly events: LogEvent[] = [];
  private agents: AgentSummary[];
  /** First start: a fresh install has no team until the onboarding creates it. */
  private readonly onboarding = new MockOnboarding({
    agents: () => this.agents,
    setAgents: (list) => {
      this.agents = list;
    },
    welcome: (agent, text) =>
      this.append({ agent, type: 'message', data: { role: 'agent', text, channel: 'system' } }),
    hasProvider: (id) => this.providers.isActive(id),
    setChain: (agent, models) => this.providers.setChain(agent, models),
    setProfile: (profile) => this.squad.seedProfile(profile),
  });
  /** Permissions of the agents after the onboarding (M2.1). */
  private readonly permissions = new MockPermissions({
    agents: () => this.agents,
    log: (event) => this.append(event),
  });
  private readonly providers = new MockProviders(() => this.agents);
  /** Settings → Squadra: the team after the onboarding, the profile, the password. */
  private readonly squad = new MockSquad({
    agents: () => this.agents,
    setAgents: (list) => {
      this.agents = list;
    },
    log: (event) => this.append(event),
    busy: () => this.timers.size > 0,
    halted: () => this.halted !== null,
    checkPassword: (password) => this.auth.user?.password === password,
    setPassword: (password) => {
      if (this.auth.user) this.auth.user = { ...this.auth.user, password };
      this.saveAuth();
    },
  });
  /** Telegram bot, whitelist and pairing (M2.6). */
  private readonly telegram: MockTelegram;
  private readonly decisions = new MockDecisions();
  /** The instinct (D-067): modes of the uses, scorecard, receipts, "Annulla tutto". */
  private readonly instinct = new MockInstinct({
    decisions: this.decisions,
    events: () => this.events,
    undo: (actionId) => this.undo(actionId, false),
    agentName: (id) => this.agents.find((a) => a.id === id)?.name ?? id,
  });
  /** External tools through MCP and the browser (M2.5). */
  private readonly mcp = new MockMcp({
    agents: () => this.agents,
    log: (event) => this.append(event),
    claude: () => this.providers.claudeReady,
    web: (id) => this.permissions.webOf(id),
  });
  /** Spending caps (D-070): created with the mode (the demo has spent a little). */
  private spend!: MockSpend;
  /** The limits of each job, in the settings under the spending cap. */
  private readonly runLimits = new MockRunLimits();
  private live: Record<string, LiveState> = {};
  private readonly questions = new Map<string, Question>();
  private readonly undone = new Set<string>();
  private readonly sockets = new Set<MockSocket>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Work held back by `hold()`, in order: scripted steps and request replies. */
  private held: (() => void)[] | null = null;
  private readonly onAnswer = new Map<string, (choice: string) => void>();
  /**
   * Stopped from a monster's chat (F-1): the runs that ended, and `run:agent` for a monster's
   * part in another's run. The scripted steps still due there are dropped (`append`).
   */
  private readonly stoppedWork = new Set<string>();
  private halted: { at: number; reason: string | null } | null = null;
  private keyLabel: string | null = null;
  private braveKey = false;
  /** Paid web search (D-071): the user's choice; the mock has credit when a key is set. */
  private webSearch: { mode: PaidSearchMode; engine: PaidSearchEngineName } = {
    mode: 'auto',
    engine: 'parallel',
  };

  private webSearchView(): WebSearchSettings {
    const { mode, engine } = this.webSearch;
    const reason: WebSearchSettings['reason'] =
      mode === 'off'
        ? 'off'
        : mode === 'auto' && this.providers.freeOnly
          ? 'free_only'
          : !this.providers.isActive('openrouter')
            ? 'no_key'
            : undefined;
    return {
      mode,
      engine,
      active: reason === undefined,
      ...(reason ? { reason } : {}),
      usdPer1000: { parallel: 1.09, exa: 7.09 },
    };
  }
  private auth: AuthState;
  private readonly startedAt = Date.now();
  private readonly speed: number;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly storageKey: string;

  private readonly vault: MockVault;
  private readonly files: MockFiles;
  /** Automations (D-094): definitions here, giri in the log. */
  readonly automations: MockAutomations;
  /** Projects (D-097): their files here, their monsters in the team with `project`. */
  readonly projects: MockProjects;
  /** The proposals for CLAUDE.md and AGENTS.md of the projects' folders (D-113). */
  readonly docs: MockDocs;

  constructor(opts: MockOptions) {
    this.vault = new MockVault({
      mode: opts.mode,
      extraNotes: opts.vaultNotes ?? 0,
      log: (event) => this.append(event),
    });
    this.speed = opts.speed ?? 1;
    this.files = new MockFiles({
      log: (event, ts) => this.append(event, ts),
      speed: Math.min(1, this.speed),
    });
    this.telegram = new MockTelegram({
      log: (event) => this.append(event),
      agents: () => this.agents,
      speed: this.speed,
    });
    this.automations = new MockAutomations({
      agents: () => this.agents,
      events: () => this.events,
      log: (event, ts) => this.append(event, ts),
      halted: () => this.halted !== null,
      schedule: (steps) => this.schedule(steps),
      questions: () => [...this.questions.values()],
    });
    this.projects = new MockProjects({
      agents: () => this.agents,
      setAgents: (list) => {
        this.agents = list;
      },
      log: (event, ts) => this.append(event, ts),
      spend: () => this.spend.view(),
      working: () =>
        Object.entries(this.live)
          .filter(([, l]) => l.mood === 'working' || l.mood === 'talking' || l.mood === 'waiting')
          .map(([id]) => id),
      automationDraft: (input) =>
        this.automations.propose({
          name: input.name,
          lead: input.lead,
          project: input.project,
          participants: input.participants,
          schedule: {
            cron: input.cron,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          objective: input.objective,
          createdBy: input.createdBy,
        }),
    });
    this.docs = new MockDocs({
      agents: () => this.agents,
      log: (event, ts) => this.append(event, ts),
      project: (id) => this.projects.activeInfo(id),
    });
    this.storageKey = `${STORAGE_KEY}-${opts.mode}`;
    this.storage = opts.storage ?? null;
    this.agents = opts.mode === 'fresh' ? [] : mockTeam(opts.teamSize ?? 5);
    // A fresh install has no key yet: the onboarding (or the settings) adds it.
    if (opts.mode === 'fresh') {
      this.providers.setOpenRouter(false);
      // Nobody told the monsters what they do yet: the "Tell me more" card comes.
      this.squad.forgetWork();
    }
    const saved = this.loadAuth();
    this.auth =
      saved ??
      (opts.mode === 'demo'
        ? { user: MOCK_DEMO_USER, loggedIn: true }
        : { user: null, loggedIn: false });
    this.spend = new MockSpend({
      agents: () => this.agents,
      log: (event) => this.append(event),
      demo: opts.mode === 'demo',
    });
    if (opts.mode === 'demo') {
      // Earlier conversations of Titan and Dione, closed by "New conversation" weeks ago: first,
      // so their ids (monotonic) come before everything else of the demo.
      this.seedPastConversations();
      // A long chat to measure the transcript on: after the earlier conversations, before today.
      if (opts.chatTurns) {
        const day = 24 * 3_600_000;
        seedLongChat(
          {
            append: (input, ts) => this.append(input, ts),
            screenshot: (agent, runId, ts) => this.files.seedScreenshot(agent, runId, ts),
            questions: this.questions,
          },
          this.orchestrator.id,
          opts.chatTurns,
          Date.now() - 17 * day,
          Date.now() - 2 * 3_600_000,
        );
      }
      // "Social di Saturday" with its monsters, and the orchestrator's draft (D-097, D-098).
      this.projects.seedDemo();
      // Giulio's example (the giri of the last two Sundays): before the rest, the log stays in order.
      this.automations.seedDemo();
      this.events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      this.seedDemo();
      // Two proposals for the instructions of its folder (D-113): after the demo's day, so
      // Attività keeps one "Oggi".
      this.docs.seedDemo();
      this.projects.seedDraft();
      // A tool of GitHub changed since it was accepted (D-070): it waits for "Accetta".
      this.mcp.seedPaused(Date.now() - 3 * 3_600_000);
      if (opts.previewScene) seedPreviewScene((event, ts) => this.append(event, ts));
    }
    if (opts.noise && opts.mode !== 'fresh') this.seedNoise(opts.noise);
    if (opts.ambient && opts.mode !== 'fresh') this.startAmbient();
  }

  /* ------------------------------------------------------------ plumbing */

  private loadAuth(): AuthState | null {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      return raw ? (JSON.parse(raw) as AuthState) : null;
    } catch {
      return null;
    }
  }

  private saveAuth(): void {
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.auth));
    } catch {
      // storage unavailable: the mock simply forgets on reload
    }
  }

  private get orchestrator(): AgentSummary {
    return this.agents.find((a) => a.isOrchestrator) ?? this.agents[0]!;
  }

  append<T extends EventInput>(input: T, ts = Date.now()): LogEvent {
    // A scripted step of work stopped from a monster's chat (F-1): it never happens.
    if (
      input.runId &&
      (this.stoppedWork.has(input.runId) || this.stoppedWork.has(`${input.runId}:${input.agent}`))
    ) {
      return {
        id: ulid(ts),
        ts,
        agent: input.agent,
        runId: input.runId,
        parentId: input.parentId ?? null,
        type: input.type,
        data: input.data,
      } as LogEvent;
    }
    // The core writes the receipt of a turn before the run ends (D-067).
    if (input.type === 'run' && input.runId && input.data.status !== 'started') {
      const status =
        input.data.status === 'completed' || input.data.status === 'waiting_user'
          ? 'completed'
          : input.data.status;
      this.append(
        {
          agent: 'system',
          runId: input.runId,
          type: 'receipt',
          data: mockReceipt(
            input.runId,
            this.events,
            status,
            (id) => this.agents.find((a) => a.id === id)?.name ?? id,
            ts,
          ),
        },
        ts,
      );
    }
    const event = {
      id: ulid(ts),
      ts,
      agent: input.agent,
      runId: input.runId ?? null,
      parentId: input.parentId ?? null,
      type: input.type,
      data: input.data,
    } as LogEvent;
    this.events.push(event);
    this.vault?.observe(event);
    this.automations?.observe(event);
    this.live = applyLive(
      this.live,
      event,
      this.agents.map((a) => a.id),
      { askerOf: (id) => this.questions.get(id)?.from },
    );
    for (const s of this.sockets) s.deliver({ kind: 'event', event });
    return event;
  }

  private schedule(steps: Step[]): void {
    let at = 0;
    for (const [delay, run] of steps) {
      at += delay * this.speed;
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.gate(() => {
          if (!this.halted) run();
        });
      }, at);
      this.timers.add(t);
    }
  }

  /*
   * Test hooks (e2e, through `window.__monstersMock`): the tests decide when
   * time moves on, so a passing state (a reply while it streams, a switch
   * while it saves) stays on screen until they have looked at it, however
   * slow the machine is.
   */

  /** From now on, scripted steps and request replies wait in a queue. */
  hold(): void {
    this.held ??= [];
  }

  /** Runs the oldest waiting item; false when nothing is waiting. */
  step(): boolean {
    const next = this.held?.shift();
    next?.();
    return next !== undefined;
  }

  /** Runs everything that waited, in order, and stops holding. */
  release(): void {
    const waiting = this.held ?? [];
    this.held = null;
    for (const run of waiting) run();
  }

  /** Test hook: every request, as "METHOD /path?query" (the newest 1000), to count them. */
  requests: string[] = [];

  /** Test hook: answer as a core of before `GET /api/chats/:agent/history` (404). */
  withoutChatHistory = false;

  /** Requests that fail on purpose (`failRequests`): the text they must contain, how many are left. */
  private failures: { match: string; times: number }[] = [];

  /**
   * Test hook: the next `times` requests whose "METHOD /path" contains `match` are answered with
   * a 503, as a core that is busy or restarting does; `clearFailures` ends it.
   */
  failRequests(match: string, times = Number.POSITIVE_INFINITY): void {
    this.failures.push({ match, times });
  }

  clearFailures(): void {
    this.failures = [];
  }

  /** Test hook: the monster works on the Claude plan from now on (Consumi, D-075). */
  useSubscription(agentId: string): void {
    this.providers.setChain(agentId, [{ provider: 'claude-agent', model: 'sonnet' }]);
  }

  /** Test hook: the monster has a direct key priced by OpenRouter's list, so its cost is estimated (D-114). */
  estimateCost(agentId: string, label: string): void {
    this.spend.estimate(agentId, label);
  }

  /**
   * Test hook: the monster's latest step (in its latest run) held `share` of its window, so its
   * usage says how long the conversation is (`contextLevel`: long from 0.6, full from 0.75).
   */
  fillContext(agentId: string, share: number): void {
    const runId = this.events.findLast(
      (e) => e.type === 'run' && e.agent === agentId && e.data.status === 'started',
    )?.runId;
    if (!runId) return;
    const total = Math.round(share * MOCK_WINDOW);
    this.append({
      agent: agentId,
      runId,
      type: 'provider_usage',
      data: {
        provider: 'openrouter',
        model: MOCK_MODEL,
        inputTokens: total,
        outputTokens: 120,
        costUsd: 0,
        durationMs: 1800,
        step: 0,
        context: {
          total,
          window: MOCK_WINDOW,
          parts: { instructions: 1830, conversation: total - 1830 },
          source: 'measured',
        },
      },
    });
  }

  /** A model step of a monster with its context (Consumi, D-075): on its plan or a free model. */
  private modelStep(agent: string, runId: string, step: number, results: number): void {
    const harness = this.providers.providerOf(agent) === 'claude-agent';
    const context = mockContext({ turns: turnsOf(this.events, agent), results, harness });
    this.append({
      agent,
      runId,
      type: 'provider_usage',
      data: harness
        ? {
            provider: 'claude-agent',
            model: 'claude-sonnet-5-5',
            inputTokens: context.total,
            outputTokens: 140 + step * 60,
            cachedInputTokens: step === 0 ? 0 : Math.round(context.total * 0.86),
            cacheWriteTokens: step === 0 ? context.total - 200 : 900,
            durationMs: 2100,
            step,
            context,
          }
        : {
            provider: 'openrouter',
            model: MOCK_MODEL,
            inputTokens: context.total,
            outputTokens: 120 + step * 80,
            costUsd: 0,
            durationMs: 1800,
            step,
            context,
          },
    });
  }

  private gate(run: () => void): void {
    if (this.held) this.held.push(run);
    else run();
  }

  /** Streams `text` as partial chunks of a few words, then the final message. */
  private streamSteps(
    agent: string,
    runId: string,
    text: string,
    parentId: string | null = null,
  ): Step[] {
    const words = text.split(/(\s+)/);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += 6) chunks.push(words.slice(i, i + 6).join(''));
    const steps: Step[] = chunks.map((chunk) => [
      140,
      () =>
        this.append({
          agent,
          runId,
          parentId,
          type: 'message',
          data: { role: 'agent', text: chunk, partial: true },
        }),
    ]);
    steps.push([
      160,
      () => this.append({ agent, runId, parentId, type: 'message', data: { role: 'agent', text } }),
    ]);
    return steps;
  }

  attach(socket: MockSocket, after: string | null): void {
    this.sockets.add(socket);
    setTimeout(() => {
      socket.onopen?.();
      socket.deliver({ kind: 'hello', halted: this.halted !== null });
      if (after) {
        const past = this.events.filter((e) => e.id > after);
        for (const event of past) socket.deliver({ kind: 'event', event });
        socket.deliver({ kind: 'replay_done', count: past.length });
      }
    }, 0);
  }

  detach(socket: MockSocket): void {
    this.sockets.delete(socket);
  }

  transport(): Transport {
    return {
      kind: 'mock',
      request: (method, path, body) =>
        new Promise((resolve) => {
          // A short delay keeps loading states honest.
          setTimeout(
            () => this.gate(() => resolve(this.handle(method, path, body))),
            60 * Math.min(1, this.speed),
          );
        }),
      upload: (_path, form, onProgress) =>
        this.auth.loggedIn
          ? this.files.upload(form, onProgress)
          : Promise.resolve({ status: 401, body: { error: 'unauthorized' } }),
      fileUrl: (path) => this.files.url(path),
      connect: (path) => {
        const socket = new MockSocket(this);
        const url = new URL(path, 'http://mock.local');
        setTimeout(() => {
          if (!this.auth.loggedIn) socket.close(4401, 'unauthorized');
          else this.attach(socket, url.searchParams.get('after'));
        }, 0);
        return socket;
      },
    };
  }

  /* --------------------------------------------------------------- routes */

  handle(method: string, rawPath: string, body: unknown): RawResponse {
    const url = new URL(rawPath, 'http://mock.local');
    const path = url.pathname;
    const route = `${method} ${path}`;
    this.requests.push(`${route}${url.search}`);
    if (this.requests.length > 1000) this.requests.shift();

    switch (route) {
      case 'GET /api/health':
        return ok({ ok: true, version: MOCK_VERSION });
      case 'GET /api/setup-status':
        // The demo vault is built in the mock's language, with that layout's names (D-154).
        return ok({
          needsSetup: this.auth.user === null,
          language: this.language,
          vaultLayout: mockLayout().id,
        });
      case 'POST /api/setup': {
        if (this.auth.user) return fail(409, 'already_configured');
        const p = SetupBodySchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (p.data.setupCode !== MOCK_SETUP_CODE) return fail(403, 'invalid_setup_code');
        if (p.data.language) {
          this.language = p.data.language;
          setMockLang(this.language);
        }
        this.auth = { user: { email: p.data.email, password: p.data.password }, loggedIn: true };
        this.saveAuth();
        this.append({ agent: 'system', type: 'auth', data: { action: 'setup', channel: 'ui' } });
        return ok({ email: p.data.email }, 201);
      }
      case 'POST /api/login': {
        const p = LoginRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        const u = this.auth.user;
        if (!u || u.email !== p.data.email.trim().toLowerCase() || u.password !== p.data.password) {
          this.append({
            agent: 'system',
            type: 'auth',
            data: { action: 'login_failed', channel: 'ui' },
          });
          return fail(401, 'invalid_credentials');
        }
        this.auth.loggedIn = true;
        this.saveAuth();
        this.append({ agent: 'system', type: 'auth', data: { action: 'login', channel: 'ui' } });
        return ok({ email: u.email });
      }
      case 'POST /api/logout':
        this.auth.loggedIn = false;
        this.saveAuth();
        for (const s of [...this.sockets]) s.close(4401, 'logged out');
        return ok({ ok: true });
      default:
        break;
    }

    if (!this.auth.loggedIn) return fail(401, 'unauthorized');

    const failing = this.failures.find((f) => f.times > 0 && route.includes(f.match));
    if (failing) {
      failing.times--;
      return fail(503, 'unavailable', tr('The core is busy.', 'Il core è occupato.'));
    }

    const onboarding = this.onboarding.handle(method, path, body);
    if (onboarding) return onboarding;
    const permissions = this.permissions.handle(method, path, body);
    if (permissions) return permissions;
    const providers = this.providers.handle(method, path, body, url.searchParams);
    if (providers) return providers;
    const telegram = this.telegram.handle(method, path, body);
    if (telegram) return telegram;
    const decisions = this.decisions.handle(method, path, body);
    if (decisions) return decisions;
    const instinct = this.instinct.handle(method, path, body);
    if (instinct) return instinct;
    const mcp = this.mcp.handle(method, path, body);
    if (mcp) return mcp;
    const spend = this.spend.handle(method, path, body);
    if (spend) return spend;
    const limits = this.runLimits.handle(method, path, body);
    if (limits) return limits;
    const usage = handleUsage(method, path, {
      events: this.events,
      agents: () => this.agents,
      spend: () => this.spend.view(),
      providerOf: (id) => this.providers.providerOf(id),
    });
    if (usage) return usage;
    const vault = this.vault.handle(method, path, url.searchParams, body);
    if (vault) return vault;
    const files = this.files.handle(method, path, url.searchParams);
    if (files) return files;
    const squad = this.squad.handle(method, path, body);
    if (squad) return squad;
    const automations = this.automations.handle(method, path, body);
    if (automations) return automations;
    const projects = this.projects.handle(method, path, body);
    if (projects) return projects;
    if (path.startsWith('/api/drafts')) return this.drafts(method, path);
    // One page of a chat's history in one request, as the core does it (same rule, shared).
    const chat = /^\/api\/chats\/([^/]+)\/history$/.exec(path);
    if (method === 'GET' && chat && !this.withoutChatHistory) {
      const before = url.searchParams.get('before') ?? undefined;
      return ok(chatHistoryPage(decodeURIComponent(chat[1]!), before, this.chatQuery));
    }
    // The previous conversations of a chat and one of them, read-only (same rule as the core).
    const conversations = /^\/api\/chats\/([^/]+)\/conversations$/.exec(path);
    if (method === 'GET' && conversations) {
      const p = ChatConversationsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!p.success) return fail(400, 'invalid_request');
      return ok(chatConversations(decodeURIComponent(conversations[1]!), p.data, this.chatQuery));
    }
    const past = /^\/api\/chats\/([^/]+)\/conversations\/([^/]+)\/history$/.exec(path);
    if (method === 'GET' && past) {
      const agent = decodeURIComponent(past[1]!);
      const span = chatConversationSpan(
        agent,
        decodeURIComponent(past[2]!),
        (id) => this.events.find((e) => e.id === id),
        this.chatQuery,
      );
      if (!span) return fail(404, 'unknown_conversation');
      const before = url.searchParams.get('before');
      return ok(
        chatHistoryPage(
          agent,
          before && before < span.before ? before : span.before,
          this.chatQuery,
          span.after,
        ),
      );
    }
    const stop = /^\/api\/agents\/([^/]+)\/stop$/.exec(path);
    if (method === 'POST' && stop) return this.stopAgent(decodeURIComponent(stop[1]!));

    switch (route) {
      case 'GET /api/me':
        return ok({
          email: this.auth.user?.email ?? '',
          via: 'session',
          owner: true,
          recent: true,
        });
      case 'POST /api/auth/confirm':
        return ok({ ok: true });
      case 'GET /api/status':
        return ok(this.status());
      case 'POST /api/kill': {
        const p = KillRequestSchema.safeParse(body ?? {});
        return ok(this.kill(p.success ? p.data.reason : undefined));
      }
      case 'POST /api/resume': {
        const p = ResumeRequestSchema.safeParse(body ?? {});
        const again = p.success && p.data.continue === true;
        // Like the core (D-072): read what the stop left halfway, resume, start it again.
        const pending = again && this.halted ? haltedWork(this.events).requests : [];
        const resumed = this.halted !== null;
        if (this.halted) {
          this.halted = null;
          this.append({ agent: 'system', type: 'resume', data: { by: 'ui' } });
        }
        const continued = pending.map((r) => ({
          runId: this.receive({ text: resumeText(r.text), to: r.agent, resumeOf: r.runId }).runId,
          agent: r.agent,
          resumeOf: r.runId,
        }));
        return ok({ ...this.status(), resumed, ...(again ? { continued } : {}) });
      }
      case 'GET /api/events':
        return ok({ events: this.queryEvents(url.searchParams) });
      // The mock never archives: no monthly files.
      case 'GET /api/log/archive':
        return ok({
          enabled: true,
          days: 90,
          dir: '~/.monsters/archive',
          lastRunAt: null,
          lastError: null,
          months: [],
        });
      case 'GET /api/agents':
        return ok(this.agentsSnapshot());
      case 'GET /api/questions': {
        const status = url.searchParams.get('status');
        const list = [...this.questions.values()].filter((q) => !status || q.status === status);
        return ok(list);
      }
      case 'POST /api/messages': {
        const p = SendMessageRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        if (this.halted) return fail(409, 'halted');
        if (p.data.attachments?.some((id) => !this.files.has(id))) {
          return fail(
            404,
            'unknown_file',
            tr(
              'An attachment is gone: remove it and try again.',
              'Un allegato non c’è più: toglilo e riprova.',
            ),
          );
        }
        // Like the core (D-217): the same sender's id again is answered as the first time.
        const prior = p.data.clientId ? this.sentByClient.get(p.data.clientId) : undefined;
        if (prior) return ok(prior);
        const sent = this.receive(p.data);
        if (p.data.clientId) this.sentByClient.set(p.data.clientId, sent);
        return ok(sent);
      }
      case 'POST /api/conversations': {
        const p = NewConversationRequestSchema.safeParse(body ?? {});
        if (!p.success) return fail(400, 'invalid_request');
        return this.newConversation(p.data.to);
      }
      case 'POST /api/vault/undo': {
        const p = UndoRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        return this.undo(p.data.actionId, p.data.force ?? false);
      }
      case 'GET /api/settings': {
        const settings: SettingsResponse = {
          openrouterKey: {
            set: this.keyLabel !== null,
            freeOnly: this.providers.freeOnly,
            ...(this.keyLabel ? { label: this.keyLabel } : {}),
          },
          braveKey: { set: this.braveKey },
          webSearch: this.webSearchView(),
          vaultPath: mockVaultDir(),
          vaultLayout: mockLayout().id,
          userName: this.squad.userName,
          language: this.language,
          secrets: {
            backend: 'keychain',
            reason: 'keychain',
            keychain: 'Secret Service',
            unreadable: [],
          },
        };
        return ok(settings);
      }
      case 'PUT /api/settings/openrouter-key': {
        const p = OpenRouterKeyRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (!p.data.key.startsWith('sk-or-'))
          return fail(400, 'invalid_key', tr('invalid key', 'chiave non valida'));
        this.keyLabel = 'Monsters (mock)';
        this.onboarding.keySaved();
        this.providers.setOpenRouter(true);
        return ok({ ok: true, label: this.keyLabel, isFreeTier: false });
      }
      case 'PUT /api/settings/language': {
        const p = LanguageRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        this.language = p.data.language;
        setMockLang(this.language);
        return this.handle('GET', '/api/settings', undefined);
      }
      case 'PUT /api/settings/openrouter': {
        const p = OpenRouterSettingsRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        this.providers.freeOnly = p.data.freeOnly;
        return this.handle('GET', '/api/settings', undefined);
      }
      case 'PUT /api/settings/web-search': {
        const p = WebSearchSettingsRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        this.webSearch = { ...this.webSearch, ...p.data };
        return this.handle('GET', '/api/settings', undefined);
      }
      case 'PUT /api/settings/brave-key': {
        const p = BraveKeyRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        this.braveKey = true;
        return ok({ ok: true });
      }
      default:
        break;
    }

    const answer = /^\/api\/questions\/([^/]+)\/answer$/.exec(path);
    if (method === 'POST' && answer) return this.answer(decodeURIComponent(answer[1]!), body);
    return fail(404, 'not_found');
  }

  /** Like the core: refused while a scripted scenario is still running (`busy`). */
  private newConversation(to: string | undefined): RawResponse {
    let target: AgentSummary | undefined;
    if (to) {
      const key = to.replace(/^@/, '').toLowerCase();
      target = this.agents.find((a) => a.id === key || a.name.toLowerCase() === key);
      if (!target) return fail(404, 'unknown_agent', `no agent called "${to}"`);
    }
    if (this.timers.size > 0) {
      return fail(
        409,
        'busy',
        tr(
          `${this.orchestrator.name} is still working: wait for it to finish or stop it, then start a new conversation.`,
          `${this.orchestrator.name} sta ancora lavorando: aspetta che finisca o fermalo, poi inizia una nuova conversazione.`,
        ),
      );
    }
    const event = this.append({
      agent: 'user',
      type: 'new_conversation',
      data: { ...(target ? { to: target.id } : {}), channel: 'ui' },
    });
    return ok({ id: event.id, ts: event.ts, ...(target ? { to: target.id } : {}) }, 201);
  }

  private status(): StatusResponse {
    return {
      version: MOCK_VERSION,
      halted: this.halted !== null,
      haltedAt: this.halted?.at ?? null,
      haltedReason: this.halted?.reason ?? null,
      runs: [],
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  /** `/api/drafts` (D-098): the drafts of every kind, newest first, each confirmed by its flow. */
  private drafts(method: string, path: string): RawResponse {
    const [kind, id, action] = path.split('/').slice(3).map(decodeURIComponent);
    if (method === 'GET' && kind === undefined) {
      return ok(
        [
          ...this.squad.drafts(),
          ...this.projects.drafts(),
          ...this.automations.draftViews(),
          ...this.docs.drafts(),
        ].sort((x, y) => y.createdAt - x.createdAt),
      );
    }
    if (method !== 'POST' || !id || (action !== 'confirm' && action !== 'discard')) {
      return fail(404, 'not_found');
    }
    if (kind === 'monster') return this.squad.draftAction(id, action);
    if (kind === 'project') return this.projects.draftAction(id, action);
    if (kind === 'automation') return this.automations.draftAction(id, action);
    if (kind === 'docs') return this.docs.draftAction(id, action);
    return fail(404, 'unknown_draft', tr('Unknown draft.', 'Bozza sconosciuta.'));
  }

  private agentsSnapshot(): AgentSummary[] {
    return this.agents.map((a) => {
      const l = this.live[a.id];
      const state: AgentSummary['state'] = this.halted
        ? 'stopped'
        : l?.mood === 'working' || l?.mood === 'talking'
          ? 'working'
          : l?.mood === 'waiting'
            ? 'waiting'
            : l?.mood === 'error'
              ? 'error'
              : l?.mood === 'stopped'
                ? 'stopped'
                : 'idle';
      const provider = this.providers.providerOf(a.id);
      return {
        ...a,
        state,
        ...(provider ? { provider } : {}),
        ...(l?.activity && state !== 'idle' ? { activity: l.activity } : {}),
        // Like the core (D-072): the confused face is in the snapshot.
        ...(l?.confused && (state === 'working' || state === 'waiting')
          ? { confusedSince: l.since }
          : {}),
        // Like the core (D-157): the open work items seed the app's live state.
        work: this.halted ? [] : [...(l?.work ?? [])],
      };
    });
  }

  /** A query of the chat's history (shared/src/chat-history.ts) over the mock's log. */
  private readonly chatQuery = (q: ChatHistoryQuery): LogEvent[] => {
    const params = new URLSearchParams({ limit: String(q.limit), order: q.order });
    if (q.agent) params.set('agent', q.agent.join(','));
    if (q.type) params.set('type', q.type.join(','));
    if (q.before) params.set('before', q.before);
    if (q.after) params.set('after', q.after);
    return this.queryEvents(params);
  };

  private queryEvents(q: URLSearchParams): LogEvent[] {
    const agents = q.get('agent')?.split(',').filter(Boolean);
    const types = q.get('type')?.split(',').filter(Boolean);
    const since = Number(q.get('since') ?? 0);
    const until = Number(q.get('until') ?? Infinity);
    const after = q.get('after');
    const before = q.get('before');
    const limit = Math.min(1000, Number(q.get('limit') ?? 200));
    const clientId = q.get('clientId');
    let list = this.events.filter(
      (e) =>
        (!agents || agents.includes(e.agent)) &&
        (!clientId || (e.data as { clientId?: unknown }).clientId === clientId) &&
        (!types || types.includes(e.type)) &&
        e.ts >= since &&
        e.ts <= until &&
        (!after || e.id > after) &&
        (!before || e.id < before),
    );
    if (q.get('order') === 'desc') list = list.slice().reverse();
    return list.slice(0, limit);
  }

  /**
   * "Stop" in one monster's chat (F-1), like the core: its open runs end (`kill` with `scope:
   * 'agent'` and `runsAborted: 1`, then `run aborted`); its open tasks in another monster's run
   * stop (`runsAborted: 0`, the delegation closes as aborted) while that run goes on. The
   * questions they asked close as `stopped`, a reply cut while it streamed as `aborted`.
   */
  private stopAgent(id: string): RawResponse {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) return fail(404, 'unknown_agent', `no agent called "${id}"`);
    const reason = tr(`You stopped ${agent.name}`, `Hai fermato ${agent.name}`);
    const runs = new Map<string, string>();
    const tasks = new Map<string, LogEvent<'delegation'>>();
    for (const e of this.events) {
      if (!e.runId) continue;
      if (e.type === 'run') {
        if (e.data.status === 'started') runs.set(e.runId, e.agent);
        else runs.delete(e.runId);
      } else if (e.type === 'delegation' && e.data.to === id) {
        const key = `${e.runId}:${e.data.from}`;
        if (e.data.status === 'started') tasks.set(key, e);
        else tasks.delete(key);
      }
    }
    const kill = (runId: string, runsAborted: 0 | 1) =>
      this.append({
        agent: id,
        runId,
        type: 'kill',
        data: {
          scope: 'agent',
          target: id,
          by: 'ui',
          reason,
          runsAborted,
          processesKilled: 0,
        },
      });
    /** What the monster left halfway in the run: its cut reply, its questions. */
    const closeOwn = (runId: string) => {
      const mine = this.events.filter(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' && e.runId === runId && e.agent === id && e.data.role === 'agent',
      );
      const cut: string[] = [];
      for (const m of mine) {
        if (m.data.partial) cut.push(m.data.text);
        else cut.length = 0;
      }
      if (cut.length > 0) {
        this.append({
          agent: id,
          runId,
          type: 'message',
          data: { role: 'agent', text: cut.join(''), status: 'aborted' },
        });
      }
      for (const q of this.questions.values()) {
        if (q.status !== 'open' || q.runId !== runId || q.from !== id) continue;
        q.status = 'expired';
        this.onAnswer.delete(q.id);
        this.append({
          agent: id,
          runId,
          type: 'question_expired',
          data: { questionId: q.id, reason: 'stopped' },
        });
      }
    };
    const stopped: string[] = [];
    for (const [runId, owner] of runs) {
      if (owner !== id) continue;
      kill(runId, 1);
      closeOwn(runId);
      // Its whole run: the questions of whoever worked in it too.
      for (const q of this.questions.values()) {
        if (q.status !== 'open' || q.runId !== runId) continue;
        q.status = 'expired';
        this.onAnswer.delete(q.id);
        this.append({
          agent: q.from,
          runId,
          type: 'question_expired',
          data: { questionId: q.id, reason: 'stopped' },
        });
      }
      this.append({ agent: id, runId, type: 'run', data: { status: 'aborted' } });
      this.stoppedWork.add(runId);
      stopped.push(runId);
    }
    let parts = 0;
    for (const task of tasks.values()) {
      const runId = task.runId!;
      if (!runs.has(runId) || stopped.includes(runId)) continue;
      kill(runId, 0);
      closeOwn(runId);
      this.append({
        agent: task.data.from,
        runId,
        type: 'delegation',
        data: {
          from: task.data.from,
          to: id,
          goal: task.data.goal,
          status: 'aborted',
          error: tr(`The user stopped ${agent.name}.`, `L’utente ha fermato ${agent.name}.`),
        },
      });
      this.stoppedWork.add(`${runId}:${id}`);
      parts++;
    }
    // Nothing else is running: the scripted steps still due are all of this work.
    if ([...runs].every(([runId, owner]) => owner === id || stopped.includes(runId))) {
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
    }
    const report: AgentStopResponse = {
      stopped: stopped.length,
      runs: stopped,
      parts,
      processesKilled: 0,
      sendsDropped: 0,
      giriSkipped: 0,
    };
    return ok(report);
  }

  private kill(reason: string | undefined): StatusResponse {
    if (!this.halted) {
      const active = this.agents.filter((a) => {
        const m = this.live[a.id]?.mood;
        return m === 'working' || m === 'talking' || m === 'waiting';
      });
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
      this.onAnswer.clear();
      this.halted = { at: Date.now(), reason: reason ?? null };
      this.append({
        agent: 'system',
        type: 'kill',
        data: { scope: 'global', by: 'ui', reason, runsAborted: active.length, processesKilled: 0 },
      });
      // Like the core: every active run logs its stop, in its run.
      for (const a of active) {
        const runId =
          this.events.findLast((e) => e.agent === a.id && e.runId !== null)?.runId ?? null;
        this.append({
          agent: a.id,
          runId,
          type: 'error',
          data: {
            code: 'aborted',
            message: tr(
              `${a.name}’s work stopped: you stopped all the monsters`,
              `Il lavoro di ${a.name} si è fermato: hai fermato tutti i mostri`,
            ),
          },
        });
        this.append({ agent: a.id, runId, type: 'run', data: { status: 'aborted' } });
      }
      for (const q of this.questions.values()) {
        if (q.status !== 'open') continue;
        q.status = 'expired';
        this.append({
          agent: q.from,
          runId: q.runId,
          type: 'question_expired',
          data: { questionId: q.id, reason: 'kill' },
        });
      }
    }
    return this.status();
  }

  private undo(actionId: string, force: boolean): RawResponse {
    const inVault = this.vault.undo(actionId, force);
    if (inVault) {
      if (inVault.status === 200) this.undone.add(actionId);
      return inVault;
    }
    const target = this.events.find(
      (e): e is LogEvent<'vault_change'> =>
        e.type === 'vault_change' && e.data.actionId === actionId,
    );
    if (!target) return fail(404, 'not_found');
    if (this.undone.has(actionId))
      return fail(400, 'invalid_input', `action ${actionId} was already undone`);
    this.undone.add(actionId);
    const commit = Math.random().toString(16).slice(2, 9);
    this.append({
      agent: 'user',
      type: 'vault_change',
      data: {
        action: 'undo',
        path: target.data.path,
        commit,
        actionId: `undo-${actionId}`,
        files: [target.data.path],
        undoneActionId: actionId,
      },
    });
    return ok({ ok: true, commit, files: [target.data.path] });
  }

  private answer(id: string, body: unknown): RawResponse {
    const q = this.questions.get(id);
    if (!q) return fail(404, 'not_found');
    const p = AnswerRequestSchema.safeParse(body);
    if (!p.success) return fail(400, 'invalid_request');
    if (q.status !== 'open') return fail(409, 'not_open', `question ${id} is ${q.status}`);
    q.status = 'answered';
    delete q.parked;
    q.answer = { optionId: p.data.optionId, text: p.data.text };
    this.append({
      agent: 'user',
      runId: q.runId,
      type: 'answer',
      data: { questionId: id, optionId: p.data.optionId, text: p.data.text, channel: 'ui' },
    });
    const label = q.options.find((o) => o.id === p.data.optionId)?.label ?? p.data.text ?? '';
    const next = this.onAnswer.get(id);
    this.onAnswer.delete(id);
    next?.(label);
    return ok(q);
  }

  private ask(
    agent: string,
    runId: string,
    question: string,
    options: Question['options'],
    recommended: string | undefined,
    then: (choice: string) => void,
    ts?: number,
  ): void {
    const questionId = `q_${ulid().slice(-10).toLowerCase()}`;
    const createdAt = ts ?? Date.now();
    this.questions.set(questionId, {
      id: questionId,
      from: agent,
      runId,
      question,
      options,
      ...(recommended !== undefined ? { recommended } : {}),
      blocking: true,
      status: 'open',
      createdAt,
    });
    this.onAnswer.set(questionId, then);
    this.append(
      {
        agent,
        runId,
        type: 'question',
        data: {
          questionId,
          question,
          options,
          ...(recommended !== undefined ? { recommended } : {}),
          blocking: true,
        },
      },
      createdAt,
    );
  }

  /* ------------------------------------------------------------ scenarios */

  /** The answers to the messages sent with a `clientId` (D-217). */
  private sentByClient = new Map<string, { runId: string; messageId: string }>();

  private receive(req: z.infer<typeof SendMessageRequestSchema>): {
    runId: string;
    messageId: string;
  } {
    const runId = `run_${ulid().slice(-12).toLowerCase()}`;
    const orch = this.orchestrator.id;
    const logged = this.append({
      agent: 'user',
      runId,
      type: 'message',
      data: {
        role: 'user',
        text: req.text,
        channel: 'ui',
        // Like the core, which logs the monster that gets it, the orchestrator included.
        to: req.to && this.agents.some((a) => a.id === req.to) ? req.to : orch,
        ...(req.resumeOf ? { resumeOf: req.resumeOf } : {}),
        ...(req.attachments?.length ? { attachments: req.attachments } : {}),
        ...(req.clientId ? { clientId: req.clientId } : {}),
      },
    });
    const target = req.to && this.agents.some((a) => a.id === req.to) ? req.to : orch;
    if (req.attachments?.length) {
      // Files (D-075): the monster says what it received.
      this.attachmentReply(target, runId, req.attachments.length);
    } else if (/\b(screenshot|pagina html)\b/i.test(req.text)) {
      // A monster saves a screenshot of the browser, or makes a page (D-075).
      this.fileRun(target, runId, /screenshot/i.test(req.text) ? 'screenshot' : 'page');
    } else if (/\b(pubblica|publish)/i.test(req.text)) {
      // The brake on the actions that leave the computer, from any chat.
      this.outboundRun(orch, runId, req.text);
    } else if (/\b(tetto|spesa|spendi|spending|spend|cap)\b/i.test(req.text)) {
      // The spending cap (D-070): a paid job that reaches it, in any chat.
      this.spendRun(req.to && this.agents.some((a) => a.id === req.to) ? req.to : orch, runId);
    } else if (req.to && req.to !== orch && this.agents.some((a) => a.id === req.to)) {
      this.directReply(req.to, runId, req.text);
    } else if (/errore|rompi|error|break/i.test(req.text)) {
      this.failingRun(orch, runId);
    } else if (/\bmenu\b/i.test(req.text)) {
      this.openQuestionRun(orch, runId, req.text);
    } else if (
      /\b(nuovo mostro|crea(re)?\s+un\s+mostro|new monster|create\s+a\s+monster)\b/i.test(req.text)
    ) {
      this.proposalRun(orch, runId);
    } else if (/\b(volantin|flyer)/i.test(req.text)) {
      this.parkedQuestionRun(orch, runId, req.text);
    } else {
      this.mainScenario(orch, runId, req.text);
    }
    return { runId, messageId: logged.id };
  }

  private attachmentReply(agent: string, runId: string, count: number): void {
    this.schedule([
      [
        200,
        () =>
          this.append({
            agent,
            runId,
            type: 'run',
            data: { status: 'started', goal: tr('Attachments', 'Allegati') },
          }),
      ],
      [10, () => this.modelStep(agent, runId, 0, 0)],
      ...this.streamSteps(
        agent,
        runId,
        count === 1
          ? tr(
              'Got the file: I’ll take a look and tell you what I think.',
              'Ho ricevuto il file: lo guardo e ti dico cosa ne penso.',
            )
          : tr(
              `Got ${count} files: I’ll go through them one by one.`,
              `Ho ricevuto ${count} file: li guardo uno per uno.`,
            ),
      ),
      [300, () => this.append({ agent, runId, type: 'run', data: { status: 'completed' } })],
    ]);
  }

  private fileRun(agent: string, runId: string, what: 'screenshot' | 'page'): void {
    this.schedule([
      [
        200,
        () => this.append({ agent, runId, type: 'run', data: { status: 'started', goal: what } }),
      ],
      [10, () => this.modelStep(agent, runId, 0, 0)],
      [
        500,
        () =>
          what === 'screenshot'
            ? this.files.seedScreenshot(agent, runId, Date.now())
            : this.files.seedPage(agent, runId, Date.now()),
      ],
      ...this.streamSteps(
        agent,
        runId,
        what === 'screenshot'
          ? tr(
              'Here’s the screenshot of the page: you’ll also find it in Files.',
              'Ecco lo screenshot della pagina: lo trovi anche tra i File.',
            )
          : tr(
              'I made the page: open it from the chat or from Files.',
              'Ho creato la pagina: la apri dalla chat o dai File.',
            ),
      ),
      [300, () => this.append({ agent, runId, type: 'run', data: { status: 'completed' } })],
    ]);
  }

  private directReply(agent: string, runId: string, text: string): void {
    const name = this.agents.find((a) => a.id === agent)?.name ?? agent;
    this.schedule([
      [
        200,
        () => this.append({ agent, runId, type: 'run', data: { status: 'started', goal: text } }),
      ],
      [
        500,
        () =>
          this.append({
            agent,
            runId,
            type: 'tool_call',
            data: { callId: 'c-direct', tool: 'vault_search', input: { query: text.slice(0, 40) } },
          }),
      ],
      [10, () => this.modelStep(agent, runId, 0, 0)],
      [
        700,
        () =>
          this.append({
            agent,
            runId,
            type: 'tool_result',
            data: {
              callId: 'c-direct',
              tool: 'vault_search',
              ok: true,
              output: { hits: 2 },
              durationMs: 180,
            },
          }),
      ],
      [10, () => this.modelStep(agent, runId, 1, 1)],
      ...this.streamSteps(
        agent,
        runId,
        tr(
          `Hi! I’m ${name}. I looked through the notes: there are already two useful ones, I’ll keep them in mind. Tell me if you want me to dig deeper.`,
          `Ciao! Sono ${name}. Ho guardato nelle note: ci sono già due appunti utili, li tengo presenti. Dimmi pure se vuoi che vada più a fondo.`,
        ),
      ),
      [300, () => this.append({ agent, runId, type: 'run', data: { status: 'completed' } })],
    ]);
  }

  /**
   * "Crea un mostro che…" (D-075): the capo squadra proposes one with
   * `team_propose_monster`, the card waits for the user, the run ends at once.
   */
  private proposalRun(orch: string, runId: string): void {
    const draft = this.squad.proposalDraft({
      name: 'Lyra',
      title: tr('the archivist', 'l’archivista'),
      role: tr('keeps ideas in order', 'tiene in ordine le idee'),
      mission: tr(
        'you gather scattered ideas and turn them into tidy, linked notes',
        'raccogli le idee sparse e le trasformi in note ordinate e collegate',
      ),
      duties: [
        tr(
          'One note per idea, with links to the nearby notes.',
          'Una nota per idea, con i collegamenti alle note vicine.',
        ),
      ],
      area: 'Idee',
      web: false,
    });
    const input = { name: draft.name, role: draft.role, mission: draft.mission, area: 'Idee' };
    this.schedule([
      [
        200,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'run',
            data: { status: 'started', goal: tr('A new monster', 'Un nuovo mostro') },
          }),
      ],
      [
        500,
        () => {
          const call = this.append({
            agent: orch,
            runId,
            type: 'tool_call',
            data: { callId: 'c-propose', tool: 'team_propose_monster', input },
          });
          const proposed = this.append({
            agent: orch,
            runId,
            parentId: call.id,
            type: 'monster_proposal',
            data: { action: 'proposed', from: orch, draft },
          });
          this.squad.registerProposal(proposed.id, orch, draft.name, draft);
          this.append({
            agent: orch,
            runId,
            type: 'tool_result',
            data: {
              callId: 'c-propose',
              tool: 'team_propose_monster',
              ok: true,
              output: { status: 'proposed', proposal_id: proposed.id, name: draft.name },
              durationMs: 12,
            },
          });
        },
      ],
      ...this.streamSteps(
        orch,
        runId,
        tr(
          'I prepared **Lyra**, the archivist, who keeps ideas in order in the Idee folder. If you like, create her with one tap from the card.',
          'Ti ho preparato **Lyra**, l’archivista: tiene in ordine le idee nella cartella Idee. Se ti va, la crei con un tocco dalla scheda.',
        ),
      ),
      [300, () => this.append({ agent: orch, runId, type: 'run', data: { status: 'completed' } })],
    ]);
  }

  /** A fact only the user knows: an open question (no options), then the reply. */
  private openQuestionRun(orch: string, runId: string, text: string): void {
    this.schedule([
      [
        200,
        () =>
          this.append({ agent: orch, runId, type: 'run', data: { status: 'started', goal: text } }),
      ],
      [
        400,
        () =>
          this.ask(
            orch,
            runId,
            tr('Which dishes are on the menu?', 'Quali piatti ci sono nel menu?'),
            [],
            undefined,
            (answer) =>
              this.schedule([
                ...this.streamSteps(
                  orch,
                  runId,
                  tr(
                    `Thanks! I’ll prepare the drafts with these dishes: ${answer}.`,
                    `Grazie! Preparo le bozze con questi piatti: ${answer}.`,
                  ),
                ),
                [
                  300,
                  () =>
                    this.append({ agent: orch, runId, type: 'run', data: { status: 'completed' } }),
                ],
              ]),
          ),
      ],
    ]);
  }

  /**
   * A question that waits for the user with no run behind it (D-078, a
   * monster on a subscription): the turn ends at once, "aspetta te"; the
   * answer starts a new run.
   */
  private parkedQuestionRun(orch: string, runId: string, text: string): void {
    this.schedule([
      [
        200,
        () =>
          this.append({ agent: orch, runId, type: 'run', data: { status: 'started', goal: text } }),
      ],
      [
        400,
        () =>
          this.ask(
            orch,
            runId,
            tr('What format for the flyer?', 'Che formato per il volantino?'),
            [
              {
                id: '1',
                label: tr('Tabletop A5', 'A5 da banco'),
                description: tr('Two sides, photo of the dish', 'Due facciate, foto del piatto'),
              },
              {
                id: '2',
                label: tr('A3 poster', 'Locandina A3'),
                description: tr('One side, large text', 'Una facciata, testo grande'),
              },
            ],
            '1',
            (answer) => {
              const next = `run_${ulid().slice(-12).toLowerCase()}`;
              this.schedule([
                [
                  200,
                  () =>
                    this.append({
                      agent: orch,
                      runId: next,
                      type: 'run',
                      data: {
                        status: 'started',
                        goal: tr(`Answer: ${answer}`, `Risposta: ${answer}`),
                      },
                    }),
                ],
                ...this.streamSteps(
                  orch,
                  next,
                  tr(
                    `Perfect: I’ll prepare the flyer as ${answer}.`,
                    `Perfetto: preparo il volantino in ${answer}.`,
                  ),
                ),
                [
                  300,
                  () =>
                    this.append({
                      agent: orch,
                      runId: next,
                      type: 'run',
                      data: { status: 'completed' },
                    }),
                ],
              ]);
            },
          ),
      ],
      ...this.streamSteps(
        orch,
        runId,
        tr(
          'I asked you for the format: I’m waiting for your answer.',
          'Ti ho chiesto il formato: aspetto la tua risposta.',
        ),
      ),
      [
        200,
        () => {
          const q = [...this.questions.values()].find(
            (x) => x.runId === runId && x.status === 'open',
          );
          if (!q) return;
          q.parked = true;
          this.append({
            agent: orch,
            runId,
            type: 'question_parked',
            data: { questionId: q.id, reason: 'harness' },
          });
          this.append({ agent: orch, runId, type: 'run', data: { status: 'waiting_user' } });
        },
      ],
    ]);
  }

  /**
   * The brake on the actions that leave the computer (D-067): Dione wants to
   * publish, the instinct holds the call and asks ("Dione vuole …, cioè pubblicare. Procedo?").
   */
  private outboundRun(orch: string, runId: string, text: string): void {
    const goal = tr(
      'Publish the post “Tram 28 at dawn” on Instagram',
      'Pubblica il post «Tram 28 all’alba» su Instagram',
    );
    const summary = tr(
      'publish the post “Tram 28 at dawn” on Instagram',
      'pubblicare il post «Tram 28 all’alba» su Instagram',
    );
    const details = { tool: 'mcp__instagram__create_post', category: 'publish', summary };
    let parentId: string | null = null;
    let callEvent = '';
    const finish = (yes: boolean) =>
      this.schedule([
        [
          300,
          () => {
            this.append({
              agent: 'system',
              runId,
              parentId: callEvent,
              type: 'instinct',
              data: {
                use: 'outbound',
                action: yes ? 'outbound_approved' : 'outbound_refused',
                message: yes
                  ? tr(`You said yes: Dione can ${summary}.`, `Hai detto sì: Dione può ${summary}.`)
                  : tr(
                      `You said no: Dione won’t ${summary}.`,
                      `Hai detto no: Dione non farà ${summary}.`,
                    ),
                subject: 'dione',
                details: { ...details, outcome: yes ? 'approved' : 'refused' },
              },
            });
            this.append({
              agent: 'dione',
              runId,
              parentId,
              type: 'tool_result',
              data: yes
                ? {
                    callId: 'c-pub',
                    tool: 'mcp__instagram__create_post',
                    ok: true,
                    durationMs: 640,
                  }
                : {
                    callId: 'c-pub',
                    tool: 'mcp__instagram__create_post',
                    ok: false,
                    error: 'USER_DECLINED: the user said no to this action',
                  },
            });
          },
        ],
        [
          300,
          () =>
            this.append({
              agent: orch,
              runId,
              type: 'delegation',
              data: {
                from: orch,
                to: 'dione',
                status: 'completed',
                goal,
                summary: yes
                  ? tr('Post published', 'Post pubblicato')
                  : tr('Not published: you said no', 'Non pubblicato: hai detto no'),
              },
            }),
        ],
        ...this.streamSteps(
          orch,
          runId,
          yes
            ? tr(
                'Done: Dione published the post on Instagram.',
                'Fatto: Dione ha pubblicato il post su Instagram.',
              )
            : tr(
                'Okay, no publishing: the post stays in the drafts.',
                'Va bene, niente pubblicazione: il post resta tra le bozze.',
              ),
        ),
        [
          200,
          () => this.append({ agent: orch, runId, type: 'run', data: { status: 'completed' } }),
        ],
      ]);
    this.schedule([
      [
        200,
        () =>
          this.append({ agent: orch, runId, type: 'run', data: { status: 'started', goal: text } }),
      ],
      [
        300,
        () => {
          parentId = this.append({
            agent: orch,
            runId,
            type: 'delegation',
            data: { from: orch, to: 'dione', status: 'started', goal },
          }).id;
        },
      ],
      [
        500,
        () => {
          callEvent = this.append({
            agent: 'dione',
            runId,
            parentId,
            type: 'tool_call',
            data: {
              callId: 'c-pub',
              tool: 'mcp__instagram__create_post',
              input: {
                caption: tr('Tram 28 at dawn', 'Tram 28 all’alba'),
                image: tr('Drafts/tram28.jpg', 'Bozze/tram28.jpg'),
              },
            },
          }).id;
          this.append({
            agent: 'system',
            runId,
            parentId: callEvent,
            type: 'instinct',
            data: {
              use: 'outbound',
              action: 'outbound_hold',
              message: tr(
                `Dione wants to ${summary}: waiting for your answer.`,
                `Dione vuole ${summary}: aspetta la tua risposta.`,
              ),
              subject: 'dione',
              confidence: 0.93,
              details,
            },
          });
          this.ask(
            'dione',
            runId,
            tr(`Dione wants to ${summary}. Go ahead?`, `Dione vuole ${summary}. Procedo?`),
            [
              {
                id: '1',
                label: tr('Yes, go ahead', 'Sì, procedi'),
                description: tr('Just this action', 'Solo questa azione'),
              },
              {
                id: '2',
                label: tr('No, don’t do it', 'No, non farlo'),
                description: tr('The monster carries on without it', 'Il mostro va avanti senza'),
              },
            ],
            undefined,
            (choice) => finish(/^(s[iì]|yes)/i.test(choice)),
          );
        },
      ],
    ]);
  }

  /**
   * Rhea works with a paid model and the team reaches its cap of today: the
   * 80% warning, the stop, and a clear sentence with "Alza il tetto".
   */
  private spendRun(orch: string, runId: string): void {
    const name = this.agents.find((a) => a.id === orch)?.name ?? orch;
    const stopped = () => {
      const why =
        this.spend.stopReason('rhea') ??
        tr(
          'all monsters’ spending cap for today was reached',
          'raggiunto il tetto di spesa di tutti i mostri di oggi',
        );
      this.append({
        agent: orch,
        runId,
        type: 'error',
        data: {
          code: 'spend_cap',
          message: tr(
            `${name} stops: ${why}. To let it continue, raise the cap in Settings → Models.`,
            `${name} si ferma: ${why}. Per farlo continuare alza il tetto in Impostazioni → Modelli.`,
          ),
        },
      });
      this.append({ agent: orch, runId, type: 'run', data: { status: 'failed', error: why } });
    };
    const already = this.spend.stopReason('rhea') !== null;
    this.schedule([
      [200, () => this.append({ agent: orch, runId, type: 'run', data: { status: 'started' } })],
      ...(already
        ? ([[300, stopped]] as Step[])
        : ([
            [500, () => this.spend.charge('rhea', 8.2, runId)],
            [700, () => this.spend.charge('rhea', 1.6, runId)],
            [300, stopped],
          ] as Step[])),
    ]);
  }

  private failingRun(orch: string, runId: string): void {
    this.schedule([
      [200, () => this.append({ agent: orch, runId, type: 'run', data: { status: 'started' } })],
      [
        600,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'tool_call',
            data: {
              callId: 'c-fail',
              tool: 'web_fetch',
              input: {
                url: tr('https://example.invalid/report', 'https://esempio.invalid/report'),
              },
            },
          }),
      ],
      [
        900,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'tool_result',
            data: {
              callId: 'c-fail',
              tool: 'web_fetch',
              ok: false,
              error: tr('ENOTFOUND example.invalid', 'ENOTFOUND esempio.invalid'),
              durationMs: 840,
            },
          }),
      ],
      [
        300,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'error',
            data: {
              code: 'agent_failed',
              message: tr(
                'I can’t open the page: the site isn’t responding.',
                'Non riesco ad aprire la pagina: il sito non risponde.',
              ),
            },
          }),
      ],
      [
        100,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'run',
            data: { status: 'failed', error: 'site down' },
          }),
      ],
    ]);
  }

  private mainScenario(orch: string, runId: string, text: string): void {
    const topic = /lisbon/i.test(text)
      ? tr('Lisbon', 'Lisbona')
      : tr('your project', 'il tuo progetto');
    const noteAction = `act_${ulid().slice(-8).toLowerCase()}`;
    const notePath = tr(`Resources/Tips on ${topic}.md`, `Risorse/Spunti su ${topic}.md`);
    this.schedule([
      [
        250,
        () => {
          this.append({ agent: orch, runId, type: 'run', data: { status: 'started', goal: text } });
          // The instinct's hint to the lead (D-067): "Ci pensa Rhea".
          this.append({
            agent: 'system',
            runId,
            type: 'instinct',
            data: {
              use: 'route_hint',
              action: 'route_hint',
              message: tr(
                'I suggested handing the request to Rhea.',
                'Ho suggerito di affidare la richiesta a Rhea.',
              ),
              subject: orch,
              confidence: 0.82,
              details: { route: 'Rhea' },
            },
          });
        },
      ],
      ...this.streamSteps(
        orch,
        runId,
        tr(
          `Got it! I’ll ask Rhea to gather a few tips on ${topic}, then let you know.`,
          `Ricevuto! Chiedo a Rhea di raccogliere qualche spunto su ${topic}, poi ti faccio sapere.`,
        ),
      ).slice(0, -1),
      [
        200,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'tool_call',
            data: {
              callId: 'c-del',
              tool: 'delegate',
              input: {
                to: 'rhea',
                goal: tr(`Find 5 tips on ${topic}`, `Trova 5 spunti su ${topic}`),
              },
            },
          }),
      ],
      [
        150,
        () => {
          const del = this.append({
            agent: orch,
            runId,
            type: 'delegation',
            data: {
              from: orch,
              to: 'rhea',
              status: 'started',
              goal: tr(`Find 5 tips on ${topic}`, `Trova 5 spunti su ${topic}`),
              why: tr('We need checked ideas for the posts', 'Servono idee verificate per i post'),
              doneWhen: tr(
                'A note with 5 tips and the sources',
                'Una nota con 5 spunti e le fonti',
              ),
            },
          });
          this.rheaWork(runId, del.id, topic, notePath, noteAction, () =>
            this.afterResearch(orch, runId, topic),
          );
        },
      ],
    ]);
  }

  private rheaWork(
    runId: string,
    parentId: string,
    topic: string,
    notePath: string,
    actionId: string,
    done: () => void,
  ): void {
    const agent = 'rhea';
    const query = tr(`${topic} what to see in a weekend`, `${topic} cosa vedere in un weekend`);
    this.schedule([
      [
        400,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'message',
            data: {
              role: 'agent',
              text: tr(
                'I’ll start from the web, then save everything in a note. ',
                'Parto dal web, poi salvo tutto in una nota. ',
              ),
              partial: true,
            },
          }),
      ],
      [
        300,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'tool_call',
            data: { callId: 'c-ws', tool: 'web_search', input: { query, maxResults: 5 } },
          }),
      ],
      [
        900,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'tool_result',
            data: {
              callId: 'c-ws',
              tool: 'web_search',
              ok: true,
              durationMs: 870,
              output: {
                results: [
                  {
                    title: tr(`${topic}: 10 things to do`, `${topic}: 10 cose da fare`),
                    url: tr('https://www.visitlisboa.com/en', 'https://www.visitlisboa.com/it'),
                  },
                  {
                    title: tr('The most beautiful miradouros', 'I miradouros più belli'),
                    url: 'https://example.org/miradouros',
                  },
                  {
                    title: tr('Tram 28: a practical guide', 'Tram 28, guida pratica'),
                    url: 'https://example.org/tram-28',
                  },
                ],
              },
            },
          }),
      ],
      [
        500,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'tool_call',
            data: {
              callId: 'c-vc',
              tool: 'vault_write',
              input: { path: notePath, tags: tr(['tips', 'social'], ['spunti', 'social']) },
            },
          }),
      ],
      [
        400,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'vault_change',
            data: { action: 'create', path: notePath, commit: '7f3c2a1', actionId },
          }),
      ],
      [
        100,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'tool_result',
            data: {
              callId: 'c-vc',
              tool: 'vault_write',
              ok: true,
              output: { path: notePath },
              durationMs: 42,
            },
          }),
      ],
      [
        300,
        () =>
          this.append({
            agent,
            runId,
            parentId,
            type: 'message',
            data: {
              role: 'agent',
              text: tr(
                `Done: 5 tips with sources in the note ${notePath}.`,
                `Fatto: 5 spunti con le fonti nella nota ${notePath}.`,
              ),
            },
          }),
      ],
      [
        200,
        () => {
          this.append({
            agent: 'titan',
            runId,
            type: 'delegation',
            data: {
              from: 'titan',
              to: 'rhea',
              status: 'completed',
              goal: tr(`Find 5 tips on ${topic}`, `Trova 5 spunti su ${topic}`),
              summary: tr(
                `5 tips saved in “Tips on ${topic}”`,
                `5 spunti salvati in “Spunti su ${topic}”`,
              ),
            },
          });
          // Like the core: the delegate call returns when the delegated work is done.
          this.append({
            agent: 'titan',
            runId,
            type: 'tool_result',
            data: {
              callId: 'c-del',
              tool: 'delegate',
              ok: true,
              output: tr(
                `5 tips saved in “Tips on ${topic}”`,
                `5 spunti salvati in “Spunti su ${topic}”`,
              ),
            },
          });
          done();
        },
      ],
    ]);
  }

  private afterResearch(orch: string, runId: string, topic: string): void {
    this.schedule([
      [
        500,
        () =>
          this.ask(
            orch,
            runId,
            tr(
              `Rhea found 5 tips on ${topic}. What tone should we give the posts?`,
              `Rhea ha trovato 5 spunti su ${topic}. Che tono diamo ai post?`,
            ),
            toneOptions(),
            'amichevole',
            (choice) => this.writePosts(orch, runId, choice),
          ),
      ],
    ]);
  }

  private writePosts(orch: string, runId: string, choice: string): void {
    const actionId = `act_${ulid().slice(-8).toLowerCase()}`;
    const path = notePath('socialPosts');
    const postsLink = path.replace(/\.md$/, '');
    const goal = tr(
      `Write 3 posts in a ${choice.toLowerCase()} tone`,
      `Scrivi 3 post con tono ${choice.toLowerCase()}`,
    );
    this.schedule([
      [
        300,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'delegation',
            data: {
              from: orch,
              to: 'dione',
              status: 'started',
              goal,
            },
          }),
      ],
      [
        700,
        () =>
          this.append({
            agent: 'dione',
            runId,
            parentId: null,
            type: 'tool_call',
            data: { callId: 'c-ed', tool: 'vault_edit', input: { path } },
          }),
      ],
      [
        500,
        () =>
          this.append({
            agent: 'dione',
            runId,
            type: 'vault_change',
            data: { action: 'edit', path, commit: 'b81d0e4', actionId },
          }),
      ],
      [
        100,
        () =>
          this.append({
            agent: 'dione',
            runId,
            type: 'tool_result',
            data: { callId: 'c-ed', tool: 'vault_edit', ok: true, durationMs: 35 },
          }),
      ],
      [
        300,
        () =>
          this.append({
            agent: orch,
            runId,
            type: 'delegation',
            data: {
              from: orch,
              to: 'dione',
              status: 'completed',
              goal,
              summary: tr('3 drafts ready', '3 bozze pronte'),
            },
          }),
      ],
      ...this.streamSteps(
        orch,
        runId,
        tr(
          [
            `All done! Dione wrote 3 posts in a ${choice.toLowerCase()} tone: you’ll find them in [[${postsLink}|Post drafts]].`,
            '',
            '### The drafts',
            '1. **Tram 28 at dawn**: the classic ride, before the crowds.',
            '2. **Pastéis de Belém**: the breakfast that tastes like vacation.',
            '3. **Sunset at the miradouro**: the last photo of the weekend.',
            '',
            '| Post | Day | Suggested time |',
            '| --- | --- | --- |',
            '| Tram 28 | Saturday | 9:00 |',
            '| Pastéis | Saturday | 13:00 |',
            '| Miradouro | Sunday | 19:30 |',
            '',
            `Hashtags: \`#Lisbon\` \`#weekend\`. The sources are in [[${noteTitle('lisbonTips')}]] and on the [tourism website](https://www.visitlisboa.com).`,
            'Do you want me to schedule them at these times?',
          ],
          [
            `Ecco fatto! Dione ha scritto 3 post con tono ${choice.toLowerCase()}: li trovi in [[${postsLink}|Bozze dei post]].`,
            '',
            '### Le bozze',
            '1. **Tram 28 all’alba**: il giro classico, prima della folla.',
            '2. **Pastéis de Belém**: la colazione che sa di vacanza.',
            '3. **Tramonto al miradouro**: l’ultima foto del weekend.',
            '',
            '| Post | Giorno | Ora consigliata |',
            '| --- | --- | --- |',
            '| Tram 28 | sabato | 9:00 |',
            '| Pastéis | sabato | 13:00 |',
            '| Miradouro | domenica | 19:30 |',
            '',
            `Hashtag: \`#Lisbona\` \`#weekend\`. Le fonti sono in [[${noteTitle('lisbonTips')}]] e sul [sito del turismo](https://www.visitlisboa.com).`,
            'Vuoi che li programmi a questi orari?',
          ],
        ).join('\n'),
      ),
      [200, () => this.append({ agent: orch, runId, type: 'run', data: { status: 'completed' } })],
    ]);
  }

  /**
   * Ambient life of the team: every few seconds an idle monster does a small
   * job (tool calls, a note, sometimes a hiccup), sometimes handed over by the
   * orchestrator. Its own timer, so it outlives a kill; while halted it rests.
   */
  private startAmbient(): void {
    const rng = createRng(0xa11ce);
    const loop = () => {
      const t = setTimeout(loop, rng.range(2600, 4800) * this.speed);
      void t;
      if (this.halted) return;
      const free = this.agents.filter(
        (a) =>
          !a.isOrchestrator &&
          !['working', 'talking', 'waiting'].includes(this.live[a.id]?.mood ?? 'idle'),
      );
      const busy = this.agents.length - free.length;
      if (free.length === 0 || busy > Math.ceil(this.agents.length / 2)) return;
      const agent = rng.pick(free);
      const jobs = ambientJobs().filter((j) => j.agent === agent.id);
      if (jobs.length === 0) return;
      this.ambientJob(rng.pick(jobs), rng.chance(0.35), rng.chance(0.15), rng.next());
    };
    setTimeout(loop, 1200 * this.speed);
  }

  private ambientJob(job: AmbientJob, delegated: boolean, fails: boolean, jitter: number): void {
    // Now and then a monster goes round in circles (the instinct sees it, D-067).
    const stuck = !fails && jitter > 0.72;
    const runId = `run_ambient_${ulid().slice(-8).toLowerCase()}`;
    const orch = this.orchestrator.id;
    const steps: Step[] = [];
    let parentId: string | null = null;
    if (delegated) {
      steps.push([
        0,
        () => {
          parentId = this.append({
            agent: orch,
            runId,
            type: 'delegation',
            data: { from: orch, to: job.agent, status: 'started', goal: job.goal },
          }).id;
        },
      ]);
    } else {
      steps.push([
        0,
        () =>
          this.append({
            agent: job.agent,
            runId,
            type: 'run',
            data: { status: 'started', goal: job.goal },
          }),
      ]);
    }
    job.tools.forEach((tool, i) => {
      const callId = `${runId}_${i}`;
      steps.push([
        1700 + 900 * jitter,
        () =>
          this.append({
            agent: job.agent,
            runId,
            parentId,
            type: 'tool_call',
            data: { callId, tool: tool.tool, input: tool.input },
          }),
      ]);
      steps.push([
        1100,
        () =>
          this.append({
            agent: job.agent,
            runId,
            parentId,
            type: 'tool_result',
            data: { callId, tool: tool.tool, ok: true, durationMs: 420 },
          }),
      ]);
      if (stuck && i === 0)
        steps.push([
          300,
          () =>
            this.append({
              agent: 'system',
              runId,
              parentId,
              type: 'instinct',
              data: {
                use: 'stuck',
                action: 'stuck_nudge',
                message: tr(
                  `${job.agent} was going round in circles: I asked it to try another way.`,
                  `${job.agent} girava a vuoto: gli ho chiesto di cambiare strada.`,
                ),
                subject: job.agent,
                confidence: 0.88,
              },
            }),
        ]);
      if (tool.writes) {
        const path = tool.writes;
        steps.push([
          60,
          () =>
            this.append({
              agent: job.agent,
              runId,
              parentId,
              type: 'vault_change',
              data: { action: tool.tool === 'vault_write' ? 'create' : 'edit', path },
            }),
        ]);
      }
    });
    steps.push([
      1500,
      () => {
        if (fails) {
          this.append({
            agent: job.agent,
            runId,
            parentId,
            type: 'error',
            data: { code: 'agent_failed', message: job.oops },
          });
        }
        if (delegated) {
          this.append({
            agent: orch,
            runId,
            type: 'delegation',
            data: {
              from: orch,
              to: job.agent,
              status: fails ? 'failed' : 'completed',
              goal: job.goal,
              ...(fails ? { error: job.oops } : { summary: tr('Done', 'Fatto') }),
            },
          });
          this.append({ agent: orch, runId, type: 'run', data: { status: 'completed' } });
        } else {
          // Its own job: a word in its chat when it is done.
          if (!fails)
            this.append({
              agent: job.agent,
              runId,
              type: 'message',
              data: { role: 'agent', text: tr(`Done: “${job.goal}”.`, `Fatto: “${job.goal}”.`) },
            });
          this.append({
            agent: job.agent,
            runId,
            type: 'run',
            data: fails ? { status: 'failed', error: job.oops } : { status: 'completed' },
          });
        }
      },
    ]);
    this.schedule(steps);
  }

  /** History for `?mock=demo`: a conversation in progress with an open question. */
  /** A long job of tool calls, after everything else: it fills the newest pages of the log. */
  private seedNoise(steps: number): void {
    const last = this.events.reduce((t, e) => Math.max(t, e.ts), Date.now() - 60_000);
    let t = last;
    const runId = 'run_seed_noise';
    const step = () => (t += 1);
    this.append(
      { agent: 'enceladus', runId, type: 'run', data: { status: 'started', goal: 'Index' } },
      step(),
    );
    for (let i = 0; i < steps; i++) {
      this.append(
        {
          agent: 'enceladus',
          runId,
          type: 'tool_call',
          data: { callId: `n${i}`, tool: 'vault_list', input: {} },
        },
        step(),
      );
    }
    this.append({ agent: 'enceladus', runId, type: 'run', data: { status: 'completed' } }, step());
  }

  /**
   * The previous conversations of the demo (the chat plan of 27/10): two of Titan's and one
   * of Dione's, weeks before the rest, each closed by a "New conversation" of its chat.
   */
  private seedPastConversations(): void {
    const day = 24 * 3_600_000;
    const talk = (
      agent: string,
      runId: string,
      start: number,
      turns: [user: string, reply: string][],
    ): number => {
      let t = start;
      for (const [i, [asked, answer]] of turns.entries()) {
        const run = `${runId}_${i}`;
        this.append(
          {
            agent: 'user',
            runId: run,
            type: 'message',
            data: { role: 'user', text: asked, to: agent, channel: 'ui' },
          },
          (t += 60_000),
        );
        this.append(
          { agent, runId: run, type: 'run', data: { status: 'started', goal: asked } },
          (t += 500),
        );
        this.append(
          { agent, runId: run, type: 'message', data: { role: 'agent', text: answer } },
          (t += 40_000),
        );
        this.append({ agent, runId: run, type: 'run', data: { status: 'completed' } }, (t += 100));
      }
      this.append(
        { agent: 'user', type: 'new_conversation', data: { to: agent, channel: 'ui' } },
        (t += 3 * 3_600_000),
      );
      return t;
    };
    const now = Date.now();
    talk('titan', 'run_past_porto', now - 26 * day, [
      [
        tr(
          'Can you plan a weekend in Porto for two? We leave Friday evening, train or plane, whichever is easier.',
          'Mi organizzi un weekend a Porto per due? Partiamo venerdì sera, treno o aereo, quello che è più comodo.',
        ),
        tr(
          'The plane is easier: a direct flight on Friday at 19:40, back on Sunday at 21:10. I’ve put three days of walks, two dinners and a port cellar in **Viaggi/Porto**.',
          'Meglio l’aereo: un volo diretto venerdì alle 19:40, ritorno domenica alle 21:10. Ho messo tre giorni di passeggiate, due cene e una cantina di porto in **Viaggi/Porto**.',
        ),
      ],
      [
        tr(
          'Don’t book anything yet: just a list of hotels near Ribeira.',
          'Non prenotare niente: solo una lista di hotel vicino a Ribeira.',
        ),
        tr(
          'Here are five, from 95 to 180 € a night, in the same note. None booked.',
          'Eccone cinque, da 95 a 180 € a notte, nella stessa nota. Nessuno prenotato.',
        ),
      ],
    ]);
    talk('dione', 'run_past_captions', now - 21 * day, [
      [
        tr(
          'Dione, three captions for the Lisbon photos: short and a bit ironic.',
          'Dione, tre didascalie per le foto di Lisbona: brevi e un po’ ironiche.',
        ),
        tr(
          '1. *Uphill, always uphill.*\n2. *The tram was full, so was I (of pastéis).*\n3. *Seven hills, zero regrets.*',
          '1. *In salita, sempre in salita.*\n2. *Il tram era pieno, io pure (di pastéis).*\n3. *Sette colli, zero rimpianti.*',
        ),
      ],
    ]);
    talk('titan', 'run_past_newsletter', now - 18 * day, [
      [
        tr(
          'Remind me what we decided for the Saturday newsletter: weekly or monthly?',
          'Ricordami cosa avevamo deciso per la newsletter di Saturday: settimanale o mensile?',
        ),
        tr(
          'Monthly, on the first Monday: it’s in **Progetti/Newsletter** since the 3rd.',
          'Mensile, il primo lunedì del mese: è in **Progetti/Newsletter** dal 3.',
        ),
      ],
    ]);
  }

  private seedDemo(): void {
    const now = Date.now();
    let t = now - 42 * 60_000;
    const at = (minutes: number) => (t += minutes * 60_000);
    const orch = 'titan';

    const r0 = 'run_seed_morning';
    this.append(
      {
        agent: 'enceladus',
        runId: r0,
        type: 'run',
        data: {
          status: 'started',
          goal: tr('Tidy up today’s journal', 'Riordina il diario di oggi'),
        },
      },
      at(0),
    );
    this.append(
      {
        agent: 'enceladus',
        runId: r0,
        type: 'tool_call',
        data: { callId: 's1', tool: 'vault_edit', input: { path: notePath('diary') } },
      },
      at(0.2),
    );
    this.append(
      {
        agent: 'enceladus',
        runId: r0,
        type: 'vault_change',
        data: {
          action: 'edit',
          path: notePath('diary'),
          commit: '1a2b3c4',
          actionId: 'act_seed_diary',
        },
      },
      at(0.1),
    );
    this.append(
      {
        agent: 'enceladus',
        runId: r0,
        type: 'tool_result',
        data: { callId: 's1', tool: 'vault_edit', ok: true, durationMs: 38 },
      },
      at(0.05),
    );
    this.append(
      { agent: 'enceladus', runId: r0, type: 'run', data: { status: 'completed' } },
      at(0.1),
    );

    // A finished job of the team with its receipt (D-067): checked, reminded, cleaned.
    this.seedMeeting(orch, at);

    // Titan gives the project some work (`project_send`) and Iapetus reports back (D-097, D-102).
    this.seedProjectWork(orch, at);

    // Livio asks Calypso from the team's group, through her own bot (D-107).
    this.seedTelegramGroup(at);

    // A direct chat with Dione, earlier in the morning.
    const rd = 'run_seed_bio';
    this.append(
      {
        agent: 'user',
        runId: rd,
        type: 'message',
        data: {
          role: 'user',
          text: tr(
            'Dione, can you write me a short bio for Instagram?',
            'Dione, mi scrivi una bio breve per Instagram?',
          ),
          to: 'dione',
          channel: 'ui',
        },
      },
      at(4),
    );
    this.append(
      { agent: 'dione', runId: rd, type: 'run', data: { status: 'started', goal: 'Bio' } },
      at(0.05),
    );
    this.append(
      {
        agent: 'dione',
        runId: rd,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'Here it is: **Slow travels, crooked photos, coffee always.** If you want a more serious version, just say so.',
            'Eccola: **Viaggi lenti, foto storte, caffè sempre.** Se vuoi una versione più seria, dimmelo.',
          ),
        },
      },
      at(0.6),
    );
    this.append(
      { agent: 'dione', runId: rd, type: 'run', data: { status: 'completed' } },
      at(0.01),
    );

    // Files (D-075): a photo for Dione, and the page she made of the posts.
    const rf = 'run_seed_files';
    const photo = this.files.seedPhoto(at(1));
    this.append(
      {
        agent: 'user',
        runId: rf,
        type: 'message',
        data: {
          role: 'user',
          text: tr(
            'Use this photo for Saturday’s post, and show me the menu on a page.',
            'Usa questa foto per il post di sabato, e fammi vedere il menu in una pagina.',
          ),
          to: 'dione',
          channel: 'ui',
          attachments: [photo.id],
        },
      },
      at(0.02),
    );
    this.append(
      {
        agent: 'dione',
        runId: rf,
        type: 'run',
        data: { status: 'started', goal: tr('Posts page', 'Pagina dei post') },
      },
      at(0.05),
    );
    this.files.seedPage('dione', rf, at(0.6));
    this.append(
      {
        agent: 'dione',
        runId: rf,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'Great light! I’ll use it for Saturday. The menu is on a page: here it is.',
            'Bella luce! La uso per sabato. Il menu è in una pagina: eccola.',
          ),
        },
      },
      at(0.1),
    );
    this.append(
      { agent: 'dione', runId: rf, type: 'run', data: { status: 'completed' } },
      at(0.01),
    );

    const r1 = 'run_seed_lisbon';
    this.append(
      {
        agent: 'user',
        runId: r1,
        type: 'message',
        data: {
          role: 'user',
          text: tr(
            'Hi Titan! Can you prepare 3 posts for the weekend in Lisbon?',
            'Ciao Titan! Mi prepari 3 post per il weekend a Lisbona?',
          ),
          to: this.orchestrator.id,
          channel: 'ui',
        },
      },
      at(14),
    );
    this.append(
      {
        agent: orch,
        runId: r1,
        type: 'run',
        data: {
          status: 'started',
          goal: tr('3 posts about the weekend in Lisbon', '3 post sul weekend a Lisbona'),
        },
      },
      at(0.05),
    );
    this.append(
      {
        agent: orch,
        runId: r1,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'Gladly! I’ll ask Rhea to find the best tips, then hand everything over to Dione for the copy.',
            'Volentieri! Chiedo a Rhea di cercare gli spunti migliori, poi passo tutto a Dione per i testi.',
          ),
          partial: true,
        },
      },
      at(0.1),
    );
    this.append(
      {
        agent: orch,
        runId: r1,
        type: 'tool_call',
        data: {
          callId: 's2',
          tool: 'delegate',
          input: { to: 'rhea', goal: tr('Find 5 tips on Lisbon', 'Trova 5 spunti su Lisbona') },
        },
      },
      at(0.05),
    );
    const del = this.append(
      {
        agent: orch,
        runId: r1,
        type: 'delegation',
        data: {
          from: orch,
          to: 'rhea',
          status: 'started',
          goal: tr(
            'Find 5 tips on Lisbon for a weekend',
            'Trova 5 spunti su Lisbona per un weekend',
          ),
          why: tr('We need checked ideas', 'Servono idee verificate'),
          doneWhen: tr('A note with 5 tips and the sources', 'Una nota con 5 spunti e le fonti'),
        },
      },
      at(0.02),
    );
    // Rhea looked at a page in the browser: the screenshot is kept among the File (D-075).
    this.files.seedScreenshot('rhea', r1, at(0.2));
    const p = del.id;
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'I’ll start with the official guides, then check the miradouros. ',
            'Comincio dalle guide ufficiali, poi controllo i miradouros. ',
          ),
          partial: true,
        },
      },
      at(0.2),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'tool_call',
        data: {
          callId: 's3',
          tool: 'web_search',
          input: {
            query: tr('Lisbon weekend what to see October', 'Lisbona weekend cosa vedere ottobre'),
            maxResults: 5,
          },
        },
      },
      at(0.1),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'tool_result',
        data: {
          callId: 's3',
          tool: 'web_search',
          ok: true,
          durationMs: 1240,
          output: {
            results: [
              {
                title: tr('Lisbon in 2 days', 'Lisbona in 2 giorni'),
                url: tr('https://www.visitlisboa.com/en', 'https://www.visitlisboa.com/it'),
              },
              { title: 'Miradouro da Senhora do Monte', url: 'https://example.org/miradouro' },
            ],
          },
        },
      },
      at(0.3),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'tool_call',
        data: {
          callId: 's4',
          tool: 'web_fetch',
          input: { url: tr('https://www.visitlisboa.com/en', 'https://www.visitlisboa.com/it') },
        },
      },
      at(0.1),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'tool_result',
        data: {
          callId: 's4',
          tool: 'web_fetch',
          ok: false,
          error: tr('Timed out after 15 s', 'Timeout dopo 15 s'),
          durationMs: 15000,
        },
      },
      at(0.3),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'provider_usage',
        data: {
          provider: 'openrouter',
          model: 'openrouter/free',
          inputTokens: 3120,
          outputTokens: 418,
          durationMs: 2900,
          step: 1,
        },
      },
      at(0.05),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'tool_call',
        data: {
          callId: 's5',
          tool: 'vault_write',
          input: {
            path: notePath('lisbonTips'),
            tags: tr(['travel', 'tips'], ['viaggi', 'spunti']),
          },
        },
      },
      at(0.2),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'vault_change',
        data: {
          action: 'create',
          path: notePath('lisbonTips'),
          commit: '9e8d7c6',
          actionId: 'act_seed_lisbon',
        },
      },
      at(0.05),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'tool_result',
        data: {
          callId: 's5',
          tool: 'vault_write',
          ok: true,
          durationMs: 51,
          output: { path: notePath('lisbonTips') },
        },
      },
      at(0.02),
    );
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'I saved 5 tips with sources. The tourism page was slow, so I used two alternative guides.',
            'Ho salvato 5 spunti con le fonti. La pagina del turismo era lenta, ho usato due guide alternative.',
          ),
        },
      },
      at(0.1),
    );
    // The agent's own memory: shown discreetly, not among the user's notes.
    this.append(
      {
        agent: 'rhea',
        runId: r1,
        parentId: p,
        type: 'vault_change',
        data: {
          action: 'edit',
          path: notePath('rheaMemory'),
          commit: '5f4e3d2',
          actionId: 'act_seed_memory',
        },
      },
      at(0.02),
    );
    this.append(
      {
        agent: orch,
        runId: r1,
        type: 'delegation',
        data: {
          from: orch,
          to: 'rhea',
          status: 'completed',
          goal: tr(
            'Find 5 tips on Lisbon for a weekend',
            'Trova 5 spunti su Lisbona per un weekend',
          ),
          summary: tr(
            `5 tips saved in “${noteTitle('lisbonTips')}”`,
            `5 spunti salvati in “${noteTitle('lisbonTips')}”`,
          ),
        },
      },
      at(0.05),
    );
    this.append(
      {
        agent: orch,
        runId: r1,
        type: 'tool_result',
        data: {
          callId: 's2',
          tool: 'delegate',
          ok: true,
          output: tr(
            `5 tips saved in “${noteTitle('lisbonTips')}”`,
            `5 spunti salvati in “${noteTitle('lisbonTips')}”`,
          ),
          durationMs: 41_000,
        },
      },
      at(0.01),
    );

    this.append(
      {
        agent: 'mimas',
        runId: 'run_seed_budget',
        type: 'run',
        data: {
          status: 'started',
          goal: tr('Update the expenses sheet', 'Aggiorna il foglio delle spese'),
        },
      },
      at(1),
    );
    this.append(
      {
        agent: 'mimas',
        runId: 'run_seed_budget',
        type: 'error',
        data: {
          code: 'agent_failed',
          message: tr(
            'The expenses sheet is open in another program',
            'Il foglio delle spese è aperto da un altro programma',
          ),
        },
      },
      at(0.2),
    );
    this.append(
      {
        agent: 'mimas',
        runId: 'run_seed_budget',
        type: 'run',
        data: { status: 'failed', error: 'file locked' },
      },
      at(0.01),
    );

    this.ask(
      orch,
      r1,
      tr(
        'Rhea found 5 tips on Lisbon. What tone should we give the posts?',
        'Rhea ha trovato 5 spunti su Lisbona. Che tono diamo ai post?',
      ),
      toneOptions(),
      'amichevole',
      (choice) => this.writePosts(orch, r1, choice),
      at(0.5),
    );

    const r2 = 'run_seed_tram';
    this.append(
      {
        agent: orch,
        runId: r2,
        type: 'delegation',
        data: {
          from: orch,
          to: 'rhea',
          status: 'started',
          goal: tr(
            'Check the tram 28 schedule for the weekend',
            'Controlla gli orari del tram 28 nel weekend',
          ),
        },
      },
      now - 40_000,
    );
    this.append(
      {
        agent: 'rhea',
        runId: r2,
        type: 'tool_call',
        data: {
          callId: 's6',
          tool: 'web_search',
          input: { query: tr('tram 28 weekend schedule', 'tram 28 orari weekend') },
        },
      },
      now - 20_000,
    );
    this.seedStuck(now);
    this.live = {
      ...this.live,
      titan: {
        mood: 'waiting',
        activity: tr('I asked you a question', 'Ti ho fatto una domanda'),
        since: now,
      },
    };
  }

  /**
   * The demo's work for the project (D-097, D-102): the user asks Titan, Titan
   * writes to the lead of "Social di Saturday" with `project_send` (a message
   * in Iapetus's chat, `from` Titan), Iapetus answers in a run of its own and
   * its answer goes back to Titan as `project_report`.
   */
  /**
   * A bot dedicated to Calypso in the group "Saturday Team" (D-107): Livio
   * mentions it, Calypso answers there; her chat shows his message as his.
   */
  private seedTelegramGroup(at: (minutes: number) => number): void {
    const agent = 'calypso';
    if (!this.agents.some((a) => a.id === agent)) return;
    this.telegram.seedMain(at(0));
    this.telegram.seedBot(agent, at(0));
    const run = 'run_seed_telegram_group';
    const origin = {
      bot: '7100000042',
      chat: MOCK_GROUP.id,
      chatType: 'supergroup' as const,
      chatTitle: MOCK_GROUP.title,
      sender: { id: MOCK_LIVIO.id, name: MOCK_LIVIO.name, username: MOCK_LIVIO.username },
      owner: false,
    };
    this.append(
      {
        agent: 'user',
        runId: run,
        type: 'message',
        data: {
          role: 'user',
          text: tr(
            'Can you come up with three ideas for Monday’s post about the new menu?',
            'Ci prepari tre idee per il post di lunedì sul nuovo menù?',
          ),
          to: agent,
          channel: 'telegram',
          telegram: origin,
        },
      },
      at(1),
    );
    this.append(
      {
        agent,
        runId: run,
        type: 'run',
        data: {
          status: 'started',
          goal: tr('Three ideas for Monday’s post', 'Tre idee per il post di lunedì'),
          thread: `telegram:${origin.bot}:${origin.chat}`,
        },
      },
      at(0.02),
    );
    this.append(
      {
        agent,
        runId: run,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'Here they are, Livio:\n\n1. **The menu in three photos**: a carousel, dish by dish.\n2. **Who cooks it**: a photo of the chef with their quote.\n3. **Guess the dish**: a close-up detail, the answer in the stories.\n\nTell me which ones you prefer and I’ll write the text.',
            'Eccole, Livio:\n\n1. **Il menù in tre foto**: un carosello piatto per piatto.\n2. **Chi lo cucina**: una foto dello chef con la sua frase.\n3. **Indovina il piatto**: un dettaglio da vicino, la risposta nelle storie.\n\nDimmi quale preferite e scrivo il testo.',
          ),
        },
      },
      at(0.8),
    );
    this.append({ agent, runId: run, type: 'run', data: { status: 'completed' } }, at(0.01));
  }

  private seedProjectWork(orch: string, at: (minutes: number) => number): void {
    const ask = 'run_seed_social_ask';
    const work = 'run_seed_social';
    const lead = 'iapetus';
    this.append(
      {
        agent: 'user',
        runId: ask,
        type: 'message',
        data: {
          role: 'user',
          text: tr(
            'Titan, can you have the social team prepare the post for Saturday night?',
            'Titan, fai preparare ai social il post per la serata di sabato?',
          ),
          to: this.orchestrator.id,
          channel: 'ui',
        },
      },
      at(2),
    );
    this.append(
      {
        agent: orch,
        runId: ask,
        type: 'run',
        data: { status: 'started', goal: tr('Saturday post', 'Post di sabato') },
      },
      at(0.02),
    );
    this.append(
      {
        agent: orch,
        runId: ask,
        type: 'tool_call',
        data: {
          callId: 'ps1',
          tool: 'project_send',
          input: {
            project: tr('Saturday Social', 'Social di Saturday'),
            text: tr('The post for Saturday night', 'Il post per la serata di sabato'),
          },
        },
      },
      at(0.1),
    );
    const request = this.append(
      {
        agent: 'user',
        runId: work,
        type: 'message',
        data: {
          role: 'user',
          text: tr(
            'Prepare the post for Saturday night: live music from 9 pm, free entry. Friendly tone, a photo of the room.',
            'Prepara il post per la serata di sabato: musica dal vivo dalle 21, ingresso libero. Tono amichevole, una foto della sala.',
          ),
          to: lead,
          channel: 'system',
          from: orch,
          fromRun: ask,
        },
      },
      at(0.02),
    );
    this.append(
      {
        agent: orch,
        runId: ask,
        type: 'tool_result',
        data: { callId: 'ps1', tool: 'project_send', ok: true, durationMs: 12 },
      },
      at(0.01),
    );
    this.append(
      {
        agent: orch,
        runId: ask,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'I passed the work to Iapetus, the lead of Saturday Social: I’ll tell you as soon as it’s done.',
            'Ho passato il lavoro a Iapetus, il capo di Social di Saturday: ti dico appena ha finito.',
          ),
        },
      },
      at(0.05),
    );
    this.append({ agent: orch, runId: ask, type: 'run', data: { status: 'completed' } }, at(0.01));
    this.append(
      {
        agent: lead,
        runId: work,
        type: 'run',
        data: { status: 'started', goal: tr('Saturday night post', 'Post della serata di sabato') },
      },
      at(0.05),
    );
    const answer = tr(
      'Done: Calypso wrote the text (“Saturday we play! From 9 pm, free entry”) and Pandora prepared the graphic with the photo of the room. The post is in the project notes, ready for Saturday at 6 pm.',
      'Fatto: Calypso ha scritto il testo («Sabato si suona! Dalle 21, ingresso libero») e Pandora ha preparato la grafica con la foto della sala. Il post è nelle note del progetto, pronto per sabato alle 18.',
    );
    this.append(
      { agent: lead, runId: work, type: 'message', data: { role: 'agent', text: answer } },
      at(1.5),
    );
    this.append({ agent: lead, runId: work, type: 'run', data: { status: 'completed' } }, at(0.01));
    this.append(
      {
        agent: 'system',
        runId: work,
        type: 'project_report',
        data: {
          project: DEMO_PROJECT_ID,
          lead,
          to: orch,
          request: request.id,
          status: 'completed',
          summary: answer,
        },
      },
      at(0.01),
    );
  }

  /**
   * The demo's finished job: Titan has Dione summarise a meeting (a reminder
   * makes her finish it) and Rhea find the restaurant (a web page with orders
   * for the monsters, cleaned; the address only from a guide: in doubt).
   */
  private seedMeeting(orch: string, at: (minutes: number) => number): void {
    const run = 'run_seed_meeting';
    const request = tr(
      'Titan, can you summarize yesterday’s meeting with Bruno and note down the to-dos?',
      'Titan, mi riassumi la riunione di ieri con Bruno e mi segni le cose da fare?',
    );
    const note = notePath('meetingSummary');
    const dioneGoal = tr(
      'Summarize the Oct 15 meeting with Bruno and make a to-do list',
      'Riassumi la riunione del 15/10 con Bruno e fai la lista delle cose da fare',
    );
    const dioneDone = tr(
      'A note with the summary and at least 3 to-dos, each with who and when',
      'Una nota con il riassunto e almeno 3 cose da fare, ognuna con chi e quando',
    );
    const rheaGoal = tr(
      'Find the address and website of the restaurant Bruno suggested',
      'Trova indirizzo e sito del ristorante proposto da Bruno',
    );
    const rheaDone = tr(
      'The restaurant’s address and website in the summary note',
      'Indirizzo e sito del ristorante nella nota del riassunto',
    );
    const model = 'meta-llama/llama-3.3-70b-instruct:free';
    const add = (input: EventInput, minutes: number) => this.append(input, at(minutes));
    const typesafe = (t: number, agent: string) =>
      add(
        {
          agent,
          runId: run,
          type: 'provider_usage',
          data: {
            provider: 'typesafe',
            model: 'jev-1.13.0',
            inputTokens: 420,
            outputTokens: 6,
            durationMs: 210,
            costUsd: 0.00002,
          },
        },
        t,
      );
    const free = (t: number, agent: string, step: number) => {
      // What the step's context held (Consumi, D-075): it grows with the turn.
      const context = mockContext({ turns: turnsOf(this.events, agent), results: step + 1 });
      add(
        {
          agent,
          runId: run,
          type: 'provider_usage',
          data: {
            provider: 'openrouter',
            model,
            inputTokens: context.total,
            outputTokens: 380,
            durationMs: 2400,
            costUsd: 0,
            step,
            context,
          },
        },
        t,
      );
    };
    const tool = (
      agent: string,
      parentId: string | null,
      callId: string,
      name: string,
      input: Record<string, unknown>,
      t: number,
    ) =>
      add(
        { agent, runId: run, parentId, type: 'tool_call', data: { callId, tool: name, input } },
        t,
      );
    const result = (
      agent: string,
      parentId: string | null,
      callId: string,
      name: string,
      durationMs: number,
      t: number,
    ) =>
      add(
        {
          agent,
          runId: run,
          parentId,
          type: 'tool_result',
          data: { callId, tool: name, ok: true, durationMs },
        },
        t,
      );

    add(
      {
        agent: 'user',
        runId: run,
        type: 'message',
        data: { role: 'user', text: request, to: orch, channel: 'ui' },
      },
      3,
    );
    add({ agent: orch, runId: run, type: 'run', data: { status: 'started', goal: request } }, 0.02);
    typesafe(0.01, orch);
    add(
      {
        agent: 'system',
        runId: run,
        type: 'instinct',
        data: {
          use: 'route_hint',
          action: 'route_hint',
          message: tr(
            'I suggested handing the request to Dione.',
            'Ho suggerito di affidare la richiesta a Dione.',
          ),
          subject: orch,
          confidence: 0.84,
          details: { route: 'Dione' },
        },
      },
      0.01,
    );
    // The level of the request (D-093): the receipt says which model and why.
    add(
      {
        agent: 'system',
        runId: run,
        type: 'instinct',
        data: {
          use: 'tier',
          action: 'tier',
          message: tr(
            `Hard request: ${orch} uses ${model}.`,
            `Richiesta difficile: ${orch} usa ${model}.`,
          ),
          subject: orch,
          details: { level: 'hard', model: `openrouter:${model}`, moved: false },
        },
      },
      0.01,
    );
    free(0.05, orch, 1);
    add(
      {
        agent: orch,
        runId: run,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            'Dione will take care of the summary; I’ll ask Rhea about the restaurant you talked about.',
            'Ci pensa Dione per il riassunto; a Rhea chiedo il ristorante di cui avete parlato.',
          ),
          partial: true,
        },
      },
      0.02,
    );
    tool(orch, null, 'm1', 'delegate', { to: 'dione', goal: dioneGoal }, 0.02);
    const d1 = add(
      {
        agent: orch,
        runId: run,
        type: 'delegation',
        data: {
          from: orch,
          to: 'dione',
          status: 'started',
          goal: dioneGoal,
          why: tr('Know what to do this week', 'Sapere cosa fare questa settimana'),
          doneWhen: dioneDone,
        },
      },
      0.01,
    ).id;
    tool('dione', d1, 'm2', 'vault_read', { path: notePath('meetingNotes') }, 0.1);
    result('dione', d1, 'm2', 'vault_read', 18, 0.01);
    free(0.05, 'dione', 1);
    tool('dione', d1, 'm3', 'vault_write', { path: note }, 0.1);
    add(
      {
        agent: 'dione',
        runId: run,
        parentId: d1,
        type: 'vault_change',
        data: { action: 'create', path: note, commit: 'c41d9e2', actionId: 'act_seed_meeting' },
      },
      0.01,
    );
    result('dione', d1, 'm3', 'vault_write', 40, 0.01);
    typesafe(0.02, 'dione');
    add(
      {
        agent: 'system',
        runId: run,
        parentId: d1,
        type: 'instinct',
        data: {
          use: 'done_check',
          action: 'retry',
          message: tr(
            'Dione’s work wasn’t finished: I asked it to complete it.',
            'Il lavoro di Dione non era finito: gli ho chiesto di completarlo.',
          ),
          subject: 'dione',
          details: {
            missing: [tr('two to-dos without a “who”', 'due cose da fare senza «chi»')],
            after: 'verified',
          },
        },
      },
      0.01,
    );
    free(0.05, 'dione', 2);
    tool('dione', d1, 'm4', 'vault_edit', { path: note }, 0.05);
    add(
      {
        agent: 'dione',
        runId: run,
        parentId: d1,
        type: 'vault_change',
        data: { action: 'edit', path: note, commit: 'd52e0f3', actionId: 'act_seed_meeting_who' },
      },
      0.01,
    );
    result('dione', d1, 'm4', 'vault_edit', 31, 0.01);
    typesafe(0.02, 'dione');
    add(
      {
        agent: orch,
        runId: run,
        type: 'delegation',
        data: {
          from: orch,
          to: 'dione',
          status: 'completed',
          goal: dioneGoal,
          summary: tr(
            'Summary and 4 to-dos, with who and when',
            'Riassunto e 4 cose da fare, con chi e quando',
          ),
          check: {
            verdict: 'verified',
            retried: true,
            criteria: [
              { text: dioneDone, kind: 'done_when', ok: true, by: 'model', p: 0.91 },
              { text: tr('Notes saved', 'Note salvate'), kind: 'notes', ok: true, by: 'rules' },
            ],
          },
          model: `openrouter:${model}`,
          steps: 5,
          costUsd: 0,
        },
      },
      0.01,
    );
    add(
      {
        agent: orch,
        runId: run,
        type: 'tool_result',
        data: {
          callId: 'm1',
          tool: 'delegate',
          ok: true,
          output: tr('Summary and 4 to-dos', 'Riassunto e 4 cose da fare'),
          durationMs: 24_000,
        },
      },
      0.01,
    );
    tool(orch, null, 'm5', 'delegate', { to: 'rhea', goal: rheaGoal }, 0.02);
    const d2 = add(
      {
        agent: orch,
        runId: run,
        type: 'delegation',
        data: { from: orch, to: 'rhea', status: 'started', goal: rheaGoal, doneWhen: rheaDone },
      },
      0.01,
    ).id;
    tool(
      'rhea',
      d2,
      'm6',
      'web_search',
      { query: tr('Tasca do Chico Lisbon', 'Tasca do Chico Lisbona') },
      0.05,
    );
    result('rhea', d2, 'm6', 'web_search', 910, 0.02);
    const guideUrl = tr(
      'https://www.lisbon-guide.example/tasca-do-chico',
      'https://www.guida-lisbona.example/tasca-do-chico',
    );
    const fetch = tool('rhea', d2, 'm7', 'web_fetch', { url: guideUrl }, 0.02).id;
    typesafe(0.02, 'rhea');
    add(
      {
        agent: 'system',
        runId: run,
        parentId: fetch,
        type: 'security',
        data: {
          action: 'injection_removed',
          source: `web_fetch ${guideUrl}`,
          tool: 'web_fetch',
          p: 0.94,
          blocks: 1,
          message: tr(
            `I removed from web_fetch ${guideUrl} a text that was giving orders to the monsters.`,
            `Ho tolto da web_fetch ${guideUrl} un testo che dava ordini ai mostri.`,
          ),
        },
      },
      0.01,
    );
    result('rhea', d2, 'm7', 'web_fetch', 1320, 0.01);
    free(0.05, 'rhea', 1);
    // A write outside Rhea’s note areas: refused, the error as the core logs it.
    const deckPath = tr('Sales/Pitch deck.md', 'Commerciale/Pitch deck.md');
    const refusal = `rhea cannot write ${deckPath}`;
    const refusalHint =
      'Use vault_propose to suggest this change: it creates a proposal in Inbox/ that the orchestrator can apply. You can write freely in Agenti/Rhea/, create new notes in Inbox/ and edit your own notes there. The user can change the note areas of a monster.';
    tool('rhea', d2, 'm8a', 'vault_write', { path: deckPath, content: '…' }, 0.03);
    add(
      {
        agent: 'rhea',
        runId: run,
        parentId: d2,
        type: 'tool_result',
        data: {
          callId: 'm8a',
          tool: 'vault_write',
          ok: false,
          error: `SETTING_OFF: ${refusal}`,
          output: { error: { code: 'SETTING_OFF', message: refusal, hint: refusalHint } },
          durationMs: 8,
        },
      },
      0.01,
    );
    tool('rhea', d2, 'm8', 'vault_edit', { path: note }, 0.05);
    add(
      {
        agent: 'rhea',
        runId: run,
        parentId: d2,
        type: 'vault_change',
        data: { action: 'edit', path: note, commit: 'e63f104', actionId: 'act_seed_meeting_place' },
      },
      0.01,
    );
    result('rhea', d2, 'm8', 'vault_edit', 29, 0.01);
    typesafe(0.02, 'rhea');
    add(
      {
        agent: 'system',
        runId: run,
        parentId: d2,
        type: 'instinct',
        data: {
          use: 'done_check',
          action: 'doubt',
          message: tr(
            'Rhea’s work is in doubt: the address comes from a guide, not from the restaurant’s website',
            'Il lavoro di Rhea è in dubbio: l’indirizzo viene da una guida, non dal sito del ristorante',
          ),
          subject: 'rhea',
          // What the person decides on: the point the check was unsure of and the notes delivered.
          details: {
            doubt: tr(
              'the address comes from a guide, not from the restaurant’s website',
              'l’indirizzo viene da una guida, non dal sito del ristorante',
            ),
            points: [rheaDone],
            notes: [note],
            goal: rheaGoal,
          },
        },
      },
      0.01,
    );
    add(
      {
        agent: orch,
        runId: run,
        type: 'delegation',
        data: {
          from: orch,
          to: 'rhea',
          status: 'completed',
          goal: rheaGoal,
          summary: tr('Address added to the note', 'Indirizzo aggiunto alla nota'),
          check: {
            verdict: 'doubt',
            criteria: [
              {
                text: rheaDone,
                kind: 'done_when',
                ok: false,
                by: 'model',
                p: 0.41,
                reason: tr(
                  'the address comes from a guide, the restaurant has no website',
                  'l’indirizzo viene da una guida, il sito del ristorante non c’è',
                ),
              },
              { text: tr('Notes saved', 'Note salvate'), kind: 'notes', ok: true, by: 'rules' },
            ],
          },
          model: `openrouter:${model}`,
          steps: 4,
          costUsd: 0,
        },
      },
      0.01,
    );
    add(
      {
        agent: orch,
        runId: run,
        type: 'tool_result',
        data: {
          callId: 'm5',
          tool: 'delegate',
          ok: true,
          output: tr('Address added', 'Indirizzo aggiunto'),
          durationMs: 14_000,
        },
      },
      0.01,
    );
    free(0.02, orch, 2);
    add(
      {
        agent: orch,
        runId: run,
        type: 'message',
        data: {
          role: 'agent',
          text: tr(
            [
              `Done: the summary is in [[${noteTitle('meetingSummary')}]], with 4 to-dos, each with who and when.`,
              '',
              'Rhea added the address of Tasca do Chico, but it comes from a guide: check it before booking.',
            ],
            [
              `Fatto: il riassunto è in [[${noteTitle('meetingSummary')}]], con 4 cose da fare, ognuna con chi e quando.`,
              '',
              'Rhea ha aggiunto l’indirizzo della Tasca do Chico, ma viene da una guida: controllalo prima di prenotare.',
            ],
          ).join('\n'),
        },
      },
      0.03,
    );
    add({ agent: orch, runId: run, type: 'run', data: { status: 'completed' } }, 0.01);
  }

  /** Enceladus goes round in circles on the index: the instinct sees it (the confused face). */
  private seedStuck(now: number): void {
    const run = 'run_seed_index';
    this.append(
      {
        agent: 'enceladus',
        runId: run,
        type: 'run',
        data: {
          status: 'started',
          goal: tr('Tidy up the October notes', 'Riordina le note di ottobre'),
        },
      },
      now - 70_000,
    );
    for (let i = 0; i < 3; i++) {
      this.append(
        {
          agent: 'enceladus',
          runId: run,
          type: 'tool_call',
          data: {
            callId: `s-idx-${i}`,
            tool: 'vault_list',
            input: { folder: tr('October', 'Ottobre') },
          },
        },
        now - 60_000 + i * 12_000,
      );
      this.append(
        {
          agent: 'enceladus',
          runId: run,
          type: 'tool_result',
          data: { callId: `s-idx-${i}`, tool: 'vault_list', ok: true, durationMs: 22 },
        },
        now - 59_000 + i * 12_000,
      );
    }
    this.append(
      {
        agent: 'system',
        runId: run,
        type: 'instinct',
        data: {
          use: 'stuck',
          action: 'stuck_notice',
          message: tr(
            'Enceladus seems to be going round in circles.',
            'Enceladus sembra girare a vuoto.',
          ),
          subject: 'enceladus',
          confidence: 0.71,
        },
      },
      now - 8_000,
    );
  }
}
