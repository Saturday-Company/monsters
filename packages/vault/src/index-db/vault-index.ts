import { posix } from 'node:path';
import type { Db } from '@monsters/db';
import { PRIVATE_FOLDERS, VAULT_LAYOUTS, type VaultLayout } from '@monsters/shared';
import { linkKey, titleOf } from '../paths.ts';
import { expandTag, type ParsedNote } from '../markdown/parse.ts';
import { chunkNote } from '../semantic/chunk.ts';
import type { RelationSignals } from '../semantic/related.ts';
import { stemText, stemWord } from '../semantic/stem.ts';

/*
 * SQLite index of the vault: notes, properties, tags, aliases, links and a
 * per-note FTS5 table. Pure data access: the service decides what to index.
 */

export interface NoteRow {
  nid: number;
  path: string;
  uid: string | null;
  title: string;
  type: string | null;
  author: string | null;
  created: string | null;
  updated: string;
  hash: string;
  mtime: number;
  size: number;
  private: number;
  is_md: number;
  summary: string;
}

export interface FileStat {
  hash: string;
  mtime: number;
  size: number;
}

export interface SearchFilters {
  query?: string | undefined;
  /** All of these tags (hierarchical: `progetto` matches `progetto/monsters`). */
  tags?: readonly string[] | undefined;
  folder?: string | undefined;
  type?: string | undefined;
  /** ISO date or date-time: notes updated at or after it. */
  updatedAfter?: string | undefined;
  /** Only notes that link to this note. */
  linksTo?: number | undefined;
  limit: number;
  /** Hide `private: true` notes and the private folder of the layout (`Privato/`). */
  hidePrivate: boolean;
  /** Any of the words instead of all of them (ranked by BM25, hits marked partial). */
  anyWords?: boolean | undefined;
}

export interface SearchHit {
  path: string;
  title: string;
  type: string | null;
  updated: string;
  score: number;
  snippet: string;
  tags: string[];
  /** True when no note had every word: the hit matches only some of them (fallback). */
  partial?: true;
}

const NOTE_COLUMNS =
  'n.nid, n.path, n.uid, n.title, n.type, n.author, n.created, n.updated, n.hash, n.mtime, n.size, n.private, n.is_md, n.summary';

/** Local ISO date-time without milliseconds and timezone (Obsidian "Date & time"). */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** FTS5 columns holding the text as written; `*_stem` hold Italian stems. */
const TEXT_COLUMNS = '{title aliases tags headings body}';
const STEM_COLUMNS = '{title_stem body_stem}';

/**
 * Builds an FTS5 query from free text: "quoted text" is an exact phrase, every
 * other word a prefix term that also matches the words with the same Italian
 * stem ("ricette" finds "ricetta"). All the parts must match.
 */
export function ftsQuery(text: string): string {
  const parts: string[] = [];
  for (const m of text.matchAll(/"([^"]+)"|(\S+)/g)) {
    if (m[1]) {
      const words = m[1].match(/[\p{L}\p{N}_]+/gu);
      if (words) parts.push(`${TEXT_COLUMNS} : "${words.join(' ')}"`);
    } else if (m[2]) {
      for (const w of m[2].match(/[\p{L}\p{N}_]+/gu) ?? []) {
        const s = stemWord(w);
        parts.push(
          s.length >= 3 && s !== w.toLowerCase()
            ? `(${TEXT_COLUMNS} : "${w}"* OR ${STEM_COLUMNS} : "${s}"*)`
            : `${TEXT_COLUMNS} : "${w}"*`,
        );
      }
    }
  }
  return parts.join(' AND ');
}

/** Short words that would make the fallback match almost everything. */
const STOPWORDS = new Set(
  [
    // Italian (the notes can be in any language: both lists always apply, D-153).
    'il lo la le gli un una uno di da in con su per tra fra del della dei delle dello degli al alla ', // i18n-ignore
    'ai alle nel nella nei nelle sul sulla sui che chi cosa come non più ma anche sono è ', // i18n-ignore
    // Question words and common verbs: in a question they match almost any note.
    'quando dove quale quali quanto quanta quanti quante perché mio mia miei mie tuo tua suo sua ', // i18n-ignore
    'nostro nostra questo questa quello quella posso puoi può possiamo devo deve dobbiamo fare ', // i18n-ignore
    'faccio fa serve servono vorrei voglio stato stata essere avere abbiamo hanno ', // i18n-ignore
    // English.
    'the of and for with from that this are was what how ', // i18n-ignore
    'these those which who whom whose when where why was were been being have has had ', // i18n-ignore
    'does did can could should would will shall might must not but about into over also ', // i18n-ignore
    'than then there here your yours their theirs our ours its they them you his her ', // i18n-ignore
    'need needs want wants make made find tell show give', // i18n-ignore
  ]
    .join('')
    .split(' '),
);

