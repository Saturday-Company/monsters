import { describe, expect, it, vi } from 'vitest';
import { installProcessGuard } from '../src/process-guard.ts';

describe('installProcessGuard (F-M2)', () => {
  it('logs an unhandled rejection as an error event instead of letting it end the process', () => {
    const events: unknown[] = [];
    // Vitest listens to unhandled rejections itself: ours is called directly, as Node would.
    const before = process.listeners('unhandledRejection');
    const guard = installProcessGuard({
      log: { append: (e: unknown) => events.push(e) } as never,
      onStorm: () => {},
    });
    const ours = process.listeners('unhandledRejection').filter((l) => !before.includes(l));
    expect(ours).toHaveLength(1);
    ours[0]!(new Error('SQLITE_BUSY'), Promise.resolve());
    guard.remove();
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        data: { code: 'unhandled_rejection', message: 'SQLITE_BUSY' },
      }),
    ]);
    expect(process.listeners('unhandledRejection')).toEqual(before);
  });

  it('asks to stop when failures keep coming, once; a log that throws goes to stderr', () => {
    const lines: string[] = [];
    let storms = 0;
    const before = process.listeners('uncaughtException');
    const guard = installProcessGuard({
      log: {
        append: () => {
          throw new Error('db closed');
        },
      } as never,
      onStorm: () => storms++,
      stderr: (l) => lines.push(l),
      now: () => 1000,
    });
    const ours = process.listeners('uncaughtException').filter((l) => !before.includes(l))[0]!;
    for (let i = 0; i < 40; i++) ours(new Error('boom'), 'uncaughtException');
    guard.remove();
    expect(storms).toBe(1);
    expect(lines[0]).toBe('uncaught_exception: boom');
  });

  it('after the core closed: still handled, on stderr only, then the handlers go', () => {
    vi.useFakeTimers();
    try {
      const events: unknown[] = [];
      const lines: string[] = [];
      let storms = 0;
      const before = process.listeners('unhandledRejection');
      const guard = installProcessGuard({
        log: { append: (e: unknown) => events.push(e) } as never,
        onStorm: () => storms++,
        stderr: (l) => lines.push(l),
      });
      guard.closed();
      const ours = process.listeners('unhandledRejection').filter((l) => !before.includes(l));
      expect(ours).toHaveLength(1);
      for (let i = 0; i < 40; i++) ours[0]!(new Error('SQLITE_MISUSE'), Promise.resolve());
      expect(events).toEqual([]);
      expect(storms).toBe(0);
      expect(lines[0]).toBe('unhandled_rejection: SQLITE_MISUSE');
      vi.advanceTimersByTime(10_000);
      expect(process.listeners('unhandledRejection')).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
