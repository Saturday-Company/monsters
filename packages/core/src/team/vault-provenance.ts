import { posix } from 'node:path';
import {
  ToolError,
  VAULT_LAYOUT_IDS,
  VAULT_LAYOUTS,
  type MonstersTool,
  type ToolContext,
} from '@monsters/shared';
import type { VaultService } from '@monsters/vault';
import { THIRD_PARTY_PROP } from './instinct/taint.ts';
import { vaultProvenancePrompts } from './vault-provenance.prompts.ts';

/*
 * Where the notes come from (review of 18/10, A2). A run that read
 * third-party text, or that a person who is not the user asked for, may write
 * what it read into a note; the next run that reads that note would take it as
 * the user's own data. So:
 * - what such a run writes (`vault_write`, `vault_edit`, `vault_propose`)
 *   carries the property `THIRD_PARTY_PROP` with its reason, and `vault_search`
 *   says which hits carry it: a run that reads them is tainted (`RunTaint`);
 * - such a run, or a run of a Telegram chat, never writes a monster's
 *   MEMORY.md with the vault tools: its «Da ricordare:» (“To remember:”) lines wait for the
 *   user (`MemoryProposals`), since the memory reaches every later prompt.
 */

function cleanPath(raw: string): string {
  return posix
    .normalize(raw.trim().replace(/\\/g, '/'))
    .replace(/^(?:\.\/|\/)+/, '')
    .normalize('NFC')
    .toLowerCase();
}

/**
 * A monster's memory note (`TeamService.memoryPath`), with the names of either layout
 * (`Agenti/<Name>/MEMORY.md`, `Agents/<Name>/MEMORY.md`, D-154), in any case: whatever the
 * vault's layout says, a held run never writes either (a vault with traces of both, a record
 * rewritten), as `protectedNote` does for the CLI token.
 */
export function isMemoryNote(path: string): boolean {
  const parts = cleanPath(path).split('/');
  if (parts.length !== 3 || parts[1] === '') return false;
  return VAULT_LAYOUT_IDS.some((id) => {
    const l = VAULT_LAYOUTS[id];
    const memory = l.memory.toLowerCase();
    return (
      parts[0] === l.agents.toLowerCase() && (parts[2] === memory || `${parts[2]}.md` === memory)
    );
  });
}

export interface VaultProvenanceOptions {
  vault: VaultService;
  /** Why what this run writes carries third-party text (tainted, or asked by a person who is not the user). */
  thirdParty: (runId: string) => string | undefined;
  /** This run may not write a memory itself: `thirdParty`, or a run of a Telegram chat. */
  memoryHeld: (runId: string) => boolean;
  /**
   * A line about the monster's accesses ("la ricerca web è negata", "Canva non è collegato"):
   * never written into a memory, which reaches every later prompt (D-141).
   */
  accessLine?: (line: string, agentId: string) => boolean;
}

