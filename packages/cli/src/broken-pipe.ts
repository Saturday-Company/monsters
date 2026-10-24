/*
 * `monsters start | tee -a core.log`: when tee or the terminal dies first, the next write to stdout
 * (the last "Stopping...") fails with EPIPE, an `error` event nobody listens to, and Node ends the
 * process on it (D-166). Nobody is reading what the core prints any more: there is nothing to report.
 */

/** The errors of a standard stream whose other end is gone. */
export function isBrokenPipe(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

const seen = new WeakSet<object>();

/**
 * Ignores EPIPE and ERR_STREAM_DESTROYED on the given streams (stdout and stderr by default); any other
 * error is thrown again, as if nobody had listened. Safe to call more than once.
 */
export function ignoreBrokenPipe(
  streams: readonly NodeJS.WritableStream[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    if (seen.has(stream)) continue;
    seen.add(stream);
    stream.on('error', (err: unknown) => {
      if (isBrokenPipe(err)) return;
      throw err;
    });
  }
}
