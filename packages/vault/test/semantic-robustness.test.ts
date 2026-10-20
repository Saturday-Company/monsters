import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { openDb } from '@monsters/db';
import { describe, expect, it, vi } from 'vitest';
import {
  VaultService,
  WorkerEmbedder,
  EmbedBatchError,
  defaultIndexPath,
  ensureModelFiles,
  vaultSearchTool,
  type Embedder,
  type ModelSpec,
} from '../src/index.ts';
import { FakeEmbedder } from './fake-embedder.ts';
import { actor, newVault, tempDir, track, waitFor } from './helpers.ts';

/*
 * Semantic search under stress (M2.3 review): embeddings still running,
 * shutdown during the model download, a worker that dies, vectors of text
 * that is gone, an index migration interrupted, a model file tampered with.
 */

const paths = (hits: { path: string }[]) => hits.map((h) => h.path);

/** Holds back the embedding of texts containing `word` until released. */
class GatedEmbedder extends FakeEmbedder {
  blocked: string | null = null;
  #waiters: (() => void)[] = [];
  override async embed(texts: readonly string[]): Promise<Float32Array[]> {
    while (this.blocked && texts.some((t) => t.includes(this.blocked ?? ''))) {
      await new Promise<void>((r) => this.#waiters.push(r));
    }
    return super.embed(texts);
  }
  release(): void {
    this.blocked = null;
    for (const w of this.#waiters.splice(0)) w();
  }
}

describe('search while the embeddings are running', () => {
  it('keeps the notes found only by full-text that have no vectors yet', async () => {
    const embedder = new GatedEmbedder();
    const vault = await newVault({ embedder: () => Promise.resolve(embedder) });
    const a = actor('titan');
    await vault.write(a, { path: 'Aree/Allenamento.md', content: '# Allenamento\n\nCorsa.\n' });
    await vault.semanticIdle();
    embedder.blocked = 'Marte';
    await vault.write(a, {
      path: 'Progetti/Marte.md',
      content: '# Marte\n\nIl razzo per Marte parte a maggio dalla base.\n',
    });
    // A question: full-text matches only some of its words (partial).
    const q = 'quando parte il razzo verso giove';
    const text = await vault.search(a, { query: q, mode: 'text' });
    expect(text[0]).toMatchObject({ path: 'Progetti/Marte.md', partial: true });
    expect(paths(await vault.search(a, { query: q }))).toContain('Progetti/Marte.md');
    expect(paths(await vault.search(a, { query: q, folder: 'Progetti' }))).toEqual([
      'Progetti/Marte.md',
    ]);
    expect(paths(await vault.search(a, { query: q, mode: 'semantic' }))).toContain(
      'Progetti/Marte.md',
    );
    embedder.release();
    await vault.semanticIdle();
  });
});

describe('semantic index lifecycle', () => {
  it('closes while the model is still downloading, aborting the download', async () => {
    let signal: AbortSignal | undefined;
    const vault = await VaultService.create({
      root: join(tempDir(), 'Vault'),
      git: false,
      embedder: (s) => {
        signal = s;
        // A loader that ignores the signal holds the shutdown for stopGraceMs at most.
        return new Promise<Embedder>(() => undefined);
      },
      semanticOptions: { stopGraceMs: 100 },
    });
    await waitFor(() => vault.semanticStatus().state === 'loading');
    const started = Date.now();
    await vault.close();
    expect(Date.now() - started).toBeLessThan(500);
    expect(signal?.aborted).toBe(true);
  });

  it('falls back to full-text when the worker dies, logs once and retries with backoff', async () => {
    let dead = false;
    let loads = 0;
    class Crashy extends FakeEmbedder {
      override embed(texts: readonly string[]): Promise<Float32Array[]> {
        if (dead) return Promise.reject(new Error('embedding worker exited (1)'));
        return super.embed(texts);
      }
    }
    const errors: string[] = [];
    const vault = track(
      await VaultService.create({
        root: join(tempDir(), 'Vault'),
        git: false,
        embedder: () => {
          loads++;
          return loads === 1 ? Promise.resolve(new Crashy()) : Promise.resolve(new FakeEmbedder());
        },
        semanticOptions: { onError: (e) => errors.push(e.message), retryMinMs: 400 },
      }),
    );
    const a = actor('user');
    await vault.write(a, { path: 'Risorse/Pane.md', content: '# Pane\n\nLa ricetta del pane.\n' });
    await vault.semanticIdle();
    expect(vault.semanticStatus().state).toBe('ready');

    dead = true;
    // Only the timers are fake: the wall clock keeps running, so the retry must
    // not depend on comparing it with the time of the failure (a Node timer can
    // fire 1 ms early by `Date.now()`, and then nothing retried any more).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // The query cannot be embedded: full-text answers, the dead embedder is dropped.
      expect(paths(await vault.search(a, { query: 'ricette', mode: 'semantic' }))).toEqual([
        'Risorse/Pane.md',
      ]);
      expect(vault.semanticStatus().state).toBe('unavailable');
      expect(errors).toEqual(['embedding worker exited (1)']);

      // A change during the backoff does not load the model before its time.
      await vault.write(a, { path: 'Risorse/Riso.md', content: '# Riso\n\nIl risotto.\n' });
      await vault.semanticIdle();
      await vi.advanceTimersByTimeAsync(399);
      await vault.semanticIdle();
      expect(vault.semanticStatus().state).toBe('unavailable');
      expect(loads).toBe(1);

      // A new worker after the backoff, without waiting for a change.
      await vi.advanceTimersByTimeAsync(1);
      await vault.semanticIdle();
      const status = vault.semanticStatus();
      expect(status.state).toBe('ready');
      // The note written during the backoff is embedded too.
      expect(status.embedded).toBe(status.chunks);
      expect(loads).toBe(2);
      expect(errors).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a text the model refuses is put aside, the others are embedded (B5)', async () => {
    const errors: string[] = [];
    class Picky extends FakeEmbedder {
      override embed(texts: readonly string[]): Promise<Float32Array[]> {
        if (texts.some((t) => t.includes('VELENO'))) {
          return Promise.reject(new EmbedBatchError('tensor too large'));
        }
        return super.embed(texts);
      }
    }
    const vault = await newVault({
      embedder: () => Promise.resolve(new Picky()),
      semanticOptions: { onError: (e) => errors.push(e.message), retryMinMs: 10 },
    });
    const a = actor('user');
    await vault.write(a, { path: 'Inbox/Male.md', content: '# Male\n\nVELENO nel testo.\n' });
    for (let i = 0; i < 5; i++) {
      await vault.write(a, { path: `Risorse/Pane ${i}.md`, content: `# Pane ${i}\n\nRicetta.\n` });
    }
    await vault.semanticIdle();
    const status = vault.semanticStatus();
    expect(status.state).toBe('ready');
    expect(status.embedded).toBe(status.chunks - 1);
    expect(paths(await vault.search(a, { query: 'ricette', mode: 'semantic' }))).toContain(
      'Risorse/Pane 0.md',
    );
    expect(errors).toHaveLength(1);
  });

  it('a text that crashes the worker on its own is put aside after the restart (B5)', async () => {
    let loads = 0;
    class Fragile extends FakeEmbedder {
      dead = false;
      override embed(texts: readonly string[]): Promise<Float32Array[]> {
        if (this.dead || texts.some((t) => t.includes('VELENO'))) {
          this.dead = true;
          return Promise.reject(new Error('embedding worker exited (1)'));
        }
        return super.embed(texts);
      }
    }
    const vault = await newVault({
      embedder: () => {
        loads++;
        return Promise.resolve(new Fragile());
      },
      semanticOptions: { retryMinMs: 5, retryAfterMs: 5 },
    });
    const a = actor('user');
    await vault.write(a, { path: 'Inbox/Male.md', content: '# Male\n\nVELENO nel testo.\n' });
    for (let i = 0; i < 3; i++) {
      await vault.write(a, { path: `Risorse/Pane ${i}.md`, content: `# Pane ${i}\n\nRicetta.\n` });
    }
    await waitFor(() => {
      const s = vault.semanticStatus();
      return s.state === 'ready' && s.chunks > 0 && s.embedded === s.chunks - 1;
    }, 3_000);
    // The batch crashed, then the poisoned text crashed on its own twice: three restarts at most.
    expect(loads).toBeLessThanOrEqual(4);
  });

  it('a crash of the worker for another cause does not set a good text aside (review of 19/10, 18)', async () => {
    let calls = 0;
    class Unlucky extends FakeEmbedder {
      override embed(texts: readonly string[]): Promise<Float32Array[]> {
        // The first two requests die with the worker (memory, a forced close), then all is fine.
        if (++calls <= 2) return Promise.reject(new Error('embedding worker exited (137)'));
        return super.embed(texts);
      }
    }
    const vault = await newVault({
      embedder: () => Promise.resolve(new Unlucky()),
      semanticOptions: { retryMinMs: 5, retryAfterMs: 5 },
    });
    const a = actor('user');
    for (let i = 0; i < 3; i++) {
      await vault.write(a, { path: `Risorse/Pane ${i}.md`, content: `# Pane ${i}\n\nRicetta.\n` });
    }
    await waitFor(() => {
      const s = vault.semanticStatus();
      return s.state === 'ready' && s.chunks > 0 && s.embedded === s.chunks;
    }, 3_000);
  });

  it('removes the vectors of replaced text while the vault stays open', async () => {
    const vault = await newVault({ embedder: () => Promise.resolve(new FakeEmbedder()) });
    const a = actor('titan');
    let hash: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await vault.write(a, {
        path: 'Inbox/Diario.md',
        content: `# Diario\n\nGiorno ${i} di corsa.\n`,
        ...(hash ? { mode: 'overwrite' as const, base_hash: hash } : {}),
      });
      hash = r.hash;
      await vault.semanticIdle();
    }
    const count = (sql: string) => vault.index.db.get<{ c: number }>(sql)?.c ?? 0;
    const chunks = count('SELECT COUNT(DISTINCT hash) AS c FROM vault_chunks');
    // At most the previous generation lingers until the next pass.
    expect(count('SELECT COUNT(*) AS c FROM vault_vectors')).toBeLessThanOrEqual(chunks + 2);
  });
});

describe('index migration', () => {
  it('resumes a rebuild that the core did not finish', async () => {
    const dir = tempDir();
    const root = join(dir, 'Vault');
    mkdirSync(join(root, 'Inbox'), { recursive: true });
    writeFileSync(join(root, 'Inbox/Torte.md'), '# Torte\n\nLa ricetta della crostata.\n');
    const indexPath = defaultIndexPath(join(dir, 'home'), root);
    mkdirSync(join(dir, 'home', 'index'), { recursive: true });
    const first = await VaultService.open({ root, indexPath, git: false });
    await first.close();

    // State left by a core that died right after migration 3 (full-text
    // table recreated empty, rebuild never run): the notes are all there.
    const db = openDb(indexPath);
    db.run('DELETE FROM vault_fts');
    db.run(`DELETE FROM schema_migrations WHERE namespace = 'vault' AND version > 3`);
    db.exec('DROP TABLE IF EXISTS vault_meta');
    db.close();

    const vault = track(await VaultService.open({ root, indexPath, git: false }));
    const a = actor('user');
    expect(paths(await vault.search(a, { query: 'crostata', mode: 'text' }))).toEqual([
      'Inbox/Torte.md',
    ]);
    await vault.close();

    // A rebuild interrupted half-way is resumed at the next start.
    const again = openDb(indexPath);
    again.run(`INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('reindex_pending', '1')`);
    again.run('DELETE FROM vault_fts');
    again.close();
    const resumed = track(await VaultService.open({ root, indexPath, git: false }));
    expect(paths(await resumed.search(a, { query: 'crostata', mode: 'text' }))).toEqual([
      'Inbox/Torte.md',
    ]);
  });

  it('a rebuild at opening keeps the vectors of the notes not yet indexed again (M11)', async () => {
    const dir = tempDir();
    const root = join(dir, 'Vault');
    mkdirSync(join(root, 'Inbox'), { recursive: true });
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(root, `Inbox/Nota ${i}.md`), `# Nota ${i}\n\nIl testo numero ${i}.\n`);
    }
    const indexPath = defaultIndexPath(join(dir, 'home'), root);
    mkdirSync(join(dir, 'home', 'index'), { recursive: true });
    const first = await VaultService.open({
      root,
      indexPath,
      git: false,
      embedder: () => Promise.resolve(new FakeEmbedder()),
    });
    await first.semanticIdle();
    expect(first.semanticStatus().embedded).toBe(40);
    await first.close();

    const again = openDb(indexPath);
    again.run(`INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('reindex_pending', '1')`);
    again.close();
    let embedded = 0;
    class Counting extends FakeEmbedder {
      override embed(texts: readonly string[]): Promise<Float32Array[]> {
        embedded += texts.length;
        return super.embed(texts);
      }
    }
    const resumed = track(
      await VaultService.open({
        root,
        indexPath,
        git: false,
        embedder: () => Promise.resolve(new Counting()),
      }),
    );
    await resumed.semanticIdle();
    expect(resumed.semanticStatus().embedded).toBe(40);
    // Same text, same vectors: nothing had to be computed again.
    expect(embedded).toBe(0);
  });
});

