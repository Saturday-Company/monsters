import {
  appLang,
  ARTIFACT_MAX_BYTES,
  ToolError,
  type FileEventData,
  type FileMeta,
  type MonstersTool,
  type ToolContext,
} from '@monsters/shared';
import { z } from 'zod';
import { FileError, type FileStore } from './store.ts';

/*
 * Files the monsters make (D-075): `artifact_create` saves an HTML page among
 * the File (shown by the preview pane in a sandbox, without network and
 * without access to Monsters), and the images other programs return (the
 * browser's screenshots) are kept as files instead of being lost. Both log a
 * `file` event: the chat shows it as a chip that opens the preview.
 */

export const ARTIFACT_TOOL = 'artifact_create';

/** Largest image of another program kept as a file. */
export const TOOL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Most images of other programs kept in one run (the disk is the user's, review of 16/10). */
export const TOOL_IMAGES_PER_RUN = 50;

/** The `file` event of a file a monster or a tool made. */
export function fileEvent(
  meta: FileMeta,
  extra: { tool?: string; title?: string } = {},
  action: FileEventData['action'] = 'created',
): FileEventData {
  return {
    action,
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    source: meta.source,
    mime: meta.mime,
    size: meta.size,
    ...(extra.tool ? { tool: extra.tool } : {}),
    ...(extra.title ? { title: extra.title } : {}),
    ...(meta.inert ? { inert: true as const } : {}),
  };
}

const ArtifactInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe('File name, e.g. "confronto-prezzi" (".html" is added).'),
  html: z
    .string()
    .min(1)
    .describe('The whole page: <!doctype html>, inline <style> and <script> only.'),
  title: z.string().trim().max(120).optional().describe('Title shown to the user.'),
});

/** Said to the monster when its page is saved without scripts (D-085). */
export const INERT_NOTE =
  'This run read external content, so the page opens with its scripts turned off: the user turns them on with a click if they trust it. Make the content readable without JavaScript.';

/**
 * `artifact_create`: an HTML page made by the monster, saved among the File.
 * The page runs in a sandbox with no network: everything it needs (styles,
 * scripts, data, images as `data:` URLs) must be inside it.
 *
 * `tainted` says whether the run has read third-party text (D-085): its page
 * is saved `inert`, served without scripts until the user turns them on (an
 * instruction hidden in a page read could have asked for a page that sends
 * the notes out).
 */
export function artifactTool(
  files: () => FileStore,
  options: { tainted?: () => boolean } = {},
): MonstersTool<z.infer<typeof ArtifactInput>, unknown> {
  return {
    name: ARTIFACT_TOOL,
    description:
      "Saves an HTML page you wrote (a report, a comparison table, a chart, a small interactive tool) among the user's files; the user opens it in the preview next to the chat. " +
      'The page must be self-contained: it runs in a sandbox WITHOUT network and cannot read other files, so no external scripts, stylesheets, fonts, images or requests (fetch, links to load); put CSS, JavaScript, data and images (as data: URLs) inside the page. ' +
      'Max 2 MB. Use it when a page shows the result better than text; notes stay in the vault.',
    inputSchema: ArtifactInput,
    destructive: false,
    execute: async (input, ctx: ToolContext) => {
      const bytes = Buffer.from(input.html, 'utf8');
      if (bytes.byteLength > ARTIFACT_MAX_BYTES) {
        throw new ToolError(
          'INVALID_INPUT',
          `The page is ${Math.round(bytes.byteLength / 1024)} KB: at most 2 MB.`,
          {
            hint: 'Make it lighter: less inline data, smaller images.',
          },
        );
      }
      const name = input.name.replace(/\.html?$/i, '');
      const inert = options.tainted?.() === true;
      let meta: FileMeta;
      try {
        meta = await files().save({
          bytes,
          name: `${name}.html`,
          source: 'agent',
          agent: ctx.agentId,
          runId: ctx.runId,
          allowHtml: true,
          inert,
          title: input.title,
          tool: ARTIFACT_TOOL,
          maxBytes: ARTIFACT_MAX_BYTES,
        });
      } catch (err) {
        if (err instanceof FileError) throw new ToolError('INVALID_INPUT', err.message);
        throw err;
      }
      if (meta.kind !== 'html') {
        files().delete(meta.id);
        throw new ToolError('INVALID_INPUT', 'This is not an HTML page.', {
          hint: 'Start the page with <!doctype html>.',
        });
      }
      ctx.emit({
        type: 'file',
        data: fileEvent(meta, {
          tool: ARTIFACT_TOOL,
          ...(input.title ? { title: input.title } : {}),
        }),
      });
      return {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        fileId: meta.id,
        saved: `Saved among the user's files as "${meta.name}": the chat shows it, the user opens it in the preview.`,
        ...(inert ? { scripts: 'off', note: INERT_NOTE } : {}),
      };
    },
  };
}

/** A name for an image a program returned: `screenshot-browser-2026-10-16-1742.png`. */
export function toolImageName(
  server: string,
  preset: string | undefined,
  now = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // i18n-ignore: the file name the user sees in Files, in the language of the app
  const image = appLang() === 'it' ? 'immagine' : 'image';
  return `${preset === 'browser' ? 'screenshot' : image}-${server}-${stamp}`;
}

