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
      title: 'la ricercatrice',
      role: 'trova idee e dati per i post dei ristoranti',
      mission: 'cerchi tendenze e idee sul food e le trasformi in note con fonti',
      context: 'Giulio segue tre ristoranti e vuole pubblicare con costanza.',
      duties: ['Controlli sempre la data delle fonti.'],
      area: 'Risorse/Ricerche',
      tools: ['web'],
    },
    {
      name: 'Dione',
      title: 'la copywriter',
      role: 'scrive post e didascalie pronti da pubblicare',
      mission: 'scrivi post e didascalie nel tono dei ristoranti',
      context: 'Giulio vuole testi diretti, pronti da usare.',
      duties: ['Proponi sempre due varianti.'],
      area: 'Progetti/Social',
      tools: [],
    },
    {
      name: 'Tethys',
      title: 'il pianificatore',
      role: 'tiene il calendario editoriale e le scadenze',
      mission: 'organizzi il calendario editoriale dei ristoranti',
      context: 'Giulio pubblica per tre ristoranti ogni settimana.',
      duties: ['Tieni un piano settimanale per ristorante.'],
      area: 'Progetti/Calendario',
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
      if (prompt.includes('Progetti la squadra')) {
        // The first answer is not valid: the core retries with the errors.
        return proposals++ === 0
          ? fake.text('Certo! Ecco la squadra: Rhea, Dione e Tethys.')
          : fake.text(JSON.stringify(TEAM), { chunkSize: 40 });
      }
      return fake.text('Ciao Giulio! Ci sono, dimmi pure.', { chunkSize: 8, delayMs: 20 });
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
