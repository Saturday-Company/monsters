import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { autoChain, type LogEvent } from '@monsters/shared';
import { startCore } from '../../src/index.ts';
import { suggestedAutoBase } from '../../src/server/routes/providers.ts';
import { CASES, MENU, PROFILE_ANSWERS } from '../cases.ts';
import { evaluateRun, type RunMetrics } from '../metrics.ts';

/*
 * Use of the Claude plan before and after "Automatica" (D-093,
 * docs/eval/2026-10-17-automatica.md §2). Not part of CI: it spends the quota
 * of the Claude subscription logged in on this computer (`claude` on the PATH).
 *
 *   node eval/automatica/run.ts --mode a --label piano-a --env /path/.env
 *   node eval/automatica/run.ts --mode b --label piano-b --env /path/.env
 *   node eval/automatica/run.ts --compare --a <a.json>[,…] --b <b.json>[,…] [--c <b2.json>]
 *
 * One temporary MONSTERS_HOME per series (port 0: never the real core), the
 * demo team of the behaviour eval (Bruno, Rhea, Dione) on the Claude Code
 * harness. `a`: every monster on `sonnet`; `b`: Automatica with the base of
 * each monster's archetype (the capo Forte, the others Media). Jev on in both
 * (TYPESAFE_API_KEY from the env or `--env`, never printed). The cases: post,
 * mail, recensioni (eval/cases.ts) and t01-t10 (instinct/casi-nuovi.json →
 * routing), each in a new conversation, once. A plan limit stops the series.
 * Since D-109 each delegation of `b` has the level of its own subtask (§3).
 */

const RESULTS = resolve(import.meta.dirname, '..', 'results');

const { values: args } = parseArgs({
  options: {
    mode: { type: 'string' },
    label: { type: 'string' },
    env: { type: 'string' },
    only: { type: 'string' },
    'timeout-min': { type: 'string', default: '15' },
    compare: { type: 'boolean', default: false },
    /** With --compare: results files of each series, comma separated (a later file wins on a case). */
    a: { type: 'string' },
    b: { type: 'string' },
    /** A third series to compare (the B of §3, with the level of each subtask). */
    c: { type: 'string' },
  },
});

const out = (s = '') => process.stdout.write(`${s}\n`);

function typesafeKey(): string {
  const fromEnv = process.env['TYPESAFE_API_KEY']?.trim();
  if (fromEnv) return fromEnv;
  const file = args.env ?? resolve(import.meta.dirname, '../../../../.env');
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*TYPESAFE_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1]!.replace(/^["']|["']$/g, '').trim();
  }
  throw new Error(`TYPESAFE_API_KEY missing in ${file}`);
}

interface RoutingCase {
  id: string;
  text: string;
  tier: 0 | 1 | 2;
  route: string;
  web: boolean;
}

interface Case {
  id: string;
  text: string;
  /** Hand label of the level (t01-t10 only): 0 simple, 1 medium, 2 hard. */
  label?: 0 | 1 | 2;
}

function cases(): Case[] {
  const demo = ['post', 'mail', 'recensioni'].map((id) => {
    const c = CASES.find((x) => x.id === id)!;
    return { id: c.id, text: c.text };
  });
  const file = join(import.meta.dirname, '..', 'instinct', 'casi-nuovi.json');
  const routing = (JSON.parse(readFileSync(file, 'utf8')) as { routing: RoutingCase[] }).routing;
  const all = [...demo, ...routing.map((r) => ({ id: r.id, text: r.text, label: r.tier }))];
  const only = args.only ? new Set(args.only.split(',')) : null;
  return all.filter((c) => !only || only.has(c.id));
}

/*
 * The notes t06 and t10 talk about: without them the request has nothing to
 * work on. Same notes in both series.
 */
