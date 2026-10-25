import { initNewsSeen } from './news.ts';
import { dropNotice, pushNotice } from './notice-queue.ts';
import {
  appLang,
  chatAroundQueries,
  chatHistoryMerge,
  chatOwnQuery,
  DRAFT_EVENT_TYPES,
  onAppLang,
  setVaultLayout,
  type AgentSummary,
  type Lang,
  type AnswerRequest,
  type LogEvent,
  type Question,
  type StatusResponse,
  type UndoRunResult,
} from '@monsters/shared';
import { create } from 'zustand';
import { ApiClient, ApiError, describeError, type SetupBody } from '../lib/api.ts';
import { StreamClient, type ConnectionState } from '../lib/stream.ts';
import { desktop } from '../lib/desktop.ts';
import { applyLang } from '../lib/i18n.ts';
import { joinTabs, recoverSessionSecret, sessionSecret } from '../lib/session-secret.ts';
import type { Transport } from '../lib/transport.ts';
import { automationPath, MCP_SIGN_IN_PATH, PATHS, SPEND_CAP_PATH } from '../lib/router.ts';
import { appStrings } from './app.strings.ts';
import { keepHeld, storedHeld, takeHeld } from './drafts.ts';
import { usePreview } from './preview.ts';
import { listsInUse, refreshDrafts, refreshProjects, resetLists } from './projects.ts';
import {
  applyLive,
  ASKED_ACTIVITY,
  moodFromState,
  requestsOf,
  resumeText,
  retryOf,
  UNKNOWN_WORK,
  type LiveContext,
  type LiveState,
  type PendingSend,
  type StoppedRequest,
} from './derive.ts';

export type Phase = 'boot' | 'setup' | 'login' | 'ready' | 'unreachable';

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
  /**
   * One action in the toast ("Rifai"); it closes the toast. A toast with an action stays at least
   * 30 s, and until it is used or dismissed when it is news from the core (`fromEvent`): a
   * keyboard or screen-reader user needs time (store/notice-queue.ts).
   */
  action?: { label: string; run: () => void };
  /** How long a toast stays up, in ms (default: 3.5 s, 6 s for errors). */
  ms?: number;
  /** News from the core (a cap, a tool, an automation), not the answer to what the user just did. */
  fromEvent?: boolean;
  /** What the news is about ("spend"): `clearNotices` takes it away once it is no longer true. */
  topic?: string;
}

export interface AppState {
  phase: Phase;
  email: string | null;
  connection: ConnectionState;
  /**
   * The core has been out of reach for 3 attempts or 10 s: from then on the whole UI says "non
   * collegato" (display, bar of the capo, band under the rail, writing field).
   */
  linkLost: boolean;
  halted: boolean;
  haltedReason: string | null;
  /** Version of the core in use (`/api/status`), empty until known. */
  version: string;
  agents: Record<string, AgentSummary>;
  agentOrder: string[];
  live: Record<string, LiveState>;
  /**
   * The newest event the live state has taken in (D-157): older ones (a page of history
   * loaded by scrolling up, an event late on the stream) change the chats, never what the
   * monsters are doing now.
   */
  liveAt: string | null;
  /** Every event known to the UI, sorted by id (ULIDs sort by time). */
  events: LogEvent[];
  /** True when older history is still available on the core. */
  hasOlder: boolean;
  /**
   * The oldest event of the pages of the whole hub (the first one, then "Load older" in
   * Activity): from there on every chat is complete. Null with no history.
   */
  historyFloor: string | null;
  /** The history each chat loaded on its own (W-1), by monster: see `chatHistoryOf`. */
  chats: Record<string, ChatHistory>;
  questions: Record<string, Question>;
  /**
   * Options picked with a letter of the keypad that have not left yet (question id →
   * option id): they go after `ANSWER_UNDO_MS`, unless undone (V-1).
   */
  choices: Record<string, string>;
  /** Vault actions undone (actionId → commit of the undo), from the log and from this UI. */
  undone: Record<string, string>;
  /** Undos refused because the files changed afterwards (actionId → those files). */
  undoConflicts: Record<string, string[]>;
  pending: PendingSend[];
  /**
   * The monster "Dietro le quinte" shows, in its tab of the right-hand pane
   * (store/preview.ts says whether that tab is on screen); null: the open chat's.
   */
  terminalAgent: string | null;
  /** "Da rivedere" open as a sheet (windows too narrow for its column, phones). */
  reviewOpen: boolean;
  /** "Novità" as a sheet. */
  newsOpen: boolean;
  notice: Notice | null;
  /** The messages waiting behind the one on screen (store/notice-queue.ts). */
  noticeQueue: readonly Notice[];
  /**
   * "Conferma che sei tu": the core wants the user in person for a request (approvals,
   * permissions, Telegram) and this session is not (`owner`: opened by the app with the CLI
   * token), or the password is not recent enough for it (`recent`: the Terminal of a monster,
   * pairing Telegram, "Strumenti per gli altri"). False when closed.
   */
  ownerPrompt: false | 'owner' | 'recent';
}

const INITIAL: AppState = {
  phase: 'boot',
  email: null,
  connection: 'idle',
  linkLost: false,
  halted: false,
  haltedReason: null,
  version: '',
  agents: {},
  agentOrder: [],
  live: {},
  liveAt: null,
  events: [],
  hasOlder: false,
  historyFloor: null,
  chats: {},
  questions: {},
  choices: {},
  undone: {},
  undoConflicts: {},
  pending: [],
  terminalAgent: null,
  reviewOpen: false,
  newsOpen: false,
  notice: null,
  noticeQueue: [],
  ownerPrompt: false,
};

