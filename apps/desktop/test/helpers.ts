import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const dirs: string[] = [];

/** A temporary folder (not created), removed after each test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-desktop-'));
  dirs.push(dir);
  return join(dir, 'home');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
