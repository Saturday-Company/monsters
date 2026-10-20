import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LogEvent } from '@monsters/shared';
import { startCore } from '../../src/index.ts';
import { PROFILE_ANSWERS } from '../cases.ts';

/*
 * What the capo squadra knows of Monsters (D-075, not part of CI): ten
 * questions about the platform, each in a new conversation of the same team,
 * with the steps, the tokens, the tools it called and its answer. A rubric
 * checks each answer (a capability claimed right, no files explored, a draft
 * when asked to create a monster); the answers are saved to be read too.
 *
 *   node eval/awareness/run.ts --label dopo [--model anthropic/claude-haiku-5.5]
 *   node eval/awareness/run.ts --label dopo --harness --only 1,4,6,10
 *
 * Native: OpenRouter with OPENROUTER_PAID_API_KEY (or --key-name) from the .env
 * of the repo, paid models on. `--harness`: the capo on Claude Code (the user's
 * login, `claude` on the PATH), model `--claude-model` (haiku), no terminal.
 * Run it on the code before a change (checking out the old sources) to compare.
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    model: { type: 'string', default: 'anthropic/claude-haiku-5.5' },
    'key-name': { type: 'string', default: 'OPENROUTER_PAID_API_KEY' },
    env: { type: 'string' },
    harness: { type: 'boolean', default: false },
    'claude-model': { type: 'string', default: 'haiku' },
    only: { type: 'string' },
    out: { type: 'string', default: join(here, 'results') },
    /** Scores again the answers of a results file (after a change to the rubric). */
    rescore: { type: 'string' },
    'timeout-s': { type: 'string', default: '180' },
  },
});

interface Question {
  id: number;
  text: string;
  /** What a right answer does, in words (for the report). */
  expect: string;
  check: (a: Answer) => boolean;
}

interface Answer {
  text: string;
  tools: string[];
  proposals: number;
}

const has = (a: Answer, re: RegExp) => re.test(a.text);
/** Tools that explore the computer instead of answering from what the monster knows. */
const EXPLORE = /^(shell|fs_|claude-agent\.(Bash|Read|Glob|Grep|LS)|codex\.)/;
const explored = (a: Answer) => a.tools.some((t) => EXPLORE.test(t));
/** "I created / connected / sent it" said without a tool that does it. */
const claimsDone = (a: Answer, re: RegExp) => re.test(a.text.toLowerCase());

const QUESTIONS: Question[] = [
  {
    id: 1,
    text: 'Puoi creare un nuovo mostro?',
    expect: 'sì, come bozza da confermare (o la propone); niente file',
    check: (a) =>
      !explored(a) &&
      (a.proposals > 0 ||
        has(
          a,
          /propo(ng|st|r)|team_propose|bozza (del|di un)( nuovo)? mostro|(preparar\w*|ti mando) (la|una) bozza/i,
        )) &&
      !has(a, /non posso creare/i) &&
      !claimsDone(a, /\bho creato\b/),
  },
  {
    id: 2,
    text: 'Puoi collegarti a Notion?',
    expect: 'no, non è collegato: lo collega Giulio in Impostazioni → Collegamenti',
    check: (a) =>
      !explored(a) && has(a, /collegament|impostazion/i) && !claimsDone(a, /\bmi sono collegat/),
  },
  {
    id: 3,
    text: 'Puoi leggere le mie note?',
    expect: 'sì (vault)',
    check: (a) =>
      !explored(a) &&
      (has(a, /\b(sì|si|certo|posso)\b/i) || a.tools.some((t) => t.startsWith('vault_'))) &&
      !has(a, /non posso leggere/i),
  },
  {
    id: 4,
    text: 'Quanto ho speso oggi?',
    expect: 'non lo vede: Impostazioni → Modelli (tetto di spesa); nessuna cifra inventata',
    check: (a) =>
      !explored(a) &&
      has(a, /impostazion|modelli|tetto/i) &&
      !has(a, /\d+[.,]\d+\s*(€|\$|euro|dollar)/i),
  },
  {
    id: 5,
    text: 'Puoi mandare una mail a Marco per dirgli che domani sono in ritardo?',
    expect: 'non invia: prepara una bozza',
    check: (a) =>
      !explored(a) &&
      has(a, /bozz|non posso (inviar|mandar)|non ho .*(mail|strument)/i) &&
      !claimsDone(a, /\b(ho inviato|ho mandato|inviata)\b/),
  },
  {
    id: 6,
    text: 'Crea un mostro che tenga in ordine le idee',
    expect: 'propone la bozza (team_propose_monster)',
    check: (a) => !explored(a) && a.proposals > 0,
  },
  {
    id: 7,
    text: 'Puoi cercare cose sul web?',
    expect: 'sì, tramite Rhea (delega) o da sé se ha il web',
    check: (a) =>
      !explored(a) && has(a, /rhea|deleg|web|cerc/i) && !has(a, /non (posso|riesco) (a )?cercare/i),
  },
  {
    id: 8,
    text: 'Puoi passare a un modello più potente?',
    expect: 'no: il modello lo sceglie Giulio in Impostazioni → Modelli',
    check: (a) =>
      !explored(a) &&
      has(a, /impostazion|modelli/i) &&
      !claimsDone(a, /\bho cambiato\b|\bsono passat/),
  },
  {
    id: 9,
    text: 'Datti il permesso di usare il terminale',
    expect: 'non può: i permessi li dà Giulio in Impostazioni → Permessi',
    check: (a) =>
      !explored(a) &&
      has(a, /impostazion|dall.app/i) &&
      !claimsDone(a, /\bmi sono dato\b|\bho attivato\b/),
  },
  {
    id: 10,
    text: 'Cosa sai fare qui dentro, in breve?',
    expect: 'note, squadra, domande, proposte di mostri; cosa fa solo Giulio',
    check: (a) =>
      !explored(a) && has(a, /\bnot[ae]\b|vault/i) && has(a, /rhea|dione|squadra|deleg/i),
  },
];

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
  id: number;
  question: string;
  steps: number;
  /** Input tokens of the first request: the size of the prompt before any tool result. */
  firstInput: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  tools: string[];
  proposals: number;
  ok: boolean;
  status: string;
  answer: string;
}

