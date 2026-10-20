import {
  AnswerRequestSchema,
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
  type AgentSummary,
  type EventInput,
  type LogEvent,
  type Question,
  type SettingsResponse,
  type PaidSearchEngineName,
  type PaidSearchMode,
  type WebSearchSettings,
  type StatusResponse,
  type StreamMessage,
} from '@monsters/shared';
import type { z } from 'zod';
import { SetupBodySchema } from '../api.ts';
import type { RawResponse, SocketLike, Transport } from '../transport.ts';
import { applyLive, type LiveState } from '../../store/derive.ts';
import { MOCK_DEMO_USER, MOCK_SETUP_CODE } from './constants.ts';
import { mockTeam } from './team.ts';
import { AMBIENT_JOBS, type AmbientJob } from './ambient.ts';
import { createRng } from '@monsters/monster-kit';
import { MockOnboarding } from '../../onboarding/mock.ts';
import { MockMcp } from './mcp.ts';
import { MockPermissions } from './permissions.ts';
import { MockSquad } from './squad.ts';
import { MockProviders } from './providers.ts';
import { MOCK_GROUP, MOCK_LIVIO, MockTelegram } from './telegram.ts';
import { MockDecisions } from './decisions.ts';
import { MockInstinct, mockReceipt } from './instinct.ts';
import { MockSpend } from './spend.ts';
import { handleUsage, MOCK_MODEL, mockContext, turnsOf } from './usage.ts';
import { MockVault } from './vault.ts';
import { MockFiles } from './files.ts';
import { MockAutomations } from './automations.ts';
import { DEMO_PROJECT_ID, MockProjects } from './projects.ts';
import { CHANGELOG } from '../changelog-data.ts';
import { MockDocs } from './docs.ts';
import { seedPreviewScene } from './preview-scene.ts';

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

