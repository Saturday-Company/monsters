import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { ModelSpec } from './model-files.ts';

/*
 * Text embeddings for semantic search. The default model is IBM
 * granite-embedding-97m-multilingual-r2 (Apache-2.0, 384 dimensions, CLS
 * pooling, no prefixes), quantized (`onnx/model_quint8_avx2.onnx`, ~100 MB),
 * run locally by transformers.js on ONNX Runtime (research/04 §3). It is
 * downloaded at first use into `cacheDir` (`MONSTERS_HOME/models`), from a
 * pinned commit of the repo, and every file is checked against its sha256
 * (`model-files.ts`).
 *
 * Inference keeps a CPU core busy for hundreds of milliseconds per batch, so
 * the model runs in a worker thread: the core keeps answering meanwhile.
 */

/**
 * The model refused these texts, the embedder itself is fine (the worker
 * answered with an error): only the batch failed, not the worker.
 */
export class EmbedBatchError extends Error {
  override name = 'EmbedBatchError';
}

export interface Embedder {
  /** Identifies the vectors: changing model means embedding again. */
  readonly model: string;
  readonly dim: number;
  /** Unit-length vectors (dot product = cosine similarity), one per text. */
  embed(texts: readonly string[]): Promise<Float32Array[]>;
  close(): Promise<void>;
}

/**
 * Creates the embedder when it is first needed (download and load happen
 * here). `signal` aborts when the vault closes: stop the download then.
 */
export type EmbedderLoader = (signal: AbortSignal) => Promise<Embedder>;

export const DEFAULT_EMBEDDING_MODEL = 'ibm-granite/granite-embedding-97m-multilingual-r2';
/** ONNX file of the model, without `.onnx`. */
export const DEFAULT_EMBEDDING_FILE = 'model_quint8_avx2';

/**
 * The default model, pinned to a commit of its repo with the sha256 of each
 * file (from the Hugging Face API, checked on a download on 14/10/2026).
 * Changing model or revision means updating these hashes.
 */
export const DEFAULT_MODEL_SPEC: ModelSpec = {
  id: DEFAULT_EMBEDDING_MODEL,
  revision: '835ad14087e140460703cf0fae09f97d469d65c2',
  file: DEFAULT_EMBEDDING_FILE,
  files: [
    {
      path: 'config.json',
      sha256: 'de948b0bdc6f356afad7a84b276d8dd7e7fe10fb9add1bb5e610621c28e41ebc',
      size: 1216,
    },
    {
      path: 'tokenizer_config.json',
      sha256: '6ed69389e30a8ecabfce2f9ebcdf0c908b34056f24d994340f2f216521c057d5',
      size: 12_860,
    },
    {
      path: 'tokenizer.json',
      sha256: '4f2842d568e2724370aec203652a42ac783c7937f8347a1a2cc7506d71f1582f',
      size: 25_301_672,
    },
    {
      path: 'onnx/model_quint8_avx2.onnx',
      sha256: 'a6022dd8220ea6f6595562a1328ee216f4a94faa55362f2f4747c80f1e78772e',
      size: 98_247_878,
    },
  ],
};

/** The optional package that runs the model (not in the packaged desktop app, D-046). */
export const TRANSFORMERS_PACKAGE = '@huggingface/transformers';

/**
 * Semantic search cannot work in this installation: a package of the model
 * runtime is not installed. Not worth retrying, and not a failure to show:
 * search is full-text, the log says it once (`message`), the UI shows `reason`.
 */
export class SemanticUnavailableError extends Error {
  readonly code = 'missing_dependency';
  /** Short Italian text for the UI. */
  readonly reason =
    'La ricerca per significato non è disponibile in questa installazione: si cerca per parole.';
  readonly missing: string;

  constructor(missing: string = TRANSFORMERS_PACKAGE) {
    super(`semantic search off: ${missing} is not installed`);
    this.name = 'SemanticUnavailableError';
    this.missing = missing;
  }
}

/** Node's text for an import of a package that is not installed (ESM and CommonJS). */
const MISSING_PACKAGE = /Cannot find (?:package|module) '((?!\.)(?:@[\w.-]+\/)?[\w.-]+)(?:'|\/)/;

/**
 * The error is a package of the model runtime that is not installed (e.g.
 * `Cannot find package '@huggingface/transformers' imported from …`): returns
 * it as a `SemanticUnavailableError`, null for any other failure.
 */
export function asSemanticUnavailable(err: unknown): SemanticUnavailableError | null {
  if (err instanceof SemanticUnavailableError) return err;
  if (!(err instanceof Error)) return null;
  const missing = MISSING_PACKAGE.exec(err.message)?.[1];
  return missing ? new SemanticUnavailableError(missing) : null;
}

/**
 * Whether transformers.js is installed where Node would look for it from
 * `from` (the `node_modules` folders of its directory and of every parent),
 * without importing it: the packaged app does not ship it (D-046).
 */
