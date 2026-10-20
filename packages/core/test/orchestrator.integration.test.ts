import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startCore, type CoreServer } from '../src/index.ts';
import { tempHome } from './helpers.ts';

/*
 * Optional end-to-end check of the orchestrator with a real OpenRouter key (free
 * models only): "Rhea, find 3 facts about Enceladus and save them in a note".
 * Skipped without OPENROUTER_API_KEY (or MONSTERS_TEST_ENV_FILE). About 5-10 requests.
 */

function loadKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const file = process.env.MONSTERS_TEST_ENV_FILE;
  if (!file || !existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('OPENROUTER_API_KEY='));
  return (
    line
      ?.slice('OPENROUTER_API_KEY='.length)
      .trim()
      .replace(/^["']|["']$/g, '') || undefined
  );
}

const apiKey = loadKey();
const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
});

describe.skipIf(!apiKey)('orchestrator on OpenRouter free (real key)', () => {
  it(
    'delegates a research to Rhea, who saves a note in the vault',
    { timeout: 420_000 },
    async () => {
      let chatRequests = 0;
      const countingFetch: typeof fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/chat/completions')) chatRequests++;
        return fetch(input, init);
      };
      const core = await startCore({
        home: tempHome(),
        port: 0,
        env: { OPENROUTER_API_KEY: apiKey! },
        hub: {
          fetch: countingFetch,
          settings: {
            watchVault: false,
            userName: 'Giulio',
            // The gate's model is not needed here: save requests.
            decisions: { model: false },
            openrouter: { rpd: 1000 },
          },
        },
      });
      cores.push(core);

      const sent = core.hub.send({
        text: 'Rhea, cerca 3 fatti su Encelado (la luna di Saturno) e salvali in una nota.',
        channel: 'cli',
      });
      const ended = await new Promise<LogEvent<'run'>>((resolve) => {
        const off = core.log.subscribe((e) => {
          if (e.type === 'run' && e.runId === sent.runId && e.data.status !== 'started') {
            off();
            resolve(e);
          }
        });
      });
      const log = core.log.query({ runId: sent.runId, limit: 1000 });
      const usage = log.filter((e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage');
      const changes = log.filter((e): e is LogEvent<'vault_change'> => e.type === 'vault_change');
      const delegations = log.filter((e): e is LogEvent<'delegation'> => e.type === 'delegation');
      const errors = log.filter((e): e is LogEvent<'error'> => e.type === 'error');
      const final = log.findLast(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' && e.agent === 'titan' && !e.data.partial && e.parentId === null,
      );
      const report = {
        status: ended.data.status,
        chatRequests,
        models: [...new Set(usage.map((u) => `${u.agent}:${u.data.model}`))],
        delegations: delegations.map((d) => `${d.data.to}:${d.data.status}`),
        notes: changes.map((c) => `${c.agent}:${c.data.action}:${c.data.path}`),
        errors: errors.map((e) => `${e.data.code ?? ''}: ${e.data.message}`),
        answer: final?.data.text,
      };
      if (process.env.MONSTERS_TEST_REPORT) {
        writeFileSync(process.env.MONSTERS_TEST_REPORT, JSON.stringify(report, null, 2));
      }
      expect(report.status).toBe('completed');
      const note = changes.find((c) => c.agent === 'rhea' && c.data.action === 'create');
      expect(note, JSON.stringify(report)).toBeDefined();
      const text = readFileSync(`${core.hub.vault.root}/${note!.data.path}`, 'utf8');
      expect(text.toLowerCase()).toMatch(/encelad/);
    },
  );
});
