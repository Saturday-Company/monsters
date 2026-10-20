import { isExternalUrl, mapProse, noteKey, noteTargetOf, prepareMarkdown } from './markdown.ts';

/*
 * Markdown of the vault notes (Obsidian flavour) for the reader of the vault
 * view: embeds `![[…]]` and tags `#tag` become links of their own schemes, the
 * wikilinks become note links like in the chat. Pure functions, tested
 * without a browser.
 */

export const EMBED_SCHEME = 'vault-embed:';
export const TAG_SCHEME = 'vault-tag:';

const escapeLabel = (s: string) => s.replace(/([[\]\\])/g, '\\$1');
const escapeDest = (s: string) => s.replace(/[<>\n]/g, ' ');

/** Tag as Obsidian reads it: letters, digits, `_`, `-`, `/`, and not only digits. */
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/** Rewrites embeds, wikilinks and tags into plain Markdown links (code is left alone). */
export function prepareNoteMarkdown(text: string): string {
  const embedded = mapProse(text, (prose) =>
    prose.replace(/!\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g, (_m, rawTarget: string) => {
      const target = rawTarget.trim();
      if (isExternalUrl(target)) return `[${escapeLabel(target)}](<${escapeDest(target)}>)`;
      return `[${escapeLabel(target)}](<${EMBED_SCHEME}${escapeDest(target)}>)`;
    }),
  );
  return mapProse(prepareMarkdown(embedded), (prose) =>
    prose.replace(
      TAG,
      (_m, before: string, tag: string) =>
        `${before}[#${escapeLabel(tag)}](<${TAG_SCHEME}${escapeDest(tag.toLowerCase())}>)`,
    ),
  );
}

/** Decodes the target of a vault scheme link, or null. */
function schemeTarget(href: string, scheme: string): string | null {
  if (!href.startsWith(scheme)) return null;
  try {
    return decodeURIComponent(href.slice(scheme.length)).trim() || null;
  } catch {
    return href.slice(scheme.length).trim() || null;
  }
}

export const embedTargetOf = (href: string) => schemeTarget(href, EMBED_SCHEME);
export const tagOf = (href: string) => schemeTarget(href, TAG_SCHEME);

/**
 * URL filter of the note reader: http(s), mailto, links to notes, embeds and
 * tags; everything else (javascript:, data:, file:, //host) is dropped.
 */
export function safeNoteUrl(url: string): string {
  const u = url.trim();
  if (isExternalUrl(u)) return u;
  if (u.startsWith(EMBED_SCHEME) || u.startsWith(TAG_SCHEME)) return u;
  if (noteTargetOf(u) !== null) return u;
  return '';
}

const MEDIA = /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp3|wav|ogg|m4a|mp4|webm|mov|pdf)$/i;

/** True when an embed points to an attachment (image, audio, video, PDF), not a note. */
export function isAttachment(target: string): boolean {
  return MEDIA.test(target.split('#')[0] ?? target);
}

/** The note part of a link target: `Nota#Sezione` → `Nota`. */
export function linkNote(target: string): string {
  return (target.split('#')[0] ?? target).trim() || target;
}

/**
 * Index of the notes a link can reach: by path, by path without `.md` and by
 * name (like Obsidian's short links). Unknown targets are drawn as missing.
 */
export function linkIndex(paths: readonly string[]): (target: string) => string | null {
  const byKey = new Map<string, string>();
  for (const p of paths) {
    const lower = p.toLocaleLowerCase('it-IT');
    byKey.set(lower, p);
    byKey.set(lower.replace(/\.md$/, ''), p);
    const name = noteKey(p);
    if (!byKey.has(name)) byKey.set(name, p);
  }
  return (target) => {
    const t = linkNote(target)
      .replace(/^\.?\//, '')
      .toLocaleLowerCase('it-IT');
    return byKey.get(t) ?? byKey.get(t.replace(/\.md$/, '')) ?? byKey.get(noteKey(t)) ?? null;
  };
}

/** Top folder of a path ("" for notes at the root of the vault). */
export function topFolder(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Folder of a path ("" at the root). */
export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Every folder that holds a note, parents included, in name order. */
export function foldersOf(paths: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    const parts = folderOf(p).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'it'));
}

/** The body without a first `# Heading` equal to the title (the reader shows the title already). */
export function withoutTitle(text: string, title: string): string {
  const m = /^\s*#[ \t]+(.+?)[ \t#]*(?:\n|$)/.exec(text);
  if (!m || m[1]!.trim().toLocaleLowerCase('it-IT') !== title.trim().toLocaleLowerCase('it-IT'))
    return text;
  return text.slice(m[0].length).replace(/^\s*\n/, '');
}

/** A frontmatter value as short text for the properties card. */
export function propertyText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(propertyText).join(', ');
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
