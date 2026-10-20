import { WorkerEmbedder } from '../src/index.ts';

/*
 * Child process of the shutdown test in `semantic-real.test.ts` (D-099):
 * stops the real embedding worker in the middle of a call into ONNX Runtime
 * and exits. Before D-099 `worker.terminate()` there aborted the whole
 * process with `terminate called after throwing an instance of 'Napi::Error'`.
 *
 *   node embedder-shutdown.fixture.ts <cacheDir> load <ms>   abort the model load after <ms>
 *   node embedder-shutdown.fixture.ts <cacheDir> batch <ms>  close during a batch, after <ms>
 */

const [cacheDir, mode, ms] = process.argv.slice(2);
if (!cacheDir || (mode !== 'load' && mode !== 'batch'))
  throw new Error('usage: <cacheDir> load|batch <ms>');
const delay = Number(ms ?? '0');
const wait = (n: number) => new Promise((resolve) => setTimeout(resolve, n));

if (mode === 'load') {
  const abort = new AbortController();
  const created = WorkerEmbedder.create({ cacheDir, offline: true, signal: abort.signal });
  await wait(delay);
  abort.abort(new Error('stopped by the test'));
  const embedder = await created.catch(() => null);
  await embedder?.close();
} else {
  const embedder = await WorkerEmbedder.create({ cacheDir, offline: true });
  const texts = Array.from(
    { length: 64 },
    (_, i) => `Nota ${i}: il menu autunnale con zucca, funghi e castagne, piatto numero ${i}.`,
  );
  const pending = embedder.embed(texts).catch(() => null);
  await wait(delay);
  await embedder.close();
  await pending;
}
process.stdout.write('ok\n');
// Like the desktop app after the core closed (cli/src/main.ts).
process.exit(0);
