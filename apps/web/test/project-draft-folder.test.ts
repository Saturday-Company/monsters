import type { DraftView } from '@monsters/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { folderGrant, PlanSummary } from '../src/components/projects/DraftCards.tsx';

/*
 * Review of ondate 3-4, n. 6: in "Da rivedere" a project was confirmed from its summary (the
 * lead and how many monsters) without seeing the folder every monster of it gets, read and
 * write. The summary shows the folder and what confirming grants there.
 */

type ProjectDraft = Extract<DraftView, { kind: 'project' }>['projectDraft'];

const draft = (extra: Partial<ProjectDraft> = {}): ProjectDraft =>
  ({
    id: 'p',
    name: 'Documenti',
    status: 'draft',
    folderExists: true,
    plan: { lead: { name: 'Ade' }, members: [], automations: [] },
    ...extra,
  }) as unknown as ProjectDraft;

describe('a project in "Da rivedere" shows the folder it grants', () => {
  it('names the folder and says every monster of the project reads and writes there', () => {
    const html = renderToStaticMarkup(
      createElement(PlanSummary, { d: draft({ folder: '/home/andrea/Documenti' }) }),
    );
    expect(html).toContain('data-testid="draft-plan-folder"');
    expect(html).toContain('Documenti');
    expect(html).toContain(
      'Tutti i mostri del progetto potranno leggere e scrivere qui, con tutto quello che c’è già.',
    );
  });

  it('a folder made at the confirmation says so; no folder, no line', () => {
    const made = draft({
      folder: '/home/andrea/Monsters Progetti/Documenti',
      plan: { lead: { name: 'Ade' }, members: [], automations: [], createFolder: true },
    });
    expect(folderGrant(made)).toBe('Tutti i mostri del progetto potranno leggere e scrivere qui.');
    expect(renderToStaticMarkup(createElement(PlanSummary, { d: made }))).toContain(
      'la creo alla conferma',
    );
    expect(renderToStaticMarkup(createElement(PlanSummary, { d: draft() }))).not.toContain(
      'draft-plan-folder',
    );
  });
});
