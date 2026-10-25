/*
 * Markdown helpers for messages written by the models. Pure functions, so the
 * rules (which links are allowed, how wikilinks become note chips) are tested
 * without a browser.
 */
import { isAppLinkPath } from './route-names.ts';

/** Scheme used internally for links to vault notes (`[[Nota]]`, `[x](Risorse/x.md)`). */
export const NOTE_SCHEME = 'nota:';

const EXTERNAL = /^(https?:\/\/|mailto:)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Splits text into code (fenced blocks, inline spans) and prose, so rewrites skip code. */
export function mapProse(text: string, fn: (prose: string) => string): string {
  // Fenced blocks (``` or ~~~) line by line, then inline code spans in the prose.
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length) out.push(mapInline(prose.join('\n'), fn));
    prose = [];
  };
  for (const line of text.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) {
      flush();
      fence = marker;
      out.push(line);
    } else if (fence !== null) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else prose.push(line);
  }
  flush();
  return out.join('\n');
}

function mapInline(text: string, fn: (prose: string) => string): string {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(/(`+)[^`\n][\s\S]*?\1/g)) {
    out.push(fn(text.slice(last, m.index)), m[0]);
    last = m.index + m[0].length;
  }
  out.push(fn(text.slice(last)));
  return out.join('');
}

const escapeLabel = (s: string) => s.replace(/([[\]\\])/g, '\\$1');
const escapeDest = (s: string) => s.replace(/[<>\n]/g, ' ');

/**
 * Rewrites Obsidian wikilinks into plain Markdown links before parsing:
 * `[[Nota]]` and `[[Nota|testo]]` become links to the note, while the common
 * model mistake `[[Titolo|https://…]]` becomes an ordinary external link.
 */
export function prepareMarkdown(text: string): string {
  return mapProse(text, (prose) =>
    prose.replace(
      /!?\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g,
      (_m, rawTarget: string, rawAlias?: string) => {
        const target = rawTarget.trim();
        const alias = rawAlias?.trim();
        if (alias && EXTERNAL.test(alias))
          return `[${escapeLabel(target)}](<${escapeDest(alias)}>)`;
        if (EXTERNAL.test(target))
          return `[${escapeLabel(alias || target)}](<${escapeDest(target)}>)`;
        const label = alias || noteName(target);
        return `[${escapeLabel(label)}](<${NOTE_SCHEME}${escapeDest(target)}>)`;
      },
    ),
  );
}

/** The note a link points to, or null: wikilinks and relative paths (`Risorse/x.md`). */
export function noteTargetOf(href: string): string | null {
  // The parser percent-encodes destinations ("Post 1" → "Post%201").
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  if (href.startsWith(NOTE_SCHEME)) return decode(href.slice(NOTE_SCHEME.length)).trim() || null;
  if (!href || ANY_SCHEME.test(href) || href.startsWith('//') || href.startsWith('#')) return null;
  return (
    decode(href)
      .replace(/^\.?\//, '')
      .trim() || null
  );
}

/** True for links that may leave the app: only http(s) and mailto. */
/** A link to a page of the app (`#/settings?section=models`, `#/notes?note=…`, or the old Italian forms): opened in place. */
export function isAppLink(href: string): boolean {
  return isAppLinkPath(href.trim());
}

export function isExternalUrl(href: string): boolean {
  return EXTERNAL.test(href.trim());
}

/**
 * URL filter for react-markdown: keeps http(s), mailto and note links, drops
 * everything else (javascript:, data:, file:, protocol-relative URLs…).
 */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (isExternalUrl(u) || isAppLink(u)) return u;
  if (noteTargetOf(u) !== null) return u;
  return '';
}

/** Display name of a note: last path segment, no `.md`, no `#heading`. */
export function noteName(target: string): string {
  const noHeading = target.split('#')[0] || target;
  const last = noHeading.split('/').pop() || noHeading;
  return last.replace(/\.md$/i, '').trim() || target;
}

/** Normalised key to compare a note link with a vault path. */
export function noteKey(target: string): string {
  return noteName(target).toLowerCase();
}

/**
 * One line of plain text from Markdown, for chips, log rows and balloons:
 * no markers, links reduced to their text, whitespace collapsed.
 */
export function plainText(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g, (_m, t: string, a?: string) =>
      a && !EXTERNAL.test(a.trim()) ? a : noteName(t),
    )
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/gm, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^ · | · $/g, '')
    .trim();
}

/** Cuts a plain line at about `n` characters, on a word boundary when possible. */
export function clipText(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
