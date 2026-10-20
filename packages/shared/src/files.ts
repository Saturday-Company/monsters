import { z } from 'zod';

/*
 * Files of the user and of the monsters (plan of 16/10, features 4 and 5; D-075).
 *
 * A file lives in the notes folder under `File/` (kept out of the vault's git so
 * the history doesn't swell), with its metadata in the core's database. Files
 * come from the user (composer: clip, paste, drop), from a monster (an HTML page
 * made with `artifact_create`, an export) or from a tool (a browser screenshot).
 *
 *   POST   /api/files               multipart, field `file` (+ optional `agent`) → FileMeta
 *   GET    /api/files?kind=&source=&agent=&q=&ids=&limit=&before= → { files: FileMeta[] }
 *   GET    /api/files/:id           → FileMeta
 *   GET    /api/files/:id/content   the bytes, with the stored type, `nosniff`,
 *                                   `Content-Disposition: inline`; HTML only with
 *                                   `Content-Security-Policy: sandbox …; default-src 'none'`
 *   GET    /api/files/:id/thumb     image/webp thumbnail (images, PDF first page when cheap)
 *   DELETE /api/files/:id
 *
 * A chat message carries the ids of its attachments (`attachments` on the send
 * request and on the `message` event).
 *
 * Errors: 404 `unknown_file`, 413 `file_too_large`, 415 `unsupported_type`.
 *
 * Compatible extensions (files feature, D-075):
 * - `POST /api/files` also takes an optional field `thumb`: a WebP thumbnail made
 *   by the browser (the core has no image library); checked by its magic bytes
 *   and kept only when it is a real WebP under `FILE_THUMB_MAX_BYTES`.
 * - `GET /api/files/:id/text` → `{ text, truncated }`: the extracted text.
 * - A `file` event says that a monster or a tool saved a file (`FileEventData`):
 *   the chat shows it as a chip ("Rhea ha salvato uno screenshot").
 * - The folder is `File/` when it is Monsters' (marker `File/.monsters`) or does
 *   not exist yet; a `File/` the user made stays a folder of notes and the files
 *   go to `File di Monsters/` (the `path` of each file says which).
 * - At most `MESSAGE_MAX_ATTACHMENTS` attachments per message; a message with
 *   attachments may have an empty text.
 * - `FileMeta.title`: the title of a page made by a monster.
 * - `GET /api/files/:id/content?download=1` answers with `attachment` (Scarica).
 * - `GET /api/files` also takes `kind=documents` and `source=monsters`.
 * - The thumbnail exists only when the browser made one (`hasThumb`); for an
 *   image without it, show `/content`.
 * - `FileMeta.inert` (D-085): an HTML page made by a run that had read
 *   third-party text is served without scripts; `POST /api/files/:id/scripts`
 *   (the user's click on "Attiva gli script") turns them on → FileMeta.
 * - `hasText` may become true after the upload answered: the text of a
 *   document is extracted in a worker, then a `file` event with action
 *   `updated` says so.
 */

/**
 * The bytes of a file in an `<img>`, an `<iframe>` or a download link (S-B13): the browser adds
 * no header there, so the URL carries `?ticket=…`, asked with
 * `POST /api/files/:id/ticket` `{ part }` → `{ ticket, expiresAt }`. A ticket is good for that
 * file and part only, for the session that asked, for a couple of minutes and a few requests.
 */
export const FILE_TICKET_PARAM = 'ticket';

export const FilePartSchema = z.enum(['content', 'thumb']);
export type FilePart = z.infer<typeof FilePartSchema>;

export const FileTicketRequestSchema = z.object({ part: FilePartSchema.default('content') });
export type FileTicketRequest = z.infer<typeof FileTicketRequestSchema>;

export const FileTicketResponseSchema = z.object({ ticket: z.string(), expiresAt: z.number() });
export type FileTicketResponse = z.infer<typeof FileTicketResponseSchema>;

/** Largest file accepted from the composer, in bytes (25 MB). */
export const FILE_MAX_BYTES = 25 * 1024 * 1024;

/** Largest HTML page a monster may save with `artifact_create` (2 MB). */
export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;

/** Largest thumbnail the browser may send with an upload (256 KB). */
export const FILE_THUMB_MAX_BYTES = 256 * 1024;

