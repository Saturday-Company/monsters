/*
 * Guard of the app's languages (D-153): every visible text lives in a dictionary (`*.strings.ts`,
 * or a file under an `i18n/` folder), never written by hand in the code.
 *
 *   node scripts/check-i18n.ts            (part of `pnpm lint`)
 *   node scripts/check-i18n.ts --update   (rewrites the baseline, see below)
 *   node scripts/check-i18n.ts --list     (every finding, also the ones the baseline allows)
 *
 * Rules, on the product's sources (apps/web/src, apps/desktop/src, packages/<name>/src; not the
 * tests, not the mock of the web UI):
 * - `jsx-text`: text between JSX tags with a letter in it;
 * - `jsx-attr`: a visible attribute (aria-label, title, placeholder, alt, label, description,
 *   hint, footer…) set to a string with a letter in it;
 * - `italian`: any other string or template that reads as Italian (an accented letter, or two
 *   Italian function words).
 * Product and brand names alone are allowed (ALLOWED). A line, or the line after a comment,
 * marked `i18n-ignore` is skipped: for text that is data, not copy (a regex's words, an id).
 *
 * The baseline (`scripts/check-i18n.baseline.json`) holds the findings of each file while the
 * texts move into the dictionaries: a file may have at most that many, a file not listed none.
 * `--update` writes the counts as they are now; a count that went down is printed as a reminder
 * to update. At the end of the move the baseline is empty.
 *
 * Exit code: 0 clean, 1 findings over the baseline.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export interface Finding {
  file: string;
  line: number;
  rule: 'jsx-text' | 'jsx-attr' | 'italian';
  text: string;
}

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE = resolve(ROOT, 'scripts/check-i18n.baseline.json');

const SOURCE = /^(?:apps\/(?:web|desktop)\/src|packages\/[^/]+\/src)\/.+\.tsx?$/;
const SKIP = [
  /\.strings\.ts$/,
  /\/i18n\//,
  /\.d\.ts$/,
  /^apps\/web\/src\/lib\/mock\//,
  /^apps\/web\/src\/onboarding\/mock\.ts$/,
  /^packages\/[^/]+\/src\/testing\//,
];

const VISIBLE_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
  'description',
  'hint',
  'footer',
  'heading',
  'caption',
  'emptyText',
  'confirmLabel',
  'cancelLabel',
]);

/** Names that are the same in every language. */
const ALLOWED = new Set([
  'Monsters',
  'Titan',
  'Telegram',
  'OpenRouter',
  'Obsidian',
  'GitHub',
  'Claude',
  'ChatGPT',
  'Codex',
  'OpenAI',
  'Anthropic',
  'Jev',
  'MCP',
  'SSH',
  'URL',
  'API',
  'OK',
  'Markdown',
  'JSON',
  'YAML',
  'HTML',
  'PDF',
  'CSV',
  'Brave',
  'Tavily',
  'SearXNG',
  'Ollama',
  'LM Studio',
  'TypeSafe',
  'NEWS',
]);

// Italian words that English text does not use (articles, prepositions, common verbs).
const IT_WORDS = new Set(
  (
    'il lo gli della delle dello degli dei del nel nella nelle negli sul sulla sui alla alle ' +
    'allo agli dal dalla dai dalle una uno che non per sono questo questa questi queste quello ' +
    'quella anche ancora adesso poi qui già più ogni nessun nessuna niente tutto tutti tutte ' +
    'come dove quando perché cosa chi mostro mostri squadra impostazioni errore riprova scrivi ' +
    'apri chiudi salva annulla aggiungi togli cerca nuovo nuova nuovi vuoi puoi devi serve ' +
    'manca sei hai fatto ecco oppure ma se tuo tua tuoi tue suo sua loro mio mia ci ti mi si'
  ).split(' '),
);
const ACCENTED = /[àèéìòùÀÈÉÌÒÙ]/;

function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

function allowed(s: string): boolean {
  const t = s.trim();
  return ALLOWED.has(t) || !hasLetter(t);
}

export function readsItalian(s: string): boolean {
  if (ACCENTED.test(s)) return true;
  const words = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  let hits = 0;
  const seen = new Set<string>();
  for (const w of words) {
    if (IT_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

export function checkSource(file: string, text: string): Finding[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split('\n');
  const ignored = (line: number) =>
    /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '');
  if (/i18n-ignore-file/.test(text.slice(0, 2000))) return [];
  const out: Finding[] = [];
  const add = (node: ts.Node, rule: Finding['rule'], value: string) => {
    // JSX text starts with the whitespace after the tag: its line is the one of its first letter.
    const lead = ts.isJsxText(node) ? node.text.length - node.text.trimStart().length : 0;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf) + lead).line;
    if (ignored(line)) return;
    out.push({ file, line: line + 1, rule, text: value.trim().replace(/\s+/g, ' ').slice(0, 80) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (!allowed(node.text)) add(node, 'jsx-text', node.text);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (VISIBLE_ATTRS.has(name) && init) {
        const value = ts.isStringLiteral(init)
          ? init.text
          : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)
            ? init.expression.text
            : null;
        if (value !== null) {
          if (!allowed(value)) add(node, 'jsx-attr', `${name}="${value}"`);
          return;
        }
      }
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (readsItalian(node.text)) add(node, 'italian', node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
      if (readsItalian(parts)) add(node, 'italian', parts);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed
    .split('\n')
    .filter(
      (f) => SOURCE.test(f) && !SKIP.some((re) => re.test(f)) && existsSync(resolve(ROOT, f)),
    );
}

function main(): number {
  const args = new Set(process.argv.slice(2));
  const findings = sourceFiles().flatMap((f) =>
    checkSource(f, readFileSync(resolve(ROOT, f), 'utf8')),
  );
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  if (args.has('--update')) {
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
    console.warn(
      `check-i18n: baseline written, ${findings.length} findings in ${Object.keys(sorted).length} files`,
    );
    return 0;
  }
  const baseline: Record<string, number> = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>)
    : {};
  if (args.has('--list')) {
    for (const f of findings) console.warn(`${f.file}:${f.line} ${f.rule}: ${f.text}`);
  }
  const over = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
  const shrunk = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n);
  for (const [file] of over) {
    for (const f of findings.filter((x) => x.file === file)) {
      console.error(`${f.file}:${f.line} ${f.rule}: ${f.text}`);
    }
    console.error(
      `check-i18n: ${file} has ${counts[file]} hand-written texts, the baseline allows ${baseline[file] ?? 0}: move them into a *.strings.ts dictionary (D-153)`,
    );
  }
  if (shrunk.length > 0 && over.length === 0) {
    console.warn(
      `check-i18n: ${shrunk.length} file(s) have fewer hand-written texts than the baseline: run \`node scripts/check-i18n.ts --update\``,
    );
  }
  return over.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exitCode = main();
