import { randomBytes } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, posix, join, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { migrate, openDb, type Db } from '@monsters/db';
import {
  ToolError,
  VAULT_LAYOUT_RECORD,
  agentMemoryPath,
  inAnyPrivateFolder,
  ulid,
  vaultLayoutOf,
  type ToolEmittedEvent,
  type VaultLayout,
  type VaultLayoutId,
} from '@monsters/shared';
import { watch, type FSWatcher } from 'chokidar';
import { lineDiff } from './diff.ts';
import {
  atomicWrite,
  contentHash,
  existsFile,
  gitBlobOid,
  isNotFound,
  readIfExists,
  renameWithRetry,
  resolveInVault,
  throwIfAborted,
} from './fsutil.ts';
import { IsomorphicVcs } from './git/isomorphic.ts';
import { SystemVcs, systemGitAvailable } from './git/system.ts';
import {
  TRAILER_ACTION,
  TRAILER_AGENT,
  parseTrailers,
  type CommitInfo,
  type GitAuthor,
  type VaultVcs,
  type VcsKind,
} from './git/vcs.ts';
import { vaultMigrations } from './index-db/schema.ts';
import {
  VaultIndex,
  localIso,
  type NoteRow,
  type ProposalRecord,
  type SearchFilters,
  type SearchHit,
} from './index-db/vault-index.ts';
import { applyOps, type EditOp } from './markdown/edit.ts';
import {
  buildFrontmatter,
  readFrontmatter,
  updateFrontmatter,
  type Props,
} from './markdown/frontmatter.ts';
import { parseNote, type ParsedNote } from './markdown/parse.ts';
import { findFrontmatter, findSection, scanMarkdown } from './markdown/scan.ts';
import { KeyedMutex, SerialQueue } from './concurrency.ts';
import {
  assertValidNewPath,
  foldPath,
  hasExtension,
  isHidden,
  isInside,
  isMarkdown,
  isFilesPath,
  isSystemPath,
  isTmpPath,
  linkKey,
  TMP_SUFFIX,
  normalizeNotePath,
  normalizePath,
  titleOf,
} from './paths.ts';
import { detectVaultLayout, writeVaultLayoutRecord } from './layout.ts';
import { VaultPermissions, capitalize, type VaultPermissionsConfig } from './permissions.ts';
import { VAULT_GITIGNORE, memoryNote, scaffoldFiles, vaultFolders } from './scaffold.ts';
import { scaffoldStrings } from './scaffold.strings.ts';
import { EditOpsSchema } from './schemas.ts';
import type { EmbedderLoader } from './semantic/embedder.ts';
import { RELATED_LIMIT, pickRelated, relationBonus } from './semantic/related.ts';
import { rrfFuse } from './semantic/rrf.ts';
import { currentVaultScope } from './scope.ts';
import { vaultStrings } from './vault.strings.ts';
import {
  SemanticIndex,
  type SemanticIndexOptions,
  type SemanticStatus,
} from './semantic/semantic-index.ts';

/** How long `watch()` waits for the watcher to deliver events, and how often it probes. */
const WATCH_LIVE_TIMEOUT_MS = 3000;
const WATCH_PROBE_INTERVAL_MS = 100;
const WATCH_PROBE_PREFIX = '.monsters-watch-';

/** Something the vault could not do but that does not stop it (logged by the core). */
export interface VaultWarning {
  /**
   * `vault_unreadable`: a folder or file without permission, skipped. `vault_watch_error`:
   * the watcher failed (limit of watched files…).
   */
  code: 'vault_unreadable' | 'vault_watch_error';
  message: string;
  path?: string;
}

function errnoOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/** No permission on a folder or file of the vault: skipped, never fatal. */
function isPermissionError(err: unknown): boolean {
  const code = errnoOf(err);
  return code === 'EACCES' || code === 'EPERM';
}

/** Who performs a vault operation. Tools build it from their `ToolContext`. */
export interface VaultActor {
  /** Agent id; `user` for the UI. */
  agentId: string;
  /** Kill switch: an aborted signal stops the operation before anything is written. */
  signal?: AbortSignal | undefined;
  /** Receives the `vault_change` event of every write (the runtime appends it to the action log). */
  emit?: ((event: ToolEmittedEvent) => void) | undefined;
}

/** A change made outside Monsters (Obsidian, editor, sync) seen by the watcher. */
export interface ExternalChange {
  kind: 'add' | 'change' | 'unlink';
  path: string;
}

export type SearchMode = 'text' | 'semantic' | 'hybrid';

export interface SearchInput {
  query?: string | undefined;
  /** Default `hybrid` (full-text + vectors, RRF); without vectors every mode is full-text. */
  mode?: SearchMode | 'auto' | undefined;
  /** Notes similar in meaning to this note (path or title), instead of a query. */
  related_to?: string | undefined;
  tags?: string[] | undefined;
  folder?: string | undefined;
  type?: string | undefined;
  updated_after?: string | undefined;
  links_to?: string | undefined;
  limit?: number | undefined;
}

/** How many hits each list contributes to the fusion. */
const FUSION_DEPTH = 30;
/**
 * Weight in the fusion of full-text hits that match only some of the words
 * (typical of a question): none. With any weight a note sharing one common
 * word with the question and loosely related in meaning outranks the note
 * nearest in meaning (measured on 200 notes: 9/10 questions in the top 3 by
 * meaning, 6/10 with a weight of 0.3).
 */
const PARTIAL_TEXT_WEIGHT = 0;
const SNIPPET_CHARS = 220;

export interface VaultOpenOptions {
  /** Folder of the vault. */
  root: string;
  /** SQLite index file, outside the vault (e.g. `~/.monsters/index/<id>.sqlite`). Default: in memory. */
  indexPath?: string;
  /** An already open database (takes precedence over `indexPath`; not closed by `close()`). */
  db?: Db;
  /** Git backend: isomorphic-git (default), system git, `auto` (system if installed), or none. */
  git?: VcsKind | false;
  /** Opening a vault without `.git`: initialize it (writes `.gitignore` and a first commit). */
  initGit?: boolean;
  permissions?: VaultPermissionsConfig;
  onExternalChange?: (change: ExternalChange) => void;
  /** Folders or files skipped for lack of permission, watcher failures. Default: `console.warn`. */
  onWarning?: (warning: VaultWarning) => void;
  /**
   * Semantic search: loads the embedding model at first use (e.g.
   * `() => WorkerEmbedder.create({ cacheDir })`). Without it search is full-text only.
   */
  embedder?: EmbedderLoader;
  semanticOptions?: SemanticIndexOptions;
  /**
   * Top-level folder of the files of Monsters (D-075): never indexed, listed,
   * committed or written as notes. Default: none.
   */
  filesDir?: string | null;
  /**
   * The names of the vault's folders and notes (D-154). Opening: the vault's own
   * (`detectVaultLayout`: its record, else what it has), this only for a vault with neither,
   * else Italian. Creating: default Italian (the core passes the app's language); it is
   * recorded in the new vault.
   */
  layout?: VaultLayoutId;
}

export interface VaultCreateOptions extends VaultOpenOptions {
  /** Display name of the orchestrator (its area is `Agenti/<name>/` in the Italian layout). */
  orchestratorName?: string;
  /** Display names of the sub-agents that get an area at creation. */
  agentNames?: string[];
}

export interface WriteResult {
  action_id: string;
  /** Commit recording the action; null when the vault has no git. */
  commit: string | null;
  path: string;
  hash: string;
}

/** A later commit that keeps `vault_undo` from running without `force`. */
export interface LaterChange {
  commit: string;
  /** Null for snapshots of edits made outside Monsters. */
  action_id: string | null;
  agent: string;
  /** First line of the commit message (tool and paths). */
  message: string;
  files: string[];
}

interface FileChange {
  path: string;
  /** New content, or null to remove the file. */
  content: string | Uint8Array | null;
  /** When removing: move the file here instead of deleting it (the Obsidian trash). */
  trashTo?: string;
}

interface ActionPlan<R> {
  changes: FileChange[];
  /** First line of the commit message (after `<tool>: `). */
  summary: string;
  body?: string;
  vaultChange: {
    action: 'create' | 'edit' | 'move' | 'delete' | 'restore' | 'undo' | 'propose';
    path: string;
    fromPath?: string;
    /** For `undo`: the action undone. */
    undoneActionId?: string;
  };
  result: (base: { action_id: string; commit: string | null }) => R;
  /** Runs after the commit (index updated). */
  after?: () => Promise<void> | void;
}

interface WriteStep {
  change: FileChange;
  /** Resolved absolute path (checked to be inside the vault). */
  abs: string;
  trashAbs: string | null;
  /** Content before the action, to put back if the commit fails. */
  previous: Buffer | null;
  done: boolean;
}

interface FileText {
  bytes: Buffer;
  text: string;
  hash: string;
}

const USER_AUTHOR: GitAuthor = { name: 'user', email: 'user@monsters.local' };
const SYSTEM_AUTHOR: GitAuthor = { name: 'monsters', email: 'system@monsters.local' };
const CONTENT_CACHE_SIZE = 200;
const HISTORY_SCAN_DEPTH = 2000;
const TRASH = '.trash';

function authorFor(agentId: string): GitAuthor {
  return agentId === 'user' ? USER_AUTHOR : { name: agentId, email: `${agentId}@monsters.local` };
}

function nowIso(): string {
  return localIso(Date.now());
}

function ensureNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Recursively lists the files of the vault (hidden folders and temporary files
 * excluded). Symbolic links are neither followed nor listed: they could lead
 * outside the vault.
 */
async function scanFiles(
  root: string,
  folder = '',
  onSkip?: (folder: string, err: unknown) => void,
  filesDir?: string | null,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(root, folder), { withFileTypes: true });
  } catch (err) {
    if (isNotFound(err)) return [];
    // A folder without permission (mode 000, another user's): skipped, not fatal.
    if (folder !== '' && isPermissionError(err)) {
      onSkip?.(folder, err);
      return [];
    }
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = folder === '' ? e.name : `${folder}/${e.name}`;
    // The files of Monsters are not notes (D-075).
    if (e.isDirectory() && isFilesPath(`${rel}/x`, filesDir)) continue;
    if (e.isDirectory()) out.push(...(await scanFiles(root, rel, onSkip, filesDir)));
    else if (e.isFile() && !isTmpPath(rel)) out.push(rel);
  }
  return out;
}

async function makeVcs(root: string, kind: VcsKind): Promise<VaultVcs> {
  if (kind === 'system') return new SystemVcs(root);
  if (kind === 'auto' && (await systemGitAvailable())) return new SystemVcs(root);
  return new IsomorphicVcs(root);
}

/**
 * The single writer of a vault: every change of files, index and git goes
 * through here. Tools are thin wrappers around these methods.
 */
export class VaultService {
  // `root`, `#realRoot`, `index`, `#vcs`, `#filesDir` and `layout` change only when an
  // untouched vault is recreated in the other layout (`recreate`, D-154).
  root: string;
  /** `root` with symbolic links resolved: every file the service touches is inside it. */
  #realRoot: string;
  index: VaultIndex;
  permissions: VaultPermissions;
  #vcs: VaultVcs | null;
  readonly #ownsDb: boolean;
  readonly #locks = new KeyedMutex();
  readonly #git = new SerialQueue();
  /** Hashes of our own writes, so the watcher ignores them (null = removed). */
  readonly #ownWrites = new Map<string, string | null>();
  readonly #contents = new Map<string, string>();
  readonly #onExternalChange: ((change: ExternalChange) => void) | undefined;
  readonly #onWarning: (warning: VaultWarning) => void;
  /** Warnings already given (code + path): each one is said once per run. */
  readonly #warned = new Set<string>();
  readonly #semantic: SemanticIndex | null;
  #watcher: FSWatcher | null = null;
  /** Notes with invalid frontmatter met by the current sync (indexed as text only). */
  #frontmatterErrors: string[] = [];
  /** Top-level folder of the files of Monsters, out of the notes (D-075). */
  #filesDir: string | null;
  /** The names of the vault's folders and notes (D-154), decided when it was created. */
  layout: VaultLayout;

  private constructor(opts: {
    root: string;
    realRoot: string;
    db: Db;
    ownsDb: boolean;
    vcs: VaultVcs | null;
    permissions: VaultPermissionsConfig | undefined;
    onExternalChange: ((change: ExternalChange) => void) | undefined;
    onWarning: ((warning: VaultWarning) => void) | undefined;
    embedder: EmbedderLoader | undefined;
    semanticOptions: SemanticIndexOptions | undefined;
    filesDir: string | null | undefined;
    layout: VaultLayout;
  }) {
    this.root = opts.root;
    this.layout = opts.layout;
    this.#filesDir = opts.filesDir ?? null;
    this.#realRoot = opts.realRoot;
    this.index = new VaultIndex(opts.db, opts.layout);
    this.#ownsDb = opts.ownsDb;
    this.#vcs = opts.vcs;
    this.permissions = new VaultPermissions(opts.permissions, opts.layout);
    this.#onExternalChange = opts.onExternalChange;
    this.#onWarning = opts.onWarning ?? ((w) => console.warn(`vault: ${w.message}`));
    this.#semantic = opts.embedder
      ? new SemanticIndex(opts.db, opts.embedder, {
          ...opts.semanticOptions,
          // During a rebuild the chunks are briefly gone, their vectors must stay (M11).
          holdGarbage: () => this.index.reindexPending,
        })
      : null;
  }

