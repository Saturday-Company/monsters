import type { EventLog } from './log/event-log.ts';
import { coreStrings } from './core.strings.ts';

/** More than this many failures in `WINDOW_MS` mean the process is not healthy: it stops. */
const MAX_IN_WINDOW = 25;
const WINDOW_MS = 60_000;
/**
 * After `closed()`, how long the handlers stay: the late rejections of the shutdown (outbox
 * chains, streams, timers) still find them, and a process that lives on (the tests) does not
 * keep them for ever. The timer never keeps the process alive.
 */
const CLOSED_GRACE_MS = 10_000;

export interface ProcessGuardOptions {
  log: Pick<EventLog, 'append'>;
  /** Called when failures keep coming: the caller closes the core and ends the process. */
  onStorm: (reason: string) => void;
  /** Where the failure is told when the log cannot take it. */
  stderr?: (line: string) => void;
  now?: () => number;
}

export interface ProcessGuard {
  /**
   * The core is closed: failures go to stderr only (the database is gone), nothing asks to
   * stop, and the handlers go away after `CLOSED_GRACE_MS` (review of 18/10, item 13).
   */
  closed(): void;
  /** Removes the handlers now. */
  remove(): void;
}

/**
 * A rejection nobody handled (a SQLite error while closing, a full disk) would end the
 * whole process with Node 24 and every run in it. The core writes an `error` event and
 * goes on; if failures keep coming it asks to stop (F-M2). Kept until the process ends:
 * `closed()` once the core is closed, not `remove()`, or a late rejection of the
 * shutdown would end it with code 1.
 */
export function installProcessGuard(options: ProcessGuardOptions): ProcessGuard {
  const now = options.now ?? Date.now;
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const recent: number[] = [];
  let stopped = false;
  let closed = false;
  const handle = (code: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (closed) {
      stderr(`${code}: ${message}`);
      return;
    }
    try {
      options.log.append({ agent: 'system', type: 'error', data: { code, message } });
    } catch {
      stderr(`${code}: ${message}`);
    }
    const t = now();
    recent.push(t);
    while (recent.length > 0 && recent[0]! < t - WINDOW_MS) recent.shift();
    if (recent.length > MAX_IN_WINDOW && !stopped) {
      stopped = true;
      options.onStorm(coreStrings().unhandledStorm(code, message));
    }
  };
  const onRejection = (reason: unknown) => handle('unhandled_rejection', reason);
  const onException = (err: unknown) => handle('uncaught_exception', err);
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  const remove = () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  };
  return {
    closed: () => {
      if (closed) return;
      closed = true;
      setTimeout(remove, CLOSED_GRACE_MS).unref();
    },
    remove,
  };
}
