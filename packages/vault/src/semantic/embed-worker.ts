import { parentPort, workerData } from 'node:worker_threads';
import type { WorkerInit, WorkerReply, WorkerRequest } from './embedder.ts';
import { ensureModelFiles } from './model-files.ts';

/*
 * Worker thread of `WorkerEmbedder`: checks the model files against their
 * sha256 (downloading the pinned revision into `cacheDir` the first time),
 * loads them with transformers.js and embeds batches of texts.
 */

type Extractor = ((
  texts: string[],
  options: { pooling: 'cls'; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array }>) & { dispose(): Promise<void> };

const port = parentPort;
const init = workerData as WorkerInit;

let extractor: Extractor | null = null;
let dim = 0;
/** One batch at a time: the queue lives in the message port. */
let chain: Promise<void> = Promise.resolve();
let closing = false;

/*
 * Exit only from here, between two calls into ONNX Runtime (D-099): loading
 * the model and running a batch are synchronous native calls, and this code
 * runs after them (a message is handled only when the thread is back in the
 * event loop). Being terminated from outside during one of them aborted the
 * whole process with an uncaught `Napi::Error`.
 */
async function shutdown(): Promise<void> {
  await extractor?.dispose().catch(() => undefined);
  extractor = null;
  process.exit(0);
}

port?.on('message', (req: WorkerRequest) => {
  if ('type' in req) {
    if (closing) return;
    closing = true;
    // After the batch in progress, if any.
    chain = chain.then(shutdown);
    return;
  }
  if (closing) return;
  chain = chain.then(async () => {
    try {
      if (!extractor) throw new Error('embedding model not loaded');
      const out = await extractor(req.texts, { pooling: 'cls', normalize: true });
      const vectors = split(out.data, req.texts.length, dim);
      send(
        { id: req.id, vectors },
        vectors.map((v) => v.buffer as ArrayBuffer),
      );
    } catch (err) {
      send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
});

function send(msg: WorkerReply, transfer: ArrayBuffer[] = []): void {
  port?.postMessage(msg, transfer);
}

function split(data: Float32Array, rows: number, dim: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) out.push(data.slice(i * dim, (i + 1) * dim));
  return out;
}

async function main(): Promise<void> {
  // Optional dependency: without it semantic search is simply off. Imported
  // before the model files, so that an incomplete install downloads nothing.
  const { pipeline, env } = await import('@huggingface/transformers');
  // Only verified files are ever loaded: transformers.js never downloads itself.
  await ensureModelFiles({
    cacheDir: init.cacheDir,
    spec: init.spec,
    offline: init.offline,
    ...(init.remoteHost ? { remoteHost: init.remoteHost } : {}),
  });
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = init.cacheDir;
  env.useFSCache = false;
  extractor = (await pipeline('feature-extraction', init.spec.id, {
    dtype: 'fp32',
    model_file_name: init.spec.file,
  })) as unknown as Extractor;
  const probe = await extractor(['ok'], { pooling: 'cls', normalize: true });
  dim = probe.dims.at(-1) ?? 0;
  send({ type: 'ready', dim });
}

main().catch((err: unknown) => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  send({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
    ...(typeof code === 'string' ? { code } : {}),
  });
});
