import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { displayState } from '../src/components/shell/StatusDisplay.tsx';

const base = {
  halted: false,
  connection: 'open',
  questions: [] as { from: string }[],
  nameOf: (id: string) => id,
  working: 0,
};

describe('status display, compact words', () => {
  afterEach(() => setAppLang('en'));

  it('never reduces the state to a bare number', () => {
    expect(displayState({ ...base, questions: [{ from: 'titan' }] }).short).toBe('1 question');
    expect(displayState({ ...base, questions: [{ from: 'a' }, { from: 'b' }] }).short).toBe(
      '2 questions',
    );
    expect(displayState({ ...base, working: 2 }).short).toBe('2 at work');
    expect(displayState({ ...base, halted: true }).short).toBe('Stopped');
    expect(displayState(base).short).toBe('Quiet');
    // In words like the rest of the display (review of 18/10, item 15).
    expect(displayState({ ...base, connection: 'closed' }).short).toBe('Offline');
  });

  it('says the long form with the name first', () => {
    expect(displayState({ ...base, questions: [{ from: 'titan' }] }).text).toBe('titan asks');
    expect(displayState({ ...base, questions: [{ from: 'titan' }, { from: 'titan' }] }).text).toBe(
      '2 questions · titan',
    );
    expect(displayState({ ...base, working: 3, confused: ['rhea'] }).text).toBe(
      'rhea is changing course',
    );
  });

  it('says the same in Italian', () => {
    setAppLang('it');
    expect(displayState({ ...base, questions: [{ from: 'titan' }] }).short).toBe('1 domanda');
    expect(displayState({ ...base, questions: [{ from: 'a' }, { from: 'b' }] }).short).toBe(
      '2 domande',
    );
    expect(displayState({ ...base, questions: [{ from: 'titan' }] }).text).toBe('titan chiede');
    expect(displayState({ ...base, working: 2 }).short).toBe('2 al lavoro');
    expect(displayState({ ...base, halted: true }).short).toBe('Fermi');
    expect(displayState(base).short).toBe('Tranquillo');
    expect(displayState({ ...base, connection: 'closed' }).short).toBe('Scollegato');
  });
});
