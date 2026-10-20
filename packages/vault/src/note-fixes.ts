import { posix } from 'node:path';
import { URL_STOP_CHARS } from '@monsters/shared';

/*
 * Small, safe corrections of what agents write (seen with free models in the
 * Phase 1 demo): web links written as wikilinks, which Obsidian shows as links
 * to notes that do not exist, file names with underscores, and sources cited
 * as bare URLs (M2.0). The tool tells the agent what it corrected, so it can
 * learn the format.
 */

/** `[[Title|https://…]]` or `[[https://…]]` → `[Title](https://…)`; other wikilinks untouched. */
export function fixUrlWikilinks(text: string): { text: string; fixed: number } {
  let fixed = 0;
  const out = text.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (match, bang: string, inner: string) => {
    const parts = inner.split('|').map((p) => p.trim());
    const url = parts.find((p) => /^https?:\/\/\S+$/i.test(p));
    if (!url) return match;
    const label = parts.find((p) => p !== url && p !== '') ?? url;
    fixed++;
    return `${bang}[${label.replace(/[[\]]/g, '')}](${url})`;
  });
  return { text: out, fixed };
}

/** Title of a web page by URL, when the caller knows it (e.g. from the agent's search results). */
export type LinkTitle = (url: string) => string | undefined;

/** List marker, then an optional reference: `- `, `1. `, `[1] `, `(1) `, `[^1]: `. */
const SOURCE_PREFIX =
  /^(\s*(?:>\s*)*(?:[-*+]\s+|\d{1,3}[.)]\s+)?(?:\[\^?\d{1,3}\]:?\s+|\(\d{1,3}\)\s+)?)/;
/** `[ref]: https://…` is a Markdown link reference definition: never touched. */
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]^][^\]]*\]:\s/;
const FENCE = /^\s*(```|~~~)/;
const URL_AT_END = /^(.*?)<?(https?:\/\/[^\s<>]+?)>?([.,;]?)(\s*)$/i;

/** Brackets and parentheses as typed: the URL keeps a `)` only when it opened one. */
function trimUrl(raw: string): string {
  // Brackets and quotes of other scripts end it too (【https://…】, D-073).
  let url = raw.replace(new RegExp(`[${URL_STOP_CHARS}].*$`, 'u'), '').replace(/[.,;:!?]+$/, '');
  while (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) {
    url = url.slice(0, -1).replace(/[.,;:!?]+$/, '');
  }
  return url;
}

function cleanTitle(title: string): string {
  const t = title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 100 ? `${t.slice(0, 99).trimEnd()}…` : t;
}

/**
 * Text of a link to `url`: the page title when known, otherwise the last part
 * of the path when it reads like words (`wiki/Ribollita` → `Ribollita`), with
 * the site; otherwise the site alone.
 */
export function linkText(url: string, titleOf?: LinkTitle): string {
  const known = titleOf?.(url);
  if (known && cleanTitle(known) !== '') return cleanTitle(known);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const segment = parsed.pathname.split('/').filter(Boolean).at(-1) ?? '';
  let words = segment;
  try {
    words = decodeURIComponent(segment);
  } catch {
    // keep the encoded segment
  }
  words = words
    .replace(/\.(html?|php|aspx?|jsp)$/i, '')
    .replace(/[_+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const readable =
    /\p{L}{3,}/u.test(words) && words.length <= 80 && !/\d{5,}|[0-9a-f]{12,}/i.test(words);
  if (!readable) return host;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} (${host})`;
}

/** `[text](url)`; angle brackets around a URL whose parentheses do not balance. */
function markdownLink(text: string, url: string): string {
  const balanced = (url.match(/\(/g) ?? []).length === (url.match(/\)/g) ?? []).length;
  return `[${text}](${balanced ? url : `<${url}>`})`;
}

