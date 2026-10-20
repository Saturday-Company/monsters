import { Worker } from 'node:worker_threads';

/*
 * The text of a file, extracted in a worker thread (security review of 16/10,
 * D-085): pdf.js and the Office parsers on the core's thread meant that one
 * hostile upload could hold every request, the WebSocket and the runs for as
 * long as it liked. Here a worker per file, with a time limit and a memory
 * ceiling: past them it is stopped and the file simply has no text.
 */

/** Longest time the extraction of one file may take. */
export const EXTRACT_TIMEOUT_MS = 15_000;

/** Memory ceiling of one worker (32 MB of XML is 64 MB as a string, pdf.js needs room). */
const RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 768,
  maxYoungGenerationSizeMb: 64,
  stackSizeMb: 4,
};

export interface ExtractedText {
  text: string;
  truncated: boolean;
}

export interface ExtractOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The worker's module: `.ts` from the sources, `.js` next to the bundle's entry (build-core.ts). */
function workerUrl(): URL {
  const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  return new URL(`./extract-worker.${ext}`, import.meta.url);
}

/** Workers at the same time: each may take hundreds of MB. */
const MAX_WORKERS = 2;
let running = 0;
const waiting: (() => void)[] = [];
/** Worker threads not exited yet, and the most seen at once (a test hook). */
let alive = 0;
let peakAlive = 0;

/** Live worker threads and their peak since the last reset: never more than `MAX_WORKERS`. */
export function extractWorkerStats(reset = false): { alive: number; peak: number } {
  const out = { alive, peak: peakAlive };
  if (reset) peakAlive = alive;
  return out;
}

/**
 * The text of a file of type `ext` (as `detectType` named it), or null when it
 * has none, when the worker could not finish in time or ran out of memory.
 * At most `MAX_WORKERS` run at once; the others wait their turn. The time limit
 * and the signal count from the call, not from the moment a slot frees up (a
 * file queued behind others must not hold the turn longer, B11 of 18/10), and a
 * slot frees only once the previous worker's thread has exited.
 */
export function extractTextIsolated(
  bytes: Uint8Array,
  ext: string,
  options: ExtractOptions = {},
): Promise<ExtractedText | null> {
  // The copy that goes to the worker is made now: the caller may reuse its bytes.
  const data = new Uint8Array(bytes);
  const deadline = performance.now() + (options.timeoutMs ?? EXTRACT_TIMEOUT_MS);
  const { signal } = options;
  if (signal?.aborted) return Promise.resolve(null);
  if (running < MAX_WORKERS) return start(data, ext, deadline, signal);
  return new Promise((resolve) => {
    const stopWaiting = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', giveUp);
    };
    const turn = () => {
      stopWaiting();
      void start(data, ext, deadline, signal).then(resolve);
    };
    const giveUp = () => {
      stopWaiting();
      const at = waiting.indexOf(turn);
      if (at >= 0) waiting.splice(at, 1);
      resolve(null);
    };
    const timer = setTimeout(giveUp, Math.max(0, deadline - performance.now()));
    signal?.addEventListener('abort', giveUp, { once: true });
    waiting.push(turn);
  });
}

function start(
  data: Uint8Array<ArrayBuffer>,
  ext: string,
  deadline: number,
  signal: AbortSignal | undefined,
): Promise<ExtractedText | null> {
  running++;
  const { result, released } = runWorker(data, ext, deadline, signal);
  // The slot goes to the next file only after the thread has exited (768 MB each).
  void released.then(() => {
    running--;
    waiting.shift()?.();
  });
  return result;
}

function runWorker(
  data: Uint8Array<ArrayBuffer>,
  ext: string,
  deadline: number,
  signal: AbortSignal | undefined,
): { result: Promise<ExtractedText | null>; released: Promise<void> } {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const result = new Promise<ExtractedText | null>((resolve) => {
    if (signal?.aborted || deadline <= performance.now()) {
      resolve(null);
      release();
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(workerUrl(), { resourceLimits: RESOURCE_LIMITS });
    } catch {
      resolve(null);
      release();
      return;
    }
    alive++;
    peakAlive = Math.max(peakAlive, alive);
    let exited = false;
    let done = false;
    const finish = (value: ExtractedText | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
      if (!exited) void worker.terminate().catch(() => {});
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), Math.max(0, deadline - performance.now()));
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (msg: { ok: boolean; result?: ExtractedText | null }) =>
      finish(msg.ok ? (msg.result ?? null) : null),
    );
    worker.once('error', () => finish(null));
    worker.once('exit', () => {
      exited = true;
      alive--;
      finish(null);
      release();
    });
    // The worker never keeps the core alive on its own (a shutdown does not wait for it).
    worker.unref();
    // Moved, not copied again.
    worker.postMessage({ bytes: data, ext }, [data.buffer]);
  });
  return { result, released };
}
