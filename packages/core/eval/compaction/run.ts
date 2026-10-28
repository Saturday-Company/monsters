import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LogEvent } from '@monsters/shared';
import { startCore } from '../../src/index.ts';
import { PROFILE_ANSWERS } from '../cases.ts';

/*
 * A long conversation (C.3, D-082; not part of CI): 30 turns with a monster
 * of the team on a real OpenRouter model. Facts come early (a name, two
 * numbers, a preference, a decision), web searches and notes in between, the
 * facts are asked back at the end. Per turn: input tokens, peak context over
 * the window; in all: recall of the facts, summaries and their cost, context
 * errors. `--before` runs the same with the summary off (the latest 12 turns,
 * as before D-082).
 *
 *   node eval/compaction/run.ts --model qwen/qwen-2.5-7b-instruct [--before]
 *
 * Paid models with OPENROUTER_PAID_API_KEY of the repo's .env; `--cap` stops
 * before going over a spending cap (default 0.15 $ a run).
 */

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'qwen/qwen-2.5-7b-instruct' },
    before: { type: 'boolean', default: false },
    'key-name': { type: 'string', default: 'OPENROUTER_PAID_API_KEY' },
    env: { type: 'string' },
    cap: { type: 'string', default: '0.15' },
    out: { type: 'string', default: join(here, 'results') },
    'timeout-s': { type: 'string', default: '240' },
  },
});

/** The facts, said once at the start, and how an answer shows it remembers them. */
const FACTS = [
  {
    id: 'nome',
    say: 'Prima cosa da sapere: il mio socio si chiama Arturo Benassi, segnatelo.',
    ask: 'Come si chiama il mio socio? Rispondi solo con il nome.',
    check: /arturo\s+benassi/i,
  },
  {
    id: 'budget',
    say: 'Il budget per il sito nuovo è 4.750 euro, IVA esclusa.',
    ask: 'Qual è il budget del sito nuovo, ed è IVA inclusa o esclusa? Una riga.',
    check: /4[.\s]?750/,
  },
  {
    id: 'preferenza',
    say: 'Una preferenza: le bozze che mi prepari le voglio sempre in elenco puntato, mai in tabella.',
    ask: 'In che forma voglio le bozze che mi prepari? Una riga.',
    check: /elenc\w*\s+puntat|punti elenco|elenco a punti/i,
  },
  {
    id: 'decisione',
    say: 'Abbiamo deciso: il lancio del sito è il 12 marzo 2027, non prima.',
    ask: 'Che data abbiamo deciso per il lancio del sito? Una riga.',
    check: /12\s+marzo(\s+2027)?|12\/0?3\/2027/i,
  },
  {
    id: 'codice',
    say: 'Il codice cliente di Rossi è RX-4471.',
    ask: 'Qual è il codice cliente di Rossi? Solo il codice.',
    check: /RX-?4471/i,
  },
] as const;

/** The turns in between: web searches, notes, small tasks. */
const MIDDLE = [
  'Cerca sul web chi ha scritto «Il nome della rosa» e dimmelo in una riga.',
  'Cerca sul web quanti abitanti ha Bologna, più o meno, e citami la fonte.',
  'Scrivimi tre idee per un post Instagram su una torta di mele, brevi.',
  'Cerca sul web in che anno è stata fondata la FIAT.',
  'Riassumi in due righe cos’è il cold brew.',
  'Salva una nota «Idee post autunno» con le tre idee di prima.',
  'Cerca sul web qual è la montagna più alta degli Appennini.',
  'Dammi un titolo accattivante per un articolo sul caffè filtro.',
  'Cerca sul web la ricetta base del tiramisù e dimmi gli ingredienti in elenco.',
  'Che differenza c’è tra un espresso e un ristretto? Breve.',
  'Cerca sul web chi ha dipinto la Primavera.',
  'Scrivi una frase di benvenuto per un nuovo cliente, cordiale.',
  'Cerca sul web quando è nato Dante Alighieri.',
  'Proponimi tre nomi per una newsletter di un bar.',
  'Cerca sul web cosa significa «brunch» e da dove viene la parola.',
  "Correggi questa frase: «qual'è il tuo orario?»",
  'Cerca sul web la capitale dell’Australia.',
  'Fammi una lista di 4 hashtag per un post sul caffè.',
  'Cerca sul web quanto è lungo il fiume Po.',
  'Scrivi due righe per annunciare un nuovo dolce nel menu.',
];

