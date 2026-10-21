import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  appLang,
  type KeychainOp,
  type KeychainReply,
  type KeychainRequest,
} from '@monsters/shared';
import { keychainHostStrings } from './keychain-host.strings.ts';
import { isMonstersEntry, keyringTriple } from '../keychain-helper/entries.ts';
import type { HelperReply, HelperRequest } from '../keychain-helper/index.ts';

/*
 * The system keychain for the core the app started (D-042, S-M8). The core runs in a utility
 * process and cannot start another one; and the app's binary is never a Node it could start
 * (RunAsNode off). So the core asks here, over its message port, and each call runs in a
 * short-lived utility process of the app (keychain-helper), which macOS sees as the app's own
 * signed helper: the keychain's "Allow always" goes to code that only the app can run. The
 * helper runs only JavaScript of the ASAR and the keyring's native binary (`keyringNativePath`),
 * and only for the entries of Monsters (service and account, entries.ts): a request for any
 * other entry is refused here, before a helper starts.
 *
 * One helper per call, killed when it answers, when the core gives up (`keychain-abort`, sent
 * at the core's deadline or stop), after `timeoutMs` in any case, and when the core exits.
 * The spawn function hides Electron, so this runs in tests with a fake helper.
 */

/** A running helper, as the host sees it (an Electron `UtilityProcess` in the app). */
export interface HelperProcess {
  readonly pid: number | undefined;
  postMessage(message: HelperRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface KeychainHostOptions {
  fork: () => HelperProcess;
  /** The `.node` of `@napi-rs/keyring` next to the core (`keyringNativePath`), or null. */
  nativePath: () => string | null;
  /**
   * The sha256 the helper checks the binary against right before loading it (packaged app,
   * from the manifest in app.asar); undefined: no check (development, macOS's library
   * validation); null: the binary is not in the manifest, the call is refused.
   */
  nativeHash?: (path: string) => string | null | undefined;
  /** Longest life of a helper whatever the core does (the core's own deadline is 20 s). */
  timeoutMs?: number;
  /** Calls in flight per core, at most. */
  maxPending?: number;
  forceKill?: (pid: number) => void;
  log?: (line: string) => void;
}

/** The requests of one core process. */
export interface KeychainSession {
  /** Handles a message of the core when it is a keychain one (true), else leaves it (false). */
  handle(message: unknown): boolean;
  /** The core is gone: every helper of its calls is killed. */
  close(): void;
}

const OPS: readonly KeychainOp[] = ['get', 'set', 'delete'];
const MAX_NAME = 512;
const MAX_VALUE = 64 * 1024;

function defaultForceKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isName = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME;

/** A well-formed request of the core, else why not (null: not even an id to answer). */
export function parseKeychainRequest(
  raw: unknown,
): { request: KeychainRequest } | { id: number; error: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['type'] !== 'keychain' || !isId(m['id'])) return null;
  const id = m['id'];
  const op = m['op'];
  if (typeof op !== 'string' || !OPS.includes(op as KeychainOp)) {
    return { id, error: keychainHostStrings().invalidOp };
  }
  if (!isName(m['service']) || !isName(m['account'])) {
    return { id, error: keychainHostStrings().invalidEntry };
  }
  if (!isMonstersEntry(m['service'], m['account'])) {
    return { id, error: keychainHostStrings().notMonstersEntry };
  }
  const value = m['value'];
  if (op === 'set' ? typeof value !== 'string' || value.length > MAX_VALUE : value !== undefined) {
    return { id, error: keychainHostStrings().invalidValue };
  }
  const request: KeychainRequest = {
    type: 'keychain',
    id,
    op: op as KeychainOp,
    service: m['service'],
    account: m['account'],
  };
  if (typeof value === 'string') request.value = value;
  return { request };
}

/**
 * The native binary of `@napi-rs/keyring` the core next to `coreEntry` ships (package.ts puts
 * the platform package in resources/core/node_modules; in the repo pnpm links it next to the
 * main package). Its file name is fixed (`keyring.<platform>.node`), whatever the package.json
 * says. Null when it is not there.
 */
export function keyringNativePath(
  coreEntry: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const triple = keyringTriple(platform, arch);
  if (!triple) return null;
  try {
    const main = createRequire(coreEntry).resolve('@napi-rs/keyring/package.json');
    const pkg = createRequire(main).resolve(`@napi-rs/keyring-${triple}/package.json`);
    const file = join(dirname(pkg), `keyring.${triple}.node`);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

function asHelperReply(raw: unknown): HelperReply | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['ok'] === true) {
    const v = m['value'];
    return v === null || typeof v === 'string' || typeof v === 'boolean'
      ? { ok: true, value: v }
      : null;
  }
  if (m['ok'] === false && typeof m['message'] === 'string') {
    return { ok: false, kind: m['kind'] === 'module' ? 'module' : 'store', message: m['message'] };
  }
  return null;
}

export class KeychainHost {
  readonly #o: Required<Omit<KeychainHostOptions, 'log' | 'nativeHash'>> & {
    log: (line: string) => void;
    nativeHash?: KeychainHostOptions['nativeHash'];
  };

