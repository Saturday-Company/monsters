import type { DraftView, ProjectView } from '@monsters/shared';
import { useEffect } from 'react';
import { create } from 'zustand';
import { describeError } from '../lib/api.ts';
import { getApi } from './app.ts';

/*
 * The projects (D-097) and the drafts of the monsters (D-098) as the UI keeps
 * them: read from the core once something asks, then again after the events
 * that change them (`project_change`, `team_change`, `DRAFT_EVENT_TYPES`; see
 * `ingest` in app.ts). The sidebar, the project's page and "Da rivedere" read
 * the same lists.
 */

interface Lists {
  projects: ProjectView[] | null;
  drafts: DraftView[] | null;
  /** Why the last read failed, in Italian (the list on screen stays). */
  projectsError: string | null;
  draftsError: string | null;
}

export const useLists = create<Lists>()(() => ({
  projects: null,
  drafts: null,
  projectsError: null,
  draftsError: null,
}));

let projectsAsked = false;
let draftsAsked = false;
let projectsSeq = 0;
let draftsSeq = 0;

/** Reads the projects again (the answer of an older read never wins over a newer one). */
export async function refreshProjects(): Promise<void> {
  projectsAsked = true;
  const seq = ++projectsSeq;
  try {
    const list = await getApi().projects();
    if (seq === projectsSeq) useLists.setState({ projects: list, projectsError: null });
  } catch (err) {
    if (seq === projectsSeq) useLists.setState({ projectsError: describeError(err) });
  }
}

/** Reads the drafts again. */
export async function refreshDrafts(): Promise<void> {
  draftsAsked = true;
  const seq = ++draftsSeq;
  try {
    const list = await getApi().drafts();
    if (seq === draftsSeq) useLists.setState({ drafts: list, draftsError: null });
  } catch (err) {
    if (seq === draftsSeq) useLists.setState({ draftsError: describeError(err) });
  }
}

/** Puts a project an action returned, without a round trip. */
export function putProject(p: ProjectView): void {
  const list = useLists.getState().projects ?? [];
  const at = list.findIndex((x) => x.id === p.id);
  useLists.setState({
    projects: at < 0 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x)),
  });
}

/** Whether the lists were ever asked for: the events refresh only what is in use. */
export function listsInUse(): { projects: boolean; drafts: boolean } {
  return { projects: projectsAsked, drafts: draftsAsked };
}

/** The projects (null until the first answer), read once the first component asks. */
export function useProjects(): ProjectView[] | null {
  const list = useLists((s) => s.projects);
  useEffect(() => {
    if (!projectsAsked) void refreshProjects();
  }, []);
  return list;
}

/** The drafts waiting for the user (null until the first answer). */
export function useDrafts(): DraftView[] | null {
  const list = useLists((s) => s.drafts);
  useEffect(() => {
    if (!draftsAsked) void refreshDrafts();
  }, []);
  return list;
}

/** One project of the list (null while it loads or when it is not there). */
export function useProject(id: string | null): ProjectView | null {
  const list = useProjects();
  return (id ? list?.find((p) => p.id === id) : undefined) ?? null;
}

/** For the tests and a new session: forgets what was read. */
export function resetLists(): void {
  projectsAsked = false;
  draftsAsked = false;
  projectsSeq++;
  draftsSeq++;
  useLists.setState({ projects: null, drafts: null, projectsError: null, draftsError: null });
}
