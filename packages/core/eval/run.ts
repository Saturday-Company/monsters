import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LogEvent } from '@monsters/shared';
import { extractUrls, startCore } from '../src/index.ts';
import { CASES, MENU, PROFILE_ANSWERS, PROFILE_WITHOUT_MENU, type EvalCase } from './cases.ts';
import { evaluateRun, loopFromStored, type LoopMetrics, type RunMetrics } from './metrics.ts';

/*
 * Behaviour eval of the agents (not part of CI): a temporary MONSTERS_HOME,
 * the fixed profile of the demo, the standard team from the real onboarding
 * (fallback proposal: Rhea and Dione, no model call), one request per run on
 * OpenRouter free. Questions are answered automatically with the recommended
 * option. Results: a table on stdout and a JSON in eval/results/.
 *
 *   pnpm --filter @monsters/core eval --label baseline --case post --times 3
 *
 * `--rescore <path>` scores again without any request: a folder of runs kept
 * with --keep (events and vault on disk), or saved results (a results JSON, or
 * a folder of them such as eval/results/, with --match on the file name). Saved
 * results have no events: the loop metrics they cannot give are shown as "–".
 *
 * Key: OPENROUTER_API_KEY, or MONSTERS_EVAL_ENV_FILE / --env pointing to a .env.
 * `--search paid` turns on the paid web search (D-071) with OPENROUTER_PAID_API_KEY
 * from the same file (`--engine parallel|exa`); the models stay free. Paid
 * searches are not counted as requests: their dollars are printed per run.
 * Every request is counted in eval/results/ledger.json against --budget (only
 * the entries of --round, when given). Each run may use at most --max-requests,
 * and never more than what is left of the budget.
 */

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(here, 'results');
const LEDGER = join(RESULTS, 'ledger.json');

const { values: args } = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    times: { type: 'string', default: '1' },
    label: { type: 'string', default: 'run' },
    env: { type: 'string' },
    budget: { type: 'string', default: '250' },
    round: { type: 'string' },
    'max-requests': { type: 'string', default: '45' },
    'timeout-min': { type: 'string', default: '10' },
    keep: { type: 'string' },
    rescore: { type: 'string' },
    /** With --rescore: only the kept runs whose folder name starts with this. */
    match: { type: 'string' },
    /** `jev`: the team's instinct with Jev (TYPESAFE_API_KEY from the same env file); default: rules only. */
    instinct: { type: 'string', default: 'rules' },
    /** `paid`: paid web search on OPENROUTER_PAID_API_KEY (D-071); default: the free chain. */
    search: { type: 'string', default: 'free' },
    engine: { type: 'string', default: 'parallel' },
  },
});

const out = (s = '') => process.stdout.write(`${s}\n`);

function loadKey(name = 'OPENROUTER_API_KEY'): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const file = args.env ?? process.env.MONSTERS_EVAL_ENV_FILE ?? resolve(here, '../../../.env');
  if (!existsSync(file)) throw new Error(`no ${name} and no env file at ${file}`);
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  const key = line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!key) throw new Error(`${name} missing in ${file}`);
  return key;
}

if (args.instinct !== 'rules' && args.instinct !== 'jev') {
  throw new Error(`--instinct must be rules or jev, not ${args.instinct}`);
}
/** Only with --instinct jev: Jev requests are not counted against the OpenRouter budget. */
const typesafeKey = args.instinct === 'jev' ? loadKey('TYPESAFE_API_KEY') : undefined;
if (args.search !== 'free' && args.search !== 'paid') {
  throw new Error(`--search must be free or paid, not ${args.search}`);
}
if (args.engine !== 'parallel' && args.engine !== 'exa') {
  throw new Error(`--engine must be parallel or exa, not ${args.engine}`);
}
/** Only with --search paid: the key of the paid search, never of the models. */
const searchKey = args.search === 'paid' ? loadKey('OPENROUTER_PAID_API_KEY') : undefined;

interface LedgerEntry {
  at: string;
  label: string;
  case: string;
  requests: number;
  round?: string;
}

