import type { AgentSummary } from '@monsters/shared';
import { colorOf, monsterFor } from '../monsters.ts';

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
    make('titan', 'Coordina la squadra', true),
    make('rhea', 'Cerca e verifica le fonti'),
    make('dione', 'Scrive post e testi'),
    make('enceladus', 'Tiene in ordine le note'),
    make('mimas', 'Fa le grafiche e i conti'),
  ];
  if (size === 7) {
    team.splice(3, 0, make('tethys', 'Tiene il calendario'));
    team.splice(5, 0, make('hyperion', 'Controlla i lavori finiti'));
  }
  return team;
}
