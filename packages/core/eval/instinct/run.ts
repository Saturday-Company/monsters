import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { DecisionPort, SystemOneRequest, SystemOneResponse } from '../../src/team/decision.ts';
import { setAppLang, type Lang } from '@monsters/shared';
import { INSTINCT_JEV_MODEL } from '../../src/team/instinct/questions.ts';
import { JevDecisionPort } from '../../src/team/jev.ts';
import {
  loadInstinctCases,
  measureInjection,
  measureInstinct,
  measureTier,
  MeteredPort,
  type InstinctReport,
} from './measure.ts';

/*
 * Offline measure of the instinct (D-067). Not part of CI.
 *
 *   pnpm --filter @monsters/core eval:instinct --env /path/.env            # Jev, every use
 *   pnpm --filter @monsters/core eval:instinct --dry-run                   # no calls: cases and size
 *   pnpm --filter @monsters/core eval:instinct --model jev-1.14.0 --cap 0.05
 *   pnpm --filter @monsters/core eval:instinct --only tier --label tier     # the 30 levels (D-093)
 *                                                                          # and the 10 subtasks (D-109)
 *   pnpm --filter @monsters/core eval:instinct --only injection --lang it  # injections only (D-195)
 *
 * The key is TYPESAFE_API_KEY, from the environment or `--env` (never
 * printed). `--cap` stops the calls at that spend (default 0.05 $). Results:
 * a summary on stdout and the JSON in eval/results/instinct-<label>-<time>.json.
 */

const RESULTS = resolve(import.meta.dirname, '..', 'results');

const { values: args } = parseArgs({
  options: {
    env: { type: 'string' },
    model: { type: 'string', default: INSTINCT_JEV_MODEL },
    cap: { type: 'string', default: '0.05' },
    label: { type: 'string', default: 'run' },
    'dry-run': { type: 'boolean' },
    /**
     * `tier`: only the level, on the 30 labelled requests (D-093) and on the 10 briefs
     * of delegations (D-109, the question the core asks for a subtask).
     */
    only: { type: 'string' },
    /** The family of the questions (`en`, the app's default, or `it`). */
    lang: { type: 'string', default: 'en' },
    'timeout-ms': { type: 'string', default: '20000' },
  },
});

const out = (s = '') => process.stdout.write(`${s}\n`);

function key(): string | null {
  const fromEnv = process.env['TYPESAFE_API_KEY']?.trim();
  if (fromEnv) return fromEnv;
  const file = args.env ?? resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*TYPESAFE_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1]!.replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

/** A port that answers nothing and counts what would be sent (dry run). */
class DryPort implements DecisionPort {
  readonly id = 'jev';
  chars = 0;
  decide(request: SystemOneRequest): Promise<SystemOneResponse> {
    this.chars += JSON.stringify(request).length;
    return Promise.resolve({
      answers: request.questions.map((q) => ({
        id: q.id,
        value:
          q.type === 'choice'
            ? typeof q.options[0] === 'string'
              ? q.options[0]
              : q.options[0]!.label
            : 0.5,
        confidence: 0.5,
      })),
      usage: [
        {
          provider: 'typesafe',
          model: 'dry',
          inputTokens: Math.ceil(JSON.stringify(request).length / 3.2),
        },
      ],
    });
  }
}

function summary(r: InstinctReport): void {
  const g = r.gate;
  out(
    `gate P0 (${g.cases} casi, ${g.gray} in zona grigia): ${g.correct} giusti, ${g.wrongProceed} "procede quando doveva chiedere", ${g.needlessAsk} domande inutili; AUC tutti ${g.aucAll?.toFixed(3)} · zona grigia ${g.aucGray?.toFixed(3)}; opzione = scelta dell'utente ${g.optionMatchesUser}`,
  );
  const t = r.routing;
  out(
    `smistamento: ${t.route} (normali ${t.normali}, difficili ${t.difficili}); suggerimento (conf ≥ 0,7 e stabile) ${t.hint}; scorciatoia (≥ 0,85) ${t.shortcut}; stabile ${t.stable}; livello ${t.tier}; web ${t.web}, web tolto a torto: ${t.webDroppedWrongly.join(', ') || 'nessuno'}`,
  );
  const line = (name: string, s: InstinctReport['loop']) =>
    out(
      `${name}: ${s.at05}/${s.n} a 0,5 (normali ${s.normali}, difficili ${s.difficili}), AUC ${s.auc?.toFixed(2)}; sopra la banda alta ${s.high}, sotto la bassa ${s.low}, in mezzo ${s.mid}; errori ${s.errors.join(' ') || '–'}`,
    );
  line('finito davvero?', r.done);
  out(
    `  esiti del core: ok ${r.done.verdicts['ok']}, promemoria ${r.done.verdicts['promemoria']}, dubbio ${r.done.verdicts['dubbio']}`,
  );
  line('gira a vuoto?', r.loop);
  line('iniezioni (tutte)', r.injection);
  line('iniezioni (solo fonti esterne)', r.injection.externalOnly);
  line('iniezioni (risposte delle app)', r.injection.connectors);
  line('domanda nel testo', r.finalq);
  out(`  regex da sola ${r.finalq.regexAlone}, regex OR istinto ${r.finalq.combined}`);
  line('azioni che escono (candidati)', r.outbound);
  out(`  categoria giusta ${r.outbound.kind}`);
  const oc = r.outbound.core;
  out(
    `  esiti del core (regole, poi istinto sui candidati): da fermare con la scheda ${oc.cards}, solo segnate ${oc.marked}, passate ${oc.missed.join(' ') || 'nessuna'}; innocue lasciate passare ${oc.passed}, schede inutili ${oc.needlessCards.join(' ') || 'nessuna'}; decise dalle regole ${oc.byRules}/${r.outbound.n}`,
  );
  line('memoria', r.memory);
  out(`  righe tolte giuste ${r.memory.dropped}`);
  const c = r.cost;
  out(
    `costo: ${c.calls} chiamate, ${c.inputTokens} token in input, ${c.costUsd.toFixed(5)} $, p50 ${c.p50Ms?.toFixed(0)} ms, p95 ${c.p95Ms?.toFixed(0)} ms`,
  );
}