export function transformersInstalled(from: string | URL = import.meta.url): boolean {
  let dir = dirname(fileURLToPath(from));
  for (;;) {
    if (existsSync(join(dir, 'node_modules', TRANSFORMERS_PACKAGE, 'package.json'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export interface ModelOptions {
  /** Folder of the downloaded models (e.g. `MONSTERS_HOME/models`). */
  cacheDir: string;
  /** Model, revision and file hashes (default `DEFAULT_MODEL_SPEC`). */
  spec?: ModelSpec;
  /** Only use the cached model (no download). */
  offline?: boolean;
  /** Aborts the download and the load (the worker is stopped, see `stopWorker`). */
  signal?: AbortSignal;
  /** Default `https://huggingface.co`. */
  remoteHost?: string;
  /** Whether transformers.js can be imported (default `transformersInstalled()`; tests). */
  installed?: () => boolean;
}

/** What `embed-worker.ts` receives as `workerData`. */
export interface WorkerInit {
  cacheDir: string;
  spec: ModelSpec;
  offline: boolean;
  remoteHost?: string;
}

/** Messages between `WorkerEmbedder` and `embed-worker.ts`. */
export type WorkerRequest = { id: number; texts: string[] } | { type: 'close' };
export type WorkerReply =
  | { type: 'ready'; dim: number }
  | { type: 'error'; message: string; code?: string }
  | { id: number; vectors: Float32Array[] }
  | { id: number; error: string };

/** How long a worker may take to finish its call into ONNX Runtime and exit. */
export const WORKER_CLOSE_GRACE_MS = 15_000;

/**
 * Stops the embedding worker without interrupting native code (D-099). The
 * worker is asked to exit and does so between two calls into ONNX Runtime
 * (after the batch or the model load in progress). `worker.terminate()` in the
 * middle of one of those synchronous calls made the next N-API call fail, and
 * onnxruntime-node turned that into an uncaught C++ `Napi::Error`: the whole
 * process aborted. Only a worker that does not exit within `graceMs` is
 * terminated. Until it is gone the worker keeps the process alive.
 */
export async function stopWorker(
  worker: Worker,
  graceMs: number = WORKER_CLOSE_GRACE_MS,
): Promise<void> {
  // threadId is -1 once the thread has exited.
  if (worker.threadId === -1) return;
  const exited = new Promise<'exited'>((resolve) => worker.once('exit', () => resolve('exited')));
  worker.ref();
  worker.postMessage({ type: 'close' } satisfies WorkerRequest);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), graceMs);
  });
  const outcome = await Promise.race([exited, late]);
  clearTimeout(timer);
  if (outcome === 'late') await worker.terminate();
}

interface Pending {
  resolve: (v: Float32Array[]) => void;
  reject: (e: Error) => void;
}

/** Embedder running transformers.js in a worker thread. */
export class WorkerEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #next = 1;
  #failed: Error | null = null;

  private constructor(worker: Worker, model: string, dim: number) {
    this.#worker = worker;
    this.model = model;
    this.dim = dim;
    worker.on('message', (msg: WorkerReply) => {
      if (!('id' in msg)) return;
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (this.#pending.size === 0) this.#worker.unref();
      if ('error' in msg) p.reject(new EmbedBatchError(msg.error));
      else p.resolve(msg.vectors);
    });
    const fail = (err: Error) => {
      this.#failed = err;
      for (const p of this.#pending.values()) p.reject(err);
      this.#pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`embedding worker exited (${code})`)));
    // The worker keeps the process alive only while it has work to do.
    worker.unref();
  }

  /** Starts the worker, which downloads (first time) and loads the model. */
  static async create(opts: ModelOptions): Promise<WorkerEmbedder> {
    const spec = opts.spec ?? DEFAULT_MODEL_SPEC;
    opts.signal?.throwIfAborted();
    // Not installed (the packaged app): no worker, no model download.
    if (!(opts.installed ?? transformersInstalled)()) throw new SemanticUnavailableError();
    // Sources run as .ts, the published build as .js.
    const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const worker = new Worker(new URL(`./embed-worker.${ext}`, import.meta.url), {
      workerData: {
        cacheDir: opts.cacheDir,
        spec,
        offline: opts.offline ?? false,
        ...(opts.remoteHost ? { remoteHost: opts.remoteHost } : {}),
      } satisfies WorkerInit,
    });
    // Only our own listeners are removed: Worker keeps internal ones.
    let onMessage: (msg: WorkerReply) => void = () => undefined;
    let onError: (err: Error) => void = () => undefined;
    let onExit: (code: number) => void = () => undefined;
    let onAbort: () => void = () => undefined;
    const dim = await new Promise<number>((resolve, reject) => {
      // Closing the vault during the download: the worker (and its fetch) stops.
      onAbort = () => {
        const reason: unknown = opts.signal?.reason;
        reject(reason instanceof Error ? reason : new Error('aborted'));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      onMessage = (msg) => {
        if ('type' in msg && msg.type === 'ready') resolve(msg.dim);
        else if ('type' in msg && msg.type === 'error') {
          const err = Object.assign(new Error(msg.message), msg.code ? { code: msg.code } : {});
          reject(asSemanticUnavailable(err) ?? err);
        }
      };
      onError = reject;
      onExit = (code) => reject(new Error(`embedding worker exited (${code})`));
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
    })
      .catch(async (err: unknown) => {
        // Also when aborted: the worker may be loading the model right now.
        await stopWorker(worker);
        throw err;
      })
      .finally(() => {
        opts.signal?.removeEventListener('abort', onAbort);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      });
    return new WorkerEmbedder(worker, `${spec.id}/${spec.file}`, dim);
  }

  embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (this.#failed) return Promise.reject(this.#failed);
    if (texts.length === 0) return Promise.resolve([]);
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.ref();
      this.#worker.postMessage({ id, texts: [...texts] } satisfies WorkerRequest);
    });
  }

  async close(): Promise<void> {
    this.#failed ??= new Error('embedder closed');
    await stopWorker(this.#worker);
  }
}
