import { describe, expect, it } from 'vitest';
import { projectFolderRefusal } from '../src/projects/service.ts';

const win = { platform: 'win32' as const, tmp: 'C:\\Users\\ana\\AppData\\Local\\Temp' };
const home = 'C:\\Users\\ana';

describe('projectFolderRefusal on Windows', () => {
  it('refuses AppData and the program folders in it', () => {
    for (const p of [
      'C:\\Users\\ana\\AppData',
      'C:\\Users\\ana\\AppData\\Roaming',
      'C:\\Users\\ana\\AppData\\Local',
      'C:\\Users\\ana\\AppData\\LocalLow',
      'C:\\Users\\ana\\AppData\\Roaming\\Code',
      'C:\\Users\\ana\\AppData\\Local\\Programs\\x',
      'C:\\Users\\ana\\AppData\\Local\\Temp',
      'C:\\Users\\ana\\.ssh',
      'C:\\Users\\ana',
      'C:\\',
    ]) {
      expect(projectFolderRefusal(p, home, win), p).not.toBeNull();
    }
  });
  it('allows the system temp folder subfolders and ordinary folders', () => {
    for (const p of [
      'C:\\Users\\ana\\AppData\\Local\\Temp\\monsters-x',
      'c:\\users\\ana\\appdata\\local\\temp\\a\\b',
      'C:\\Users\\ana\\Documents\\progetto',
      'D:\\lavoro',
    ]) {
      expect(projectFolderRefusal(p, home, win), p).toBeNull();
    }
  });
});

describe('projectFolderRefusal on macOS', () => {
  it('refuses Library but allows the temp folder', () => {
    const o = { platform: 'darwin' as const, tmp: '/Users/ana/Library/Caches/tmp' };
    expect(projectFolderRefusal('/Users/ana/Library/Preferences', '/Users/ana', o)).not.toBeNull();
    expect(projectFolderRefusal('/Users/ana/Library/Caches/tmp/x', '/Users/ana', o)).toBeNull();
  });
});