const FIXTURES: Record<string, string> = {
  'Riunioni/Riunione soci 14 ottobre.md': `# Riunione soci 14 ottobre

Presenti: Giulio, Marta, Luca.

- Sito nuovo: Luca chiude la home entro il 24/10; Marta scrive i testi delle tre pagine dei servizi entro il 21/10.
- Clienti: Orione chiede un preventivo per la seconda fase; Giulio lo prepara entro venerdì 18/10.
- Fatture: due fatture di settembre non ancora pagate (Studio Ferri, Bottega 21). Marta manda il sollecito lunedì.
- Assunzioni: si rimanda a gennaio la ricerca di un junior; Luca prepara la descrizione del ruolo per dicembre.
- Prossima riunione: lunedì 28 ottobre alle 10, Giulio porta i numeri del trimestre.
`,
  'Clienti/Orione/Preventivo Orione seconda fase.md': `# Preventivo Orione · seconda fase

| voce | giorni | tariffa | totale |
|---|---|---|---|
| Analisi dei flussi | 3 | 450 € | 1.350 € |
| Sviluppo modulo preventivi | 8 | 450 € | 3.600 € |
| Integrazione con il calendario | 4 | 450 € | 1.900 € |
| Collaudo e formazione | 2 | 400 € | 800 € |
| **Totale** | 17 | | **7.650 €** |

IVA esclusa.

## Condizioni di pagamento
40% alla firma, 60% alla consegna. Pagamento a 60 giorni data fattura.
Il lavoro si considera accettato se entro una settimana dalla consegna il cliente non segnala
problemi, salvo diversa valutazione delle parti in merito alle tempistiche concordate o da concordare.
`,
  'Clienti/Orione/Contratto quadro Orione.md': `# Contratto quadro Orione (estratto)

- Art. 4 · Pagamenti: ogni fattura si paga a 30 giorni data fattura con bonifico. Nessun anticipo
  superiore al 30% dell'importo del singolo ordine.
- Art. 6 · Accettazione: il cliente ha 15 giorni lavorativi dalla consegna per il collaudo; senza
  segnalazioni scritte il lavoro è accettato.
- Art. 9 · Tariffe: 450 € al giorno per sviluppo e analisi, 400 € per formazione.
`,
};

/** The user's reply to an open question of a t-case (no fact to add). */
const OPEN_REPLY = 'Non ho altro da aggiungere: procedi con quello che hai e dimmi cosa manca.';

