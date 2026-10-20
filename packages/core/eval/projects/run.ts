import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { describeSchedule, type LogEvent, type Project } from '@monsters/shared';
import { startCore } from '../../src/index.ts';
import { PROFILE_ANSWERS } from '../cases.ts';

/*
 * Proposals of the orchestrator (D-098, not part of CI): ten requests, each in
 * a new conversation, with a project already there ("Sito Monsters"). A right
 * answer proposes a project or an automation when asked (with the schedule
 * understood), proposes nothing for a one-off request, sends work to a
 * project with project_send, and asks when the request is too vague. The
 * questions are not answered: a question parks the run.
 *
 *   node eval/projects/run.ts --label dopo [--model anthropic/claude-haiku-5.5] [--only 1,2]
 *
 * OpenRouter with OPENROUTER_PAID_API_KEY (or --key-name) from the .env of the
 * repo; stops before a request once `--max-usd` is spent.
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    model: { type: 'string', default: 'anthropic/claude-haiku-5.5' },
    'key-name': { type: 'string', default: 'OPENROUTER_PAID_API_KEY' },
    env: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string', default: join(here, 'results') },
    'timeout-s': { type: 'string', default: '180' },
    'max-usd': { type: 'string', default: '0.25' },
  },
});

interface Outcome {
  text: string;
  tools: string[];
  projects: Project[];
  automations: { cron: string; timezone: string }[];
  monsters: number;
}

interface Case {
  id: number;
  text: string;
  expect: string;
  check: (o: Outcome) => boolean;
}

const proposals = (o: Outcome) => o.projects.length + o.automations.length + o.monsters;
const asks = (o: Outcome) => o.tools.includes('ask_user') || /\?\s*$|\?\s*\n/m.test(o.text);
/** An automation (alone or in a project's proposal) at this schedule. */
const scheduled = (o: Outcome, text: string) =>
  [
    ...o.automations,
    ...o.projects.flatMap((p) => p.plan?.automations.map((a) => a.schedule) ?? []),
  ].some((s) => describeSchedule(s.cron) === text);

