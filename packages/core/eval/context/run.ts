import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LogEvent } from '@monsters/shared';
import { startCore } from '../../src/index.ts';
import { ANTEIKU_DATA, startFakeAnteiku } from '../../test/fixtures/fake-anteiku-server.ts';
import { PROFILE_ANSWERS } from '../cases.ts';

/*
 * The context of a long run with a big MCP server (C.2, D-075; not part of CI):
 * the capo squadra on a real OpenRouter model works on a fake Anteiku (124
 * tools, long lists) to find a client, read lists and create a task. Per
 * run: steps, input tokens per step and in all, the tools' share of the first
 * request, peak context against the model's window, cost, and whether the
 * right task was created (the fake server saw `anteiku_task_crea` with the
 * project "Sito web Rossi").
 *
 *   node eval/context/run.ts --label dopo --model openai/gpt-oss-20b --times 2
 *
 * Paid models with OPENROUTER_PAID_API_KEY of the repo's .env (`--key-name`),
 * `--cap` stops before going over a spending cap (default 0.30 $). To measure
 * "before", copy this file and the fixture into a checkout of the old commit.
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    model: { type: 'string', default: 'openai/gpt-oss-20b' },
    'key-name': { type: 'string', default: 'OPENROUTER_PAID_API_KEY' },
    env: { type: 'string' },
    times: { type: 'string', default: '1' },
    cap: { type: 'string', default: '0.30' },
    out: { type: 'string', default: join(here, 'results') },
    'timeout-s': { type: 'string', default: '420' },
  },
});

const TASK =
  'In Anteiku: fammi prima un riepilogo dei clienti attivi di Milano (guarda l’elenco completo dei clienti), ' +
  'poi trova il cliente Rossi e guarda le task già aperte del suo progetto «Sito web Rossi». ' +
  'Infine crea in quel progetto la task «Chiamare Rossi per la revisione» con scadenza 2026-11-20. ' +
  'Rispondi con il riepilogo e l’id della task creata.';

/** The project the task must go in. */
const PROJECT = ANTEIKU_DATA.progetti.find((p) => p.nome === 'Sito web Rossi')!.id;

function loadKey(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const file = args.env ?? process.env.MONSTERS_EVAL_ENV_FILE ?? resolve(here, '../../../../.env');
  const fallback = resolve(here, '../../../../../../../.env');
  const path = existsSync(file) ? file : fallback;
  if (!existsSync(path)) throw new Error(`no ${name} and no env file at ${file}`);
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  const key = line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!key) throw new Error(`${name} missing in ${path}`);
  return key;
}

interface Row {
  label: string;
  model: string;
  status: string;
  success: boolean;
  steps: number;
  inputPerStep: number[];
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Tokens of the tool definitions in the first request (estimate scaled to the real input). */
  firstTools: number;
  /** Highest context of a step over the model's window, in %. */
  peakContextPct: number | null;
  window: number | null;
  tools: string[];
  errors: string[];
  answer: string;
}