export const HISTORY_PAGE = 400;

/** The history a chat loaded on its own (W-1). */
export interface ChatHistory {
  /** Everything of this chat newer than this id is loaded (null: from the newest). */
  before: string | null;
  /** Something older may be on the core. */
  hasOlder: boolean;
  loading: boolean;
}

/**
 * Where a chat's history stands: its own pages, or the pages of the whole hub when those
 * went further back (or the chat never loaded any).
 */
export function chatHistoryOf(
  s: Pick<AppState, 'chats' | 'historyFloor' | 'hasOlder'>,
  agentId: string,
): ChatHistory {
  const own = s.chats[agentId];
  const hub: ChatHistory = { before: s.historyFloor, hasOlder: s.hasOlder, loading: false };
  if (!own) return hub;
  if (!own.hasOlder) return own;
  if (
    !s.hasOlder ||
    (s.historyFloor !== null && own.before !== null && s.historyFloor < own.before)
  )
    return { ...hub, loading: own.loading };
  return own;
}

/** How long a letter of the keypad can be undone before its answer leaves (V-1). */
export const ANSWER_UNDO_MS = 3000;

/** How long the stream may keep reconnecting before the UI calls the link lost. */
export const LINK_LOST_MS = 10_000;
let lostTimer: ReturnType<typeof setTimeout> | null = null;

function clearLostTimer(): void {
  if (lostTimer) clearTimeout(lostTimer);
  lostTimer = null;
}

/** The stream changed state: a link that comes back is whole again; one that stays down is lost. */
export function streamState(connection: ConnectionState): void {
  if (connection === 'open') {
    clearLostTimer();
    useApp.setState({ connection, linkLost: false });
    return;
  }
  if (connection === 'reconnecting' && !lostTimer && !useApp.getState().linkLost) {
    lostTimer = setTimeout(() => {
      lostTimer = null;
      if (useApp.getState().connection === 'reconnecting') useApp.setState({ linkLost: true });
    }, LINK_LOST_MS);
  }
  if (connection === 'closed' || connection === 'idle') clearLostTimer();
  useApp.setState({ connection });
}

/** "Riprova adesso" of the band under the rail. */
export function retryLinkNow(): void {
  stream?.retryNow();
}

export const useApp = create<AppState>()(() => ({ ...INITIAL }));

let api: ApiClient | null = null;
let stream: StreamClient | null = null;
let noticeSeq = 0;
const seen = new Set<string>();
/** Runs whose end the app has seen: their late words and tools are not work (`applyLive`). */
const endedRuns = new Set<string>();
/**
 * Events this UI added before the stream brought them (a new conversation, W-24): they are
 * not news for the live state and not the stream's cursor until the stream's copy comes.
 */
const localIds = new Set<string>();
/** Held messages this tab put in storage or took from it (see `flushHeld`). */
const keptHeld = new Set<string>();
/** The timers of the options picked with the keypad, by question (`chooseOption`). */
const choiceTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** A chat's page of history being loaded, by monster. */
const chatLoads = new Map<string, Promise<number>>();
/** The core has `GET /api/chats/:agent/history` (false after its 404: a core of before it). */
let chatRoute = true;
/** Moves on at every sign-out: an answer of the session before is dropped. */
let sessionSeq = 0;

function client(): ApiClient {
  if (!api) throw new Error('store not initialised: call initApp(transport) first');
  return api;
}

export function getApi(): ApiClient {
  return client();
}

/* --------------------------------------------------------------- events */

function questionFromEvent(e: LogEvent<'question'>): Question {
  return {
    id: e.data.questionId,
    from: e.agent,
    runId: e.runId ?? '',
    question: e.data.question,
    options: e.data.options,
    recommended: e.data.recommended,
    blocking: e.data.blocking,
    status: 'open',
    createdAt: e.ts,
  };
}

const byId = (a: LogEvent, b: LogEvent) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function liveContext(questions: () => Record<string, Question>): LiveContext {
  return {
    askerOf: (id) => questions()[id]?.from,
    runEnded: (runId) => endedRuns.has(runId),
  };
}

export interface IngestOptions {
  /**
   * Added by this UI ahead of the stream (W-24): kept out of the live state and of the
   * stream's cursor; the stream's own copy, when it comes, counts then.
   */
  local?: boolean;
  /** A page of older history: no toasts, and nothing reloaded because of what it holds. */
  history?: boolean;
}

