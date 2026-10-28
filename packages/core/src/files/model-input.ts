import type { FileMeta } from '@monsters/shared';
import type { FilePart, TextPart } from 'ai';
import { fallbackTextOptions } from '@monsters/providers';
import { filePrompts } from './files.prompts.ts';

/*
 * The files of a message as a model receives them (D-075, plan of 16/10 §5):
 * images as images to the models that see, PDFs as files to Anthropic,
 * OpenAI and Google, the extracted text (clipped, with the name) to the others
 * and for every document. A model that cannot see an image gets its name and
 * a line saying so: the monster says it cannot see it instead of inventing.
 * Past turns carry a short reference line, never the bytes again.
 */

/** What a model reads besides text. */
export interface ModelSight {
  images: boolean;
  pdf: boolean;
}

/** Characters of extracted text given per file, and in all, with one message. */
export const ATTACHMENT_TEXT_CHARS = 30_000;
export const ATTACHMENTS_TEXT_TOTAL = 60_000;

const SEES_IMAGES: Record<string, RegExp> = {
  anthropic: /^claude-(3|sonnet|opus|haiku|[4-9])/,
  openai: /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|chatgpt-4o|o1(?!-mini)|o3|o4)/,
  google: /^gemini/,
  mistral: /pixtral|mistral-(medium|small)-(latest|25|26)|magistral-(medium|small)-25(09|1)/,
  groq: /llama-4|vision/,
  ollama: /llava|vision|-vl|gemma3|qwen2\.5vl|qwen3-vl|minicpm-v|llama4|mistral-small3/,
  lmstudio: /llava|vision|-vl|gemma-3|qwen2\.5-vl|qwen3-vl|minicpm-v|llama-4|mistral-small-3/,
};
/** Providers whose PDF file parts the AI SDK sends natively. */
const READS_PDF = new Set(['anthropic', 'openai', 'google', 'chatgpt']);

/** On OpenRouter without a list: the families that see, by the id of the model. */
const OPENROUTER_SEES =
  /^(anthropic\/claude|openai\/(gpt-4o|gpt-4\.1|gpt-5|o3|o4)|google\/gemini|google\/gemma-3|meta-llama\/llama-4|qwen\/qwen.*vl|mistralai\/(pixtral|mistral-(small|medium)-3))/;

/**
 * What `model` of `provider` reads. `listed` is what the provider's model
 * list says (OpenRouter's `input_modalities`); without it, the documented
 * families. Unknown models are taken as text only.
 */
export function modelSight(
  provider: string,
  model: string,
  listed?: readonly string[],
): ModelSight {
  const id = model.toLowerCase();
  if (provider === 'openrouter') {
    // The free router picks a model per request: it may not see.
    if (id === 'openrouter/free' || id === 'openrouter/auto') return { images: false, pdf: false };
    if (listed) return { images: listed.includes('image'), pdf: listed.includes('file') };
    const sees = OPENROUTER_SEES.test(id);
    return { images: sees, pdf: false };
  }
  if (provider === 'chatgpt') return { images: true, pdf: true };
  if (listed)
    return {
      images: listed.includes('image'),
      pdf: listed.includes('file') && READS_PDF.has(provider),
    };
  const images = SEES_IMAGES[provider]?.test(id) ?? false;
  return { images, pdf: images && READS_PDF.has(provider) };
}

/**
 * The note that takes the place of an image or a PDF in the prompt of a model that cannot read it
 * (a fallback after a model that could): it names the file and tells the model to say so. A PDF
 * that came with its extracted text (`fallback`) gives that text instead.
 */
export function unreadableFileNote(
  kind: 'image' | 'pdf',
  filename: string | undefined,
  fallback?: string,
): string {
  const p = filePrompts();
  // A PDF whose text the core has: the model reads that instead (already framed as extracted).
  if (kind === 'pdf' && fallback) return fallback;
  const label = filename ? promptName(filename) : kindWord(kind);
  return p.notes(kind === 'image' ? p.imageBlind(label) : p.pdfBlind(label));
}

