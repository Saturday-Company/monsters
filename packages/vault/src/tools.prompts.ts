import type { VaultLayout, VaultLayoutId } from '@monsters/shared';

/*
 * The examples the vault tools show a model (their descriptions are English in every language):
 * folder names and tags in the words of the vault's layout (D-154), so a model in an English
 * vault is not taught `Progetti/` or `area/salute`. The Italian layout keeps the examples it
 * always had, byte for byte.
 */

interface ToolExamples {
  /** A tag with a nested child, as `parent` and `parent/child`. */
  tagParent: string;
  tagChild: string;
  /** A tag like `area/salute`. */
  tagArea: string;
  /** A path of a new note in the inbox. */
  newNote: string;
}

const EXAMPLES: Record<VaultLayoutId, ToolExamples> = {
  it: {
    tagParent: 'progetto',
    tagChild: 'progetto/x',
    tagArea: 'area/salute',
    newNote: 'Inbox/Idea podcast',
  },
  en: {
    tagParent: 'project',
    tagChild: 'project/x',
    tagArea: 'area/health',
    newNote: 'Inbox/Podcast idea',
  },
};

/** The texts of the tools' inputs that name a folder or a tag in a vault of `layout`. */
export function toolPrompts(layout: VaultLayout) {
  const x = EXAMPLES[layout.id];
  return {
    searchTags: `All of these tags; "${x.tagParent}" also matches "${x.tagChild}"`,
    searchFolder: `Only inside this folder, e.g. "${layout.projects}"`,
    writePath: `e.g. "${x.newNote}" (.md is added). The file name is the title`,
    writeFrontmatter: `Properties such as {"type": "project", "tags": ["${x.tagChild}"]}; id/created/author are added`,
    movePath: `New path or folder ("${layout.archive}/" keeps the name)`,
    tagsPrefix: `e.g. "${x.tagParent}" for ${x.tagParent}/*`,
    writeTool:
      'Create a note (mode create) or replace a whole note (mode overwrite, needs base_hash). ' +
      'Prefer vault_edit for changes. Links: [[Title]] for notes of the vault, [text](https://…) for web pages. ' +
      `Readable file names with spaces. Lowercase tags like "${x.tagArea}".`,
  };
}

/**
 * What a model reads when a change is not in the history (D-214). The vault's own ignore file
 * (often the user's, in a repository they publish) excludes some folders: Monsters writes there
 * but never puts those files into git, so there is no commit and no undo.
 */
export const historyPrompts = {
  /** Warning in the result of a write whose paths (some or all) stay out of the history. */
  notRecorded: (paths: readonly string[], all: boolean) =>
    `${all ? 'This change' : 'Part of this change'} is not in the history: ${listPaths(paths)} ` +
    `${paths.length === 1 ? 'is' : 'are'} ignored by the vault's .gitignore, so ` +
    `${all ? 'it has no commit and cannot be undone' : 'that part cannot be undone'} ` +
    '(vault_undo, vault_restore and vault_history do not see it). Tell the user if they may need a copy.',
  /** Warning when a file is too big to record: it is moved or deleted but not in the history. */
  tooLarge: (paths: readonly string[], all: boolean) =>
    `${all ? 'This change' : 'Part of this change'} is not in the history: ${listPaths(paths)} ` +
    `${paths.length === 1 ? 'is' : 'are'} over 256 MiB, too large to be recorded, so ` +
    `${all ? 'it has no commit and cannot be undone' : 'that part cannot be undone'} ` +
    '(restore it from the trash by hand if needed).',
  /** Error of `vault_undo` for an action that was not recorded. */
  undoNotRecorded: (actionId: string, paths: readonly string[]) =>
    `action ${actionId} cannot be undone: it was not recorded in the history because ${listPaths(paths)} ` +
    `${paths.length === 1 ? 'is' : 'are'} ignored by the vault's .gitignore`,
  undoNotRecordedHint:
    'Changes in ignored folders have no history. Edit the file back by hand, or ask the user to remove the folder from .gitignore.',
  /** Error of `vault_undo` for an action without a commit that is not about ignored folders (a file too big). */
  undoNoCommit: (actionId: string) =>
    `action ${actionId} cannot be undone: it was not recorded in the history (a file over 256 MiB is too large to record)`,
  undoNoCommitHint: 'Restore the file from the trash by hand if needed.',
};

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
}