async function main(): Promise<void> {
  setAppLang(args.lang as Lang);
  const cases = loadInstinctCases();
  out(
    `casi: ${Object.entries(cases)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => `${k} ${(v as unknown[]).length}`)
      .join(', ')} + gate (etichettate.json)`,
  );
  let inner: DecisionPort;
  let dry: DryPort | undefined;
  if (args['dry-run']) {
    inner = dry = new DryPort();
  } else {
    const k = key();
    if (!k) throw new Error('TYPESAFE_API_KEY mancante (ambiente o --env)');
    inner = new JevDecisionPort({
      key: k,
      model: args.model,
      timeoutMs: Number(args['timeout-ms']),
    });
  }
  const port = new MeteredPort(inner, Number(args.cap));
  if (args.only === 'tier') {
    const tier = await measureTier(cases.routing, port);
    // A port of its own: the cost line of each measure counts its calls only.
    const subPort = new MeteredPort(inner, Math.max(0, Number(args.cap) - port.costUsd));
    const subtasks = await measureTier(cases.subtasks, subPort, { subtask: true });
    out();
    if (dry) {
      out(
        `prova a secco: ${port.calls + subPort.calls} chiamate, ~${port.inputTokens + subPort.inputTokens} token in input`,
      );
      return;
    }
    const report = (name: string, t: typeof tier) => {
      const pct = (t.agreement * 100).toFixed(0);
      out(
        `${name}: ${t.agree}/${t.n} uguali all'etichetta (${pct}%); soglia per accenderla di default: 80%`,
      );
      out(
        `  etichetta → Jev (semplice, media, difficile): ${t.confusion.map((r) => r.join(' ')).join(' | ')}`,
      );
      out(
        `  difficili date al modello leggero: ${t.hardAsSimple.join(' ') || 'nessuna'}; semplici al potente: ${t.simpleAsHard.join(' ') || 'nessuna'}`,
      );
      out(`  errori: ${t.errors.join(' ') || '–'}`);
      out(
        `  costo: ${t.cost.calls} chiamate, ${t.cost.costUsd.toFixed(5)} $, p50 ${t.cost.p50Ms?.toFixed(0)} ms`,
      );
    };
    report('livello delle richieste', tier);
    report('livello degli incarichi', subtasks);
    save({ tier, subtasks });
    return;
  }
  if (args.only === 'injection') {
    const { stats, rows } = await measureInjection(cases.injection, port);
    out();
    if (dry) {
      out(`prova a secco: ${port.calls} chiamate, ~${port.inputTokens} token in input`);
      return;
    }
    const line = (name: string, st: typeof stats.connectors) =>
      out(
        `${name}: ${st.at05}/${st.n} a 0,5, AUC ${st.auc?.toFixed(2)}; sopra la banda alta ${st.high}, sotto la bassa ${st.low}, in mezzo ${st.mid}; errori ${st.errors.join(' ') || '–'}`,
      );
    line('iniezioni (tutte)', stats);
    line('iniezioni (solo fonti esterne)', stats.externalOnly);
    line('iniezioni (risposte delle app)', stats.connectors);
    for (const r of rows) out(`  ${r.id} ${r.expected ? 'sì' : 'no'} ${r.p.toFixed(2)}`);
    out(`costo: ${port.calls} chiamate, ${port.costUsd.toFixed(5)} $`);
    save({ lang: args.lang, injection: stats, rows });
    return;
  }
  const report = await measureInstinct(cases, port, {
    onProgress: (u) => process.stderr.write(`· ${u}\n`),
  });
  out();
  if (dry) {
    out(
      `prova a secco: ${port.calls} chiamate, ~${port.inputTokens} token in input, ~${((port.inputTokens * 0.042) / 1e6).toFixed(5)} $`,
    );
    return;
  }
  summary(report);
  save({ report });
}

function save(body: Record<string, unknown>): void {
  mkdirSync(RESULTS, { recursive: true });
  const path = join(
    RESULTS,
    `instinct-${args.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    path,
    `${JSON.stringify({ at: new Date().toISOString(), model: args.model, ...body }, null, 2)}\n`,
  );
  out(`Risultati: ${path}`);
}

await main();
