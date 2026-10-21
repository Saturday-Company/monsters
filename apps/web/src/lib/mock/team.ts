import type { AgentSummary } from '@monsters/shared';
import { colorOf, monsterFor } from '../monsters.ts';
import { tr } from './lang.ts';

/**
 * The pretend team of the mock core: the orchestrator plus four monsters, or
 * the whole roster of seven (`?squadra=7`, for a long chat list).
 */
export function mockTeam(size: 5 | 7 = 5): AgentSummary[] {
  const make = (id: string, role: string, isOrchestrator = false): AgentSummary => {
    const genome = monsterFor(id);
    return {
      id,
      name: id[0]!.toUpperCase() + id.slice(1),
      role,
      color: colorOf(genome),
      isOrchestrator,
      genome,
      state: 'idle',
    };
  };
  const team = [
    make('titan', tr('Coordinates the squad', 'Coordina la squadra'), true),
    make('rhea', tr('Finds and checks sources', 'Cerca e verifica le fonti')),
    make('dione', tr('Writes posts and copy', 'Scrive post e testi')),
    make('enceladus', tr('Keeps the notes in order', 'Tiene in ordine le note')),
    make('mimas', tr('Makes graphics and does the numbers', 'Fa le grafiche e i conti')),
  ];
  if (size === 7) {
    team.splice(3, 0, make('tethys', tr('Keeps the calendar', 'Tiene il calendario')));
    team.splice(5, 0, make('hyperion', tr('Checks finished jobs', 'Controlla i lavori finiti')));
  }
  return team;
}
