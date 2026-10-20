import { describe, expect, it } from 'vitest';
import {
  DraftViewSchema,
  LogEventSchema,
  NO_FINAL_NEWLINE,
  showInvisible,
  textDiff,
} from '../src/index.ts';

/* D-113: the drafts of CLAUDE.md and AGENTS.md, their event and the diff shown to the user. */

describe('textDiff', () => {
  it('nothing changed: empty', () => {
    expect(textDiff('a\nb\n', 'a\nb\n')).toBe('');
  });

  it('a new file: every line added', () => {
    expect(textDiff(null, '# Titolo\nriga\n')).toBe('@@ riga 1 @@\n+# Titolo\n+riga');
  });

  it('changes far apart are two hunks, the equal lines between them left out', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `riga ${i + 1}`);
    const after = [...lines];
    after[1] = 'riga due';
    after.splice(17, 0, 'nuova');
    const diff = textDiff(lines.join('\n'), after.join('\n'), { context: 1 });
    expect(diff.split('\n')).toEqual([
      '@@ riga 1 @@',
      ' riga 1',
      '-riga 2',
      '+riga due',
      ' riga 3',
      '@@ riga 17 @@',
      ' riga 17',
      '+nuova',
      ' riga 18',
    ]);
  });

  it('a line moved keeps the rest equal (LCS, not one block)', () => {
    const diff = textDiff('a\nb\nc\nd\n', 'b\nc\nd\na\n', { context: 0 });
    expect(diff.split('\n')).toEqual(['@@ riga 1 @@', '-a', '@@ riga 4 @@', '+a']);
  });
});

describe('textDiff never hides a change (D-113)', () => {
  it('characters that do not show are written out, a carriage return is ␍', () => {
    expect(showInvisible('a\u200Bb\u202E\u{E0041}\tc\r')).toBe('a⟨U+200B⟩b⟨U+202E⟩⟨U+E0041⟩\tc␍');
    expect(textDiff('ab\n', 'a\u200Bb\n')).toContain('+a⟨U+200B⟩b');
    expect(textDiff('a\r\nb\r\n', 'a\nb\n')).toContain('-a␍');
  });

  it('only the newline at the end: the last line says it', () => {
    const diff = textDiff('a\nb\n', 'a\nb');
    expect(diff).not.toBe('');
    expect(diff).toContain(`+b${NO_FINAL_NEWLINE}`);
  });
});

describe('the docs draft and its event', () => {
  it('round-trips through the schemas', () => {
    const view = {
      kind: 'docs' as const,
      id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      title: 'CLAUDE.md di Saturday',
      summary: 'Leda propone di cambiare CLAUDE.md di «Saturday»: una riga.',
      from: 'leda',
      fromName: 'Leda',
      project: 'saturday',
      createdAt: 1,
      docs: {
        file: 'CLAUDE.md' as const,
        current: '# Saturday\n',
        proposed: '# Saturday\nuna riga\n',
        diff: '@@ riga 1 @@\n # Saturday\n+una riga',
        reason: 'una riga',
        stale: false,
        tainted: true as const,
        source: 'web_fetch',
      },
    };
    expect(DraftViewSchema.parse(view)).toEqual(view);
    expect(
      DraftViewSchema.safeParse({ ...view, docs: { ...view.docs, file: 'README.md' } }).success,
    ).toBe(false);
    const event = {
      id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      ts: 1,
      agent: 'leda',
      runId: null,
      parentId: null,
      type: 'project_docs_proposal' as const,
      data: {
        action: 'proposed' as const,
        project: 'saturday',
        name: 'Saturday',
        file: 'AGENTS.md' as const,
        from: 'leda',
        content: '# Regole\n',
        baseHash: null,
        reason: 'nuovo',
      },
    };
    expect(LogEventSchema.parse(event)).toEqual(event);
    expect(
      LogEventSchema.safeParse({ ...event, data: { ...event.data, content: 'x'.repeat(40_000) } })
        .success,
    ).toBe(false);
  });
});
