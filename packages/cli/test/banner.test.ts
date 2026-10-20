import { CHOSEN, DOT_W, ROSTER, ROSTER_ORDER } from '@monsters/monster-kit';
import type { AgentSummary } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { teamBanner } from '../src/banner.ts';

const agent = (id: string, name: string, genome: unknown, isOrchestrator = false) =>
  ({
    id,
    name,
    role: '',
    color: '#fff',
    isOrchestrator,
    genome,
    state: 'idle',
  }) as unknown as AgentSummary;

const team = ROSTER_ORDER.slice(0, 4).map((n, i) =>
  agent(n, ROSTER[n].name, ROSTER[n].variants[CHOSEN[n]], i === 1),
);
/** ANSI colour sequences (ESC [ … m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI, '');

describe('teamBanner', () => {
  it('puts the capo squadra first and fits the terminal width', () => {
    const lines = teamBanner(team, { columns: 2 * DOT_W + 3, color: false });
    const names = lines.at(-1)!;
    expect(names.trim().startsWith(ROSTER[ROSTER_ORDER[1]!].name)).toBe(true);
    for (const l of lines) expect(strip(l).length).toBeLessThanOrEqual(2 * DOT_W + 3);
  });

  it('draws nothing when not even one monster fits, and skips invalid genomes', () => {
    expect(teamBanner(team, { columns: DOT_W - 1, color: false })).toEqual([]);
    expect(teamBanner([agent('x', 'X', { nope: true })], { columns: 80, color: false })).toEqual(
      [],
    );
  });

  it('cleans control sequences out of the names', () => {
    const evil = agent('e', 'Ev\x1b[2Jil', ROSTER.titan.variants.A);
    const lines = teamBanner([evil], { columns: 80, color: true });
    expect(lines.at(-1)).not.toContain('\x1b');
    expect(lines.slice(0, -1).join('')).toContain('\x1b[38;2;');
  });
});
