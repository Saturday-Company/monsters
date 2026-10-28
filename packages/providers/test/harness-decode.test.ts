import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { collectStderr, readLines, runOnce } from '../src/harness/common.ts';

/*
 * Review of 28/10: the output of Claude Code and Codex was decoded chunk by chunk, so an accent
 * whose two bytes arrived in different chunks became two U+FFFD. The bytes of "é" are C3 A9.
 */

const LINE = '{"text":"perché è già così"}\n';

/** The text as bytes, cut right after the first byte of every multibyte character. */
function splitInsideCharacters(text: string): Buffer[] {
  const bytes = Buffer.from(text, 'utf8');
  const parts: Buffer[] = [];
  let from = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i]! >= 0xc0) {
      parts.push(bytes.subarray(from, i + 1));
      from = i + 1;
    }
  }
  parts.push(bytes.subarray(from));
  return parts;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('harness output decoding', () => {
  it('readLines keeps a character cut between two chunks whole', async () => {
    const stream = new PassThrough();
    const chunks = splitInsideCharacters(LINE + LINE);
    expect(chunks.length).toBeGreaterThan(8);
    const read = (async () => {
      const lines: string[] = [];
      for await (const line of readLines(stream)) lines.push(line);
      return lines;
    })();
    for (const chunk of chunks) {
      stream.write(chunk);
      await tick();
    }
    stream.end();
    const lines = await read;
    expect(lines).toEqual(['{"text":"perché è già così"}', '{"text":"perché è già così"}']);
    expect(lines.join('')).not.toContain('�');
  });

  it('readLines still yields a last line without a newline', async () => {
    const stream = new PassThrough();
    stream.end(Buffer.from('ultima è', 'utf8'));
    const lines: string[] = [];
    for await (const line of readLines(stream)) lines.push(line);
    expect(lines).toEqual(['ultima è']);
  });

  it('collectStderr keeps the accents of an error message', async () => {
    const stderr = new PassThrough();
    const read = collectStderr({ stderr } as unknown as ChildProcess);
    for (const chunk of splitInsideCharacters('errore: già così\n')) {
      stderr.write(chunk);
      await tick();
    }
    expect(read()).toBe('errore: già così');
  });

  it('runOnce decodes the output of a real process written in pieces', async () => {
    const script =
      "const b = Buffer.from('perché\\n'); process.stdout.write(b.subarray(0, 5));" +
      'setTimeout(() => process.stdout.write(b.subarray(5)), 80);';
    const result = await runOnce(
      { command: process.execPath, args: ['-e', script], source: 'path' },
      [],
      {
        env: process.env as Record<string, string>,
      },
    );
    expect(result.stdout).toBe('perché\n');
  });
});
