import { isAbsolute, relative, resolve } from 'node:path';
import { toolPrompts } from '../tools.prompts.ts';
import { commandWritesConfig } from './command-writes-config.ts';
import { segment } from './launch-files.ts';

/*
 * The instructions and harness configuration of a folder (D-079, D-103):
 * CLAUDE.md and AGENTS.md reach every monster of a project in its prompt, and
 * `.claude/`, `.mcp.json`, `.codex/` are what Claude Code and Codex would read
 * as their own. A monster never writes them in a project's folder, at any
 * depth, with any tool: they are the user's (a speed bump on the terminal,
 * like the lockout). Without the terminal, not in any granted folder either
 * (review of 18/10, M3): Claude Code or Codex started there by the user would
 * read them.
 * A change to CLAUDE.md or AGENTS.md is proposed instead (`project_docs_propose`,
 * D-113): the core writes it when the user applies it, never a monster's tool.
 * The same names as `HARNESS_CONFIG_FILES` of the providers.
 */

/** Names, at any depth of a folder, that a monster never writes there. */
export const INSTRUCTION_FILES = [
  '.claude',
  '.mcp.json',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
  '.codex',
] as const;

/** What the model reads when a call would write one of them. */
export const instructionFilesDenied = (): string => toolPrompts().instructionFilesDenied;
export const INSTRUCTION_FILES_HINT =
  'For CLAUDE.md or AGENTS.md at the top of the folder: propose the whole new text with `project_docs_propose` (load it with `tools_search` if you do not see it); the user applies it with one tap. For the other files: write what you would change in a note of the project, or tell the user.';

/**
 * A command line of the `shell` tool that writes, moves or removes one of those files, run in `cwd`
 * of `folders`. The same brake as Claude Code's Bash (`commandWritesConfig`, D-166, D-176): it had its
 * own coarser rules here (a write word and a name in one segment), so a copy into a folder, a glob, a
 * backslash or `sed w` passed the native terminal while the harness refused them, and `grep -n install
 * CLAUDE.md` was refused. Reading them (`cat AGENTS.md`, `grep x CLAUDE.md 2>&1`) stays possible.
 */
export function commandWritesInstructions(
  command: string,
  cwd?: string,
  folders: readonly string[] = [],
): boolean {
  return commandWritesConfig(command, {
    ...(cwd !== undefined ? { cwd, inConfig: instructionFileIn(cwd, folders) } : {}),
  });
}

const INSTRUCTION_NAMES = new Set(INSTRUCTION_FILES.map((f) => f.toLowerCase()));

/**
 * `path` (absolute) is one of those files in one of `folders`, at any depth
 * (`sub/CLAUDE.md`, `packages/x/AGENTS.md`, `sub/.claude/settings.json`):
 * Claude Code started in a subfolder reads them there, Codex reads every
 * AGENTS.md from the root of the repo down to its working folder.
 */
export function instructionFileIn(path: string, folders: readonly string[]): boolean {
  for (const folder of folders) {
    const rel = relative(resolve(folder), resolve(path));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    // Case-insensitive everywhere (a folder may be synced between systems), and without
    // what Windows ignores at the end of a name (`CLAUDE.md.`, `AGENTS.md::$DATA`).
    if (
      rel
        .split(/[/\\]+/)
        .filter(Boolean)
        .some((part) => INSTRUCTION_NAMES.has(segment(part)))
    ) {
      return true;
    }
  }
  return false;
}
