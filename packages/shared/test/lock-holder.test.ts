import { describe, expect, it } from 'vitest';
import {
  currentBootId,
  holderIsStale,
  LATER_START_MS,
  parseProcStatStart,
  parsePsStart,
  systemHolderProbes,
  type HolderProbes,
  type LockHolder,
  type StartTime,
} from '../src/node/index.ts';

const T0 = Date.UTC(2026, 9, 28, 9, 0, 0);

function probes(
  opts: { alive?: boolean; boot?: string | null; start?: StartTime | null } = {},
): HolderProbes {
  return {
    exists: () => opts.alive ?? true,
    bootId: () => (opts.boot === undefined ? 'boot-1' : opts.boot),
    startOf: () => (opts.start === undefined ? null : opts.start),
  };
}

const holder = (extra: Partial<LockHolder> = {}): LockHolder => ({
  pid: 4242,
  start: 777,
  boot: 'boot-1',
  acquiredAt: T0,
  ...extra,
});

describe('is the holder of a lock still the core that took it', () => {
  it('a pid that no longer exists is stale', () => {
    expect(holderIsStale(holder(), probes({ alive: false }))).toBe(true);
  });

  it('a lock from an earlier boot is stale, whatever is running with that pid now', () => {
    expect(holderIsStale(holder(), probes({ boot: 'boot-2' }))).toBe(true);
    // Without a boot id on either side there is nothing to compare.
    expect(holderIsStale(holder({ boot: null }), probes({ boot: 'boot-2' }))).toBe(false);
    expect(holderIsStale(holder(), probes({ boot: null }))).toBe(false);
    expect(holderIsStale(holder(), probes({ boot: 'boot-1' }))).toBe(false);
  });

  it('Linux: another start time in clock ticks is another process (reused pid)', () => {
    const ticks = (value: number): StartTime => ({ value, unit: 'ticks' });
    expect(holderIsStale(holder(), probes({ start: ticks(999) }))).toBe(true);
    expect(holderIsStale(holder(), probes({ start: ticks(777) }))).toBe(false);
    // A lock that did not record its start time cannot be told apart this way.
    expect(holderIsStale(holder({ start: null }), probes({ start: ticks(999) }))).toBe(false);
  });

  it('macOS and Windows: a process that started after the lock was taken cannot be its core', () => {
    const ms = (value: number): StartTime => ({ value, unit: 'ms' });
    // The core started a moment before it took the lock: the same process.
    expect(holderIsStale(holder(), probes({ start: ms(T0 - 1500) }))).toBe(false);
    // Clocks and `ps` that counts whole seconds: a little after is still tolerated.
    expect(holderIsStale(holder(), probes({ start: ms(T0 + LATER_START_MS - 1) }))).toBe(false);
    // A process of the next session, hours later, with the same pid.
    expect(holderIsStale(holder(), probes({ start: ms(T0 + 3_600_000) }))).toBe(true);
    // An old lock without a time (older core): not judged by it.
    expect(holderIsStale(holder({ acquiredAt: 0 }), probes({ start: ms(T0) }))).toBe(false);
  });

  it('when the start time cannot be had the holder counts as alive (wrongly stale is the worse mistake)', () => {
    expect(holderIsStale(holder(), probes({ start: null }))).toBe(false);
  });
});

describe('what the system tells', () => {
  it('reads the start time out of /proc/<pid>/stat, names with spaces and parentheses included', () => {
    // After the name: state is field 3, the start time field 22, the 20th of these.
    const after = ['S', ...Array.from({ length: 30 }, (_, i) => String(i))];
    after[19] = '123456';
    expect(parseProcStatStart(`123 (my (odd) app) ${after.join(' ')}`)).toBe(123456);
    expect(parseProcStatStart('garbage')).toBeNull();
    expect(parseProcStatStart('1 (x) S 1 2')).toBeNull();
  });

  it('reads the start time out of ps', () => {
    expect(parsePsStart('Wed Oct 28 09:12:33 2026\n')).toBe(
      new Date(2026, 9, 28, 9, 12, 33).getTime(),
    );
    expect(parsePsStart('')).toBeNull();
    expect(parsePsStart('not a date')).toBeNull();
  });

  it('knows this very process: it exists, it started, and the boot id is stable', () => {
    const real = systemHolderProbes();
    expect(real.exists(process.pid)).toBe(true);
    expect(real.exists(2 ** 30)).toBe(false);
    expect(currentBootId()).toBe(currentBootId());
    if (process.platform === 'linux') {
      expect(currentBootId()).toMatch(/^[0-9a-f-]{36}$/);
      expect(real.startOf(process.pid)).toEqual({
        value: expect.any(Number) as number,
        unit: 'ticks',
      });
      // The same process, the same time: a lock of ours is never stale.
      const mine = real.startOf(process.pid)!;
      expect(
        holderIsStale(
          { pid: process.pid, start: mine.value, boot: currentBootId(), acquiredAt: Date.now() },
          real,
        ),
      ).toBe(false);
    }
  });
});
