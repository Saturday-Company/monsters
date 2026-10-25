import { describe, expect, it } from 'vitest';
import { presetOf, withPreset } from '../src/components/settings/permission-presets.ts';

/* The three levels of Settings → Permissions (C7): what they describe, and what "Apply to all" keeps. */

const base = { vault: true, web: true, shell: true, folders: [{ path: '/a', write: true }] };

describe('permission presets', () => {
  it('reads a monster as one of the three levels', () => {
    expect(presetOf({ vault: true, web: false, shell: false })).toBe('notes');
    expect(presetOf({ vault: true, web: true })).toBe('web');
    expect(presetOf(base)).toBe('commands');
    // Reading or writing the notes does not change the level.
    expect(presetOf({ ...base, vault: false })).toBe('commands');
  });

  it('calls a mix the three do not describe custom', () => {
    expect(presetOf({ vault: true, web: false, shell: true })).toBeNull();
  });

  it('sets web and commands, and leaves the notes and the folders alone', () => {
    const readOnly = { ...base, vault: false };
    expect(withPreset(readOnly, 'notes')).toEqual({ ...readOnly, web: false, shell: false });
    expect(withPreset(readOnly, 'web')).toEqual({ ...readOnly, web: true, shell: false });
    expect(withPreset({ vault: true, web: false }, 'commands')).toEqual({
      vault: true,
      web: true,
      shell: true,
      folders: [],
    });
    expect(withPreset(base, 'web').folders).toEqual(base.folders);
  });

  it('round-trips: the level chosen is the level read back', () => {
    for (const preset of ['notes', 'web', 'commands'] as const) {
      expect(presetOf(withPreset({ vault: true, web: false, shell: true }, preset))).toBe(preset);
    }
  });
});
