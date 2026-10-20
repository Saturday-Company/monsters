import { describe, expect, it } from 'vitest';
import { targetName, targetStatus } from '../src/components/shell/ComputerSwitcher.tsx';
import { cn, TEXT_SIZES } from '../src/lib/utils.ts';

describe('computer switcher (D-059)', () => {
  it('says the state in words and in the colour of the dot', () => {
    expect(targetStatus({ state: 'ready' })).toEqual({ tone: 'ready', text: 'pronto' });
    for (const state of ['starting', 'connecting', 'reconnecting'] as const) {
      expect(targetStatus({ state }).tone).toBe('busy');
    }
    expect(targetStatus({ state: 'offline' })).toEqual({
      tone: 'off',
      text: 'non raggiungibile',
    });
  });

  it('names this computer and the connections', () => {
    expect(targetName({ kind: 'local', name: '' })).toBe('Questo computer');
    expect(targetName({ kind: 'local', name: 'Questo computer' })).toBe('Questo computer');
    expect(targetName({ kind: 'remote', name: ' PC di casa ' })).toBe('PC di casa');
    expect(targetName({ kind: 'remote', name: '' })).toBe('Un altro computer');
  });
});

describe('type scale', () => {
  it('cn() keeps a size of the scale next to a text colour, and the later size wins', () => {
    for (const size of TEXT_SIZES) {
      expect(cn(`text-${size}`, 'text-ink')).toBe(`text-${size} text-ink`);
    }
    expect(cn('text-body text-ink', 'text-large')).toBe('text-ink text-large');
  });
});
