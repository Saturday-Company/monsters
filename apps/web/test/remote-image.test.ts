import { describe, expect, it } from 'vitest';
import { carriesData } from '../src/components/preview/ChatMedia.tsx';

describe('remote images in a message (D-085)', () => {
  it('asks once more when the address carries data', () => {
    expect(carriesData('https://upload.wikimedia.org/a/b.jpg')).toBe(false);
    expect(carriesData('https://upload.wikimedia.org/a/b.jpg?')).toBe(false);
    expect(carriesData('https://evil.example/p.png?d=la%20mia%20nota')).toBe(true);
    expect(carriesData('https://evil.example/p.png#nota')).toBe(true);
    expect(carriesData('not a url')).toBe(true);
  });
});
