import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  DOCUMENT_KINDS,
  ulid,
  type FileKind,
  type FileListQuery,
  type FileMeta,
  type FileSource,
} from '@monsters/shared';
import type { Db } from '../db/sqlite.ts';
import type { Migration } from '../db/migrations.ts';
import { FILES_DIR } from '@monsters/vault';
import {
  detectType,
  extensionOf,
  imageSize,
  isWebp,
  unsupportedMessage,
  type DetectedType,
} from './detect.ts';
import { extractTextIsolated, type ExtractedText, type ExtractOptions } from './extract-run.ts';

/*
 * The files of the user and of the monsters (D-075). The bytes live in the
 * notes folder under `File/<yyyy-mm>/<name>` (Obsidian sees them; the vault's
 * git, index and tools do not: `File/.gitignore` and the vault's own rule),
 * thumbnails in `File/.thumbs/`, the metadata and the extracted text in the
 * core's database. URLs name files by id only: no name from outside ever
 * becomes a path without being cleaned first, and every path is checked to
 * stay inside `File/`.
 */

/** Folder of the files inside the notes folder. */
export { FILES_DIR };
const THUMBS_DIR = '.thumbs';
/** Name used when the user already has a folder `File/` of their own. */
export const FILES_DIR_ALT = 'File di Monsters';
/** The file that says a folder is the files folder of Monsters (never a folder of the user). */
export const FILES_MARKER = '.monsters';
const MARKER_TEXT =
  'Questa cartella è di Monsters: qui ci sono gli allegati, gli screenshot e le pagine dei mostri.\n';

/**
 * The folder of the files of Monsters in the notes folder (D-075): the one
 * that has our marker; else `File/` if it does not exist yet; else (a `File/`
 * of the user, full of their notes) `File di Monsters/`, `File di Monsters 2/`…
 * A folder of the user is never taken, so its notes never leave the vault.
 */
export function filesDirFor(notes: string): string {
  const candidates = [FILES_DIR, FILES_DIR_ALT];
  for (let n = 2; n <= 20; n++) candidates.push(`${FILES_DIR_ALT} ${n}`);
  for (const name of candidates) {
    const dir = join(notes, name);
    if (!existsSync(dir) || existsSync(join(dir, FILES_MARKER))) return name;
  }
  return `${FILES_DIR_ALT} ${Date.now()}`;
}

export const FILES_GITIGNORE =
  '# Monsters: i file allegati e creati dai mostri non entrano nella cronologia delle note\n*\n';

export const filesMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'files',
    up: `
      CREATE TABLE files (
        id             TEXT    PRIMARY KEY,
        name           TEXT    NOT NULL,
        path           TEXT    NOT NULL UNIQUE,
        mime           TEXT    NOT NULL,
        size           INTEGER NOT NULL,
        kind           TEXT    NOT NULL,
        source         TEXT    NOT NULL CHECK (source IN ('user', 'agent', 'tool')),
        agent          TEXT,
        run_id         TEXT,
        message_id     TEXT,
        title          TEXT,
        tool           TEXT,
        has_thumb      INTEGER NOT NULL,
        text           TEXT,
        text_truncated INTEGER NOT NULL DEFAULT 0,
        width          INTEGER,
        height         INTEGER,
        sha256         TEXT    NOT NULL,
        created_at     INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX files_created ON files (created_at);
      CREATE INDEX files_name ON files (name COLLATE NOCASE);
    `,
  },
  {
    // D-085: an HTML page of a run that had read third-party text, served without scripts.
    version: 2,
    name: 'files_inert',
    up: `ALTER TABLE files ADD COLUMN inert INTEGER NOT NULL DEFAULT 0;`,
  },
];

export type FileErrorCode = 'unsupported_type' | 'file_too_large' | 'unknown_file' | 'invalid_name';

export class FileError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.name = 'FileError';
    this.code = code;
  }
}

export interface SaveFileInput {
  bytes: Uint8Array;
  /** Name given by the user or the monster: cleaned, never used as it is. */
  name: string;
  source: FileSource;
  agent?: string | undefined;
  runId?: string | undefined;
  messageId?: string | undefined;
  /** WebP thumbnail made by the browser (checked here). */
  thumb?: Uint8Array | undefined;
  /** HTML is accepted only from Monsters itself (`artifact_create`). */
  allowHtml?: boolean;
  /** An HTML page served without scripts until the user turns them on (D-085). */
  inert?: boolean;
  title?: string | undefined;
  tool?: string | undefined;
  maxBytes: number;
}

