import {
  defineTool,
  vaultLayout,
  type MonstersTool,
  type ToolContext,
  type VaultLayout,
} from '@monsters/shared';
import { z } from 'zod';
import { fixAgentEditOps, fixAgentWrite } from './note-fixes.ts';
import { EditOpsSchema } from './schemas.ts';
import type { VaultActor, VaultService } from './service.ts';
import { toolPrompts } from './tools.prompts.ts';

/*
 * Vault tools for agents (research/04 §6.4). Semantics follow Anthropic's
 * memory tool where possible (str_replace with a unique `old`). Every write
 * returns {action_id, commit, path, hash} and emits a `vault_change` event.
 */

function actor(ctx: ToolContext): VaultActor {
  return { agentId: ctx.agentId, signal: ctx.signal, emit: (e) => ctx.emit(e) };
}

const PathSchema = z.string().min(1).max(512);
const HashSchema = z.string().min(8).max(64);

/** The inputs that show a folder or a tag as an example follow the vault's layout (D-154). */
const searchInput = (layout: VaultLayout) =>
  z.object({
    query: z
      .string()
      .max(500)
      .optional()
      .describe(
        'What to find: words or a question. Accents ignored, "quoted phrase" for exact. Empty = filters only',
      ),
    mode: z
      // `auto` is the phase 1 name of the default, still accepted (same as hybrid).
      .enum(['hybrid', 'text', 'semantic', 'auto'])
      .optional()
      .describe(
        'Default hybrid (words + meaning; auto is the same); text = words only; semantic = meaning only',
      ),
    related_to: z
      .string()
      .max(512)
      .optional()
      .describe('Instead of a query: notes similar in meaning to this note (path or title)'),
    tags: z.array(z.string()).max(10).optional().describe(toolPrompts(layout).searchTags),
    folder: z.string().optional().describe(toolPrompts(layout).searchFolder),
    type: z
      .string()
      .optional()
      .describe('Frontmatter type: note, project, person, daily, decision, memory…'),
    updated_after: z.string().optional().describe('ISO date, e.g. 2026-10-01'),
    links_to: z.string().optional().describe('Only notes linking to this note (path or title)'),
    limit: z.number().int().min(1).max(50).optional().describe('Default 10'),
  });

const ReadInput = z.object({
  path: PathSchema.describe('Path, title or alias of the note (like a wikilink)'),
  section: z
    .string()
    .optional()
    .describe(
      'Return only this section (heading text; a close name or a bold title line is found too, and if nothing fits you get the whole note)',
    ),
  max_chars: z.number().int().min(200).max(100_000).optional().describe('Default 20000'),
});

const ListInput = z.object({
  folder: z.string().optional().describe('Default: vault root'),
  recursive: z.boolean().optional().describe('Include subfolders (default false)'),
  sort: z.enum(['updated', 'name']).optional().describe('Default updated (newest first)'),
  limit: z.number().int().min(1).max(500).optional().describe('Default 50'),
});

const writeInput = (layout: VaultLayout) =>
  z
    .object({
      path: PathSchema.describe(toolPrompts(layout).writePath),
      content: z
        .string()
        .max(1_000_000)
        .describe('Markdown body; start with "# Title" and a 1-3 line summary'),
      frontmatter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(toolPrompts(layout).writeFrontmatter),
      mode: z
        .enum(['create', 'overwrite'])
        .optional()
        .describe('Default create (fails if the note exists)'),
      base_hash: HashSchema.optional().describe(
        'Required with overwrite: the hash from vault_read',
      ),
    })
    .refine((v) => v.mode !== 'overwrite' || !!v.base_hash, {
      message: 'base_hash is required with mode "overwrite"',
      path: ['base_hash'],
    });

const EditInput = z.object({
  path: PathSchema,
  base_hash: HashSchema.describe(
    'The hash from vault_read: the edit fails with CONFLICT if the note changed',
  ),
  ops: EditOpsSchema.describe(
    'Applied in order, all or nothing. One key per op: str_replace {old,new} | append {text, section?} | ' +
      'prepend {text} | replace_section {heading,text} | set_props {...} | remove_props [keys]',
  ),
});

const moveInput = (layout: VaultLayout) =>
  z.object({
    from: PathSchema,
    to: PathSchema.describe(toolPrompts(layout).movePath),
    update_links: z
      .boolean()
      .optional()
      .describe('Rewrite links pointing to the note (default true)'),
  });

const DeleteInput = z.object({
  path: PathSchema,
  reason: z.string().min(1).max(500).describe('Why: recorded in the history'),
});

