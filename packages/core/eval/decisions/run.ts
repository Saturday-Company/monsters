import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ProviderRegistry, type ModelRef } from '@monsters/providers';
import { DEFAULT_FREE_CHAIN } from '../../src/agents/archetypes.ts';
import { LlmDecisionPort, type DecisionPort } from '../../src/team/decision.ts';
import { JevDecisionPort, JEV_DEFAULT_MODEL } from '../../src/team/jev.ts';
import { configureOpenRouter } from '../../src/team/openrouter-key.ts';
import {
  CachingPort,
  loadCasesFromFile,
  RecordedPort,
  loadCasesFromHome,
  loadLabeledCases,
  replayCases,
  summarize,
  type DecisionCase,
  type ReplayMode,
  type ReplayReport,
} from './replay.ts';

/*
 * Offline measure of the DecisionGate's System 1 (M2.9, D-037). Not part of CI.
 *
 *   pnpm --filter @monsters/core eval:decisions                       # labelled set, Jev and LLM
 *   pnpm --filter @monsters/core eval:decisions --home ~/.monsters --engine jev
 *   pnpm --filter @monsters/core eval:decisions --file export.json --mode port
 *   pnpm --filter @monsters/core eval:decisions --dry-run             # cases only, no calls
 *   pnpm --filter @monsters/core eval:decisions --rescore eval/results/decisions-….json
 *                                     # the gate again on answers recorded earlier: no calls
 *
 * Sources: `--home` (the log of a MONSTERS_HOME, read-only; repeatable),
 * `--file` (cases or log events in JSON; repeatable), `--labeled` (the hand
 * set in `etichettate.json`: the default when no source is given).
 * Keys: TYPESAFE_API_KEY and OPENROUTER_API_KEY from the environment or from
 * `--env` (default: the repository's `.env`). Results: a table on stdout and a
 * JSON in eval/results/decisions-<label>-<time>.json.
 */

const RESULTS = resolve(import.meta.dirname, '..', 'results');

const { values: args } = parseArgs({
  options: {
    home: { type: 'string', multiple: true },
    file: { type: 'string', multiple: true },
    labeled: { type: 'boolean' },
    engine: { type: 'string', default: 'jev,llm' },
    mode: { type: 'string', default: 'gate,port' },
    'jev-model': { type: 'string', default: JEV_DEFAULT_MODEL },
    'jev-base-url': { type: 'string' },
    'jev-timeout-ms': { type: 'string', default: '8000' },
    /** Small LLM models, `provider:model` comma-separated. Default: the free chain. */
    'llm-models': { type: 'string' },
    threshold: { type: 'string', default: '0.8' },
    /** Most calls to the port per engine (OpenRouter free: 50 requests a day). */
    'max-calls': { type: 'string', default: '100' },
    limit: { type: 'string' },
    env: { type: 'string' },
    label: { type: 'string', default: 'run' },
    'dry-run': { type: 'boolean' },
    /** Results of an earlier run: its recorded answers replace the engines (no keys, no calls). */
    rescore: { type: 'string' },
  },
});

const out = (s = '') => process.stdout.write(`${s}\n`);

function readEnvFile(): Record<string, string> {
  const file = args.env ?? resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(file)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) vars[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return vars;
}

function key(name: string, fileVars: Record<string, string>): string | null {
  return process.env[name]?.trim() || fileVars[name]?.trim() || null;
}

function loadCases(): DecisionCase[] {
  const cases: DecisionCase[] = [];
  for (const home of args.home ?? []) cases.push(...loadCasesFromHome(home));
  for (const file of args.file ?? []) cases.push(...loadCasesFromFile(file));
  if (args.labeled || (!args.home?.length && !args.file?.length)) {
    cases.push(...loadLabeledCases());
  }
  const limit = args.limit ? Number(args.limit) : undefined;
  return limit ? cases.slice(0, limit) : cases;
}

function parseModels(spec: string | undefined): ModelRef[] {
  if (!spec) return DEFAULT_FREE_CHAIN;
  return spec.split(',').map((s) => {
    const i = s.indexOf(':');
    if (i <= 0) throw new Error(`--llm-models: "${s}" is not provider:model`);
    return { provider: s.slice(0, i), model: s.slice(i + 1) };
  });
}

