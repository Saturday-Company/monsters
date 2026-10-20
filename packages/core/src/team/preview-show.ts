import {
  defineTool,
  ToolError,
  type FileMeta,
  type MonstersTool,
  type PreviewItem,
} from '@monsters/shared';
import type { VaultService } from '@monsters/vault';
import { z } from 'zod';

/*
 * `preview_show` (plan of 16/10 feature 4, D-075): a monster shows the user a
 * note or a file in the preview pane next to the chat, when seeing it is
 * clearer than describing it. The tool checks the item and logs a `preview`
 * event (the web app opens the pane, the chat keeps a chip); it returns at once.
 *
 * - A note is read as the calling monster (`vault.read`), so its read scope
 *   applies: a private note stays closed to a monster that cannot read it.
 * - A file is any file of the files store. Files live in the notes folder under
 *   `File/` and are readable like the non-private notes; showing one to the
 *   user, on the user's own screen, reveals nothing they could not open already.
 */

export const PREVIEW_SHOW_TOOL = 'preview_show';

/** Lookup of the files store (wave 2): absent, files cannot be shown. */
export interface PreviewFiles {
  get(id: string): Promise<FileMeta | null> | FileMeta | null;
}

export const PreviewShowInput = z.object({
  note: z.string().min(1).max(400).optional().describe('Path or title of a note'),
  file: z.string().min(1).max(100).optional().describe('File id'),
  caption: z.string().max(200).optional().describe('One line: why you show it'),
});

const ONE_OF = 'Give exactly one of `note` (path or title) and `file` (file id).';
const SHOWN_NOTE =
  'The user sees it next to your chat (or as a chip in it). Say in one line what it is; do not describe it again.';
const INERT_SHOWN_NOTE =
  'The page has its scripts turned off (this run read external content): it is a chip in the chat, the user opens it when they want. Say in one line what it is.';

/** `/api/files/<id>`, `/api/files/<id>/content` (also with host or query) → `<id>`. */
export function fileIdOf(value: string): string {
  const v = value.trim();
  const m = /\/api\/files\/([^/?#]+)/.exec(v);
  if (!m?.[1]) return v;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** `[[Title]]` or `[[Title|alias]]` → `Title`; anything else as given. */
function noteRef(value: string): string {
  const v = value.trim();
  const m = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(v);
  return (m?.[1] ?? v).trim();
}

export function previewShowTool(ctx: {
  vault: Pick<VaultService, 'read'>;
  /** The files store; a getter so it can be plugged in after the hub is built. */
  files?: PreviewFiles | (() => PreviewFiles | undefined) | undefined;
}): MonstersTool {
  const filesStore = (): PreviewFiles | undefined =>
    typeof ctx.files === 'function' ? ctx.files() : ctx.files;
  return defineTool({
    name: PREVIEW_SHOW_TOOL,
    description:
      'Show the user a note or a file (image, PDF, an HTML page you made, a document) in the preview pane ' +
      'next to the chat, when seeing it is clearer than describing it. Returns at once; do not repeat its ' +
      'content at length.',
    inputSchema: PreviewShowInput,
    async execute(input, tc) {
      const note = input.note?.trim() || undefined;
      const file = input.file?.trim() || undefined;
      if ((note === undefined) === (file === undefined)) {
        throw new ToolError('INVALID_INPUT', 'one of note or file is required, not both', {
          hint: ONE_OF,
        });
      }
      const caption = input.caption?.trim() || undefined;
      let item: PreviewItem;
      let name: string;
      let fileKind: FileMeta['kind'] | undefined;
      let inert = false;
      if (note !== undefined) {
        // NOT_FOUND and the refusals of the vault (BLOCKED_BY_POLICY, SETTING_OFF) reach the model as they are.
        const read = await ctx.vault.read(
          { agentId: tc.agentId, signal: tc.signal },
          { path: noteRef(note), max_chars: 1 },
        );
        if (read.content === null) {
          throw new ToolError('INVALID_INPUT', `${read.path} is not a note`, {
            hint: 'Only markdown notes go in `note`: for files use `file` with the id.',
          });
        }
        item = { kind: 'note', path: read.path };
        name = read.title.slice(0, 200) || read.path.slice(0, 200);
      } else {
        const files = filesStore();
        if (!files) {
          throw new ToolError('UNAVAILABLE', 'files are not available here', {
            hint: 'Show a note with `note`, or tell the user where the file is.',
          });
        }
        const id = fileIdOf(file!);
        const meta = await files.get(id);
        if (!meta) {
          throw new ToolError('NOT_FOUND', `file not found: ${id}`, {
            hint: 'Use the id of a file you made or received (e.g. from artifact_create).',
          });
        }
        item = { kind: 'file', fileId: meta.id };
        name = meta.name.slice(0, 200);
        fileKind = meta.kind;
        // A page of a run that read third-party text never opens by itself (D-085): only the chip.
        inert = meta.kind === 'html' && meta.inert === true;
      }
      tc.emit({
        type: 'preview',
        data: {
          item,
          name,
          ...(fileKind ? { fileKind } : {}),
          ...(caption ? { caption } : {}),
          ...(inert ? { inert: true as const } : {}),
        },
      });
      return inert
        ? { status: 'chip', name, note: INERT_SHOWN_NOTE }
        : { status: 'shown', name, note: SHOWN_NOTE };
    },
  });
}
