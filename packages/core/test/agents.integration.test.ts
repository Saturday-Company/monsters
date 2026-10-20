import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OpenRouterProvider, ProviderRegistry } from '@monsters/providers';
import type { LogEvent } from '@monsters/shared';
import { createWebFetchTool, createWebSearchTool } from '@monsters/tools';
import { streamText } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCoreServices,
  DEFAULT_FREE_CHAIN,
  parseAgentConfig,
  renderAgentFiles,
  renderAgentsMd,
  rheaBlueprint,
  runAgent,
  type CoreServices,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { parse as parseYaml } from 'yaml';

/*
 * Optional end-to-end check with a real OpenRouter key (free models only).
 * Skipped unless OPENROUTER_API_KEY (or MONSTERS_TEST_ENV_FILE) is set. Uses a handful of requests.
 */

/** The key from the environment, or from a dotenv file named by MONSTERS_TEST_ENV_FILE. */
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
const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

describe.skipIf(!apiKey)('Rhea on OpenRouter free (real key)', () => {
  it('pins the model picked by openrouter/free', { timeout: 120_000 }, async () => {
    const provider = new OpenRouterProvider({ apiKey: apiKey!, freeOnly: true, rpd: 1000 });
    const session = new ProviderRegistry()
      .register(provider)
      .session([{ provider: 'openrouter', model: 'openrouter/free' }]);
    const ask = (prompt: string) =>
      streamText({ model: session, prompt, maxRetries: 0, maxOutputTokens: 400 }).text;
    await ask('Rispondi solo con la parola: uno');
    const pinned = session.pinned;
    expect(pinned?.model).toMatch(/:free$/);
    expect(pinned?.model).not.toBe('openrouter/free');
    await ask('Rispondi solo con la parola: due');
    expect(session.lastServed?.requested).toEqual(pinned);
    if (process.env.MONSTERS_TEST_REPORT) {
      writeFileSync(`${process.env.MONSTERS_TEST_REPORT}.router`, JSON.stringify({ pinned }));
    }
  });

  it('reads a known page with web_fetch and summarises it', { timeout: 240_000 }, async () => {
    const services = createCoreServices({ home: tempHome() });
    opened.push(services);
    services.log.redactor.addSecret(apiKey!);

    let chatRequests = 0;
    const countingFetch: typeof fetch = (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/chat/completions'))
        chatRequests++;
      return fetch(input, init);
    };
    const provider = new OpenRouterProvider({
      apiKey: apiKey!,
      freeOnly: true,
      rpd: 1000,
      fetch: countingFetch,
    });
    const providers = new ProviderRegistry().register(provider);

    const bp = rheaBlueprint({ user: 'Giulio', models: DEFAULT_FREE_CHAIN });
    const files = renderAgentFiles(bp);
    const agent = {
      config: parseAgentConfig({
        ...(parseYaml(files['agent.yaml']) as object),
        limits: { maxSteps: 6, maxOutputTokens: 1500 },
      }),
      instructions: renderAgentsMd(bp),
    };

    const run = services.runs.startRun({ agent: 'rhea', goal: 'Riassunto di una pagina' });
    const result = await runAgent({
      agent,
      task: {
        goal: 'Leggi https://en.wikipedia.org/wiki/Rhea_(moon) con web_fetch e riassumila in 3 frasi in italiano.',
        constraints: [
          'In questa prova non hai strumenti per il vault: rispondi solo con il riassunto.',
          'Una sola chiamata a web_fetch.',
        ],
        doneWhen: 'hai scritto il riassunto',
      },
      tools: [createWebFetchTool({ maxChars: 8000 }), createWebSearchTool()],
      signal: run.signal,
      log: services.log,
      runId: run.id,
      providers,
    });
    run.finish(result.status === 'completed' ? 'completed' : 'failed', result.error);

    const events = services.log.query({ runId: run.id, limit: 1000 });
    const usage = events.filter(
      (e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage',
    );
    const fetches = events.filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result');
    const fallbacks = events.filter(
      (e) => e.type === 'error' && e.data.code === 'provider_fallback',
    );
    const report = JSON.stringify(
      {
        status: result.status,
        steps: result.steps,
        chatRequests,
        models: usage.map((u) => [u.data.requestedModel ?? u.data.model, u.data.model]),
        fallbacks: fallbacks.map((e) => (e.type === 'error' ? e.data.message.slice(0, 160) : '')),
        toolResults: fetches.map((f) => [f.data.tool, f.data.ok, f.data.error]),
        tokens: result.usage,
        summary: result.text,
      },
      null,
      2,
    );
    // Where to write the report (the reporter may hide console output of passing tests).
    if (process.env.MONSTERS_TEST_REPORT) writeFileSync(process.env.MONSTERS_TEST_REPORT, report);
    else console.warn(report);

    expect(result.status).toBe('completed');
    expect(fetches.some((f) => f.data.tool === 'web_fetch' && f.data.ok)).toBe(true);
    expect(result.text.length).toBeGreaterThan(50);
    expect(JSON.stringify(events)).not.toContain(apiKey!);
  });
});
