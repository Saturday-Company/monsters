import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseChangelog, unwrapMarkdown } from '../src/lib/changelog.ts';

const SAMPLE = `# Changelog

Intro of the file.

## 0.1.0-alpha.15 · 20 ottobre 2026

Short summary.

### Cosa si vede
- **One.** First.
- Two.

### Più affidabile
- Three.

## 0.1.0-alpha.14 · 19 ottobre 2026

### Cosa si vede
\`\`\`
## not a heading
### nor this
\`\`\`
- Four.

## 0.1.0-alpha.13
- Bare list.
`;

describe('parseChangelog', () => {
  const v = parseChangelog(SAMPLE);
  it('reads the versions in file order', () => {
    expect(v.map((x) => x.version)).toEqual(['0.1.0-alpha.15', '0.1.0-alpha.14', '0.1.0-alpha.13']);
    expect(v[0]!.date).toBe('20 ottobre 2026');
    expect(v[2]!.date).toBe('');
  });
  it('splits intro and sections', () => {
    expect(v[0]!.intro).toBe('Short summary.');
    expect(v[0]!.sections.map((s) => s.title)).toEqual(['Cosa si vede', 'Più affidabile']);
    expect(v[0]!.sections[0]!.markdown).toBe('- **One.** First.\n- Two.');
  });
  it('does not take headings inside code fences', () => {
    expect(v[1]!.sections).toHaveLength(1);
    expect(v[1]!.sections[0]!.markdown).toContain('## not a heading');
  });
  it('keeps a version without sections as intro', () => {
    expect(v[2]!.sections).toEqual([]);
    expect(v[2]!.intro).toBe('- Bare list.');
  });
  it('handles empty input and CRLF', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('## 1.0.0 · x\r\n### A\r\n- b\r\n')[0]!.sections[0]!.markdown).toBe(
      '- b',
    );
  });
  it('parses the real changelog', () => {
    const raw = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const real = parseChangelog(raw);
    expect(real.length).toBeGreaterThan(0);
    expect(real[0]!.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('compareVersions', () => {
  it('orders pre-releases numerically', () => {
    expect(compareVersions('0.1.0-alpha.15', '0.1.0-alpha.14')).toBe(1);
    expect(compareVersions('0.1.0-alpha.9', '0.1.0-alpha.10')).toBe(-1);
    expect(compareVersions('0.1.0-alpha.14', '0.1.0-alpha.14')).toBe(0);
  });
  it('puts a release after its pre-releases and beta after alpha', () => {
    expect(compareVersions('0.1.0', '0.1.0-beta.1')).toBe(1);
    expect(compareVersions('0.1.0-beta.1', '0.1.0-alpha.20')).toBe(1);
    expect(compareVersions('0.2.0-alpha.1', '0.1.9')).toBe(1);
  });
  it('is 0 for what it cannot compare', () => {
    expect(compareVersions('0.0.0-mock', 'x')).toBe(0);
  });
});

describe('unwrapMarkdown', () => {
  it('joins the continuation lines of paragraphs and list items', () => {
    const md = 'Una frase\nandata a capo.\n\n- **Uno.** Prima riga\n  seconda riga.\n- Due.';
    expect(unwrapMarkdown(md)).toBe(
      'Una frase andata a capo.\n\n- **Uno.** Prima riga seconda riga.\n- Due.',
    );
  });
  it('leaves code fences and tables alone', () => {
    const md = '```\na\nb\n```\n| x | y |\n| - | - |';
    expect(unwrapMarkdown(md)).toBe(md);
  });
});
