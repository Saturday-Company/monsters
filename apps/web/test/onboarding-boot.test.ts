import { dotGrid, isLight, randomGenome } from '@monsters/monster-kit';
import { describe, expect, it } from 'vitest';
import { bootOrder } from '../src/onboarding/DotReveal.tsx';

/* The birth of the team: every monster switches on dot by dot (docs/design.md, "Primo avvio"). */

describe('bootOrder', () => {
  const genome = randomGenome(12345);

  it('lights every light dot of the first frame, once', () => {
    const { dots } = bootOrder(genome, 'happy', 700);
    const grid = dotGrid(genome, 'happy', 0);
    expect(dots).toHaveLength(grid.cells.filter(isLight).length);
    const keys = new Set(dots.map((d) => `${d.x},${d.y}`));
    expect(keys.size).toBe(dots.length);
  });

  it('spreads the dots over the duration, from 0 to the end', () => {
    const { dots } = bootOrder(genome, 'happy', 700);
    const times = dots.map((d) => d.at);
    expect(Math.min(...times)).toBe(0);
    expect(Math.max(...times)).toBe(700);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('is the same for the same monster and different for another one', () => {
    const order = (g = genome) =>
      bootOrder(g)
        .dots.map((d) => `${d.x},${d.y}`)
        .join(' ');
    expect(order()).toBe(order());
    expect(order(randomGenome(999))).not.toBe(order());
    // Not simply top to bottom: the order is shuffled.
    const rows = bootOrder(genome).dots.map((d) => d.y);
    expect([...rows].sort((a, b) => a - b)).not.toEqual(rows);
  });
});
