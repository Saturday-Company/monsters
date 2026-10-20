import { z } from 'zod';

/*
 * Vault view of the UI (M2.8): the user browses, searches, reads, restores and
 * edits the notes. The user owns the vault: private notes are visible (marked).
 *
 *   GET  /api/vault/notes                         → VaultOverview (list, tags, graph)
 *   GET  /api/vault/search?q&mode&tags&folder&limit → VaultSearchResponse
 *   GET  /api/vault/note?path                     → VaultNote (path, title or alias)
 *   GET  /api/vault/related?path&limit            → VaultSearchResponse
 *   GET  /api/vault/history?path&limit            → VaultHistoryResponse
 *   GET  /api/vault/version?path&commit           → VaultVersion (diff of one commit)
 *   GET  /api/vault/trash                         → VaultTrashResponse
 *   POST /api/vault/restore   VaultRestoreRequest → VaultWriteResponse (a version, or a trash entry)
 *   POST /api/vault/delete    VaultDeleteRequest  → VaultWriteResponse (to `.trash/`)
 *   PUT  /api/vault/note      VaultSaveRequest    → VaultWriteResponse (needs `baseHash`)
 *   POST /api/vault/note      VaultCreateRequest  → VaultWriteResponse (new note, 409 `exists`)
 *
 * Undoing a whole action stays `POST /api/vault/undo`. Every write is a
 * `vault_change` of the actor `user` in the log, with its commit. Errors:
 * 400 `invalid_input`, 403 `permission_denied` (system folders, outside the
 * vault), 404 `not_found`, 409 `conflict` (the note changed: read it again),
 * `exists`, `unavailable` (no git).
 */

export const VaultSearchModeSchema = z.enum(['text', 'semantic', 'hybrid']);
export type VaultSearchMode = z.infer<typeof VaultSearchModeSchema>;

export const VaultSemanticStateSchema = z.enum([
  'off',
  'loading',
  'indexing',
  'ready',
  'unavailable',
]);

export const VaultNoteSummarySchema = z.object({
  path: z.string(),
  title: z.string(),
  type: z.string().nullable(),
  author: z.string().nullable(),
  updated: z.string(),
  private: z.boolean(),
  tags: z.array(z.string()),
  /** First lines of the text (raw Markdown, no title heading): the preview of the list. */
  summary: z.string().optional(),
});
export type VaultNoteSummary = z.infer<typeof VaultNoteSummarySchema>;

export const VaultEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  embed: z.boolean(),
});
export type VaultEdge = z.infer<typeof VaultEdgeSchema>;

export const VaultOverviewSchema = z.object({
  notes: z.array(VaultNoteSummarySchema),
  edges: z.array(VaultEdgeSchema),
  tags: z.array(z.object({ tag: z.string(), count: z.number() })),
  /** Notes in the vault; more than `notes.length` when the list was cut. */
  total: z.number(),
  semantic: VaultSemanticStateSchema,
  /** Why semantic search cannot work in this installation (Italian, for the UI). */
  semanticReason: z.string().optional(),
});
export type VaultOverview = z.infer<typeof VaultOverviewSchema>;

export const VaultSearchHitSchema = z.object({
  path: z.string(),
  title: z.string(),
  type: z.string().nullable(),
  updated: z.string(),
  score: z.number(),
  snippet: z.string(),
  tags: z.array(z.string()),
  /** Full-text fallback: only some of the words matched. */
  partial: z.boolean().optional(),
});
export type VaultSearchHit = z.infer<typeof VaultSearchHitSchema>;

export const VaultSearchResponseSchema = z.object({
  hits: z.array(VaultSearchHitSchema),
  /** The search really done: `text` while the semantic index is not usable. */
  mode: VaultSearchModeSchema,
});
export type VaultSearchResponse = z.infer<typeof VaultSearchResponseSchema>;

export const VaultNoteSchema = z.object({
  path: z.string(),
  title: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  /** Body without the frontmatter; null for files that are not Markdown. */
  content: z.string().nullable(),
  hash: z.string(),
  private: z.boolean(),
  author: z.string().nullable(),
  backlinks: z.array(z.object({ path: z.string(), title: z.string() })),
  truncated: z.boolean().optional(),
  frontmatterError: z.string().optional(),
});
export type VaultNote = z.infer<typeof VaultNoteSchema>;

export const VaultHistoryEntrySchema = z.object({
  commit: z.string(),
  date: z.string(),
  author: z.string(),
  actionId: z.string().nullable(),
  message: z.string(),
});
export type VaultHistoryEntry = z.infer<typeof VaultHistoryEntrySchema>;

export const VaultHistoryResponseSchema = z.object({ entries: z.array(VaultHistoryEntrySchema) });

export const VaultVersionSchema = z.object({
  path: z.string(),
  commit: z.string(),
  parent: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** Line diff (`-`/`+`/` ` prefixes, `@@` hunks); empty when nothing changed. */
  diff: z.string(),
});
export type VaultVersion = z.infer<typeof VaultVersionSchema>;

export const VaultTrashItemSchema = z.object({
  trashPath: z.string(),
  title: z.string(),
  /**
   * Where the note was; null when it was moved to the trash outside Monsters.
   * If another note took that path since, the restored one gets a free name next to it.
   */
  originalPath: z.string().nullable(),
  deletedAt: z.string().nullable(),
  deletedBy: z.string().nullable(),
  actionId: z.string().nullable(),
  private: z.boolean(),
  size: z.number(),
});
export type VaultTrashItem = z.infer<typeof VaultTrashItemSchema>;

export const VaultTrashResponseSchema = z.object({ items: z.array(VaultTrashItemSchema) });

const NotePathSchema = z.string().trim().min(1).max(1000);

export const VaultRestoreRequestSchema = z.union([
  z.object({
    /**
     * One entry of the trash (`trashPath` of `VaultTrashItem`): the same path
     * may be in the trash more than once, each entry is restored with its content.
     */
    trashPath: z.string().trim().min(1).max(1000),
  }),
  z.object({
    path: NotePathSchema,
    /** The version to bring back; omitted = the last one (a note in the trash). */
    commit: z.string().trim().min(4).max(64).optional(),
  }),
]);
export type VaultRestoreRequest = z.infer<typeof VaultRestoreRequestSchema>;

export const VaultDeleteRequestSchema = z.object({
  path: NotePathSchema,
  reason: z.string().max(500).optional(),
});
export type VaultDeleteRequest = z.infer<typeof VaultDeleteRequestSchema>;

export const VaultSaveRequestSchema = z.object({
  path: NotePathSchema,
  /** New body; the properties (frontmatter) of the note are kept. */
  content: z.string().max(2_000_000),
  baseHash: z.string().min(1).max(200),
});
export type VaultSaveRequest = z.infer<typeof VaultSaveRequestSchema>;

/** A new note written by the user: `<folder>/<title>.md`, never over an existing one. */
export const VaultCreateRequestSchema = z.object({
  /** Folder of the vault ("" for the main folder). */
  folder: z.string().trim().max(800),
  /** Name of the note, without `.md`; no `/` (folders come from `folder`). */
  title: z.string().trim().min(1).max(200),
  content: z.string().max(2_000_000),
});
export type VaultCreateRequest = z.infer<typeof VaultCreateRequestSchema>;

export const VaultWriteResponseSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
  hash: z.string(),
  commit: z.string().nullable(),
  actionId: z.string(),
});
export type VaultWriteResponse = z.infer<typeof VaultWriteResponseSchema>;