/** Adds events (any order, duplicates ignored) and updates the derived state. */
export function ingest(batch: readonly LogEvent[], opts: IngestOptions = {}): void {
  // The stream's copy of an event this UI added first: it is news for the live state now.
  const confirmed = opts.local ? [] : batch.filter((e) => localIds.delete(e.id));
  // New ids only, each once (pages asked side by side overlap).
  const fresh: LogEvent[] = [];
  for (const e of batch) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (opts.local) localIds.add(e.id);
    fresh.push(e);
  }
  if (fresh.length === 0 && confirmed.length === 0) return;
  fresh.sort(byId);
  const news = opts.local ? [] : [...fresh, ...confirmed].sort(byId);

  useApp.setState((s) => {
    let events = s.events;
    if (fresh.length > 0) {
      const last = events[events.length - 1];
      if (!last || fresh[0]!.id > last.id) events = [...events, ...fresh];
      else events = [...events, ...fresh].sort(byId);
    }

    let live = s.live;
    let liveAt = s.liveAt;
    let questions = s.questions;
    let halted = s.halted;
    let haltedReason = s.haltedReason;
    let undone = s.undone;
    const ids = s.agentOrder;
    const ctx = liveContext(() => questions);
    for (const e of fresh) {
      if (e.type === 'run' && e.runId && e.data.status !== 'started') endedRuns.add(e.runId);
    }
    for (const e of fresh) {
      if (e.type === 'question') {
        if (!questions[e.data.questionId] || questions[e.data.questionId]!.status === 'open') {
          questions = {
            ...questions,
            [e.data.questionId]: questions[e.data.questionId] ?? questionFromEvent(e),
          };
        }
      } else if (e.type === 'answer') {
        const q = questions[e.data.questionId];
        if (q) {
          questions = {
            ...questions,
            [q.id]: {
              ...q,
              status: 'answered',
              answer: { optionId: e.data.optionId, text: e.data.text },
            },
          };
        }
      } else if (e.type === 'question_parked') {
        const q = questions[e.data.questionId];
        if (q && q.status === 'open') {
          questions = { ...questions, [q.id]: { ...q, parked: true } };
        }
      } else if (e.type === 'question_expired') {
        const q = questions[e.data.questionId];
        if (q && q.status === 'open') {
          questions = { ...questions, [q.id]: { ...q, status: 'expired' } };
        }
      } else if (e.type === 'vault_change' && e.data.undoneActionId) {
        undone = { ...undone, [e.data.undoneActionId]: e.data.commit ?? '' };
      } else if (e.type === 'kill' && e.data.scope === 'global') {
        halted = true;
        haltedReason = e.data.reason ?? null;
      } else if (e.type === 'resume') {
        halted = false;
        haltedReason = null;
      }
    }
    // After the questions of the batch: an answer finds who asked (`askerOf`).
    for (const e of news) {
      // Only what happened after the live state is news for it (an older page is history).
      if (liveAt === null || e.id > liveAt) {
        live = applyLive(live, e, ids, ctx);
        liveAt = e.id;
      }
    }
    return { events, live, liveAt, questions, halted, haltedReason, undone };
  });
  if (opts.history) return;
  // The spending cap (D-070): a warning or a stop that just happened is a toast too.
  const spend = fresh.findLast(
    (e): e is LogEvent<'spend'> => e.type === 'spend' && Date.now() - e.ts < 60_000,
  );
  if (spend) {
    notify(spend.data.message, spend.data.action === 'stopped' ? 'error' : 'info', {
      action: {
        label: appStrings().notices.raiseCap,
        run: () => (window.location.hash = SPEND_CAP_PATH),
      },
      ms: 10_000,
      fromEvent: true,
      topic: 'spend',
    });
  }
  // Tools of another program changed (D-070): they wait in "Da rivedere" (the decision is
  // in the settings). Plain words: no tool names, and not a sentence that asks for a decision
  // in a toast that goes away.
  const paused = fresh.findLast(
    (e): e is LogEvent<'security'> =>
      e.type === 'security' && e.data.action === 'mcp_tools_changed' && Date.now() - e.ts < 60_000,
  );
  if (paused && !spend) {
    const s = appStrings().notices;
    // i18n-ignore: "X ha cambiato…" / "X has changed…", the start of the core's message
    const who = /^(.{1,40}?) (?:ha|has|changed) /.exec(paused.data.message ?? '')?.[1];
    notify(s.toolChanged(who ?? s.aConnectedApp), 'info', {
      action: {
        label: s.view,
        run: () => {
          // Loaded on demand: the sheet's component imports this store.
          void import('../components/shell/ReviewSheet.tsx').then((m) => m.showReview());
        },
      },
      ms: 10_000,
      fromEvent: true,
    });
  }
  // A service whose sign-in died while in use (connettori 1): the card says "Serve l’accesso".
  const signIn = fresh.findLast(
    (e): e is LogEvent<'mcp_server'> =>
      e.type === 'mcp_server' && e.data.action === 'needs_signin' && Date.now() - e.ts < 60_000,
  );
  if (signIn && !spend && !paused) {
    const s = appStrings().notices;
    notify(signIn.data.message ?? s.serviceSignIn, 'error', {
      action: { label: s.connect, run: () => (window.location.hash = MCP_SIGN_IN_PATH) },
      ms: 10_000,
      fromEvent: true,
    });
  }
  // The end of a giro of an automation (D-094), when it asks for the notice of the app.
  const giro = fresh.findLast(
    (e): e is LogEvent<'automation_run_finished'> =>
      e.type === 'automation_run_finished' &&
      e.data.notify?.app !== false &&
      Date.now() - e.ts < 60_000 &&
      !(e.data.status === 'aborted' && useApp.getState().halted),
  );
  if (giro && !spend && !paused) {
    const d = giro.data;
    const s = appStrings().notices;
    const text =
      d.status === 'completed'
        ? s.automationDone(d.name)
        : d.status === 'waiting_user'
          ? s.automationWaiting(d.name)
          : s.automationFailed(d.name);
    notify(text, d.status === 'failed' ? 'error' : 'info', {
      action: {
        label: s.view,
        run: () => (window.location.hash = automationPath(d.automationId, { giro: d.giro })),
      },
      ms: 8000,
      fromEvent: true,
    });
  }
  // A monster added, renamed, re-skinned or archived (Settings → Squadra): the
  // sidebar, the chats and every name follow the core's new list.
  if (fresh.some((e) => e.type === 'team_change' || e.type === 'project_change')) {
    void refreshAgents().catch(() => {});
  }
  // The projects and the drafts in use follow their events (D-097, D-098).
  const inUse = listsInUse();
  if (
    inUse.projects &&
    fresh.some((e) => e.type === 'project_change' || e.type === 'team_change')
  ) {
    void refreshProjects();
  }
  const drafts: readonly string[] = DRAFT_EVENT_TYPES;
  if (inUse.drafts && fresh.some((e) => drafts.includes(e.type))) void refreshDrafts();
}