function readLedger(): LedgerEntry[] {
  try {
    return JSON.parse(readFileSync(LEDGER, 'utf8')) as LedgerEntry[];
  } catch {
    return [];
  }
}

function spent(): number {
  return readLedger()
    .filter((e) => args.round === undefined || e.round === args.round)
    .reduce((n, e) => n + e.requests, 0);
}

function record(entry: LedgerEntry): void {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify([...readLedger(), entry], null, 2)}\n`);
}

/** The external links of the notes written in the run, and whether they answer 200. */
export interface LinkReport {
  total: number;
  ok: number;
  links: { url: string; note: string; status: number | string }[];
}

interface RunResult {
  case: string;
  index: number;
  /** Results file a rescored run comes from (saved results only). */
  source?: string;
  metrics: RunMetrics;
  links?: LinkReport;
  home?: string;
}

/** HEAD, then GET when HEAD is refused; redirects followed. No model request. */
async function statusOf(url: string): Promise<number | string> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) monsters-eval' },
    });
    await res.body?.cancel();
    return res.status;
  };
  try {
    const head = await attempt('HEAD');
    return head === 200 ? head : await attempt('GET');
  } catch (err) {
    return (err as Error).name === 'TimeoutError' ? 'timeout' : 'errore di rete';
  }
}

async function checkLinks(vaultRoot: string, notes: RunMetrics['notes']): Promise<LinkReport> {
  const links: LinkReport['links'] = [];
  for (const n of notes.filter((x) => !x.path.startsWith('Agenti/'))) {
    let text: string;
    try {
      text = readFileSync(join(vaultRoot, n.path), 'utf8');
    } catch {
      continue;
    }
    for (const url of extractUrls(text)) links.push({ url, note: n.path, status: 0 });
  }
  await Promise.all(
    links.map(async (l) => {
      l.status = await statusOf(l.url);
    }),
  );
  return { total: links.length, ok: links.filter((l) => l.status === 200).length, links };
}

/** Fewer requests left than this: no new run starts. */
const MIN_ROOM = 8;

async function runOnce(c: EvalCase, index: number, key: string, cap: number): Promise<RunResult> {
  const base = args.keep
    ? join(resolve(args.keep), `${args.label}-${c.id}-${index}-${Date.now()}`)
    : mkdtempSync(join(tmpdir(), 'monsters-eval-'));
  const home = join(base, 'home');
  let requests = 0;
  const countingFetch: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    // A paid search (`web` plugin) is a cost, not a model request (D-071).
    const search = typeof init?.body === 'string' && init.body.includes('"plugins":[{"id":"web"');
    if (url.includes('/chat/completions') && !url.includes('typesafe.ai') && !search) requests++;
    return fetch(input, init);
  };
  const core = await startCore({
    home,
    port: 0,
    env: { OPENROUTER_API_KEY: key, ...(typesafeKey ? { TYPESAFE_API_KEY: typesafeKey } : {}) },
    webDist: false,
    hub: {
      fetch: countingFetch,
      onboardingGenerate: null,
      ...(searchKey ? { searchKey } : {}),
      settings: {
        watchVault: false,
        ...(searchKey
          ? { paidSearch: { mode: 'on' as const, engine: args.engine as 'parallel' | 'exa' } }
          : {}),
      },
    },
  });
  const { hub, log } = core;
  try {
    // The real onboarding, with the fixed team proposal (no model call).
    await hub.onboarding.submit({
      answers: c.menuInProfile === false ? PROFILE_WITHOUT_MENU : PROFILE_ANSWERS,
      permissions: { vault: true, web: true },
    });
    const state = await hub.onboarding.propose();
    await hub.onboarding.confirm({
      members: (state.proposal?.members ?? []).map((m) => ({ id: m.id })),
    });
    const orchestrator = hub.team.orchestrator()!;
    const idOf = (name: string) => hub.team.get(name)?.config.id ?? name.toLowerCase();

    const started = Date.now();
    const sent = hub.send({ text: c.text, channel: 'cli' });
    const runId = sent.runId;
    const ended = new Promise<void>((resolveEnd) => {
      const timer = setTimeout(
        () => {
          void core.runs.killRun(runId, { by: 'cli', reason: 'eval timeout' });
        },
        Number(args['timeout-min']) * 60_000,
      );
      const off = log.subscribe((e) => {
        if (e.runId !== runId) return;
        if (e.type === 'question') {
          // The user answers a few seconds later: the recommended option, or the
          // menu to an open question (the only fact the user is asked for).
          const q = e;
          const first = q.data.options[0];
          setTimeout(() => {
            try {
              hub.answer(
                q.data.questionId,
                first ? { optionId: q.data.recommended ?? first.id } : { text: MENU },
                'cli',
              );
            } catch {
              // expired or already answered
            }
          }, 1500);
        }
        if (requests >= cap) {
          void core.runs.killRun(runId, { by: 'cli', reason: `eval cap ${cap} requests` });
        }
        if (e.type === 'run' && e.data.status !== 'started') {
          clearTimeout(timer);
          off();
          resolveEnd();
        }
      });
    });
    await ended;
    await hub.dispatcher.idle();
    const durationS = Math.round((Date.now() - started) / 1000);
    const events = log.query({ runId, limit: 5000 });

    // Would the orchestrator find the notes of the run with a natural query?
    const created = events
      .filter((e): e is LogEvent<'vault_change'> => e.type === 'vault_change')
      .map((e) => e.data.path)
      .filter((p) => !p.startsWith('Agenti/') && p.endsWith('.md'));
    let searchFound: boolean | null = null;
    if (created.length > 0) {
      const hits = await hub.vault.search(
        { agentId: orchestrator.config.id },
        { query: c.searchQuery, limit: 20 },
      );
      searchFound = hits.some((h) => created.includes(h.path));
    }

    const input = {
      vaultRoot: hub.vault.root,
      orchestratorId: orchestrator.config.id,
      writerId: idOf('Dione'),
      researcherId: idOf('Rhea'),
      requests,
      durationS,
      searchFound,
    };
    if (args.keep) {
      // Raw material to score the run again offline (--rescore).
      writeFileSync(join(base, 'events.json'), JSON.stringify(events));
      writeFileSync(join(base, 'meta.json'), JSON.stringify({ case: c.id, index, ...input }));
    }
    const metrics = evaluateRun({ events, ...input });
    const links = await checkLinks(hub.vault.root, metrics.notes);
    if (args.keep) writeFileSync(join(base, 'links.json'), JSON.stringify(links));
    return { case: c.id, index, metrics, links, ...(args.keep ? { home } : {}) };
  } finally {
    await core.close();
    record({
      at: new Date().toISOString(),
      label: args.label,
      case: c.id,
      requests,
      ...(args.round ? { round: args.round } : {}),
    });
    if (!args.keep) rmSync(base, { recursive: true, force: true });
  }
}

const yn = (b: boolean | null) => (b === null ? '–' : b ? 'sì' : 'no');

export function table(results: RunResult[]): string {
  const head = [
    'caso',
    'Rhea',
    'Dione',
    'ask_user',
    'ask chiamate/arrivate/rifiutate',
    'aperte',
    'promemoria',
    'testo senza ask',
    'piatti inventati',
    'chiuso',
    'note IT',
    'wikilink rotti',
    'link MD/wiki/nudi',
    'link Rhea MD/nudi',
    'nomi ok',
    'ricerca',
    'web Bruno',
    'opzioni descritte',
    'avvisi link',
    'URL 200',
    'richieste',
  ];
  const rows = results.map((r) => {
    const m = r.metrics;
    const ask = m.questionWithOptions
      ? m.tasteQuestion
        ? 'sì, gusto'
        : 'sì, altro'
      : m.askUserGated > 0
        ? 'gate'
        : m.plainTextQuestion
          ? 'testo'
          : 'no';
    return [
      `${r.case}#${r.index}`,
      yn(m.delegatedResearch),
      yn(m.delegatedWriting),
      ask,
      `${m.askUserCalls}/${m.questionsToUser}/${m.askUserRefused}`,
      String(m.openQuestions),
      String(m.reminders),
      String(m.textQuestionsUnfollowed),
      m.inventedDishes.join(', ') || '–',
      m.answeredAndClosed ? 'sì' : m.status,
      `${yn(m.notesItalian)} (${m.notes.filter((n) => n.language === 'it').length}/${m.notes.length})`,
      String(m.brokenWikilinks),
      `${m.externalLinks.markdown}/${m.externalLinks.wikilink}/${m.externalLinks.bare}`,
      `${m.researcherLinks.markdown}/${m.researcherLinks.bare}`,
      yn(m.unnaturalNames.length === 0),
      yn(m.searchFound),
      String(m.orchestratorTools.filter((t) => t.startsWith('web_')).length),
      yn(m.optionsDescribed),
      String(m.unverifiedLinkWarnings),
      r.links ? `${r.links.ok}/${r.links.total}` : '–',
      String(m.requests),
    ];
  });
  return markdownTable(head, rows);
}

