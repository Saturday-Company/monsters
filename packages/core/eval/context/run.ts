import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LogEvent } from '@monsters/shared';
import { startCore } from '../../src/index.ts';
import {
  ANTEIKU_DATA,
  anteikuToolDefs,
  startFakeAnteiku,
} from '../../test/fixtures/fake-anteiku-server.ts';
import {
  GITHUB_DATA,
  GITHUB_TOOLS,
  startFakeGithub,
} from '../../test/fixtures/fake-github-server.ts';
import { PROFILE_ANSWERS } from '../cases.ts';

/*
 * How a monster uses big MCP servers (C.2, D-075; not part of CI): the capo
 * squadra on a real OpenRouter model works on a fake server with a long tool
 * list and long results. Two cases (`--case`):
 *
 *   anteiku (default)  a fake Anteiku (124 tools, Italian): find a client, read
 *                      the lists and create a task. Success = the fake saw
 *                      `anteiku_task_crea` with the project "Sito web Rossi".
 *   github             a fake GitHub (~90 tools, English, repo acme/website,
 *                      `list_issues` without filters is over 10,000 characters):
 *                      summarize the open bugs, read the comments of the login
 *                      redirect issue and open a follow-up issue. Success = the
 *                      fake saw `create_issue` with a title like "Follow up on
 *                      login redirect".
 *   both               anteiku then github, for each of `--times` (the cap is
 *                      shared by all runs).
 *
 *   node eval/context/run.ts --label dopo --case github --model openai/gpt-oss-20b --times 2
 *
 * Per run: steps, input tokens per step and in all, the tools' share of the
 * first request, peak context against the model's window, cost, success, and
 * how the monster handled access and approval:
 *   - questions by kind: `ask` (ask_user), `access` (access_request cards),
 *     `brake` (the card of one tool call) and, for the brake cards, which tools
 *     they were about and how many were read-only tools (by the fixtures' hints:
 *     a read that needed an approval is a false alarm);
 *   - calls of `access_request`, `ask_user`, `result_read` and `tools_search`.
 * The one-line output and the JSON summary carry them (totals over the runs).
 *
 * Paid models with OPENROUTER_PAID_API_KEY of the repo's .env (`--key-name`),
 * `--cap` stops before going over a spending cap (default 0.30 $). Results go to
 * `results/<label>-<case>-<time>.json`. To measure "before", copy this file and
 * the fixtures into a checkout of the old commit.
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    case: { type: 'string', default: 'anteiku' },
    model: { type: 'string', default: 'openai/gpt-oss-20b' },
    'key-name': { type: 'string', default: 'OPENROUTER_PAID_API_KEY' },
    env: { type: 'string' },
    times: { type: 'string', default: '1' },
    cap: { type: 'string', default: '0.30' },
    out: { type: 'string', default: join(here, 'results') },
    'timeout-s': { type: 'string', default: '420' },
    /** Also writes every event of each run (tool calls and results) next to the results. */
    dump: { type: 'boolean', default: false },
    /** The instinct on (Jev, `TYPESAFE_API_KEY` of the env file): the brake judges writes as in the app. */
    instinct: { type: 'boolean', default: false },
  },
});

type CaseName = 'anteiku' | 'github' | 'demo';

/** A fake MCP server of a case: what the eval needs of both fixtures. */
interface Fake {
  mcpUrl: string;
  personalToken: string;
  calls: { tool: string; args: Record<string, unknown> }[];
  close(): Promise<void>;
}

interface CaseDef {
  id: CaseName;
  /** The name the server is registered under (default the id): tools are `mcp__<server>__<tool>`. */
  server?: string;
  label: string;
  /** Prefix in the printed tool list (`A:`, `G:`). */
  short: string;
  task: string;
  /** Said to a monster that asks something the card cannot answer. */
  fallbackAnswer: string;
  /** `catalog` of the registration (Anteiku has a built-in one, GitHub none). */
  catalog?: string;
  start(): Promise<Fake>;
  /** Did the run do the task: the fake's calls, or the tools the run called (a real server). */
  success(fake: Fake, called: readonly string[], answer: string): boolean;
  /** Whether a tool (the server's own name) only reads; undefined when unknown. */
  readOnly(tool: string): boolean | undefined;
}

