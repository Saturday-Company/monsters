import {
  ApiErrorSchema,
  VaultHistoryResponseSchema,
  VaultNoteSchema,
  VaultOverviewSchema,
  VaultSearchResponseSchema,
  VaultTrashResponseSchema,
  VaultVersionSchema,
  VaultWriteResponseSchema,
  type VaultHistoryEntry,
  type VaultNote,
  type VaultOverview,
  type VaultSearchMode,
  type VaultSearchResponse,
  type VaultTrashItem,
  type VaultVersion,
  type VaultWriteResponse,
} from '@monsters/shared';
import type { z } from 'zod';
import { ApiError, describeError } from '../../lib/api.ts';
import { getApi } from '../../store/app.ts';
import { vaultStrings } from './vault.strings.ts';

/* Client of the vault view API (contract in packages/shared/src/vault.ts). */

async function call<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> {
  const res = await getApi().transport.request(method, path, body);
  if (res.status < 200 || res.status >= 300) {
    const err = ApiErrorSchema.safeParse(res.body);
    throw new ApiError(
      res.status,
      err.success ? err.data.error : `http_${res.status}`,
      err.success ? err.data.message : undefined,
      err.success ? err.data.files : undefined,
    );
  }
  const parsed = schema.safeParse(res.body);
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response', parsed.error.message);
  return parsed.data;
}

function query(q: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export interface SearchParams {
  q?: string;
  mode?: VaultSearchMode;
  tags?: string[];
  folder?: string;
  limit?: number;
}

export const vaultApi = {
  overview: (): Promise<VaultOverview> => call('GET', '/api/vault/notes', VaultOverviewSchema),
  search: (p: SearchParams): Promise<VaultSearchResponse> =>
    call(
      'GET',
      `/api/vault/search${query({ q: p.q, mode: p.mode, tags: p.tags?.join(','), folder: p.folder, limit: p.limit })}`,
      VaultSearchResponseSchema,
    ),
  note: (path: string): Promise<VaultNote> =>
    call('GET', `/api/vault/note${query({ path })}`, VaultNoteSchema),
  related: (path: string): Promise<VaultSearchResponse> =>
    call('GET', `/api/vault/related${query({ path, limit: 6 })}`, VaultSearchResponseSchema),
  history: async (path: string): Promise<VaultHistoryEntry[]> =>
    (await call('GET', `/api/vault/history${query({ path })}`, VaultHistoryResponseSchema)).entries,
  version: (path: string, commit: string): Promise<VaultVersion> =>
    call('GET', `/api/vault/version${query({ path, commit })}`, VaultVersionSchema),
  trash: async (): Promise<VaultTrashItem[]> =>
    (await call('GET', '/api/vault/trash', VaultTrashResponseSchema)).items,
  /** A version of the history of a note. */
  restore: (path: string, commit: string): Promise<VaultWriteResponse> =>
    call('POST', '/api/vault/restore', VaultWriteResponseSchema, { path, commit }),
  /** One entry of the trash (the same path may be there more than once). */
  restoreTrash: (trashPath: string): Promise<VaultWriteResponse> =>
    call('POST', '/api/vault/restore', VaultWriteResponseSchema, { trashPath }),
  remove: (path: string): Promise<VaultWriteResponse> =>
    call('POST', '/api/vault/delete', VaultWriteResponseSchema, { path }),
  save: (path: string, content: string, baseHash: string): Promise<VaultWriteResponse> =>
    call('PUT', '/api/vault/note', VaultWriteResponseSchema, { path, content, baseHash }),
  /** A new note `<folder>/<title>.md` ("" = main folder); `exists` if the name is taken. */
  create: (folder: string, title: string, content: string): Promise<VaultWriteResponse> =>
    call('POST', '/api/vault/note', VaultWriteResponseSchema, { folder, title, content }),
};

/** Friendly text for the errors of the vault view. */
export function vaultError(err: unknown): string {
  const s = vaultStrings().errors;
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'not_found':
        return s.notFound;
      case 'conflict':
        return s.conflict;
      case 'exists':
        return s.exists;
      case 'permission_denied':
        return s.permissionDenied;
      case 'unavailable':
        return s.unavailable;
      case 'invalid_input':
        if (err.message && /exists: pass the commit/.test(err.message)) return s.pathExists;
        if (
          err.message &&
          /invalid characters|reserved by Windows|cannot contain/.test(err.message)
        )
          return s.badName;
        return s.invalid;
      default:
        break;
    }
  }
  return describeError(err);
}