type Input = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The notes a call would write (resolved like the vault does when they exist). */
async function targets(tool: string, input: Input, vault: VaultService): Promise<string[]> {
  const resolved = async (ref: string) => {
    if (!ref.trim()) return '';
    return vault.resolveExisting(ref).catch(() => ref);
  };
  switch (tool) {
    case 'vault_write':
      return [str(input['path'])];
    case 'vault_edit':
    case 'vault_restore':
    case 'vault_propose':
      return [await resolved(str(input['path']))];
    case 'vault_move': {
      const to = str(input['to']);
      if (!/[\\/]$/.test(to)) return [to];
      return [`${to}${posix.basename(await resolved(str(input['from'])))}`];
    }
    case 'vault_apply_proposal': {
      try {
        const note = await vault.read(
          { agentId: 'system' },
          { path: str(input['proposal_path']), max_chars: 200 },
        );
        return [str(note.frontmatter['target_path'])];
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}

const WRITERS = new Set([
  'vault_write',
  'vault_edit',
  'vault_move',
  'vault_restore',
  'vault_propose',
  'vault_apply_proposal',
]);

/** The writers whose text is in their input. */
const WRITTEN = new Set(['vault_write', 'vault_edit', 'vault_propose']);

/** The text a call writes: the content, or the new text of its edit ops. */
function writtenText(tool: string, input: Input): string {
  if (tool === 'vault_write') return str(input['content']);
  const ops = Array.isArray(input['ops']) ? (input['ops'] as unknown[]) : [];
  const out: string[] = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    for (const [kind, body] of Object.entries(op as Input)) {
      if (!body || typeof body !== 'object') continue;
      const b = body as Input;
      if (kind === 'str_replace') out.push(str(b['new']));
      else if (kind === 'append' || kind === 'prepend' || kind === 'replace_section')
        out.push(str(b['text']));
    }
  }
  return out.join('\n');
}

/** The lines of `text` the note does not have yet (a note that does not exist has none). */
async function addedLines(vault: VaultService, path: string, text: string): Promise<string[]> {
  let before = '';
  try {
    before =
      (await vault.read({ agentId: 'system' }, { path, max_chars: Number.MAX_SAFE_INTEGER }))
        .content ?? '';
  } catch {
    // A new note: every line is new.
  }
  const had = new Set(before.split('\n').map((l) => l.trim()));
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !had.has(l));
}

/** A vault tool that keeps where the notes come from; the others as they are. */
export function withProvenance(t: MonstersTool, o: VaultProvenanceOptions): MonstersTool {
  if (t.name === 'vault_search') {
    return {
      ...t,
      async execute(input: unknown, ctx: ToolContext) {
        const hits: unknown = await t.execute(input, ctx);
        if (!Array.isArray(hits)) return hits;
        const list = hits as unknown[];
        const paths = list
          .map((h) => (h as { path?: unknown }).path)
          .filter((p): p is string => typeof p === 'string');
        const marked = new Set(o.vault.index.pathsWithProp(paths, THIRD_PARTY_PROP));
        if (marked.size === 0) return list;
        // The model sees it too: those snippets are data written after third-party text.
        return list.map((h): unknown =>
          marked.has((h as { path: string }).path)
            ? { ...(h as object), [THIRD_PARTY_PROP]: true }
            : h,
        );
      },
    };
  }
  if (!WRITERS.has(t.name)) return t;
  return {
    ...t,
    async execute(raw: unknown, ctx: ToolContext) {
      const input = (raw && typeof raw === 'object' ? raw : {}) as Input;
      let paths: string[] | undefined;
      const memoryNote = async () =>
        (paths ??= await targets(t.name, input, o.vault)).find(isMemoryNote);
      if (o.memoryHeld(ctx.runId) && (await memoryNote())) {
        throw new ToolError('BLOCKED_BY_POLICY', vaultProvenancePrompts().memoryWriteDenied);
      }
      if (o.accessLine && WRITTEN.has(t.name)) {
        const note = await memoryNote();
        if (note) {
          const lines = (await addedLines(o.vault, note, writtenText(t.name, input))).filter((l) =>
            o.accessLine!(l, ctx.agentId),
          );
          if (lines.length > 0) {
            throw new ToolError('INVALID_INPUT', vaultProvenancePrompts().memoryAccessRefused, {
              hint: `Write the memory again without these lines: ${lines.map((l) => `«${l.slice(0, 160)}»`).join(' ')}`,
              details: { lines },
            });
          }
        }
      }
      const reason = o.thirdParty(ctx.runId)?.slice(0, 200);
      if (!reason) return t.execute(raw, ctx);
      const mark = { [THIRD_PARTY_PROP]: reason };
      if (t.name === 'vault_write') {
        const frontmatter = (input['frontmatter'] ?? {}) as Input;
        return t.execute({ ...input, frontmatter: { ...frontmatter, ...mark } }, ctx);
      }
      if (t.name === 'vault_edit' || t.name === 'vault_propose') {
        // Last, so that no op of the call takes it away; a proposal marks its target too.
        const ops = Array.isArray(input['ops']) ? (input['ops'] as unknown[]) : [];
        const out = await t.execute({ ...input, ops: [...ops, { set_props: mark }] }, ctx);
        if (t.name === 'vault_propose') await markNote(o.vault, ctx, out, mark);
        return out;
      }
      return t.execute(raw, ctx);
    },
  };
}

/** The proposal note itself: the orchestrator who reads it reads third-party text. */
async function markNote(
  vault: VaultService,
  ctx: ToolContext,
  out: unknown,
  mark: Input,
): Promise<void> {
  const o = (out ?? {}) as { proposal_path?: unknown };
  if (typeof o.proposal_path !== 'string') return;
  try {
    const note = await vault.read({ agentId: 'system' }, { path: o.proposal_path, max_chars: 200 });
    await vault.edit(
      { agentId: ctx.agentId, signal: ctx.signal, emit: (e) => ctx.emit(e) },
      { path: o.proposal_path, base_hash: note.hash, ops: [{ set_props: mark }] },
    );
  } catch {
    // The proposal stays; its target is marked when applied.
  }
}
