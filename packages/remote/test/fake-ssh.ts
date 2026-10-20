/**
 * A fake `ssh` for the unit tests, injected as `spawn`. It understands the
 * calls the tunnel makes: `ssh -G`, `ssh-keyscan`, the remote `cat` of
 * server.json and `ssh -N -L …`. For a tunnel that "works" it serves a tiny
 * core health endpoint on the local port, like the real tunnel would.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import { tunnelProof } from '@monsters/shared/node';
import { POSIX_SHELL } from '../src/process.ts';

/** The key of the fake core (its server.json), see `serverJson` in the tests. */
export const FAKE_PROOF_KEY = 'fake-proof-key-0123456789-abcdefghijklmnop';

export interface Call {
  command: string;
  args: string[];
  options: SpawnOptions;
  kind: 'resolve' | 'keyscan' | 'discovery' | 'tunnel';
}

export type TunnelBehavior =
  | {
      serve: true;
      /** The answer to /api/health; a body with `ok: true` gets the proof unless `noProof`. */
      health?: () => { status: number; body: unknown; noProof?: boolean };
      /** Key used for the proof (default FAKE_PROOF_KEY). */
      proofKey?: string;
    }
  | { fail: string; code?: number; afterMs?: number }
  | { hang: true };

export interface FakeSshConfig {
  /** stdout/stderr/code of the remote `cat server.json`. */
  discovery?: () => { stdout?: string; stderr?: string; code: number };
  /** One behavior per tunnel spawn (the last one repeats). */
  tunnels: TunnelBehavior[];
  keyscan?: string;
  resolve?: string;
  /** Spawn error (ENOENT) instead of running. */
  spawnError?: string;
}

export class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = undefined;
  exitCode: number | null = null;
  killed = false;
  private done = false;
  server: Server | null = null;

  exit(code: number | null, stderr = ''): void {
    if (this.done) return;
    this.done = true;
    if (stderr) this.stderr.write(stderr);
    const finish = () => {
      this.exitCode = code;
      this.stdout.end();
      this.stderr.end();
      this.emit('exit', code, code === null ? 'SIGTERM' : null);
      this.emit('close', code, null);
    };
    if (this.server) {
      const s = this.server;
      this.server = null;
      s.closeAllConnections();
      s.close(() => setImmediate(finish));
    } else {
      setImmediate(finish);
    }
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null);
    return true;
  }
}

/** The local end of `-L`: a port of 127.0.0.1 or a Unix socket path. */
export function forwardOf(args: string[]): { local: number | string; remote: number } {
  const spec = args[args.indexOf('-L') + 1] ?? '';
  const tcp = /^127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)$/.exec(spec);
  if (tcp) return { local: Number(tcp[1]), remote: Number(tcp[2]) };
  const unix = /^(\/[^:]+):127\.0\.0\.1:(\d+)$/.exec(spec);
  if (unix) return { local: unix[1]!, remote: Number(unix[2]) };
  throw new Error(`bad -L ${spec}`);
}

export function fakeSsh(config: FakeSshConfig) {
  const calls: Call[] = [];
  const children: FakeChild[] = [];
  let tunnelCount = 0;

  const spawn = (command: string, rawArgs: readonly string[], options: SpawnOptions) => {
    let args = [...rawArgs];
    let cmd = command;
    if (command === POSIX_SHELL) {
      // Unwrap the POSIX guard: sh -c <script> <name> <ssh> <args…>
      cmd = args[3]!;
      args = args.slice(4);
    }
    const child = new FakeChild();
    children.push(child);
    const kind: Call['kind'] = cmd.includes('keyscan')
      ? 'keyscan'
      : args.includes('-G')
        ? 'resolve'
        : args.includes('-L')
          ? 'tunnel'
          : 'discovery';
    calls.push({ command: cmd, args, options, kind });

    if (config.spawnError) {
      setImmediate(() => {
        const err = Object.assign(new Error(`spawn ${cmd} ${config.spawnError}`), {
          code: config.spawnError,
        });
        child.emit('error', err);
        child.emit('close', null, null);
      });
      return child as unknown as ChildProcess;
    }
    // Closing stdin is how the guard stops a tunnel (the POSIX wrapper).
    child.stdin.on('close', () => child.exit(null));

    if (kind === 'resolve') {
      child.stdout.write(config.resolve ?? 'hostname example.test\nport 22\n');
      child.exit(0);
    } else if (kind === 'keyscan') {
      child.stdout.write(config.keyscan ?? '');
      child.exit(config.keyscan ? 0 : 1);
    } else if (kind === 'discovery') {
      const r = config.discovery?.() ?? { code: 1, stderr: 'cat: no such file\n' };
      if (r.stdout) child.stdout.write(r.stdout);
      child.exit(r.code, r.stderr ?? '');
    } else {
      const behavior = config.tunnels[Math.min(tunnelCount, config.tunnels.length - 1)]!;
      tunnelCount += 1;
      if ('fail' in behavior) {
        setTimeout(() => child.exit(behavior.code ?? 255, behavior.fail), behavior.afterMs ?? 5);
      } else if ('serve' in behavior) {
        const { local } = forwardOf(args);
        const server = createServer((req, res) => {
          const h = behavior.health?.() ?? { status: 200, body: { ok: true, version: 'fake' } };
          let body = h.body;
          const nonce = new URL(req.url ?? '/', 'http://x').searchParams.get('proof');
          if (nonce && !h.noProof && (body as { ok?: unknown } | null)?.ok === true) {
            body = {
              ...(body as object),
              proof: tunnelProof(behavior.proofKey ?? FAKE_PROOF_KEY, nonce),
            };
          }
          res.writeHead(h.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        });
        server.on('error', (err) =>
          child.exit(255, `bind: ${err.message}\nCould not request local forwarding.\n`),
        );
        if (typeof local === 'number') server.listen(local, '127.0.0.1');
        else server.listen(local);
        child.server = server;
      }
    }
    return child as unknown as ChildProcess;
  };

  return {
    spawn,
    calls,
    children,
    tunnels: () => calls.filter((c) => c.kind === 'tunnel'),
    /** The live tunnel child, if any. */
    liveTunnel: () => children.filter((c) => c.server !== null).at(-1),
  };
}
