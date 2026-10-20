import { DOT_W, renderDotsText, type MonsterGenomeInput } from '@monsters/monster-kit';
import type { AgentSummary } from '@monsters/shared';
import { stripControl } from './chat.ts';

/*
 * The team at the top of the interactive chat (docs/design.md, "Uguale ovunque"): the same dot
 * creatures as in the app, printed with half blocks. Only on a terminal; colours in 24-bit ANSI
 * unless NO_COLOR is set. The creatures come from the kit and are trusted output; the names come
 * from the core and lose any control sequence.
 */

/** ANSI colour sequences (ESC [ … m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const GAP = 3;

/** Visible width of a line (without the ANSI colour sequences of the kit). */
const visible = (line: string): number => line.replace(ANSI, '').length;

const pad = (line: string, width: number): string =>
  line + ' '.repeat(Math.max(0, width - visible(line)));

/** Cuts a name to the width of a creature, centred under it. */
function caption(name: string, width: number): string {
  const clean = stripControl(name).trim();
  const cut = clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
  const left = Math.floor((width - cut.length) / 2);
  return pad(' '.repeat(left) + cut, width);
}

/**
 * Lines of the banner: as many monsters as fit in `columns` (the capo squadra first), side by
 * side, with their names underneath. Empty when there is no room or no monster can be drawn.
 */
export function teamBanner(
  agents: readonly AgentSummary[],
  opts: { columns: number; color: boolean },
): string[] {
  const fit = Math.floor((opts.columns + GAP) / (DOT_W + GAP));
  if (fit < 1) return [];
  const ordered = [...agents].sort((a, b) => Number(b.isOrchestrator) - Number(a.isOrchestrator));
  const drawn: { art: string[]; name: string }[] = [];
  for (const a of ordered) {
    if (drawn.length >= fit) break;
    try {
      const art = renderDotsText(a.genome as MonsterGenomeInput, {
        color: opts.color ? 'ansi' : 'none',
      });
      drawn.push({ art, name: a.name });
    } catch {
      // An agent without a valid genome is left out of the picture.
    }
  }
  if (drawn.length === 0) return [];
  const height = Math.max(...drawn.map((d) => d.art.length));
  const sep = ' '.repeat(GAP);
  const lines: string[] = [];
  for (let i = 0; i < height; i++) {
    lines.push(
      drawn
        .map((d) => pad(d.art[i] ?? '', DOT_W))
        .join(sep)
        .trimEnd(),
    );
  }
  lines.push(
    drawn
      .map((d) => caption(d.name, DOT_W))
      .join(sep)
      .trimEnd(),
  );
  return lines;
}