/** "autunnale" → "autunn": crude stem so that "autunno", "autunnale" and "autunnali" meet. */
function stem(word: string): string {
  return word.length >= 7
    ? word.slice(0, word.length - 3)
    : word.length >= 5
      ? word.slice(0, -1)
      : word;
}

/**
 * Fallback FTS5 query when every word together finds nothing: any of the words,
 * as prefixes of a stem for words of 4 letters or more, ranked by BM25 (notes
 * with more words first). Null when there is nothing to relax (one word).
 */
export function ftsAnyQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
  const terms = [...new Set(words.map((w) => (w.length >= 4 ? `"${stem(w)}"*` : `"${w}"`)))];
  const all = (text.match(/[\p{L}\p{N}_]+/gu) ?? []).length;
  if (all < 2 || terms.length === 0) return null;
  return terms.join(' OR ');
}

function summaryOf(note: ParsedNote): string {
  const lines = note.body
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^#\s/.test(l.trim()))
    .slice(0, 6)
    .join(' ');
  return lines.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export class VaultIndex {
  readonly db: Db;
  /** Hashes of chunks replaced or removed since the last `takeDroppedChunks()`. */
  #dropped: string[] = [];

  /**
   * The names of the vault's folders (D-154): its private folder is hidden like the private
   * notes, its templates folder is not searched unless asked for.
   */
  readonly layout: VaultLayout;

  constructor(db: Db, layout: VaultLayout = VAULT_LAYOUTS.it) {
    this.db = db;
    this.layout = layout;
  }

  /** Hashes of the chunks replaced or removed since the last call (their vectors may be orphans). */
  takeDroppedChunks(): string[] {
    return this.#dropped.splice(0);
  }

  #noteDropped(nid: number): void {
    for (const r of this.db.all<{ hash: string }>(
      'SELECT hash FROM vault_chunks WHERE nid = ?',
      nid,
    )) {
      this.#dropped.push(r.hash);
    }
  }

  /** A rebuild of the index was started and not finished (see `vault_meta`). */
  get reindexPending(): boolean {
    return (
      this.db.get<{ value: string }>(`SELECT value FROM vault_meta WHERE key = 'reindex_pending'`)
        ?.value === '1'
    );
  }

  set reindexPending(pending: boolean) {
    if (pending) {
      this.db.run(`INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('reindex_pending', '1')`);
    } else {
      this.db.run(`DELETE FROM vault_meta WHERE key = 'reindex_pending'`);
    }
  }

  get(path: string): NoteRow | undefined {
    return this.db.get<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE n.path = ?`, path);
  }

  getByNid(nid: number): NoteRow | undefined {
    return this.db.get<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE n.nid = ?`, nid);
  }

  getByUid(uid: string): NoteRow | undefined {
    return this.db.get<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE n.uid = ?`, uid);
  }

  /** Every indexed file with what is needed to detect changes. */
  files(): (FileStat & { path: string })[] {
    return this.db.all('SELECT path, hash, mtime, size FROM vault_notes');
  }

  count(): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM vault_notes')?.c ?? 0;
  }

  /** Inserts or replaces a file. `note` is null for non-Markdown files. */
  upsert(path: string, stat: FileStat, note: ParsedNote | null): number {
    return this.db.transaction(() => {
      const existing = this.db.get<{ nid: number }>(
        'SELECT nid FROM vault_notes WHERE path = ?',
        path,
      );
      const folder = posix.dirname(path) === '.' ? '' : posix.dirname(path);
      const updated = note?.updated ?? localIso(stat.mtime);
      const values = [
        linkKey(path),
        linkKey(posix.basename(path)),
        folder,
        note?.uid ?? null,
        titleOf(path),
        note?.type ?? null,
        note?.author ?? null,
        note?.created ?? null,
        updated,
        stat.hash,
        Math.round(stat.mtime),
        stat.size,
        note?.private ? 1 : 0,
        note ? 1 : 0,
        note ? summaryOf(note) : '',
      ] as const;
      let nid: number;
      if (existing) {
        nid = existing.nid;
        this.db.run(
          `UPDATE vault_notes SET path_key = ?, name_key = ?, folder = ?, uid = ?, title = ?, type = ?,
             author = ?, created = ?, updated = ?, hash = ?, mtime = ?, size = ?, private = ?, is_md = ?,
             summary = ? WHERE nid = ?`,
          ...values,
          nid,
        );
        this.#clearDetails(nid);
      } else {
        nid = Number(
          this.db.run(
            `INSERT INTO vault_notes (path, path_key, name_key, folder, uid, title, type, author, created,
               updated, hash, mtime, size, private, is_md, summary)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            path,
            ...values,
          ).lastInsertRowid,
        );
      }
      if (note) this.#insertDetails(nid, path, note);
      return nid;
    });
  }

  #clearDetails(nid: number): void {
    this.#noteDropped(nid);
    this.db.run('DELETE FROM vault_props WHERE nid = ?', nid);
    this.db.run('DELETE FROM vault_tags WHERE nid = ?', nid);
    this.db.run('DELETE FROM vault_aliases WHERE nid = ?', nid);
    this.db.run('DELETE FROM vault_links WHERE src_nid = ?', nid);
    this.db.run('DELETE FROM vault_chunks WHERE nid = ?', nid);
    this.db.run('DELETE FROM vault_fts WHERE rowid = ?', nid);
  }

  #insertDetails(nid: number, path: string, note: ParsedNote): void {
    for (const [key, value] of Object.entries(note.props)) {
      this.db.run(
        'INSERT INTO vault_props (nid, key, value_json) VALUES (?, ?, ?)',
        nid,
        key,
        JSON.stringify(value ?? null),
      );
    }
    const explicit = new Set(note.tags);
    const all = new Set(note.tags.flatMap(expandTag));
    for (const tag of all) {
      this.db.run(
        'INSERT INTO vault_tags (nid, tag, explicit) VALUES (?, ?, ?)',
        nid,
        tag,
        explicit.has(tag) ? 1 : 0,
      );
    }
    for (const alias of note.aliases) {
      this.db.run(
        'INSERT INTO vault_aliases (nid, alias, akey) VALUES (?, ?, ?)',
        nid,
        alias,
        alias.toLowerCase(),
      );
    }
    note.links.forEach((link, ord) => {
      if (link.target === '') return; // link to a heading of the same note
      this.db.run(
        `INSERT INTO vault_links (src_nid, ord, kind, target_raw, target_key, heading, block, alias,
           is_embed, in_property, start_pos, end_pos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nid,
        ord,
        link.kind,
        link.target,
        targetKey(link.kind, link.target, path),
        link.heading,
        link.block,
        link.alias,
        link.embed ? 1 : 0,
        link.inProperty ? 1 : 0,
        link.start,
        link.end,
      );
    });
    const aliases = note.aliases.join(' · ');
    const headings = note.headings.map((h) => h.text).join(' · ');
    this.db.run(
      `INSERT INTO vault_fts (rowid, title, aliases, tags, headings, body, title_stem, body_stem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nid,
      note.title,
      aliases,
      note.tags.map((t) => t.replace(/\//g, ' ')).join(' '),
      headings,
      note.body,
      stemText(`${note.title} ${aliases} ${headings}`),
      stemText(note.body),
    );
    for (const c of chunkNote(note)) {
      this.db.run(
        `INSERT INTO vault_chunks (nid, ord, heading_path, text, token_count, hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        nid,
        c.ord,
        c.headingPath,
        c.text,
        c.tokenCount,
        c.hash,
      );
    }
  }

  remove(path: string): boolean {
    return this.db.transaction(() => {
      const row = this.db.get<{ nid: number }>('SELECT nid FROM vault_notes WHERE path = ?', path);
      if (!row) return false;
      this.#noteDropped(row.nid);
      this.db.run('DELETE FROM vault_fts WHERE rowid = ?', row.nid);
      this.db.run('DELETE FROM vault_notes WHERE nid = ?', row.nid);
      return true;
    });
  }

  /** Empties the index for a rebuild (vectors stay: the same text comes back). */
  clear(): void {
    this.#dropped = [];
    this.db.transaction(() => {
      this.db.run('DELETE FROM vault_fts');
      this.db.run('DELETE FROM vault_notes');
    });
  }

  /**
   * Resolves links like Obsidian ("shortest" format): exact path, then unique
   * file name (shortest path wins on ties), then path suffix.
   */
  resolveLinks(srcNid?: number): void {
    const where = srcNid === undefined ? '' : 'WHERE src_nid = ?';
    const sql = `UPDATE vault_links SET target_nid = COALESCE(
        (SELECT n.nid FROM vault_notes n WHERE n.path_key = vault_links.target_key),
        (SELECT n.nid FROM vault_notes n WHERE n.name_key = vault_links.target_key
           ORDER BY length(n.path), n.path LIMIT 1),
        (SELECT n.nid FROM vault_notes n
           WHERE instr(vault_links.target_key, '/') > 0
             AND substr(n.path_key, -length(vault_links.target_key) - 1) = '/' || vault_links.target_key
           ORDER BY length(n.path), n.path LIMIT 1)
      ) ${where}`;
    if (srcNid === undefined) this.db.run(sql);
    else this.db.run(sql, srcNid);
  }

  /** Same resolution as `resolveLinks`, for one target written in `fromPath`. */
  resolve(kind: 'wiki' | 'markdown', target: string, fromPath: string): NoteRow | undefined {
    const key = targetKey(kind, target, fromPath);
    return (
      this.db.get<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE n.path_key = ?`, key) ??
      this.db.get<NoteRow>(
        `SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE n.name_key = ? ORDER BY length(n.path), n.path LIMIT 1`,
        key,
      ) ??
      (key.includes('/')
        ? this.db.get<NoteRow>(
            `SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE substr(n.path_key, -length(?) - 1) = '/' || ?
             ORDER BY length(n.path), n.path LIMIT 1`,
            key,
            key,
          )
        : undefined)
    );
  }

  /** Notes whose alias matches (case-insensitive). */
  /** The paths among `paths` whose frontmatter has the property `key` (any value). */
  pathsWithProp(paths: readonly string[], key: string): string[] {
    if (paths.length === 0) return [];
    const out: string[] = [];
    // In chunks: SQLite takes a limited number of parameters.
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      out.push(
        ...this.db
          .all<{ path: string }>(
            `SELECT n.path FROM vault_notes n JOIN vault_props p ON p.nid = n.nid
             WHERE p.key = ? AND n.path IN (${chunk.map(() => '?').join(', ')})`,
            key,
            ...chunk,
          )
          .map((r) => r.path),
      );
    }
    return out;
  }

  byAlias(alias: string): NoteRow[] {
    return this.db.all<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM vault_notes n JOIN vault_aliases a ON a.nid = n.nid WHERE a.akey = ?
       ORDER BY length(n.path)`,
      alias.toLowerCase(),
    );
  }

  /** How many files share this file name (to keep the shortest link form unique). */
  countByName(nameKey: string): number {
    return (
      this.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM vault_notes WHERE name_key = ?',
        nameKey,
      )?.c ?? 0
    );
  }

  tagsOf(nid: number): string[] {
    return this.db
      .all<{ tag: string }>(
        'SELECT tag FROM vault_tags WHERE nid = ? AND explicit = 1 ORDER BY tag',
        nid,
      )
      .map((r) => r.tag);
  }

  outlinks(nid: number): { target: string; path: string | null; embed: boolean }[] {
    return this.db
      .all<{ target_raw: string; path: string | null; is_embed: number }>(
        `SELECT l.target_raw, n.path, l.is_embed FROM vault_links l
         LEFT JOIN vault_notes n ON n.nid = l.target_nid WHERE l.src_nid = ? ORDER BY l.ord`,
        nid,
      )
      .map((r) => ({ target: r.target_raw, path: r.path, embed: r.is_embed === 1 }));
  }

  /** Paths of the notes linking to `nid`. */
  backlinkPaths(nid: number): string[] {
    return this.db
      .all<{ path: string }>(
        `SELECT DISTINCT n.path FROM vault_links l JOIN vault_notes n ON n.nid = l.src_nid
         WHERE l.target_nid = ? AND l.src_nid != ? ORDER BY n.path`,
        nid,
        nid,
      )
      .map((r) => r.path);
  }

  /**
   * What links, tags and folders say about the notes related to `nid`: a
   * direct link either way, explicit tags and link targets in common, the
   * same subfolder (not a top-level one). Only notes with a signal are listed.
   */
  relationSignals(nid: number): Map<number, RelationSignals> {
    const out = new Map<number, RelationSignals>();
    const of = (other: number): RelationSignals => {
      let s = out.get(other);
      if (!s) {
        s = { linked: false, sharedTags: 0, sharedTargets: 0, sameFolder: false };
        out.set(other, s);
      }
      return s;
    };
    for (const r of this.db.all<{ nid: number }>(
      `SELECT target_nid AS nid FROM vault_links WHERE src_nid = ? AND target_nid IS NOT NULL
       UNION SELECT src_nid FROM vault_links WHERE target_nid = ?`,
      nid,
      nid,
    )) {
      if (r.nid !== nid) of(r.nid).linked = true;
    }
    for (const r of this.db.all<{ nid: number; c: number }>(
      `SELECT b.nid, COUNT(*) AS c FROM vault_tags a
       JOIN vault_tags b ON b.tag = a.tag AND b.explicit = 1 AND b.nid != a.nid
       WHERE a.nid = ? AND a.explicit = 1 GROUP BY b.nid`,
      nid,
    )) {
      of(r.nid).sharedTags = r.c;
    }
    for (const r of this.db.all<{ nid: number; c: number }>(
      `SELECT b.src_nid AS nid, COUNT(DISTINCT b.target_nid) AS c FROM vault_links a
       JOIN vault_links b ON b.target_nid = a.target_nid AND b.src_nid != a.src_nid
       WHERE a.src_nid = ? AND a.target_nid IS NOT NULL AND a.target_nid != a.src_nid
         AND b.target_nid != b.src_nid
       GROUP BY b.src_nid`,
      nid,
    )) {
      of(r.nid).sharedTargets = r.c;
    }
    for (const r of this.db.all<{ nid: number }>(
      `SELECT b.nid FROM vault_notes a JOIN vault_notes b ON b.folder = a.folder AND b.nid != a.nid
       WHERE a.nid = ? AND instr(a.folder, '/') > 0 AND b.is_md = 1`,
      nid,
    )) {
      of(r.nid).sameFolder = true;
    }
    return out;
  }

  /** Edges for the link graph (`vault_links` tool). */
  edgesFrom(nid: number): { target_nid: number | null; target_raw: string; is_embed: number }[] {
    return this.db.all(
      'SELECT DISTINCT target_nid, target_raw, is_embed FROM vault_links WHERE src_nid = ?',
      nid,
    );
  }

  edgesTo(nid: number): { src_nid: number; is_embed: number }[] {
    return this.db.all(
      'SELECT DISTINCT src_nid, is_embed FROM vault_links WHERE target_nid = ?',
      nid,
    );
  }

  /** WHERE clause (on `vault_notes n`) of the filters of a search. */
  #filters(f: Omit<SearchFilters, 'query' | 'limit'>): {
    where: string[];
    params: (string | number)[];
  } {
    const where: string[] = ['n.is_md = 1'];
    const params: (string | number)[] = [];
    if (f.hidePrivate) {
      const hidden = this.#hidePrivate();
      where.push(hidden.sql);
      params.push(...hidden.params);
    }
    for (const tag of f.tags ?? []) {
      where.push('EXISTS (SELECT 1 FROM vault_tags t WHERE t.nid = n.nid AND t.tag = ?)');
      params.push(tag.replace(/^#/, '').toLowerCase());
    }
    if (f.folder) {
      where.push("substr(n.path, 1, length(?) + 1) = ? || '/'");
      params.push(f.folder, f.folder);
    } else {
      where.push("n.path NOT LIKE ? || '/%'");
      params.push(this.layout.templates);
    }
    if (f.type) {
      where.push('n.type = ?');
      params.push(f.type);
    }
    if (f.updatedAfter) {
      where.push('n.updated >= ?');
      params.push(f.updatedAfter);
    }
    if (f.linksTo !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM vault_links l WHERE l.src_nid = n.nid AND l.target_nid = ?)',
      );
      params.push(f.linksTo);
    }
    return { where, params };
  }

  /** Notes that pass the filters (the candidates of a semantic search). */
  filterNids(f: Omit<SearchFilters, 'query' | 'limit'>): Set<number> {
    const { where, params } = this.#filters(f);
    return new Set(
      this.db
        .all<{ nid: number }>(
          `SELECT n.nid FROM vault_notes n WHERE ${where.join(' AND ')}`,
          ...params,
        )
        .map((r) => r.nid),
    );
  }

  search(f: SearchFilters): SearchHit[] {
    const { where, params } = this.#filters(f);
    const match = f.query
      ? f.anyWords
        ? (ftsAnyQuery(f.query) ?? ftsQuery(f.query))
        : ftsQuery(f.query)
      : '';
    let rows: (NoteRow & { score: number; snippet: string })[];
    let partial = false;
    if (match) {
      // Snippets come from the text as written, never from the stem columns.
      const fts = (q: string): (NoteRow & { score: number; snippet: string })[] =>
        this.db
          .all<NoteRow & { score: number; s_body: string; s_head: string; s_title: string }>(
            `SELECT ${NOTE_COLUMNS}, bm25(vault_fts, 10.0, 8.0, 5.0, 3.0, 1.0, 6.0, 0.8) AS score,
               snippet(vault_fts, 4, '**', '**', '…', 16) AS s_body,
               snippet(vault_fts, 3, '**', '**', '…', 16) AS s_head,
               snippet(vault_fts, 0, '**', '**', '…', 16) AS s_title
             FROM vault_fts JOIN vault_notes n ON n.nid = vault_fts.rowid
             WHERE vault_fts MATCH ? AND ${where.join(' AND ')}
             ORDER BY score LIMIT ?`,
            q,
            ...params,
            f.limit,
          )
          .map(({ s_body, s_head, s_title, ...r }) => ({
            ...r,
            snippet:
              [s_body, s_head, s_title].find((s) => s.includes('**')) ??
              (s_body.trim() || r.summary),
          }));
      rows = fts(match);
      partial = !!f.anyWords && rows.length > 0;
      // Every word together found nothing: try any of them (ranked by BM25).
      const any = rows.length === 0 && f.query && !f.anyWords ? ftsAnyQuery(f.query) : null;
      if (any) {
        rows = fts(any);
        partial = rows.length > 0;
      }
    } else {
      rows = this.db.all(
        `SELECT ${NOTE_COLUMNS}, 0 AS score, n.summary AS snippet FROM vault_notes n
         WHERE ${where.join(' AND ')} ORDER BY n.updated DESC, n.path LIMIT ?`,
        ...params,
        f.limit,
      );
    }
    return rows.map((r) => ({
      path: r.path,
      title: r.title,
      type: r.type,
      updated: r.updated,
      score: Math.round(-r.score * 1000) / 1000,
      snippet: r.snippet.replace(/\s+/g, ' ').trim(),
      tags: this.tagsOf(r.nid),
      ...(partial ? { partial: true as const } : {}),
    }));
  }

  tags(prefix: string | undefined, hidePrivate: boolean): { tag: string; count: number }[] {
    const p = (prefix ?? '').replace(/^#/, '').toLowerCase();
    const hidden = hidePrivate ? this.#hidePrivate() : null;
    return this.db.all<{ tag: string; count: number }>(
      `SELECT t.tag, COUNT(*) AS count FROM vault_tags t JOIN vault_notes n ON n.nid = t.nid
       WHERE substr(t.tag, 1, length(?)) = ?
         ${hidden ? `AND ${hidden.sql}` : ''}
       GROUP BY t.tag ORDER BY count DESC, t.tag`,
      p,
      p,
      ...(hidden?.params ?? []),
    );
  }

  /**
   * The clause (on `vault_notes n`) that hides the private notes: `private: true`, the private
   * folder of the vault's layout and of the other one (D-154: a vault with traces of both, or a
   * rewritten record, never shows `Privato/` or `Private/`). LIKE ignores ASCII case, as the
   * disks that open `privato/` as `Privato/`.
   */
  #hidePrivate(): { sql: string; params: string[] } {
    const folders = [...new Set([this.layout.private, ...PRIVATE_FOLDERS])];
    return {
      sql: ['n.private = 0', ...folders.map(() => "n.path NOT LIKE ? || '/%'")].join(' AND '),
      params: folders,
    };
  }

  /** Explicit tags of every note, in one query (the UI list of notes). */
  allTags(): { nid: number; tag: string }[] {
    return this.db.all('SELECT nid, tag FROM vault_tags WHERE explicit = 1 ORDER BY tag');
  }

  /** Resolved links between two different notes, one row per pair (the UI graph). */
  allEdges(): { src_nid: number; target_nid: number; is_embed: number }[] {
    return this.db.all(
      `SELECT src_nid, target_nid, MAX(is_embed) AS is_embed FROM vault_links
       WHERE target_nid IS NOT NULL AND target_nid != src_nid GROUP BY src_nid, target_nid`,
    );
  }

  /** Files in a folder ("" = vault root). */
  list(folder: string, recursive: boolean): NoteRow[] {
    const rows =
      folder === ''
        ? this.db.all<NoteRow>(`SELECT ${NOTE_COLUMNS} FROM vault_notes n`)
        : this.db.all<NoteRow>(
            `SELECT ${NOTE_COLUMNS} FROM vault_notes n WHERE substr(n.path, 1, length(?) + 1) = ? || '/'`,
            folder,
            folder,
          );
    if (recursive) return rows;
    const depth = folder === '' ? 0 : folder.split('/').length;
    return rows.filter((r) => r.path.split('/').length === depth + 1);
  }

  // --- actions -------------------------------------------------------------

  recordAction(a: {
    id: string;
    agent: string;
    tool: string;
    params: unknown;
    paths: readonly string[];
    commit: string | null;
  }): void {
    this.db.run(
      `INSERT INTO vault_actions (id, ts, agent, tool, params_json, paths_json, commit_oid, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'done')`,
      a.id,
      Date.now(),
      a.agent,
      a.tool,
      JSON.stringify(a.params ?? null),
      JSON.stringify(a.paths),
      a.commit,
    );
  }

  getAction(id: string):
    | {
        id: string;
        agent: string;
        tool: string;
        paths: string[];
        commit: string | null;
        status: string;
      }
    | undefined {
    const row = this.db.get<{
      id: string;
      agent: string;
      tool: string;
      paths_json: string;
      commit_oid: string | null;
      status: string;
    }>(
      'SELECT id, agent, tool, paths_json, commit_oid, status FROM vault_actions WHERE id = ?',
      id,
    );
    if (!row) return undefined;
    return {
      id: row.id,
      agent: row.agent,
      tool: row.tool,
      paths: JSON.parse(row.paths_json) as string[],
      commit: row.commit_oid,
      status: row.status,
    };
  }

  setActionStatus(id: string, status: string): void {
    this.db.run('UPDATE vault_actions SET status = ? WHERE id = ?', status, id);
  }

  // --- proposals -----------------------------------------------------------

  addProposal(p: Omit<ProposalRecord, 'status'>): void {
    this.db.run(
      `INSERT INTO vault_proposals (id, ts, path, author, target_path, base_hash, ops_json, ops_hash, body_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      p.id,
      Date.now(),
      p.path,
      p.author,
      p.target_path,
      p.base_hash,
      p.ops_json,
      p.ops_hash,
      p.body_hash,
    );
  }

  getProposal(id: string): ProposalRecord | undefined {
    return this.db.get<ProposalRecord>(
      `SELECT id, path, author, target_path, base_hash, ops_json, ops_hash, body_hash, status
       FROM vault_proposals WHERE id = ?`,
      id,
    );
  }

  setProposalStatus(id: string, status: string): void {
    this.db.run('UPDATE vault_proposals SET status = ? WHERE id = ?', status, id);
  }
}

/** A proposal as recorded by `vault_propose` (the source of truth for `vault_apply_proposal`). */
export interface ProposalRecord {
  id: string;
  /** Proposal note in `Inbox/`. */
  path: string;
  /** Agent that made the proposal. */
  author: string;
  target_path: string;
  /** Hash of the target note the operations were computed on. */
  base_hash: string;
  ops_json: string;
  ops_hash: string;
  /** Hash of the proposal note body (diff and operations shown to the reviewer). */
  body_hash: string;
  status: string;
}

/** Key a link target resolves by (relative Markdown links are made vault-absolute). */
export function targetKey(kind: 'wiki' | 'markdown', target: string, fromPath: string): string {
  if (kind === 'markdown' && (target.startsWith('./') || target.startsWith('../'))) {
    const joined = posix.normalize(posix.join(posix.dirname(fromPath), target));
    return linkKey(joined.replace(/^(\.\.\/)+/, ''));
  }
  return linkKey(target.replace(/^\/+/, ''));
}