  /** Replaces the permissions (the team changed, e.g. after the onboarding). */
  setPermissions(config: VaultPermissionsConfig): void {
    // The profile of external clients does not depend on the team: keep it.
    const external = config.external ?? this.permissions.config.external;
    this.permissions = new VaultPermissions(
      { ...config, ...(external ? { external } : {}) },
      this.layout,
    );
  }

  // --- lifecycle -------------------------------------------------------------

  /** Creates a new vault with the initial structure, git and a first commit, then opens it. */
  static async create(opts: VaultCreateOptions): Promise<VaultService> {
    const root = resolvePath(opts.root);
    await mkdir(root, { recursive: true });
    const existing = (await readdir(root)).filter((n) => n !== '.DS_Store');
    if (existing.length > 0) {
      throw new ToolError('EXISTS', `the folder is not empty: ${root}`, {
        hint: 'Use VaultService.open to connect an existing vault.',
      });
    }
    const now = nowIso();
    const layout = vaultLayoutOf(opts.layout ?? 'it');
    const files: Record<string, string> = scaffoldFiles(layout);
    const orchestratorId = opts.permissions?.orchestrator;
    const orchestratorName =
      opts.orchestratorName ??
      (orchestratorId ? capitalize(orchestratorId) : scaffoldStrings(layout.id).orchestratorName);
    const agents = [orchestratorName, ...(opts.agentNames ?? [])];
    const profiles = Object.entries(opts.permissions?.agents ?? {});
    for (const name of agents) {
      const author =
        name === orchestratorName
          ? (orchestratorId ?? 'system')
          : (profiles.find(([, p]) => p.name === name)?.[0] ?? name.toLowerCase());
      files[agentMemoryPath(layout, name)] =
        buildFrontmatter({ id: ulid(), type: 'memory', created: now, updated: now, author }) +
        memoryNote(name);
    }
    for (const folder of vaultFolders(layout)) await mkdir(join(root, folder), { recursive: true });
    // The layout is decided now, once (D-154): recorded before anything else reads the vault.
    writeVaultLayoutRecord(root, layout.id);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, posix.dirname(path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    if (opts.git !== false) {
      await writeFile(join(root, '.gitignore'), VAULT_GITIGNORE);
      const vcs = await makeVcs(root, opts.git ?? 'isomorphic');
      await vcs.init();
      await vcs.commit({
        paths: [
          '.gitignore',
          '.obsidian/app.json',
          VAULT_LAYOUT_RECORD,
          ...Object.keys(files).filter((p) => !p.startsWith('.')),
        ],
        message: `${scaffoldStrings(layout.id).commitCreate}\n\n${TRAILER_AGENT}: system\n`,
        author: SYSTEM_AUTHOR,
      });
    }
    return VaultService.open({ ...opts, root, initGit: false, layout: layout.id });
  }

  /** Opens a vault. An existing vault is never modified (unless `initGit` is set and git is missing). */
  static async open(opts: VaultOpenOptions): Promise<VaultService> {
    const root = resolvePath(opts.root);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) throw new ToolError('NOT_FOUND', `vault folder not found: ${root}`);

    // What the vault has wins over what the caller says: its `Privato/` keeps its guard.
    const layout = vaultLayoutOf(detectVaultLayout(root) ?? opts.layout ?? 'it');
    let vcs: VaultVcs | null = null;
    if (opts.git !== false) {
      vcs = await makeVcs(root, opts.git ?? 'isomorphic');
      if (!(await vcs.isRepo())) {
        if (opts.initGit) {
          await vcs.init();
          if (!(await existsFile(join(root, '.gitignore')))) {
            await writeFile(join(root, '.gitignore'), VAULT_GITIGNORE);
          }
          const paths = ['.gitignore', ...(await scanFiles(root, '', () => {}, opts.filesDir))];
          await vcs.commit({
            paths,
            message: `${scaffoldStrings(layout.id).commitInit}\n\n${TRAILER_AGENT}: system\n`,
            author: SYSTEM_AUTHOR,
          });
        } else {
          vcs = null;
        }
      }
    }

    const ownsDb = !opts.db;
    const db = opts.db ?? openDb(opts.indexPath ?? ':memory:');
    migrate(db, 'vault', vaultMigrations);
    const service = new VaultService({
      root,
      realRoot: await realpath(root),
      db,
      ownsDb,
      vcs,
      permissions: opts.permissions,
      onExternalChange: opts.onExternalChange,
      onWarning: opts.onWarning,
      embedder: opts.embedder,
      semanticOptions: opts.semanticOptions,
      filesDir: opts.filesDir,
      layout,
    });
    // A migration that rebuilt index tables, or a rebuild that did not finish
    // (core stopped half-way), needs every note indexed again.
    if (service.index.reindexPending) await service.reindex();
    else await service.sync();
    // Embeddings run in the background: opening never waits for the model.
    service.#semantic?.start();
    return service;
  }

  /** True when changes are recorded in git (undo, restore and history available). */
  get hasGit(): boolean {
    return this.#vcs !== null;
  }

  get gitBackend(): 'isomorphic' | 'system' | null {
    return this.#vcs?.kind ?? null;
  }

  /** Stops the watcher, waits for pending git work and closes the index (if opened here). */
  async close(): Promise<void> {
    await this.unwatch();
    await this.#semantic?.stop();
    await this.#git.idle();
    if (this.#ownsDb) this.index.db.close();
  }

  // --- index -----------------------------------------------------------------

  /** Incremental sync of the index with the files on disk (mtime/size, then hash). */
  async sync(): Promise<{ indexed: number; removed: number; frontmatter_errors: string[] }> {
    const skipped: string[] = [];
    const files = await scanFiles(
      this.root,
      '',
      (folder, err) => {
        skipped.push(folder);
        this.#warnUnreadable(folder, err);
      },
      this.#filesDir,
    );
    const known = new Map(this.index.files().map((f) => [f.path, f]));
    // Notes of a folder that cannot be read now stay in the index as they were.
    for (const path of known.keys()) {
      if (skipped.some((f) => path.startsWith(`${f}/`))) known.delete(path);
    }
    this.#frontmatterErrors = [];
    let indexed = 0;
    let removed = 0;
    let pathsChanged = false;
    for (const path of files) {
      const prev = known.get(path);
      known.delete(path);
      const st = await stat(join(this.root, path)).catch(() => null);
      if (!st) continue;
      if (prev && prev.size === st.size && prev.mtime === Math.round(st.mtimeMs)) continue;
      // Under the lock of the path: the watcher may be indexing it too (sync after watch()).
      const changed = await this.#locks.withLocks([path], () => this.#indexReadable(path));
      if (changed) indexed++;
      if (!prev) pathsChanged = true;
    }
    for (const path of known.keys()) {
      await this.#locks.withLocks([path], () => Promise.resolve(this.#unindex(path)));
      removed++;
      pathsChanged = true;
    }
    if (pathsChanged || indexed > 0) this.index.resolveLinks();
    return { indexed, removed, frontmatter_errors: this.#frontmatterErrors };
  }

  /** Rebuilds the whole index from the files (`monsters vault reindex`). */
  async reindex(): Promise<{ files: number; ms: number; frontmatter_errors: string[] }> {
    const started = Date.now();
    // Cleared only at the end: an interrupted rebuild is resumed at the next start.
    this.index.reindexPending = true;
    const files = await scanFiles(
      this.root,
      '',
      (folder, err) => this.#warnUnreadable(folder, err),
      this.#filesDir,
    );
    this.index.clear();
    this.#frontmatterErrors = [];
    for (const path of files) await this.#indexReadable(path, true);
    this.index.resolveLinks();
    this.index.reindexPending = false;
    this.#semantic?.collectGarbage();
    return {
      files: files.length,
      ms: Date.now() - started,
      frontmatter_errors: this.#frontmatterErrors,
    };
  }

  /**
   * Absolute path of a vault file, checked to stay inside the vault even
   * through symbolic links. Every read and write of the service goes through here.
   */
  #abs(path: string): Promise<string> {
    return resolveInVault(this.#realRoot, path);
  }

  /** Like `#abs`, but null for paths that leave the vault (they are ignored). */
  async #absOrNull(path: string): Promise<string | null> {
    try {
      return await this.#abs(path);
    } catch (err) {
      if (err instanceof ToolError && err.code === 'BLOCKED_BY_POLICY') return null;
      throw err;
    }
  }

  async #readText(path: string): Promise<FileText | null> {
    const bytes = await readIfExists(await this.#abs(path));
    if (!bytes) return null;
    const text = bytes.toString('utf8');
    const hash = contentHash(bytes);
    this.#remember(hash, text);
    return { bytes, text, hash };
  }

  #remember(hash: string, text: string): void {
    this.#contents.delete(hash);
    this.#contents.set(hash, text);
    if (this.#contents.size > CONTENT_CACHE_SIZE) {
      const oldest = this.#contents.keys().next().value;
      if (oldest !== undefined) this.#contents.delete(oldest);
    }
  }