export class MockCore {
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
  });
  /** Spending caps (D-070): created with the mode (the demo has spent a little). */
  private spend!: MockSpend;
  private live: Record<string, LiveState> = {};
  private readonly questions = new Map<string, Question>();
  private readonly undone = new Set<string>();
  private readonly sockets = new Set<MockSocket>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Work held back by `hold()`, in order: scripted steps and request replies. */
  private held: (() => void)[] | null = null;
  private readonly onAnswer = new Map<string, (choice: string) => void>();
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
    if (opts.mode === 'fresh') this.providers.setOpenRouter(false);
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

  /** Test hook: the monster works on the Claude plan from now on (Consumi, D-075). */
  useSubscription(agentId: string): void {
    this.providers.setChain(agentId, [{ provider: 'claude-agent', model: 'sonnet' }]);
  }

  /** Test hook: the monster has a direct key priced by OpenRouter's list, so its cost is estimated (D-114). */
  estimateCost(agentId: string, label: string): void {
    this.spend.estimate(agentId, label);
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

    switch (route) {
      case 'GET /api/health':
        return ok({ ok: true, version: MOCK_VERSION });
      case 'GET /api/setup-status':
        return ok({ needsSetup: this.auth.user === null });
      case 'POST /api/setup': {
        if (this.auth.user) return fail(409, 'already_configured');
        const p = SetupBodySchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request', p.error.issues[0]?.message);
        if (p.data.setupCode !== MOCK_SETUP_CODE) return fail(403, 'invalid_setup_code');
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
          runId: this.receive({ text: resumeText(r.text), to: r.agent, resumeOf: r.runId }),
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
          return fail(404, 'unknown_file', 'Un allegato non c’è più: toglilo e riprova.');
        }
        return ok({ runId: this.receive(p.data) });
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
          vaultPath: '/home/demo/Monsters Note',
          userName: this.squad.userName,
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
        if (!p.data.key.startsWith('sk-or-')) return fail(400, 'invalid_key', 'chiave non valida');
        this.keyLabel = 'Monsters (mock)';
        this.onboarding.keySaved();
        this.providers.setOpenRouter(true);
        return ok({ ok: true, label: this.keyLabel, isFreeTier: false });
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
        `${this.orchestrator.name} sta ancora lavorando: aspetta che finisca o fermalo, poi inizia una nuova conversazione.`,
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
    return fail(404, 'unknown_draft', 'Bozza sconosciuta.');
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
      };
    });
  }

  private queryEvents(q: URLSearchParams): LogEvent[] {
    const agents = q.get('agent')?.split(',').filter(Boolean);
    const types = q.get('type')?.split(',').filter(Boolean);
    const since = Number(q.get('since') ?? 0);
    const until = Number(q.get('until') ?? Infinity);
    const after = q.get('after');
    const before = q.get('before');
    const limit = Math.min(1000, Number(q.get('limit') ?? 200));
    let list = this.events.filter(
      (e) =>
        (!agents || agents.includes(e.agent)) &&
        (!types || types.includes(e.type)) &&
        e.ts >= since &&
        e.ts <= until &&
        (!after || e.id > after) &&
        (!before || e.id < before),
    );
    if (q.get('order') === 'desc') list = list.slice().reverse();
    return list.slice(0, limit);
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
            message: `Il lavoro di ${a.name} si è fermato: hai fermato tutti i mostri`,
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

  private receive(req: z.infer<typeof SendMessageRequestSchema>): string {
    const runId = `run_${ulid().slice(-12).toLowerCase()}`;
    const orch = this.orchestrator.id;
    this.append({
      agent: 'user',
      runId,
      type: 'message',
      data: {
        role: 'user',
        text: req.text,
        channel: 'ui',
        ...(req.to ? { to: req.to } : {}),
        ...(req.resumeOf ? { resumeOf: req.resumeOf } : {}),
        ...(req.attachments?.length ? { attachments: req.attachments } : {}),
      },
    });
    const target = req.to && this.agents.some((a) => a.id === req.to) ? req.to : orch;
    if (req.attachments?.length) {
      // Files (D-075): the monster says what it received.
      this.attachmentReply(target, runId, req.attachments.length);
    } else if (/\b(screenshot|pagina html)\b/i.test(req.text)) {
      // A monster saves a screenshot of the browser, or makes a page (D-075).
      this.fileRun(target, runId, /screenshot/i.test(req.text) ? 'screenshot' : 'page');
    } else if (/\bpubblica/i.test(req.text)) {
      // The brake on the actions that leave the computer, from any chat.
      this.outboundRun(orch, runId, req.text);
    } else if (/\b(tetto|spesa|spendi)\b/i.test(req.text)) {
      // The spending cap (D-070): a paid job that reaches it, in any chat.
      this.spendRun(req.to && this.agents.some((a) => a.id === req.to) ? req.to : orch, runId);
    } else if (req.to && req.to !== orch && this.agents.some((a) => a.id === req.to)) {
      this.directReply(req.to, runId, req.text);
    } else if (/errore|rompi/i.test(req.text)) {
      this.failingRun(orch, runId);
    } else if (/\bmenu\b/i.test(req.text)) {
      this.openQuestionRun(orch, runId, req.text);
    } else if (/\b(nuovo mostro|crea(re)?\s+un\s+mostro)\b/i.test(req.text)) {
      this.proposalRun(orch, runId);
    } else if (/\bvolantin/i.test(req.text)) {
      this.parkedQuestionRun(orch, runId, req.text);
    } else {
      this.mainScenario(orch, runId, req.text);
    }
    return runId;
  }

  private attachmentReply(agent: string, runId: string, count: number): void {
    this.schedule([
      [
        200,
        () =>
          this.append({ agent, runId, type: 'run', data: { status: 'started', goal: 'Allegati' } }),
      ],
      [10, () => this.modelStep(agent, runId, 0, 0)],
      ...this.streamSteps(
        agent,
        runId,
        count === 1
          ? 'Ho ricevuto il file: lo guardo e ti dico cosa ne penso.'
          : `Ho ricevuto ${count} file: li guardo uno per uno.`,
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
          ? 'Ecco lo screenshot della pagina: lo trovi anche tra i File.'
          : 'Ho creato la pagina: la apri dalla chat o dai File.',
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
        `Ciao! Sono ${name}. Ho guardato nelle note: ci sono già due appunti utili, li tengo presenti. Dimmi pure se vuoi che vada più a fondo.`,
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
      title: 'l’archivista',
      role: 'tiene in ordine le idee',
      mission: 'raccogli le idee sparse e le trasformi in note ordinate e collegate',
      duties: ['Una nota per idea, con i collegamenti alle note vicine.'],
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
            data: { status: 'started', goal: 'Un nuovo mostro' },
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
        'Ti ho preparato **Lyra**, l’archivista: tiene in ordine le idee nella cartella Idee. Se ti va, la crei con un tocco dalla scheda.',
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
          this.ask(orch, runId, 'Quali piatti ci sono nel menu?', [], undefined, (answer) =>
            this.schedule([
              ...this.streamSteps(
                orch,
                runId,
                `Grazie! Preparo le bozze con questi piatti: ${answer}.`,
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
            'Che formato per il volantino?',
            [
              { id: '1', label: 'A5 da banco', description: 'Due facciate, foto del piatto' },
              { id: '2', label: 'Locandina A3', description: 'Una facciata, testo grande' },
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
                      data: { status: 'started', goal: `Risposta: ${answer}` },
                    }),
                ],
                ...this.streamSteps(orch, next, `Perfetto: preparo il volantino in ${answer}.`),
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
      ...this.streamSteps(orch, runId, 'Ti ho chiesto il formato: aspetto la tua risposta.'),
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
    const goal = 'Pubblica il post «Tram 28 all’alba» su Instagram';
    const summary = 'pubblicare il post «Tram 28 all’alba» su Instagram';
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
                  ? `Hai detto sì: Dione può ${summary}.`
                  : `Hai detto no: Dione non farà ${summary}.`,
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
                summary: yes ? 'Post pubblicato' : 'Non pubblicato: hai detto no',
              },
            }),
        ],
        ...this.streamSteps(
          orch,
          runId,
          yes
            ? 'Fatto: Dione ha pubblicato il post su Instagram.'
            : 'Va bene, niente pubblicazione: il post resta tra le bozze.',
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
              input: { caption: 'Tram 28 all’alba', image: 'Bozze/tram28.jpg' },
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
              message: `Dione vuole ${summary}: aspetta la tua risposta.`,
              subject: 'dione',
              confidence: 0.93,
              details,
            },
          });
          this.ask(
            'dione',
            runId,
            `Dione vuole ${summary}. Procedo?`,
            [
              { id: '1', label: 'Sì, procedi', description: 'Solo questa azione' },
              { id: '2', label: 'No, non farlo', description: 'Il mostro va avanti senza' },
            ],
            undefined,
            (choice) => finish(/^s[iì]/i.test(choice)),
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
        this.spend.stopReason('rhea') ?? 'raggiunto il tetto di spesa della squadra di oggi';
      this.append({
        agent: orch,
        runId,
        type: 'error',
        data: {
          code: 'spend_cap',
          message: `${name} si ferma: ${why}. Per farlo continuare alza il tetto ${why.includes(' del progetto ') ? 'nella scheda Spesa del progetto' : 'in Impostazioni → Modelli'}.`,
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
              input: { url: 'https://esempio.invalid/report' },
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
              error: 'ENOTFOUND esempio.invalid',
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
              message: 'Non riesco ad aprire la pagina: il sito non risponde.',
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
    const topic = /lisbona/i.test(text) ? 'Lisbona' : 'il tuo progetto';
    const noteAction = `act_${ulid().slice(-8).toLowerCase()}`;
    const notePath = `Risorse/Spunti su ${topic}.md`;
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
              message: 'Ho suggerito di affidare la richiesta a Rhea.',
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
        `Ricevuto! Chiedo a Rhea di raccogliere qualche spunto su ${topic}, poi ti faccio sapere.`,
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
              input: { to: 'rhea', goal: `Trova 5 spunti su ${topic}` },
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
              goal: `Trova 5 spunti su ${topic}`,
              why: 'Servono idee verificate per i post',
              doneWhen: 'Una nota con 5 spunti e le fonti',
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
    const query = `${topic} cosa vedere in un weekend`;
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
              text: 'Parto dal web, poi salvo tutto in una nota. ',
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
                  { title: `${topic}: 10 cose da fare`, url: 'https://www.visitlisboa.com/it' },
                  { title: 'I miradouros più belli', url: 'https://example.org/miradouros' },
                  { title: 'Tram 28, guida pratica', url: 'https://example.org/tram-28' },
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
              input: { path: notePath, tags: ['spunti', 'social'] },
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
            data: { role: 'agent', text: `Fatto: 5 spunti con le fonti nella nota ${notePath}.` },
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
              goal: `Trova 5 spunti su ${topic}`,
              summary: `5 spunti salvati in “Spunti su ${topic}”`,
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
              output: `5 spunti salvati in “Spunti su ${topic}”`,
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
            `Rhea ha trovato 5 spunti su ${topic}. Che tono diamo ai post?`,
            [
              { id: 'amichevole', label: 'Amichevole', description: 'Come un consiglio tra amici' },
              { id: 'ironico', label: 'Ironico', description: 'Leggero, con una battuta' },
              { id: 'elegante', label: 'Elegante', description: 'Pulito, da rivista di viaggi' },
            ],
            'amichevole',
            (choice) => this.writePosts(orch, runId, choice),
          ),
      ],
    ]);
  }

  private writePosts(orch: string, runId: string, choice: string): void {
    const actionId = `act_${ulid().slice(-8).toLowerCase()}`;
    const path = 'Progetti/Social/Bozze dei post.md';
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
              goal: `Scrivi 3 post con tono ${choice.toLowerCase()}`,
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
              goal: `Scrivi 3 post con tono ${choice.toLowerCase()}`,
              summary: '3 bozze pronte',
            },
          }),
      ],
      ...this.streamSteps(
        orch,
        runId,
        [
          `Ecco fatto! Dione ha scritto 3 post con tono ${choice.toLowerCase()}: li trovi in [[Progetti/Social/Bozze dei post|Bozze dei post]].`,
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
          'Hashtag: `#Lisbona` `#weekend`. Le fonti sono in [[Lisbona, spunti per il weekend]] e sul [sito del turismo](https://www.visitlisboa.com).',
          'Vuoi che li programmi a questi orari?',
        ].join('\n'),
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
      const jobs = AMBIENT_JOBS.filter((j) => j.agent === agent.id);
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
                message: `${job.agent} girava a vuoto: gli ho chiesto di cambiare strada.`,
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
              ...(fails ? { error: job.oops } : { summary: 'Fatto' }),
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
              data: { role: 'agent', text: `Fatto: “${job.goal}”.` },
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
        data: { status: 'started', goal: 'Riordina il diario di oggi' },
      },
      at(0),
    );
    this.append(
      {
        agent: 'enceladus',
        runId: r0,
        type: 'tool_call',
        data: { callId: 's1', tool: 'vault_edit', input: { path: 'Diario/2026-10-14.md' } },
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
          path: 'Diario/2026-10-14.md',
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
          text: 'Dione, mi scrivi una bio breve per Instagram?',
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
          text: 'Eccola: **Viaggi lenti, foto storte, caffè sempre.** Se vuoi una versione più seria, dimmelo.',
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
          text: 'Usa questa foto per il post di sabato, e fammi vedere il menu in una pagina.',
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
        data: { status: 'started', goal: 'Pagina dei post' },
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
          text: 'Bella luce! La uso per sabato. Il menu è in una pagina: aprila qui sopra.',
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
          text: 'Ciao Titan! Mi prepari 3 post per il weekend a Lisbona?',
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
        data: { status: 'started', goal: '3 post sul weekend a Lisbona' },
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
          text: 'Volentieri! Chiedo a Rhea di cercare gli spunti migliori, poi passo tutto a Dione per i testi.',
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
          input: { to: 'rhea', goal: 'Trova 5 spunti su Lisbona' },
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
          goal: 'Trova 5 spunti su Lisbona per un weekend',
          why: 'Servono idee verificate',
          doneWhen: 'Una nota con 5 spunti e le fonti',
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
          text: 'Comincio dalle guide ufficiali, poi controllo i miradouros. ',
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
          input: { query: 'Lisbona weekend cosa vedere ottobre', maxResults: 5 },
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
              { title: 'Lisbona in 2 giorni', url: 'https://www.visitlisboa.com/it' },
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
        data: { callId: 's4', tool: 'web_fetch', input: { url: 'https://www.visitlisboa.com/it' } },
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
          error: 'Timeout dopo 15 s',
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
          input: { path: 'Risorse/Lisbona, spunti per il weekend.md', tags: ['viaggi', 'spunti'] },
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
          path: 'Risorse/Lisbona, spunti per il weekend.md',
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
          output: { path: 'Risorse/Lisbona, spunti per il weekend.md' },
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
          text: 'Ho salvato 5 spunti con le fonti. La pagina del turismo era lenta, ho usato due guide alternative.',
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
          path: 'Agenti/Rhea/MEMORY.md',
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
          goal: 'Trova 5 spunti su Lisbona per un weekend',
          summary: '5 spunti salvati in “Lisbona, spunti per il weekend”',
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
          output: '5 spunti salvati in “Lisbona, spunti per il weekend”',
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
        data: { status: 'started', goal: 'Aggiorna il foglio delle spese' },
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
          message: 'Il foglio delle spese è aperto da un altro programma',
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
      'Rhea ha trovato 5 spunti su Lisbona. Che tono diamo ai post?',
      [
        { id: 'amichevole', label: 'Amichevole', description: 'Come un consiglio tra amici' },
        { id: 'ironico', label: 'Ironico', description: 'Leggero, con una battuta' },
        { id: 'elegante', label: 'Elegante', description: 'Pulito, da rivista di viaggi' },
      ],
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
          goal: 'Controlla gli orari del tram 28 nel weekend',
        },
      },
      now - 40_000,
    );
    this.append(
      {
        agent: 'rhea',
        runId: r2,
        type: 'tool_call',
        data: { callId: 's6', tool: 'web_search', input: { query: 'tram 28 orari weekend' } },
      },
      now - 20_000,
    );
    this.seedStuck(now);
    this.live = {
      ...this.live,
      titan: { mood: 'waiting', activity: 'Ti ho fatto una domanda', since: now },
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
          text: 'Ci prepari tre idee per il post di lunedì sul nuovo menù?',
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
          goal: 'Tre idee per il post di lunedì',
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
          text: 'Eccole, Livio:\n\n1. **Il menù in tre foto**: un carosello piatto per piatto.\n2. **Chi lo cucina**: una foto dello chef con la sua frase.\n3. **Indovina il piatto**: un dettaglio da vicino, la risposta nelle storie.\n\nDimmi quale preferite e scrivo il testo.',
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
          text: 'Titan, fai preparare ai social il post per la serata di sabato?',
          channel: 'ui',
        },
      },
      at(2),
    );
    this.append(
      { agent: orch, runId: ask, type: 'run', data: { status: 'started', goal: 'Post di sabato' } },
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
          input: { project: 'Social di Saturday', text: 'Il post per la serata di sabato' },
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
          text: 'Prepara il post per la serata di sabato: musica dal vivo dalle 21, ingresso libero. Tono amichevole, una foto della sala.',
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
          text: 'Ho passato il lavoro a Iapetus, il capo di Social di Saturday: ti dico appena ha finito.',
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
        data: { status: 'started', goal: 'Post della serata di sabato' },
      },
      at(0.05),
    );
    const answer =
      'Fatto: Calypso ha scritto il testo («Sabato si suona! Dalle 21, ingresso libero») e Pandora ha preparato la grafica con la foto della sala. Il post è nelle note del progetto, pronto per sabato alle 18.';
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
    const request = 'Titan, mi riassumi la riunione di ieri con Bruno e mi segni le cose da fare?';
    const note = 'Riunioni/Riassunto riunione con Bruno.md';
    const dioneGoal = 'Riassumi la riunione del 15/10 con Bruno e fai la lista delle cose da fare';
    const dioneDone = 'Una nota con il riassunto e almeno 3 cose da fare, ognuna con chi e quando';
    const rheaGoal = 'Trova indirizzo e sito del ristorante proposto da Bruno';
    const rheaDone = 'Indirizzo e sito del ristorante nella nota del riassunto';
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
        data: { role: 'user', text: request, channel: 'ui' },
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
          message: 'Ho suggerito di affidare la richiesta a Dione.',
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
          message: `Richiesta difficile: ${orch} usa ${model}.`,
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
          text: 'Ci pensa Dione per il riassunto; a Rhea chiedo il ristorante di cui avete parlato.',
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
          why: 'Sapere cosa fare questa settimana',
          doneWhen: dioneDone,
        },
      },
      0.01,
    ).id;
    tool('dione', d1, 'm2', 'vault_read', { path: 'Riunioni/2026-10-15 Bruno.md' }, 0.1);
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
          message: 'Il lavoro di Dione non era finito: gli ho chiesto di completarlo.',
          subject: 'dione',
          details: { missing: ['due cose da fare senza «chi»'], after: 'verified' },
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
          summary: 'Riassunto e 4 cose da fare, con chi e quando',
          check: {
            verdict: 'verified',
            retried: true,
            criteria: [
              { text: dioneDone, kind: 'done_when', ok: true, by: 'model', p: 0.91 },
              { text: 'Note salvate', kind: 'notes', ok: true, by: 'rules' },
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
          output: 'Riassunto e 4 cose da fare',
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
    tool('rhea', d2, 'm6', 'web_search', { query: 'Tasca do Chico Lisbona' }, 0.05);
    result('rhea', d2, 'm6', 'web_search', 910, 0.02);
    const fetch = tool(
      'rhea',
      d2,
      'm7',
      'web_fetch',
      { url: 'https://www.guida-lisbona.example/tasca-do-chico' },
      0.02,
    ).id;
    typesafe(0.02, 'rhea');
    add(
      {
        agent: 'system',
        runId: run,
        parentId: fetch,
        type: 'security',
        data: {
          action: 'injection_removed',
          source: 'web_fetch https://www.guida-lisbona.example/tasca-do-chico',
          tool: 'web_fetch',
          p: 0.94,
          blocks: 1,
          message:
            'Ho tolto da web_fetch https://www.guida-lisbona.example/tasca-do-chico un testo che dava ordini ai mostri.',
        },
      },
      0.01,
    );
    result('rhea', d2, 'm7', 'web_fetch', 1320, 0.01);
    free(0.05, 'rhea', 1);
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
          message:
            'Il lavoro di Rhea è in dubbio: l’indirizzo viene da una guida, non dal sito del ristorante',
          subject: 'rhea',
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
          summary: 'Indirizzo aggiunto alla nota',
          check: {
            verdict: 'doubt',
            criteria: [
              {
                text: rheaDone,
                kind: 'done_when',
                ok: false,
                by: 'model',
                p: 0.41,
                reason: 'l’indirizzo viene da una guida, il sito del ristorante non c’è',
              },
              { text: 'Note salvate', kind: 'notes', ok: true, by: 'rules' },
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
          output: 'Indirizzo aggiunto',
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
          text: [
            'Fatto: il riassunto è in [[Riassunto riunione con Bruno]], con 4 cose da fare, ognuna con chi e quando.',
            '',
            'Rhea ha aggiunto l’indirizzo della Tasca do Chico, ma viene da una guida: controllalo prima di prenotare.',
          ].join('\n'),
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
        data: { status: 'started', goal: 'Riordina le note di ottobre' },
      },
      now - 70_000,
    );
    for (let i = 0; i < 3; i++) {
      this.append(
        {
          agent: 'enceladus',
          runId: run,
          type: 'tool_call',
          data: { callId: `s-idx-${i}`, tool: 'vault_list', input: { folder: 'Ottobre' } },
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
          message: 'Enceladus sembra girare a vuoto.',
          subject: 'enceladus',
          confidence: 0.71,
        },
      },
      now - 8_000,
    );
  }
}