/** Scores again the runs kept with --keep (after a change to the metrics). */
function rescoreKept(dir: string): RunResult[] {
  const results: RunResult[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (args.match && !name.startsWith(args.match)) continue;
    const meta = join(dir, name, 'meta.json');
    if (!existsSync(meta)) continue;
    const m = JSON.parse(readFileSync(meta, 'utf8')) as Parameters<typeof evaluateRun>[0] & {
      case: string;
      index: number;
    };
    const events = JSON.parse(readFileSync(join(dir, name, 'events.json'), 'utf8')) as LogEvent[];
    const linksFile = join(dir, name, 'links.json');
    const links = existsSync(linksFile)
      ? (JSON.parse(readFileSync(linksFile, 'utf8')) as LinkReport)
      : undefined;
    results.push({
      case: m.case,
      index: m.index,
      metrics: evaluateRun({ ...m, events }),
      ...(links ? { links } : {}),
    });
  }
  return results;
}

/** Results files of a behaviour eval (not the ledger, not the decision evals). */
function isResultsFile(name: string): boolean {
  return name.endsWith('.json') && name !== 'ledger.json' && !name.startsWith('decisions-');
}

/** Metrics added after the first results were saved: their neutral value in older files. */
const SAVED_DEFAULTS: Partial<RunMetrics> = {
  askUserRefused: 0,
  questionsToUser: 0,
  openQuestions: 0,
  reminders: 0,
  textQuestionsUnfollowed: 0,
  inventedDishes: [],
  questions: [],
  tasteQuestion: false,
  optionsDescribed: null,
  unverifiedLinkWarnings: 0,
  researcherLinks: { markdown: 0, wikilink: 0, bare: 0 },
};

