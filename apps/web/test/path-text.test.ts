import { describe, expect, it } from 'vitest';
import { middleEllipsis } from '../src/components/ui/PathText.tsx';

describe('middleEllipsis', () => {
  it('keeps short paths whole', () => {
    expect(middleEllipsis('~/Progetti/Sito')).toBe('~/Progetti/Sito');
    expect(middleEllipsis('/opt/sito')).toBe('/opt/sito');
  });

  it('writes the home folder as ~ (never /home/andrea/…)', () => {
    expect(middleEllipsis('/home/andrea/Sito')).toBe('~/Sito');
    expect(middleEllipsis('/Users/andrea/Progetti/Sito')).toBe('~/Progetti/Sito');
    expect(middleEllipsis('C:\\Users\\andrea\\Progetti\\Sito')).toBe('~\\Progetti\\Sito');
    // Only the home folder of a person, not a folder that merely starts the same way.
    expect(middleEllipsis('/homework/andrea/Sito')).toBe('/homework/andrea/Sito');
  });

  it('cuts the middle of a long one: where it lives and what it is', () => {
    expect(middleEllipsis('/home/andrea/Monsters Progetti/Sito di Saturday', 30)).toBe(
      '~/…/Sito di Saturday',
    );
    expect(middleEllipsis('/home/andrea/Documenti/Clienti/Sito di Saturday', 30)).toBe(
      '~/…/Clienti/Sito di Saturday',
    );
    expect(middleEllipsis('/opt/work/progetti/app/apps/web/src/components')).toBe(
      '/opt/work/…/src/components',
    );
  });

  it('shortens the last segment too when it alone is too long', () => {
    const out = middleEllipsis(
      '/home/andrea/Progetti/una-cartella-con-un-nome-molto-molto-lungo-davvero',
    );
    expect(out.length).toBeLessThanOrEqual(44);
    expect(out.startsWith('~/…/')).toBe(true);
  });
});
