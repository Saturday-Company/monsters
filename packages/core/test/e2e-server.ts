/*
 * A real core for the end-to-end tests of the web UI (apps/web/playwright.core.config.ts):
 * empty home, fake model provider, offline web tools. The team proposal gets a
 * JSON team; every agent run gets a short reply.
 *
 *   MONSTERS_E2E_HOME=<dir> MONSTERS_E2E_PORT=4791 MONSTERS_E2E_ORIGIN=http://127.0.0.1:5181 \
 *     node packages/core/test/e2e-server.ts
 */
import { ProviderRegistry } from '@monsters/providers';
import { FakeProvider, fake, type FakeCall } from '@monsters/providers/testing';
import { startCore } from '../src/index.ts';

const home = process.env['MONSTERS_E2E_HOME'];
// Test cores never touch the system keychain (D-042).
process.env['MONSTERS_SECRETS'] ??= 'file';
const port = Number(process.env['MONSTERS_E2E_PORT'] ?? 4791);
const origin = process.env['MONSTERS_E2E_ORIGIN'] ?? 'http://127.0.0.1:5181';
if (!home) throw new Error('MONSTERS_E2E_HOME is required');

const TEAM = {
  agents: [
    {
      name: 'Rhea',
      title: 'the researcher',
      role: 'finds ideas and data for the restaurants’ posts',
      mission: 'you look for food trends and ideas and turn them into notes with sources',
      context: 'Giulio follows three restaurants and wants to publish consistently.',
      duties: ['You always check the date of the sources.'],
      area: 'Resources/Research',
      tools: ['web'],
    },
    {
      name: 'Dione',
      title: 'the copywriter',
      role: 'writes posts and captions ready to publish',
      mission: 'you write posts and captions in the restaurants’ tone',
      context: 'Giulio wants direct texts, ready to use.',
      duties: ['You always offer two versions.'],
      area: 'Projects/Social',
      tools: [],
    },
    {
      name: 'Tethys',
      title: 'the planner',
      role: 'keeps the editorial calendar and the deadlines',
      mission: 'you organise the restaurants’ editorial calendar',
      context: 'Giulio publishes for three restaurants every week.',
      duties: ['You keep a weekly plan for each restaurant.'],
      area: 'Projects/Calendar',
      tools: [],
      look: { shape: 'dome', eyes: 'trio' },
    },
  ],
};

let proposals = 0;
const provider = new FakeProvider({
  models: {
    team: (call: FakeCall) => {
      const prompt = JSON.stringify(call.options.prompt);
      // The system prompt of the team proposal, in either family (D-153).
      if (prompt.includes('Progetti la squadra') || prompt.includes('You design the squad')) {
        // The first answer is not valid: the core retries with the errors.
        return proposals++ === 0
          ? fake.text('Sure! Here’s the squad: Rhea, Dione and Tethys.')
          : fake.text(JSON.stringify(TEAM), { chunkSize: 40 });
      }
      return fake.text('Hi Giulio! I’m here, tell me.', { chunkSize: 8, delayMs: 20 });
    },
  },
});

const core = await startCore({
  home,
  port,
  // Only the language of a fresh home (D-153), from the Playwright config.
  env: process.env['MONSTERS_LANG'] ? { MONSTERS_LANG: process.env['MONSTERS_LANG'] } : {},
  allowedOrigins: [origin, `http://127.0.0.1:${port}`],
  hub: {
    providers: new ProviderRegistry().register(provider),
    teamModels: [{ provider: 'fake', model: 'team' }],
    webTools: [],
    decisionPort: null,
    settings: { watchVault: false, semanticSearch: false },
  },
});
process.stdout.write(`e2e core on ${core.url}\n`);

const stop = () => {
  void core.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
