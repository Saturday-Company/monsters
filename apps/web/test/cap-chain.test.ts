import { describe, expect, it } from 'vitest';
import { capWarnings, type CapLink } from '../src/components/settings/SpendSection.tsx';

const link = (
  id: CapLink['id'],
  capEur: number | null,
  period: 'oggi' | 'mese' = 'oggi',
  who?: string,
): CapLink => ({
  id,
  label: { monster: 'Mostro', project: 'Progetto', team: 'Tutta la squadra' }[id],
  who,
  period,
  meter: capEur === null ? null : { spentEur: 0, capEur, ratio: 0 },
});

describe('caps higher than the one that holds them', () => {
  it('says so for a monster above the team', () => {
    expect(
      capWarnings([link('monster', 9, 'oggi', 'Rhea'), link('project', null), link('team', 3)]),
    ).toEqual(['Mostro (Rhea): più alto del tetto della squadra: scatta prima quello.']);
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
