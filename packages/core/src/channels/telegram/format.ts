/*
 * Agent text (Markdown) → Telegram messages. Telegram's Markdown modes break on
 * any stray `_` or `*`, so the bot sends HTML (`parse_mode: 'HTML'`): every
 * character is escaped and only a few safe constructs become tags (code,
 * bold, links, headings). Long texts are split on line boundaries below the
 * 4096-character limit, closing and reopening a code block that crosses a cut.
 */

import { uiBlocksToText } from '@monsters/shared';

/**
 * A reply as Telegram can show it: a drawn block (```ui, D-162) written as text (a table comes
 * out as a code block, so it shows as `<pre>`), the rest of the Markdown as it is. Done before
 * the text is split, so a block is never cut in two.
 */
export const forTelegram = (markdown: string): string => uiBlocksToText(markdown);

/** Telegram allows 4096 characters per message; markup and escapes make room for a margin. */
export const TELEGRAM_CHUNK = 3800;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/** Only web pages and mail: no `http` (clear text) and no `tg://` (proxy settings, deep links). */
const SAFE_LINK = /^(?:https:\/\/|mailto:)/i;

/** Inline Markdown of one line (outside code blocks) → HTML. */
function inline(line: string): string {
  const slots: string[] = [];
  const keep = (html: string) => `\uE000${slots.push(html) - 1}\uE001`;
  let s = line
    // Inline code first: nothing inside it is formatting.
    .replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`))
    // Links with a safe scheme; anything else stays as text.
    .replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (m, text: string, url: string) =>
      SAFE_LINK.test(url) ? keep(`<a href="${escapeAttr(url)}">${escapeHtml(text)}</a>`) : m,
    );
  s = escapeHtml(s);
  s = s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<![\w_])__([^_\n]+?)__(?![\w_])/g, '<b>$1</b>')
    .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  // The markers are stripped from agent text first: a slot is always ours.
  return s.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => slots[Number(i)] ?? '');
}

/** Markdown → Telegram HTML. */
export function toTelegramHtml(markdown: string): string {
  const out: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;
  for (const raw of forTelegram(markdown)
    .replace(/[\uE000\uE001]/g, '')
    .split('\n')) {
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(raw);
    if (fence) {
      if (code) {
        const cls = code.lang ? ` class="language-${escapeAttr(code.lang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(code.lines.join('\n'))}</code></pre>`);
        code = null;
      } else {
        code = { lang: fence[1] ?? '', lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(raw);
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (heading) {
      out.push(`<b>${inline(heading[1]!)}</b>`);
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(raw);
    if (bullet) {
      out.push(`${bullet[1]}• ${inline(bullet[2]!)}`);
      continue;
    }
    out.push(inline(raw));
  }
  if (code) out.push(`<pre>${escapeHtml(code.lines.join('\n'))}</pre>`);
  return out.join('\n');
}

/**
 * Splits Markdown into pieces of at most `max` characters, on line (then word)
 * boundaries. A code block cut in two is closed at the end of a piece and
 * reopened at the start of the next.
 */
export function splitMarkdown(markdown: string, max = TELEGRAM_CHUNK): string[] {
  const text = markdown.trim();
  if (text.length <= max) return text ? [text] : [];
  const pieces: string[] = [];
  let current: string[] = [];
  let size = 0;
  let fence: string | null = null;
  const flush = () => {
    if (current.length === 0) return;
    let piece = current.join('\n');
    if (fence !== null) piece += '\n```';
    pieces.push(piece);
    current = fence !== null ? [`\`\`\`${fence}`] : [];
    size = current.length ? current[0]!.length + 1 : 0;
  };
  const room = max - 8; // space for a closing fence
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > room) {
      // A single line too long: cut on the last space, or hard.
      if (size > 0) flush();
      const cut = rest.lastIndexOf(' ', room);
      const at = cut > room / 2 ? cut : room;
      current.push(rest.slice(0, at));
      size += at + 1;
      flush();
      rest = rest.slice(at).replace(/^ /, '');
    }
    if (size + rest.length + 1 > room) flush();
    current.push(rest);
    size += rest.length + 1;
    const f = /^\s*```\s*([\w+-]*)\s*$/.exec(rest);
    if (f) fence = fence === null ? (f[1] ?? '') : null;
  }
  if (current.length > 0) {
    const piece = current.join('\n');
    // Drop a reopened fence with nothing after it.
    if (piece.trim() !== '```' + (fence ?? '')) pieces.push(piece);
  }
  return pieces.filter((p) => p.trim() !== '');
}

/**
 * Splits text that is already Telegram HTML (every line closes its own tags,
 * like `/stato`) into pieces of at most `max` characters, on line boundaries.
 * The raw length counts: it is never less than the visible one.
 */
export function splitHtml(html: string, max = TELEGRAM_CHUNK): string[] {
  const text = html.trim();
  if (text.length <= max) return text ? [text] : [];
  const pieces: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.length > 0) pieces.push(current.join('\n'));
    current = [];
    size = 0;
  };
  for (const line of text.split('\n')) {
    // A single line over the limit (not expected from our own texts): cut hard.
    for (let rest = line; ;) {
      const part = rest.slice(0, max);
      if (size + part.length + 1 > max) flush();
      current.push(part);
      size += part.length + 1;
      rest = rest.slice(max);
      if (rest === '') break;
    }
  }
  flush();
  return pieces.filter((p) => p.trim() !== '');
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Cuts a text to `max` UTF-16 units (what Telegram counts) with an ellipsis,
 * never inside a character: an emoji (surrogate pair, ZWJ sequence) is kept
 * whole or dropped.
 */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let out = '';
  for (const { segment } of graphemes.segment(t)) {
    if (out.length + segment.length > max - 1) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}

/**
 * A name or title written by someone else (a Telegram profile, a group), made
 * safe to put in a message to the user or in a prompt: no control or invisible
 * characters, no brackets or Markdown marks (so no link can be built out of
 * it), one line, cut short.
 */
export function plainName(text: string, max = 80): string {
  const flat = text
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[[\]()<>*_`~|\\«»]/g, '')
    .replace(/\s+/g, ' ');
  return clip(flat, max);
}