interface Row {
  id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  kind: string;
  source: string;
  agent: string | null;
  run_id: string | null;
  message_id: string | null;
  title: string | null;
  tool: string | null;
  has_thumb: number;
  inert: number;
  text: string | null;
  text_truncated: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

const COLUMNS =
  'id, name, path, mime, size, kind, source, agent, run_id, message_id, title, tool, has_thumb, inert, ' +
  'text IS NOT NULL AS has_text, width, height, created_at';

type ListRow = Omit<Row, 'text' | 'text_truncated'> & { has_text: number };

function metaOf(r: ListRow): FileMeta {
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: r.size,
    kind: r.kind as FileKind,
    source: r.source as FileSource,
    ...(r.agent ? { agent: r.agent } : {}),
    ...(r.run_id ? { runId: r.run_id } : {}),
    ...(r.title ? { title: r.title } : {}),
    ...(r.message_id ? { messageId: r.message_id } : {}),
    path: r.path,
    hasThumb: r.has_thumb === 1,
    hasText: r.has_text === 1,
    ...(r.inert === 1 ? { inert: true } : {}),
    ...(r.width ? { width: r.width } : {}),
    ...(r.height ? { height: r.height } : {}),
    createdAt: r.created_at,
  };
}

/** Characters of text before the words found, and in all, of a search's snippet (D-086). */
const SNIPPET_BEFORE = 60;
const SNIPPET_CHARS = 200;

/**
 * A snippet on one line, cut at words, with "…" where the text goes on
 * (`before`: it starts inside the text; `after`: the text goes on after it).
 */
export function snippetOf(raw: string, before: boolean, after: boolean): string {
  let text = raw.replace(/\s+/g, ' ');
  if (before) {
    const space = text.indexOf(' ');
    if (space >= 0 && space < 20) text = text.slice(space + 1);
  }
  if (after) {
    const space = text.lastIndexOf(' ');
    if (space > text.length - 20) text = text.slice(0, space);
  }
  text = text.trim();
  if (!text) return '';
  return `${before ? '…' : ''}${text}${after ? '…' : ''}`;
}

/** Characters no file system or Obsidian accepts in a name, and control characters (C0 and C1). */
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f<>:"/\\|?*#^[\]%]/g;
/**
 * Characters that change how a name reads without being seen (review of
 * 16/10): bidi controls ("fattura‮fdp.exe" reads "fatturaexe.pdf"),
 * zero-width characters, the BOM, the soft hyphen.
 */
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;
/** Device names of Windows: also with an extension (`CON.x.txt`) and the superscript digits. */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MAX_NAME = 100;
/**
 * Most bytes of a name in UTF-8, the unit of the file systems (255 on most),
 * with room for the ` (12)` of a name already taken.
 */
export const MAX_NAME_BYTES = 200;
const SUFFIX_ROOM = 8;

