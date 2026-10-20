import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider } from '@monsters/providers/testing';
import {
  dioneBlueprint,
  orchestratorBlueprint,
  rheaBlueprint,
  startCore,
  writeAgentFolder,
} from '../../src/index.ts';

/*
 * What the orchestrator's first step costs (D-098, not part of CI): the
 * system prompt and the tool definitions it sends, estimated as the context
 * meter does (D-076: 3.6 characters per token of prose, 3.1 of JSON, 4 per
 * tool), with one project active. Then the same after `tools_search` loaded
 * the tools of the projects and the automations: what they would cost if
 * they were always sent. Fake provider, no network, no key.
 *
 *   node eval/projects/measure.ts
 */

const PROSE = 3.6;
const JSON_CHARS = 3.1;

interface SentTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const tok = (s: string, c = PROSE) => (s.length === 0 ? 0 : Math.ceil(s.length / c));

function toolTokens(t: SentTool): number {
  return (
    tok(t.name) +
    tok(t.description ?? '') +
    tok(JSON.stringify(t.inputSchema ?? {}), JSON_CHARS) +
    4
  );
}

function systemOf(prompt: unknown): string {
  const list = prompt as { role: string; content: unknown }[];
  return list
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'monsters-measure-'));
  const home = join(base, 'home');
  const model = (id: string) => [{ provider: 'fake', model: id }];
  await writeAgentFolder(
    join(home, 'agents', 'titan'),
    orchestratorBlueprint({ user: 'Giulio', models: model('titan') }),
  );
  await writeAgentFolder(
    join(home, 'agents', 'rhea'),
    rheaBlueprint({ user: 'Giulio', models: model('rhea') }),
  );
  await writeAgentFolder(
    join(home, 'agents', 'dione'),
    dioneBlueprint({ user: 'Giulio', models: model('dione') }),
  );
  const provider = new FakeProvider({
    models: {
      titan: [
        fake.text('Ciao!'),
        fake.toolCall('tools_search', { query: 'progetto' }),
        fake.toolCall('tools_search', { query: 'automazione' }),
        fake.text('Fatto.'),
      ],
    },
  });
  const core = await startCore({
    home,
    port: 0,
    env: {},
    webDist: false,
    hub: {
      providers: new ProviderRegistry().register(provider),
      decisionPort: null,
      settings: { watchVault: false, userName: 'Giulio' },
    },
  });
  try {
    const { hub } = core;
    await hub.projects.create({ name: 'Lumen', lead: { name: 'Leda' } }, 'cli');
    const wait = async (runId: string) => {
      for (;;) {
        const end = core.log
          .query({ runId, type: 'run' })
          .find((e) => e.type === 'run' && e.data.status !== 'started');
        if (end) return;
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await wait(hub.send({ text: 'ciao', channel: 'cli' }).runId);
    await wait(hub.send({ text: 'carica gli strumenti', channel: 'cli' }).runId);
    const calls = provider.callsTo('titan');
    const row = (i: number) => {
      const tools = (calls[i]!.options.tools ?? []) as SentTool[];
      const system = systemOf(calls[i]!.options.prompt);
      const byName = Object.fromEntries(tools.map((t) => [t.name, toolTokens(t)]));
      const toolsTotal = tools.reduce((n, t) => n + toolTokens(t), 0);
      return {
        tools: tools.length,
        toolsTokens: toolsTotal,
        systemTokens: tok(system),
        total: toolsTotal + tok(system),
        byName,
      };
    };
    const first = row(0);
    const loaded = row(calls.length - 1);
    const pick = (r: ReturnType<typeof row>, names: string[]) =>
      Object.fromEntries(names.map((n) => [n, r.byName[n] ?? 0]));
    const names = [
      'project_propose',
      'automation_propose',
      'project_send',
      'project_status',
      'tools_search',
      'team_propose_monster',
    ];
    process.stdout.write(
      `${JSON.stringify(
        {
          firstStep: { ...first, byName: pick(first, names) },
          afterLoading: { ...loaded, byName: pick(loaded, names) },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await core.close();
    rmSync(base, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