/** The newest event the live state had taken in when a snapshot was asked for (W-2). */
function liveCursor(): string | null {
  return useApp.getState().liveAt;
}

/**
 * The team as the core sent it, with the live state of its snapshot. `from` is where the
 * live state stood when the snapshot was asked for: the events the stream brought since
 * then may be newer than the snapshot (a run that ended meanwhile), so they are played
 * again on it, and a late answer never puts back what they changed (W-2).
 */
function setAgents(list: readonly AgentSummary[], from: string | null): void {
  const agents: Record<string, AgentSummary> = {};
  for (const a of list) agents[a.id] = a;
  // Orchestrator first, then the order given by the core.
  const order = [...list]
    .sort((a, b) => Number(b.isOrchestrator) - Number(a.isOrchestrator))
    .map((a) => a.id);
  const now = Date.now();
  const live: Record<string, LiveState> = {};
  for (const a of list) {
    // The core keeps the confused face too (D-072): since then, for its minimum time.
    const confused = a.confusedSince !== undefined;
    // Its open work items, whose ends will bring it to rest (an older core: "some", D-157).
    const work = a.work ?? (a.state === 'working' ? [UNKNOWN_WORK] : []);
    live[a.id] = {
      mood: moodFromState(a.state),
      // The core's `waiting` is a question for the user (a delegation is `working`).
      activity: a.state === 'waiting' ? ASKED_ACTIVITY : a.activity,
      ...(a.state === 'waiting' ? { asked: true as const } : {}),
      since: confused ? a.confusedSince! : now,
      ...(confused ? { confused: true } : {}),
      ...(work.length > 0 ? { work } : {}),
    };
  }
  useApp.setState((s) => {
    let next = live;
    const until = s.liveAt;
    if (until !== null && (from === null || from < until)) {
      const ctx = liveContext(() => s.questions);
      for (const e of s.events) {
        if ((from !== null && e.id <= from) || e.id > until || localIds.has(e.id)) continue;
        next = applyLive(next, e, order, ctx);
      }
    }
    return { agents, agentOrder: order, live: next };
  });
}

/** Reloads the team from the core (e.g. after the onboarding created it). */
export async function refreshAgents(): Promise<void> {
  const from = liveCursor();
  setAgents(await client().agents(), from);
}

function applyStatus(st: StatusResponse): void {
  useApp.setState({ halted: st.halted, haltedReason: st.haltedReason, version: st.version });
  initNewsSeen(st.version);
}

/* -------------------------------------------------------------- notices */

export function notify(
  text: string,
  tone: Notice['tone'] = 'info',
  extra: Pick<Notice, 'action' | 'ms' | 'fromEvent' | 'topic'> = {},
): void {
  const { notice, noticeQueue } = useApp.getState();
  const line = pushNotice(
    { notice, queue: noticeQueue },
    { id: ++noticeSeq, text, tone, ...extra },
  );
  useApp.setState({ notice: line.notice, noticeQueue: line.queue });
}

/** Takes away the news about `topic`, on screen or waiting: it is no longer true (a cap raised). */
export function clearNotices(topic: string): void {
  const { notice, noticeQueue } = useApp.getState();
  const queue = noticeQueue.filter((n) => n.topic !== topic);
  if (notice?.topic === topic) {
    const [next, ...rest] = queue;
    useApp.setState({ notice: next ?? null, noticeQueue: rest });
  } else {
    useApp.setState({ noticeQueue: queue });
  }
}

export function dismissNotice(id: number): void {
  const { notice, noticeQueue } = useApp.getState();
  const line = dropNotice({ notice, queue: noticeQueue }, id);
  useApp.setState({ notice: line.notice, noticeQueue: line.queue });
}

/* ------------------------------------------------------------- lifecycle */

/** The answer the open "Conferma che sei tu" waits for (one at a time, shared). */
let ownerAsked: Promise<boolean> | null = null;
let ownerAnswer: ((ok: boolean) => void) | null = null;

/** Opens "Conferma che sei tu" (or joins the one already open). */
function askOwner(reason: 'owner' | 'recent'): Promise<boolean> {
  ownerAsked ??= new Promise<boolean>((resolve) => {
    ownerAnswer = resolve;
    useApp.setState({ ownerPrompt: reason });
  });
  return ownerAsked;
}

/** "Conferma che sei tu" closed: `ok` when the password was right (the session is the user's now). */
export function answerOwnerPrompt(ok: boolean): void {
  const answer = ownerAnswer;
  ownerAsked = null;
  ownerAnswer = null;
  useApp.setState({ ownerPrompt: false });
  answer?.(ok);
}

/**
 * The password again, for "Conferma che sei tu": this same session becomes the user's in person,
 * and recent for the most sensitive changes (the core, `POST /api/auth/confirm`).
 */