const LinksInput = z.object({
  path: PathSchema,
  direction: z.enum(['out', 'in', 'both']).optional().describe('Default both'),
  depth: z.number().int().min(1).max(3).optional().describe('Hops to follow, default 1'),
  include_unresolved: z.boolean().optional().describe('Include links to notes that do not exist'),
});

const tagsInput = (layout: VaultLayout) =>
  z.object({
    prefix: z.string().optional().describe(toolPrompts(layout).tagsPrefix),
  });

const HistoryInput = z.object({
  path: z.string().optional().describe('History of one note (default: whole vault)'),
  limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
});

const RestoreInput = z.object({
  path: PathSchema,
  commit: z
    .string()
    .min(4)
    .optional()
    .describe('Version to restore (from vault_history); omit for a deleted note'),
});

const UndoInput = z.object({
  action_id: z.string().min(1).describe('action_id returned by a write, or from vault_history'),
  force: z.boolean().optional().describe('Also discard later changes to the same files'),
});

const ProposeInput = z.object({
  path: PathSchema.describe('Note you want to change'),
  ops: EditOpsSchema.describe('Same ops as vault_edit'),
  note: z.string().min(1).max(2000).describe('Why the change is useful, for the reviewer'),
});

const ApplyProposalInput = z.object({
  proposal_path: PathSchema.describe('Proposal note in Inbox/'),
});

export function vaultSearchTool(vault: VaultService) {
  return defineTool({
    name: 'vault_search',
    description:
      'Search the notes of the vault (second brain) by words and meaning (a question works too), with filters ' +
      'by tag, folder, type, date or links; related_to: the few notes clearly on the same subject (maybe none). Returns paths and ' +
      'snippets (read with vault_read); partial = only some words match.',
    inputSchema: searchInput(vault.layout),
    readOnly: true,
    // Snippets of notes: data for the model, never instructions (D-021).
    externalSource: (input) => `vault_search ${input.query ?? input.related_to ?? ''}`,
    execute: (input, ctx) => vault.search(actor(ctx), input),
  });
}

export function vaultReadTool(vault: VaultService) {
  return defineTool({
    name: 'vault_read',
    description:
      'Read a note by path, title or alias. Returns frontmatter, Markdown body, links and its hash: ' +
      'pass the hash as base_hash to vault_edit or vault_write overwrite.',
    inputSchema: ReadInput,
    readOnly: true,
    externalSource: (input, output: { path?: string }) => `vault ${output.path ?? input.path}`,
    execute: (input, ctx) => vault.read(actor(ctx), input),
  });
}

export function vaultListTool(vault: VaultService) {
  return defineTool({
    name: 'vault_list',
    description: 'List the notes and subfolders of a folder of the vault.',
    inputSchema: ListInput,
    readOnly: true,
    execute: (input, ctx) => vault.list(actor(ctx), input),
  });
}

export function vaultWriteTool(vault: VaultService) {
  return defineTool({
    name: 'vault_write',
    description: toolPrompts(vault.layout).writeTool,
    inputSchema: writeInput(vault.layout),
    destructive: true,
    async execute(input, ctx) {
      const fixed = fixAgentWrite(input, { titleOf: ctx.linkTitle });
      const result = await vault.write(actor(ctx), fixed.input);
      return fixed.corrected.length > 0 ? { ...result, corrected: fixed.corrected } : result;
    },
  });
}

export function vaultEditTool(vault: VaultService) {
  return defineTool({
    name: 'vault_edit',
    description:
      'Change part of a note: str_replace (old must be unique), append (optionally to a section), prepend, ' +
      'replace_section, set_props, remove_props. Needs base_hash from vault_read; on CONFLICT read again and retry.',
    inputSchema: EditInput,
    async execute(input, ctx) {
      const fixed = fixAgentEditOps(input.ops, { titleOf: ctx.linkTitle });
      const result = await vault.edit(actor(ctx), { ...input, ops: fixed.ops });
      return fixed.corrected.length > 0 ? { ...result, corrected: fixed.corrected } : result;
    },
  });
}

export function vaultMoveTool(vault: VaultService) {
  return defineTool({
    name: 'vault_move',
    description: 'Rename or move a note. Links pointing to it are updated in the same change.',
    inputSchema: moveInput(vault.layout),
    destructive: true,
    execute: (input, ctx) => vault.move(actor(ctx), input),
  });
}

export function vaultDeleteTool(vault: VaultService) {
  return defineTool({
    name: 'vault_delete',
    description:
      'Move a note to the trash (.trash/, like Obsidian). It can be restored with vault_restore.',
    inputSchema: DeleteInput,
    destructive: true,
    execute: (input, ctx) => vault.delete(actor(ctx), input),
  });
}

