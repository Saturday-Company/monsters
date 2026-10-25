import type { FileMeta, VaultOverview, VaultSearchResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  afterRefresh,
  FILES_PAGE,
  nextPageQuery,
  withPage,
} from '../src/components/files/file-pages.ts';
import { loadProjectNotes, PROJECT_NOTES_MAX } from '../src/components/projects/project-notes.ts';

/* Lists the screen cuts (W-37): they say so, and there is a way to the rest. */

const file = (n: number): FileMeta =>
  ({ id: `f${n}`, name: `File ${n}`, createdAt: 1_000_000 - n * 10 }) as FileMeta;
const files = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => file(from + i));
const ids = (list: readonly FileMeta[]) => list.map((f) => f.id);

describe('Files, page by page', () => {
  it('the next page asks for the files before the last one shown, one millisecond over', () => {
    const shown = files(0, 3);
    expect(nextPageQuery({ kind: 'image', limit: 300 }, shown)).toEqual({
      kind: 'image',
      limit: 300,
      before: shown[2]!.createdAt + 1,
    });
    expect(nextPageQuery({ limit: 300 }, [])).toEqual({ limit: 300 });
  });

  it('a page is added without repeating the files that two pages share', () => {
    const merged = withPage(files(0, 5), files(3, 5));
    expect(ids(merged)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']);
  });

  it('reading the first page again keeps the older pages already shown', () => {
    const shown = files(0, 5);
    // Two new files on top; the first page of 3 is full.
    const first = [file(-2), file(-1), file(0)];
    expect(ids(afterRefresh(first, shown, 3))).toEqual([
      'f-2',
      'f-1',
      'f0',
      'f1',
      'f2',
      'f3',
      'f4',
    ]);
  });

  it('a first page that is not full is everything there is', () => {
    expect(ids(afterRefresh(files(0, 2), files(0, 5), 3))).toEqual(['f0', 'f1']);
    expect(ids(afterRefresh(files(0, 2), null))).toEqual(['f0', 'f1']);
    expect(FILES_PAGE).toBe(300);
  });

  it('a file deleted elsewhere is gone from the older pages too once the first page is full', () => {
    const shown = files(0, 6);
    // f1 deleted: the first page of 3 now ends at f3.
    const first = [file(0), file(2), file(3)];
    expect(ids(afterRefresh(first, shown, 3))).toEqual(['f0', 'f2', 'f3', 'f4', 'f5']);
  });
});

describe('the notes of a project (very large vault)', () => {
  const note = (path: string, updated: string) => ({
    path,
    title: path,
    type: null,
    author: null,
    updated,
    private: false,
    tags: [],
  });
  const overview = (notes: ReturnType<typeof note>[], total: number) =>
    ({ notes, edges: [], tags: [], total, semantic: 'off' }) as unknown as VaultOverview;

  it('takes the area from the overview when the overview holds the whole vault', async () => {
    const result = await loadProjectNotes(
      {
        overview: async () =>
          overview(
            [
              note('Projects/Alpha/a.md', '2026-10-01'),
              note('Other/x.md', '2026-10-09'),
              note('projects/alpha/b.md', '2026-10-05'),
            ],
            3,
          ),
        search: () => Promise.reject(new Error('not needed')),
      },
      'Projects/Alpha',
    );
    expect(result.notes.map((n) => n.path)).toEqual(['projects/alpha/b.md', 'Projects/Alpha/a.md']);
    expect(result.cut).toBe(false);
  });

  it('asks the vault for the folder when the overview was cut, and says when that is cut too', async () => {
    const asked: unknown[] = [];
    const hit = (i: number) => ({
      path: `Projects/Alpha/n${i}.md`,
      title: `N${i}`,
      type: null,
      updated: `2026-10-${String(10 + (i % 15)).padStart(2, '0')}`,
      score: 0,
      snippet: '',
      tags: [],
    });
    const vault = (count: number) => ({
      overview: async () => overview([note('Other/x.md', '2026-10-09')], 6000),
      search: async (p: { folder: string; limit: number }): Promise<VaultSearchResponse> => {
        asked.push(p);
        return { hits: Array.from({ length: count }, (_, i) => hit(i)), mode: 'text' };
      },
    });
    const few = await loadProjectNotes(vault(3), 'Projects/Alpha');
    expect(asked[0]).toEqual({ folder: 'Projects/Alpha', limit: PROJECT_NOTES_MAX });
    expect(few.notes).toHaveLength(3);
    expect(few.cut).toBe(false);
    const many = await loadProjectNotes(vault(PROJECT_NOTES_MAX), 'Projects/Alpha');
    expect(many.cut).toBe(true);
    // Newest first.
    const dates = many.notes.map((n) => n.updated);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