export async function confirmOwner(password: string): Promise<void> {
  if (!useApp.getState().email) throw new ApiError(401, 'unauthorized');
  await client().confirm(password);
}

export function initApp(transport: Transport): void {
  api = new ApiClient(transport);
  // The tabs opened later on this origin ask this one for the session's secret (S-B13).
  if (transport.kind === 'http' && !desktop()) joinTabs();
  api.confirmOwner = askOwner;
  stream?.stop();
  stream = new StreamClient(
    transport,
    {
      onHello: (halted) => {
        useApp.setState({ halted });
        void resync();
      },
      onEvent: (e) => ingest([e]),
      onState: streamState,
      onUnauthorized: () => void sessionLost(),
      onTrouble: () => {
        useApp.setState({ linkLost: true });
        void checkSession();
      },
    },
    { cursor: streamCursor },
  );
}

/** Where the stream resumes: the newest event, not one this UI added ahead of it (W-24). */
function streamCursor(): string | undefined {
  const events = useApp.getState().events;
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i]!.id;
    if (!localIds.has(id)) return id;
  }
  return undefined;
}

/** The module's own memory of a session (the store's state is reset by the callers). */
function clearModuleState(): void {
  seen.clear();
  endedRuns.clear();
  localIds.clear();
  keptHeld.clear();
  for (const t of choiceTimers.values()) clearTimeout(t);
  choiceTimers.clear();
  chatLoads.clear();
  chatRoute = true;
  sessionSeq++;
  resetLists();
}

/** Resets everything that belongs to a session. */
function clearSession(): void {
  answerOwnerPrompt(false);
  stream?.stop();
  clearLostTimer();
  clearModuleState();
  useApp.setState({
    ...INITIAL,
    phase: 'login',
  });
}

async function sessionLost(): Promise<void> {
  clearSession();
  notify(appStrings().notices.sessionEnded, 'info');
  await boot();
}

async function checkSession(): Promise<void> {
  try {
    const me = await client().me();
    if (!me) await sessionLost();
  } catch {
    // core unreachable: the stream keeps retrying
  }
}

/** The language the core said at boot (D-153); null for an older core. */
let coreLang: Lang | null = null;

export async function boot(): Promise<void> {
  const c = client();
  try {
    const setup = await c.setupStatus();
    // The core's language wins over the browser's guess (D-153).
    if (setup.language) applyLang(setup.language);
    // The names of the vault's folders (D-154): an older core's vault is Italian.
    setVaultLayout(setup.vaultLayout ?? 'it');
    coreLang = setup.language ?? null;
    if (setup.needsSetup) {
      useApp.setState({ phase: 'setup' });
      return;
    }
    let me = await c.me();
    // A new tab of a browser (S-B13): the secret of the session may be in a tab already open.
    if (!me && c.transport.kind === 'http' && !desktop()) {
      const held = sessionSecret();
      const found = await recoverSessionSecret();
      if (found && found !== held) me = await c.me();
    }
    if (!me) {
      useApp.setState({ phase: 'login' });
      return;
    }
    useApp.setState({ email: me.email });
    await loadWorkspace();
  } catch {
    useApp.setState({ phase: 'unreachable' });
  }
}

async function loadWorkspace(): Promise<void> {
  const c = client();
  const page = c.events({ limit: HISTORY_PAGE, order: 'desc' });
  // The live mood (the confused face too) comes from the core's snapshot, not from replaying
  // old history: asked once the page is in, it is never older than the page (W-2).
  const team = page.then(() =>
    c.agents().catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return [] as AgentSummary[];
      throw err;
    }),
  );
  // Awaited below; a failed page fails the boot first.
  team.catch(() => {});
  const [history, status, known] = await Promise.all([
    page,
    c.status(),
    c.questions('all').catch(() => [] as Question[]),
  ]);
  ingest(history);
  const from = liveCursor();
  setAgents(await team, from);
  applyStatus(status);
  mergeQuestions(known);
  useApp.setState({
    phase: 'ready',
    hasOlder: history.length >= HISTORY_PAGE,
    historyFloor: history.at(-1)?.id ?? null,
  });
  restoreHeld();
  stream?.start();
}

/**
 * The core's list is the truth (status included), also for questions older than the history
 * page; but a snapshot older than the event that closed a question never opens it again, nor
 * takes back its "paused" mark (W-2): the next message would go out as its answer.
 */
function mergeQuestions(known: readonly Question[]): void {
  if (!known.length) return;
  useApp.setState((s) => {
    const questions = { ...s.questions };
    for (const q of known) {
      const cur = questions[q.id];
      if (cur && cur.status !== 'open' && q.status === 'open') continue;
      questions[q.id] =
        cur?.parked && q.status === 'open' && !q.parked ? { ...q, parked: true } : q;
    }
    return { questions };
  });
}

/**
 * At every `hello` (first connection and each reconnection, e.g. after the core
 * restarted): agents and questions as the core sees them now, since what
 * happened while the UI was away may not be in the replay (a crash, a restart).
 */
async function resync(): Promise<void> {
  if (useApp.getState().phase !== 'ready') return;
  const c = client();
  const from = liveCursor();
  try {
    const [agents, known] = await Promise.all([c.agents(), c.questions('all')]);
    if (useApp.getState().phase !== 'ready') return;
    setAgents(agents, from);
    mergeQuestions(known);
  } catch {
    // core unreachable again: the next hello retries
  }
}

/* --------------------------------------------------------------- actions */

