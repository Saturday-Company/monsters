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
