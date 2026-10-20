import {
  MonsterGenomeSchema,
  derivePalette,
  genomeFromName,
  isRosterName,
  monsterFor as rosterMonster,
  type MonsterGenome,
} from '@monsters/monster-kit';

/** The official monster of a roster agent (kit's `monsterFor`), or one generated from any other name. */
export function monsterFor(name: string): MonsterGenome {
  const key = name.trim().toLowerCase();
  return isRosterName(key) ? rosterMonster(key) : genomeFromName(name);
}

/**
 * Genome of an agent: the one sent by the core (`AgentSummary.genome`) when valid,
 * otherwise the roster monster with the same id or name, otherwise one generated
 * from the name.
 */
export function genomeOf(agent: { id: string; name: string; genome?: unknown }): MonsterGenome {
  const parsed = MonsterGenomeSchema.safeParse(agent.genome);
  if (parsed.success) return parsed.data;
  return isRosterName(agent.id) ? rosterMonster(agent.id) : monsterFor(agent.name);
}

/** Body colour of a genome (what the core uses as the agent colour). */
export function colorOf(genome: MonsterGenome): string {
  return derivePalette(genome).base;
}
