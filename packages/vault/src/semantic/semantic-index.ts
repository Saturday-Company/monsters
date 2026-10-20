import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { Db } from '@monsters/db';
import { embedText } from './chunk.ts';
import {
  EmbedBatchError,
  asSemanticUnavailable,
  type Embedder,
  type EmbedderLoader,
  type SemanticUnavailableError,
} from './embedder.ts';

/*
 * Vectors of the vault chunks (research/04 §3). The chunks are written by the
 * index together with the note (`vault_chunks`); this class embeds those that
 * have no vector yet, in the background, and answers nearest-neighbour
 * queries with an exact scan in JS (a few ms for 10k chunks).
 *
 * Vectors are stored by chunk hash and model (`vault_vectors`), not by note:
 * a full reindex, a rename or an undo that brings back the same text costs no
 * new embedding. Without a model (offline, failed download, optional
 * dependency missing, worker crashed) the state is `unavailable` and search
 * stays full-text; loading is tried again with a growing delay, except when
 * the model runtime is not installed (D-046): then it is never tried again.
 */

export type SemanticState = 'off' | 'loading' | 'indexing' | 'ready' | 'unavailable';

export interface SemanticStatus {
  state: SemanticState;
  model: string | null;
  /** Distinct chunks in the index. */
  chunks: number;
  /** Chunks that already have a vector of the current model. */
  embedded: number;
  error?: string;
  /** Italian, for the UI: why semantic search cannot work in this installation. */
  reason?: string;
}

export interface ChunkHit {
  nid: number;
  chunkId: number;
  /** Cosine similarity, 0..1 for related text. */
  score: number;
}

export interface SemanticIndexOptions {
  /** Chunks embedded per call (default 16). */
  batchSize?: number;
  /** First delay before loading the model again after a failure (default 30 s), doubled at each failure. */
  retryMinMs?: number;
  /** Longest delay between two attempts (default 10 min). */
  retryAfterMs?: number;
  /** Reports a failure to load the model or to embed (once per series of failures). */
  onError?: (err: Error) => void;
  /**
   * Longest wait in `stop()` for a model load in progress to end (default
   * 20 s): a loader that honors the signal stops its worker first (D-099).
   */
  stopGraceMs?: number;
  /**
   * True while the chunks are not all in the index (a rebuild in progress):
   * the clean-up of vectors of text gone from the vault waits until it is false.
   */
  holdGarbage?: () => boolean;
}

interface Matrix {
  version: number;
  chunkIds: Int32Array;
  nids: Int32Array;
  data: Float32Array;
  dim: number;
}

/** One unit vector per note (the normalized centroid of its chunks) and their sum. */
interface NoteMatrix {
  version: number;
  nids: Int32Array;
  row: Map<number, number>;
  data: Float32Array;
  sum: Float32Array;
  dim: number;
}

/** A note compared with another for "related notes". */
export interface RelatedScore {
  nid: number;
  /** Cosine of the two notes. */
  score: number;
  /** How far above the usual similarities the pair is, in standard deviations (see `related`). */
  z: number;
}

function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function dot(a: Float32Array, aOff: number, b: Float32Array, dim: number): number {
  let s = 0;
  for (let i = 0; i < dim; i++) s += (a[aOff + i] ?? 0) * (b[i] ?? 0);
  return s;
}

/**
 * Median and spread (MAD scaled to a standard deviation; the standard
 * deviation when more than half of the values are equal) of a sample.
 */
export function robustStats(values: Float64Array): { center: number; spread: number } {
  const n = values.length;
  if (n === 0) return { center: 0, spread: 0 };
  const median = (sorted: Float64Array) => {
    const mid = sorted.length >> 1;
    return sorted.length % 2
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  };
  const sorted = Float64Array.from(values).sort();
  const center = median(sorted);
  const mad = median(sorted.map((v) => Math.abs(v - center)).sort());
  if (mad > 1e-9) return { center, spread: 1.4826 * mad };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { center, spread: Math.sqrt(variance) };
}

/** Crashes of the worker with one text alone before that text is set aside. */
const CRASHES_BEFORE_QUARANTINE = 2;

