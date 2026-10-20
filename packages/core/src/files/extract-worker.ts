import { parentPort } from 'node:worker_threads';
import { extractText } from './extract.ts';

/*
 * The worker of `extract-run.ts`: one file, one answer, then it ends. The
 * bytes arrive transferred (no copy); pdf.js and the Office parsers run here,
 * so a hostile document costs this thread, never the core's event loop.
 */

interface Job {
  bytes: Uint8Array;
  ext: string;
}

parentPort?.once('message', (job: Job) => {
  extractText(job.bytes, job.ext).then(
    (result) => parentPort?.postMessage({ ok: true, result }),
    (err: unknown) =>
      parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : 'failed' }),
  );
});
