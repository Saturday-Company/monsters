import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stopChild } from '../src/index.ts';

function fakeChild(pid = 4242) {
  const kills: (string | number | undefined)[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    kill: (sig?: NodeJS.Signals | number) => {
      kills.push(sig);
      return true;
    },
  }) as unknown as ChildProcess;
  return { child, kills };
}

describe('stopChild (F-A8)', () => {
  it('on Windows ends the whole tree first and never signals the main process alone', () => {
    const { child, kills } = fakeChild();
    const calls: string[][] = [];
    stopChild(child, 'SIGINT', { platform: 'win32', taskkill: (a) => calls.push(a) });
    expect(calls).toEqual([['/pid', '4242', '/T', '/F']]);
    expect(kills).toEqual([]);
  });

  it('on Windows falls back to the main process when taskkill fails', () => {
    const { child, kills } = fakeChild();
    stopChild(child, 'SIGKILL', {
      platform: 'win32',
      taskkill: () => {
        throw new Error('no taskkill');
      },
    });
    expect(kills).toEqual(['SIGKILL']);
  });

  it('elsewhere sends the signal', () => {
    const { child, kills } = fakeChild();
    const calls: string[][] = [];
    stopChild(child, 'SIGINT', { platform: 'linux', taskkill: (a) => calls.push(a) });
    expect(kills).toEqual(['SIGINT']);
    expect(calls).toEqual([]);
  });

  it('does nothing for a process that already exited', () => {
    const { child, kills } = fakeChild();
    (child as unknown as { exitCode: number }).exitCode = 0;
    stopChild(child, 'SIGINT', { platform: 'linux' });
    expect(kills).toEqual([]);
  });
});