export class SemanticIndex {
  readonly #db: Db;
  readonly #loader: EmbedderLoader;
  readonly #batchSize: number;
  readonly #retryMinMs: number;
  readonly #retryAfterMs: number;
  readonly #onError: ((err: Error) => void) | undefined;
  readonly #stopGraceMs: number;
  readonly #holdGarbage: () => boolean;
  /** Aborted by `stop()`: interrupts the model download. */
  readonly #abort = new AbortController();
  #embedder: Embedder | null = null;
  #loading: Promise<Embedder | null> | null = null;
  #state: SemanticState = 'off';
  #error: string | undefined;
  /** The model runtime is not installed: semantic search stays off for good. */
  #unavailable: SemanticUnavailableError | null = null;
  /** Consecutive failures: the delay before the next attempt doubles with each. */
  #failures = 0;
  /**
   * Pending while waiting before the next attempt to load the model: it is the
   * backoff gate itself. Comparing clocks instead (`Date.now()` against the
   * time of the failure) refused the attempt when the timer fired 1 ms early,
   * which Node timers do, and then nothing retried until the vault changed.
   */
  #retryTimer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  #dirty = false;
  #stopped = false;
  #version = 0;
  #matrix: Matrix | null = null;
  #notes: NoteMatrix | null = null;
  #pending: { version: number; nids: Set<number> } | null = null;
  /**
   * Remove vectors of text no longer in the vault at the end of the next pass.
   * Set by `start()` (after the opening sync) and `collectGarbage()`, never
   * before: the passes kicked by a rebuild at opening run while the chunks of
   * the notes not yet indexed again are missing, and would drop their vectors.
   */
  #gcPending = false;
  /**
   * Hashes of chunks replaced or removed, checked one pass later: a move
   * removes the text and adds it back a moment after, and must not lose it.
   */
  #dropped = new Set<string>();
  #droppedBefore = new Set<string>();
  /**
   * Texts the model cannot embed (B5 of 18/10): refused alone, or that took
   * the worker down alone. They stay without a vector (full-text still finds
   * their notes) until the core restarts; the rest of the vault goes on.
   */
  readonly #quarantine = new Set<string>();
  /** Texts in the batch that took the worker down: tried one at a time next. */
  readonly #suspects = new Set<string>();
  /**
   * Crashes of the worker with a suspect alone, by text: set aside only at the second in a
   * row (review of 19/10, item 18: a crash of the computer, not of the text, is not proof).
   */
  readonly #crashes = new Map<string, number>();

  constructor(db: Db, loader: EmbedderLoader, opts: SemanticIndexOptions = {}) {
    this.#db = db;
    this.#loader = loader;
    this.#batchSize = opts.batchSize ?? 16;
    this.#retryMinMs = opts.retryMinMs ?? 30_000;
    this.#retryAfterMs = opts.retryAfterMs ?? 10 * 60_000;
    this.#onError = opts.onError;
    this.#stopGraceMs = opts.stopGraceMs ?? 20_000;
    this.#holdGarbage = opts.holdGarbage ?? (() => false);
  }

  /** The model is loaded: queries can be embedded. */
  get usable(): boolean {
    return this.#embedder !== null && !this.#stopped;
  }

  status(): SemanticStatus {
    const model = this.#embedder?.model ?? null;
    const chunks =
      this.#db.get<{ c: number }>('SELECT COUNT(DISTINCT hash) AS c FROM vault_chunks')?.c ?? 0;
    const embedded = model
      ? (this.#db.get<{ c: number }>(
          `SELECT COUNT(DISTINCT c.hash) AS c FROM vault_chunks c
           JOIN vault_vectors v ON v.hash = c.hash AND v.model = ?`,
          model,
        )?.c ?? 0)
      : 0;
    return {
      state: this.#state,
      model,
      chunks,
      embedded,
      ...(this.#error ? { error: this.#error } : {}),
      ...(this.#unavailable ? { reason: this.#unavailable.reason } : {}),
    };
  }

  /**
   * Starts background indexing (non-blocking), once the index is complete:
   * the first pass also drops the vectors of text gone while the core was off.
   */
  start(): void {
    this.#gcPending = true;
    this.changed();
  }

  /**
   * Chunks were added or removed: refresh the vectors in the background.
   * `dropped`: hashes of the chunks that were replaced or removed, whose
   * vectors go once no chunk has that text any more.
   */
  changed(dropped: Iterable<string> = []): void {
    for (const h of dropped) this.#dropped.add(h);
    this.#version++;
    this.#kick();
  }

  #kick(): void {
    if (this.#stopped || this.#unavailable) return;
    this.#dirty = true;
    this.#running ??= this.#loop().finally(() => {
      this.#running = null;
      // A kick that arrived during the pass (a change, or the retry timer
      // while the pass was failing) runs now, unless the backoff is pending.
      if (this.#dirty && !this.#stopped && (this.#embedder || !this.#retryTimer)) this.#kick();
    });
  }

