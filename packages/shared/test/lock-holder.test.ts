import { describe, expect, it } from 'vitest';
import {
  BOOT_MARGIN_MS,
  currentBootId,
  currentImageName,
  holderIsStale,
  holderIsStaleAsync,
  LATER_START_MS,
  parseEpochMs,
  parseProcStatStart,
  parsePsStart,
  parseWindowsProcess,
  systemHolderProbes,
  systemHolderProbesAsync,
  windowsProcessScript,
  WINDOWS_BOOT_SCRIPT,
  type HolderProbes,
  type LockHolder,
  type StartTime,
} from '../src/node/index.ts';

const T0 = Date.UTC(2026, 9, 28, 9, 0, 0);

function probes(
  opts: {
    alive?: boolean;
    boot?: string | null;
    start?: StartTime | null;
    bootedAt?: number | null;
  } = {},
): HolderProbes {
  return {
    exists: () => opts.alive ?? true,
    bootId: () => (opts.boot === undefined ? 'boot-1' : opts.boot),
    startOf: () => (opts.start === undefined ? null : opts.start),
    bootedAt: () => opts.bootedAt ?? null,
  };
}

const holder = (extra: Partial<LockHolder> = {}): LockHolder => ({
  pid: 4242,
  start: 777,
  boot: 'boot-1',
  acquiredAt: T0,
  image: null,
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

describe('Windows: no boot id, the process is told by its image and its creation time', () => {
  const win = (value: number, image: string): StartTime => ({ value, unit: 'ms', image });
  const core = (extra: Partial<LockHolder> = {}) =>
    holder({ boot: null, start: T0 - 800, image: 'monsters.exe', ...extra });

  it('a pid taken by another program is stale, whatever its start time', () => {
    // A boot-time service that got the pid of the crashed core started before the lock's
    // `acquiredAt` could be matched by time alone: only the image name tells it.
    expect(holderIsStale(core(), probes({ start: win(T0 - 500, 'svchost.exe') }))).toBe(true);
    expect(holderIsStale(core(), probes({ start: win(T0 - 500, 'Monsters.exe') }))).toBe(false);
    expect(holderIsStale(core({ image: 'node.exe' }), probes({ start: win(T0, 'NODE.EXE') }))).toBe(
      false,
    );
  });

  it('a lock without an image (older core) or a probe without one is judged by the time alone', () => {
    const other = probes({ start: win(T0 - 500, 'svchost.exe') });
    expect(holderIsStale(core({ image: null }), other)).toBe(false);
    expect(holderIsStale(core(), probes({ start: { value: T0 - 500, unit: 'ms' } }))).toBe(false);
    const later = probes({ start: win(T0 + 3_600_000, 'a.exe') });
    expect(holderIsStale(core({ image: null }), later)).toBe(true);
  });

  it('without a start time the boot time of the computer decides, with a wide margin', () => {
    const bootAt = (offset: number) => probes({ start: null, bootedAt: T0 + offset });
    // The lock is older than the boot by far: the computer restarted since.
    expect(holderIsStale(core(), bootAt(BOOT_MARGIN_MS + 1))).toBe(true);
    // Within the margin (a clock corrected after the core started): alive.
    expect(holderIsStale(core(), bootAt(BOOT_MARGIN_MS - 1))).toBe(false);
    expect(holderIsStale(core(), bootAt(-3_600_000))).toBe(false);
    // Nothing known at all: alive.
    expect(holderIsStale(core(), probes({ start: null, bootedAt: null }))).toBe(false);
    // The boot time is not asked of a process whose start time is known.
    const known = probes({ start: win(T0 - 500, 'monsters.exe'), bootedAt: T0 + 1e9 });
    expect(holderIsStale(core(), known)).toBe(false);
  });

  it('the async check gives the same answers, with probes that answer later', async () => {
    const later = (p: HolderProbes) => ({
      exists: (pid: number) => p.exists(pid),
      bootId: () => Promise.resolve(p.bootId()),
      startOf: (pid: number) => Promise.resolve(p.startOf(pid)),
      bootedAt: () => Promise.resolve(p.bootedAt?.() ?? null),
    });
    const cases: [LockHolder, HolderProbes][] = [
      [holder(), probes({ alive: false })],
      [holder(), probes({ boot: 'boot-2' })],
      [core(), probes({ start: win(T0 - 500, 'svchost.exe') })],
      [core(), probes({ start: win(T0 - 500, 'monsters.exe') })],
      [core(), probes({ start: null, bootedAt: T0 + BOOT_MARGIN_MS + 1 })],
      [core(), probes({ start: null })],
    ];
    for (const [h, p] of cases) {
      expect(await holderIsStaleAsync(h, later(p))).toBe(holderIsStale(h, p));
    }
  });

  it('reads what PowerShell prints: epoch milliseconds and the image name', () => {
    expect(parseWindowsProcess('1793178030123 Monsters.exe\r\n')).toEqual({
      start: 1793178030123,
      image: 'Monsters.exe',
    });
    expect(parseWindowsProcess('1793178030123 My App.exe')).toEqual({
      start: 1793178030123,
      image: 'My App.exe',
    });
    // Nothing printed: the process is gone.
    expect(parseWindowsProcess('')).toBeNull();
    expect(parseWindowsProcess('\r\n')).toBeNull();
    // Not an epoch (an error text, a date in the DMTF format).
    expect(parseWindowsProcess('20261028093012.123456+060 node.exe')).toBeNull();
    expect(parseWindowsProcess('Get-CimInstance : Access denied')).toBeNull();
    expect(parseEpochMs('1793178030123\r\n')).toBe(1793178030123);
    expect(parseEpochMs('')).toBeNull();
    expect(parseEpochMs('Wednesday')).toBeNull();
  });

  it('asks CIM, which needs no elevation, and puts only the pid in the script', () => {
    const script = windowsProcessScript(4242);
    expect(script).toContain("Get-CimInstance Win32_Process -Filter 'ProcessId=4242'");
    expect(script).toContain('ToUnixTimeMilliseconds()');
    expect(script).not.toContain('Get-Process');
    expect(windowsProcessScript(4242.9)).toContain("ProcessId=4242'");
    expect(WINDOWS_BOOT_SCRIPT).toContain('Win32_OperatingSystem');
    expect(WINDOWS_BOOT_SCRIPT).toContain('LastBootUpTime');
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
      const self = {
        pid: process.pid,
        start: mine.value,
        boot: currentBootId(),
        acquiredAt: Date.now(),
        image: currentImageName(),
      };
      expect(holderIsStale(self, real)).toBe(false);
    }
  });
});

describe('the real probes that do not block', () => {
  it('say about this process what the blocking ones say', async () => {
    const sync = systemHolderProbes();
    const later = systemHolderProbesAsync();
    expect(later.exists(process.pid)).toBe(true);
    expect(await later.bootId()).toBe(sync.bootId());
    expect(await later.startOf(process.pid)).toEqual(sync.startOf(process.pid));
    expect(await later.startOf(-1)).toBeNull();
    const self: LockHolder = {
      pid: process.pid,
      start: sync.startOf(process.pid)?.value ?? null,
      boot: currentBootId(),
      acquiredAt: Date.now(),
      image: currentImageName(),
    };
    expect(await holderIsStaleAsync(self, later)).toBe(false);
    expect(currentImageName()).toBe(currentImageName()?.toLowerCase());
  });
});