/** Text before a URL that is only a label, never prose with links or code. */
const NOT_A_LABEL = /https?:\/\/|\]\(|\[\[|`|<a\s/i;

/** A line that is just a source: list marker or reference, a short label ending with ":" or a dash, a bare URL. */
function sourceLine(line: string, titleOf?: LinkTitle): string | undefined {
  const prefix = SOURCE_PREFIX.exec(line)?.[1] ?? '';
  const m = URL_AT_END.exec(line.slice(prefix.length));
  if (!m) return undefined;
  const label = m[1] ?? '';
  // Before the URL only a short label that ends with ":" or a dash: "Wikipedia: ", "Ribollita – ".
  if (label !== '' && !/^[^\n]{1,120}?(:[*_]{0,2}|\s[-–—|])\s*$/.test(label)) return undefined;
  if (NOT_A_LABEL.test(label)) return undefined;
  const url = trimUrl(m[2]!);
  if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(url)) return undefined;
  // Trailing spaces stay: two of them are a Markdown line break.
  const tail = m[2]!.slice(url.length) + (m[3] ?? '') + (m[4] ?? '');
  const sep = label === '' || /\s$/.test(label) ? '' : ' ';
  return `${prefix}${label}${sep}${markdownLink(linkText(url, titleOf), url)}${tail}`;
}

/** The last "Fonte:" / "Source:" of a line, and what follows it. */
const CITED = /^(.*\b(?:fonte|fonti|source|sources)\s*:[*_]{0,2}\s*)(.*)$/i;
/** A URL in running text: parentheses only when balanced (`wiki/Peposo_(cucina)`). */
const URL_IN_TEXT = 'https?:\\/\\/(?:[^\\s<>()]|\\([^\\s<>()]*\\))+';
/** `Wikipedia – Ribollita (https://…)` after the marker or a ";". */
const LABELLED = new RegExp(`(^|;\\s*)([^;()[\\]\\n]{1,120}?)\\s*\\(<?(${URL_IN_TEXT})>?\\)`, 'gi');
/** A bare URL right after the marker, a ";" or a ",". */
const BARE_AFTER = new RegExp(`(^|[;,]\\s*)<?(${URL_IN_TEXT})>?`, 'gi');
const HAS_HOST = /^https?:\/\/[^/\s]+\.[^/\s]+/i;

/**
 * The sources cited after "Fonte:" in a line: "… Fonte: Wikipedia – Ribollita
 * (https://…) – consultato …; Gazzetta (https://…)" → "… Fonte: [Wikipedia –
 * Ribollita](https://…) – consultato …; [Gazzetta](https://…)"; a bare URL there
 * gets the page title. The prose before the marker is never touched.
 */
function citedSources(line: string, titleOf?: LinkTitle): { line: string; fixed: number } {
  const cited = CITED.exec(line);
  if (!cited) return { line, fixed: 0 };
  const head = cited[1]!;
  let fixed = 0;
  const rest = cited[2]!
    .replace(LABELLED, (all: string, sep: string, label: string, url: string) => {
      const text = label.replace(/[\s,:–—-]+$/, '').trim();
      if (text === '' || NOT_A_LABEL.test(text) || !HAS_HOST.test(url)) return all;
      fixed++;
      return `${sep}${markdownLink(text, url)}`;
    })
    .replace(BARE_AFTER, (all: string, sep: string, raw: string) => {
      const url = trimUrl(raw);
      if (!HAS_HOST.test(url)) return all;
      fixed++;
      return `${sep}${markdownLink(linkText(url, titleOf), url)}${raw.slice(url.length)}`;
    });
  return { line: fixed > 0 ? head + rest : line, fixed };
}

/**
 * Sources cited as bare URLs → `[title](url)`: lines that are just a source
 * (`[1] https://…`, `- Wikipedia: https://…`, a URL alone) and the sources after
 * "Fonte:" in a line, bare or in parentheses. A URL elsewhere in prose, in code,
 * in the frontmatter or already in a link is left alone.
 */
export function linkBareSources(
  text: string,
  titleOf?: LinkTitle,
): { text: string; fixed: number } {
  let fixed = 0;
  let inFence = false;
  const lines = text.split('\n');
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || REFERENCE_DEFINITION.test(line)) continue;
    const single = sourceLine(line, titleOf);
    if (single !== undefined) {
      lines[i] = single;
      fixed++;
      continue;
    }
    const cited = citedSources(line, titleOf);
    lines[i] = cited.line;
    fixed += cited.fixed;
  }
  return { text: lines.join('\n'), fixed };
}

/** `Risorse/Ricerche/Autumn_Tuscan_Menu.md` → `Risorse/Ricerche/Autumn Tuscan Menu.md` (file name only). */
export function naturalNotePath(path: string): string {
  const dir = posix.dirname(path);
  const base = posix.basename(path);
  if (!base.includes('_')) return path;
  const name = base
    .replace(/_+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+(\.md)$/i, '$1')
    .trim();
  if (name === '' || /^\.md$/i.test(name)) return path;
  return dir === '.' ? name : `${dir}/${name}`;
}

const isMarkdownPath = (path: string) => /\.md$/i.test(path) || !/\.[a-z0-9]{1,8}$/i.test(path);

const linksMessage = (n: number) =>
  `${n} wikilink${n === 1 ? '' : 's'} to web pages rewritten as [text](url): [[…]] is only for notes of the vault`;

const bareMessage = (n: number) =>
  `${n} bare link${n === 1 ? '' : 's'} in the sources rewritten as [title](url): cite web pages as Markdown links`;

export interface NoteFixOptions {
  /** Titles of the pages the agent saw (search results, pages read), for bare source links. */
  titleOf?: LinkTitle | undefined;
}

/** Corrections applied to a `vault_write` of an agent; `corrected` says what changed. */
export function fixAgentWrite<
  T extends { path: string; content: string; mode?: string | undefined },
>(input: T, options: NoteFixOptions = {}): { input: T; corrected: string[] } {
  const corrected: string[] = [];
  let { path, content } = input;
  if (isMarkdownPath(path)) {
    const links = fixUrlWikilinks(content);
    if (links.fixed > 0) {
      content = links.text;
      corrected.push(linksMessage(links.fixed));
    }
    const bare = linkBareSources(content, options.titleOf);
    if (bare.fixed > 0) {
      content = bare.text;
      corrected.push(bareMessage(bare.fixed));
    }
    // Only new notes: renaming an existing one is vault_move's job.
    if (input.mode !== 'overwrite') {
      const natural = naturalNotePath(path);
      if (natural !== path) {
        corrected.push(`file name "${path}" saved as "${natural}": readable names with spaces`);
        path = natural;
      }
    }
  }
  return { input: { ...input, path, content }, corrected };
}

type TextOp =
  | { str_replace: { old: string; new: string } }
  | { append: { text: string; section?: string | undefined } }
  | { prepend: { text: string } }
  | { replace_section: { heading: string; text: string } };

/** The same link corrections for the text of `vault_edit` ops. */
export function fixAgentEditOps<O>(
  ops: O[],
  options: NoteFixOptions = {},
): { ops: O[]; corrected: string[] } {
  let total = 0;
  let bare = 0;
  const fix = (text: string) => {
    const r = fixUrlWikilinks(text);
    total += r.fixed;
    const b = linkBareSources(r.text, options.titleOf);
    bare += b.fixed;
    return b.text;
  };
  const out = ops.map((raw) => {
    const op = raw as TextOp;
    if ('str_replace' in op)
      return { str_replace: { ...op.str_replace, new: fix(op.str_replace.new) } };
    if ('append' in op) return { append: { ...op.append, text: fix(op.append.text) } };
    if ('prepend' in op) return { prepend: { text: fix(op.prepend.text) } };
    if ('replace_section' in op)
      return { replace_section: { ...op.replace_section, text: fix(op.replace_section.text) } };
    return raw;
  }) as O[];
  const corrected = [
    ...(total > 0 ? [linksMessage(total)] : []),
    ...(bare > 0 ? [bareMessage(bare)] : []),
  ];
  return { ops: out, corrected };
}