/**
 * Optional pause between a successful sign-in and the app: the sign-in screen
 * wakes its monster up there (components/auth/AuthScreen.tsx).
 */
export interface EnterOptions {
  beforeEnter?: () => Promise<void>;
}

/** The names of the vault's folders as the core says them now (D-154). */
async function refreshVaultLayout(): Promise<void> {
  const status = await client()
    .setupStatus()
    .catch(() => null);
  if (status?.vaultLayout) setVaultLayout(status.vaultLayout);
}

export async function setup(body: SetupBody, opts: EnterOptions = {}): Promise<void> {
  // The language of the first screen goes with the account (D-153).
  const res = await client().setup({ language: appLang(), ...body });
  // The core may have made its new vault again in the language picked here (D-154).
  await refreshVaultLayout();
  await opts.beforeEnter?.();
  useApp.setState({ email: res.email });
  await loadWorkspace();
  window.location.hash = PATHS.welcome;
}

export async function login(
  email: string,
  password: string,
  opts: EnterOptions = {},
): Promise<void> {
  const res = await client().login(email, password);
  await opts.beforeEnter?.();
  // A language chosen on the sign-in screen (D-153) becomes the core's.
  if (coreLang && appLang() !== coreLang) {
    await client()
      .setLanguage(appLang())
      .then((settings) => {
        coreLang = appLang();
        if (settings.vaultLayout) setVaultLayout(settings.vaultLayout);
      })
      .catch(() => {});
  }
  useApp.setState({ email: res.email });
  await loadWorkspace();
}

export async function logout(): Promise<void> {
  try {
    await client().logout();
  } finally {
    clearSession();
    window.location.hash = PATHS.home;
  }
}

/** The next page of the whole hub's history, before the oldest one loaded (Activity). */
export async function loadOlder(): Promise<number> {
  // Not the oldest event in memory: a chat's own pages go further back for that chat only.
  const floor = useApp.getState().historyFloor;
  const older = await client().events({
    limit: HISTORY_PAGE,
    order: 'desc',
    ...(floor ? { before: floor } : {}),
  });
  ingest(older, { history: true });
  useApp.setState((s) => ({
    hasOlder: older.length >= HISTORY_PAGE,
    historyFloor: older.at(-1)?.id ?? s.historyFloor,
  }));
  return older.length;
}

function setChat(agentId: string, h: ChatHistory): void {
  useApp.setState((s) => ({ chats: { ...s.chats, [agentId]: h } }));
}

/**
 * One page of a chat's history: one request to the core, which chooses what the chat shows
 * (`GET /api/chats/:agent/history`). A core without that route answers 404 (the web UI is served
 * by its own core, so only a development UI in front of an older core meets one): then the same
 * rule over `/api/events`, in three requests, as before.
 */
async function chatPage(
  agentId: string,
  before: string | undefined,
): Promise<{ events: LogEvent[]; floor: string | null; own: number }> {
  const c = client();
  if (chatRoute) {
    const page = await c.chatHistory(agentId, before);
    if (page) return page;
    chatRoute = false;
  }
  const own = await c.events(chatOwnQuery(agentId, before));
  const [around, words] = await Promise.all(chatAroundQueries(own, before).map((q) => c.events(q)));
  return chatHistoryMerge(own, around!, words!);
}

/**
 * The next page of one chat's history (W-1): the events of its monster, of every kind, and
 * in the same span what the chat shows of the others and the user's messages. The chat is then
 * complete down to the newest edge of the pages that were cut. Resolves to how many events of
 * its monster came; 0 when there is nothing older.
 */
export function loadChatOlder(agentId: string): Promise<number> {
  const running = chatLoads.get(agentId);
  if (running) return running;
  const cur = chatHistoryOf(useApp.getState(), agentId);
  if (!cur.hasOlder) return Promise.resolve(0);
  const at = sessionSeq;
  const job = (async () => {
    setChat(agentId, { ...cur, loading: true });
    try {
      const page = await chatPage(agentId, cur.before ?? undefined);
      if (at !== sessionSeq) return 0;
      const { floor } = page;
      ingest(page.events, { history: true });
      setChat(agentId, { before: floor ?? cur.before, hasOlder: floor !== null, loading: false });
      return page.own;
    } catch (err) {
      if (at === sessionSeq) setChat(agentId, { ...cur, loading: false });
      throw err;
    } finally {
      chatLoads.delete(agentId);
    }
  })();
  chatLoads.set(agentId, job);
  return job;
}

let tempSeq = 0;

/**
 * Sends a message to a monster (to the orchestrator without `to`). While the
 * monsters are stopped the core refuses messages: the UI holds it instead, and
 * it goes when they are resumed (`flushHeld`).
 */