/**
 * Saved results without events (the kept runs are gone): the metrics as saved,
 * with the loop metrics that the saved lists still give (D-064).
 */
function rescoreSaved(files: string[]): RunResult[] {
  const results: RunResult[] = [];
  for (const file of files) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { results?: RunResult[] };
    for (const r of saved.results ?? []) {
      results.push({
        case: r.case,
        index: r.index,
        source: basename(file),
        metrics: {
          ...SAVED_DEFAULTS,
          ...r.metrics,
          loop: r.metrics.loop ?? loopFromStored(r.metrics),
        },
        ...(r.links ? { links: r.links } : {}),
      });
    }
  }
  return results;
}

function rescore(path: string): RunResult[] {
  if (path.endsWith('.json')) return rescoreSaved([path]);
  const names = readdirSync(path).sort();
  if (names.some((n) => existsSync(join(path, n, 'meta.json')))) return rescoreKept(path);
  return rescoreSaved(
    names
      .filter((n) => isResultsFile(n) && (!args.match || n.startsWith(args.match)))
      .map((n) => join(path, n)),
  );
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '–' : String(n));
const kTok = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));

/** Cost and waste of the loop per run (D-064): requests and tokens per agent, steps, repeats. */
export function loopTable(results: RunResult[]): string {
  const head = [
    'caso',
    'richieste per agente',
    'token in/out/cache',
    'passi per delega',
    'strumenti per delega',
    'ricerche pagate',
    'ripetute',
    'INVALID_INPUT',
    'riparate',
    'riass. vuoti',
    'riass. medio',
    'deleghe doppie',
    'fermati al limite',
    'fallback',
  ];
  const rows = results.map((r) => {
    const l: LoopMetrics = r.metrics.loop ?? loopFromStored(r.metrics);
    const agents = l.agents ? Object.entries(l.agents) : null;
    const tokens = agents?.reduce(
      (t, [, a]) => ({
        in: t.in + a.inputTokens,
        out: t.out + a.outputTokens,
        cache: t.cache + a.cachedInputTokens,
      }),
      { in: 0, out: 0, cache: 0 },
    );
    return [
      `${r.source ? `${r.source.replace(/-\d{4}-\d\d-\d\dT.*$/, '')} ` : ''}${r.case}#${r.index}`,
      agents
        ? agents.map(([id, a]) => `${id} ${a.requests}`).join(', ')
        : `tot ${r.metrics.requests}`,
      tokens ? `${kTok(tokens.in)}/${kTok(tokens.out)}/${kTok(tokens.cache)}` : '–',
      l.stepsPerDelegation
        ? l.stepsPerDelegation.map((d) => `${d.to} ${d.steps}`).join(', ') || '–'
        : '–',
      l.stepsPerDelegation
        ? l.stepsPerDelegation
            .map((d) =>
              Object.entries(d.tools ?? {})
                .map(([t, n]) => `${t.replace(/^(web|vault)_/, '')} ${n}`)
                .join(' '),
            )
            .join(' / ') || '–'
        : '–',
      l.paidSearches ? `${l.paidSearches.count} (${l.paidSearches.costUsd.toFixed(4)} $)` : '–',
      num(l.repeatedCalls),
      num(l.invalidInput),
      num(l.repairedCalls),
      num(l.emptySummaries),
      num(l.avgSummaryChars),
      String(l.repeatedDelegations),
      String(l.limitStops),
      String(l.fallbacks),
    ];
  });
  return markdownTable(head, rows);
}

