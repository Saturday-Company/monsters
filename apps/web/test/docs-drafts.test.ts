import { setAppLang, textDiff, type DraftView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { draftStrings } from '../src/components/projects/draft.strings.ts';
import { viewStrings } from '../src/components/projects/view.strings.ts';
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

describe('the words of the drafts and of a project’s page', () => {
  it('speaks English by default, with plurals and the subject of a title', () => {
    const s = draftStrings();
    expect(s.projectReady('Social', 1)).toContain('Its first automation is waiting');
    expect(s.projectReady('Social', 3)).toContain('Its 3 automations are waiting');
    expect(s.projectReady('Social', 0)).toBe(
      'Social is ready: message its lead from the project page.',
    );
    // The file name is on the card in small mono, not in the first-layer words.
    expect(s.docsSubject('Instructions of Social (CLAUDE.md)')).toBe('Social');
    expect(s.docsTitle('Instructions of Social (AGENTS.md)')).toBe('Instructions of Social');
    expect(s.docsTitle('Instructions of Social')).toBe('Instructions of Social');
    expect(s.memorySubject('Memory of Rhea')).toBe('Rhea’s memory');
    expect(s.card.proposes('Rhea', s.kindWords.memory)).toBe('Rhea proposes to remember');
    expect(s.grant(false)).toBe(
      'All the project’s monsters will be able to read and write here, with everything that’s already in it.',
    );
    expect(viewStrings().stop.stopped('Social', 1, 2, 0)).toBe(
      'I stopped the work of Social: 1 job, 2 requests from your lead.',
    );
    expect(viewStrings().archived.on(null)).toBe('Archived');
  });

  it('speaks Italian when the app does, with the same words as before', () => {
    setAppLang('it');
    try {
      const s = draftStrings();
      expect(s.projectReady('Social', 1)).toContain('La sua prima automazione aspetta');
      expect(s.projectReady('Social', 3)).toContain('Le sue 3 automazioni aspettano');
      expect(s.docsSubject('Istruzioni di Social (CLAUDE.md)')).toBe('Social');
      expect(s.docsTitle('Istruzioni di Social (AGENTS.md)')).toBe('Istruzioni di Social');
      expect(s.memorySubject('Memoria di Rhea')).toBe('la memoria di Rhea');
      expect(s.card.proposes('Rhea', s.kindWords.monster)).toBe('Rhea propone un nuovo mostro');
      expect(viewStrings().stop.stopped('Social', 1, 2, 1)).toBe(
        'Ho fermato il lavoro di Social: 1 lavoro, 2 richieste del tuo capo, 1 giro.',
      );
      expect(viewStrings().archived.on('21 ottobre 2026')).toBe('Archiviato il 21 ottobre 2026');
    } finally {
      setAppLang('en');
    }
  });
});