const TURNS: { text: string; fact?: string }[] = [
  ...FACTS.map((f) => ({ text: f.say })),
  ...MIDDLE.map((text) => ({ text })),
  ...FACTS.map((f) => ({ text: f.ask, fact: f.id })),
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

interface Turn {
  n: number;
  text: string;
  status: string;
  steps: number;
  inputTokens: number;
  costUsd: number;
  peakPct: number | null;
  answer: string;
  fact?: string;
  recalled?: boolean;
}

async function main(): Promise<void> {
  const key = loadKey(args['key-name']);
  const cap = Number(args.cap);
  const base = mkdtempSync(join(tmpdir(), 'monsters-compaction-'));
  const model = { provider: 'openrouter', model: args.model };
  const core = await startCore({
    home: join(base, 'home'),
    port: 0,
    env: { OPENROUTER_API_KEY: key },
    webDist: false,
    hub: {
      onboardingGenerate: null,
      teamModels: [model],
      settings: {
        watchVault: false,
        openrouter: { freeOnly: false },
        conversationSummary: !args.before,
      },
    },
  });
  const { hub, log } = core;
  const turns: Turn[] = [];
  try {
    await hub.onboarding.submit({
      answers: PROFILE_ANSWERS,
      permissions: { vault: true, web: true },
    });
    const state = await hub.onboarding.propose();
    await hub.onboarding.confirm({
      members: (state.proposal?.members ?? []).map((m) => ({ id: m.id })),
    });
    // A member with the web and the notes: the conversation is with it directly.
    const member = hub.team
      .list()
      .find((a) => a.config.kind !== 'orchestrator' && a.config.tools.includes('web_search'));
    if (!member) throw new Error('no member with the web');
    const to = member.config.id;
    process.stdout.write(
      `${args.before ? 'prima' : 'dopo'} · ${args.model} · ${member.config.name}\n`,
    );
    hub.newConversation({ channel: 'cli', to });
    let spent = 0;
    for (const [i, t] of TURNS.entries()) {
      if (spent >= cap) {
        process.stdout.write(`tetto di ${cap} $ raggiunto: mi fermo\n`);
        break;
      }
      const sent = hub.send({ text: t.text, to, channel: 'cli' });
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
      // The summary for the next turn is written after this one (D-082): a person takes longer to type.
      await hub.compactor.idle();
      const events = log.all({ runId });
      const usage = events.filter(
        (e): e is LogEvent<'provider_usage'> =>
          e.type === 'provider_usage' && e.agent === to && e.data.purpose !== 'compaction',
      );
      const all = events.filter(
        (e): e is LogEvent<'provider_usage'> => e.type === 'provider_usage',
      );
      const run = events.find(
        (e): e is LogEvent<'run'> => e.type === 'run' && e.data.status !== 'started',
      );
      const final = events.filter(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' &&
          e.agent === to &&
          e.data.role === 'agent' &&
          !e.data.partial &&
          e.parentId === null,
      );
      const peak = usage.reduce(
        (m, u) =>
          u.data.context?.window
            ? Math.max(m, (100 * u.data.context.total) / u.data.context.window)
            : m,
        0,
      );
      const cost = all.reduce((s, u) => s + (u.data.costUsd ?? 0), 0);
      spent += cost;
      const answer = final.at(-1)?.data.text ?? '';
      const fact = FACTS.find((f) => f.id === t.fact);
      const row: Turn = {
        n: i + 1,
        text: t.text,
        status: run?.data.status ?? '?',
        steps: usage.length,
        inputTokens: usage.reduce((s, u) => s + (u.data.inputTokens ?? 0), 0),
        costUsd: Number(cost.toFixed(6)),
        peakPct: peak ? Number(peak.toFixed(1)) : null,
        answer: answer.slice(0, 400),
        ...(fact ? { fact: fact.id, recalled: fact.check.test(answer) } : {}),
      };
      turns.push(row);
      const summarized = events.some((e) => e.type === 'conversation_summary');
      process.stdout.write(
        `#${row.n} ${row.status} passi ${row.steps} in ${row.inputTokens} picco ${row.peakPct ?? '?'}% $${row.costUsd.toFixed(5)}${summarized ? ' [riassunto]' : ''}${fact ? ` ${row.recalled ? '✓' : '✗'} ${fact.id}: ${answer.replace(/\s+/g, ' ').slice(0, 100)}` : ''}\n`,
      );
    }
    const everything = log.all();
    const summaries = everything.filter(
      (e): e is LogEvent<'conversation_summary'> => e.type === 'conversation_summary',
    );
    const compaction = everything.filter(
      (e): e is LogEvent<'provider_usage'> =>
        e.type === 'provider_usage' && e.data.purpose === 'compaction',
    );
    const errors = everything
      .filter((e): e is LogEvent<'error'> => e.type === 'error')
      .map((e) => `${e.data.code}: ${e.data.message.slice(0, 160)}`);
    const window = everything.find(
      (e): e is LogEvent<'provider_usage'> =>
        e.type === 'provider_usage' && e.data.context?.window !== undefined,
    )?.data.context?.window;
    const summary = {
      label: args.before ? 'prima' : 'dopo',
      model: args.model,
      window: window ?? null,
      turns: turns.length,
      recalled: turns.filter((t) => t.recalled).length,
      asked: turns.filter((t) => t.fact).length,
      peakPct: Math.max(...turns.map((t) => t.peakPct ?? 0)),
      inputTokens: turns.reduce((s, t) => s + t.inputTokens, 0),
      inputPerTurnLast10: Math.round(
        turns.slice(-10).reduce((s, t) => s + t.inputTokens, 0) /
          Math.max(1, turns.slice(-10).length),
      ),
      costUsd: Number(turns.reduce((s, t) => s + t.costUsd, 0).toFixed(5)),
      summaries: summaries.length,
      compactionCalls: compaction.length,
      compactionTokens: compaction.reduce(
        (s, u) => s + (u.data.inputTokens ?? 0) + (u.data.outputTokens ?? 0),
        0,
      ),
      compactionCostUsd: Number(
        compaction.reduce((s, u) => s + (u.data.costUsd ?? 0), 0).toFixed(6),
      ),
      contextErrors: errors.filter((e) => /contesto|context/i.test(e)).length,
      failed: turns.filter((t) => t.status !== 'completed').length,
    };
    mkdirSync(args.out, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = args.model.replace(/[^a-z0-9.-]+/gi, '_');
    const file = join(args.out, `${summary.label}-${slug}-${stamp}.json`);
    writeFileSync(
      file,
      `${JSON.stringify({ summary, turns, errors, lastSummary: summaries.at(-1)?.data.text ?? null, summaryLengths: summaries.map((x) => ({ turns: x.data.turns, chars: x.data.text.length })) }, null, 2)}\n`,
    );
    process.stdout.write(`\n${JSON.stringify(summary)}\nRisultati: ${file}\n`);
  } finally {
    await core.close();
    rmSync(base, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
