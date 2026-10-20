import { describe, expect, it } from 'vitest';
import { ModelCache, type ModelInfo } from '../src/index.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('ModelCache', () => {
  it('a caller that stops waiting does not fail the shared request of the others', async () => {
    const cache = new ModelCache(60_000, Date.now);
    const answer = deferred<ModelInfo[]>();
    let loadSignal: AbortSignal | undefined;
    const load = (signal?: AbortSignal) => {
      loadSignal = signal;
      return new Promise<ModelInfo[]>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
        void answer.promise.then(resolve);
      });
    };
    const first = new AbortController();
    const a = cache.get({ signal: first.signal }, load).catch((e: unknown) => e);
    const b = cache.get({ signal: AbortSignal.timeout(5_000) }, load);
    first.abort();
    expect(await a).toHaveProperty('name', 'AbortError');
    expect(loadSignal?.aborted).toBe(false);
    answer.resolve([{ id: 'm', tools: true, free: true }]);
    expect((await b).map((m) => m.id)).toEqual(['m']);
  });

  it('the shared request stops when every caller has stopped waiting', async () => {
    const cache = new ModelCache(60_000, Date.now);
    let loadSignal: AbortSignal | undefined;
    const load = (signal?: AbortSignal) => {
      loadSignal = signal;
      return new Promise<ModelInfo[]>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
      });
    };
    const one = new AbortController();
    const two = new AbortController();
    const a = cache.get({ signal: one.signal }, load).catch((e: unknown) => e);
    const b = cache.get({ signal: two.signal }, load).catch((e: unknown) => e);
    one.abort();
    expect(loadSignal?.aborted).toBe(false);
    two.abort();
    await Promise.all([a, b]);
    expect(loadSignal?.aborted).toBe(true);
    // A later caller starts a fresh request.
    const fresh = await cache.get({}, () =>
      Promise.resolve([{ id: 'n', tools: false, free: true }]),
    );
    expect(fresh.map((m) => m.id)).toEqual(['n']);
  });
});
