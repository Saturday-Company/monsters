import type { VaultOverview, VaultSearchResponse } from '@monsters/shared';

/* The notes of a project's area for its Notes tab (W-37). */

/** What the tab shows of a note. */
export interface ProjectNote {
  path: string;
  title: string;
  updated: string;
}

/** The most notes the folder query asks for (the vault's route allows 100). */
export const PROJECT_NOTES_MAX = 100;

export interface ProjectNotes {
  notes: ProjectNote[];
  /** Older notes of the area are left out: the list is cut at `PROJECT_NOTES_MAX`. */
  cut: boolean;
}

const newestFirst = (a: ProjectNote, b: ProjectNote) => b.updated.localeCompare(a.updated);

/**
 * The notes under `area`, newest first. The overview of the vault is cut at its newest notes: in
 * a vault that large the area may have notes it does not hold, so the vault is asked for the
 * folder itself.
 */
export async function loadProjectNotes(
  vault: {
    overview: () => Promise<VaultOverview>;
    search: (p: { folder: string; limit: number }) => Promise<VaultSearchResponse>;
  },
  area: string,
): Promise<ProjectNotes> {
  const o = await vault.overview();
  if (o.total <= o.notes.length) {
    const prefix = `${area}/`.toLowerCase();
    return {
      notes: o.notes.filter((n) => n.path.toLowerCase().startsWith(prefix)).sort(newestFirst),
      cut: false,
    };
  }
  const { hits } = await vault.search({ folder: area, limit: PROJECT_NOTES_MAX });
  return {
    notes: hits
      .map((h) => ({ path: h.path, title: h.title, updated: h.updated }))
      .sort(newestFirst),
    cut: hits.length >= PROJECT_NOTES_MAX,
  };
}
