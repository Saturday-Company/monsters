import type { AgentModels, ModelRefView } from '@monsters/shared';

/*
 * Main model and fallback for the whole squad (wave C3). Nothing new is stored: the core keeps one
 * chain per monster, and the two simple choices are its first two links. This module reads them
 * off the chains the monsters have, and writes them back without touching the rest of a chain
 * (the links after the second, their tiers), which only Advanced edits.
 */

/** What the squad's chains look like, for the simple view. */
export type SquadModelsView =
  /** No monster to show. */
  | { kind: 'none' }
  /**
   * Every monster has the same chain of its own: its first link is the main model, the second
   * the fallback; `more` links after that are kept (and shown in Advanced).
   */
  | { kind: 'shared'; main: ModelRefView | null; fallback: ModelRefView | null; more: number }
  /** Every monster is on "Automatic" (each from its own base): nothing to choose in the simple view. */
  | { kind: 'automatic' }
  /** The monsters do not share one chain: the simple view says so and points to Advanced. */
  | { kind: 'different' };

const linkKey = (l: ModelRefView) => `${l.provider}\u0000${l.model}\u0000${l.tier ?? ''}`;

/** The same links, in the same order (a tier is part of a link). */
export function sameChain(a: readonly ModelRefView[], b: readonly ModelRefView[]): boolean {
  return a.length === b.length && a.every((l, i) => linkKey(l) === linkKey(b[i]!));
}

/** Reads the squad's chains: shared, all automatic, or different. Never a guess. */
export function squadModels(agents: readonly AgentModels[]): SquadModelsView {
  const first = agents[0];
  if (!first) return { kind: 'none' };
  // Automatic counts as one choice whatever the base of each monster (D-093).
  if (agents.every((a) => a.auto !== undefined)) return { kind: 'automatic' };
  if (agents.some((a) => a.auto !== undefined)) return { kind: 'different' };
  if (!agents.every((a) => sameChain(a.models, first.models))) return { kind: 'different' };
  return {
    kind: 'shared',
    main: first.models[0] ?? null,
    fallback: first.models[1] ?? null,
    more: Math.max(0, first.models.length - 2),
  };
}

/** A link chosen in the simple view: no tier (a tier belonged to the model it replaces). */
const plain = (l: ModelRefView): ModelRefView => ({ provider: l.provider, model: l.model });

/** The chain with a new main model: the other links stay as they are. */
export function withMain(models: readonly ModelRefView[], main: ModelRefView): ModelRefView[] {
  return [plain(main), ...models.slice(1)];
}

/**
 * The chain with a new fallback (second link), or without one (`null`): the links after it move
 * up. With no main model yet, the fallback cannot exist alone: nothing changes.
 */
export function withFallback(
  models: readonly ModelRefView[],
  fallback: ModelRefView | null,
): ModelRefView[] {
  if (models.length === 0) return [];
  const [main, , ...rest] = models;
  if (fallback === null) return [main!, ...rest];
  return [main!, plain(fallback), ...rest];
}
