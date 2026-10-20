import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext, ToolError } from '@monsters/shared';
import { afterEach } from 'vitest';

const POSIX = process.platform !== 'win32';
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A temporary folder (real path, long names on Windows as `realpath` gives them), removed after each test. */
export function tempDir(prefix = 'monsters-tools-'): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

/**
 * A tool context like the agent runtime's: `spawn` starts the process in its
 * own group (POSIX) and `stop` kills the whole group, as `ControlScope` does.
 */
export function toolCtx(
  agentId = 'rhea',
  signal: AbortSignal = new AbortController().signal,
): ToolContext {
  return {
    agentId,
    runId: 'run-test',
    signal,
    emit: () => {},
    spawn: (command, args, options) => {
      const child = spawn(command, args, { ...options, detached: POSIX });
      const onAbort = () => void stop();
      const stop = async () => {
        signal.removeEventListener('abort', onAbort);
        if (child.exitCode !== null || child.signalCode !== null) {
          if (POSIX && child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              // group gone
            }
          }
          return;
        }
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        try {
          if (POSIX && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          // already gone
        }
        await exited;
      };
      signal.addEventListener('abort', onAbort, { once: true });
      return { child, stop };
    },
  };
}

/** Runs a tool expecting a `ToolError`; returns it. */
export async function toolError(run: Promise<unknown>): Promise<ToolError> {
  try {
    await run;
  } catch (err) {
    return err as ToolError;
  }
  throw new Error('expected a ToolError');
}
