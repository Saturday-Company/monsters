import { describe, expect, it } from 'vitest';
import { loginItemState } from '../src/lib/desktop.ts';

/* "Apri all'accesso" (D-095): what the bridge answers, taken only when it has the right shape. */

describe('the state of "Apri all’accesso" from the app', () => {
  it('supported and enabled as booleans, the note only when it says something', () => {
    expect(loginItemState({ supported: true, enabled: false })).toEqual({
      supported: true,
      enabled: false,
    });
    expect(loginItemState({ supported: false, enabled: false, note: 'Solo installata.' })).toEqual({
      supported: false,
      enabled: false,
      note: 'Solo installata.',
    });
    expect(loginItemState({ supported: true, enabled: true, note: '' })).toEqual({
      supported: true,
      enabled: true,
    });
  });

  it('anything else (an older app, a refused caller) is nothing', () => {
    for (const bad of [null, undefined, true, 'on', {}, { supported: 'yes', enabled: true }]) {
      expect(loginItemState(bad)).toBeNull();
    }
  });
});
