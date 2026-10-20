/**
 * The diff of a proposal for CLAUDE.md or AGENTS.md (D-113; computed by the
 * core on the whole file, `DraftView.docs.diff`) as lines for the small
 * screen, with how many lines it adds and removes.
 */
export function docsDiff(diff: string): { lines: string[]; added: number; removed: number } {
  const lines = diff ? diff.split('\n') : [];
  return {
    lines,
    added: lines.filter((l) => l.startsWith('+')).length,
    removed: lines.filter((l) => l.startsWith('-')).length,
  };
}