/** Attachments of one chat message. */
export const MESSAGE_MAX_ATTACHMENTS = 10;

export const FileKindSchema = z.enum([
  'image',
  'pdf',
  'document',
  'sheet',
  'text',
  'html',
  'other',
]);
export type FileKind = z.infer<typeof FileKindSchema>;

export const FileSourceSchema = z.enum(['user', 'agent', 'tool']);
export type FileSource = z.infer<typeof FileSourceSchema>;

export const FileMetaSchema = z.object({
  id: z.string().min(1),
  /** File name as shown to the user (sanitized, unique within `File/`). */
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  kind: FileKindSchema,
  source: FileSourceSchema,
  /** The monster that made it, or the one the user sent it to. */
  agent: z.string().optional(),
  runId: z.string().optional(),
  /** Title of a page made by a monster (`artifact_create`), when it gave one (D-075). */
  title: z.string().optional(),
  /** Event id of the chat message that carried it, when it came from the chat. */
  messageId: z.string().optional(),
  /** Path relative to the notes folder, e.g. `File/2026-10/foto.png`. */
  path: z.string().min(1),
  hasThumb: z.boolean(),
  /** Text extracted for models that can't read the original (PDF, documents). */
  hasText: z.boolean(),
  /** An HTML page served without scripts until the user turns them on (D-085). */
  inert: z.boolean().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  createdAt: z.number().int(),
  /**
   * In a search (`GET /api/files?q=`) that found the words in the extracted
   * text and not in the name: the piece of text around them (D-086).
   */
  snippet: z.string().optional(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

export const FileListSchema = z.object({ files: z.array(FileMetaSchema) });
export type FileList = z.infer<typeof FileListSchema>;

/** `GET /api/files` query. `kind` takes one kind, or `documents` (pdf, document, sheet, text). */
export const FileListQuerySchema = z.object({
  kind: z.union([FileKindSchema, z.literal('documents')]).optional(),
  source: z.union([FileSourceSchema, z.literal('monsters')]).optional(),
  agent: z.string().max(64).optional(),
  /** Words searched in the name and in the extracted text (D-086). */
  q: z.string().max(200).optional(),
  /**
   * Only these files, comma-separated ids (at most 100): the metadata of a
   * chat's attachments in one request, the deleted ones simply absent (D-086).
   */
  ids: z
    .string()
    .max(3000)
    .regex(/^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+){0,99}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  /** Only files created before this time (ms): the next page. */
  before: z.coerce.number().int().optional(),
});
export type FileListQuery = z.infer<typeof FileListQuerySchema>;

/** `GET /api/files/:id/text`. */
export const FileTextSchema = z.object({ text: z.string(), truncated: z.boolean() });
export type FileText = z.infer<typeof FileTextSchema>;

/** Kinds shown under "Documenti" in the File view and by `kind=documents`. */
export const DOCUMENT_KINDS: readonly FileKind[] = ['pdf', 'document', 'sheet', 'text'];

/**
 * The `file` event: a monster (`artifact_create`) or a tool (a browser
 * screenshot) saved a file. `agent` of the envelope is the monster.
 */
export const FileEventDataSchema = z.object({
  action: z.enum(['created', 'deleted', 'updated']),
  id: z.string().min(1),
  name: z.string(),
  kind: FileKindSchema,
  source: FileSourceSchema,
  mime: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  /** The tool that made it (`artifact_create`, `mcp__browser__browser_take_screenshot`). */
  tool: z.string().optional(),
  /** Title of an HTML page made by a monster. */
  title: z.string().optional(),
  /** An HTML page served without scripts (D-085). */
  inert: z.literal(true).optional(),
});
export type FileEventData = z.infer<typeof FileEventDataSchema>;

/*
 * What the right-hand preview pane can show. The web app opens items with
 * `openPreview` (apps/web/src/store/preview.ts); a monster asks for it with the
 * `preview_show` tool, which emits a `preview` event carrying one of these.
 */
export const PreviewItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), fileId: z.string().min(1) }),
  z.object({ kind: z.literal('note'), path: z.string().min(1) }),
]);
export type PreviewItem = z.infer<typeof PreviewItemSchema>;