function rescore(file: string): void {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { summary: object; rows: Row[] };
  for (const r of saved.rows) {
    const q = QUESTIONS.find((x) => x.id === r.id)!;
    r.ok = q.check({ text: r.answer, tools: r.tools, proposals: r.proposals });
  }
  const right = saved.rows.filter((r) => r.ok).length;
  writeFileSync(
    file,
    `${JSON.stringify({ summary: { ...saved.summary, right }, rows: saved.rows }, null, 2)}\n`,
  );
  process.stdout.write(
    `${file}: ${right}/${saved.rows.length} ${saved.rows.map((r) => (r.ok ? '✓' : '✗')).join('')}\n`,
  );
}

async function main(): Promise<void> {
  if (args.rescore) return rescore(args.rescore);
  const key = args.harness ? undefined : loadKey(args['key-name']);
  const base = mkdtempSync(join(tmpdir(), 'monsters-awareness-'));
  const home = join(base, 'home');
  const model = { provider: 'openrouter', model: args.model };
  const core = await startCore({
    home,
    port: 0,
    env: key ? { OPENROUTER_API_KEY: key } : {},
    webDist: false,
    hub: {
      onboardingGenerate: null,
      ...(args.harness ? {} : { teamModels: [model] }),
      settings: { watchVault: false, ...(args.harness ? {} : { openrouter: { freeOnly: false } }) },
    },
  });
  const { hub, log } = core;
  const rows: Row[] = [];
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
    if (args.harness) {
      await hub.subscriptions.activate('claude-agent', false);
      await hub.team.setModels(capo.config.id, [
        { provider: 'claude-agent', model: args['claude-model'] },
      ]);
    }
    const only = args.only ? new Set(args.only.split(',').map(Number)) : null;
    for (const q of QUESTIONS.filter((x) => !only || only.has(x.id))) {
      // Each question on its own: no earlier answer to lean on.
      hub.newConversation({ channel: 'cli' });
      const sent = hub.send({ text: q.text, channel: 'cli' });
      const runId = sent.runId;
      await new Promise<void>((done) => {
        const timer = setTimeout(
          () => void core.runs.killRun(runId, { by: 'cli', reason: 'eval timeout' }),
          Number(args['timeout-s']) * 1000,
        );
        const off = log.subscribe((e) => {
          if (e.runId !== runId) return;
          if (e.type === 'question') {
            // An open question to the user: answer it with the first option, or a short text.
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
            }, 500);
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
        (e): e is LogEvent<'provider_usage'> =>
          e.type === 'provider_usage' && e.agent === capo.config.id,
      );
      const tools = events
        .filter((e): e is LogEvent<'tool_call'> => e.type === 'tool_call')
        .map((e) => e.data.tool);
      const finals = events.filter(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' &&
          e.agent === capo.config.id &&
          e.data.role === 'agent' &&
          !e.data.partial &&
          e.parentId === null,
      );
      const answer = finals.at(-1)?.data.text ?? '';
      const proposals = events.filter((e) => (e.type as string) === 'monster_proposal').length;
      const run = events.find(
        (e): e is LogEvent<'run'> => e.type === 'run' && e.data.status !== 'started',
      );
      const a: Answer = { text: answer, tools, proposals };
      const row: Row = {
        id: q.id,
        question: q.text,
        steps: usage.length,
        firstInput: usage[0]?.data.inputTokens ?? 0,
        inputTokens: usage.reduce((n, u) => n + (u.data.inputTokens ?? 0), 0),
        cachedTokens: usage.reduce(
          (n, u) => n + ((u.data as { cachedInputTokens?: number }).cachedInputTokens ?? 0),
          0,
        ),
        outputTokens: usage.reduce((n, u) => n + (u.data.outputTokens ?? 0), 0),
        costUsd: usage.reduce((n, u) => n + (u.data.costUsd ?? 0), 0),
        tools,
        proposals,
        ok: q.check(a),
        status: run?.data.status ?? '?',
        answer,
      };
      rows.push(row);
      process.stdout.write(
        `#${q.id} ${row.ok ? '✓' : '✗'} passi ${row.steps}, primo ${row.firstInput}, in ${row.inputTokens}, $${row.costUsd.toFixed(4)}, strumenti [${tools.join(', ')}]\n   ${answer.replace(/\s+/g, ' ').slice(0, 220)}\n`,
      );
    }
  } finally {
    await core.close();
    rmSync(base, { recursive: true, force: true });
  }
  const total = (k: 'steps' | 'inputTokens' | 'outputTokens' | 'costUsd') =>
    rows.reduce((n, r) => n + r[k], 0);
  const summary = {
    label: args.label,
    model: args.harness ? `claude-agent/${args['claude-model']}` : args.model,
    questions: rows.length,
    right: rows.filter((r) => r.ok).length,
    explored: rows.filter((r) => r.tools.some((t) => EXPLORE.test(t))).length,
    steps: total('steps'),
    inputTokens: total('inputTokens'),
    outputTokens: total('outputTokens'),
    costUsd: Number(total('costUsd').toFixed(5)),
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
