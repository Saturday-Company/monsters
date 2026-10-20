import { ToolError } from '@monsters/shared';
import { Document, isMap, parseDocument } from 'yaml';
import { findFrontmatter } from './scan.ts';

/*
 * Frontmatter round-trip with the `yaml` Document API: order, comments and the
 * style of the keys written by the user are preserved. Only the frontmatter
 * block is rewritten; the body is never touched.
 */

export type Props = Record<string, unknown>;

export interface FrontmatterInfo {
  data: Props;
  /** Present when the YAML is invalid: the note is indexed without properties. */
  error?: string;
}

const STRINGIFY = { lineWidth: 0, minContentWidth: 0 } as const;

/**
 * Upper bound on alias expansions while converting YAML to values: a few
 * nested aliases ("billion laughs") would otherwise expand to billions of
 * nodes. Frontmatter written by people never comes close.
 */
export const MAX_ALIAS_COUNT = 50;

/** Converts a parsed document to plain values; throws on alias bombs and similar. */
function toValues(doc: Document): unknown {
  return doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
}

/**
 * Reads the frontmatter of a note. Never throws: invalid YAML (syntax errors,
 * alias bombs, non-map content) gives `{ data: {}, error }`, so the note is
 * still indexed as text and the problem can be reported.
 */
export function readFrontmatter(text: string): FrontmatterInfo {
  const block = findFrontmatter(text);
  if (!block) return { data: {} };
  try {
    const doc = parseDocument(block.yaml);
    if (doc.errors.length > 0) return { data: {}, error: doc.errors[0]?.message ?? 'invalid YAML' };
    if (doc.contents === null) return { data: {} };
    if (!isMap(doc.contents)) return { data: {}, error: 'frontmatter is not a map' };
    const data = toValues(doc);
    return { data: (data ?? {}) as Props };
  } catch (err) {
    return { data: {}, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PropsChange {
  set?: Props;
  remove?: readonly string[];
  /** Keys set only when missing (system metadata such as `id`). */
  setIfMissing?: Props;
}

/** Returns `text` with the frontmatter changed; creates the block when missing. */
export function updateFrontmatter(text: string, change: PropsChange): string {
  const block = findFrontmatter(text);
  const doc: Document = block ? parseDocument(block.yaml) : new Document({});
  if (doc.errors.length > 0) {
    throw new ToolError(
      'INVALID_INPUT',
      `the frontmatter is not valid YAML: ${doc.errors[0]?.message}`,
      {
        hint: 'Fix the YAML with str_replace first, or edit the body only.',
      },
    );
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new ToolError('INVALID_INPUT', 'the frontmatter is not a key/value map');
  }
  try {
    toValues(doc);
  } catch (err) {
    throw new ToolError(
      'INVALID_INPUT',
      `the frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      { hint: 'Remove the YAML aliases (&name / *name) from the frontmatter.' },
    );
  }
  for (const [key, value] of Object.entries(change.setIfMissing ?? {})) {
    if (!doc.has(key)) doc.set(key, value);
  }
  for (const [key, value] of Object.entries(change.set ?? {})) {
    if (value === undefined) continue;
    const existing = doc.get(key, true);
    // Keep the node (and its comments/style) when the scalar value does not change.
    if (existing !== undefined && JSON.stringify(doc.get(key)) === JSON.stringify(value)) continue;
    doc.set(key, value);
  }
  for (const key of change.remove ?? []) doc.delete(key);

  const empty = doc.contents === null || (isMap(doc.contents) && doc.contents.items.length === 0);
  const yaml = empty ? '' : doc.toString(STRINGIFY);
  if (!block) {
    if (empty) return text;
    return `---\n${yaml}---\n${text}`;
  }
  const newline = /\r\n/.test(text.slice(0, block.range.end)) ? '\r\n' : '\n';
  const yamlText = newline === '\n' ? yaml : yaml.replace(/\n/g, newline);
  const closing = text.slice(block.yamlStart + block.yaml.length, block.range.end);
  return `---${newline}${yamlText}${closing}${text.slice(block.range.end)}`;
}

/** Builds a new frontmatter block (for new notes). */
export function buildFrontmatter(props: Props): string {
  const entries = Object.entries(props).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return `---\n${new Document(Object.fromEntries(entries)).toString(STRINGIFY)}---\n`;
}

/** Reads a string or list property as a list of strings (`tags`, `aliases`). */
export function listProp(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v).trim())
      .filter(Boolean);
  }
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