const utf8Bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/** The longest start of `text` within `max` UTF-8 bytes, never cutting a character in two. */
function clipBytes(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const n = utf8Bytes(ch);
    if (bytes + n > max) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** The part of a name Windows reads as a device: what comes before the first dot. */
const isReserved = (base: string) => RESERVED.test(base.split('.')[0]!.trim());

/**
 * A file name that is safe on every system: no folders, no hidden name, no
 * reserved device name (`CON`, `CON.x`), no invisible characters, at most 100
 * characters and `MAX_NAME_BYTES` bytes with the suffix of a taken name, with
 * the extension of the type the bytes really have.
 */
export function cleanName(raw: string, ext: string): string {
  const last = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  let base = last.normalize('NFC').replace(INVISIBLE, '').replace(BAD_CHARS, ' ');
  const own = extensionOf(base);
  if (own) base = base.slice(0, -(own.length + 1));
  base = base.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  base = clipBytes(
    [...base].slice(0, MAX_NAME - ext.length - 1).join(''),
    MAX_NAME_BYTES - SUFFIX_ROOM - ext.length - 1,
  )
    .replace(/[\s.]+$/, '')
    .trim();
  if (!base) base = 'file';
  else if (isReserved(base)) base = base.replace(/^[^.]*/, (device) => `${device.trim()} file`);
  // The user's spelling of the extension when it is the same type (jpeg/jpg).
  const keep =
    own === ext || (ext === 'jpg' && own === 'jpeg') || (ext === 'md' && own === 'markdown');
  return `${base}.${keep && own !== 'markdown' ? own : ext}`;
}

const month = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export interface FileStoreOptions {
  db: Db;
  /** The notes folder. */
  root: string;
  /** Name of the files folder in it (`filesDirFor`). Default `File`. */
  dirName?: string;
  now?: () => number;
  /** How the text of a document is extracted (default: in a worker, `extract-run.ts`). */
  extract?: (
    bytes: Uint8Array,
    ext: string,
    options?: ExtractOptions,
  ) => Promise<ExtractedText | null>;
  /** The text of a file is ready after `save` answered (`hasText` is true now). */
  onText?: (meta: FileMeta) => void;
}

export class FileStore {
  readonly #db: Db;
  readonly root: string;
  /** Name of the files folder in the notes folder (`File`, or `File di Monsters`). */
  readonly dirName: string;
  readonly dir: string;
  readonly #now: () => number;
  readonly #extract: NonNullable<FileStoreOptions['extract']>;
  #onText: FileStoreOptions['onText'];
  /** Extractions still running, by file id. */
  readonly #pending = new Map<string, Promise<void>>();

  constructor(options: FileStoreOptions) {
    this.#db = options.db;
    this.root = resolve(options.root);
    this.dirName = options.dirName ?? FILES_DIR;
    this.dir = join(this.root, this.dirName);
    this.#now = options.now ?? Date.now;
    this.#extract = options.extract ?? extractTextIsolated;
    this.#onText = options.onText;
  }

  /** Who hears that the text of a file is ready (the hub logs a `file` event). */
  set onText(fn: FileStoreOptions['onText']) {
    this.#onText = fn;
  }

  /** `File/` with its `.gitignore`: created on the first file, rewritten if it went missing. */
  ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
    const ignore = join(this.dir, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, FILES_GITIGNORE);
    const marker = join(this.dir, FILES_MARKER);
    if (!existsSync(marker)) writeFileSync(marker, MARKER_TEXT);
  }

  /** An absolute path inside `File/`, or an error: nothing outside it is ever read or written. */
  #inside(rel: string): string {
    const abs = resolve(this.root, rel);
    const r = relative(this.dir, abs);
    if (
      r === '' ||
      r.startsWith('..') ||
      r.split(sep).includes('..') ||
      resolve(this.dir, r) !== abs
    ) {
      throw new FileError('invalid_name', 'path outside the files folder');
    }
    return abs;
  }

  /**
   * The absolute path of a file (for the harness, which reads it itself), or
   * null when the file is not in the files folder any more (its marker was
   * removed and the folder changed: the old `File/…` path is the user's now).
   */
  absPath(meta: Pick<FileMeta, 'path'>): string | null {
    try {
      return this.#inside(meta.path);
    } catch (err) {
      if (err instanceof FileError) return null;
      throw err;
    }
  }

  #uniqueName(name: string, folder: string): string {
    const ext = extensionOf(name);
    const base = ext ? name.slice(0, -(ext.length + 1)) : name;
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${base} (${n})${ext ? `.${ext}` : ''}`;
      const taken =
        this.#db.get('SELECT 1 FROM files WHERE name = ? COLLATE NOCASE', candidate) !==
          undefined || onDisk(join(this.dir, folder, candidate));
      if (!taken) return candidate;
    }
  }

  /** Type of the bytes, or the reason they are refused. */
  detect(bytes: Uint8Array, name: string, allowHtml = false): DetectedType {
    const found = detectType(bytes, name, { allowHtml });
    if ('unsupported' in found)
      throw new FileError('unsupported_type', unsupportedMessage(found.unsupported));
    return found;
  }

  // Async so that a refused file is a rejection; the text comes later (`ready`).
  // eslint-disable-next-line @typescript-eslint/require-await
  async save(input: SaveFileInput): Promise<FileMeta> {
    if (input.bytes.byteLength > input.maxBytes) {
      throw new FileError('file_too_large', 'Il file è troppo grande.');
    }
    if (input.bytes.byteLength === 0) throw new FileError('unsupported_type', 'Il file è vuoto.');
    const type = this.detect(input.bytes, input.name, input.allowHtml === true);
    const meta = this.#write(input, type);
    // Text for the models that cannot read the original: after the file is safe on disk, in a
    // worker with a time limit (D-085), without holding the answer. `ready` waits for it.
    if (type.kind !== 'image') {
      const job = this.#extract(input.bytes, type.ext)
        .catch(() => null)
        .then((extracted) => {
          if (!extracted) return;
          try {
            if (!this.get(meta.id)) return;
            this.#db.run(
              'UPDATE files SET text = ?, text_truncated = ? WHERE id = ?',
              extracted.text,
              extracted.truncated ? 1 : 0,
              meta.id,
            );
          } catch {
            // The core closed meanwhile: the file simply has no text.
            return;
          }
          const now = this.get(meta.id);
          try {
            if (now) this.#onText?.(now);
          } catch {
            // The listener writes to the log, which may be closed: the text is saved all the same.
          }
        })
        .finally(() => this.#pending.delete(meta.id));
      this.#pending.set(meta.id, job);
    }
    return meta;
  }

  /** Waits for the text of these files (an extraction still running), at most its time limit. */
  async ready(ids: readonly string[]): Promise<void> {
    await Promise.all(
      ids.map((id) => this.#pending.get(id)).filter((p): p is Promise<void> => p !== undefined),
    );
  }

  /** The user turned on the scripts of an HTML page (D-085). */
  allowScripts(id: string): FileMeta | undefined {
    this.#db.run('UPDATE files SET inert = 0 WHERE id = ?', id);
    return this.get(id);
  }

  /** Bytes of all the files (the size of the files folder, roughly). */
  usage(): number {
    return this.#db.get<{ n: number | null }>('SELECT SUM(size) AS n FROM files')?.n ?? 0;
  }

  /** Images a tool saved in one run. */
  toolImagesOf(runId: string): number {
    return (
      this.#db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM files WHERE run_id = ? AND source = 'tool'",
        runId,
      )?.n ?? 0
    );
  }

  /** Synchronous save of an image a tool returned (no text to extract). */
  saveImageSync(input: SaveFileInput): FileMeta {
    if (input.bytes.byteLength > input.maxBytes) {
      throw new FileError('file_too_large', 'Il file è troppo grande.');
    }
    const type = this.detect(input.bytes, input.name);
    if (type.kind !== 'image') throw new FileError('unsupported_type', 'not an image');
    return this.#write(input, type);
  }

  /** Writes the bytes under the first free name of the folder; returns that name. */
  #claim(input: SaveFileInput, type: DetectedType, folder: string): { name: string; rel: string } {
    for (let attempt = 0; ; attempt++) {
      const name = this.#uniqueName(cleanName(input.name, type.ext), folder);
      const rel = `${this.dirName}/${folder}/${name}`;
      try {
        writeFileSync(this.#inside(rel), input.bytes, { flag: 'wx' });
        return { name, rel };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 20) throw err;
      }
    }
  }

  #write(input: SaveFileInput, type: DetectedType): FileMeta {
    this.ensureDir();
    const now = this.#now();
    const folder = month(now);
    mkdirSync(join(this.dir, folder), { recursive: true });
    // `wx`: never over a file that is already there; a name taken meanwhile (or a dangling
    // link, which `existsSync` doesn't see) moves on to the next free name.
    const { name, rel } = this.#claim(input, type, folder);
    const id = ulid();
    const inert = input.inert === true && type.kind === 'html';
    let hasThumb = false;
    if (type.kind === 'image' && input.thumb && isWebp(input.thumb)) {
      mkdirSync(join(this.dir, THUMBS_DIR), { recursive: true });
      writeFileSync(this.#thumbAbs(id), input.thumb);
      hasThumb = true;
    }
    const size = type.kind === 'image' ? imageSize(input.bytes, type.mime) : null;
    const sha = createHash('sha256').update(input.bytes).digest('hex');
    try {
      this.#db.run(
        `INSERT INTO files (id, name, path, mime, size, kind, source, agent, run_id, message_id, title, tool,
           has_thumb, inert, width, height, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        name,
        rel,
        type.mime,
        input.bytes.byteLength,
        type.kind,
        input.source,
        input.agent ?? null,
        input.runId ?? null,
        input.messageId ?? null,
        input.title ?? null,
        input.tool ?? null,
        hasThumb ? 1 : 0,
        inert ? 1 : 0,
        size?.width ?? null,
        size?.height ?? null,
        sha,
        now,
      );
    } catch (err) {
      rmSync(this.#inside(rel), { force: true });
      if (hasThumb) rmSync(this.#thumbAbs(id), { force: true });
      throw err;
    }
    return this.get(id)!;
  }

  #thumbAbs(id: string): string {
    if (!/^[0-9A-Z]{26}$/.test(id)) throw new FileError('unknown_file', 'unknown file');
    return join(this.dir, THUMBS_DIR, `${id}.webp`);
  }

  get(id: string): FileMeta | undefined {
    const r = this.#db.get<ListRow>(`SELECT ${COLUMNS} FROM files WHERE id = ?`, id);
    return r ? metaOf(r) : undefined;
  }

  /** Several files by id, in the order given; unknown ids are left out. */
  many(ids: readonly string[]): FileMeta[] {
    return ids.map((id) => this.get(id)).filter((m): m is FileMeta => m !== undefined);
  }

  /**
   * Files by the filters of the File view. `q` matches the name or the
   * extracted text (D-086: a LIKE on the stored text, at most 200,000
   * characters a file, no index of its own; case-insensitive for ASCII, like
   * the name): a file found by its text and not by its name carries the
   * `snippet` around the words. `ids` gives those files only (the attachments
   * of a chat), the deleted ones absent.
   */
  list(q: FileListQuery = {}): FileMeta[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.ids) {
      const ids = q.ids.split(',').slice(0, 100);
      where.push(`id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    if (q.kind === 'documents') {
      where.push(`kind IN (${DOCUMENT_KINDS.map(() => '?').join(', ')})`);
      params.push(...DOCUMENT_KINDS);
    } else if (q.kind) {
      where.push('kind = ?');
      params.push(q.kind);
    }
    if (q.source === 'monsters') where.push("source IN ('agent', 'tool')");
    else if (q.source) {
      where.push('source = ?');
      params.push(q.source);
    }
    if (q.agent) {
      where.push('agent = ?');
      params.push(q.agent);
    }
    const term = q.q?.trim() ?? '';
    let columns = COLUMNS;
    const head: string[] = [];
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR (text IS NOT NULL AND text LIKE ? ESCAPE '\\'))");
      params.push(like, like);
      // The piece of text only when the name did not match: where the words are, some before.
      const from = `max(1, instr(lower(text), lower(?)) - ${SNIPPET_BEFORE})`;
      columns +=
        `, CASE WHEN name LIKE ? ESCAPE '\\' THEN NULL ELSE substr(text, ${from}, ${SNIPPET_CHARS}) END AS snippet` +
        `, ${from} AS snippet_from`;
      head.push(like, term, term);
    }
    if (q.before !== undefined) {
      where.push('created_at < ?');
      params.push(q.before);
    }
    const sql =
      `SELECT ${columns} FROM files${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ` +
      'ORDER BY created_at DESC, id DESC LIMIT ?';
    return this.#db
      .all<ListRow & { snippet?: string | null; snippet_from?: number | null }>(
        sql,
        ...head,
        ...params,
        q.limit ?? 200,
      )
      .map((r) => {
        const meta = metaOf(r);
        if (!r.snippet) return meta;
        const snippet = snippetOf(
          r.snippet,
          (r.snippet_from ?? 1) > 1,
          r.snippet.length >= SNIPPET_CHARS,
        );
        return snippet ? { ...meta, snippet } : meta;
      });
  }

  /** The bytes of a file; null when it is gone from the disk. */
  read(meta: Pick<FileMeta, 'path'>): Buffer | null {
    try {
      return readFileSync(this.#inside(meta.path));
    } catch {
      return null;
    }
  }

  thumb(id: string): Buffer | null {
    const meta = this.get(id);
    if (!meta?.hasThumb) return null;
    try {
      return readFileSync(this.#thumbAbs(id));
    } catch {
      return null;
    }
  }

  text(id: string): { text: string; truncated: boolean } | null {
    const r = this.#db.get<{ text: string | null; text_truncated: number }>(
      'SELECT text, text_truncated FROM files WHERE id = ?',
      id,
    );
    return r?.text ? { text: r.text, truncated: r.text_truncated === 1 } : null;
  }

  /** The chat message that carried the files (set when the message is sent). */
  linkMessage(ids: readonly string[], messageId: string, agent: string): void {
    for (const id of ids) {
      this.#db.run(
        'UPDATE files SET message_id = COALESCE(message_id, ?), agent = COALESCE(agent, ?) WHERE id = ?',
        messageId,
        agent,
        id,
      );
    }
  }

  /**
   * Removes the file, its thumbnail and its metadata. False when there was no
   * such file. A file whose path is not in the files folder any more (the
   * marker was removed, the folder changed) loses only its metadata: what is
   * at the old path is the user's now.
   */
  delete(id: string): boolean {
    const meta = this.get(id);
    if (!meta) return false;
    const abs = this.absPath(meta);
    if (abs) rmSync(abs, { force: true });
    if (meta.hasThumb) rmSync(this.#thumbAbs(id), { force: true });
    this.#db.run('DELETE FROM files WHERE id = ?', id);
    return true;
  }
}

/** Whether something sits at this path, a dangling link included (unlike `existsSync`). */
function onDisk(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
