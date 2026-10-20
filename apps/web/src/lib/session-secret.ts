/*
 * The secret of a browser's session (S-B13, review of 18/10). Cookies do not tell ports apart:
 * every other service on 127.0.0.1 the browser visits receives the session cookie. The core
 * asks a browser's requests for this secret too (`X-Monsters-Session`, the first message of the
 * WebSocket), and another local service never has it: it lives in this tab only, in memory and
 * in `sessionStorage` (which is of this origin, port included, so a reload keeps it).
 *
 * A new tab asks the tabs already open on this origin (`BroadcastChannel`, same origin only);
 * with none open, the password again. The desktop app has no secret: its window keeps the
 * cookie in a session of its own (D-044), and the core opens its sessions without one.
 */

const STORAGE_KEY = 'monsters.sessionSecret';
const CHANNEL = 'monsters-session';
/** How long a new tab waits for an open one to answer. */
const ASK_TIMEOUT_MS = 300;

type Message =
  | { kind: 'ask'; id: string }
  | { kind: 'give'; id: string; secret: string }
  | { kind: 'set'; secret: string }
  | { kind: 'clear' };

let secret: string | null = readStored();
let channel: BroadcastChannel | null = null;
const waiting = new Map<string, (secret: string) => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function store(value: string | null): void {
  secret = value;
  try {
    if (value) storage()?.setItem(STORAGE_KEY, value);
    else storage()?.removeItem(STORAGE_KEY);
  } catch {
    // storage refused (private mode): memory only, a reload asks the other tabs or the password
  }
}

function isMessage(data: unknown): data is Message {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  switch (m['kind']) {
    case 'ask':
      return typeof m['id'] === 'string';
    case 'give':
      return typeof m['id'] === 'string' && typeof m['secret'] === 'string';
    case 'set':
      return typeof m['secret'] === 'string';
    case 'clear':
      return true;
    default:
      return false;
  }
}

/** The channel of the tabs of this origin, opened once (null where there is none). */
function tabs(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL);
  // Node's channel (the unit tests) would keep the process alive; browsers have no `unref`.
  (channel as { unref?: () => void }).unref?.();
  channel.onmessage = (ev: MessageEvent) => {
    const m: unknown = ev.data;
    if (!isMessage(m)) return;
    if (m.kind === 'ask' && secret) channel?.postMessage({ kind: 'give', id: m.id, secret });
    else if (m.kind === 'give') waiting.get(m.id)?.(m.secret);
    // Another tab logged in: the cookie of this browser is its session now.
    else if (m.kind === 'set') store(m.secret);
    else if (m.kind === 'clear') store(null);
  };
  return channel;
}

/** Answers the tabs opened later on this origin (called at the start, with the real core). */
export function joinTabs(): void {
  tabs();
}

/** The secret of this tab's session, or null (no session, the desktop app, the mock). */
export function sessionSecret(): string | null {
  return secret;
}

/** After a login or a first setup: this tab's secret, and the other tabs' too. */
export function adoptSessionSecret(value: string | null | undefined): void {
  store(value ?? null);
  tabs()?.postMessage(value ? { kind: 'set', secret: value } : { kind: 'clear' });
}

/** After a logout: no secret here nor in the other tabs (their cookie is gone too). */
export function forgetSessionSecret(): void {
  store(null);
  tabs()?.postMessage({ kind: 'clear' });
}

/**
 * A new tab, or a reload whose storage was cleared: asks the tabs open on this origin for the
 * secret of the browser's session. Resolves with it (already adopted) or with null.
 */
export function recoverSessionSecret(timeoutMs = ASK_TIMEOUT_MS): Promise<string | null> {
  const ch = tabs();
  if (!ch) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, timeoutMs);
    waiting.set(id, (found) => {
      clearTimeout(timer);
      waiting.delete(id);
      store(found);
      resolve(found);
    });
    ch.postMessage({ kind: 'ask', id });
  });
}