describe('vault_search', () => {
  it('accepts mode "auto" (phase 1 name of hybrid)', async () => {
    const vault = await newVault();
    const tool = vaultSearchTool(vault);
    const input = tool.inputSchema.parse({ query: 'leggimi', mode: 'auto' });
    const hits = await tool.execute(input, {
      agentId: 'titan',
      runId: 'r',
      callEventId: 'e',
      signal: new AbortController().signal,
      emit: () => undefined,
    });
    expect(paths(hits)).toEqual(['LEGGIMI.md']);
  });
});

describe('model files', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const FILES: Record<string, string> = {
    'config.json': '{"model_type":"fake"}',
    'onnx/model.onnx': 'weights'.repeat(1000),
  };
  const spec = (over: Partial<Record<string, string>> = {}): ModelSpec => ({
    id: 'acme/fake-model',
    revision: '0123456789abcdef0123456789abcdef01234567',
    file: 'model',
    files: Object.entries(FILES).map(([path, content]) => ({
      path,
      sha256: sha(over[path] ?? content),
      size: Buffer.byteLength(over[path] ?? content),
    })),
  });

  async function hub(served: Record<string, string>) {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url ?? '');
      const prefix = '/acme/fake-model/resolve/0123456789abcdef0123456789abcdef01234567/';
      const file = req.url?.startsWith(prefix) ? served[req.url.slice(prefix.length)] : undefined;
      if (file === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-length': Buffer.byteLength(file) }).end(file);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    return {
      host: `http://127.0.0.1:${port}`,
      requests,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  it('downloads the pinned revision and checks every file against its sha256', async () => {
    const cacheDir = join(tempDir(), 'models');
    const ok = await hub(FILES);
    try {
      await ensureModelFiles({ cacheDir, spec: spec(), remoteHost: ok.host });
      expect(ok.requests.every((u) => u.includes('/resolve/0123456789abcdef'))).toBe(true);
      expect(existsSync(join(cacheDir, 'acme/fake-model/onnx/model.onnx'))).toBe(true);
      // Already there and intact: nothing is downloaded again.
      const before = ok.requests.length;
      await ensureModelFiles({ cacheDir, spec: spec(), remoteHost: ok.host, offline: true });
      expect(ok.requests.length).toBe(before);
    } finally {
      await ok.close();
    }
  });

  it('refuses and deletes a file whose hash does not match', async () => {
    const cacheDir = join(tempDir(), 'models');
    const evil = await hub({ ...FILES, 'onnx/model.onnx': 'tampered'.repeat(1000) });
    try {
      await expect(
        ensureModelFiles({ cacheDir, spec: spec(), remoteHost: evil.host }),
      ).rejects.toThrow(/sha256/);
      expect(existsSync(join(cacheDir, 'acme/fake-model/onnx/model.onnx'))).toBe(false);
      expect(existsSync(join(cacheDir, 'acme/fake-model/onnx/model.onnx.part'))).toBe(false);
    } finally {
      await evil.close();
    }
  });

  it('never loads a tampered model from the cache', async () => {
    const cacheDir = join(tempDir(), 'models');
    const dir = join(cacheDir, 'ibm-granite/granite-embedding-97m-multilingual-r2');
    mkdirSync(join(dir, 'onnx'), { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{"evil":true}');
    await expect(WorkerEmbedder.create({ cacheDir, offline: true })).rejects.toThrow(
      /sha256|not downloaded/,
    );
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
  }, 60_000);
});
