import type { FileMeta } from '@monsters/shared';
import { create } from 'zustand';
import {
  forgetFileMeta,
  rememberFileMeta,
  useFileMeta as usePreviewFileMeta,
} from '../components/preview/files.ts';

/*
 * The metadata of the files the chat and the File view show (D-075): one
 * cache, the preview pane's (components/preview/files.ts); here only what was
 * deleted in this session, so its chips say "File eliminato" at once.
 */

interface FilesState {
  deleted: Record<string, true>;
  put: (metas: readonly FileMeta[]) => void;
  drop: (id: string) => void;
}

export const useFiles = create<FilesState>((set) => ({
  deleted: {},
  put: (metas) => {
    for (const m of metas) rememberFileMeta(m);
  },
  drop: (id) => {
    forgetFileMeta(id);
    set((s) => ({ deleted: { ...s.deleted, [id]: true } }));
  },
}));

/** The metadata of a file: undefined while it loads, `missing` when it is gone. */
export function useFileMeta(id: string): FileMeta | 'missing' | undefined {
  const deleted = useFiles((s) => s.deleted[id] === true);
  const state = usePreviewFileMeta(deleted ? null : id);
  if (deleted || state.state === 'missing') return 'missing';
  return state.state === 'ready' ? state.meta : undefined;
}
