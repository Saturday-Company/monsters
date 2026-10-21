/*
 * Initial content of a new vault (research/04 §6.1): simplified PARA folders,
 * the readme, four templates, a minimal Obsidian config and the .gitignore, with
 * the names of the vault's layout (D-154: `Agenti/`, `LEGGIMI.md` in an Italian
 * vault, `Agents/`, `README.md` in an English one). Only used when creating a
 * vault, never on an existing one.
 */

import { VAULT_LAYOUTS, type VaultLayout } from '@monsters/shared';
import { scaffoldPrompts } from './scaffold.prompts.ts';
import { scaffoldStrings } from './scaffold.strings.ts';

/** The folders of a new vault, in the order the readme lists them. */
export function vaultFolders(layout: VaultLayout): string[] {
  return [
    layout.inbox,
    layout.daily,
    layout.projects,
    layout.areas,
    layout.resources,
    layout.people,
    layout.archive,
    layout.agents,
    layout.templates,
    layout.attachments,
  ];
}

/** The folders of a vault made before D-154 (the Italian layout). */
export const VAULT_FOLDERS: readonly string[] = vaultFolders(VAULT_LAYOUTS.it);

/** Lines of the vault .gitignore (research/04 §5.1). */
export const VAULT_GITIGNORE = [
  '# Monsters: files that do not belong to the history of the vault',
  '.trash/',
  '.obsidian/workspace*.json',
  '.obsidian/cache',
  '.smart-env/',
  '*.monsters-tmp',
  '.DS_Store',
  '',
].join('\n');

/** Minimal `.obsidian/app.json` (research/04 §4.1). */
export function obsidianAppJson(layout: VaultLayout): string {
  return `${JSON.stringify(
    {
      useMarkdownLinks: false,
      newLinkFormat: 'shortest',
      alwaysUpdateLinks: true,
      trashOption: 'local',
      attachmentFolderPath: layout.attachments,
      newFileLocation: 'folder',
      newFileFolderPath: layout.inbox,
    },
    null,
    2,
  )}\n`;
}

/** The files of a new vault besides the memories: readme, Obsidian config, templates. */
export function scaffoldFiles(layout: VaultLayout): Record<string, string> {
  const texts = scaffoldStrings(layout.id);
  const files: Record<string, string> = {
    [layout.readme]: texts.readme,
    '.obsidian/app.json': obsidianAppJson(layout),
  };
  for (const [name, content] of Object.entries(texts.templates)) {
    files[`${layout.templates}/${name}`] = content;
  }
  return files;
}

/** The text a new `MEMORY.md` starts with, in the app's language at the moment. */
export function memoryNote(name: string): string {
  return scaffoldPrompts().memoryNote(name);
}
