import { describe, expect, it } from 'vitest';
import { folderKey } from '../src/lib/utils.ts';

describe('folderKey', () => {
  it('spells the same folder the same way', () => {
    const home = '/home/demo';
    expect(folderKey('~/Progetti', home)).toBe(folderKey('/home/demo/Progetti', home));
    expect(folderKey('/home/demo//Progetti/', home)).toBe('/home/demo/Progetti');
    expect(folderKey('~', home)).toBe('/home/demo');
    expect(folderKey('/', home)).toBe('/');
    // Case counts on Linux, not on Windows.
    expect(folderKey('/home/demo/progetti', home)).not.toBe(folderKey('/home/demo/Progetti', home));
    const win = 'C:\\Users\\Demo';
    expect(folderKey('~\\Documenti', win)).toBe(folderKey('c:/users/demo/documenti/', win));
    expect(folderKey('C:\\', win)).toBe('c:\\');
    // Without the home, `~` stays as written.
    expect(folderKey('~/Progetti')).toBe('~/Progetti');
  });
});