/** The word for a kind of file, in the language of the prompts. */
export const kindWord = (kind: FileMeta['kind']): string => filePrompts().kind[kind];

/**
 * A file name as it goes in the prompt: on one line, without the characters that
 * could close or open a block (`<`, `>`, `"`, brackets). The store cleans names
 * already; this holds for any name (D-085).
 */
export function promptName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
      .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
      .replace(/"/g, "'")
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .slice(0, 300)
  );
}

/**
 * Extracted text inside `<allegato>`: a `</allegato>` (or a new `<allegato …>`)
 * in the file, in any case and spacing, would end the block and make what
 * follows look like Monsters' words. Its `<` becomes `‹` (D-085).
 */
export function promptBody(text: string): string {
  // i18n-ignore: the tag of each family of prompts (Italian, English), both guarded
  return text.replace(/<(\s*\/?\s*(?:allegato|attachment))/giu, '‹$1');
}

/** "foto.png (immagine, 240 KB)". */
export function fileLabel(f: Pick<FileMeta, 'name' | 'kind' | 'size'>): string {
  return `${promptName(f.name)} (${kindWord(f.kind)}, ${filePrompts().size(f.size)})`;
}

/** The words that mark a past attachment in the history (the hub offers `file_read` when they appear). */
export const PAST_ATTACHMENT_MARK = 'file id ';

/** "foto.png (immagine, 240 KB, file id 01J…)". */
function pastFileLabel(f: Pick<FileMeta, 'id' | 'name' | 'kind' | 'size'>): string {
  return `${promptName(f.name)} (${kindWord(f.kind)}, ${filePrompts().size(f.size)}, ${PAST_ATTACHMENT_MARK}${f.id})`;
}

/**
 * The line a past message with files keeps in the history: names and ids, not
 * bytes. Neutral on purpose (review of 16/10): "Non li hai più davanti, chiedi
 * di rimandarli" made a monster take back right answers about a PDF as
 * "non verificabili". What it said then, it said reading the file; the
 * content comes back with `file_read`, without asking the user.
 */
export function attachmentsLine(
  files: readonly Pick<FileMeta, 'id' | 'name' | 'kind' | 'size'>[],
  missing = 0,
): string {
  const p = filePrompts();
  const names = files.map(pastFileLabel);
  if (missing > 0) names.push(missing === 1 ? p.deletedOne : p.deletedMany(missing));
  return p.past(names.join(', '), files.length > 0 ? p.reread : '');
}

export interface AttachmentSource {
  meta: FileMeta;
  /** The bytes (images, PDF), read only when they go to the model. */
  bytes: () => Buffer | null;
  text: () => { text: string; truncated: boolean } | null;
}

export type UserPart = TextPart | FilePart;

/**
 * The parts that follow the text of the user's message. `harness`: the
 * harness reads the files itself from these absolute paths (Claude Code).
 */
