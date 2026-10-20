/*
 * Node-only helpers (`@monsters/shared/node`), kept out of the main entry that
 * the web UI imports too.
 */
import { prepareNetwork } from './network.ts';
import { applyLoginShellPath } from './path.ts';

export * from './network.ts';
export * from './path.ts';
export * from './runtime.ts';
export * from './tunnel-proof.ts';

/**
 * To call once before the core starts (CLI `start`, desktop app): the PATH of
 * the login shell when started from the desktop; under Electron, no
 * ELECTRON_RUN_AS_NODE in the environment children inherit (an Electron app run
 * by an agent would start as Node). The packaged app's own binary ignores it
 * (RunAsNode fuse off): its JavaScript children run with `nodeRuntime()`.
 * Then the network (network.ts): the system's certificates and the proxy of the environment,
 * before any connection. `network` has one line each for the start log.
 */
export async function prepareCoreProcess(): Promise<{
  pathFromLoginShell: boolean;
  network: string[];
}> {
  const pathFromLoginShell = await applyLoginShellPath();
  if (process.versions['electron'] !== undefined) delete process.env['ELECTRON_RUN_AS_NODE'];
  return { pathFromLoginShell, network: prepareNetwork() };
}
