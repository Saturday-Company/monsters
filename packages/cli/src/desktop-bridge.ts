import {
  KeychainUnavailableError,
  keychainName,
  type CoreServer,
  type Keychain,
} from '@monsters/core';
import type {
  CoreToDesktopMessage,
  DesktopToCoreMessage,
  KeychainOp,
  KeychainReply,
  KeychainRequest,
} from '@monsters/shared';

/*
 * The core started by the desktop app runs `monsters start` in an Electron `utilityProcess`
 * (M3.1, D-045): `process.parentPort` is the channel to the app's main process. Through it
 * the core says where it listens (with the setup code while no account exists), issues
 * single-use login tokens (no file involved) and stops on request. Outside Electron there is
 * no parent port and nothing here runs.
 */

/** The message port of an Electron utility process, as far as the core uses it. */
export interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  off(event: 'message', listener: (event: { data: unknown }) => void): unknown;
}

/** The parent port when running in an Electron utility process, else null. */
export function parentPort(): ParentPort | null {
  return (process as { parentPort?: ParentPort }).parentPort ?? null;
}

function isRequest(data: unknown): data is DesktopToCoreMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as { type?: unknown; id?: unknown };
  if (m.type === 'stop') return true;
  return m.type === 'login-token' && typeof m.id === 'number' && Number.isInteger(m.id);
}

/**
 * Wires a started core to the app: sends `ready`, answers `login-token`, calls `stop` on
 * `stop`. Returns the function that detaches the listener (so the process can exit).
 */
export function attachDesktopBridge(
  port: ParentPort,
  core: Pick<CoreServer, 'url' | 'port' | 'config' | 'setupCode' | 'auth'> & { version: string },
  stop: () => void,
): () => void {
  const send = (message: CoreToDesktopMessage) => port.postMessage(message);
  const listener = (event: { data: unknown }) => {
    const message = event.data;
    if (!isRequest(message)) return;
    if (message.type === 'stop') {
      stop();
      return;
    }
    try {
      const { token, expiresAt } = core.auth.issueLoginToken('desktop');
      send({ type: 'login-token', id: message.id, token, expiresAt });
    } catch {
      send({ type: 'login-token', id: message.id, token: null, expiresAt: null });
    }
  };
  port.on('message', listener);
  send({
    type: 'ready',
    url: core.url,
    port: core.port,
    home: core.config.home,
    pid: process.pid,
    version: core.version,
    setupCode: core.setupCode,
  });
  return () => port.off('message', listener);
}

function isKeychainReply(data: unknown): data is KeychainReply {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  if (m['type'] !== 'keychain' || typeof m['id'] !== 'number') return false;
  if (m['ok'] === true) {
    const v = m['value'];
    return v === null || typeof v === 'string' || typeof v === 'boolean';
  }
  return m['ok'] === false && typeof m['message'] === 'string';
}

/**
 * The system keychain of the core started by the app (D-042): each call goes to the app over
 * the message port, and the app runs it in a short-lived utility process of its own (the app's
 * binary is never a Node the core could start: RunAsNode off, S-M8). An aborted call (deadline,
 * stop) is dropped here and its helper killed by the app. The port is listened to only while a
 * call is pending, so it never keeps the process up.
 */
export function desktopKeychain(port: ParentPort, name: string = keychainName()): Keychain {
  const pending = new Map<
    number,
    { resolve: (v: string | boolean | null) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;
  const listener = (event: { data: unknown }) => {
    const reply = event.data;
    if (!isKeychainReply(reply)) return;
    const call = pending.get(reply.id);
    if (!call) return;
    forget(reply.id);
    if (reply.ok) call.resolve(reply.value);
    else call.reject(new KeychainUnavailableError(reply.message));
  };
  const forget = (id: number) => {
    pending.delete(id);
    if (pending.size === 0) port.off('message', listener);
  };
  const call = (
    op: KeychainOp,
    service: string,
    account: string,
    signal: AbortSignal,
    value?: string,
  ): Promise<string | boolean | null> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('aborted'));
      const id = nextId++;
      const onAbort = () => {
        if (!pending.has(id)) return;
        forget(id);
        port.postMessage({ type: 'keychain-abort', id } satisfies CoreToDesktopMessage);
        reject(new Error('aborted'));
      };
      if (pending.size === 0) port.on('message', listener);
      pending.set(id, {
        resolve: (v) => {
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      });
      signal.addEventListener('abort', onAbort, { once: true });
      const request: KeychainRequest = { type: 'keychain', id, op, service, account };
      if (value !== undefined) request.value = value;
      port.postMessage(request satisfies CoreToDesktopMessage);
    });
  return {
    name,
    async get(service, account, signal) {
      const value = await call('get', service, account, signal);
      return typeof value === 'string' ? value : null;
    },
    async set(service, account, value, signal) {
      await call('set', service, account, signal, value);
    },
    async delete(service, account, signal) {
      return (await call('delete', service, account, signal)) === true;
    },
  };
}

/** Tells the app why the core did not start (before `ready`). */
export function reportStartFailure(port: ParentPort, err: unknown): void {
  const code =
    typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : 'start_failed';
  const message: CoreToDesktopMessage = {
    type: 'start-failed',
    code,
    message: err instanceof Error ? err.message : String(err),
  };
  port.postMessage(message);
}