interface ModelUsage {
  requests: number;
  /** Rest of a turn's total, not a request (`result.usage`). */
  aggregates: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

interface CaseResult {
  case: string;
  text: string;
  label?: 0 | 1 | 2;
  status: string;
  durationS: number;
  /** Per model of the plan (`provider:model`), all agents. */
  usage: Record<string, ModelUsage>;
  /** Per agent name, per model. */
  agents: Record<string, Record<string, ModelUsage>>;
  /** Jev calls of the run (the instinct, not the plan). */
  jev: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  /**
   * Level chosen by Jev (B; A asks no level) and the model of each monster; `from` for a
   * delegation (D-109): the level of its own subtask, or the request's.
   */
  tier: {
    level: string;
    agent: string;
    model: string;
    moved: boolean;
    from?: 'subtask' | 'request';
  }[];
  delegations: { to: string; goal: string; status: string; verdict?: string; retried?: boolean }[];
  instinct: { action: string; message: string }[];
  questions: { text: string; options: string[]; answered: string }[];
  fallbacks: string[];
  errors: string[];
  answer: string;
  /** What the capo streamed in the chat before its final answer (the draft), when longer. */
  draft?: string;
  notes: { path: string; chars: number; text: string }[];
  metrics: RunMetrics;
}

const emptyUsage = (): ModelUsage => ({
  requests: 0,
  aggregates: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
});

function addUsage(to: ModelUsage, d: LogEvent<'provider_usage'>['data']): void {
  // An aggregate (the rest of a turn's total, not a request) has no context measure.
  if (d.context === undefined) to.aggregates++;
  else to.requests++;
  to.inputTokens += d.inputTokens ?? 0;
  to.cachedInputTokens += d.cachedInputTokens ?? 0;
  to.cacheWriteTokens += d.cacheWriteTokens ?? 0;
  to.outputTokens += d.outputTokens ?? 0;
}

async function series(mode: 'a' | 'b', label: string): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), `monsters-automatica-${mode}-`));
  const home = join(base, 'home');
  const core = await startCore({
    home,
    port: 0,
    env: { TYPESAFE_API_KEY: typesafeKey() },
    webDist: false,
    hub: {
      onboardingGenerate: null,
      settings: { watchVault: false, instinct: { engine: 'jev', uses: {} } },
    },
  });
  const { hub, log } = core;
  const results: CaseResult[] = [];
  let stopped: string | null = null;
  try {
    await hub.onboarding.submit({
      answers: PROFILE_ANSWERS,
      permissions: { vault: true, web: true },
    });
    const state = await hub.onboarding.propose();
    await hub.onboarding.confirm({
      members: (state.proposal?.members ?? []).map((m) => ({ id: m.id })),
    });
    await hub.subscriptions.activate('claude-agent', false);
    const team = hub.team.list();
    const chains: Record<string, string> = {};
    for (const a of team) {
      if (mode === 'a') {
        await hub.team.setModels(a.config.id, [{ provider: 'claude-agent', model: 'sonnet' }]);
        chains[a.config.name] = 'sonnet';
      } else {
        const b = suggestedAutoBase(a, hub.team.permissionsFor(a.config.id));
        await hub.team.setModels(a.config.id, autoChain(b), { base: b });
        chains[a.config.name] = `Automatica ${b}`;
      }
    }
    for (const [path, text] of Object.entries(FIXTURES)) {
      mkdirSync(join(hub.vault.root, path, '..'), { recursive: true });
      writeFileSync(join(hub.vault.root, path), text);
    }
    await hub.vault.reindex();
    out(`Serie ${mode.toUpperCase()} (${label}): ${JSON.stringify(chains)}, home ${home}`);

    const orchestrator = hub.team.orchestrator()!;
    const nameOf = (id: string) => hub.team.get(id)?.config.name ?? id;
    const idOf = (name: string) => hub.team.get(name)?.config.id ?? name.toLowerCase();
    for (const c of cases()) {
      hub.newConversation({ channel: 'cli' });
      const started = Date.now();
      const sent = hub.send({ text: c.text, channel: 'cli' });
      const runId = sent.runId;
      const asked: CaseResult['questions'] = [];
      out(`→ ${c.id}…`);
      await new Promise<void>((done) => {
        const timer = setTimeout(
          () => void core.runs.killRun(runId, { by: 'cli', reason: 'eval timeout' }),
          Number(args['timeout-min']) * 60_000,
        );
        const off = log.subscribe((e) => {
          if (e.runId !== runId) return;
          if (e.type === 'question') {
            const first = e.data.options[0];
            const optionId = first ? (e.data.recommended ?? first.id) : undefined;
            const text = c.id === 'post' ? MENU : OPEN_REPLY;
            asked.push({
              text: e.data.question,
              options: e.data.options.map((o) => o.label),
              answered: optionId
                ? (e.data.options.find((o) => o.id === optionId)?.label ?? optionId)
                : text,
            });
            setTimeout(() => {
              try {
                hub.answer(e.data.questionId, optionId ? { optionId } : { text }, 'cli');
              } catch {
                // expired or already answered
              }
            }, 1500);
          }
          if (e.type === 'run' && e.data.status !== 'started') {
            clearTimeout(timer);
            off();
            done();
          }
        });
      });
      await hub.dispatcher.idle();
      const durationS = Math.round((Date.now() - started) / 1000);
      const events = log.all({ runId });
      const of = <T extends LogEvent['type']>(type: T) =>
        events.filter((e) => e.type === type) as LogEvent<T>[];

      const usage: CaseResult['usage'] = {};
      const agents: CaseResult['agents'] = {};
      const jev = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      for (const u of of('provider_usage')) {
        if (u.data.provider === 'typesafe') {
          jev.calls++;
          jev.inputTokens += u.data.inputTokens ?? 0;
          jev.outputTokens += u.data.outputTokens ?? 0;
          jev.costUsd += u.data.costUsd ?? 0;
          continue;
        }
        const key = `${u.data.provider}:${u.data.model}`;
        addUsage((usage[key] ??= emptyUsage()), u.data);
        const perAgent = (agents[nameOf(u.agent)] ??= {});
        addUsage((perAgent[key] ??= emptyUsage()), u.data);
      }
      const tier = of('instinct')
        .filter((e) => e.data.use === 'tier' && e.data.action === 'tier')
        .map((e) => {
          const d = (e.data.details ?? {}) as {
            level?: string;
            model?: string;
            moved?: boolean;
            from?: 'subtask' | 'request';
          };
          return {
            level: d.level ?? '?',
            agent: nameOf(e.data.subject ?? ''),
            model: d.model ?? '?',
            moved: d.moved ?? false,
            ...(d.from ? { from: d.from } : {}),
          };
        });
      const ended = of('delegation').filter((d) => d.data.status !== 'started');
      const delegations = of('delegation')
        .filter((d) => d.data.status === 'started')
        .map((d, i) => {
          const end = ended[i];
          const check = (end?.data as { check?: { verdict?: string; retried?: boolean } })?.check;
          return {
            to: nameOf(d.data.to),
            goal: d.data.goal.slice(0, 200),
            status: end?.data.status ?? '?',
            ...(check?.verdict ? { verdict: check.verdict } : {}),
            ...(check?.retried ? { retried: true } : {}),
          };
        });
      const instinct = of('instinct')
        .filter((e) => e.data.action !== 'tier')
        .map((e) => ({ action: e.data.action, message: (e.data.message ?? '').slice(0, 240) }));
      const errors = of('error').map((e) => `${nameOf(e.agent)}: ${e.data.code} ${e.data.message}`);
      const fallbacks = of('error')
        .filter((e) => e.data.code === 'provider_fallback')
        .map((e) => JSON.stringify((e.data as { fallback?: unknown }).fallback ?? e.data.message));
      const notes = [
        ...new Set(
          of('vault_change')
            .map((e) => e.data.path)
            .filter((p) => !p.startsWith('Agenti/') && p.endsWith('.md') && !(p in FIXTURES)),
        ),
      ].map((p) => {
        let text = '';
        try {
          text = readFileSync(join(hub.vault.root, p), 'utf8');
        } catch {
          // deleted in the run
        }
        return { path: p, chars: text.length, text: text.slice(0, 6000) };
      });
      const draft = of('message')
        .filter(
          (e) =>
            e.agent === orchestrator.config.id &&
            e.data.role === 'agent' &&
            e.data.partial === true &&
            !e.parentId,
        )
        .map((e) => e.data.text)
        .join('');
      const requests = Object.values(usage).reduce((n, u) => n + u.requests, 0);
      const metrics = evaluateRun({
        events,
        vaultRoot: hub.vault.root,
        orchestratorId: orchestrator.config.id,
        writerId: idOf('Dione'),
        researcherId: idOf('Rhea'),
        requests,
        durationS,
        searchFound: null,
      });
      const r: CaseResult = {
        case: c.id,
        text: c.text,
        ...(c.label !== undefined ? { label: c.label } : {}),
        status: metrics.status,
        durationS,
        usage,
        agents,
        jev,
        tier,
        delegations,
        instinct,
        questions: asked,
        fallbacks,
        errors,
        answer: metrics.answer,
        ...(draft.length > metrics.answer.length ? { draft: draft.slice(0, 8000) } : {}),
        notes,
        metrics,
      };
      results.push(r);
      const models = Object.entries(usage)
        .map(
          ([m, u]) =>
            `${m.replace('claude-agent:', '')} ${u.requests} (${u.inputTokens}/${u.outputTokens})`,
        )
        .join(', ');
      out(
        `  ${r.status}, ${durationS} s; ${models}; livello ${tier[0]?.level ?? '–'}; deleghe ${
          delegations.map((d) => `${d.to}:${d.verdict ?? d.status}`).join(' ') || '–'
        }`,
      );
      // The plan at its limit (Sonnet included): stop, nothing more to measure.
      // Only the plan's own limit: `token_limit` and `max_steps` are Monsters' limits of a monster.
      const limit = of('error')
        .filter((e) => /usage_limit/.test(e.data.code ?? '') && e.data.code !== 'provider_fallback')
        .map((e) => `${nameOf(e.agent)}: ${e.data.code} ${e.data.message}`)[0];
      if (limit) {
        stopped = `${c.id}: ${limit}`;
        out(`Limite del piano: ${stopped}. Mi fermo.`);
        break;
      }
    }
  } finally {
    await core.close();
    mkdirSync(RESULTS, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(RESULTS, `automatica-${label}-${stamp}.json`);
    writeFileSync(
      file,
      `${JSON.stringify({ label, mode, stopped, claude: 'claude-agent (Claude Code, abbonamento)', results }, null, 2)}\n`,
    );
    out(`Risultati: ${file}`);
    rmSync(base, { recursive: true, force: true });
  }
}

