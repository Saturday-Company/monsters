/*
 * "Related notes" of a note: only the clearly related ones, at most a few,
 * possibly none (D-030). The cosine of the embedding model alone cannot be
 * cut at a fixed value: with granite every pair of Italian notes scores
 * 0.65-0.85, related or not. What stands out is a note far above the others
 * *for this note*: the similarity is turned into a z-score (see
 * `SemanticIndex.related`, median and MAD of this note's similarities) and
 * links, tags and folder add to it.
 *
 * Measured with the real model on the 200-note vault of `semantic-real`:
 * before, every note listed its 8 nearest (mostly filler notes); with a
 * z of at least 2 the recipes list each other, the trips and sport notes list
 * each other, and notes with no subject in common list nothing.
 */

/** Notes listed at most when the caller does not ask for a number. */
export const RELATED_LIMIT = 5;
/** Least relevance (z-score plus bonuses) of a related note. */
export const RELATED_MIN_Z = 2;

/** Bonus of a direct link, either way: the user said the notes are related. */
const LINK_BONUS = 1;
/** Per explicit tag in common, up to `TAG_BONUS_MAX`. */
const TAG_BONUS = 0.5;
const TAG_BONUS_MAX = 1;
/** Per link target in common (both cite the same note), up to `TARGET_BONUS_MAX`. */
const TARGET_BONUS = 0.25;
const TARGET_BONUS_MAX = 0.5;
/** Same subfolder (e.g. `Risorse/Ricette`); top-level folders are categories, not subjects. */
const FOLDER_BONUS = 0.25;

/** What the vault itself says about two notes, besides their text. */
export interface RelationSignals {
  linked: boolean;
  sharedTags: number;
  sharedTargets: number;
  sameFolder: boolean;
}

export function relationBonus(s: RelationSignals | undefined): number {
  if (!s) return 0;
  return (
    (s.linked ? LINK_BONUS : 0) +
    Math.min(s.sharedTags * TAG_BONUS, TAG_BONUS_MAX) +
    Math.min(s.sharedTargets * TARGET_BONUS, TARGET_BONUS_MAX) +
    (s.sameFolder ? FOLDER_BONUS : 0)
  );
}

/**
 * The related notes among scored candidates: z plus bonuses at or above the
 * threshold, best first, at most `limit`.
 */
export function pickRelated<T extends { nid: number; z: number }>(
  scored: readonly T[],
  signals: ReadonlyMap<number, RelationSignals>,
  opts: { limit: number },
): (T & { relevance: number })[] {
  return scored
    .map((s) => ({ ...s, relevance: s.z + relationBonus(signals.get(s.nid)) }))
    .filter((s) => s.relevance >= RELATED_MIN_Z)
    .sort((a, b) => b.relevance - a.relevance || a.nid - b.nid)
    .slice(0, opts.limit);
}
