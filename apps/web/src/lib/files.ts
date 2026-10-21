import {
  FILE_MAX_BYTES,
  formatNumber,
  MESSAGE_MAX_ATTACHMENTS,
  type FileKind,
  type FileMeta,
} from '@monsters/shared';
import { filesLibStrings } from './files.strings.ts';

/*
 * Files in the web app (D-075): what the composer accepts, the thumbnail the
 * browser makes before the upload (the core has no image library), the words
 * for sizes, kinds and sources. The bytes are read through the API client
 * (`getApi().fileUrl`), so the mock serves them too.
 */

export { FILE_MAX_BYTES, MESSAGE_MAX_ATTACHMENTS };

/** What the file picker offers (the core checks the bytes anyway). */
export const ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,' +
  '.md,.txt,.csv,.json,.docx,.xlsx,.pptx,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const ALLOWED_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'pdf',
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'docx',
  'xlsx',
  'pptx',
]);

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** Why a file cannot be attached, before sending it; null when it may go. */
export function precheck(file: { name: string; size: number; type: string }): string | null {
  const s = filesLibStrings();
  if (file.size === 0) return s.empty;
  if (file.size > FILE_MAX_BYTES) return s.tooBig;
  const ext = extOf(file.name);
  if (ext === 'heic' || ext === 'heif' || /heic|heif/.test(file.type)) {
    return s.heic;
  }
  if (ext === 'html' || ext === 'htm' || file.type === 'text/html') {
    return s.html;
  }
  // A pasted image has a type and often no name worth trusting.
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return null;
  if (ext && ALLOWED_EXT.has(ext)) return null;
  if (!ext && /^text\//.test(file.type)) return null;
  return s.notAllowed;
}

/** Longest side of a thumbnail. */
const THUMB_SIDE = 320;

/** A WebP thumbnail of an image, made in the browser; null when it cannot. */
export async function makeThumb(file: Blob): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || typeof createImageBitmap !== 'function') {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.8),
    );
    // A browser without a WebP encoder gives PNG back: the core wants WebP only.
    return blob && blob.type === 'image/webp' && blob.size <= 256 * 1024 ? blob : null;
  } catch {
    return null;
  }
}

/** "240 KB", "1.2 MB" ("1,2 MB" in Italian). */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${formatNumber(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const kindLabel = (kind: FileKind): string => filesLibStrings().kinds[kind];

/** The short tag on a file's small screen: the extension ("PDF", "DOCX"). */
export function fileTag(name: string, kind: FileKind): string {
  const ext = extOf(name);
  if (ext) return ext.slice(0, 4).toUpperCase();
  return kind === 'html' ? 'HTML' : 'FILE';
}

/** The kind of a file the browser holds (before the core says it). */
export function guessKind(file: { name: string; type: string }): FileKind {
  const ext = extOf(file.name);
  if (file.type.startsWith('image/')) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'csv') return 'sheet';
  if (ext === 'docx' || ext === 'pptx') return 'document';
  return 'text';
}

/** A name for a pasted image ("pasted image 17.42.png"). */
export function pastedName(file: File, now = new Date()): string {
  if (file.name && file.name !== 'image.png') return file.name;
  const ext = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] ?? 'png');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${filesLibStrings().pasted} ${hh}.${mm}.${ext}`;
}

/** Who made a file, in a few words ("From you", "Screenshot by Rhea", "Page by Dione"). */
export function sourceText(
  meta: Pick<FileMeta, 'source' | 'kind' | 'agent'>,
  nameOf: (id: string) => string,
): string {
  const s = filesLibStrings();
  if (meta.source === 'user') return s.fromYou;
  const who = meta.agent ? nameOf(meta.agent) : s.aMonster;
  if (meta.source === 'tool') return meta.kind === 'image' ? s.screenshotOf(who) : s.fromWho(who);
  return meta.kind === 'html' ? s.pageOf(who) : s.fromWho(who);
}