/** The project the task must go in. */
const PROJECT = ANTEIKU_DATA.progetti.find((p) => p.nome === 'Sito web Rossi')!.id;

const ANTEIKU_READ = new Map<string, boolean>([
  ...anteikuToolDefs().map((t) => [t.name, t.readOnly] as const),
  ['search', true],
  ['fetch', true],
]);
const GITHUB_READ = new Map(GITHUB_TOOLS.map((t) => [t.name, t.readOnly] as const));

const CASES: Record<CaseName, CaseDef> = {
  anteiku: {
    id: 'anteiku',
    label: 'Anteiku',
    short: 'A:',
    task:
      'In Anteiku: fammi prima un riepilogo dei clienti attivi di Milano (guarda l’elenco completo dei clienti), ' +
      'poi trova il cliente Rossi e guarda le task già aperte del suo progetto «Sito web Rossi». ' +
      'Infine crea in quel progetto la task «Chiamare Rossi per la revisione» con scadenza 2026-11-20. ' +
      'Rispondi con il riepilogo e l’id della task creata.',
    fallbackAnswer: 'Decidi tu.',
    catalog: 'anteiku',
    start: startFakeAnteiku,
    success: (fake) =>
      fake.calls.some(
        (c) =>
          c.tool === 'anteiku_task_crea' &&
          c.args['progetto_id'] === PROJECT &&
          typeof c.args['titolo'] === 'string' &&
          /chiamare rossi/i.test(c.args['titolo']),
      ),
    readOnly: (tool) => ANTEIKU_READ.get(tool),
  },
  github: {
    id: 'github',
    label: 'GitHub',
    short: 'G:',
    task:
      'On GitHub, repo acme/website: first give me a summary of the open issues labeled bug (look at the full list), ' +
      'then find the issue about the login page redirect and read its comments. ' +
      'Finally create an issue titled "Follow up on login redirect" with the label bug that links the original issue number in the body. ' +
      'Reply with the summary and the number of the new issue.',
    fallbackAnswer: 'You decide.',
    start: startFakeGithub,
    success: (fake) =>
      fake.calls.some(
        (c) =>
          c.tool === 'create_issue' &&
          c.args['owner'] === GITHUB_DATA.owner &&
          c.args['repo'] === GITHUB_DATA.repo &&
          typeof c.args['title'] === 'string' &&
          /follow up on login redirect/i.test(c.args['title']),
      ),
    readOnly: (tool) => GITHUB_READ.get(tool),
  },
  // The real demo of Anteiku (D-163), read only: a personal token of one day made for the trial
  // and revoked after it, in a file outside the repo. Never in CI.
  demo: {
    id: 'demo',
    server: 'anteiku',
    label: 'Anteiku',
    short: 'A:',
    task:
      'In Anteiku: fammi un riepilogo dei clienti attivi, poi trova il cliente Ferramenta Colli ' +
      'e dimmi quali task sono aperte nei suoi progetti. Non modificare niente.',
    fallbackAnswer: 'Decidi tu.',
    catalog: 'anteiku',
    start: () => {
      const url = process.env.MONSTERS_EVAL_DEMO_URL;
      const file = process.env.MONSTERS_EVAL_DEMO_TOKEN_FILE;
      if (!url || !file)
        throw new Error('demo: MONSTERS_EVAL_DEMO_URL and MONSTERS_EVAL_DEMO_TOKEN_FILE');
      const token = (JSON.parse(readFileSync(file, 'utf8')) as { gettone: string }).gettone;
      return Promise.resolve({
        mcpUrl: url,
        personalToken: token,
        calls: [],
        close: () => Promise.resolve(),
      });
    },
    success: (_fake, called, answer) =>
      called.some((t) => /clienti_(elenca|leggi)|^search$/.test(t)) &&
      called.some((t) => /task_(elenca|leggi)|progetti_leggi/.test(t)) &&
      answer.trim().length > 0,
    readOnly: (tool) => ANTEIKU_READ.get(tool),
  },
};