  constructor(options: KeychainHostOptions) {
    this.#o = {
      timeoutMs: 60_000,
      maxPending: 4,
      forceKill: defaultForceKill,
      log: () => {},
      ...options,
    };
  }

  /** A session for one core process; `reply` posts to that process. */
  open(reply: (message: KeychainReply) => void): KeychainSession {
    const o = this.#o;
    const running = new Map<number, { helper: HelperProcess | null; timer: NodeJS.Timeout }>();
    let closed = false;

    const end = (id: number) => {
      const call = running.get(id);
      if (!call) return;
      running.delete(id);
      clearTimeout(call.timer);
      const helper = call.helper;
      if (!helper) return;
      if (helper.pid !== undefined) o.forceKill(helper.pid);
      else helper.kill();
    };
    const answer = (id: number, r: HelperReply) => {
      if (!running.has(id) || closed) return;
      end(id);
      reply(
        r.ok
          ? { type: 'keychain', id, ok: true, value: r.value }
          : { type: 'keychain', id, ok: false, message: r.message },
      );
    };
    const fail = (id: number, message: string) => {
      if (running.has(id)) {
        answer(id, { ok: false, kind: 'store', message });
      } else if (!closed) {
        reply({ type: 'keychain', id, ok: false, message });
      }
    };

    const start = (request: KeychainRequest) => {
      const { id } = request;
      if (running.has(id))
        return reply({
          type: 'keychain',
          id,
          ok: false,
          message: keychainHostStrings().alreadyRunning,
        });
      if (running.size >= o.maxPending) {
        return reply({
          type: 'keychain',
          id,
          ok: false,
          message: keychainHostStrings().tooMany,
        });
      }
      const nativePath = o.nativePath();
      if (!nativePath) {
        return reply({
          type: 'keychain',
          id,
          ok: false,
          message: keychainHostStrings().moduleUnavailable,
        });
      }
      const sha256 = o.nativeHash?.(nativePath);
      if (sha256 === null) {
        return reply({
          type: 'keychain',
          id,
          ok: false,
          message: keychainHostStrings().notInManifest,
        });
      }
      const timer = setTimeout(() => {
        o.log(`keychain: no answer after ${o.timeoutMs} ms, helper killed`);
        fail(id, keychainHostStrings().noAnswer(Math.round(o.timeoutMs / 1000)));
      }, o.timeoutMs);
      running.set(id, { helper: null, timer });
      let helper: HelperProcess;
      try {
        helper = o.fork();
      } catch (err) {
        return fail(id, keychainHostStrings().unreachable((err as Error).message));
      }
      running.get(id)!.helper = helper;
      helper.onMessage((raw) => {
        const r = asHelperReply(raw);
        if (r) answer(id, r);
        else fail(id, keychainHostStrings().invalidReply);
      });
      helper.onExit((code) => {
        // Killed after its answer: nothing left to do. Otherwise it died without one.
        if (running.get(id)?.helper === helper) {
          fail(id, keychainHostStrings().exited(code));
        }
      });
      const message: HelperRequest = {
        nativePath,
        ...(sha256 !== undefined ? { sha256 } : {}),
        lang: appLang(),
        op: request.op,
        service: request.service,
        account: request.account,
      };
      if (request.value !== undefined) message.value = request.value;
      helper.postMessage(message);
    };

    return {
      handle(raw) {
        if (typeof raw !== 'object' || raw === null) return false;
        const type = (raw as { type?: unknown }).type;
        if (type === 'keychain-abort') {
          const id = (raw as { id?: unknown }).id;
          if (isId(id)) end(id);
          return true;
        }
        if (type !== 'keychain') return false;
        if (closed) return true;
        const parsed = parseKeychainRequest(raw);
        if (!parsed) return true;
        if ('error' in parsed)
          reply({ type: 'keychain', id: parsed.id, ok: false, message: parsed.error });
        else start(parsed.request);
        return true;
      },
      close() {
        closed = true;
        for (const id of [...running.keys()]) end(id);
      },
    };
  }
}
