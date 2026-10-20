import { readZipEntries } from './zip.ts';

/*
 * Text of a file for the models that cannot read the original (D-075): PDF
 * with pdf.js (`unpdf`, pure JavaScript, loaded only when a PDF arrives),
 * Office files from their XML, text files as they are. Never fatal: a file
 * whose text cannot be read simply has none.
 */

/** Most characters of extracted text kept per file. */
export const TEXT_MAX_CHARS = 200_000;
/** Most pages of a PDF read for its text. */
const PDF_MAX_PAGES = 300;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/*
 * Every parser here is linear in its input (security review of 16/10, D-085):
 * the lazy regexes of before (`<w:t>([\s\S]*?)<\/w:t>`, `[ \t]+\n`) took
 * quadratic time on a document made of open tags without their closing one,
 * and a 1.4 KB docx (800 KB of XML) held the event loop for 26 seconds. A small
 * tag scanner reads each byte once; the extraction runs in a worker anyway
 * (`extract-run.ts`), with a time limit.
 */

/** Spaces and tabs at the end of each line, and runs of empty lines, removed. */
function tidy(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    let e = l.length;
    while (e > 0 && (l.charCodeAt(e - 1) === 32 || l.charCodeAt(e - 1) === 9)) e--;
    if (e < l.length) lines[i] = l.slice(0, e);
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Tag {
  /** `w:t`, `row`… (lower case only for HTML). */
  name: string;
  /** What follows the name, up to `>` (without a final `/`). */
  attrs: string;
  closing: boolean;
  selfClosing: boolean;
}

/**
 * Walks the tags and the text between them, each character once. `onTag` may
 * return a position to resume from (to skip the body of a `<script>`).
 */
function scan(
  src: string,
  onTag: (tag: Tag, end: number) => number | void,
  onText: (text: string) => void,
  lowerNames = false,
): void {
  let pos = 0;
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt === -1) {
      onText(src.slice(pos));
      return;
    }
    if (lt > pos) onText(src.slice(pos, lt));
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4);
      if (close === -1) return;
      pos = close + 3;
      continue;
    }
    const gt = src.indexOf('>', lt + 1);
    if (gt === -1) return;
    let body = src.slice(lt + 1, gt);
    const closing = body.startsWith('/');
    if (closing) body = body.slice(1);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    let n = 0;
    while (n < body.length && !/[\s/]/.test(body[n]!)) n++;
    const raw = body.slice(0, n);
    const resume = onTag(
      {
        name: lowerNames ? raw.toLowerCase() : raw,
        attrs: body.slice(n),
        closing,
        selfClosing,
      },
      gt + 1,
    );
    pos = typeof resume === 'number' ? resume : gt + 1;
  }
}

const ATTR_RE: Record<string, RegExp> = { t: /(?:^|\s)t="/, name: /(?:^|\s)name="/ };

/** Value of an attribute in the attributes of a tag (`name="…"`). */
function attr(attrs: string, name: 't' | 'name'): string | undefined {
  const at = attrs.search(ATTR_RE[name]!);
  if (at === -1) return undefined;
  const start = attrs.indexOf('"', at) + 1;
  const end = attrs.indexOf('"', start);
  return end === -1 ? undefined : attrs.slice(start, end);
}

/** Paragraphs of a Word document. */
export function docxText(xml: string): string {
  const parts: string[] = [];
  let inText = false;
  scan(
    xml,
    (t) => {
      if (t.name === 'w:t') inText = !t.closing && !t.selfClosing;
      else if (t.closing && t.name === 'w:p') parts.push('\n');
      else if (t.selfClosing && (t.name === 'w:br' || t.name === 'w:cr')) parts.push('\n');
      // `<w:tab/>` in a run is a tab; `<w:tab w:val=… w:pos=…/>` in `<w:tabs>` is a tab stop.
      else if (t.selfClosing && t.name === 'w:tab' && !t.attrs.trim()) parts.push('\t');
    },
    (text) => {
      if (inText) parts.push(decodeXml(text));
    },
  );
  return tidy(parts.join(''));
}

/** Texts of a slide (`<a:t>`), one paragraph per line. */
export function slideText(xml: string): string {
  const parts: string[] = [];
  let inText = false;
  scan(
    xml,
    (t) => {
      if (t.name === 'a:t') inText = !t.closing && !t.selfClosing;
      else if (t.closing && t.name === 'a:p') parts.push('\n');
    },
    (text) => {
      if (inText) parts.push(decodeXml(text));
    },
  );
  return tidy(parts.join(''));
}

const byNumber = (prefix: RegExp) => (a: string, b: string) =>
  Number(prefix.exec(a)?.[1] ?? 0) - Number(prefix.exec(b)?.[1] ?? 0);

/** The shared strings of a workbook (`<si>`, without the phonetic runs `<rPh>`). */
function sharedStrings(sst: string): string[] {
  const shared: string[] = [];
  let current: string[] | null = null;
  let inText = false;
  let phonetic = 0;
  scan(
    sst,
    (t) => {
      if (t.name === 'si') {
        if (t.closing) {
          if (current) shared.push(decodeXml(current.join('')));
          current = null;
        } else if (t.selfClosing) shared.push('');
        else current = [];
      } else if (t.name === 'rPh') {
        if (!t.selfClosing) phonetic += t.closing ? -1 : 1;
      } else if (t.name === 't') inText = !t.closing && !t.selfClosing;
    },
    (text) => {
      if (inText && current && phonetic <= 0) current.push(text);
    },
  );
  return shared;
}