const caseNames = (): CaseName[] => {
  const c = args.case;
  if (c === 'both') return ['anteiku', 'github'];
  if (c === 'anteiku' || c === 'github' || c === 'demo') return [c];
  throw new Error(`--case must be anteiku, github, both or demo (got ${c})`);
};

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

/** Tools whose calls are counted: how the monster asks for access, for approval, and reads results. */
const COUNTED = ['access_request', 'ask_user', 'result_read', 'tools_search'] as const;

interface Row {
  label: string;
  case: CaseName;
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
  /** `question` events by kind: `ask` = ask_user, `access` = access_request cards, `brake` = brake cards. */
  questions: { ask: number; access: number; brake: number };
  /** The tool each brake card was about (short names; `?` when the log does not say). */
  brakeTools: string[];
  /** Brake cards on tools that only read: approvals the monster should not have needed. */
  brakeOnReads: number;
  /** Calls of `access_request`, `ask_user`, `result_read`, `tools_search`. */
  toolCalls: Record<(typeof COUNTED)[number], number>;
  errors: string[];
  answer: string;
}

async function once(key: string, n: number, def: CaseDef): Promise<Row> {
  const base = mkdtempSync(join(tmpdir(), 'monsters-context-'));
  const fa = await def.start();
  const model = { provider: 'openrouter', model: args.model };
  const core = await startCore({
    home: join(base, 'home'),
    port: 0,
    env: {
      OPENROUTER_API_KEY: key,
      ...(args.instinct ? { TYPESAFE_API_KEY: loadKey('TYPESAFE_API_KEY') } : {}),
    },
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
      def.server ?? def.id,
      {
        transport: 'http',
        url: fa.mcpUrl,
        label: def.label,
        ...(def.catalog ? { catalog: def.catalog } : {}),
        headers: { Authorization: `Bearer ${fa.personalToken}` },
        agents: [capo.config.id],
      },
      'cli',
      undefined, // an http server: nothing it launches
    );
    hub.newConversation({ channel: 'cli' });
    const sent = hub.send({ text: def.task, channel: 'cli' });
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
                first ? { optionId: e.data.recommended ?? first.id } : { text: def.fallbackAnswer },
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
    const events = log.all({ runId });
    if (args.dump) {
      mkdirSync(args.out, { recursive: true });
      writeFileSync(
        join(args.out, `dump-${args.label}-${n}-${Date.now()}.json`),
        `${JSON.stringify(events, null, 1)}\n`,
      );
    }
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
    const contexts = usage.flatMap((u) => (u.data.context ? [u.data.context] : []));
    const windowOf = contexts.find((c) => c.window)?.window ?? null;
    const peak = contexts.reduce(
      (m, c) => (c.window ? Math.max(m, (100 * c.total) / c.window) : m),
      0,
    );
    const toolEvents = events.filter((e): e is LogEvent<'tool_call'> => e.type === 'tool_call');
    const prefix = `mcp__${def.server ?? def.id}__`;
    const short = (tool: string) => tool.replace(prefix, def.short);
    const questions = events.filter((e): e is LogEvent<'question'> => e.type === 'question');
    // A brake card hangs from the call it holds (`parentId` = the `tool_call` event).
    const brakeTools = questions
      .filter((q) => q.data.kind === 'brake')
      .map((q) => toolEvents.find((t) => t.id === q.parentId)?.data.tool ?? '?');
    const brakeOnReads = brakeTools.filter(
      (t) => t.startsWith(prefix) && def.readOnly(t.slice(prefix.length)) === true,
    ).length;
    const row: Row = {
      label: args.label,
      case: def.id,
      model: args.model,
      status: run?.data.status ?? '?',
      success: def.success(
        fa,
        toolEvents.flatMap((e) =>
          e.data.tool.startsWith(prefix) ? [e.data.tool.slice(prefix.length)] : [],
        ),
        finals.at(-1)?.data.text ?? '',
      ),
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
      tools: toolEvents.map((e) => short(e.data.tool)),
      questions: {
        ask: questions.filter((q) => q.data.kind === undefined).length,
        access: questions.filter((q) => q.data.kind === 'access').length,
        brake: brakeTools.length,
      },
      brakeTools: brakeTools.map(short),
      brakeOnReads,
      toolCalls: Object.fromEntries(
        COUNTED.map((name) => [name, toolEvents.filter((e) => e.data.tool === name).length]),
      ) as Row['toolCalls'],
      errors: events
        .filter((e): e is LogEvent<'error'> => e.type === 'error')
        .map((e) => `${e.data.code}: ${e.data.message.slice(0, 200)}`),
      answer: finals.at(-1)?.data.text ?? '',
    };
    process.stdout.write(
      `#${n} ${def.id} ${row.success ? '✓' : '✗'} ${row.status} passi ${row.steps}, in ${row.inputTokens} (${row.inputPerStep.join(' ')}), strumenti al primo ${row.firstTools}, picco ${row.peakContextPct ?? '?'}% di ${row.window ?? '?'}, $${row.costUsd.toFixed(4)}\n   domande ask ${row.questions.ask} access ${row.questions.access} brake ${row.questions.brake} (su letture ${row.brakeOnReads}${row.brakeTools.length ? `: ${row.brakeTools.join(' ')}` : ''}), chiamate ${COUNTED.map((c) => `${c} ${row.toolCalls[c]}`).join(' ')}\n   ${row.tools.join(', ')}\n${row.errors.map((x) => `   ! ${x}\n`).join('')}`,
    );
    return row;
  } finally {
    await core.close();
    await fa.close();
    rmSync(base, { recursive: true, force: true });
  }
}