  /**
   * Drops the vectors of text that is no longer in the vault at the end of
   * the next pass. Only when the index is complete (after opening or a full
   * reindex): during a reindex the chunks are briefly gone, their vectors not.
   */
  collectGarbage(): void {
    this.#gcPending = true;
    this.#kick();
  }

  /** Resolves when the background work is done (tests, `monsters vault reindex`). */
  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  /**
   * Stops: a download in progress is aborted, the worker exits after the call
   * into the model in progress (D-099), the current batch is dropped. A model
   * load in progress is awaited for at most `stopGraceMs`, so that its worker
   * is gone before the process may exit; a loader that ignores the signal has
   * its embedder closed when it arrives.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    const loading = this.#loading;
    this.#abort.abort(new Error('semantic index stopped'));
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const embedder = this.#embedder;
    this.#embedder = null;
    await embedder?.close().catch(() => undefined);
    await this.#running?.catch(() => undefined);
    if (loading) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        loading.catch(() => null),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.#stopGraceMs);
        }),
      ]);
      clearTimeout(timer);
    }
  }

  /** Delay before the next attempt after `#failures` consecutive failures. */
  #retryDelay(): number {
    const exp = Math.min(Math.max(this.#failures - 1, 0), 30);
    return Math.min(this.#retryMinMs * 2 ** exp, this.#retryAfterMs);
  }

  async #ensureEmbedder(): Promise<Embedder | null> {
    if (this.#embedder) return this.#embedder;
    if (this.#stopped || this.#unavailable) return null;
    // Waiting out the backoff: the retry timer kicks the next attempt.
    if (this.#retryTimer) return null;
    const signal = this.#abort.signal;
    this.#loading ??= (async () => {
      this.#state = 'loading';
      try {
        const embedder = await this.#loader(signal);
        if (this.#stopped) {
          await embedder.close().catch(() => undefined);
          return null;
        }
        this.#embedder = embedder;
        this.#error = undefined;
        this.#failures = 0;
        // Vectors of another model are useless now.
        this.#db.run('DELETE FROM vault_vectors WHERE model != ?', embedder.model);
        return embedder;
      } catch (err) {
        if (!this.#stopped) this.#fail(err);
        return null;
      } finally {
        this.#loading = null;
      }
    })();
    // `stop()` does not wait for a download that ignores the signal.
    const stopped = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null);
      else signal.addEventListener('abort', () => resolve(null), { once: true });
    });
    return Promise.race([this.#loading, stopped]);
  }

  #fail(err: unknown): void {
    const missing = asSemanticUnavailable(err);
    if (missing) {
      // Not installed: one line in the log, no retries, no error text anywhere else.
      this.#state = 'unavailable';
      this.#error = missing.message;
      if (!this.#unavailable) this.#onError?.(missing);
      this.#unavailable = missing;
      if (this.#retryTimer) clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
      return;
    }
    const e = err instanceof Error ? err : new Error(String(err));
    this.#state = 'unavailable';
    this.#error = e.message;
    this.#failures++;
    // Logged once per series of failures: retries stay quiet until one works.
    if (this.#failures === 1) this.#onError?.(e);
    // Try again later even if nothing changes in the vault.
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#kick();
    }, this.#retryDelay());
    this.#retryTimer.unref();
  }

  /** The embedder failed (worker crashed): drop it and fall back to full-text. */
  #lost(embedder: Embedder, err: unknown): void {
    if (this.#stopped || this.#embedder !== embedder) return;
    this.#embedder = null;
    this.#matrix = null;
    this.#notes = null;
    void embedder.close().catch(() => undefined);
    this.#fail(err);
  }

  #missing(model: string, limit: number): { hash: string; text: string }[] {
    return this.#db
      .all<{ hash: string; title: string; heading_path: string; text: string }>(
        `SELECT c.hash, n.title, c.heading_path, c.text FROM vault_chunks c
         JOIN vault_notes n ON n.nid = c.nid
         LEFT JOIN vault_vectors v ON v.hash = c.hash AND v.model = ?
         WHERE v.hash IS NULL GROUP BY c.hash LIMIT ?`,
        model,
        limit + this.#quarantine.size,
      )
      .filter((r) => !this.#quarantine.has(r.hash))
      .slice(0, limit)
      .map((r) => ({ hash: r.hash, text: embedText(r.title, r.heading_path, r.text) }));
  }

  /** The next texts to embed: a suspect alone after a crash, else a batch. */
  #nextBatch(model: string): { hash: string; text: string }[] {
    if (this.#suspects.size === 0) return this.#missing(model, this.#batchSize);
    const missing = this.#missing(model, this.#batchSize + this.#suspects.size);
    const suspect = missing.find((b) => this.#suspects.has(b.hash));
    if (suspect) return [suspect];
    // The suspects are embedded or gone: back to batches.
    this.#suspects.clear();
    return missing.slice(0, this.#batchSize);
  }

  #setAside(hash: string, err: unknown): void {
    this.#quarantine.add(hash);
    this.#suspects.delete(hash);
    const why = err instanceof Error ? err.message : String(err);
    this.#onError?.(new Error(`a text of the vault cannot be embedded, left out: ${why}`));
  }

  /** Stores the vectors of a batch. */
  #store(embedder: Embedder, batch: { hash: string }[], vectors: Float32Array[]): void {
    this.#db.transaction(() => {
      batch.forEach((b, i) => {
        const v = vectors[i];
        if (!v || v.length !== embedder.dim) return;
        this.#db.run(
          'INSERT OR REPLACE INTO vault_vectors (hash, model, dim, vec) VALUES (?, ?, ?, ?)',
          b.hash,
          embedder.model,
          embedder.dim,
          toBlob(v),
        );
      });
    });
    for (const b of batch) {
      this.#suspects.delete(b.hash);
      this.#crashes.delete(b.hash);
    }
    this.#version++;
  }

