import { initNewsSeen } from './news.ts';
import {
  appLang,
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
import { automationPath, MCP_SIGN_IN_PATH, SPEND_CAP_PATH } from '../lib/router.ts';
import { appStrings } from './app.strings.ts';
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
  /** One action in the toast ("Rifai"); it closes the toast. */
  action?: { label: string; run: () => void };
  /** How long it stays up, in ms (default: 3.5 s, 6 s for errors). */
  ms?: number;
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
  questions: Record<string, Question>;
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
  questions: {},
  undone: {},
  undoConflicts: {},
  pending: [],
  terminalAgent: null,
  reviewOpen: false,
  newsOpen: false,
  notice: null,
  ownerPrompt: false,
};

export const HISTORY_PAGE = 400;

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

/** Adds events (any order, duplicates ignored) and updates the derived state. */
export function ingest(batch: readonly LogEvent[]): void {
  const fresh = batch.filter((e) => !seen.has(e.id));
  if (fresh.length === 0) return;
  for (const e of fresh) seen.add(e.id);
  fresh.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  useApp.setState((s) => {
    let events = s.events;
    const last = events[events.length - 1];
    if (!last || fresh[0]!.id > last.id) events = [...events, ...fresh];
    else events = [...events, ...fresh].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let live = s.live;
    let liveAt = s.liveAt;
    let questions = s.questions;
    let halted = s.halted;
    let haltedReason = s.haltedReason;
    let undone = s.undone;
    const ids = s.agentOrder;
    const ctx: LiveContext = {
      askerOf: (id) => questions[id]?.from,
      runEnded: (runId) => endedRuns.has(runId),
    };
    for (const e of fresh) {
      if (e.type === 'run' && e.runId && e.data.status !== 'started') endedRuns.add(e.runId);
    }
    for (const e of fresh) {
      // Only what happened after the live state is news for it (an older page is history).
      if (liveAt === null || e.id > liveAt) {
        live = applyLive(live, e, ids, ctx);
        liveAt = e.id;
      }
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
    return { events, live, liveAt, questions, halted, haltedReason, undone };
  });
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

function setAgents(list: readonly AgentSummary[]): void {
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
      since: confused ? a.confusedSince! : now,
      ...(confused ? { confused: true } : {}),
      ...(work.length > 0 ? { work } : {}),
    };
  }
  useApp.setState({ agents, agentOrder: order, live });
}

/** Reloads the team from the core (e.g. after the onboarding created it). */
export async function refreshAgents(): Promise<void> {
  setAgents(await client().agents());
}

function applyStatus(st: StatusResponse): void {
  useApp.setState({ halted: st.halted, haltedReason: st.haltedReason, version: st.version });
  initNewsSeen(st.version);
}

/* -------------------------------------------------------------- notices */

export function notify(
  text: string,
  tone: Notice['tone'] = 'info',
  extra: Pick<Notice, 'action' | 'ms'> = {},
): void {
  useApp.setState({ notice: { id: ++noticeSeq, text, tone, ...extra } });
}

export function dismissNotice(id: number): void {
  if (useApp.getState().notice?.id === id) useApp.setState({ notice: null });
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
    { cursor: () => useApp.getState().events.at(-1)?.id },
  );
}

/** Resets everything that belongs to a session. */
function clearSession(): void {
  answerOwnerPrompt(false);
  stream?.stop();
  clearLostTimer();
  seen.clear();
  endedRuns.clear();
  resetLists();
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
  const [agents, status, history, known] = await Promise.all([
    c.agents().catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return [] as AgentSummary[];
      throw err;
    }),
    c.status(),
    c.events({ limit: HISTORY_PAGE, order: 'desc' }),
    c.questions('all').catch(() => [] as Question[]),
  ]);
  setAgents(agents);
  ingest(history);
  // The live mood (the confused face too) comes from the core snapshot, not from replaying old history.
  setAgents(agents);
  applyStatus(status);
  mergeQuestions(known);
  useApp.setState({ phase: 'ready', hasOlder: history.length >= HISTORY_PAGE });
  stream?.start();
}

/** The core's list is the truth (status included), also for questions older than the history page. */
function mergeQuestions(known: readonly Question[]): void {
  if (!known.length) return;
  useApp.setState((s) => {
    const questions = { ...s.questions };
    for (const q of known) questions[q.id] = q;
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
  try {
    const [agents, known] = await Promise.all([c.agents(), c.questions('all')]);
    if (useApp.getState().phase !== 'ready') return;
    setAgents(agents);
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
  window.location.hash = '#/benvenuto';
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
    window.location.hash = '#/';
  }
}

export async function loadOlder(): Promise<number> {
  const oldest = useApp.getState().events[0];
  const older = await client().events({
    limit: HISTORY_PAGE,
    order: 'desc',
    ...(oldest ? { before: oldest.id } : {}),
  });
  ingest(older);
  useApp.setState({ hasOlder: older.length >= HISTORY_PAGE });
  return older.length;
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
  const tempId = `pending-${++tempSeq}`;
  const files = attachments?.length ? [...attachments] : undefined;
  if (useApp.getState().halted) {
    useApp.setState((s) => ({
      pending: [
        ...s.pending,
        { tempId, text, to, ts: Date.now(), held: true, ...(files ? { attachments: files } : {}) },
      ],
    }));
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
  useApp.setState((s) => ({ pending: s.pending.filter((p) => p.tempId !== tempId) }));
}

/** Sends the messages held while the monsters were stopped, in order. */
async function flushHeld(): Promise<void> {
  const held = useApp.getState().pending.filter((p) => p.held);
  if (held.length === 0) return;
  const ids = new Set(held.map((p) => p.tempId));
  useApp.setState((s) => ({ pending: s.pending.filter((p) => !ids.has(p.tempId)) }));
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
  ingest([
    {
      id: res.id,
      ts: res.ts,
      agent: 'user',
      runId: null,
      parentId: null,
      type: 'new_conversation',
      data: { ...(res.to ? { to: res.to } : {}), channel: 'ui' },
    },
  ]);
}

export async function answerQuestion(id: string, body: AnswerRequest): Promise<void> {
  const q = await client().answer(id, body);
  useApp.setState((s) => ({ questions: { ...s.questions, [q.id]: q } }));
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
  seen.clear();
  endedRuns.clear();
  resetLists();
  useApp.setState({ ...INITIAL });
}