async function once(key: string, n: number): Promise<Row> {
  const base = mkdtempSync(join(tmpdir(), 'monsters-context-'));
  const fa = await startFakeAnteiku();
  const model = { provider: 'openrouter', model: args.model };
  const core = await startCore({
    home: join(base, 'home'),
    port: 0,
    env: { OPENROUTER_API_KEY: key },
    webDist: false,
    hub: {
      onboardingGenerate: null,
      teamModels: [model],
      settings: { watchVault: false, openrouter: { freeOnly: false } },
    },
  });
  const { hub, log } = core;
  try {
    await hub.onboarding.submit({
      answers: PROFILE_ANSWERS,
      permissions: { vault: true, web: true },
    });
    const state = await hub.onboarding.propose();
    await hub.onboarding.confirm({
      members: (state.proposal?.members ?? []).map((m) => ({ id: m.id })),
    });
    const capo = hub.team.orchestrator()!;
    await hub.mcp.upsert(
      'anteiku',
      {
        transport: 'http',
        url: fa.mcpUrl,
        label: 'Anteiku',
        catalog: 'anteiku',
        headers: { Authorization: `Bearer ${fa.personalToken}` },
        agents: [capo.config.id],
      },
      'cli',
    );
    hub.newConversation({ channel: 'cli' });
    const sent = hub.send({ text: TASK, channel: 'cli' });
    const runId = sent.runId;
    await new Promise<void>((done) => {
      const timer = setTimeout(
        () => void core.runs.killRun(runId, { by: 'cli', reason: 'eval timeout' }),
        Number(args['timeout-s']) * 1000,
      );
      const off = log.subscribe((e) => {
        if (e.runId !== runId) return;
        if (e.type === 'question') {
          const first = e.data.options[0];
          setTimeout(() => {
            try {
              hub.answer(
                e.data.questionId,
                first ? { optionId: e.data.recommended ?? first.id } : { text: 'Decidi tu.' },
                'cli',
              );
            } catch {
              // already closed
            }
          }, 300);
        }
        if (e.type === 'run' && e.data.status !== 'started') {
          clearTimeout(timer);
          off();
          done();
        }
      });
    });
    await hub.dispatcher.idle();
    const events = log.query({ runId, limit: 5000 });
    const usage = events.filter(
      (e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage',
    );
    const run = events.find(
      (e): e is LogEvent<'run'> => e.type === 'run' && e.data.status !== 'started',
    );
    const finals = events.filter(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' &&
        e.agent === capo.config.id &&
        e.data.role === 'agent' &&
        !e.data.partial &&
        e.parentId === null,
    );
    const created = fa.calls.find(
      (c) =>
        c.tool === 'anteiku_task_crea' &&
        c.args['progetto_id'] === PROJECT &&
        typeof c.args['titolo'] === 'string' &&
        /chiamare rossi/i.test(c.args['titolo']),
    );
    const contexts = usage.flatMap((u) => (u.data.context ? [u.data.context] : []));
    const windowOf = contexts.find((c) => c.window)?.window ?? null;
    const peak = contexts.reduce(
      (m, c) => (c.window ? Math.max(m, (100 * c.total) / c.window) : m),
      0,
    );
    const row: Row = {
      label: args.label,
      model: args.model,
      status: run?.data.status ?? '?',
      success: created !== undefined,
      steps: usage.length,
      inputPerStep: usage.map((u) => u.data.inputTokens ?? 0),
      inputTokens: usage.reduce((s, u) => s + (u.data.inputTokens ?? 0), 0),
      cachedTokens: usage.reduce(
        (s, u) => s + ((u.data as { cachedInputTokens?: number }).cachedInputTokens ?? 0),
        0,
      ),
      outputTokens: usage.reduce((s, u) => s + (u.data.outputTokens ?? 0), 0),
      costUsd: usage.reduce((s, u) => s + (u.data.costUsd ?? 0), 0),
      firstTools: contexts[0]?.parts.tools ?? 0,
      peakContextPct: windowOf ? Number(peak.toFixed(1)) : null,
      window: windowOf,
      tools: events
        .filter((e): e is LogEvent<'tool_call'> => e.type === 'tool_call')
        .map((e) => e.data.tool.replace('mcp__anteiku__', 'A:')),
      errors: events
        .filter((e): e is LogEvent<'error'> => e.type === 'error')
        .map((e) => `${e.data.code}: ${e.data.message.slice(0, 200)}`),
      answer: finals.at(-1)?.data.text ?? '',
    };
    process.stdout.write(
      `#${n} ${row.success ? '✓' : '✗'} ${row.status} passi ${row.steps}, in ${row.inputTokens} (${row.inputPerStep.join(' ')}), strumenti al primo ${row.firstTools}, picco ${row.peakContextPct ?? '?'}% di ${row.window ?? '?'}, $${row.costUsd.toFixed(4)}\n   ${row.tools.join(', ')}\n${row.errors.map((x) => `   ! ${x}\n`).join('')}`,
    );
    return row;
  } finally {
    await core.close();
    await fa.close();
    rmSync(base, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const key = loadKey(args['key-name']);
  const cap = Number(args.cap);
  const rows: Row[] = [];
  for (let i = 1; i <= Number(args.times); i++) {
    const spent = rows.reduce((s, r) => s + r.costUsd, 0);
    if (spent >= cap) {
      process.stdout.write(`tetto di ${cap} $ raggiunto: mi fermo\n`);
      break;
    }
    rows.push(await once(key, i));
  }
  const avg = (k: 'steps' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'firstTools') =>
    rows.length ? rows.reduce((s, r) => s + r[k], 0) / rows.length : 0;
  const summary = {
    label: args.label,
    model: args.model,
    runs: rows.length,
    success: rows.filter((r) => r.success).length,
    steps: avg('steps'),
    inputTokens: Math.round(avg('inputTokens')),
    firstTools: Math.round(avg('firstTools')),
    peakContextPct: Math.max(...rows.map((r) => r.peakContextPct ?? 0)),
    costUsd: Number(rows.reduce((s, r) => s + r.costUsd, 0).toFixed(5)),
  };
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(args.out, `${args.label}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  process.stdout.write(`\n${JSON.stringify(summary)}\nRisultati: ${file}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