export function vaultLinksTool(vault: VaultService) {
  return defineTool({
    name: 'vault_links',
    description:
      'Follow the links of a note: outgoing, backlinks or both, up to 3 hops. Returns nodes and edges.',
    inputSchema: LinksInput,
    readOnly: true,
    execute: (input, ctx) => vault.links(actor(ctx), input),
  });
}

export function vaultTagsTool(vault: VaultService) {
  return defineTool({
    name: 'vault_tags',
    description:
      'List the tags of the vault with how many notes use each (parents of nested tags included).',
    inputSchema: tagsInput(vault.layout),
    readOnly: true,
    execute: (input, ctx) => Promise.resolve(vault.tags(actor(ctx), input)),
  });
}

export function vaultHistoryTool(vault: VaultService) {
  return defineTool({
    name: 'vault_history',
    description:
      'Show the change history (git) of the vault or of one note: commit, date, author, action_id.',
    inputSchema: HistoryInput,
    readOnly: true,
    execute: (input, ctx) => vault.history(actor(ctx), input),
  });
}

export function vaultRestoreTool(vault: VaultService) {
  return defineTool({
    name: 'vault_restore',
    description:
      'Bring a note back to a previous version (commit from vault_history), or recover a deleted note. ' +
      'Creates a new change: nothing is lost.',
    inputSchema: RestoreInput,
    destructive: true,
    execute: (input, ctx) => vault.restore(actor(ctx), input),
  });
}

export function vaultUndoTool(vault: VaultService) {
  return defineTool({
    name: 'vault_undo',
    description: 'Undo a whole write action (all its files) by action_id, with a new change.',
    inputSchema: UndoInput,
    destructive: true,
    execute: (input, ctx) => vault.undo(actor(ctx), input),
  });
}

export function vaultProposeTool(vault: VaultService) {
  return defineTool({
    name: 'vault_propose',
    description:
      'Propose a change to a note you cannot edit: creates a proposal in Inbox/ with the diff; ' +
      'the orchestrator reviews and applies it.',
    inputSchema: ProposeInput,
    execute: (input, ctx) => vault.propose(actor(ctx), input),
  });
}

export function vaultApplyProposalTool(vault: VaultService) {
  return defineTool({
    name: 'vault_apply_proposal',
    description:
      'Apply a proposal created with vault_propose (orchestrator only). One change for note and proposal.',
    inputSchema: ApplyProposalInput,
    execute: (input, ctx) => vault.applyProposal(actor(ctx), input),
  });
}

/** Every vault tool (orchestrator and capable models). */
export function vaultTools(vault: VaultService): MonstersTool[] {
  return [
    vaultSearchTool(vault),
    vaultReadTool(vault),
    vaultListTool(vault),
    vaultWriteTool(vault),
    vaultEditTool(vault),
    vaultMoveTool(vault),
    vaultDeleteTool(vault),
    vaultLinksTool(vault),
    vaultTagsTool(vault),
    vaultHistoryTool(vault),
    vaultRestoreTool(vault),
    vaultUndoTool(vault),
    vaultProposeTool(vault),
    vaultApplyProposalTool(vault),
  ] as MonstersTool[];
}

/**
 * Tools offered to external AI clients through the MCP server of the vault:
 * every tool except applying proposals, which is the orchestrator's job.
 */
export function externalVaultTools(vault: VaultService): MonstersTool[] {
  return vaultTools(vault).filter((t) => t.name !== 'vault_apply_proposal');
}

/** What an MCP server needs to list the external tools without a vault (it calls the core). */
export interface VaultToolSpec {
  name: string;
  description: string;
  inputSchema: MonstersTool['inputSchema'];
  readOnly: boolean;
  destructive: boolean;
}

export function externalVaultToolSpecs(): VaultToolSpec[] {
  // The factories only use the vault inside `execute`, never called here.
  const none = new Proxy({} as VaultService, {
    get(_target, prop) {
      // Only the layout of the vault in use is read, for the examples of the descriptions.
      if (prop === 'layout') return vaultLayout();
      throw new Error('externalVaultToolSpecs: tools are not executable');
    },
  });
  return externalVaultTools(none).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    readOnly: t.readOnly ?? false,
    destructive: t.destructive ?? false,
  }));
}

/** Minimal subset for small or free models: search, read, write, edit, delete. */
export function vaultCoreTools(vault: VaultService): MonstersTool[] {
  return [
    vaultSearchTool(vault),
    vaultReadTool(vault),
    vaultWriteTool(vault),
    vaultEditTool(vault),
    vaultDeleteTool(vault),
  ] as MonstersTool[];
}
