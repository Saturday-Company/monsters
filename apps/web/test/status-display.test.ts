import { describe, expect, it } from 'vitest';
import { displayState } from '../src/components/shell/StatusDisplay.tsx';

const base = {
  halted: false,
  connection: 'open',
  questions: [] as { from: string }[],
  nameOf: (id: string) => id,
  working: 0,
};

describe('status display, compact words', () => {
  it('never reduces the state to a bare number', () => {
    expect(displayState({ ...base, questions: [{ from: 'titan' }] }).short).toBe('1 domanda');
    expect(displayState({ ...base, questions: [{ from: 'a' }, { from: 'b' }] }).short).toBe(
      '2 domande',
    );
    expect(displayState({ ...base, working: 2 }).short).toBe('2 al lavoro');
    expect(displayState({ ...base, halted: true }).short).toBe('Fermi');
    expect(displayState(base).short).toBe('Tranquillo');
    // In Italian like the rest of the display (review of 18/10, item 15).
    expect(displayState({ ...base, connection: 'closed' }).short).toBe('Scollegato');
  });
});