const CASES: Case[] = [
  {
    id: 1,
    text: 'Apri un progetto per i social di Studio Lumen con un social media manager e un grafico',
    expect: 'project_propose con capo e almeno due mostri',
    check: (o) => o.projects.length === 1 && (o.projects[0]!.plan?.members.length ?? 0) >= 2,
  },
  {
    id: 2,
    text: 'Ogni domenica alle 23 preparate i post della settimana per i social',
    expect: 'automazione la domenica alle 23:00 (da sola o in un progetto)',
    check: (o) => scheduled(o, 'ogni domenica alle 23:00'),
  },
  {
    id: 3,
    text: 'Ogni mattina alle 8 preparami un riassunto delle novità della ristorazione',
    expect: 'automation_propose ogni giorno alle 8:00',
    check: (o) => scheduled(o, 'ogni giorno alle 8:00') && o.projects.length === 0,
  },
  {
    id: 4,
    text: 'Il primo di ogni mese alle 9 fammi il resoconto delle spese del mese prima',
    expect: 'automation_propose il 1° di ogni mese alle 9:00',
    check: (o) => scheduled(o, 'il 1° di ogni mese alle 9:00') && o.projects.length === 0,
  },
  {
    id: 5,
    text: 'Scrivimi un post per Instagram sul menu di stasera',
    expect: 'nessuna proposta: è un lavoro di adesso',
    check: (o) => proposals(o) === 0,
  },
  {
    id: 6,
    text: 'Che progetti abbiamo adesso?',
    expect: 'nessuna proposta (al più project_status)',
    check: (o) => proposals(o) === 0,
  },
  {
    id: 7,
    text: 'Domani alle 10 ricordami di chiamare il fornitore del pesce',
    expect: 'nessuna automazione: non si ripete',
    check: (o) => proposals(o) === 0,
  },
  {
    id: 8,
    text: 'Fai controllare al progetto Sito Monsters se ci sono link rotti nel sito',
    expect: 'project_send al progetto, nessuna proposta',
    check: (o) => o.tools.includes('project_send') && proposals(o) === 0,
  },
  {
    id: 9,
    text: 'Apri un progetto',
    expect: 'chiede per cosa, nessuna proposta',
    check: (o) => proposals(o) === 0 && asks(o),
  },
  {
    id: 10,
    text: 'Vorrei automatizzare un po’ di lavoro ripetitivo',
    expect: 'chiede cosa e quando, nessuna proposta',
    check: (o) => proposals(o) === 0 && asks(o),
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
  request: string;
  steps: number;
  firstInput: number;
  inputTokens: number;
  costUsd: number;
  tools: string[];
  errors: string[];
  proposed: string[];
  ok: boolean;
  status: string;
  answer: string;
}

async function main(): Promise<void> {
  const key = loadKey(args['key-name']);
  const base = mkdtempSync(join(tmpdir(), 'monsters-projects-'));
  const home = join(base, 'home');
  const model = { provider: 'openrouter', model: args.model };
  const core = await startCore({
    home,
    port: 0,
    env: { OPENROUTER_API_KEY: key },
    webDist: false,
    hub: {
      onboardingGenerate: null,
      teamModels: [model],
      // A question parks the run at once: nobody answers here.
      askWaitMs: 200,
      settings: { watchVault: false, openrouter: { freeOnly: false } },
    },
  });
  const { hub, log } = core;
  const rows: Row[] = [];
  let spent = 0;
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
    await hub.projects.create(
      { name: 'Sito Monsters', lead: { name: 'Lia', models: [model] } },
      'cli',
    );
    const only = args.only ? new Set(args.only.split(',').map(Number)) : null;
    for (const c of CASES.filter((x) => !only || only.has(x.id))) {
      if (spent >= Number(args['max-usd'])) {
        process.stdout.write(`budget reached (${spent.toFixed(4)} $): stop\n`);
        break;
      }
      hub.newConversation({ channel: 'cli' });
      const sent = hub.send({ text: c.text, channel: 'cli' });
      const runId = sent.runId;
      await new Promise<void>((done) => {
        const timer = setTimeout(
          () => void core.runs.killRun(runId, { by: 'cli', reason: 'eval timeout' }),
          Number(args['timeout-s']) * 1000,
        );
        const off = log.subscribe((e) => {
          if (e.runId === runId && e.type === 'run' && e.data.status !== 'started') {
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
        .filter(
          (e): e is LogEvent<'tool_call'> => e.type === 'tool_call' && e.agent === capo.config.id,
        )
        .map((e) => e.data.tool);
      const answer =
        events
          .filter(
            (e): e is LogEvent<'message'> =>
              e.type === 'message' &&
              e.agent === capo.config.id &&
              e.data.role === 'agent' &&
              !e.data.partial &&
              e.parentId === null,
          )
          .at(-1)?.data.text ?? '';
      const drafts = hub.drafts.list();
      const projects = drafts.flatMap((d) =>
        d.kind === 'project' ? [hub.team.project(d.id)!].filter(Boolean) : [],
      );
      const automations = drafts.flatMap((d) =>
        d.kind === 'automation' ? [d.automation.schedule] : [],
      );
      const monsters = drafts.filter((d) => d.kind === 'monster').length;
      const o: Outcome = { text: answer, tools, projects, automations, monsters };
      const run = events.find(
        (e): e is LogEvent<'run'> => e.type === 'run' && e.data.status !== 'started',
      );
      const cost = usage.reduce((n, u) => n + (u.data.costUsd ?? 0), 0);
      spent += cost;
      const row: Row = {
        id: c.id,
        request: c.text,
        steps: usage.length,
        firstInput: usage[0]?.data.inputTokens ?? 0,
        inputTokens: usage.reduce((n, u) => n + (u.data.inputTokens ?? 0), 0),
        costUsd: cost,
        tools,
        errors: events
          .filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && !e.data.ok)
          .map((e) => `${e.data.tool}: ${(e.data.error ?? '').slice(0, 200)}`),
        proposed: drafts.map((d) =>
          d.kind === 'automation'
            ? `automation ${d.title} (${d.automation.schedule.cron})`
            : `${d.kind} ${d.title}`,
        ),
        ok: c.check(o),
        status: run?.data.status ?? '?',
        answer,
      };
      rows.push(row);
      process.stdout.write(
        `#${c.id} ${row.ok ? '✓' : '✗'} passi ${row.steps}, primo ${row.firstInput}, $${cost.toFixed(4)}, [${tools.join(', ')}] ${row.proposed.join('; ')}\n   ${answer.replace(/\s+/g, ' ').slice(0, 200)}\n`,
      );
      // Each request on its own: the drafts and the questions go.
      for (const d of drafts) await hub.drafts.discard(d.kind, d.id, 'cli').catch(() => {});
      hub.questions.expireOpen({}, 'run_ended');
    }
  } finally {
    save(rows, spent);
    await core.close().catch(() => {});
    rmSync(base, { recursive: true, force: true });
  }
}

function save(rows: Row[], spent: number): void {
  const summary = {
    label: args.label,
    model: args.model,
    requests: rows.length,
    right: rows.filter((r) => r.ok).length,
    steps: rows.reduce((n, r) => n + r.steps, 0),
    firstInput: rows.map((r) => r.firstInput),
    costUsd: Number(spent.toFixed(5)),
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
