import { ToolError } from '@monsters/shared';
import { updateFrontmatter, type Props } from './frontmatter.ts';
import { findSection, scanMarkdown } from './scan.ts';

/*
 * Surgical edits by text range: the note is never re-serialized, only the
 * touched range changes (the frontmatter goes through the YAML Document API).
 */

export type EditOp =
  | { str_replace: { old: string; new: string } }
  | { append: { text: string; section?: string | undefined } }
  | { prepend: { text: string } }
  | { replace_section: { heading: string; text: string } }
  | { set_props: Props }
  | { remove_props: string[] };

/** Properties managed by the system that ops cannot change. */
export const PROTECTED_PROPS = ['id'] as const;

function trimNewlines(s: string): string {
  return s.replace(/^\n+/, '').replace(/\s+$/, '');
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let pos = text.indexOf(needle);
  while (pos !== -1) {
    count++;
    pos = text.indexOf(needle, pos + needle.length);
  }
  return count;
}

function ensureTrailingNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

function strReplace(text: string, old: string, replacement: string): string {
  if (old === '') throw new ToolError('INVALID_INPUT', 'str_replace.old cannot be empty');
  const count = countOccurrences(text, old);
  if (count === 0) {
    throw new ToolError('INVALID_INPUT', 'str_replace: text not found in the note', {
      hint: 'Read the note again and copy the exact text (spaces and newlines included).',
    });
  }
  if (count > 1) {
    throw new ToolError(
      'INVALID_INPUT',
      `str_replace: text found ${count} times, it must be unique`,
      {
        hint: 'Include more surrounding text so that `old` matches only once.',
      },
    );
  }
  const at = text.indexOf(old);
  return text.slice(0, at) + replacement + text.slice(at + old.length);
}

function append(text: string, raw: string, section: string | undefined): string {
  const t = trimNewlines(raw);
  if (!section) return `${ensureTrailingNewline(text)}${t}\n`;
  const scan = scanMarkdown(text);
  const found = findSection(scan, section);
  if (!found) {
    const heading = section.replace(/^#+\s*/, '').trim();
    const base = ensureTrailingNewline(text);
    const sep = base === '' || base.endsWith('\n\n') ? '' : '\n';
    return `${base}${sep}## ${heading}\n${t}\n`;
  }
  const content = text.slice(found.contentStart, found.end);
  const kept = content.replace(/\s+$/, '');
  if (kept.trim() === '') {
    const lead = found.contentStart === text.length && !text.endsWith('\n') ? '\n' : '';
    const rest = text.slice(found.end);
    return `${text.slice(0, found.contentStart)}${lead}${t}\n${rest === '' ? '' : '\n'}${rest}`;
  }
  const at = found.contentStart + kept.length;
  const after = text.slice(at);
  return `${text.slice(0, at)}\n${t}${after === '' ? '\n' : after}`;
}

function prepend(text: string, raw: string): string {
  const t = trimNewlines(raw);
  const scan = scanMarkdown(text);
  const firstContent = /\S/.exec(text.slice(scan.bodyStart));
  const firstPos = firstContent ? scan.bodyStart + firstContent.index : -1;
  const h1 = scan.headings.find((h) => h.start === firstPos && h.level === 1);
  if (h1) {
    const before = text.slice(0, h1.lineEnd);
    const nl = before.endsWith('\n') ? '' : '\n';
    return `${before}${nl}\n${t}\n${text.slice(h1.lineEnd)}`;
  }
  const rest = text.slice(scan.bodyStart);
  return `${text.slice(0, scan.bodyStart)}${t}\n${rest === '' ? '' : '\n'}${rest}`;
}

function replaceSection(text: string, heading: string, raw: string): string {
  const scan = scanMarkdown(text);
  const found = findSection(scan, heading);
  if (!found) {
    const available = scan.headings.map((h) => h.text).join(', ') || 'none';
    throw new ToolError('NOT_FOUND', `section "${heading}" not found`, {
      hint: `Available headings: ${available}. Use append with section to create it.`,
    });
  }
  const t = trimNewlines(raw);
  const lead = found.contentStart === text.length && !text.endsWith('\n') ? '\n' : '';
  const tail = found.end < text.length ? '\n' : '';
  const body = t === '' ? '' : `${t}\n${tail}`;
  return `${text.slice(0, found.contentStart)}${lead}${body}${text.slice(found.end)}`;
}

function assertNotProtected(keys: readonly string[]): void {
  const bad = keys.filter((k) => (PROTECTED_PROPS as readonly string[]).includes(k));
  if (bad.length > 0) {
    throw new ToolError('INVALID_INPUT', `property managed by the system: ${bad.join(', ')}`);
  }
}

export function applyOp(text: string, op: EditOp): string {
  if ('str_replace' in op) return strReplace(text, op.str_replace.old, op.str_replace.new);
  if ('append' in op) return append(text, op.append.text, op.append.section);
  if ('prepend' in op) return prepend(text, op.prepend.text);
  if ('replace_section' in op) {
    return replaceSection(text, op.replace_section.heading, op.replace_section.text);
  }
  if ('set_props' in op) {
    assertNotProtected(Object.keys(op.set_props));
    return updateFrontmatter(text, { set: op.set_props });
  }
  assertNotProtected(op.remove_props);
  return updateFrontmatter(text, { remove: op.remove_props });
}

/** Applies all ops in order; any failure leaves the text unchanged (the error says which op). */
export function applyOps(text: string, ops: readonly EditOp[]): string {
  let out = text;
  ops.forEach((op, i) => {
    try {
      out = applyOp(out, op);
    } catch (err) {
      if (err instanceof ToolError && ops.length > 1) {
        throw new ToolError(err.code, `op ${i + 1}: ${err.message}`, {
          hint: err.hint ?? 'No op was applied: ops are all-or-nothing.',
          details: err.details,
        });
      }
      throw err;
    }
  });
  return out;
}