  /**
   * Embeds a batch. A batch the model refuses is tried one text at a time and
   * the texts refused alone are set aside; a crash of the worker drops the
   * embedder (as before) and marks the batch as suspect, and a suspect that
   * crashes it again alone is set aside. False when the embedder is lost.
   */
  async #embedBatch(embedder: Embedder, batch: { hash: string; text: string }[]): Promise<boolean> {
    let vectors: Float32Array[];
    try {
      vectors = await embedder.embed(batch.map((b) => b.text));
    } catch (err) {
      if (this.#stopped) return false;
      const only = batch.length === 1 ? batch[0] : undefined;
      if (err instanceof EmbedBatchError) {
        if (only) {
          this.#setAside(only.hash, err);
          return true;
        }
        for (const b of batch) {
          if (!(await this.#embedBatch(embedder, [b]))) return false;
          if (this.#stopped) return false;
        }
        return true;
      }
      if (only && this.#suspects.has(only.hash)) {
        const crashes = (this.#crashes.get(only.hash) ?? 0) + 1;
        this.#crashes.set(only.hash, crashes);
        if (crashes >= CRASHES_BEFORE_QUARANTINE) {
          this.#crashes.delete(only.hash);
          this.#quarantine.add(only.hash);
        }
      } else for (const b of batch) this.#suspects.add(b.hash);
      this.#lost(embedder, err);
      return false;
    }
    if (this.#stopped) return false;
    this.#store(embedder, batch, vectors);
    return true;
  }

  async #loop(): Promise<void> {
    while (this.#dirty && !this.#stopped) {
      this.#dirty = false;
      const embedder = await this.#ensureEmbedder();
      if (!embedder) return;
      this.#state = 'indexing';
      for (;;) {
        if (this.#stopped) return;
        const batch = this.#nextBatch(embedder.model);
        if (batch.length === 0) break;
        if (!(await this.#embedBatch(embedder, batch))) return;
        // Let the core serve requests between batches.
        await yieldToLoop();
      }
      if (this.#gcPending && !this.#dirty && !this.#holdGarbage()) {
        this.#gcPending = false;
        this.#db.run('DELETE FROM vault_vectors WHERE hash NOT IN (SELECT hash FROM vault_chunks)');
      }
      this.#collectDropped();
      this.#state = 'ready';
    }
  }

  /**
   * Incremental clean-up: vectors of text dropped before the previous pass
   * and in no chunk any more. Cheap (by key), so it runs at every pass.
   */
  #collectDropped(): void {
    const old = this.#droppedBefore;
    this.#droppedBefore = this.#dropped;
    this.#dropped = new Set();
    if (old.size === 0) return;
    let removed = false;
    this.#db.transaction(() => {
      for (const hash of old) {
        if (this.#db.get('SELECT 1 AS x FROM vault_chunks WHERE hash = ? LIMIT 1', hash)) continue;
        const r = this.#db.run('DELETE FROM vault_vectors WHERE hash = ?', hash);
        if (Number(r.changes) > 0) removed = true;
      }
    });
    if (removed) this.#version++;
  }

  /**
   * Notes with text that has no vector yet (just written, still indexing):
   * meaning cannot rank them, so hybrid search must not drop them.
   */
  unembeddedNids(): Set<number> {
    const model = this.#embedder?.model;
    if (!model) return new Set();
    if (this.#pending?.version === this.#version) return this.#pending.nids;
    const nids = new Set(
      this.#db
        .all<{ nid: number }>(
          `SELECT DISTINCT c.nid FROM vault_chunks c
           LEFT JOIN vault_vectors v ON v.hash = c.hash AND v.model = ?
           WHERE v.hash IS NULL`,
          model,
        )
        .map((r) => r.nid),
    );
    this.#pending = { version: this.#version, nids };
    return nids;
  }

  #matrixNow(): Matrix | null {
    const embedder = this.#embedder;
    if (!embedder) return null;
    if (this.#matrix?.version === this.#version) return this.#matrix;
    const rows = this.#db.all<{ id: number; nid: number; vec: Uint8Array }>(
      `SELECT c.id, c.nid, v.vec FROM vault_chunks c
       JOIN vault_vectors v ON v.hash = c.hash AND v.model = ? ORDER BY c.id`,
      embedder.model,
    );
    const dim = embedder.dim;
    const data = new Float32Array(rows.length * dim);
    const chunkIds = new Int32Array(rows.length);
    const nids = new Int32Array(rows.length);
    rows.forEach((r, i) => {
      const bytes = r.vec;
      const v = new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      if (v.length === dim) data.set(v, i * dim);
      chunkIds[i] = r.id;
      nids[i] = r.nid;
    });
    this.#matrix = { version: this.#version, chunkIds, nids, data, dim };
    return this.#matrix;
  }

  /** Best chunk per note, best notes first. Null when the model is not loaded. */
  #rank(
    query: Float32Array,
    m: Matrix,
    allowed: ReadonlySet<number> | null,
    exclude: number | null,
    limit: number,
  ): ChunkHit[] {
    const best = new Map<number, ChunkHit>();
    for (let i = 0; i < m.nids.length; i++) {
      const nid = m.nids[i] ?? 0;
      if (nid === exclude || (allowed && !allowed.has(nid))) continue;
      const score = dot(m.data, i * m.dim, query, m.dim);
      const prev = best.get(nid);
      if (!prev || score > prev.score) best.set(nid, { nid, chunkId: m.chunkIds[i] ?? 0, score });
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Notes nearest to the query, one hit per note (its best chunk). `allowed`
   * restricts the candidates (filters and permissions). Null when not ready.
   */
  async search(
    query: string,
    opts: { limit: number; allowed?: ReadonlySet<number> | null },
  ): Promise<ChunkHit[] | null> {
    const embedder = this.#embedder;
    if (!embedder || this.#stopped) return null;
    const m = this.#matrixNow();
    if (!m || m.nids.length === 0) return null;
    let q: Float32Array | undefined;
    try {
      q = (await embedder.embed([query]))[0];
    } catch (err) {
      // Typically the worker died: full-text answers, loading is retried later.
      this.#lost(embedder, err);
      return null;
    }
    if (!q || q.length !== m.dim) return null;
    return this.#rank(q, this.#matrixNow() ?? m, opts.allowed ?? null, null, opts.limit);
  }

  #notesNow(): NoteMatrix | null {
    const m = this.#matrixNow();
    if (!m) return null;
    if (this.#notes?.version === m.version) return this.#notes;
    const dim = m.dim;
    const row = new Map<number, number>();
    for (const nid of m.nids) if (!row.has(nid)) row.set(nid, row.size);
    const data = new Float32Array(row.size * dim);
    for (let i = 0; i < m.nids.length; i++) {
      const at = (row.get(m.nids[i] ?? 0) ?? 0) * dim;
      for (let d = 0; d < dim; d++) data[at + d] = (data[at + d] ?? 0) + (m.data[i * dim + d] ?? 0);
    }
    const sum = new Float32Array(dim);
    const nids = new Int32Array(row.size);
    for (const [nid, r] of row) {
      nids[r] = nid;
      const v = data.subarray(r * dim, (r + 1) * dim);
      const norm = Math.hypot(...v);
      for (let d = 0; d < dim; d++) {
        v[d] = norm > 0 ? (v[d] ?? 0) / norm : 0;
        sum[d] = (sum[d] ?? 0) + (v[d] ?? 0);
      }
    }
    this.#notes = { version: m.version, nids, row, data, sum, dim };
    return this.#notes;
  }

  /**
   * How related in meaning every candidate is to a note. The cosine of two
   * notes (centroids of their chunks) is close to every other cosine with
   * this kind of model, so it is turned into a z-score against the
   * similarities of the note to all the others in the vault, with median and
   * MAD: the notes on the same subject must not raise the background they
   * are measured against (with mean and standard deviation, a subject
   * covering a fifth of the vault could no longer stand out). A note close to
   * everything (generic text) would top every list: the pair is also measured
   * against that note's own mean similarity to the vault, and the lower of the
   * two z counts. Best first.
   * Null when not ready or when the note has no vector yet.
   */
  related(nid: number, opts: { allowed?: ReadonlySet<number> | null } = {}): RelatedScore[] | null {
    if (this.#stopped) return null;
    const nm = this.#notesNow();
    const self = nm?.row.get(nid);
    if (!nm || self === undefined) return null;
    const { dim, data } = nm;
    const count = nm.nids.length;
    const others = count - 1;
    if (others < 1) return [];
    const query = data.subarray(self * dim, (self + 1) * dim);
    const sims = new Float64Array(count);
    const background = new Float64Array(others);
    for (let r = 0, k = 0; r < count; r++) {
      if (r === self) continue;
      sims[r] = dot(data, r * dim, query, dim);
      background[k++] = sims[r] ?? 0;
    }
    const { center, spread } = robustStats(background);
    if (spread < 1e-6) return [];
    const allowed = opts.allowed ?? null;
    const notes: RelatedScore[] = [];
    for (let r = 0; r < count; r++) {
      const other = nm.nids[r] ?? 0;
      if (r === self || (allowed && !allowed.has(other))) continue;
      const score = sims[r] ?? 0;
      // Mean similarity of the other note to the rest of the vault (unit vectors: minus itself).
      const otherMean = (dot(data, r * dim, nm.sum, dim) - 1) / others;
      const z = Math.min(score - center, score - otherMean) / spread;
      notes.push({ nid: other, score, z });
    }
    notes.sort((a, b) => b.z - a.z);
    return notes;
  }

  /** The chunk of `nid` closest to note `to` (snippet of a related note). */
  closestChunk(nid: number, to: number): ChunkHit | undefined {
    const m = this.#matrixNow();
    const nm = this.#notesNow();
    const at = nm?.row.get(to);
    if (!m || !nm || at === undefined) return undefined;
    const query = nm.data.subarray(at * nm.dim, (at + 1) * nm.dim);
    return this.#rank(query, m, new Set([nid]), null, 1)[0];
  }

  /** Text of a chunk (for the snippet of a semantic hit). */
  chunkText(chunkId: number): { heading_path: string; text: string } | undefined {
    return this.#db.get('SELECT heading_path, text FROM vault_chunks WHERE id = ?', chunkId);
  }
}
