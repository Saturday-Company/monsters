import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import {
  ReadBuffer,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/client';

/*
 * MCP over stdio on a process started by the core (`ControlScope.spawn`), not
 * by the SDK: the kill switch reaches the server and its descendants (a
 * browser, for Playwright) through its process group. Newline-delimited
 * JSON-RPC, like the SDK's own stdio transport. stderr is kept (last few KB)
 * to explain a failed start; it is never logged as is.
 */

const STDERR_KEEP = 4000;

export class ChildStdioTransport implements Transport {
  readonly #child: ChildProcess;
  readonly #buffer = new ReadBuffer();
  #stderr = '';
  #closed = false;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(child: ChildProcess) {
    this.#child = child;
  }

  /** Last lines the server wrote on stderr (for error messages; redact before showing). */
  get stderr(): string {
    return this.#stderr;
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  start(): Promise<void> {
    const child = this.#child;
    return new Promise((resolve, reject) => {
      let started = child.pid !== undefined;
      child.once('error', (err) => {
        if (!started) reject(err);
        this.onerror?.(err);
        this.#finish();
      });
      child.once('close', () => this.#finish());
      child.stdin?.on('error', (err) => this.onerror?.(err));
      child.stdout?.on('error', (err) => this.onerror?.(err));
      child.stdout?.on('data', (chunk: Buffer) => {
        try {
          this.#buffer.append(chunk);
        } catch (err) {
          // A message larger than the buffer: the stream cannot be trusted any more.
          this.onerror?.(err as Error);
          void this.close();
          return;
        }
        for (;;) {
          let message: JSONRPCMessage | null;
          try {
            message = this.#buffer.readMessage();
          } catch (err) {
            // A line that is not JSON-RPC (a server printing on stdout): skip it.
            this.onerror?.(err as Error);
            continue;
          }
          if (message === null) break;
          this.onmessage?.(message);
        }
      });
      const stderrDecoder = new StringDecoder('utf8');
      child.stderr?.on('data', (chunk: Buffer) => {
        this.#stderr = (this.#stderr + stderrDecoder.write(chunk)).slice(-STDERR_KEEP);
      });
      if (started) resolve();
      else
        child.once('spawn', () => {
          started = true;
          resolve();
        });
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.#child.stdin;
      if (this.#closed || !stdin || stdin.destroyed) {
        reject(new Error('the MCP server is not running'));
        return;
      }
      if (stdin.write(serializeMessage(message))) resolve();
      else stdin.once('drain', () => resolve());
    });
  }

  /** Ends stdin: a well-behaved server exits; the scope stops it otherwise. */
  close(): Promise<void> {
    try {
      this.#child.stdin?.end();
    } catch {
      // already gone
    }
    this.#finish();
    return Promise.resolve();
  }

  #finish(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#buffer.clear();
    this.onclose?.();
  }
}
