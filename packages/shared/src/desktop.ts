/*
 * The desktop app (apps/desktop, M3.1, D-045) and the core it starts in an Electron
 * `utilityProcess` talk over the process's message port (`process.parentPort` in the core).
 * Types only, shared by both ends; the core side is in packages/cli/src/desktop-bridge.ts.
 */

/** What the core tells the desktop app. */
export type CoreToDesktopMessage =
  /** The core is listening: everything the app needs to open its window. */
  | {
      type: 'ready';
      url: string;
      port: number;
      home: string;
      pid: number;
      version: string;
      /** One-time code for `POST /api/setup` while no account exists, else null. */
      setupCode: string | null;
    }
  /** Answer to `login-token`: a single-use login token, null when it could not be issued. */
  | { type: 'login-token'; id: number; token: string | null; expiresAt: number | null }
  /** The core could not start (`home_locked`: another core owns the data directory). */
  | { type: 'start-failed'; code: string; message: string }
  /**
   * One call to the system keychain (D-042), run by the app in a utility process of its own:
   * the app's binary is never a Node for the core to start (RunAsNode off, S-M8). `value`
   * only with `set`. Answered by a `keychain` message with the same id.
   */
  | KeychainRequest
  /** The core gave up on that call (deadline, stop): the app kills its helper, no answer. */
  | { type: 'keychain-abort'; id: number };

export type KeychainOp = 'get' | 'set' | 'delete';

export interface KeychainRequest {
  type: 'keychain';
  id: number;
  op: KeychainOp;
  service: string;
  account: string;
  value?: string;
}

/** The answer to a `keychain` request: the helper's value, or why it could not be had. */
export type KeychainReply =
  | { type: 'keychain'; id: number; ok: true; value: string | boolean | null }
  | { type: 'keychain'; id: number; ok: false; message: string };

/** What the desktop app asks the core. */
export type DesktopToCoreMessage =
  /** Issue a single-use login token (exchanged at `POST /api/login/exchange`). */
  | { type: 'login-token'; id: number }
  /** Stop gracefully (same as SIGTERM: runs aborted, files closed, lock released). */
  | { type: 'stop' }
  | KeychainReply;

/** `POST` with a bearer token (CLI token): issues a single-use login token. */
export const LOGIN_TOKEN_PATH = '/api/login/token';
/** `POST {token}`: exchanges a login token for the normal session cookie. */
export const LOGIN_EXCHANGE_PATH = '/api/login/exchange';