export async function sendMessage(
  text: string,
  to?: string,
  /** Ids of files already uploaded (`POST /api/files`). */
  attachments?: readonly string[],
): Promise<void> {
  // Unique across reloads too: a held message kept in storage comes back with its id.
  const tempId = `pending-${Date.now().toString(36)}-${++tempSeq}`;
  const files = attachments?.length ? [...attachments] : undefined;
  if (useApp.getState().halted) {
    const held: PendingSend = {
      tempId,
      text,
      to,
      ts: Date.now(),
      held: true,
      ...(files ? { attachments: files } : {}),
    };
    // Kept in storage too (W-6): a reload or closing the app does not lose it.
    if (keepHeld(useApp.getState().email, held)) keptHeld.add(tempId);
    useApp.setState((s) => ({ pending: [...s.pending, held] }));
    return;
  }
  useApp.setState((s) => ({
    pending: [
      ...s.pending,
      { tempId, text, to, ts: Date.now(), ...(files ? { attachments: files } : {}) },
    ],
  }));
  try {
    await client().sendMessage({
      text,
      ...(to ? { to } : {}),
      ...(files ? { attachments: files } : {}),
    });
    // The bubble stays until the core's own event replaces it (see buildChat).
    setTimeout(() => {
      useApp.setState((s) => ({ pending: s.pending.filter((p) => p.tempId !== tempId) }));
    }, 15_000);
  } catch (err) {
    useApp.setState((s) => ({ pending: s.pending.filter((p) => p.tempId !== tempId) }));
    throw err;
  }
}

/** Drops a message held while the monsters are stopped. */
export function dropHeld(tempId: string): void {
  takeHeld(useApp.getState().email, [tempId]);
  keptHeld.delete(tempId);
  useApp.setState((s) => ({ pending: s.pending.filter((p) => p.tempId !== tempId) }));
}

/** The messages held before a reload (or in another tab), back in their chats (W-6). */
function restoreHeld(): void {
  const stored = storedHeld(useApp.getState().email);
  if (stored.length === 0) return;
  for (const p of stored) keptHeld.add(p.tempId);
  useApp.setState((s) => {
    const have = new Set(s.pending.map((p) => p.tempId));
    return { pending: [...s.pending, ...stored.filter((p) => !have.has(p.tempId))] };
  });
  // Resumed while the app was closed: they go now, as promised.
  if (!useApp.getState().halted) void flushHeld();
}

/** Sends the messages held while the monsters were stopped, in order. */
async function flushHeld(): Promise<void> {
  const all = useApp.getState().pending.filter((p) => p.held);
  if (all.length === 0) return;
  const ids = new Set(all.map((p) => p.tempId));
  useApp.setState((s) => ({ pending: s.pending.filter((p) => !ids.has(p.tempId)) }));
  // Those kept in storage that are gone from it were sent by another tab first.
  const gone = takeHeld(useApp.getState().email, [...ids]);
  const held = all.filter((p) => !(keptHeld.has(p.tempId) && gone.has(p.tempId)));
  for (const id of ids) keptHeld.delete(id);
  for (const p of held) {
    try {
      await sendMessage(p.text, p.to, p.attachments);
    } catch (err) {
      notify(describeError(err), 'error');
    }
  }
}

// Resumed (from here, another window, the CLI or Telegram): the held messages go.
useApp.subscribe((s, prev) => {
  if (prev.halted && !s.halted && s.phase === 'ready') void flushHeld();
});

/**
 * Starts a new conversation (every agent, or only `to`). The event also comes
 * on the stream; it is added at once so the chat starts over without waiting.
 */
export async function startNewConversation(to?: string): Promise<void> {
  const res = await client().newConversation(to);
  // Local until the stream's copy comes: events still in flight before it keep counting (W-24).
  ingest(
    [
      {
        id: res.id,
        ts: res.ts,
        agent: 'user',
        runId: null,
        parentId: null,
        type: 'new_conversation',
        data: { ...(res.to ? { to: res.to } : {}), channel: 'ui' },
      },
    ],
    { local: true },
  );
}

export async function answerQuestion(id: string, body: AnswerRequest): Promise<void> {
  const q = await client().answer(id, body);
  useApp.setState((s) => ({ questions: { ...s.questions, [q.id]: q } }));
}

function dropChoice(questionId: string): void {
  const t = choiceTimers.get(questionId);
  if (t) clearTimeout(t);
  choiceTimers.delete(questionId);
  if (!(questionId in useApp.getState().choices)) return;
  useApp.setState((s) => {
    const choices = { ...s.choices };
    delete choices[questionId];
    return { choices };
  });
}

/**
 * An option picked with a letter of the keyboard (V-1): it shows as sent, and leaves after
 * `ANSWER_UNDO_MS` unless `undoChoice` comes first. A letter typed by mistake costs nothing.
 */
export function chooseOption(questionId: string, optionId: string): void {
  if (choiceTimers.has(questionId) || questionId in useApp.getState().choices) return;
  useApp.setState((s) => ({ choices: { ...s.choices, [questionId]: optionId } }));
  const at = sessionSeq;
  choiceTimers.set(
    questionId,
    setTimeout(() => {
      choiceTimers.delete(questionId);
      if (at !== sessionSeq) return;
      // Answered meanwhile (another tab, Telegram) or gone: nothing to send.
      if (useApp.getState().questions[questionId]?.status !== 'open') {
        dropChoice(questionId);
        return;
      }
      answerQuestion(questionId, { optionId })
        .catch((err: unknown) => notify(describeError(err), 'error'))
        .finally(() => dropChoice(questionId));
    }, ANSWER_UNDO_MS),
  );
}

/** "Annulla" on an option picked with the keyboard: it does not leave. True when it was waiting. */
export function undoChoice(questionId: string): boolean {
  if (!choiceTimers.has(questionId)) return false;
  dropChoice(questionId);
  return true;
}

/**
 * Undoes a vault action. When the files changed afterwards the core refuses
 * (`conflict`): the files are kept in `undoConflicts` so the UI can explain
 * and offer to undo anyway (`force`). True when it was undone; `silent` leaves
 * the success message to the caller.
 */