/** Checks that an image of another program can be kept (size, before decoding the base64). */
export function toolImageTooLarge(base64: string): boolean {
  return (base64.length * 3) / 4 > TOOL_IMAGE_MAX_BYTES;
}

export const FILE_READ_TOOL = 'file_read';
/** Characters of extracted text in one page of `file_read`. */
export const FILE_READ_PAGE_CHARS = 20_000;

const FileReadInput = z.object({
  file: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('File id (the "file id" of the attachment line), or the exact file name'),
  page: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .describe('Page of the text, from 1: long files come in pages'),
});

/** Who may read which file with `file_read`: the files of the conversation. */
export interface FileReadScope {
  /** Agents whose files these are: the monster, and who delegated to it. */
  agents: readonly string[];
  /** Files made in this run (screenshots, pages of the other monsters of the run). */
  runId: string;
  /**
   * A Telegram chat's run (review of 18/10, B5): only the files of the runs of that chat,
   * never the monster's other files (those the user gave it in the app). `agents` is ignored.
   */
  runs?: ReadonlySet<string>;
}

export interface FileReadOptions {
  files: () => FileStore;
  scope: (ctx: ToolContext) => FileReadScope;
  /**
   * Gives an image (or a PDF without text) to the model again with the next
   * step; false when it cannot (the model does not see, no next message).
   */
  show?: (meta: FileMeta) => boolean;
}

/** Whether `meta` is a file of the conversation `scope` stands for. */
export function inFileScope(meta: FileMeta, scope: FileReadScope): boolean {
  if (meta.runId === scope.runId) return true;
  if (scope.runs) return meta.runId !== undefined && scope.runs.has(meta.runId);
  return meta.agent !== undefined && scope.agents.includes(meta.agent);
}

const NOT_YOURS =
  'Only the files of this conversation can be read: those the user sent you, and those made in your work.';

/** `/api/files/<id>` or an id: the id. */
function fileRef(value: string): string {
  const m = /\/api\/files\/([0-9A-Z]{26})/.exec(value);
  return m?.[1] ?? value.trim();
}

/**
 * `file_read`: a file of the conversation read again without asking the user
 * to send it once more (review of 16/10: a monster "corrected" right answers
 * because the history said the attachments were no longer in front of it).
 * The text extracted at upload, in pages; an image goes back to the model
 * with the next step when it sees. The user's files are the user's data (the
 * run's taint keeps their text from leaving, like a note); a file a monster
 * or a tool made carries third-party text and taints the run (`taint.ts`).
 */
export function fileReadTool(
  options: FileReadOptions,
): MonstersTool<z.infer<typeof FileReadInput>, unknown> {
  return {
    name: FILE_READ_TOOL,
    description:
      'Reads again a file of this conversation (an attachment of an earlier message, a page or a screenshot made in your work) by its file id: ' +
      'the text extracted from it, in pages, or, for an image, the image itself when your model sees. ' +
      'Use it when you need the content again instead of asking the user to send the file again.',
    inputSchema: FileReadInput,
    readOnly: true,
    destructive: false,
    externalSource: (_input, output) => {
      const o = (output ?? {}) as { name?: unknown };
      return `file ${typeof o.name === 'string' ? o.name : ''}`.trim();
    },
    execute: async (input, ctx: ToolContext) => {
      const store = options.files();
      const scope = options.scope(ctx);
      const ref = fileRef(input.file);
      let meta = store.get(ref);
      if (!meta) {
        // By name: the newest file of the conversation with exactly that name.
        const want = ref.toLowerCase();
        meta = scope.agents
          .flatMap((agent) => store.list({ agent, q: ref, limit: 50 }))
          .filter((m) => m.name.toLowerCase() === want)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
      }
      if (!meta) {
        throw new ToolError('NOT_FOUND', `file not found: ${ref}`, {
          hint: 'Use the file id of the attachment line. A file the user deleted cannot be read: tell the user.',
        });
      }
      if (!inFileScope(meta, scope)) throw new ToolError('BLOCKED_BY_POLICY', NOT_YOURS);
      const base = { id: meta.id, name: meta.name, kind: meta.kind, source: meta.source };
      // A document just uploaded may still be in the extraction worker (D-085).
      await store.ready([meta.id]);
      const extracted = store.text(meta.id);
      if (!extracted) {
        if ((meta.kind === 'image' || meta.kind === 'pdf') && options.show?.(meta)) {
          return {
            ...base,
            shown: 'The file is given to you again with the next message: look at it there.',
          };
        }
        return {
          ...base,
          note:
            meta.kind === 'image'
              ? 'This is an image and it cannot be shown to you again here (your model does not see images, or this work has no next message): say so to the user, do not describe it beyond what you already said.'
              : 'No text could be read from this file: say so to the user instead of imagining its content.',
        };
      }
      const pages = Math.max(1, Math.ceil(extracted.text.length / FILE_READ_PAGE_CHARS));
      const page = Math.min(input.page ?? 1, pages);
      const text = extracted.text.slice(
        (page - 1) * FILE_READ_PAGE_CHARS,
        page * FILE_READ_PAGE_CHARS,
      );
      return {
        ...base,
        page,
        pages,
        text,
        ...(page < pages
          ? { more: `Page ${page} of ${pages}: ask page ${page + 1} for more.` }
          : {}),
        ...(extracted.truncated && page === pages
          ? { note: 'The text stops here: the file is longer than what could be extracted.' }
          : {}),
      };
    },
  };
}
