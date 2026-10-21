/*
 * Starts a real core for the end-to-end tests (playwright.core.config.ts): the
 * core serves the built UI from apps/web/dist on its own origin, with a temporary
 * MONSTERS_HOME and the team (Titan, Rhea, Dione) on the scripted fake provider
 * of `@monsters/providers/testing`. Never used outside the tests: it refuses to
 * start without MONSTERS_E2E=1 and a MONSTERS_HOME under the system temp folder.
 *
 *   MONSTERS_E2E=1 MONSTERS_HOME=/tmp/… MONSTERS_E2E_PORT=4797 node e2e/core/start-core.ts
 */
import { realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  dioneBlueprint,
  orchestratorBlueprint,
  rheaBlueprint,
  startCore,
  writeAgentFolder,
} from '@monsters/core';
import { ProviderRegistry } from '@monsters/providers';
import { FakeProvider } from '@monsters/providers/testing';
import { defineTool } from '@monsters/shared';
import { z } from 'zod';
import { scenario } from './scenario.ts';

const env = process.env;
// Test cores never touch the system keychain (D-042).
env['MONSTERS_SECRETS'] ??= 'file';
const home = env['MONSTERS_HOME'] ? resolve(env['MONSTERS_HOME']) : '';
// Under the temp folder in either spelling (the configs pass its real path, D-148).
const temps = [resolve(tmpdir()), realpathSync.native(tmpdir())].map((t) => t + sep);
if (env['MONSTERS_E2E'] !== '1' || !home || !temps.some((t) => home.startsWith(t))) {
  console.error(
    'start-core.ts is for the e2e tests: set MONSTERS_E2E=1 and a temporary MONSTERS_HOME',
  );
  process.exit(2);
}
const port = Number(env['MONSTERS_E2E_PORT'] ?? 4797);
const dist = fileURLToPath(new URL('../../dist', import.meta.url));

const model = (id: string) => [{ provider: 'fake', model: id }];
const agents = join(home, 'agents');
await writeAgentFolder(
  join(agents, 'titan'),
  orchestratorBlueprint({ user: 'Giulio', models: model('titan') }),
);
await writeAgentFolder(
  join(agents, 'rhea'),
  rheaBlueprint({ user: 'Giulio', models: model('rhea') }),
);
await writeAgentFolder(
  join(agents, 'dione'),
  dioneBlueprint({ user: 'Giulio', models: model('dione') }),
);

/** Offline `web_search` with canned results. */
const webSearch = defineTool({
  name: 'web_search',
  description: 'Searches the web.',
  inputSchema: z.object({ query: z.string() }),
  readOnly: true,
  execute: ({ query }) =>
    Promise.resolve({
      query,
      results: [
        {
          title: 'Encelado - NASA Science',
          url: 'https://science.nasa.gov/saturn/moons/enceladus/',
          snippet: 'Geyser di ghiaccio, un oceano sotto la crosta.',
        },
      ],
    }),
});

const providers = new ProviderRegistry().register(
  new FakeProvider({ id: 'fake', models: scenario }),
);
const core = await startCore({
  home,
  port,
  env: {},
  webDist: dist,
  hub: {
    providers,
    webTools: [webSearch],
    decisionPort: null,
    settings: { watchVault: false, userName: 'Giulio', semanticSearch: false },
  },
});
console.warn(`e2e core ready at ${core.url} (home ${home})`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void core.close().finally(() => {
    // The folder made by playwright.core.config.ts (`monsters-e2e-*/home`) goes away with the core.
    const parent = dirname(home);
    if (basename(parent).startsWith('monsters-e2e-'))
      rmSync(parent, { recursive: true, force: true });
    process.exit(0);
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
