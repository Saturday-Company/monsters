import {
  EventInputSchema,
  ToolError,
  VaultCreateRequestSchema,
  VaultDeleteRequestSchema,
  VaultRestoreRequestSchema,
  VaultSaveRequestSchema,
  VaultSearchModeSchema,
  type VaultHistoryEntry,
  type VaultNote,
  type VaultOverview,
  type VaultSearchMode,
  type VaultSearchResponse,
  type VaultTrashItem,
  type VaultVersion,
  type VaultWriteResponse,
} from '@monsters/shared';
import { RELATED_LIMIT, type SearchHit, type VaultActor, type WriteResult } from '@monsters/vault';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { Hub } from '../../hub.ts';
import type { EventLog } from '../../log/event-log.ts';
import { OWNER_REQUIRED, type AppEnv, type RouteHelpers } from '../app.ts';
import { protectedNote } from '../protected-notes.ts';

/*
 * Vault view of the UI (M2.8, contract in shared/src/vault.ts). The caller is
 * the owner of the vault: it acts as `user`, reads private notes too and its
 * writes are `vault_change` events of `user` in the log, like an undo.
 * Paths are checked by the vault (outside the vault, `.git`, `.obsidian` and
 * `.trash` are refused); auth, CSRF and Host/Origin come from the app.
 */

const ERROR_STATUS: Partial<Record<ToolError['code'], 400 | 403 | 404 | 409>> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  USER_DECLINED: 403,
  SETTING_OFF: 403,
  NOT_LINKED: 403,
  SITE_REFUSED: 403,
  BLOCKED_BY_POLICY: 403,
  NOT_IN_RUN: 403,
  CONFLICT: 409,
  EXISTS: 409,
  UNAVAILABLE: 409,
};

const MAX_NOTE_CHARS = 1_000_000;

