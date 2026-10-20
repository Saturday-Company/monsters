/*
 * Reciprocal Rank Fusion (research/04 §3.4): score = Σ 1 / (k + rank) over the
 * ranked lists, rank starting at 1. No score normalisation is needed, which is
 * why full-text (BM25) and vector lists can be merged directly.
 */

export const RRF_K = 60;

/**
 * Fused ranking of keys from several ranked lists (best first, ties keep
 * first-seen order). `weights` scale each list's contribution (default 1),
 * for the whole list or per key.
 */
export function rrfFuse<K>(
  lists: readonly (readonly K[])[],
  k = RRF_K,
  weights: readonly (number | ((key: K) => number))[] = [],
): { key: K; score: number }[] {
  const scores = new Map<K, number>();
  lists.forEach((list, l) => {
    const w = weights[l] ?? 1;
    list.forEach((key, i) => {
      const weight = typeof w === 'function' ? w(key) : w;
      scores.set(key, (scores.get(key) ?? 0) + weight / (k + i + 1));
    });
  });
  return [...scores.entries()]
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score);
}
