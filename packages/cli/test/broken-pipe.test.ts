import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeRuntime } from '@monsters/shared/node';
import { afterEach, describe, expect, it } from 'vitest';
import { ignoreBrokenPipe, isBrokenPipe } from '../src/broken-pipe.ts';

// `monsters start | tee -a core.log`, tee dies first: the last "Stopping..." writes to a broken pipe (D-166).

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const errnoError = (code: string) => Object.assign(new Error(`write ${code}`), { code });

describe('ignoreBrokenPipe (D-166)', () => {
  it('knows the errors of a pipe whose other end is gone', () => {
    expect(isBrokenPipe(errnoError('EPIPE'))).toBe(true);
    expect(isBrokenPipe(errnoError('ERR_STREAM_DESTROYED'))).toBe(true);
    expect(isBrokenPipe(errnoError('ENOSPC'))).toBe(false);
    expect(isBrokenPipe(new Error('boom'))).toBe(false);
    expect(isBrokenPipe(null)).toBe(false);
  });

  it('swallows them on the streams and throws every other error again', () => {
    const stream = new EventEmitter() as unknown as NodeJS.WritableStream;
    ignoreBrokenPipe([stream]);
    // Twice: one listener only.
    ignoreBrokenPipe([stream]);
    expect(stream.listenerCount('error')).toBe(1);
    expect(() => stream.emit('error', errnoError('EPIPE'))).not.toThrow();
    expect(() => stream.emit('error', errnoError('ERR_STREAM_DESTROYED'))).not.toThrow();
    expect(() => stream.emit('error', errnoError('ENOSPC'))).toThrow('write ENOSPC');
  });

  it('a process whose stdout reader is gone ends cleanly, and dies without it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'monsters-pipe-'));
    dirs.push(dir);
    const guarded = join(dir, 'guarded.mjs');
    const bare = join(dir, 'bare.mjs');
    const body = `
      process.stdout.write('first\\n');
      await new Promise((r) => setTimeout(r, 600));
      // The reader closed meanwhile: this is the "Stopping..." of the core.
      for (let i = 0; i < 20; i++) process.stdout.write('Stopping...\\n'.repeat(1000));
      await new Promise((r) => setTimeout(r, 300));
      console.error('finished');
    `;
    const source = fileURLOf('../src/broken-pipe.ts');
    writeFileSync(
      guarded,
      `import { ignoreBrokenPipe } from ${JSON.stringify(source)};\nignoreBrokenPipe();\n${body}`,
    );
    writeFileSync(bare, body);
    const runIt = (file: string) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(nodeRuntime()!.command, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
        // tee dies: the read end of the pipe goes away.
        child.stdout.once('data', () => child.stdout.destroy());
        child.on('close', (code) => resolve({ code, stderr }));
      });
    const ok = await runIt(guarded);
    expect(ok.stderr).toContain('finished');
    expect(ok.stderr).not.toContain('EPIPE');
    expect(ok.code).toBe(0);
    const control = await runIt(bare);
    expect(control.code).not.toBe(0);
    expect(control.stderr).toContain('EPIPE');
  });
});

function fileURLOf(relative: string): string {
  return new URL(relative, import.meta.url).href;
}
