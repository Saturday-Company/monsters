import { textDiff, type DraftView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { docsDiff } from '../src/lib/docs-diff.ts';
import { MockCore } from '../src/lib/mock/core.ts';

/* D-113: the proposals for CLAUDE.md and AGENTS.md in the app and in the mock core. */

describe('docsDiff', () => {
  it('counts what a proposal adds and removes', () => {
    const d = docsDiff(textDiff('# A\nuno\ndue\n', '# A\nuno\ntre\nquattro\n'));
    expect(d).toEqual({
      lines: ['@@ riga 1 @@', ' # A', ' uno', '-due', '+tre', '+quattro'],
      added: 2,
      removed: 1,
    });
  });

  it('a new file: only added lines; the same text: nothing', () => {
    expect(docsDiff(textDiff(null, 'x\ny\n'))).toMatchObject({ added: 2, removed: 0 });
    expect(docsDiff(textDiff('x\n', 'x\n'))).toEqual({
      lines: [],
      added: 0,
      removed: 0,
    });
  });
});

describe('the docs proposals of the mock core', () => {
  const docs = (core: MockCore) =>
    (core.handle('GET', '/api/drafts', undefined).body as DraftView[]).filter(
      (d): d is Extract<DraftView, { kind: 'docs' }> => d.kind === 'docs',
    );

  it('Iapetus’ applies; Calypso’s, written on an older file and after a web page, does not', () => {
    const core = new MockCore({ mode: 'demo', storage: null });
    const [iapetus, calypso] = docs(core);
    expect(iapetus).toMatchObject({
      title: 'Instructions of Saturday Social (CLAUDE.md)',
      project: 'social-di-saturday',
      docs: { file: 'CLAUDE.md', stale: false },
    });
    expect(calypso).toMatchObject({ docs: { file: 'AGENTS.md', stale: true, tainted: true } });
    const stale = core.handle('POST', `/api/drafts/docs/${calypso!.id}/confirm`, undefined);
    expect(stale).toMatchObject({ status: 409, body: { error: 'docs_changed' } });
    const done = core.handle('POST', `/api/drafts/docs/${iapetus!.id}/confirm`, undefined);
    expect(done).toMatchObject({
      status: 200,
      body: { kind: 'docs', project: 'social-di-saturday' },
    });
    expect(docs(core).map((d) => d.id)).toEqual([calypso!.id]);
    expect(core.handle('POST', `/api/drafts/docs/${calypso!.id}/discard`, undefined).status).toBe(
      200,
    );
    expect(docs(core)).toEqual([]);
    expect(
      core.events.filter((e) => e.type === 'project_docs_proposal').map((e) => e.data.action),
    ).toEqual(['proposed', 'proposed', 'applied', 'discarded']);
  });
});
