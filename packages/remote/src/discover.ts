import { z } from 'zod';
import { TunnelError, classifySshFailure } from './errors.ts';
import { DEFAULT_REMOTE_PORT, type ConnectionProfile } from './profile.ts';
import { runCapture, type ProcessDeps } from './process.ts';
import { discoveryArgs, type SshArgOptions } from './ssh-args.ts';

const ServerInfoSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  version: z.string().optional(),
  proofKey: z.string().min(32).max(256).optional(),
});

export interface RemotePort {
  port: number;
  /** The profile's, the `server.json` of a running core, or the default when neither. */
  source: 'profile' | 'server.json' | 'default';
  /**
   * The key the core drew at its start (its `server.json`, 600): the tunnel checks with
   * it that the far end is this core (D-044, M3.6). Null without a readable server.json
   * (`serverInfo` false: the core is off, or another data directory) or with a core too
   * old to have one (`serverInfo` true).
   */
  proofKey: string | null;
  serverInfo: boolean;
}

/** ssh exits with 255 for its own errors, else with the status of the remote command. */
const SSH_FAILURE = 255;

/**
 * Reads the `server.json` of the remote core (`ssh host cat …`) at every connection
 * attempt: the port (the profile's wins, else server.json's, else 4747) and the proof
 * key. Throws a TunnelError when ssh itself fails (host key, auth, network), so the
 * caller handles it like a failure of the tunnel.
 */
export async function discoverRemotePort(
  profile: ConnectionProfile,
  deps: ProcessDeps & {
    sshPath: string;
    sshArgs: SshArgOptions;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<RemotePort> {
  const res = await runCapture(
    deps.sshPath,
    discoveryArgs(profile, deps.sshArgs),
    deps.timeoutMs ?? 20_000,
    deps,
  );
  if (res.error?.code === 'ENOENT') throw new TunnelError('ssh-missing', { cause: res.error });
  if (res.timedOut) throw new TunnelError('unreachable', { detail: res.stderr.trim() });
  if (res.code === SSH_FAILURE) {
    throw new TunnelError(classifySshFailure(res.stderr), { detail: res.stderr.trim() });
  }
  let info: z.infer<typeof ServerInfoSchema> | null = null;
  if (res.code === 0) {
    try {
      info = ServerInfoSchema.parse(JSON.parse(res.stdout));
    } catch {
      // Not a server.json we understand: as if there were none.
    }
  }
  const proofKey = info?.proofKey ?? null;
  if (profile.remotePort !== undefined) {
    return { port: profile.remotePort, source: 'profile', proofKey, serverInfo: info !== null };
  }
  if (info) return { port: info.port, source: 'server.json', proofKey, serverInfo: true };
  // No server.json (core off, other MONSTERS_HOME, a Windows shell on the remote side).
  return { port: DEFAULT_REMOTE_PORT, source: 'default', proofKey: null, serverInfo: false };
}