function markdownTable(head: string[], rows: string[][]): string {
  const all = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    line(head),
    `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

async function main(): Promise<void> {
  if (args.rescore) {
    const results = rescore(resolve(args.rescore));
    out(table(results));
    out();
    out(loopTable(results));
    if (args.label !== 'run') {
      // A labelled rescore is kept with the other results (e.g. a series stopped halfway).
      mkdirSync(RESULTS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(RESULTS, `${args.label}-${stamp}.json`);
      writeFileSync(file, `${JSON.stringify({ label: args.label, results }, null, 2)}\n`);
      out(`Risultati: ${file}`);
    }
    return;
  }
  const key = loadKey();
  const ids = args.case?.length ? args.case : ['post'];
  const cases = ids.map((id) => {
    const c = CASES.find((x) => x.id === id);
    if (!c) throw new Error(`unknown case ${id}: ${CASES.map((x) => x.id).join(', ')}`);
    return c;
  });
  const times = Number(args.times);
  const budget = Number(args.budget);
  const cap = Number(args['max-requests']);
  const results: RunResult[] = [];
  out(`Eval "${args.label}": ${cases.map((c) => c.id).join(', ')} × ${times}`);
  out(`Richieste già usate: ${spent()} su ${budget}`);
  for (const c of cases) {
    for (let i = 1; i <= times; i++) {
      const room = budget - spent();
      if (room < MIN_ROOM) {
        out(`Budget quasi finito (${spent()}/${budget}): mi fermo.`);
        break;
      }
      out(`→ ${c.id}#${i}…`);
      const r = await runOnce(c, i, key, Math.min(cap, room));
      results.push(r);
      const m = r.metrics;
      const paid = m.loop?.paidSearches;
      out(
        `  ${m.status}, ${m.requests} richieste, ${m.durationS} s; strumenti: ${m.orchestratorTools.join(', ')}` +
          (paid?.count
            ? `; ricerche a pagamento ${paid.count} (${paid.costUsd.toFixed(4)} $)`
            : ''),
      );
    }
  }
  mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(RESULTS, `${args.label}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ label: args.label, results }, null, 2)}\n`);
  out();
  out(table(results));
  out();
  out(loopTable(results));
  out();
  out(`Risultati: ${file}`);
  out(`Richieste usate in tutto: ${spent()} su ${budget}`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