const LEVEL: Record<string, number> = { simple: 0, medium: 1, hard: 2 };

/** The cases of one series from its results files (a later file wins on a case). */
function load(files: string): CaseResult[] {
  const byCase = new Map<string, CaseResult>();
  for (const f of files.split(',')) {
    const saved = JSON.parse(readFileSync(f, 'utf8')) as { results: CaseResult[] };
    for (const r of saved.results) byCase.set(r.case, r);
  }
  return [...byCase.values()];
}

/** A/B tables in Markdown from the results files of the series (a third one with `--c`). */
function compare(filesA: string, filesB: string, filesC?: string): void {
  const a = load(filesA);
  const b = load(filesB);
  const c = filesC ? load(filesC) : undefined;
  const short = (m: string) => m.replace(/^claude-agent:/, '').replace(/^claude-/, '');
  const fmt = (r: CaseResult | undefined) =>
    r
      ? Object.entries(r.usage)
          .map(
            ([m, u]) =>
              `${short(m)} ${u.requests} (${Math.round(u.inputTokens / 1000)}k/${(u.outputTokens / 1000).toFixed(1)}k)`,
          )
          .join(', ')
      : '–';
  out(
    '| caso | A: modelli, richieste (token in/out) | B: modelli, richieste (token in/out) | livello B | deleghe A | deleghe B | s A / s B |',
  );
  out('|---|---|---|---|---|---|---|');
  for (const ra of a) {
    const rb = b.find((x) => x.case === ra.case);
    const dl = (r?: CaseResult) =>
      r?.delegations
        .map((d) => `${d.to} ${d.verdict ?? d.status}${d.retried ? ' (ripresa)' : ''}`)
        .join(', ') || '–';
    out(
      `| ${ra.case} | ${fmt(ra)} | ${fmt(rb)} | ${rb?.tier[0]?.level ?? '–'}${rb?.label !== undefined ? ` (etichetta ${['semplice', 'media', 'difficile'][rb.label]})` : ''} | ${dl(ra)} | ${dl(rb)} | ${ra.durationS} / ${rb?.durationS ?? '–'} |`,
    );
  }
  const total = (rs: CaseResult[]) => {
    const t: Record<string, ModelUsage> = {};
    for (const r of rs)
      for (const [m, u] of Object.entries(r.usage)) {
        const x = (t[m] ??= emptyUsage());
        x.requests += u.requests;
        x.aggregates += u.aggregates;
        x.inputTokens += u.inputTokens;
        x.cachedInputTokens += u.cachedInputTokens;
        x.cacheWriteTokens += u.cacheWriteTokens;
        x.outputTokens += u.outputTokens;
      }
    return t;
  };
  const all: [string, CaseResult[]][] = [
    ['A', a],
    ['B', b],
    ...(c ? ([['C', c]] as [string, CaseResult[]][]) : []),
  ];
  for (const [name, rs] of all) {
    const t = total(rs);
    const req = Object.values(t).reduce((n, u) => n + u.requests, 0);
    const tok = Object.values(t).reduce((n, u) => n + u.inputTokens + u.outputTokens, 0);
    out(`\n${name}: ${req} richieste, ${tok} token`);
    for (const [m, u] of Object.entries(t)) {
      out(
        `- ${short(m)}: ${u.requests} richieste (${((100 * u.requests) / req).toFixed(0)}%), in ${u.inputTokens} (cache letta ${u.cachedInputTokens}, scritta ${u.cacheWriteTokens}), out ${u.outputTokens}, token ${(((u.inputTokens + u.outputTokens) * 100) / tok).toFixed(0)}%`,
      );
    }
    const jev = rs.reduce((n, r) => n + r.jev.calls, 0);
    const jevUsd = rs.reduce((n, r) => n + r.jev.costUsd, 0);
    out(`- Jev: ${jev} chiamate, ${jevUsd.toFixed(5)} $`);
  }
  // Who used the plan: the lead (the orchestrator) against the others, per model.
  const lead = 'Bruno';
  out('\n| serie | agente | richieste | token (in + out) | per modello (richieste) |');
  out('|---|---|---|---|---|');
  for (const [name, rs] of all) {
    const per = new Map<string, Record<string, ModelUsage>>();
    for (const r of rs)
      for (const [agent, models] of Object.entries(r.agents)) {
        const who = agent === lead ? lead : 'altri';
        const t = per.get(who) ?? {};
        per.set(who, t);
        for (const [m, u] of Object.entries(models)) {
          const x = (t[m] ??= emptyUsage());
          x.requests += u.requests;
          x.inputTokens += u.inputTokens;
          x.outputTokens += u.outputTokens;
        }
      }
    const sum = (t: Record<string, ModelUsage>) =>
      Object.values(t).reduce(
        (n, u) => ({ req: n.req + u.requests, tok: n.tok + u.inputTokens + u.outputTokens }),
        { req: 0, tok: 0 },
      );
    const total = [...per.values()].reduce(
      (n, t) => ({ req: n.req + sum(t).req, tok: n.tok + sum(t).tok }),
      { req: 0, tok: 0 },
    );
    for (const who of [lead, 'altri']) {
      const t = per.get(who) ?? {};
      const s = sum(t);
      out(
        `| ${name} | ${who} | ${s.req} (${((100 * s.req) / (total.req || 1)).toFixed(0)}%) | ${(s.tok / 1e6).toFixed(2)} M (${((100 * s.tok) / (total.tok || 1)).toFixed(0)}%) | ${Object.entries(
          t,
        )
          .map(([m, u]) => `${short(m)} ${u.requests}`)
          .join(', ')} |`,
      );
    }
  }
  for (const [name, rs] of all.slice(1)) {
    const labelled = rs.filter((r) => r.label !== undefined && r.tier[0]);
    const agree = labelled.filter((r) => LEVEL[r.tier[0]!.level] === r.label).length;
    out(`\nAccordo del livello in ${name}: ${agree}/${labelled.length}`);
    // The levels of the subtasks (D-109): each delegation with its own.
    const subs = rs.flatMap((r) =>
      r.tier.filter((x) => x.from).map((x) => `${r.case}:${x.agent} ${x.level} (${x.from})`),
    );
    if (subs.length) out(`Livelli degli incarichi in ${name}: ${subs.join(', ')}`);
  }
}

if (args.compare) {
  if (!args.a || !args.b) throw new Error('--compare --a <files> --b <files> [--c <files>]');
  compare(args.a, args.b, args.c);
} else {
  if (args.mode !== 'a' && args.mode !== 'b') throw new Error('--mode a|b');
  series(args.mode, args.label ?? `piano-${args.mode}`).catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
