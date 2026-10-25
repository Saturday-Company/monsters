import type { MockCore, MockMode } from './mock/core.ts';
import { httpTransport, type Transport } from './transport.ts';

/**
 * Mock mode, only with the Vite dev server (`pnpm dev`): `?mock=1` (or `?mock=fresh`)
 * starts from an empty install, `?mock=demo` from a team with history and an open
 * question. `VITE_MOCK=1|demo` does the same. `?mockSpeed=0.3` makes the scripted
 * replies faster. `?squadra=7` brings the whole roster, `?vita=1` keeps the monsters
 * busy with small jobs, `?anteprima=1` adds a turn of Titan with files and notes to open in
 * the right-hand pane (D-075), `?mockNoise=500` logs a long job after the history (the chats
 * then load their own, W-1). The build served by the core never contains the mock.
 */
export function mockModeFrom(search: string, envFlag: string | undefined): MockMode | null {
  const q = new URLSearchParams(search).get('mock') ?? envFlag ?? null;
  if (!q || q === '0' || q === 'false') return null;
  return q === 'demo' ? 'demo' : q === 'team' ? 'team' : 'fresh';
}

export interface Runtime {
  transport: Transport;
  mock: MockCore | null;
}

export async function createRuntime(): Promise<Runtime> {
  // `import.meta.env.DEV` is a build-time constant: in a production build this
  // branch, and the dynamic import of the mock with it, are removed.
  if (import.meta.env.DEV) {
    const mode = mockModeFrom(
      window.location.search,
      import.meta.env['VITE_MOCK'] as string | undefined,
    );
    if (mode) {
      const { MockCore } = await import('./mock/core.ts');
      const params = new URLSearchParams(window.location.search);
      const speedParam = Number(params.get('mockSpeed'));
      let storage: Storage | null;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = null;
      }
      const mock = new MockCore({
        mode,
        speed: Number.isFinite(speedParam) && speedParam > 0 ? speedParam : 1,
        storage,
        teamSize: params.get('squadra') === '7' ? 7 : 5,
        ambient: params.get('vita') === '1',
        vaultNotes: Math.min(5000, Math.max(0, Number(params.get('mockNotes')) || 0)),
        previewScene: params.get('anteprima') === '1',
        noise: Math.min(5000, Math.max(0, Number(params.get('mockNoise')) || 0)),
      });
      // Dev-only hook for the e2e tests: events "from the agents" (e.g. a note changed meanwhile).
      (window as unknown as { __monstersMock?: MockCore }).__monstersMock = mock;
      return { transport: mock.transport(), mock };
    }
  }
  return { transport: httpTransport(), mock: null };
}