/** Rows of one sheet, cells separated by tabs. */
function sheetRows(xml: string, shared: readonly string[]): string[] {
  const rows: string[] = [];
  let cells: string[] | null = null;
  let type: string | undefined;
  let value: string[] | null = null;
  let inV = false;
  let inT = false;
  let inline: string[] = [];
  const endCell = () => {
    let v = '';
    if (type === 'inlineStr') v = inline.map(decodeXml).join('');
    else if (value) {
      const raw = value.join('');
      v = type === 's' ? (shared[Number(raw)] ?? '') : decodeXml(raw);
    }
    cells?.push(v.replace(/[\t\n]+/g, ' '));
  };
  scan(
    xml,
    (t) => {
      switch (t.name) {
        case 'row':
          if (t.closing || t.selfClosing) {
            if (cells) {
              while (cells.length > 0 && cells.at(-1) === '') cells.pop();
              if (cells.length > 0) rows.push(cells.join('\t'));
            }
            cells = null;
          } else cells = [];
          break;
        case 'c':
          if (t.closing) endCell();
          else {
            type = attr(t.attrs, 't');
            value = null;
            inline = [];
            if (t.selfClosing) endCell();
          }
          break;
        case 'v':
          inV = !t.closing && !t.selfClosing;
          if (inV) value = [];
          break;
        case 't':
          inT = !t.closing && !t.selfClosing;
          break;
      }
    },
    (text) => {
      if (inV) value?.push(text);
      else if (inT && type === 'inlineStr') inline.push(text);
    },
  );
  return rows;
}

/** Rows of every sheet, cells separated by tabs. */
export function xlsxText(entries: Map<string, Buffer>): string {
  const sst = entries.get('xl/sharedStrings.xml')?.toString('utf8');
  const shared = sst ? sharedStrings(sst) : [];
  const names: string[] = [];
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
  scan(
    workbook,
    (t) => {
      if (t.name === 'sheet' && !t.closing) {
        const name = attr(t.attrs, 'name');
        if (name !== undefined) names.push(decodeXml(name));
      }
    },
    () => {},
  );
  const sheetRe = /^xl\/worksheets\/sheet(\d+)\.xml$/;
  const sheets = [...entries.keys()].filter((n) => sheetRe.test(n)).sort(byNumber(sheetRe));
  const out: string[] = [];
  sheets.forEach((path, i) => {
    const rows = sheetRows(entries.get(path)!.toString('utf8'), shared);
    if (rows.length > 0) out.push(`## ${names[i] ?? `Foglio ${i + 1}`}\n${rows.join('\n')}`);
  });
  return out.join('\n\n');
}

/** Elements whose content is not text. */
const HIDDEN = new Set(['script', 'style', 'noscript', 'template']);
/** Elements that end a line. */
const BLOCK_END = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);

/** Text of an HTML page: without scripts, styles and tags. */
export function htmlText(html: string): string {
  const parts: string[] = [];
  scan(
    html,
    (t, end) => {
      if (!t.closing && !t.selfClosing && HIDDEN.has(t.name)) {
        // Skip to the closing tag (a literal search, linear).
        const re = new RegExp(`</${t.name}`, 'gi');
        re.lastIndex = end;
        const m = re.exec(html);
        if (!m) return html.length;
        const gt = html.indexOf('>', m.index);
        parts.push(' ');
        return gt === -1 ? html.length : gt + 1;
      }
      parts.push(t.name === 'br' || (t.closing && BLOCK_END.has(t.name)) ? '\n' : ' ');
    },
    (text) => parts.push(text),
    true,
  );
  return tidy(decodeXml(parts.join('').replace(/[ \t]{2,}/g, ' ')).replace(/\n /g, '\n'));
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  // pdf.js takes ownership of the buffer: give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > PDF_MAX_PAGES) {
      const pages: string[] = [];
      for (let n = 1; n <= PDF_MAX_PAGES; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      }
      return pages.join('\n\n');
    }
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((t) => t.trim()).join('\n\n');
  } finally {
    await pdf.cleanup().catch(() => {});
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

/** The text of a file of type `ext` (as `detectType` named it), clipped; null when it has none. */
export async function extractText(
  bytes: Uint8Array,
  ext: string,
): Promise<{ text: string; truncated: boolean } | null> {
  let text: string;
  try {
    switch (ext) {
      case 'txt':
      case 'md':
      case 'csv':
      case 'json':
        text = Buffer.from(bytes).toString('utf8');
        break;
      case 'html':
        text = htmlText(Buffer.from(bytes).toString('utf8'));
        break;
      case 'pdf':
        text = await pdfText(bytes);
        break;
      case 'docx': {
        const doc = readZipEntries(bytes, (n) => n === 'word/document.xml').get(
          'word/document.xml',
        );
        text = doc ? docxText(doc.toString('utf8')) : '';
        break;
      }
      case 'pptx': {
        const re = /^ppt\/slides\/slide(\d+)\.xml$/;
        const slides = readZipEntries(bytes, (n) => re.test(n));
        text = [...slides.keys()]
          .sort(byNumber(re))
          .map((n, i) => {
            const t = slideText(slides.get(n)!.toString('utf8'));
            return t ? `## Diapositiva ${i + 1}\n${t}` : '';
          })
          .filter(Boolean)
          .join('\n\n');
        break;
      }
      case 'xlsx':
        text = xlsxText(
          readZipEntries(
            bytes,
            (n) =>
              n === 'xl/sharedStrings.xml' ||
              n === 'xl/workbook.xml' ||
              /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
          ),
        );
        break;
      default:
        return null;
    }
  } catch {
    return null;
  }
  text = text.replaceAll('\u0000', '').trim();
  if (!text) return null;
  const truncated = text.length > TEXT_MAX_CHARS;
  return { text: truncated ? text.slice(0, TEXT_MAX_CHARS) : text, truncated };
}
