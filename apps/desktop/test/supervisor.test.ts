import { EventEmitter } from 'node:events';
import type { DesktopToCoreMessage } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestartBackoff } from '../src/main/backoff.ts';
import { CoreSupervisor, type CoreChild } from '../src/main/supervisor.ts';

describe('restart backoff', () => {
  it('doubles the pause, gives up after the last attempt, forgives a stable run', () => {
    const b = new RestartBackoff();
    expect([0, 0, 0, 0, 0].map((up) => b.onCrash(up)?.delayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000,
    ]);
    expect(b.onCrash(0)).toBeNull();
    b.reset();
    expect(b.onCrash(0)).toEqual({ attempt: 1, delayMs: 1000 });
    expect(b.onCrash(5000)).toEqual({ attempt: 2, delayMs: 2000 });
    // Up for a minute before dying: a new series.
    expect(b.onCrash(60_000)).toEqual({ attempt: 1, delayMs: 1000 });
  });

  it('caps the pause', () => {
    const b = new RestartBackoff({
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      stableAfterMs: 60_000,
    });
    const delays = Array.from({ length: 6 }, () => b.onCrash(0)?.delayMs);
    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
  });
});

class FakeChild extends EventEmitter implements CoreChild {
  static count = 0;
  readonly pid = 1000 + FakeChild.count++;
  readonly sent: DesktopToCoreMessage[] = [];
  killed = 0;
  readonly behaviour: { onStop?: 'exit' | 'hang' };
  constructor(behaviour: { onStop?: 'exit' | 'hang' } = {}) {
    super();
    this.behaviour = behaviour;
  }
  postMessage(m: DesktopToCoreMessage) {
    this.sent.push(m);
    if (m.type === 'stop' && this.behaviour.onStop !== 'hang') queueMicrotask(() => this.exit(0));
    if (m.type === 'login-token') {
      queueMicrotask(() =>
        this.emit('message', { type: 'login-token', id: m.id, token: `t${m.id}`, expiresAt: 1 }),
      );
    }
  }
  kill() {
    this.killed++;
  }
  onMessage(l: (m: unknown) => void) {
    this.on('message', l);
  }
  onExit(l: (code: number) => void) {
    this.on('exit', l);
  }
  ready(url = 'http://127.0.0.1:5000') {
    this.emit('message', {
      type: 'ready',
      url,
      port: 5000,
      home: '/h',
      pid: this.pid,
      version: '0',
      setupCode: null,
    });
  }
  exit(code: number) {
    this.emit('exit', code);
  }
}

describe('core supervisor', () => {
  let children: FakeChild[];
  let behaviour: { onStop?: 'exit' | 'hang' };
  const spawn = () => {
    const c = new FakeChild(behaviour);
    children.push(c);
    return c;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    behaviour = {};
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts, gets ready, hands out login tokens, stops gracefully', async () => {
    const forceKill = vi.fn();
    const s = new CoreSupervisor(spawn, { forceKill });
    const ready = vi.fn();
    s.on('ready', ready);
    s.start();
    expect(s.state).toBe('starting');
    expect(await s.loginToken()).toBeNull();
    children[0]!.ready();
    expect(s.state).toBe('running');
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:5000' }));
    expect(await s.loginToken()).toBe('t1');
    await s.stop();
    expect(s.state).toBe('stopped');
    expect(children[0]!.sent.at(-1)).toEqual({ type: 'stop' });
    expect(children[0]!.killed).toBe(0);
    expect(forceKill).not.toHaveBeenCalled();
  });

  it('restarts a core that dies, with growing pauses, then gives up', async () => {
    const s = new CoreSupervisor(spawn);
    const crashes: number[] = [];
    const failed = vi.fn();
    s.on('crash', (c) => crashes.push(c.delayMs));
    s.on('failed', failed);
    s.start();
    children[0]!.ready();
    for (let i = 0; i < 5; i++) {
      children.at(-1)!.exit(1);
      expect(s.state).toBe('waiting');
      await vi.advanceTimersByTimeAsync(crashes.at(-1)!);
      expect(s.state).toBe('starting');
    }
    children.at(-1)!.exit(1);
    expect(crashes).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(s.state).toBe('failed');
    expect(failed).toHaveBeenCalledWith({ code: 1, attempts: 5 });
    expect(children).toHaveLength(6);
    // "Riprova": a new series.
    s.retry();
    expect(children).toHaveLength(7);
    children.at(-1)!.ready();
    expect(s.state).toBe('running');
  });

  it('kills a core that never gets ready (and counts it as a crash)', async () => {
    const forceKill = vi.fn();
    const s = new CoreSupervisor(spawn, { readyTimeoutMs: 5000, forceKill });
    const crash = vi.fn();
    s.on('crash', crash);
    s.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(children[0]!.killed).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(forceKill).toHaveBeenCalledWith(children[0]!.pid);
    children[0]!.exit(137);
    expect(crash).toHaveBeenCalledWith(expect.objectContaining({ code: 137, attempt: 1 }));
  });

  it('terminates a core that does not stop, then kills it', async () => {
    behaviour.onStop = 'hang';
    const forceKill = vi.fn();
    const s = new CoreSupervisor(spawn, { stopTimeoutMs: 2000, forceKill });
    s.start();
    children[0]!.ready();
    const stopped = s.stop();
    expect(s.stop()).toBe(stopped);
    await vi.advanceTimersByTimeAsync(2000);
    expect(children[0]!.killed).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(forceKill).toHaveBeenCalledWith(children[0]!.pid);
    children[0]!.exit(-1);
    await stopped;
    expect(s.state).toBe('stopped');
  });

  it('does not restart a core refused because another one owns the directory', () => {
    const s = new CoreSupervisor(spawn);
    const refused = vi.fn();
    s.on('start-failed', refused);
    s.start();
    children[0]!.emit('message', { type: 'start-failed', code: 'home_locked', message: 'x' });
    children[0]!.exit(1);
    expect(refused).toHaveBeenCalledWith({ code: 'home_locked', message: 'x' });
    expect(s.state).toBe('failed');
    expect(children).toHaveLength(1);
  });

  it('a stop while waiting to restart cancels the restart', async () => {
    const s = new CoreSupervisor(spawn);
    s.start();
    children[0]!.ready();
    children[0]!.exit(1);
    await s.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
    expect(s.state).toBe('stopped');
  });

  it('checks the core before every start, restarts too: a problem and it does not start (S-M9)', async () => {
    let problem: { code: string; message: string } | null = null;
    const check = vi.fn(() => Promise.resolve(problem));
    const s = new CoreSupervisor(spawn, { check });
    const refused = vi.fn();
    s.on('start-failed', refused);
    s.start();
    expect(children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(1);
    children[0]!.ready();
    // A file of the core changes and the core dies: the restart is checked again.
    problem = { code: 'core_tampered', message: 'resources/core/monsters.js è cambiato' };
    children[0]!.exit(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(1);
    expect(s.state).toBe('failed');
    expect(refused).toHaveBeenCalledWith(problem);
    // "Riprova" with the files back as they were.
    problem = null;
    s.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(2);
    // A stop while checking: nothing starts after it.
    await s.stop();
    s.start();
    await s.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(2);
  });

  it('ignores messages of an old child and garbage', () => {
    const s = new CoreSupervisor(spawn);
    s.start();
    children[0]!.emit('message', 'nope');
    children[0]!.emit('message', { type: 'ready' });
    expect(s.state).toBe('starting');
  });
});
