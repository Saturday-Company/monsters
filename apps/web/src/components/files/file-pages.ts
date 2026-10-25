import type { FileListQuery, FileMeta } from '@monsters/shared';

/*
 * The Files list in pages (W-37): the newest ones first, "Show more" for the next page. The
 * list is read again when a file event arrives; that reads the first page only and keeps the
 * older pages already shown, so the list does not shrink under the user's eyes.
 */

/** How many files a page asks for. */
export const FILES_PAGE = 300;

/** The query of the page after `files` (newest first): the files created before the last one. */
export function nextPageQuery(query: FileListQuery, files: readonly FileMeta[]): FileListQuery {
  const last = files.at(-1);
  // One millisecond over: several files made in the same one must not fall between two pages.
  return last ? { ...query, before: last.createdAt + 1 } : query;
}

/** The files with a page added; the overlap of two pages is kept once. */
export function withPage(files: readonly FileMeta[], page: readonly FileMeta[]): FileMeta[] {
  const have = new Set(files.map((f) => f.id));
  return [...files, ...page.filter((f) => !have.has(f.id))];
}

/**
 * The list after the first page was read again: the new first page, then the older files already
 * shown. A first page that is not full holds everything there is.
 */
export function afterRefresh(
  first: readonly FileMeta[],
  shown: readonly FileMeta[] | null,
  page: number = FILES_PAGE,
): FileMeta[] {
  const last = first.at(-1);
  if (!shown || first.length < page || !last) return [...first];
  const have = new Set(first.map((f) => f.id));
  return [...first, ...shown.filter((f) => f.createdAt <= last.createdAt && !have.has(f.id))];
}
