import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { capWarnings, type CapLink } from '../src/components/settings/SpendSection.tsx';

const link = (
  id: CapLink['id'],
  capEur: number | null,
  period: 'oggi' | 'mese' = 'oggi',
  who?: string,
): CapLink => ({
  id,
  label: { monster: 'Monster', project: 'Project', team: 'All monsters' }[id],
  who,
  period,
  meter: capEur === null ? null : { spentEur: 0, capEur, ratio: 0 },
});

afterEach(() => setAppLang('en'));

describe('caps higher than the one that holds them', () => {
  it('says so for a monster above the team', () => {
    expect(
      capWarnings([link('monster', 9, 'oggi', 'Rhea'), link('project', null), link('team', 3)]),
    ).toEqual(['Monster (Rhea): higher than the cap for all monsters, which kicks in first.']);
  });

  it('says it in Italian with the right article', () => {
    setAppLang('it');
    const it = (outer: 'project' | 'team') =>
      capWarnings([link('monster', 9, 'oggi', 'Rhea'), link(outer, 3)]);
    expect(it('team')).toEqual([
      'Monster (Rhea): più alto del tetto di tutti i mostri: scatta prima quello.',
    ]);
    expect(it('project')).toEqual([
      'Monster (Rhea): più alto del tetto del progetto: scatta prima quello.',
    ]);
  });

  it('says so for a project above the team, not for a consistent chain', () => {
    expect(
      capWarnings([link('monster', null), link('project', 50, 'mese'), link('team', 30, 'mese')]),
    ).toHaveLength(1);
    expect(capWarnings([link('monster', 1), link('project', 2), link('team', 3)])).toEqual([]);
  });

  it('does not compare a day with a month', () => {
    expect(capWarnings([link('monster', 9, 'oggi'), link('team', 3, 'mese')])).toEqual([]);
  });
});
