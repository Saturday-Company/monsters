import { createServer } from 'node:net';

/** Binds 127.0.0.1:<port> for a moment: 0 asks the system for a free port. */
function tryBind(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : null;
      server.close(() => resolve(bound));
    });
  });
}

export async function isLocalPortFree(port: number): Promise<boolean> {
  return (await tryBind(port)) === port;
}

/**
 * The local port of the tunnel: `preferred` when free (the same port as the
 * remote core means no Origin rewrite, D-044), else one chosen by the system.
 * ssh binds it a moment later: if someone takes it in between, ssh fails with
 * `forward-failed` and the next attempt picks another one.
 */
export async function pickLocalPort(preferred?: number): Promise<number> {
  if (preferred !== undefined && (await isLocalPortFree(preferred))) return preferred;
  const port = await tryBind(0);
  if (port === null) throw new Error('no free local port');
  return port;
}
