/*
 * Small pure helpers shared by the build and the browser: the version stamp printed on the
 * datasheet and a key-sequence matcher for the easter egg.
 */

/**
 * The version as a part number: `0.1.0-alpha.18` → `MNSTR.0A18`, `0.2.0-beta.3` → `MNSTR.0B3`,
 * `1.2.0` → `MNSTR.1.2`.
 */
export function versionStamp(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.?(\d+)?)?/i.exec(version.trim());
  if (!m) return 'MNSTR.DEV';
  const [, major, minor, , channel, num] = m;
  if (channel) return `MNSTR.${major}${channel.charAt(0).toUpperCase()}${num ?? ''}`;
  return `MNSTR.${major}.${minor}`;
}

export const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
] as const;

/** Feeds keys one at a time; returns true on the key that completes the sequence. */
export function sequenceMatcher(sequence: readonly string[]): (key: string) => boolean {
  const norm = (k: string) => (k.length === 1 ? k.toLowerCase() : k);
  const want = sequence.map(norm);
  let recent: string[] = [];
  return (key: string) => {
    recent = [...recent, norm(key)].slice(-want.length);
    if (recent.length === want.length && recent.every((k, i) => k === want[i])) {
      recent = [];
      return true;
    }
    return false;
  };
}
