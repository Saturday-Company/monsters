import { describe, expect, it } from 'vitest';
import { middleEllipsis } from '../src/components/ui/PathText.tsx';

describe('middleEllipsis', () => {
  it('keeps short paths whole', () => {
    expect(middleEllipsis('~/Progetti/Sito')).toBe('~/Progetti/Sito');
    expect(middleEllipsis('/home/andrea/Sito')).toBe('/home/andrea/Sito');
  });

  it('cuts the middle of a long one: where it lives and what it is', () => {
    expect(middleEllipsis('/home/andrea/Monsters Progetti/Sito di Saturday')).toBe(
      '/home/andrea/…/Sito di Saturday',
    );
    expect(middleEllipsis('/home/andrea/Documenti/Clienti/Sito di Saturday')).toBe(
      '/home/andrea/…/Clienti/Sito di Saturday',
    );
  });

  it('shortens the last segment too when it alone is too long', () => {
    const out = middleEllipsis(
      '/home/andrea/Progetti/una-cartella-con-un-nome-molto-molto-lungo-davvero',
    );
    expect(out.length).toBeLessThanOrEqual(44);
    expect(out.startsWith('/home/andrea/…/')).toBe(true);
  });
});
