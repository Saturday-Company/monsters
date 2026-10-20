/*
 * The changelog of the product (CHANGELOG.md at the repo root) as data, for the
 * "Novità" sheet. The file is the source of truth: `## <version> · <date>`
 * headings, `### ` sections, Markdown below. Pure functions, no I/O.
 */

export interface ChangelogSection {
  title: string;
  /** Markdown of the section, without its heading. */
  markdown: string;
}

export interface ChangelogVersion {
  version: string;
  /** As written in the heading ("19 ottobre 2026"), empty if the heading has none. */
  date: string;
  /** Markdown before the first section. */
  intro: string;
  sections: ChangelogSection[];
}

/** Splits the changelog into versions, in file order (newest first). Text before the first version is ignored. */
export function parseChangelog(source: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = [];
  let current: { version: ChangelogVersion; intro: string[] } | null = null;
  let section: { title: string; lines: string[] } | null = null;
  let fence = false;

  const closeSection = () => {
    if (current && section) {
      current.version.sections.push({
        title: section.title,
        markdown: section.lines.join('\n').trim(),
      });
    }
    section = null;
  };
  const closeVersion = () => {
    closeSection();
    if (current) {
      current.version.intro = current.intro.join('\n').trim();
      versions.push(current.version);
    }
    current = null;
  };

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h2 = fence ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      closeVersion();
      const [rawVersion = '', ...rest] = h2[1]!.split(/\s+[·–—-]\s+/);
      const version = rawVersion
        .replace(/^\[|\]$/g, '')
        .replace(/^v(?=\d)/i, '')
        .trim();
      current = {
        version: { version, date: rest.join(' · ').trim(), intro: '', sections: [] },
        intro: [],
      };
      continue;
    }
    if (!current) continue;
    const h3 = fence ? null : /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      closeSection();
      section = { title: h3[1]!, lines: [] };
      continue;
    }
    if (section) section.lines.push(line);
    else current.intro.push(line);
  }
  closeVersion();
  return versions.filter((v) => v.version);
}

interface Parsed {
  core: number[];
  pre: (string | number)[];
}

function parseVersion(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Semver order: negative if a < b, 0 if equal or not comparable. A release is newer than its pre-releases. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1;
  if (!x.pre.length || !y.pre.length)
    return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The changelog is hard-wrapped at ~120 columns, but the app's Markdown renderer keeps single newlines as
 * line breaks (chat style): this joins the continuation lines of a paragraph or list item back into one.
 * Fenced code, headings, list markers, quotes and tables are left alone.
 */
export function unwrapMarkdown(md: string): string {
  const out: string[] = [];
  let fence = false;
  let prevJoinable = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      out.push(line);
      prevJoinable = false;
      continue;
    }
    const blank = line.trim() === '';
    const block = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||---)/.test(line);
    if (!fence && !blank && !block && prevJoinable && out.length > 0) {
      out[out.length - 1] += ' ' + line.trim();
    } else {
      out.push(line);
    }
    prevJoinable = !fence && !blank && !/^\s*(#{1,6}\s|\||---)/.test(line);
  }
  return out.join('\n');
}