/** Stops calling the port after `max` calls: the remaining cases count as failures. */
class CappedPort implements DecisionPort {
  readonly id: string;
  #left: number;
  readonly #inner: DecisionPort;
  constructor(inner: DecisionPort, max: number) {
    this.#inner = inner;
    this.id = inner.id;
    this.#left = max;
  }
  decide(...a: Parameters<DecisionPort['decide']>) {
    if (this.#left <= 0) return Promise.reject(new Error('--max-calls reached'));
    this.#left--;
    return this.#inner.decide(...a);
  }
}

function buildPort(engine: string, fileVars: Record<string, string>): DecisionPort {
  if (engine === 'jev') {
    const k = key('TYPESAFE_API_KEY', fileVars);
    if (!k) throw new Error('TYPESAFE_API_KEY missing (environment or --env)');
    return new JevDecisionPort({
      key: k,
      model: args['jev-model'],
      timeoutMs: Number(args['jev-timeout-ms']),
      ...(args['jev-base-url'] ? { baseURL: args['jev-base-url'] } : {}),
    });
  }
  if (engine === 'llm') {
    const k = key('OPENROUTER_API_KEY', fileVars);
    if (!k) throw new Error('OPENROUTER_API_KEY missing (environment or --env)');
    const providers = new ProviderRegistry();
    configureOpenRouter(providers, k, { freeOnly: true }, null);
    return new LlmDecisionPort({ providers, models: parseModels(args['llm-models']) });
  }
  throw new Error(`unknown engine ${engine}: use jev or llm`);
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const num = (v: number | null, digits = 3) => (v === null ? '–' : v.toFixed(digits));

function row(engine: string, mode: string, r: ReplayReport): string {
  return [
    engine.padEnd(6),
    mode.padEnd(5),
    String(r.cases).padStart(5),
    `${r.asked}/${r.proceeded}`.padStart(8),
    `${r.expected.correct}/${r.expected.n} ${pct(r.expected.correct, r.expected.n)}`.padStart(13),
    String(r.expected.wrongProceed).padStart(8),
    String(r.expected.needlessAsk).padStart(8),
    `${r.userChoice.optionAgree}/${r.userChoice.optionN}`.padStart(8),
    `${r.userChoice.proceededWrong}`.padStart(8),
    num(r.calibration.needsUser.brier).padStart(7),
    num(r.calibration.needsUser.ece).padStart(7),
    `${r.failures}/${r.modelAsked}`.padStart(8),
    `$${r.cost.costUsd.toFixed(5)}`.padStart(10),
    String(r.cost.inputTokens).padStart(8),
    (r.latencyMs.p50 === null ? '–' : `${Math.round(r.latencyMs.p50)}`).padStart(7),
  ].join(' ');
}

const HEADER = [
  'motore',
  'modo ',
  ' casi',
  'chi/proc',
  '  attese ok',
  'proc-err',
  'chi-inut',
  ' opz=ut',
  'proc≠ut',
  '  Brier',
  '    ECE',
  'err/mod',
  '     costo',
  '  tok-in',
  ' p50 ms',
].join(' ');

async function main(): Promise<void> {
  const cases = loadCases();
  const engines = args.rescore
    ? ['jev']
    : args.engine
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
  const modes = args.mode.split(',').map((m) => m.trim()) as ReplayMode[];
  for (const m of modes)
    if (m !== 'gate' && m !== 'port') throw new Error(`unknown mode ${String(m)}`);
  const bySource = Object.groupBy(cases, (c) => c.source);
  out(
    `${cases.length} casi (${Object.entries(bySource)
      .map(([s, l]) => `${s}: ${l?.length ?? 0}`)
      .join(', ')}); con etichetta chiedi/procedi ${cases.filter((c) => c.expected).length}, ` +
      `con scelta dell'utente ${cases.filter((c) => c.userChoice !== undefined).length}`,
  );
  if (args['dry-run']) {
    for (const c of cases) {
      out(
        `- [${c.id}] ${c.question} → ${c.expected ?? '?'}${c.userChoice ? ` (${c.userChoice})` : ''}`,
      );
    }
    return;
  }

  const fileVars = readEnvFile();
  const threshold = Number(args.threshold);
  const reports: { engine: string; mode: ReplayMode; report: ReplayReport; results: unknown[] }[] =
    [];
  out();
  out(HEADER);
  for (const engine of engines) {
    // One cache per engine: the second mode reuses the answers of the first.
    const port = new CachingPort(
      args.rescore
        ? RecordedPort.fromFile(resolve(args.rescore), engine)
        : new CappedPort(buildPort(engine, fileVars), Number(args['max-calls'])),
    );
    // Port first: it asks the model about every case, so the gate mode is free.
    const ordered = modes.includes('port')
      ? (['port', ...modes.filter((m) => m !== 'port')] as ReplayMode[])
      : modes;
    for (const mode of ordered) {
      const results = await replayCases(cases, port, { mode, threshold });
      const report = summarize(results);
      reports.push({ engine, mode, report, results });
      out(row(engine, mode, report));
    }
    out(`  ${engine}: ${port.calls} chiamate al modello`);
  }
  out();
  out(
    'chi/proc: chiede/procede · attese ok: decisioni uguali all’etichetta · proc-err: è andato avanti ' +
      'quando doveva chiedere · chi-inut: ha chiesto quando poteva andare avanti · opz=ut: opzione del ' +
      'modello uguale a quella scelta dall’utente · proc≠ut: è andato avanti con un’opzione diversa da ' +
      'quella dell’utente · Brier/ECE: calibrazione di "serve l’utente?" · err/mod: errori del modello ' +
      'sui casi che gli sono arrivati',
  );

  mkdirSync(RESULTS, { recursive: true });
  const path = join(
    RESULTS,
    `decisions-${args.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    path,
    `${JSON.stringify({ at: new Date().toISOString(), args, cases: cases.length, reports }, null, 2)}\n`,
  );
  out(`Risultati: ${path}`);
}

await main();