const list = z
  .string()
  .optional()
  .transform((v) =>
    v
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const limit = (max: number) => z.coerce.number().int().min(1).max(max).optional();
const path = z.string().trim().min(1).max(1000);

const SearchQuerySchema = z.object({
  q: z.string().max(1000).optional(),
  mode: VaultSearchModeSchema.optional(),
  tags: list,
  folder: z.string().max(1000).optional(),
  limit: limit(100),
});
const PathQuerySchema = z.object({ path, limit: limit(200) });
const VersionQuerySchema = z.object({ path, commit: z.string().trim().min(4).max(64) });

function writeResponse(r: WriteResult): VaultWriteResponse {
  return { ok: true, path: r.path, hash: r.hash, commit: r.commit, actionId: r.action_id };
}

function hitOf(h: SearchHit): VaultSearchResponse['hits'][number] {
  const { partial, ...rest } = h;
  return { ...rest, ...(partial ? { partial: true } : {}) };
}

export function registerVaultRoutes(
  app: Hono<AppEnv>,
  h: RouteHelpers,
  deps: { hub: Hub; log: EventLog },
): void {
  const { requireAuth, parseBody } = h;
  const vault = () => deps.hub.vault;
  const user: VaultActor = {
    agentId: 'user',
    emit: (e) =>
      deps.log.append(EventInputSchema.parse({ agent: 'user', type: e.type, data: e.data })),
  };

  /** Runs a vault call, turning its errors into JSON answers. */
  const run = async (c: Context, fn: () => Promise<object> | object) => {
    try {
      return c.json(await fn());
    } catch (err) {
      if (err instanceof ToolError) {
        const files = (err.details as { files?: unknown } | undefined)?.files;
        return c.json(
          {
            error: err.code.toLowerCase(),
            message: err.message,
            ...(Array.isArray(files) ? { files: files.map(String) } : {}),
          },
          ERROR_STATUS[err.code] ?? 400,
        );
      }
      throw err;
    }
  };

  const query = <S extends z.ZodType>(c: Context, schema: S): z.infer<S> | null => {
    const parsed = schema.safeParse(c.req.query());
    return parsed.success ? parsed.data : null;
  };
  const invalid = (c: Context) => c.json({ error: 'invalid_request' }, 400);
  /**
   * A write of the CLI token (not the user in person) on a monster's memory, the profile or
   * Privato/ (review of ondate 3-4, n. 7): the answer that refuses it, or null.
   */
  const notForToken = (c: Context<AppEnv>, ...paths: string[]) =>
    !h.isOwner(c.get('auth')) && paths.some(protectedNote) ? c.json(OWNER_REQUIRED, 403) : null;

  /** The search really done: full-text while the vectors are not there. */
  const effectiveMode = (requested: VaultSearchMode | undefined): VaultSearchMode => {
    const state = vault().semanticStatus().state;
    if (state !== 'ready' && state !== 'indexing') return 'text';
    return requested ?? 'hybrid';
  };

  app.get('/api/vault/notes', requireAuth, (c) =>
    run(c, (): VaultOverview => {
      const v = vault();
      const { notes, edges, total } = v.overview(user);
      const semantic = v.semanticStatus();
      return {
        notes,
        edges,
        total,
        tags: v.tags(user, {}),
        semantic: semantic.state,
        ...(semantic.reason ? { semanticReason: semantic.reason } : {}),
      };
    }),
  );

  app.get('/api/vault/search', requireAuth, (c) => {
    const q = query(c, SearchQuerySchema);
    if (!q) return invalid(c);
    return run(c, async (): Promise<VaultSearchResponse> => {
      const mode = effectiveMode(q.mode);
      const hits = await vault().search(user, {
        query: q.q,
        mode,
        tags: q.tags,
        folder: q.folder?.trim() || undefined,
        limit: q.limit ?? 30,
      });
      return { hits: hits.map(hitOf), mode };
    });
  });

  app.get('/api/vault/note', requireAuth, (c) => {
    const q = query(c, PathQuerySchema);
    if (!q) return invalid(c);
    return run(c, async (): Promise<VaultNote> => {
      const note = await vault().read(user, { path: q.path, max_chars: MAX_NOTE_CHARS });
      const graph = await vault().links(user, { path: note.path, direction: 'in' });
      const backlinks = graph.nodes
        .filter((n): n is { path: string; title: string } => !!n.path && n.path !== note.path)
        .map((n) => ({ path: n.path, title: n.title }))
        .sort((a, b) => a.title.localeCompare(b.title));
      const author = note.frontmatter['author'];
      return {
        path: note.path,
        title: note.title,
        frontmatter: note.frontmatter,
        content: note.content,
        hash: note.hash,
        private: note.frontmatter['private'] === true || /^privato\//i.test(note.path),
        author: typeof author === 'string' ? author : null,
        backlinks,
        ...(note.truncated ? { truncated: true } : {}),
        ...(note.frontmatter_error ? { frontmatterError: note.frontmatter_error } : {}),
      };
    });
  });

  app.get('/api/vault/related', requireAuth, (c) => {
    const q = query(c, PathQuerySchema);
    if (!q) return invalid(c);
    return run(c, async (): Promise<VaultSearchResponse> => {
      // Only the clearly related notes, a few at most (D-030).
      const limit = Math.min(q.limit ?? RELATED_LIMIT, RELATED_LIMIT);
      const hits = await vault().search(user, { related_to: q.path, limit });
      return { hits: hits.map(hitOf), mode: effectiveMode('semantic') };
    });
  });

  app.get('/api/vault/history', requireAuth, (c) => {
    const q = query(c, PathQuerySchema);
    if (!q) return invalid(c);
    return run(c, async (): Promise<{ entries: VaultHistoryEntry[] }> => {
      const entries = await vault().history(user, { path: q.path, limit: q.limit ?? 30 });
      return {
        entries: entries.map((e) => ({
          commit: e.commit,
          date: e.date,
          author: e.author,
          actionId: e.action_id,
          message: e.message,
        })),
      };
    });
  });

  app.get('/api/vault/version', requireAuth, (c) => {
    const q = query(c, VersionQuerySchema);
    if (!q) return invalid(c);
    return run(c, (): Promise<VaultVersion> => vault().version(user, q));
  });

  app.get('/api/vault/trash', requireAuth, (c) =>
    run(c, async (): Promise<{ items: VaultTrashItem[] }> => {
      const items = await vault().trash(user);
      return {
        items: items.map((i) => ({
          trashPath: i.trash_path,
          title: i.title,
          originalPath: i.original_path,
          deletedAt: i.deleted_at,
          deletedBy: i.deleted_by,
          actionId: i.action_id,
          private: i.private,
          size: i.size,
        })),
      };
    }),
  );

  app.post('/api/vault/restore', requireAuth, async (c) => {
    const body = await parseBody(c, VaultRestoreRequestSchema);
    if (!body.ok) return body.res;
    const req = body.data;
    let target = 'trashPath' in req ? req.trashPath : req.path;
    if ('trashPath' in req && !h.isOwner(c.get('auth'))) {
      // The trash keeps only the name: where the note goes back is in its entry.
      const items = await vault().trash(user);
      const item = items.find((i) => i.trash_path === req.trashPath);
      target = item?.original_path ?? req.trashPath;
    }
    const refused = notForToken(c, target);
    if (refused) return refused;
    return run(c, async () =>
      writeResponse(
        await vault().restore(
          user,
          'trashPath' in req
            ? { trash_path: req.trashPath }
            : { path: req.path, commit: req.commit },
        ),
      ),
    );
  });

  app.post('/api/vault/delete', requireAuth, async (c) => {
    const body = await parseBody(c, VaultDeleteRequestSchema);
    if (!body.ok) return body.res;
    const refused = notForToken(c, body.data.path);
    if (refused) return refused;
    return run(c, async () =>
      writeResponse(
        await vault().delete(user, {
          path: body.data.path,
          reason: body.data.reason?.trim() || 'Cestinata dall’interfaccia',
        }),
      ),
    );
  });

  app.post('/api/vault/note', requireAuth, async (c) => {
    const body = await parseBody(c, VaultCreateRequestSchema);
    if (!body.ok) return body.res;
    const title = body.data.title.replace(/\.md$/i, '').trim();
    if (!title || /[/\\]/.test(title)) {
      return c.json(
        { error: 'invalid_input', message: 'the title cannot contain / or \\ (choose the folder)' },
        400,
      );
    }
    const folder = body.data.folder.replace(/^[/\\]+|[/\\]+$/g, '');
    const refused = notForToken(c, folder ? `${folder}/${title}.md` : `${title}.md`);
    if (refused) return refused;
    // Checked by the vault: hidden and system folders, outside the vault, names
    // Obsidian cannot open, an existing note (`exists`, never overwritten).
    return run(c, async () =>
      writeResponse(
        await vault().write(user, {
          path: folder ? `${folder}/${title}.md` : `${title}.md`,
          content: body.data.content,
          mode: 'create',
        }),
      ),
    );
  });

  app.put('/api/vault/note', requireAuth, async (c) => {
    const body = await parseBody(c, VaultSaveRequestSchema);
    if (!body.ok) return body.res;
    // Only Markdown notes are edited from the UI (the text would replace a binary file).
    if (!/\.md$/i.test(body.data.path)) {
      return c.json({ error: 'invalid_input', message: 'only Markdown notes (.md)' }, 400);
    }
    const refused = notForToken(c, body.data.path);
    if (refused) return refused;
    return run(c, async () =>
      writeResponse(
        await vault().write(user, {
          path: body.data.path,
          content: body.data.content,
          mode: 'overwrite',
          base_hash: body.data.baseHash,
        }),
      ),
    );
  });
}