export async function undoAction(
  actionId: string,
  force = false,
  silent = false,
): Promise<boolean> {
  try {
    const res = await client().undo(actionId, force);
    useApp.setState((s) => {
      const undoConflicts = { ...s.undoConflicts };
      delete undoConflicts[actionId];
      return { undone: { ...s.undone, [actionId]: res.commit ?? '' }, undoConflicts };
    });
    if (!silent) notify(appStrings().notices.undone, 'success');
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'conflict' && !force) {
      const files = err.files ?? [];
      useApp.setState((s) => ({ undoConflicts: { ...s.undoConflicts, [actionId]: files } }));
      return false;
    }
    notify(describeError(err), 'error');
    return false;
  }
}

/** Keeps the action as it is after a refused undo. */
/**
 * "Annulla tutto il lavoro" of a run (D-068): the core undoes every note change
 * of the run, newest first; what it undid is marked at once (the undo events
 * follow on the stream), what it could not undo comes back with the reason.
 */
export async function undoRun(runId: string): Promise<UndoRunResult> {
  const res = await getApi().undoRun(runId);
  if (res.undone.length > 0)
    useApp.setState((s) => {
      const undone = { ...s.undone };
      for (const u of res.undone) undone[u.actionId] = u.commit ?? '';
      return { undone };
    });
  return res;
}

export function dismissUndoConflict(actionId: string): void {
  useApp.setState((s) => {
    const undoConflicts = { ...s.undoConflicts };
    delete undoConflicts[actionId];
    return { undoConflicts };
  });
}

export async function killAll(reason?: string): Promise<void> {
  // Optimistic: the banner shows up at once, the event confirms it.
  useApp.setState({ halted: true });
  try {
    applyStatus(await client().kill(reason));
  } catch (err) {
    notify(describeError(err), 'error');
    try {
      applyStatus(await client().status());
    } catch {
      // keep the optimistic state: better to look stopped than running
    }
  }
}

export async function resumeAll(): Promise<void> {
  try {
    applyStatus(await client().resume());
  } catch (err) {
    notify(describeError(err), 'error');
  }
}

/**
 * Starts again a request whose work Ferma stopped, marked as such (`resumeOf`):
 * the chat shows a status line, not the user's message typed again (D-072).
 */
async function sendAgain(r: StoppedRequest): Promise<void> {
  await client().sendMessage({ text: resumeText(r.text), to: r.agent, resumeOf: r.runId });
}

/**
 * "Riprendi e continua" (the halt band): the core resumes and starts again
 * the work the stop left halfway, one request per stopped run (its questions
 * are asked again by the work itself, D-072). Nothing restarts by itself with
 * the plain "Riprendi": Ferma is a safety switch.
 */
export async function resumeAndContinue(): Promise<void> {
  try {
    applyStatus(await client().resume({ continue: true }));
  } catch (err) {
    notify(describeError(err), 'error');
  }
}

/**
 * "Chiedimelo di nuovo" on a question that expired (stopped, restarted): the
 * request of its run goes again, or, when it has none (a question born
 * elsewhere), the monster is asked to ask again.
 */
export async function askAgain(questionId: string): Promise<void> {
  const s = useApp.getState();
  const q = s.questions[questionId];
  if (!q) return;
  const [request] = q.runId ? requestsOf(s.events, new Set([q.runId])) : [];
  if (request) return sendAgain(request);
  const lead = s.agents[q.from]?.isOrchestrator === true;
  await sendMessage(appStrings().askAgain(q.question), lead ? undefined : q.from);
}

/** "Riprova" under an error of the chat: the failed run's request goes again (false: nothing to send). */
export async function retryRun(runId: string): Promise<boolean> {
  const s = useApp.getState();
  const retry = retryOf(s.events, runId);
  if (!retry) return false;
  const lead = s.agents[retry.agent]?.isOrchestrator === true;
  await sendMessage(retry.text, lead ? undefined : retry.agent);
  return true;
}

/** "Dietro le quinte" of a monster: the tab of the right-hand pane (D-075). */
export function openTerminal(agentId: string): void {
  useApp.setState({ terminalAgent: agentId, reviewOpen: false, newsOpen: false });
  usePreview.getState().showTab('terminal');
}

/** Closes "Da rivedere" as a sheet, and the right-hand pane when it shows the terminal. */
export function closeTerminal(): void {
  useApp.setState({ reviewOpen: false });
  const dock = usePreview.getState();
  if (dock.visible && dock.tab === 'terminal') dock.hide();
}

/**
 * "Da rivedere" as a sheet (the column of wide windows is a preference,
 * `activityPanel`): one thing on the right at a time, so it hides the pane.
 */
export function setReviewOpen(open: boolean): void {
  useApp.setState(open ? { reviewOpen: true, newsOpen: false } : { reviewOpen: false });
  if (open) usePreview.getState().hide();
}

/** "Novità" as a sheet, in the same place as "Da rivedere": one of the two at a time. */
export function setNewsOpen(open: boolean): void {
  useApp.setState(open ? { newsOpen: true, reviewOpen: false } : { newsOpen: false });
  if (open) usePreview.getState().hide();
}

export function errorText(err: unknown): string {
  return describeError(err);
}

// The live activities were written in the old language: the core's snapshot says them again.
onAppLang(() => {
  if (api && useApp.getState().phase === 'ready') void refreshAgents().catch(() => {});
});

/** Test helper: back to a blank store. */
export function resetForTests(): void {
  clearModuleState();
  useApp.setState({ ...INITIAL });
}