export function attachmentParts(
  files: readonly AttachmentSource[],
  sight: ModelSight,
  options: { paths?: (meta: FileMeta) => string } = {},
): UserPart[] {
  const p = filePrompts();
  const parts: UserPart[] = [];
  const notes: string[] = [];
  let textLeft = ATTACHMENTS_TEXT_TOTAL;
  // The text of the PDFs sent as files, kept for a link that cannot read them: the same limits.
  let fallbackLeft = ATTACHMENTS_TEXT_TOTAL;
  for (const f of files) {
    const { meta } = f;
    const label = fileLabel(meta);
    if (options.paths) {
      notes.push(`- ${label}: ${options.paths(meta)}`);
      continue;
    }
    if (meta.kind === 'image') {
      const bytes = sight.images ? f.bytes() : null;
      if (bytes) {
        parts.push({ type: 'text', text: p.attached(label) });
        // An image is a file part with an image type (the `image` part is deprecated in AI SDK 7).
        parts.push({
          type: 'file',
          data: new Uint8Array(bytes),
          mediaType: meta.mime,
          filename: meta.name,
        });
      } else {
        notes.push(p.imageBlind(label));
      }
      continue;
    }
    if (meta.kind === 'pdf' && sight.pdf) {
      const bytes = f.bytes();
      if (bytes) {
        const extracted = f.text();
        const max = Math.min(ATTACHMENT_TEXT_CHARS, fallbackLeft);
        let fallback: string | undefined;
        if (extracted && max > 0) {
          const clipped = extracted.text.length > max;
          const body = clipped ? extracted.text.slice(0, max) : extracted.text;
          fallbackLeft -= body.length;
          fallback = p.extracted(
            label,
            promptName(meta.name),
            promptBody(body),
            clipped || extracted.truncated ? p.cut : '',
          );
        }
        parts.push({ type: 'text', text: p.attached(label) });
        parts.push({
          type: 'file',
          data: new Uint8Array(bytes),
          mediaType: 'application/pdf',
          filename: meta.name,
          ...(fallback ? { providerOptions: fallbackTextOptions(fallback) } : {}),
        });
        continue;
      }
    }
    const extracted = f.text();
    if (!extracted || textLeft <= 0) {
      notes.push(p.textMissing(label, Boolean(extracted)));
      continue;
    }
    const max = Math.min(ATTACHMENT_TEXT_CHARS, textLeft);
    const clipped = extracted.text.length > max;
    const body = clipped ? extracted.text.slice(0, max) : extracted.text;
    textLeft -= body.length;
    const cut = clipped || extracted.truncated ? p.cut : '';
    parts.push({
      type: 'text',
      text: p.extracted(label, promptName(meta.name), promptBody(body), cut),
    });
  }
  if (notes.length > 0) {
    parts.push({
      type: 'text',
      text: options.paths ? p.notesOnDisk(notes.join('\n')) : p.notes(notes.join('\n')),
    });
  }
  return parts;
}

/** The files of a message for a harness, which reads some of them itself. */
export interface HarnessAttachments {
  /** Added to the prompt: the paths to read, the extracted text of the others. */
  text: string;
  /** Absolute paths the harness may `Read` (Claude Code: images and PDFs). */
  read: string[];
  /** Absolute paths of images given as images (Codex). */
  images: string[];
}

/**
 * Claude Code reads images and PDFs itself with `Read` (given the path);
 * Codex gets images as images; every other file goes as its extracted text.
 */
export function harnessAttachments(
  files: readonly AttachmentSource[],
  harness: string,
  /** Null when the file is no longer where it was (the files folder changed): its text goes. */
  abs: (meta: FileMeta) => string | null,
): HarnessAttachments {
  const read: string[] = [];
  const images: string[] = [];
  const own: AttachmentSource[] = [];
  const shown: AttachmentSource[] = [];
  const rest: AttachmentSource[] = [];
  const paths = new Map<FileMeta, string>();
  for (const f of files) {
    const claude = harness === 'claude-agent' && (f.meta.kind === 'image' || f.meta.kind === 'pdf');
    const codex = harness === 'codex' && f.meta.kind === 'image';
    const path = claude || codex ? abs(f.meta) : null;
    if (path) paths.set(f.meta, path);
    if (claude && path) {
      read.push(path);
      own.push(f);
    } else if (codex && path) {
      images.push(path);
      shown.push(f);
    } else rest.push(f);
  }
  const none: ModelSight = { images: false, pdf: false };
  const parts: UserPart[] = [
    ...(own.length > 0 ? attachmentParts(own, none, { paths: (m) => paths.get(m) ?? '' }) : []),
    ...attachmentParts(rest, none),
  ];
  if (shown.length > 0) {
    parts.push({
      type: 'text',
      text: filePrompts().imagesBelow(shown.map((f) => fileLabel(f.meta)).join(', ')),
    });
  }
  return {
    text: parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .filter(Boolean)
      .join('\n\n'),
    read,
    images,
  };
}