/** Averages and totals of the rows of one case (or of all). */
function summarize(rows: Row[]) {
  const avg = (k: 'steps' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'firstTools') =>
    rows.length ? rows.reduce((s, r) => s + r[k], 0) / rows.length : 0;
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    runs: rows.length,
    success: rows.filter((r) => r.success).length,
    steps: avg('steps'),
    inputTokens: Math.round(avg('inputTokens')),
    firstTools: Math.round(avg('firstTools')),
    peakContextPct: Math.max(0, ...rows.map((r) => r.peakContextPct ?? 0)),
    costUsd: Number(sum((r) => r.costUsd).toFixed(5)),
    questions: {
      ask: sum((r) => r.questions.ask),
      access: sum((r) => r.questions.access),
      brake: sum((r) => r.questions.brake),
    },
    brakeOnReads: sum((r) => r.brakeOnReads),
    toolCalls: Object.fromEntries(
      COUNTED.map((name) => [name, sum((r) => r.toolCalls[name])]),
    ) as Row['toolCalls'],
  };
}

async function main(): Promise<void> {
  const names = caseNames();
  const key = loadKey(args['key-name']);
  const cap = Number(args.cap);
  const rows: Row[] = [];
  runs: for (let i = 1; i <= Number(args.times); i++) {
    for (const name of names) {
      const spent = rows.reduce((s, r) => s + r.costUsd, 0);
      if (spent >= cap) {
        process.stdout.write(`tetto di ${cap} $ raggiunto: mi fermo\n`);
        break runs;
      }
      rows.push(await once(key, i, CASES[name]));
    }
  }
  const summary = {
    label: args.label,
    model: args.model,
    case: args.case,
    ...summarize(rows),
    byCase: Object.fromEntries(
      names.map((name) => [name, summarize(rows.filter((r) => r.case === name))]),
    ),
  };
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(args.out, `${args.label}-${args.case}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  process.stdout.write(`\n${JSON.stringify(summary)}\nRisultati: ${file}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