  /** (Re)indexes a file from disk; returns false when it was already up to date. */
  /** `#indexFromDisk` for a sync: a file without permission is skipped with a warning. */
  async #indexReadable(path: string, force = false): Promise<boolean> {
    try {
      return await this.#indexFromDisk(path, force);
    } catch (err) {
      if (!isPermissionError(err)) throw err;
      this.#warnUnreadable(path, err);
      return false;
    }
  }

  #warn(warning: VaultWarning): void {
    const key = `${warning.code}:${warning.path ?? warning.message}`;
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    try {
      this.#onWarning(warning);
    } catch {
      // a logger must not break the vault
    }
  }

  #warnUnreadable(path: string, err: unknown): void {
    this.#warn({
      code: 'vault_unreadable',
      path,
      message: vaultStrings().unreadable(path, errnoOf(err) ?? vaultStrings().permissions),
    });
  }

  async #indexFromDisk(path: string, force = false): Promise<boolean> {
    const abs = await this.#absOrNull(path);
    if (abs === null) {
      // A symbolic link leaving the vault: never indexed.
      this.#unindex(path);
      return false;
    }
    const bytes = await readIfExists(abs);
    if (!bytes) {
      this.#unindex(path);
      return true;
    }
    const st = await stat(abs);
    const hash = contentHash(bytes);
    const prev = this.index.get(path);
    if (!force && prev?.hash === hash) {
      if (prev.mtime !== Math.round(st.mtimeMs)) {
        this.index.db.run(
          'UPDATE vault_notes SET mtime = ? WHERE nid = ?',
          Math.round(st.mtimeMs),
          prev.nid,
        );
      }
      return false;
    }
    this.#indexContent(path, bytes, hash, st.mtimeMs);
    return true;
  }

  #indexContent(path: string, bytes: Uint8Array, hash: string, mtime: number): number {
    const md = isMarkdown(path);
    const text = md ? Buffer.from(bytes).toString('utf8') : '';
    const note = md ? parseNote(path, text) : null;
    if (note?.frontmatterError) this.#frontmatterErrors.push(path);
    const nid = this.index.upsert(path, { hash, mtime, size: bytes.byteLength }, note);
    const dropped = this.index.takeDroppedChunks();
    if (md || dropped.length > 0) this.#semantic?.changed(dropped);
    return nid;
  }

  #unindex(path: string): void {
    if (this.index.remove(path)) this.#semantic?.changed(this.index.takeDroppedChunks());
  }

  // --- watcher ---------------------------------------------------------------

  /** Watches the vault for changes made outside Monsters and keeps the index current. */
  async watch(): Promise<void> {
    if (this.#watcher) return;
    const root = this.root;
    await this.#removeLeftoverProbes();
    const watcher = watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
      followSymlinks: false,
      // Folders without permission are skipped (chokidar would emit an error for each).
      ignorePermissionErrors: true,
      ignored: (abs: string) => {
        const rel = posix.normalize(abs.slice(root.length).replace(/\\/g, '/').replace(/^\/+/, ''));
        return (
          rel !== '.' &&
          rel !== '' &&
          (isHidden(rel) || isTmpPath(rel) || isFilesPath(`${rel}/x`, this.#filesDir))
        );
      },
    });
    this.#watcher = watcher;
    const handle = (kind: ExternalChange['kind']) => (abs: string) => {
      const rel = abs.slice(root.length).replace(/\\/g, '/').replace(/^\/+/, '');
      this.#onWatchEvent(kind, rel).catch((err: unknown) => {
        console.error('vault watcher:', err);
      });
    };
    watcher.on('add', handle('add'));
    watcher.on('change', handle('change'));
    watcher.on('unlink', handle('unlink'));
    // Without a listener an 'error' (limit of watched files, EACCES on a new folder…) would
    // throw and take the whole core down: the watcher goes on, the next start syncs anyway.
    watcher.on('error', (err: unknown) => this.#onWatchError(err));
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
    await this.#untilWatcherLive(watcher);
    // A change made between the sync of open() and the watcher going live was seen by
    // neither (D-043): an incremental sync now (one stat per file) catches it.
    if (this.#watcher === watcher) {
      await this.sync().catch((err: unknown) => console.error('vault sync after watch:', err));
    }
  }

  #onWatchError(err: unknown): void {
    if (isPermissionError(err)) {
      const path = (err as { path?: unknown }).path;
      const rel =
        typeof path === 'string'
          ? path.slice(this.root.length).replace(/\\/g, '/').replace(/^\/+/, '')
          : '';
      this.#warnUnreadable(rel || vaultStrings().notesFolder, err);
      return;
    }
    const code = errnoOf(err);
    this.#warn({
      code: 'vault_watch_error',
      message:
        code === 'ENOSPC' || code === 'EMFILE'
          ? vaultStrings().watchLimit(code)
          : vaultStrings().watchError(err instanceof Error ? err.message : String(err)),
    });
  }

  /** Probe files of a run killed during `watch()` (SIGKILL): removed at the next one. */
  async #removeLeftoverProbes(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((n) => n.startsWith(WATCH_PROBE_PREFIX) && n.endsWith(TMP_SUFFIX))
        .map((n) => rm(join(this.root, n), { force: true }).catch(() => {})),
    );
  }

  /**
   * Waits until the watcher really delivers events. On macOS `fs.watch` runs on FSEvents and
   * libuv (re)starts the stream on its own thread after `fs.watch` returns, so chokidar says
   * `ready` before events flow and a change made right after is lost (D-043). Writes probe
   * files in the root (hidden and temporary: ignored by the index, Obsidian and git) until the
   * watcher reports one, then removes them. Gives up after a few seconds (e.g. read-only
   * vault) and keeps the watcher as it is.
   */
  async #untilWatcherLive(watcher: FSWatcher): Promise<void> {
    const probes = new Set<string>();
    let seen = false;
    const onRaw = (_event: string, path: string | null | undefined) => {
      if (typeof path === 'string' && probes.has(basename(path))) seen = true;
    };
    watcher.on('raw', onRaw);
    const deadline = Date.now() + WATCH_LIVE_TIMEOUT_MS;
    try {
      while (!seen && this.#watcher === watcher && Date.now() < deadline) {
        const name = `${WATCH_PROBE_PREFIX}${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
        probes.add(name);
        try {
          await writeFile(join(this.root, name), '');
        } catch {
          return;
        }
        for (let t = 0; t < WATCH_PROBE_INTERVAL_MS && !seen; t += 10) await sleep(10);
      }
    } finally {
      watcher.off('raw', onRaw);
      await Promise.all([...probes].map((n) => rm(join(this.root, n), { force: true })));
    }
  }

  async unwatch(): Promise<void> {
    const w = this.#watcher;
    this.#watcher = null;
    await w?.close();
  }

  async #onWatchEvent(kind: ExternalChange['kind'], path: string): Promise<void> {
    await this.#locks.withLocks([path], async () => {
      const abs = await this.#absOrNull(path);
      const bytes = abs === null ? null : await readIfExists(abs);
      const hash = bytes ? contentHash(bytes) : null;
      if (this.#ownWrites.has(path) && this.#ownWrites.get(path) === hash) {
        this.#ownWrites.delete(path);
        return;
      }
      const before = this.index.get(path);
      if (hash === null) {
        if (!before) return;
        this.#unindex(path);
        this.index.resolveLinks();
        this.#onExternalChange?.({ kind: 'unlink', path });
        return;
      }
      if (before?.hash === hash) return;
      await this.#indexFromDisk(path);
      this.index.resolveLinks(before ? this.index.get(path)?.nid : undefined);
      this.#onExternalChange?.({ kind: before ? 'change' : 'add', path });
    });
  }

  // --- recreation in the other layout (D-154) ----------------------------------

  /**
   * True only for a vault exactly as `create` left it: history on, a single commit
   * (`vault_create`), every file on disk the one of that commit, byte for byte, no other file
   * or folder but the scaffold's empty folders and the files folder holding only
   * `filesFolderFiles` (its marker and `.gitignore`). Anything else (a symbolic link, a read
   * that fails, a vault without history): false. A person or a monster that wrote anything,
   * through Monsters or not, made it touched.
   */
  async isUntouched(filesFolderFiles: readonly string[] = []): Promise<boolean> {
    const vcs = this.#vcs;
    if (!vcs) return false;
    try {
      const commits = await vcs.log({ depth: 2 });
      if (commits.length !== 1 || !commits[0]!.message.startsWith('vault_create:')) return false;
      const commit = commits[0]!.oid;
      const scaffold = new Set(vaultFolders(this.layout).map(foldPath));
      const walk = async (folder: string): Promise<boolean> => {
        const entries = await readdir(join(this.root, folder), { withFileTypes: true });
        if (folder !== '' && entries.length === 0) return scaffold.has(foldPath(folder));
        for (const e of entries) {
          const rel = folder === '' ? e.name : `${folder}/${e.name}`;
          if (rel === '.git' && e.isDirectory()) continue;
          if (e.isDirectory()) {
            if (folder === '' && isFilesPath(`${rel}/x`, this.#filesDir)) {
              const inside = await readdir(join(this.root, rel), { withFileTypes: true });
              if (!inside.every((f) => f.isFile() && filesFolderFiles.includes(f.name))) {
                return false;
              }
              continue;
            }
            if (!(await walk(rel))) return false;
          } else if (e.isFile()) {
            const bytes = await readIfExists(join(this.root, rel));
            if (!bytes || (await vcs.fileOid(commit, rel)) !== gitBlobOid(bytes)) return false;
          } else {
            return false;
          }
        }
        return true;
      };
      return await walk('');
    } catch {
      return false;
    }
  }

  /**
   * Makes an untouched vault again in another layout (D-154: the language picked on the first
   * screen is not the one the vault was created in), in `root` (the same folder, or the new
   * default one), and goes on as that vault: same service, same index database. Refused unless
   * `isUntouched`; the folder it leaves held only what `create` wrote, and is removed.
   */
  async recreate(opts: {
    root: string;
    layout: VaultLayoutId;
    filesDir: string | null;
    filesFolderFiles?: readonly string[];
    orchestratorName?: string;
    agentNames?: string[];
  }): Promise<void> {
    if (!(await this.isUntouched(opts.filesFolderFiles))) {
      throw new ToolError(
        'EXISTS',
        `the vault is in use: it keeps its folder names (${this.root})`,
      );
    }
    const root = resolvePath(opts.root);
    const same = root === this.root;
    if (!same) {
      const there = await readdir(root).catch(() => [] as string[]);
      if (there.some((n) => n !== '.DS_Store')) {
        throw new ToolError('EXISTS', `the folder is not empty: ${root}`);
      }
    }
    const kind = this.#vcs?.kind ?? 'isomorphic';
    await this.unwatch();
    await this.#git.idle();
    const old = this.root;
    if (same) {
      for (const name of await readdir(old)) {
        await rm(join(old, name), { recursive: true, force: true });
      }
    }
    const fresh = await VaultService.create({
      root,
      db: this.index.db,
      git: kind,
      layout: opts.layout,
      filesDir: opts.filesDir,
      permissions: this.permissions.config,
      onWarning: this.#onWarning,
      ...(opts.orchestratorName !== undefined ? { orchestratorName: opts.orchestratorName } : {}),
      ...(opts.agentNames !== undefined ? { agentNames: opts.agentNames } : {}),
    });
    if (!same) await rm(old, { recursive: true, force: true });
    this.root = fresh.root;
    this.#realRoot = fresh.#realRoot;
    this.#vcs = fresh.#vcs;
    this.#filesDir = fresh.#filesDir;
    this.layout = fresh.layout;
    this.index = new VaultIndex(this.index.db, fresh.layout);
    this.permissions = new VaultPermissions(this.permissions.config, fresh.layout);
    this.#ownWrites.clear();
    this.#contents.clear();
    this.#warned.clear();
    await this.reindex();
  }

  // --- resolution helpers ------------------------------------------------------

  /** Finds an existing file by path, title, partial path or alias (like a wikilink). */
  async resolveExisting(ref: string): Promise<string> {
    const p = normalizePath(ref);
    if (p === '') throw new ToolError('INVALID_INPUT', 'empty path');
    if (isSystemPath(p)) {
      throw new ToolError(
        'BLOCKED_BY_POLICY',
        `${p}: .obsidian, .git and .trash are managed by the system`,
      );
    }
    if (isHidden(p) || isTmpPath(p) || isFilesPath(p, this.#filesDir)) {
      throw new ToolError('NOT_FOUND', `note not found: ${ref}`);
    }
    const candidates = hasExtension(p) ? [p] : [`${p}.md`, p];
    for (const c of candidates) {
      if (this.index.get(c)) return c;
    }
    for (const c of candidates) {
      if (await existsFile(await this.#abs(c))) {
        await this.#indexFromDisk(c);
        this.index.resolveLinks();
        return c;
      }
    }
    const byLink = this.index.resolve('wiki', p, '');
    if (byLink) return byLink.path;
    const byAlias = this.index.byAlias(p.replace(/\.md$/i, ''))[0];
    if (byAlias) return byAlias.path;
    throw new ToolError('NOT_FOUND', `note not found: ${ref}`, {
      hint: 'Use vault_search to find the right path.',
    });
  }

  #row(path: string): NoteRow | undefined {
    return this.index.get(path);
  }

  #conflict(path: string, baseHash: string, current: FileText): ToolError {
    const base = this.#contents.get(baseHash);
    const diff = base === undefined ? undefined : lineDiff(base, current.text);
    return new ToolError('CONFLICT', `${path} changed since you read it`, {
      hint: 'Read the note again (vault_read), then reapply your change with the new hash.',
      details: {
        path,
        base_hash: baseHash,
        current_hash: current.hash,
        ...(diff !== undefined ? { diff } : {}),
      },
    });
  }

  // --- the single write path -------------------------------------------------

  /**
   * Runs one write action: locks the paths, snapshots user edits (so an
   * external edit is in git even when the action then fails), plans the change
   * (all checks happen here, before anything is written), writes atomically,
   * commits once, updates the index, records and emits the action. When the
   * commit fails the files are put back as they were: an action is either
   * written and undoable, or not done at all.
   */
  async #act<R>(
    actor: VaultActor,
    tool: string,
    params: unknown,
    lockPaths: readonly string[],
    plan: () => Promise<ActionPlan<R>>,
  ): Promise<R> {
    throwIfAborted(actor.signal);
    return this.#locks.withLocks(lockPaths, async () => {
      throwIfAborted(actor.signal);
      if (this.#vcs) await this.#snapshotUserChanges(lockPaths);
      const p = await plan();
      throwIfAborted(actor.signal);
      const actionId = ulid();
      const paths = [...new Set(p.changes.map((c) => c.path))];
      const unlocked = paths.filter((path) => !lockPaths.includes(path));
      if (this.#vcs && unlocked.length > 0) await this.#snapshotUserChanges(unlocked);

      // Resolve every path (symbolic links leaving the vault are refused) and
      // keep the previous content, before writing anything.
      const steps: WriteStep[] = [];
      for (const change of p.changes) {
        const abs = await this.#abs(change.path);
        steps.push({
          change,
          abs,
          trashAbs: change.trashTo ? await this.#abs(change.trashTo) : null,
          previous: await readIfExists(abs),
          done: false,
        });
      }
      throwIfAborted(actor.signal);

      // Write phase: from here on the action completes (no partial multi-file state on abort).
      let pathsChanged = false;
      try {
        for (const step of steps) {
          const { change, abs } = step;
          if (change.content === null) {
            if (this.#watcher) this.#ownWrites.set(change.path, null);
            if (step.trashAbs) {
              if (step.previous) {
                // Native path: `posix.dirname` of a Windows path would be ".".
                await mkdir(dirname(step.trashAbs), { recursive: true });
                await renameWithRetry(abs, step.trashAbs);
              }
            } else {
              await rm(abs, { force: true });
            }
            pathsChanged = true;
          } else {
            const bytes =
              typeof change.content === 'string' ? Buffer.from(change.content) : change.content;
            if (!this.index.get(change.path)) pathsChanged = true;
            if (this.#watcher) this.#ownWrites.set(change.path, contentHash(bytes));
            await atomicWrite(abs, bytes);
          }
          step.done = true;
        }
      } catch (err) {
        await this.#revert(steps);
        throw err;
      }

      let commit: string | null = null;
      if (this.#vcs) {
        const vcs = this.#vcs;
        const message = [
          `${tool}: ${p.summary} [agent=${actor.agentId} action=${actionId}]`,
          '',
          ...(p.body ? [p.body, ''] : []),
          `${TRAILER_ACTION}: ${actionId}`,
          `${TRAILER_AGENT}: ${actor.agentId}`,
          '',
        ].join('\n');
        try {
          commit = await this.#git.run(() =>
            vcs.commit({ paths, message, author: authorFor(actor.agentId) }),
          );
        } catch (err) {
          await this.#revert(steps);
          throw new ToolError(
            'UNAVAILABLE',
            `the change could not be recorded in git, so it was not made: ${err instanceof Error ? err.message : String(err)}`,
            { hint: 'Nothing was changed. Check the vault .git folder, then try again.' },
          );
        }
      }

      for (const step of steps) {
        const { change } = step;
        if (change.content === null) {
          this.#unindex(change.path);
        } else {
          const bytes =
            typeof change.content === 'string' ? Buffer.from(change.content) : change.content;
          const st = await stat(step.abs);
          const hash = contentHash(bytes);
          if (typeof change.content === 'string') this.#remember(hash, change.content);
          const nid = this.#indexContent(change.path, bytes, hash, st.mtimeMs);
          if (!pathsChanged) this.index.resolveLinks(nid);
        }
      }
      if (pathsChanged) this.index.resolveLinks();

      this.index.recordAction({ id: actionId, agent: actor.agentId, tool, params, paths, commit });
      await p.after?.();
      actor.emit?.({
        type: 'vault_change',
        data: {
          ...p.vaultChange,
          actionId,
          ...(commit ? { commit } : {}),
          ...(paths.length > 1 ? { files: paths } : {}),
        },
      });
      return p.result({ action_id: actionId, commit });
    });
  }

  /** Puts back the files of a write phase that cannot be recorded (newest step first). */
  async #revert(steps: readonly WriteStep[]): Promise<void> {
    for (const step of [...steps].reverse()) {
      if (!step.done) continue;
      const { change, abs, previous } = step;
      if (this.#watcher) {
        this.#ownWrites.set(change.path, previous ? contentHash(previous) : null);
      }
      if (change.content === null && step.trashAbs && previous) {
        await mkdir(dirname(abs), { recursive: true });
        await renameWithRetry(step.trashAbs, abs);
      } else if (previous) {
        await atomicWrite(abs, previous);
      } else {
        await rm(abs, { force: true });
      }
    }
  }

  /** Commits, as the user, files whose content on disk differs from the last commit. */
  async #snapshotUserChanges(paths: readonly string[]): Promise<string | null> {
    const vcs = this.#vcs;
    if (!vcs) return null;
    return this.#git.run(async () => {
      const head = await vcs.head();
      const changed: string[] = [];
      for (const path of paths) {
        if (isSystemPath(path)) continue;
        const abs = await this.#absOrNull(path);
        if (abs === null) continue;
        const disk = await readIfExists(abs);
        const diskOid = disk ? gitBlobOid(disk) : null;
        const headOid = head ? await vcs.fileOid(head, path) : null;
        if (diskOid !== headOid) changed.push(path);
      }
      if (changed.length === 0) return null;
      return vcs.commit({
        paths: changed,
        message: `${scaffoldStrings(this.layout.id).commitSnapshot(changed.join(', '))}\n\n${TRAILER_AGENT}: user\n`,
        author: USER_AUTHOR,
      });
    });
  }

  // --- read operations ---------------------------------------------------------

  async read(
    actor: VaultActor,
    input: { path: string; section?: string | undefined; max_chars?: number | undefined },
  ): Promise<{
    path: string;
    id: string | null;
    title: string;
    frontmatter: Props;
    content: string | null;
    hash: string;
    outlinks: string[];
    backlinks_count: number;
    truncated?: boolean;
    sections?: string[];
    /** The frontmatter is not valid YAML: the note is read and indexed as text only. */
    frontmatter_error?: string;
  }> {
    const path = await this.resolveExisting(input.path);
    const file = await this.#readText(path);
    if (!file) {
      this.#unindex(path);
      throw new ToolError('NOT_FOUND', `note not found: ${input.path}`);
    }
    if (this.#row(path)?.hash !== file.hash) {
      await this.#indexFromDisk(path);
      this.index.resolveLinks();
    }
    const row = this.#row(path)!;
    if (!isMarkdown(path)) {
      this.permissions.assertRead(actor.agentId, path, false);
      return {
        path,
        id: null,
        title: titleOf(path),
        frontmatter: {},
        content: null,
        hash: file.hash,
        outlinks: [],
        backlinks_count: this.index.backlinkPaths(row.nid).length,
      };
    }
    const note = parseNote(path, file.text);
    this.permissions.assertRead(actor.agentId, path, note.private);
    let content = note.body.replace(/^\n+/, '');
    if (input.section) {
      const section = findSection(note.scan, input.section);
      if (!section) {
        throw new ToolError('NOT_FOUND', `section "${input.section}" not found in ${path}`, {
          hint: `Headings: ${note.headings.map((h) => h.text).join(', ') || 'none'}`,
        });
      }
      content = file.text.slice(section.heading.start, section.end);
    }
    const max = input.max_chars ?? 20_000;
    const truncated = content.length > max;
    const outlinks = this.index.outlinks(row.nid).map((l) => l.path ?? `${l.target} (missing)`);
    return {
      path,
      id: note.uid,
      title: note.title,
      frontmatter: note.props,
      content: truncated ? `${content.slice(0, max)}\n…` : content,
      hash: file.hash,
      outlinks: [...new Set(outlinks)],
      backlinks_count: this.index.backlinkPaths(row.nid).length,
      ...(truncated ? { truncated: true, sections: note.headings.map((h) => h.text) } : {}),
      ...(note.frontmatterError ? { frontmatter_error: note.frontmatterError } : {}),
    };
  }

  /**
   * Searches the notes: full-text (BM25, Italian stems), semantic (vectors) or
   * hybrid (both, fused with RRF), or the notes related to a note. Every mode
   * falls back to full-text while the vectors are not available.
   */
  async search(actor: VaultActor, input: SearchInput): Promise<SearchHit[]> {
    const scope = currentVaultScope();
    if (!scope) return this.#search(actor, input);
    // Only the folders of the scope (D-114): searched deeper, then filtered.
    const limit = input.limit ?? 10;
    const hits = await this.#search(actor, { ...input, limit: Math.max(limit * 5, 50) });
    return hits.filter((h) => scope.some((f) => isInside(h.path, f))).slice(0, limit);
  }

  async #search(actor: VaultActor, input: SearchInput): Promise<SearchHit[]> {
    let linksTo: number | undefined;
    if (input.links_to) {
      const target = await this.resolveExisting(input.links_to);
      linksTo = this.#row(target)?.nid;
    }
    const limit = input.limit ?? 10;
    const filters = {
      tags: input.tags,
      folder: input.folder ? normalizePath(input.folder) : undefined,
      type: input.type,
      updatedAfter: input.updated_after,
      linksTo,
      hidePrivate: !this.permissions.isPrivileged(actor.agentId),
    };
    if (input.related_to) {
      return this.#related(actor, input.related_to, filters, input.limit ?? RELATED_LIMIT);
    }

    const mode = !input.mode || input.mode === 'auto' ? 'hybrid' : input.mode;
    const query = input.query?.trim();
    const semantic = this.#semantic;
    if (!query || mode === 'text' || !semantic?.usable) {
      return this.index.search({ ...filters, query: input.query, limit });
    }
    const vectorHits = await semantic.search(query, {
      limit: mode === 'semantic' ? limit : FUSION_DEPTH,
      allowed: this.index.filterNids(filters),
    });
    if (!vectorHits) return this.index.search({ ...filters, query: input.query, limit });
    const meaning = vectorHits.flatMap((h) => this.#semanticHit(h) ?? []);
    // Notes whose text has no vector yet (just written, first indexing):
    // meaning has not ranked them, full-text is all there is.
    const unembedded = semantic.unembeddedNids();
    const notRanked = (path: string) => {
      const nid = unembedded.size > 0 ? this.#row(path)?.nid : undefined;
      return nid !== undefined && unembedded.has(nid);
    };
    const text = this.index.search({ ...filters, query: input.query, limit: FUSION_DEPTH });
    if (mode === 'semantic') {
      const seen = new Set(meaning.map((h) => h.path));
      const pending = text.filter((h) => !seen.has(h.path) && notRanked(h.path));
      return [...meaning, ...pending].slice(0, limit);
    }

    const byPath = new Map<string, SearchHit>(meaning.map((h) => [h.path, h]));
    const inMeaning = new Set(byPath.keys());
    // Full-text hits keep their snippet with the matched words highlighted.
    for (const h of text) byPath.set(h.path, h);
    // A question rarely has all its words in a note: full-text then matches
    // only some of them (partial) and is a weak signal next to the meaning.
    // Not for a note that meaning could not judge yet: then it counts in full.
    const textWeight = text.length > 0 && text.every((h) => h.partial) ? PARTIAL_TEXT_WEIGHT : 1;
    const weightOf = (path: string) => (notRanked(path) ? 1 : textWeight);
    return rrfFuse([text.map((h) => h.path), meaning.map((h) => h.path)], undefined, [weightOf, 1])
      .filter((f) => f.score > 0)
      .slice(0, limit)
      .flatMap(({ key, score }) => {
        const hit = byPath.get(key);
        if (!hit) return [];
        const { partial, ...rest } = hit;
        return [
          {
            ...rest,
            score: Math.round(score * 10_000) / 10_000,
            // "Only some words" does not apply to a note also found by meaning.
            ...(partial && !inMeaning.has(key) ? { partial } : {}),
          },
        ];
      });
  }

  /** A vector hit as a search result, with the matching chunk as snippet. */
  #semanticHit(h: { nid: number; chunkId: number; score: number }): SearchHit | undefined {
    const row = this.index.getByNid(h.nid);
    if (!row) return undefined;
    const chunk = this.#semantic?.chunkText(h.chunkId);
    const text = chunk
      ? `${chunk.heading_path ? `${chunk.heading_path}: ` : ''}${chunk.text}`
      : row.summary;
    const flat = text.replace(/\s+/g, ' ').trim();
    return {
      path: row.path,
      title: row.title,
      type: row.type,
      updated: row.updated,
      score: Math.round(h.score * 1000) / 1000,
      snippet: flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat,
      tags: this.index.tagsOf(row.nid),
    };
  }

  /**
   * Notes related to a note: only those clearly closer in meaning than the
   * rest of the vault, helped by links, tags and folder (see `related.ts`),
   * so possibly none. Without vectors: notes sharing title words and tags,
   * the linked and tagged ones first.
   */
  async #related(
    actor: VaultActor,
    ref: string,
    filters: Omit<SearchFilters, 'query' | 'limit'>,
    limit: number,
  ): Promise<SearchHit[]> {
    const path = await this.resolveExisting(ref);
    const row = this.#row(path);
    if (!row?.is_md) throw new ToolError('NOT_FOUND', `note not found: ${ref}`);
    this.permissions.assertRead(actor.agentId, path, row.private === 1);
    const allowed = this.index.filterNids(filters);
    allowed.delete(row.nid);
    const signals = this.index.relationSignals(row.nid);
    const semantic = this.#semantic;
    const near = semantic?.usable ? semantic.related(row.nid, { allowed }) : null;
    if (semantic && near) {
      return pickRelated(near, signals, { limit }).flatMap((r) => {
        const chunk = semantic.closestChunk(r.nid, row.nid);
        return (
          this.#semanticHit({ nid: r.nid, chunkId: chunk?.chunkId ?? -1, score: r.score }) ?? []
        );
      });
    }
    const words = [row.title, ...this.index.tagsOf(row.nid).map((t) => t.replace(/[/_-]/g, ' '))];
    const text = this.index
      .search({ ...filters, query: words.join(' '), anyWords: true, limit: limit + 1 })
      .filter((h) => h.path !== path);
    const textNids = new Map(text.map((h, i) => [this.#row(h.path)?.nid ?? -1, i]));
    // Linked or tagged notes first, then the order of full-text.
    const ranked = [...new Set([...signals.keys(), ...textNids.keys()])]
      .filter((nid) => allowed.has(nid))
      .map((nid) => ({ nid, bonus: relationBonus(signals.get(nid)), at: textNids.get(nid) }))
      .filter((r) => r.at !== undefined || r.bonus >= 0.5)
      .sort((a, b) => b.bonus - a.bonus || (a.at ?? limit) - (b.at ?? limit))
      .slice(0, limit);
    return ranked.flatMap((r) =>
      r.at !== undefined
        ? (text[r.at] ?? [])
        : (this.#semanticHit({ nid: r.nid, chunkId: -1, score: 0 }) ?? []),
    );
  }

  /** State of the semantic index (model, how many chunks have a vector). */
  semanticStatus(): SemanticStatus {
    return this.#semantic?.status() ?? { state: 'off', model: null, chunks: 0, embedded: 0 };
  }

  /** Resolves when the background embedding has caught up (tests, reindex). */
  async semanticIdle(): Promise<void> {
    await this.#semantic?.idle();
  }

  async list(
    actor: VaultActor,
    input: {
      folder?: string | undefined;
      recursive?: boolean | undefined;
      sort?: 'updated' | 'name' | undefined;
      limit?: number | undefined;
    },
  ): Promise<{
    folder: string;
    folders: string[];
    files: { path: string; title: string; type: string | null; updated: string }[];
    total: number;
  }> {
    const folder = normalizePath(input.folder ?? '');
    if (
      isSystemPath(folder) ||
      (folder !== '' && (isHidden(folder) || isFilesPath(`${folder}/x`, this.#filesDir)))
    ) {
      throw new ToolError('BLOCKED_BY_POLICY', `${folder} is managed by the system`);
    }
    const recursive = input.recursive ?? false;
    const privileged = this.permissions.isPrivileged(actor.agentId);
    let rows = this.index
      .list(folder, recursive)
      .filter((r) => this.permissions.canRead(actor.agentId, r.path, r.private === 1));
    rows =
      (input.sort ?? 'updated') === 'name'
        ? rows.sort((a, b) => a.path.localeCompare(b.path))
        : rows.sort((a, b) => b.updated.localeCompare(a.updated) || a.path.localeCompare(b.path));
    let folders: string[] = [];
    if (!recursive) {
      const abs = await this.#abs(folder);
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
      folders = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .filter((e) => folder !== '' || !isFilesPath(`${e.name}/x`, this.#filesDir))
        .map((e) => (folder === '' ? e.name : `${folder}/${e.name}`))
        .filter((f) => privileged || !(isInside(f, this.layout.private) || inAnyPrivateFolder(f)))
        // In a scope (D-114) only its folders and the ones that lead to them.
        .filter((f) => {
          const scope = currentVaultScope();
          return !scope || scope.some((s) => isInside(f, s) || isInside(s, f));
        })
        .sort();
    }
    const limit = input.limit ?? 50;
    return {
      folder: folder === '' ? '/' : folder,
      folders,
      files: rows
        .slice(0, limit)
        .map((r) => ({ path: r.path, title: r.title, type: r.type, updated: r.updated })),
      total: rows.length,
    };
  }

  async links(
    actor: VaultActor,
    input: {
      path: string;
      direction?: 'out' | 'in' | 'both' | undefined;
      depth?: number | undefined;
      include_unresolved?: boolean | undefined;
    },
  ): Promise<{
    nodes: { path: string | null; title: string; unresolved?: boolean }[];
    edges: { from: string; to: string; type: 'link' | 'embed' }[];
  }> {
    const start = await this.resolveExisting(input.path);
    const startRow = this.#row(start);
    if (!startRow) throw new ToolError('NOT_FOUND', `note not found: ${input.path}`);
    this.permissions.assertRead(actor.agentId, start, startRow.private === 1);
    const direction = input.direction ?? 'both';
    const depth = Math.min(Math.max(input.depth ?? 1, 1), 3);
    const visible = (row: NoteRow) =>
      this.permissions.canRead(actor.agentId, row.path, row.private === 1);

    const nodes = new Map<string, { path: string | null; title: string; unresolved?: boolean }>();
    const edges = new Map<string, { from: string; to: string; type: 'link' | 'embed' }>();
    nodes.set(start, { path: start, title: startRow.title });
    let frontier = [startRow.nid];
    const seen = new Set(frontier);
    for (let level = 0; level < depth; level++) {
      const next: number[] = [];
      for (const nid of frontier) {
        const row = this.index.getByNid(nid)!;
        if (direction !== 'in') {
          for (const e of this.index.edgesFrom(nid)) {
            const type = e.is_embed ? 'embed' : 'link';
            if (e.target_nid === null) {
              if (!input.include_unresolved) continue;
              const key = `?${e.target_raw}`;
              nodes.set(key, { path: null, title: e.target_raw, unresolved: true });
              edges.set(`${row.path}>${key}`, { from: row.path, to: e.target_raw, type });
              continue;
            }
            const target = this.index.getByNid(e.target_nid);
            if (!target || !visible(target)) continue;
            nodes.set(target.path, { path: target.path, title: target.title });
            edges.set(`${row.path}>${target.path}`, { from: row.path, to: target.path, type });
            if (!seen.has(target.nid)) {
              seen.add(target.nid);
              next.push(target.nid);
            }
          }
        }
        if (direction !== 'out') {
          for (const e of this.index.edgesTo(nid)) {
            const src = this.index.getByNid(e.src_nid);
            if (!src || !visible(src)) continue;
            nodes.set(src.path, { path: src.path, title: src.title });
            edges.set(`${src.path}>${row.path}`, {
              from: src.path,
              to: row.path,
              type: e.is_embed ? 'embed' : 'link',
            });
            if (!seen.has(src.nid)) {
              seen.add(src.nid);
              next.push(src.nid);
            }
          }
        }
      }
      frontier = next;
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  tags(
    actor: VaultActor,
    input: { prefix?: string | undefined },
  ): { tag: string; count: number }[] {
    return this.index.tags(input.prefix, !this.permissions.isPrivileged(actor.agentId));
  }

  /**
   * Every Markdown note the actor may read, newest first, with its tags, and the
   * resolved links between them: the list, the filters and the graph of the UI.
   */
  overview(
    actor: VaultActor,
    input: { limit?: number | undefined } = {},
  ): {
    notes: {
      path: string;
      title: string;
      type: string | null;
      author: string | null;
      updated: string;
      private: boolean;
      tags: string[];
      summary: string;
    }[];
    edges: { from: string; to: string; embed: boolean }[];
    total: number;
  } {
    const rows = this.index
      .list('', true)
      .filter(
        (r) => r.is_md === 1 && this.permissions.canRead(actor.agentId, r.path, r.private === 1),
      )
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.path.localeCompare(b.path));
    const kept = rows.slice(0, input.limit ?? 5000);
    const byNid = new Map(kept.map((r) => [r.nid, r]));
    const tags = new Map<number, string[]>();
    for (const t of this.index.allTags()) {
      if (!byNid.has(t.nid)) continue;
      const list = tags.get(t.nid);
      if (list) list.push(t.tag);
      else tags.set(t.nid, [t.tag]);
    }
    const edges: { from: string; to: string; embed: boolean }[] = [];
    for (const e of this.index.allEdges()) {
      const from = byNid.get(e.src_nid);
      const to = byNid.get(e.target_nid);
      if (from && to) edges.push({ from: from.path, to: to.path, embed: e.is_embed === 1 });
    }
    return {
      notes: kept.map((r) => ({
        path: r.path,
        title: r.title,
        type: r.type,
        author: r.author,
        updated: r.updated,
        private:
          r.private === 1 || isInside(r.path, this.layout.private) || inAnyPrivateFolder(r.path),
        tags: tags.get(r.nid) ?? [],
        summary: r.summary,
      })),
      edges,
      total: rows.length,
    };
  }

  // --- write operations ----------------------------------------------------------

  async write(
    actor: VaultActor,
    input: {
      path: string;
      content: string;
      frontmatter?: Props | undefined;
      mode?: 'create' | 'overwrite' | undefined;
      base_hash?: string | undefined;
    },
    meta: { tool: string; action: 'create' | 'propose' } = {
      tool: 'vault_write',
      action: 'create',
    },
  ): Promise<WriteResult & { warning?: string }> {
    const path = normalizeNotePath(input.path);
    const mode = input.mode ?? 'create';
    // In every mode, before the note is read (a CONFLICT would tell its hash): hidden files
    // like `.monsters/vault.json` (the layout record, D-154) are no note to overwrite.
    if (isSystemPath(path) || isHidden(path)) {
      throw new ToolError(
        'BLOCKED_BY_POLICY',
        `${path}: hidden and system folders are managed by the system`,
      );
    }
    if (mode === 'create') assertValidNewPath(path, this.#filesDir);
    if (mode === 'overwrite' && !input.base_hash) {
      throw new ToolError('INVALID_INPUT', 'base_hash is required to overwrite', {
        hint: 'Read the note with vault_read and pass its hash as base_hash.',
      });
    }
    return this.#act(actor, meta.tool, input, [path], async () => {
      const current = await this.#readText(path);
      const now = nowIso();
      let text: string;
      let warning: string | undefined;
      if (mode === 'create') {
        if (current) {
          throw new ToolError('EXISTS', `${path} already exists`, {
            hint: `Read it and use vault_edit, or choose another name such as "${await this.#freeName(path)}".`,
          });
        }
        this.permissions.assertWrite(actor.agentId, path, null, { isNew: true });
        const sameName = this.index.countByName(linkKey(posix.basename(path)));
        if (sameName > 0 && isMarkdown(path)) {
          warning = `another note is named "${titleOf(path)}": short links [[${titleOf(path)}]] may point to it`;
        }
        text = isMarkdown(path)
          ? this.#withNewNoteProps(input.content, input.frontmatter, actor.agentId, now, {
              // A sub-agent cannot sign a note with someone else's name.
              ...(this.permissions.isPrivileged(actor.agentId)
                ? {}
                : { force: { author: actor.agentId } }),
            })
          : input.content;
      } else {
        if (!current) {
          throw new ToolError('NOT_FOUND', `${path} does not exist`, {
            hint: 'Use mode "create".',
          });
        }
        const old = isMarkdown(path) ? parseNote(path, current.text) : null;
        this.permissions.assertRead(actor.agentId, path, old?.private ?? false);
        this.permissions.assertWrite(actor.agentId, path, old?.author ?? null);
        if (current.hash !== input.base_hash) throw this.#conflict(path, input.base_hash!, current);
        // Properties not passed again are kept (tags, aliases, private…): `content`
        // and `frontmatter` win on the keys they set.
        const base: Props = { ...(old?.props ?? {}) };
        for (const key of ['id', 'created', 'updated', 'author']) delete base[key];
        const keepPrivate = old?.private && !this.permissions.isPrivileged(actor.agentId);
        const ownBlock = isMarkdown(path) && scanMarkdown(input.content).frontmatter !== null;
        if (old?.frontmatterError && !ownBlock) {
          // Properties that do not parse cannot be merged: the block stays as it was
          // (never replaced by a new one with a new id) and only the body changes.
          if (input.frontmatter && Object.keys(input.frontmatter).length > 0) {
            throw new ToolError(
              'INVALID_INPUT',
              `the properties of ${path} are not valid YAML, so they cannot be changed: ${old.frontmatterError}`,
              {
                hint: 'Fix the frontmatter first (write the whole note with a valid --- block), or change only the text.',
              },
            );
          }
          text = current.text.slice(0, old.scan.bodyStart) + ensureNewline(input.content);
        } else {
          text = isMarkdown(path)
            ? this.#withNewNoteProps(input.content, input.frontmatter, actor.agentId, now, {
                keep: {
                  id: old?.uid ?? ulid(),
                  created: old?.created ?? now,
                  author: old?.author ?? actor.agentId,
                },
                base,
                ...(keepPrivate ? { force: { private: true } } : {}),
              })
            : input.content;
        }
      }
      const hash = contentHash(text);
      return {
        changes: [{ path, content: text }],
        summary: path,
        vaultChange: { action: mode === 'create' ? meta.action : 'edit', path },
        result: (base) => ({ ...base, path, hash, ...(warning ? { warning } : {}) }),
      };
    });
  }

  /**
   * Content of a note with the system properties (id, created, updated, author)
   * set. `keep` holds the system properties of the note being replaced, `base`
   * its other properties (kept unless `content` or `frontmatter` set them) and
   * `force` properties that always win.
   */
  #withNewNoteProps(
    content: string,
    frontmatter: Props | undefined,
    agentId: string,
    now: string,
    opts: {
      keep?: { id: string; created: string; author: string };
      base?: Props;
      force?: Props;
    } = {},
  ): string {
    const { keep, base = {}, force = {} } = opts;
    const body = ensureNewline(content);
    const fromContent = readFrontmatter(body);
    if (fromContent.error) {
      throw new ToolError(
        'INVALID_INPUT',
        `the frontmatter in content is not valid YAML: ${fromContent.error}`,
      );
    }
    const hasBlock = scanMarkdown(body).frontmatter !== null;
    const user = { ...(frontmatter ?? {}) };
    delete user.id;
    // `created` is Monsters' (LEGGIMI): only the user may backdate a note, an agent's date is invented.
    const byAgent = agentId !== USER_AUTHOR.name;
    if (byAgent) delete user.created;
    if (!hasBlock) {
      const props: Props = {
        id: keep?.id ?? ulid(),
        type: user.type ?? base.type ?? 'note',
        ...base,
        ...user,
        created: keep?.created ?? now,
        updated: now,
        author: keep?.author ?? agentId,
      };
      if (!byAgent && frontmatter && 'created' in frontmatter && !keep) {
        props.created = frontmatter.created;
      }
      return buildFrontmatter({ ...props, ...force }) + body;
    }
    return updateFrontmatter(body, {
      setIfMissing: {
        id: keep?.id ?? ulid(),
        type: base.type ?? 'note',
        ...base,
        created: keep?.created ?? now,
        author: keep?.author ?? agentId,
      },
      set: {
        ...user,
        ...(byAgent ? { created: keep?.created ?? now } : {}),
        updated: now,
        ...(keep ? { id: keep.id, author: keep.author } : {}),
        ...force,
      },
    });
  }

  /**
   * Refuses agent changes that leave the frontmatter invalid (bad YAML, alias
   * bombs). A note whose frontmatter was already broken can still have its
   * body edited, as long as the broken block is left as it was.
   */
  #assertValidFrontmatter(before: string | null, after: string): void {
    const fm = readFrontmatter(after);
    if (!fm.error) return;
    if (before !== null && findFrontmatter(before)?.yaml === findFrontmatter(after)?.yaml) return;
    throw new ToolError('INVALID_INPUT', `the frontmatter would not be valid YAML: ${fm.error}`, {
      hint: 'Use plain key: value properties (no YAML aliases &name / *name) or set_props.',
    });
  }

  async #freeName(path: string): Promise<string> {
    const dir = posix.dirname(path) === '.' ? '' : `${posix.dirname(path)}/`;
    const ext = isMarkdown(path) ? '.md' : '';
    const base = titleOf(path).replace(ext, '');
    for (let i = 2; i < 1000; i++) {
      const candidate = `${dir}${base} (${i})${ext}`;
      if (!(await existsFile(await this.#abs(candidate)))) return candidate;
    }
    return `${dir}${base} (${ulid()})${ext}`;
  }

  async edit(
    actor: VaultActor,
    input: { path: string; base_hash: string; ops: EditOp[] },
  ): Promise<WriteResult & { diff: string }> {
    const path = await this.resolveExisting(input.path);
    return this.#act(actor, 'vault_edit', input, [path], async () => {
      const current = await this.#readText(path);
      if (!current) throw new ToolError('NOT_FOUND', `note not found: ${input.path}`);
      if (!isMarkdown(path)) throw new ToolError('INVALID_INPUT', `${path} is not a Markdown note`);
      const note = parseNote(path, current.text);
      const dailyAppend = input.ops.every(
        (op) =>
          'append' in op &&
          op.append.section
            ?.replace(/^#+\s*/, '')
            .trim()
            .toLowerCase() === this.layout.dailyAgentsSection.toLowerCase(),
      );
      this.permissions.assertRead(actor.agentId, path, note.private);
      this.permissions.assertWrite(actor.agentId, path, note.author, {
        dailyAgentsAppend: dailyAppend,
      });
      if (current.hash !== input.base_hash) throw this.#conflict(path, input.base_hash, current);
      const edited = applyOps(current.text, input.ops);
      this.#assertValidFrontmatter(current.text, edited);
      const text = this.#touch(edited, note);
      return {
        changes: [{ path, content: text }],
        summary: path,
        vaultChange: { action: 'edit', path },
        result: (base) => ({
          ...base,
          path,
          hash: contentHash(text),
          diff: lineDiff(current.text, text),
        }),
      };
    });
  }

  /** Sets `updated` (and `id` when missing) after an agent edit; leaves invalid YAML alone. */
  #touch(text: string, before: ParsedNote): string {
    if (before.frontmatterError) return text;
    try {
      return updateFrontmatter(text, { setIfMissing: { id: ulid() }, set: { updated: nowIso() } });
    } catch {
      return text;
    }
  }

  async move(
    actor: VaultActor,
    input: { from: string; to: string; update_links?: boolean | undefined },
  ): Promise<WriteResult & { from: string; updated_files: string[] }> {
    const from = await this.resolveExisting(input.from);
    let to = normalizePath(input.to);
    if (to === '' || input.to.trim().endsWith('/')) {
      to = to === '' ? posix.basename(from) : `${to}/${posix.basename(from)}`;
    } else {
      const st = await stat(await this.#abs(to)).catch(() => null);
      if (st?.isDirectory()) to = `${to}/${posix.basename(from)}`;
      else if (isMarkdown(from) && !hasExtension(to)) to = `${to}.md`;
    }
    if (to === from) throw new ToolError('INVALID_INPUT', 'source and destination are the same');
    assertValidNewPath(to, this.#filesDir);
    const fromRow = this.#row(from);
    const updateLinks = input.update_links ?? true;
    const sources = fromRow && updateLinks ? this.index.backlinkPaths(fromRow.nid) : [];

    return this.#act(actor, 'vault_move', input, [from, to, ...sources], async () => {
      const current = await this.#readText(from);
      if (!current) throw new ToolError('NOT_FOUND', `note not found: ${input.from}`);
      if (await existsFile(await this.#abs(to))) {
        throw new ToolError('EXISTS', `${to} already exists`, {
          hint: `Choose another name, e.g. "${await this.#freeName(to)}".`,
        });
      }
      const note = isMarkdown(from) ? parseNote(from, current.text) : null;
      this.permissions.assertMove(actor.agentId, from, to, note?.author ?? null);

      const changes: FileChange[] = [];
      const updated: string[] = [];
      let movedContent: string | Uint8Array = isMarkdown(from) ? current.text : current.bytes;
      if (updateLinks && fromRow) {
        // Name taken by another file after the move → links must use the path.
        const othersWithName =
          this.index.countByName(linkKey(posix.basename(to))) -
          (linkKey(posix.basename(to)) === linkKey(posix.basename(from)) ? 1 : 0);
        const wikiTarget =
          othersWithName > 0 ? (isMarkdown(to) ? to.slice(0, -3) : to) : titleOf(to);
        const rewrite = (text: string, srcPath: string, newSrcPath: string) =>
          this.#rewriteLinks(text, srcPath, newSrcPath, fromRow.nid, to, wikiTarget);
        if (typeof movedContent === 'string') movedContent = rewrite(movedContent, from, to);
        for (const src of sources) {
          if (src === from) continue;
          const file = await this.#readText(src);
          if (!file) continue;
          const text = rewrite(file.text, src, src);
          if (text !== file.text) {
            changes.push({ path: src, content: this.#touch(text, parseNote(src, file.text)) });
            updated.push(src);
          }
        }
      }
      changes.unshift({ path: to, content: movedContent }, { path: from, content: null });
      const hash = contentHash(movedContent);
      return {
        changes,
        summary: `${from} → ${to}${updated.length ? ` (+${updated.length} link)` : ''}`,
        vaultChange: { action: 'move', path: to, fromPath: from },
        result: (base) => ({ ...base, path: to, from, hash, updated_files: updated }),
      };
    });
  }

  /** Rewrites the links of `text` that point to note `targetNid`, keeping alias, heading, block and `!`. */
  #rewriteLinks(
    text: string,
    srcPath: string,
    newSrcPath: string,
    targetNid: number,
    newPath: string,
    wikiTarget: string,
  ): string {
    if (!isMarkdown(srcPath)) return text;
    const note = parseNote(srcPath, text);
    const edits: { start: number; end: number; value: string }[] = [];
    for (const link of note.links) {
      if (link.target === '') continue;
      const resolved = this.index.resolve(link.kind, link.target, srcPath);
      if (resolved?.nid !== targetNid) continue;
      let value: string;
      if (link.kind === 'wiki') {
        value = wikiTarget;
      } else {
        const relative = link.target.startsWith('./') || link.target.startsWith('../');
        let href = relative ? posix.relative(posix.dirname(newSrcPath), newPath) : newPath;
        if (relative && !href.startsWith('.')) href = `./${href}`;
        value = href.replace(/ /g, '%20');
      }
      if (text.slice(link.targetStart, link.targetEnd) !== value) {
        edits.push({ start: link.targetStart, end: link.targetEnd, value });
      }
    }
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, e.start) + e.value + out.slice(e.end);
    }
    return out;
  }

  async delete(
    actor: VaultActor,
    input: { path: string; reason: string },
  ): Promise<WriteResult & { trash_path: string }> {
    const path = await this.resolveExisting(input.path);
    return this.#act(actor, 'vault_delete', input, [path], async () => {
      const current = await this.#readText(path);
      if (!current) throw new ToolError('NOT_FOUND', `note not found: ${input.path}`);
      const note = isMarkdown(path) ? parseNote(path, current.text) : null;
      this.permissions.assertDelete(actor.agentId, path, note?.author ?? null);
      const trashPath = await this.#trashPath(path);
      return {
        changes: [{ path, content: null, trashTo: trashPath }],
        summary: path,
        body: input.reason,
        vaultChange: { action: 'delete', path },
        result: (base) => ({ ...base, path, hash: current.hash, trash_path: trashPath }),
      };
    });
  }

  /** Same scheme as Obsidian: `.trash/<name>`, with a numeric suffix on collision. */
  async #trashPath(path: string, reserved: Set<string> = new Set()): Promise<string> {
    const base = posix.basename(path);
    const dot = base.lastIndexOf('.');
    const name = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let found = `${TRASH}/${name} ${ulid()}${ext}`;
    for (let i = 0; i < 10_000; i++) {
      const candidate = `${TRASH}/${i === 0 ? base : `${name} ${i}${ext}`}`;
      if (reserved.has(candidate)) continue;
      if (!(await existsFile(await this.#abs(candidate)))) {
        found = candidate;
        break;
      }
    }
    reserved.add(found);
    return found;
  }

  /** Removes from `.trash/` the copies of a restored file (same name, same content). */
  async #dropTrashCopies(path: string, bytes: Uint8Array): Promise<void> {
    const base = posix.basename(path);
    const dot = base.lastIndexOf('.');
    const name = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    const trash = await this.#absOrNull(TRASH);
    if (trash === null) return;
    const entries = await readdir(trash).catch(() => [] as string[]);
    const hash = contentHash(bytes);
    for (const entry of entries) {
      if (entry !== base && !(entry.startsWith(`${name} `) && entry.endsWith(ext))) continue;
      const abs = await this.#absOrNull(`${TRASH}/${entry}`);
      if (abs === null) continue;
      const data = await readIfExists(abs);
      if (data && contentHash(data) === hash) await rm(abs, { force: true });
    }
  }

  // --- history ---------------------------------------------------------------------

  #requireGit(): VaultVcs {
    if (!this.#vcs) {
      throw new ToolError('UNAVAILABLE', 'this vault has no git history', {
        hint: 'Open the vault with initGit to enable history, undo and restore.',
      });
    }
    return this.#vcs;
  }

  async history(
    actor: VaultActor,
    input: { path?: string | undefined; limit?: number | undefined },
  ): Promise<
    { commit: string; date: string; author: string; action_id: string | null; message: string }[]
  > {
    const vcs = this.#requireGit();
    const limit = input.limit ?? 20;
    const toEntry = (c: CommitInfo) => ({
      commit: c.oid,
      date: localIso(c.timestamp * 1000),
      author: c.author.name,
      action_id: parseTrailers(c.message)[TRAILER_ACTION] ?? null,
      message: c.message.split('\n')[0]?.trim() ?? '',
    });
    if (!input.path) {
      if (this.permissions.isPrivileged(actor.agentId)) {
        return (await vcs.log({ depth: limit })).map(toEntry);
      }
      // Commit messages name the files they touch: hide those about private notes.
      const out: ReturnType<typeof toEntry>[] = [];
      for (const c of await vcs.log({ depth: HISTORY_SCAN_DEPTH })) {
        if (!(await this.#commitReadable(actor.agentId, vcs, c))) continue;
        out.push(toEntry(c));
        if (out.length >= limit) break;
      }
      return out;
    }

    const path = normalizeNotePath(input.path);
    const row = this.#row(path);
    this.permissions.assertRead(actor.agentId, path, row?.private === 1);
    const { entries } = await this.#lineage(vcs, actor.agentId, path, { limit });
    return entries.map(toEntry);
  }

  /**
   * The commits that changed the file now at `path`, newest first, following
   * renames (a `vault_move`, or the same content removed elsewhere by the commit
   * that created it): `pathAt` says which path the file had at each commit
   * scanned (up to `until`, when given). Renames from paths `agent` may not
   * read are not followed.
   */
  async #lineage(
    vcs: VaultVcs,
    agent: string,
    path: string,
    opts: { limit?: number; until?: string } = {},
  ): Promise<{ entries: CommitInfo[]; pathAt: Map<string, string> }> {
    const limit = opts.limit ?? Infinity;
    const commits = await vcs.log({ depth: HISTORY_SCAN_DEPTH });
    const entries: CommitInfo[] = [];
    const pathAt = new Map<string, string>();
    let cur = path;
    let newerOid: string | null | undefined;
    let newer: CommitInfo | undefined;
    for (const c of commits) {
      let oid = await vcs.fileOid(c.oid, cur);
      let renamed = false;
      if (newer && oid === null && newerOid !== null) {
        const from = await this.#renamedFrom(vcs, newer, cur);
        if (
          from !== null &&
          this.permissions.canRead(agent, from, this.#row(from)?.private === 1)
        ) {
          cur = from;
          oid = await vcs.fileOid(c.oid, cur);
          renamed = true;
        }
      }
      if (newer && (renamed || newerOid !== oid)) {
        entries.push(newer);
        if (entries.length >= limit) return { entries, pathAt };
      }
      pathAt.set(c.oid, cur);
      if (c.oid === opts.until) return { entries, pathAt };
      newer = c;
      newerOid = oid;
    }
    if (newer && newerOid !== null && entries.length < limit) entries.push(newer);
    return { entries, pathAt };
  }

  /** Where the file at `path` was before commit `c`, when `c` renamed it (else null). */
  async #renamedFrom(vcs: VaultVcs, c: CommitInfo, path: string): Promise<string | null> {
    const first = c.message.split('\n')[0] ?? '';
    const m = /^vault_move: (.+?) → (.+?)(?: \(\+\d+ link\))? \[agent=\S+ action=\S+\]$/.exec(
      first,
    );
    if (m && m[2] === path) return m[1]!;
    const parent = c.parents[0];
    const oid = parent ? await vcs.fileOid(c.oid, path) : null;
    if (!parent || oid === null) return null;
    // A rename outside Monsters (snapshot): the same content left another path.
    for (const f of await vcs.changedFiles(c.oid)) {
      if (f === path || isSystemPath(f)) continue;
      if ((await vcs.fileOid(c.oid, f)) !== null) continue;
      if ((await vcs.fileOid(parent, f)) === oid) return f;
    }
    return null;
  }

  /**
   * A file as a commit left it, next to the version before that commit, with a
   * line diff: what one entry of the history changed.
   */
  async version(
    actor: VaultActor,
    input: { path: string; commit: string },
  ): Promise<{
    path: string;
    commit: string;
    parent: string | null;
    before: string | null;
    after: string | null;
    diff: string;
  }> {
    const vcs = this.#requireGit();
    const path = normalizeNotePath(input.path);
    if (isSystemPath(path))
      throw new ToolError('BLOCKED_BY_POLICY', `${path} is managed by the system`);
    const commit = await this.#expandCommit(vcs, input.commit);
    const info = (await vcs.log({ ref: commit, depth: 1 }).catch(() => []))[0];
    if (!info) throw new ToolError('NOT_FOUND', `commit not found: ${input.commit}`);
    const parent = info.parents[0] ?? null;
    let afterBytes = await vcs.readFile(info.oid, path);
    let beforeBytes = parent ? await vcs.readFile(parent, path) : null;
    const seenAs = [path];
    if (!afterBytes || (parent && !beforeBytes)) {
      // The note had another name then (renamed later, or by this very commit).
      const until = parent ?? info.oid;
      const { pathAt } = await this.#lineage(vcs, actor.agentId, path, { until });
      const thenPath = pathAt.get(info.oid);
      if (!afterBytes && thenPath && thenPath !== path) {
        afterBytes = await vcs.readFile(info.oid, thenPath);
        seenAs.push(thenPath);
      }
      const parentPath = parent ? pathAt.get(parent) : undefined;
      if (parent && !beforeBytes && parentPath && parentPath !== path) {
        beforeBytes = await vcs.readFile(parent, parentPath);
        seenAs.push(parentPath);
      }
    }
    if (!afterBytes && !beforeBytes) {
      throw new ToolError('NOT_FOUND', `${path} is not in commit ${info.oid.slice(0, 7)}`);
    }
    const after = afterBytes ? Buffer.from(afterBytes).toString('utf8') : null;
    const before = beforeBytes ? Buffer.from(beforeBytes).toString('utf8') : null;
    const md = isMarkdown(path);
    const isPrivate =
      this.#row(path)?.private === 1 ||
      (md && [after, before].some((t) => t !== null && parseNote(path, t).private));
    for (const p of seenAs) this.permissions.assertRead(actor.agentId, p, isPrivate);
    return {
      path,
      commit: info.oid,
      parent,
      before,
      after,
      diff: lineDiff(before ?? '', after ?? '', 3, 400),
    };
  }

  /**
   * The files in `.trash/`, newest first, each with the note it was (path,
   * who deleted it and when) when a commit of the vault says so. Files moved
   * there outside Monsters (Obsidian) have no original path: they cannot be
   * restored from here.
   */
  async trash(actor: VaultActor): Promise<
    {
      trash_path: string;
      title: string;
      original_path: string | null;
      deleted_at: string | null;
      deleted_by: string | null;
      action_id: string | null;
      private: boolean;
      size: number;
    }[]
  > {
    const dir = await this.#absOrNull(TRASH);
    if (dir === null) return [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files: { name: string; bytes: Buffer; mtime: number }[] = [];
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.')) continue;
      const abs = await this.#absOrNull(`${TRASH}/${e.name}`);
      if (abs === null) continue;
      const bytes = await readIfExists(abs);
      if (!bytes) continue;
      files.push({ name: e.name, bytes, mtime: (await stat(abs)).ctimeMs });
    }
    files.sort((a, b) => b.mtime - a.mtime);

    // Deletions recorded in git (vault_delete, and undoing a creation), newest first.
    const deletions: { path: string; commit: CommitInfo; agent: string; action: string | null }[] =
      [];
    if (this.#vcs && files.length > 0) {
      const vcs = this.#vcs;
      for (const c of await vcs.log({ depth: HISTORY_SCAN_DEPTH })) {
        const first = c.message.split('\n')[0] ?? '';
        const m = /^(vault_delete|vault_undo): (.+?) \[agent=\S+ action=\S+\]$/.exec(first);
        if (!m) continue;
        const trailers = parseTrailers(c.message);
        const agent = trailers[TRAILER_AGENT] ?? c.author.name;
        const action = trailers[TRAILER_ACTION] ?? null;
        const paths = m[1] === 'vault_delete' ? [m[2]!] : await vcs.changedFiles(c.oid);
        for (const p of paths) {
          if (isSystemPath(p)) continue;
          // An undo also changes files it does not remove: only those gone after it count.
          if (m[1] === 'vault_undo' && (await vcs.fileOid(c.oid, p)) !== null) continue;
          // The path may hold a new note by now: the deletion still tells where this one was.
          deletions.push({ path: p, commit: c, agent, action });
        }
      }
    }

    const stem = (name: string) => {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      return {
        base: base.replace(/ (\d+|[0-9A-HJKMNP-TV-Z]{26})$/, ''),
        ext: name.slice(base.length),
      };
    };
    const used = new Set<number>();
    const out = [];
    for (const f of files) {
      const s = stem(f.name);
      const hash = contentHash(f.bytes);
      const candidates = deletions
        .map((d, i) => ({ d, i }))
        .filter(({ d, i }) => {
          if (used.has(i)) return false;
          const target = stem(posix.basename(d.path));
          return target.base === s.base && target.ext === s.ext;
        });
      let match = candidates[0];
      // The deletion whose content is the one in the trash (same name deleted more than once).
      if (this.#vcs) {
        for (const c of candidates) {
          const parent = c.d.commit.parents[0];
          const old = parent ? await this.#vcs.readFile(parent, c.d.path) : null;
          if (old && contentHash(old) === hash) {
            match = c;
            break;
          }
        }
      }
      if (match) used.add(match.i);
      const original = match?.d.path ?? null;
      const isPrivate =
        (original !== null &&
          (isInside(original, this.layout.private) || inAnyPrivateFolder(original))) ||
        (isMarkdown(f.name) && parseNote(f.name, f.bytes.toString('utf8')).private);
      if (!this.permissions.canRead(actor.agentId, original ?? f.name, isPrivate)) continue;
      out.push({
        trash_path: `${TRASH}/${f.name}`,
        title: original ? titleOf(original) : titleOf(f.name),
        original_path: original,
        deleted_at: match ? localIso(match.d.commit.timestamp * 1000) : null,
        deleted_by: match?.d.agent ?? null,
        action_id: match?.d.action ?? null,
        private: isPrivate,
        size: f.bytes.length,
      });
    }
    return out;
  }

  /** True when `agent` may read every file a commit touched (as it is now and in that commit). */
  async #commitReadable(agent: string, vcs: VaultVcs, c: CommitInfo): Promise<boolean> {
    for (const f of await vcs.changedFiles(c.oid)) {
      if (isSystemPath(f)) continue;
      if (!this.permissions.canRead(agent, f, this.#row(f)?.private === 1)) return false;
      if (!isMarkdown(f)) continue;
      const parent = c.parents[0];
      const bytes =
        (await vcs.readFile(c.oid, f)) ?? (parent ? await vcs.readFile(parent, f) : null);
      if (bytes && parseNote(f, Buffer.from(bytes).toString('utf8')).private) return false;
    }
    return true;
  }

  /** Accepts abbreviated commit ids (as shown by `git log --oneline`). */
  async #expandCommit(vcs: VaultVcs, commit: string): Promise<string> {
    if (/^[0-9a-f]{40}$/.test(commit)) return commit;
    const prefix = commit.toLowerCase();
    const match = (await vcs.log({ depth: HISTORY_SCAN_DEPTH })).find((c) =>
      c.oid.startsWith(prefix),
    );
    return match?.oid ?? commit;
  }

  /**
   * Brings a note back: a version of its history (`commit`), the last version
   * of a deleted note (`path` only), or one entry of the trash (`trash_path`,
   * the way the UI does it: the same path may have been deleted more than once).
   */
  async restore(
    actor: VaultActor,
    input:
      | { path: string; commit?: string | undefined; trash_path?: undefined }
      | { trash_path: string; path?: undefined; commit?: undefined },
  ): Promise<WriteResult & { restored_from: string }> {
    if (input.trash_path !== undefined) return this.#restoreFromTrash(actor, input.trash_path);
    const vcs = this.#requireGit();
    const path = normalizeNotePath(input.path);
    if (isSystemPath(path) || isHidden(path))
      throw new ToolError('BLOCKED_BY_POLICY', `${path} is managed by the system`);
    return this.#act(actor, 'vault_restore', input, [path], async () => {
      const current = await readIfExists(await this.#abs(path));
      let commit = input.commit;
      let bytes: Uint8Array | null = null;
      if (commit) {
        commit = await this.#expandCommit(vcs, commit);
        bytes = await vcs.readFile(commit, path).catch(() => null);
        if (!bytes) {
          // A version from before a rename: the file had another path in that commit.
          const lineage = await this.#lineage(vcs, actor.agentId, path, { until: commit });
          const then = lineage.pathAt.get(commit);
          if (then && then !== path) bytes = await vcs.readFile(commit, then).catch(() => null);
        }
        if (!bytes)
          throw new ToolError('NOT_FOUND', `${path} is not in commit ${commit}`, {
            hint: 'Use vault_history to list the versions.',
          });
      } else {
        if (current) {
          throw new ToolError(
            'INVALID_INPUT',
            `${path} exists: pass the commit of the version to restore`,
            {
              hint: 'Use vault_history with this path to pick a commit.',
            },
          );
        }
        for (const c of await vcs.log({ depth: HISTORY_SCAN_DEPTH })) {
          bytes = await vcs.readFile(c.oid, path);
          if (bytes) {
            commit = c.oid;
            break;
          }
        }
        if (!bytes || !commit)
          throw new ToolError('NOT_FOUND', `no previous version of ${path} in the history`);
      }
      const restored = Buffer.from(bytes);
      const restoredNote = isMarkdown(path) ? parseNote(path, restored.toString('utf8')) : null;
      const currentNote =
        current && isMarkdown(path) ? parseNote(path, current.toString('utf8')) : null;
      this.permissions.assertRead(
        actor.agentId,
        path,
        !!restoredNote?.private || !!currentNote?.private,
      );
      this.permissions.assertWrite(
        actor.agentId,
        path,
        currentNote?.author ?? restoredNote?.author ?? null,
      );
      const from = commit;
      return {
        changes: [{ path, content: restored }],
        summary: `${path} @ ${from.slice(0, 7)}`,
        vaultChange: { action: 'restore', path },
        result: (base) => ({ ...base, path, hash: contentHash(restored), restored_from: from }),
        after: () => this.#dropTrashCopies(path, restored),
      };
    });
  }

  /**
   * Puts one file of the trash back where it was, with the content it has in
   * the trash. When a new note took that path in the meantime, the restored
   * one gets a free name next to it (nothing is overwritten).
   */
  async #restoreFromTrash(
    actor: VaultActor,
    trashPath: string,
  ): Promise<WriteResult & { restored_from: string }> {
    this.#requireGit();
    const wanted = normalizePath(trashPath);
    const name = wanted.slice(TRASH.length + 1);
    if (!wanted.startsWith(`${TRASH}/`) || name === '' || name.includes('/')) {
      throw new ToolError('INVALID_INPUT', `${trashPath} is not a file of the trash`);
    }
    const item = (await this.trash(actor)).find((i) => i.trash_path === wanted);
    if (!item) throw new ToolError('NOT_FOUND', `${trashPath} is not in the trash`);
    const original = item.original_path;
    if (original === null) {
      throw new ToolError(
        'INVALID_INPUT',
        `${trashPath} was moved to the trash outside Monsters: where it was is unknown`,
        { hint: 'Restore it from Obsidian.' },
      );
    }
    const trashAbs = await this.#absOrNull(wanted);
    if (trashAbs === null) throw new ToolError('NOT_FOUND', `${trashPath} is not in the trash`);
    return this.#act(actor, 'vault_restore', { trash_path: wanted }, [original], async () => {
      const bytes = await readIfExists(trashAbs);
      if (!bytes) throw new ToolError('NOT_FOUND', `${trashPath} is not in the trash`);
      const target = (await existsFile(await this.#abs(original)))
        ? await this.#freeName(original)
        : original;
      const note = isMarkdown(target) ? parseNote(target, bytes.toString('utf8')) : null;
      this.permissions.assertRead(actor.agentId, target, item.private || !!note?.private);
      this.permissions.assertWrite(actor.agentId, target, note?.author ?? null);
      return {
        changes: [{ path: target, content: bytes }],
        summary: `${target} ← ${wanted}`,
        vaultChange: { action: 'restore', path: target },
        result: (base) => ({
          ...base,
          path: target,
          hash: contentHash(bytes),
          restored_from: wanted,
        }),
        after: () => rm(trashAbs, { force: true }),
      };
    });
  }

  /**
   * Undoes one action with a new commit. Sub-agents undo only their own
   * actions, and only on files they may read and write; files the action
   * created go to `.trash/` (never deleted).
   */
  async undo(
    actor: VaultActor,
    input: { action_id: string; force?: boolean | undefined },
  ): Promise<WriteResult & { files: string[]; undone_action: string }> {
    const vcs = this.#requireGit();
    const recorded = this.index.getAction(input.action_id);
    if (recorded?.status === 'undone') {
      throw new ToolError('INVALID_INPUT', `action ${input.action_id} was already undone`);
    }
    let info: CommitInfo | undefined;
    if (recorded?.commit) {
      info = (await vcs.log({ ref: recorded.commit, depth: 1 }))[0];
    } else {
      for (const c of await vcs.log({ depth: HISTORY_SCAN_DEPTH })) {
        if (parseTrailers(c.message)[TRAILER_ACTION] === input.action_id) {
          info = c;
          break;
        }
      }
    }
    if (!info) {
      throw new ToolError('NOT_FOUND', `action not found: ${input.action_id}`, {
        hint: 'Use vault_history to find action ids.',
      });
    }
    const doneBy = recorded?.agent ?? parseTrailers(info.message)[TRAILER_AGENT] ?? null;
    const privileged = this.permissions.isPrivileged(actor.agentId);
    if (!privileged && doneBy !== actor.agentId) {
      throw new ToolError(
        'BLOCKED_BY_POLICY',
        `${actor.agentId} can undo only its own actions (${input.action_id} was done by ${doneBy ?? 'someone else'})`,
        { hint: 'Ask the orchestrator to undo it, or propose a change with vault_propose.' },
      );
    }
    const target = info.oid;
    const files = (await vcs.changedFiles(target)).filter((f) => !isSystemPath(f));
    const parent = info.parents[0] ?? null;
    if (files.length === 0)
      throw new ToolError('INVALID_INPUT', `action ${input.action_id} changed no files`);

    return this.#act(actor, 'vault_undo', input, files, async () => {
      const changes: FileChange[] = [];
      const changedSince: string[] = [];
      const reservedTrash = new Set<string>();
      for (const f of files) {
        const after = await vcs.readFile(target, f);
        const before = parent ? await vcs.readFile(parent, f) : null;
        const disk = await readIfExists(await this.#abs(f));
        const diskOid = disk ? gitBlobOid(disk) : null;
        const afterOid = after ? gitBlobOid(after) : null;
        if (diskOid !== afterOid) changedSince.push(f);
        // Permissions on every file touched: as it is now, after the action and before it.
        const notes = isMarkdown(f)
          ? [disk, after, before].flatMap((b) =>
              b ? [parseNote(f, Buffer.from(b).toString('utf8'))] : [],
            )
          : [];
        this.permissions.assertRead(
          actor.agentId,
          f,
          notes.some((n) => n.private),
        );
        this.permissions.assertWrite(actor.agentId, f, notes[0]?.author ?? null);
        if (before) {
          changes.push({ path: f, content: Buffer.from(before) });
        } else {
          // The action created the file: undoing it moves it to the trash.
          changes.push({
            path: f,
            content: null,
            ...(disk ? { trashTo: await this.#trashPath(f, reservedTrash) } : {}),
          });
        }
      }
      if (changedSince.length > 0 && !input.force) {
        const later = await this.#laterChanges(vcs, target, changedSince);
        const by = later
          .map((l) =>
            l.action_id
              ? `${l.message.split(':')[0]} by ${l.agent} (action ${l.action_id})`
              : `edit made outside Monsters (commit ${l.commit.slice(0, 7)})`,
          )
          .join('; ');
        throw new ToolError(
          'CONFLICT',
          `changed after the action: ${changedSince.join(', ')}${by ? `. Later changes: ${by}` : ''}`,
          {
            hint: 'Undo would discard those later changes: pass force: true, or use vault_restore on single files.',
            details: { files: changedSince, later },
          },
        );
      }
      const main = changes.find((c) => c.content !== null)?.path ?? files[0] ?? '';
      return {
        changes,
        summary: files.length === 1 ? files[0]! : `${files.length} file`,
        body: scaffoldStrings(this.layout.id).commitUndo(input.action_id, target.slice(0, 7)),
        vaultChange: { action: 'undo', path: main, undoneActionId: input.action_id },
        result: (base) => ({
          ...base,
          path: main,
          hash: (() => {
            const c = changes.find((x) => x.path === main)?.content;
            return c ? contentHash(c) : '';
          })(),
          files,
          undone_action: input.action_id,
        }),
        after: async () => {
          if (recorded) this.index.setActionStatus(input.action_id, 'undone');
          for (const c of changes) {
            if (c.content !== null && typeof c.content !== 'string')
              await this.#dropTrashCopies(c.path, c.content);
          }
        },
      };
    });
  }

  /** Commits after `target` (newest first) that touched some of `files`: what blocks an undo. */
  async #laterChanges(
    vcs: VaultVcs,
    target: string,
    files: readonly string[],
  ): Promise<LaterChange[]> {
    const out: LaterChange[] = [];
    for (const c of await vcs.log({ depth: HISTORY_SCAN_DEPTH })) {
      if (c.oid === target) break;
      const touched = (await vcs.changedFiles(c.oid)).filter((f) => files.includes(f));
      if (touched.length === 0) continue;
      const trailers = parseTrailers(c.message);
      out.push({
        commit: c.oid,
        action_id: trailers[TRAILER_ACTION] ?? null,
        agent: trailers[TRAILER_AGENT] ?? c.author.name,
        message: c.message.split('\n')[0]?.trim() ?? '',
        files: touched,
      });
      if (out.length >= 10) break;
    }
    return out;
  }

  // --- proposals -------------------------------------------------------------------

  /**
   * Creates a proposal note in `Inbox/` and records the proposal (operations,
   * base hash, author) in the index database, out of the agents' reach:
   * `vault_apply_proposal` applies that record, never what the note says.
   */
  async propose(
    actor: VaultActor,
    input: { path: string; ops: EditOp[]; note: string },
  ): Promise<WriteResult & { proposal_path: string; diff: string }> {
    const target = await this.resolveExisting(input.path);
    const file = await this.#readText(target);
    if (!file || !isMarkdown(target))
      throw new ToolError('NOT_FOUND', `note not found: ${input.path}`);
    const note = parseNote(target, file.text);
    this.permissions.assertRead(actor.agentId, target, note.private);
    const ops = EditOpsSchema.parse(input.ops);
    const proposed = applyOps(file.text, ops);
    this.#assertValidFrontmatter(file.text, proposed);
    const diff = lineDiff(file.text, proposed);
    const opsJson = JSON.stringify(ops, null, 2);
    const proposalId = ulid();
    const stamp = nowIso().slice(0, 16).replace('T', ' ').replace(':', '');
    // The proposal note speaks the vault's words (D-154), whatever the app's language.
    const texts = scaffoldStrings(this.layout.id);
    const name = texts.proposalName(
      this.permissions.displayName(actor.agentId),
      titleOf(target),
      stamp,
    );
    const proposalPath = await this.#freeIfTaken(`${this.layout.inbox}/${name}.md`);
    const body = [
      texts.proposalTitle(titleOf(target)),
      '',
      input.note.trim(),
      '',
      texts.proposalDiff,
      '',
      '```diff',
      diff,
      '```',
      '',
      texts.proposalOps,
      '',
      texts.proposalApplied,
      '',
      '```json monsters-ops',
      opsJson,
      '```',
      '',
    ].join('\n');
    const result = await this.write(
      actor,
      {
        path: proposalPath,
        content: body,
        frontmatter: {
          type: 'proposal',
          status: 'pending',
          proposal_id: proposalId,
          target: `[[${titleOf(target)}]]`,
          target_path: target,
          base_hash: file.hash,
        },
        mode: 'create',
      },
      { tool: 'vault_propose', action: 'propose' },
    );
    this.index.addProposal({
      id: proposalId,
      path: result.path,
      author: actor.agentId,
      target_path: target,
      base_hash: file.hash,
      ops_json: opsJson,
      ops_hash: contentHash(opsJson),
      body_hash: contentHash(ensureNewline(body)),
    });
    return { ...result, proposal_path: result.path, diff };
  }

  async #freeIfTaken(path: string): Promise<string> {
    return (await existsFile(await this.#abs(path))) ? this.#freeName(path) : path;
  }

  /**
   * Applies a proposal: the operations recorded by `vault_propose`, only on the
   * version of the target they were computed on, and only if the proposal note
   * (its diff and operations) is unchanged. The returned diff is computed from
   * the operations actually applied.
   */
  async applyProposal(
    actor: VaultActor,
    input: { proposal_path: string },
  ): Promise<WriteResult & { proposal_path: string; diff: string }> {
    if (!this.permissions.isPrivileged(actor.agentId)) {
      throw new ToolError('BLOCKED_BY_POLICY', 'only the orchestrator applies proposals', {
        hint: 'Ask the orchestrator to review the proposal.',
      });
    }
    const proposalPath = await this.resolveExisting(input.proposal_path);
    const proposal = await this.#readText(proposalPath);
    if (!proposal) throw new ToolError('NOT_FOUND', `proposal not found: ${input.proposal_path}`);
    const record = this.#proposalRecord(proposalPath, proposal.text);
    let ops: EditOp[];
    try {
      if (contentHash(record.ops_json) !== record.ops_hash) throw new Error('ops hash mismatch');
      ops = EditOpsSchema.parse(JSON.parse(record.ops_json));
    } catch {
      throw new ToolError('INVALID_INPUT', `the operations of ${proposalPath} are damaged`, {
        hint: 'Ask the author for a new proposal with vault_propose.',
      });
    }
    const target = record.target_path;

    return this.#act(actor, 'vault_apply_proposal', input, [target, proposalPath], async () => {
      const now = await this.#readText(proposalPath);
      if (!now || now.hash !== proposal.hash) {
        throw new ToolError('CONFLICT', `${proposalPath} changed while applying it`, {
          hint: 'Read the proposal again, then apply it.',
        });
      }
      const current = await this.#readText(target);
      if (!current) throw new ToolError('NOT_FOUND', `note not found: ${target}`);
      if (current.hash !== record.base_hash) {
        throw new ToolError('CONFLICT', `${target} changed since the proposal was made`, {
          hint: 'The proposed diff no longer matches the note: ask the author for a new proposal on the current version.',
          details: { path: target, base_hash: record.base_hash, current_hash: current.hash },
        });
      }
      const before = parseNote(target, current.text);
      const proposed = applyOps(current.text, ops);
      this.#assertValidFrontmatter(current.text, proposed);
      const text = this.#touch(proposed, before);
      const stamp = nowIso();
      const proposalText = updateFrontmatter(proposal.text, {
        set: { status: 'applied', applied_by: actor.agentId, applied_at: stamp, updated: stamp },
      });
      return {
        changes: [
          { path: target, content: text },
          { path: proposalPath, content: proposalText },
        ],
        summary: `${target} da ${proposalPath}`,
        vaultChange: { action: 'edit', path: target },
        result: (base) => ({
          ...base,
          path: target,
          hash: contentHash(text),
          proposal_path: proposalPath,
          diff: lineDiff(current.text, text),
        }),
        after: () => this.index.setProposalStatus(record.id, 'applied'),
      };
    });
  }

  /** The recorded proposal behind a proposal note, checked against the note. */
  #proposalRecord(proposalPath: string, text: string): ProposalRecord {
    const parsed = parseNote(proposalPath, text);
    if (parsed.props.type !== 'proposal') {
      throw new ToolError('INVALID_INPUT', `${proposalPath} is not a proposal`);
    }
    const id = parsed.props.proposal_id;
    const record = typeof id === 'string' ? this.index.getProposal(id) : undefined;
    if (!record || record.path !== proposalPath) {
      throw new ToolError(
        'INVALID_INPUT',
        `${proposalPath} is not a proposal recorded by vault_propose`,
        { hint: 'Only proposals made with vault_propose can be applied: ask for a new one.' },
      );
    }
    if (record.status !== 'pending') {
      throw new ToolError('INVALID_INPUT', `proposal already ${record.status}`);
    }
    if (contentHash(parsed.body) !== record.body_hash) {
      throw new ToolError(
        'INVALID_INPUT',
        `${proposalPath} was changed after it was proposed: its diff or operations may not match`,
        { hint: 'Ask the author for a new proposal with vault_propose.' },
      );
    }
    return record;
  }
}
