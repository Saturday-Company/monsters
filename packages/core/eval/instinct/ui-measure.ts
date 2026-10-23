import { readFileSync } from 'node:fs';
import { JevDecisionPort, TYPESAFE_KEY_ENV } from '../../src/team/jev.ts';
import { triageRequest } from '../../src/team/instinct/questions.ts';
import { needsDrawnBlock } from '../../src/team/toolsets.ts';

/*
 * Does the answer to a request read better drawn (a chart, key numbers, a side-by-side
 * comparison, steps, a table) than as prose? Measure of Jev on hand-labelled requests,
 * against a rule on the words of the request (23/10/2026, plan of the chat interfaces).
 *
 *   node packages/core/eval/instinct/ui-measure.ts [--times 2]
 *
 * Needs TYPESAFE_API_KEY (from the environment or `.env` at the repo root). It asks what Monsters
 * asks (`triageRequest`, the `needs_ui` question of the English family) and scores the rule
 * Monsters uses (`needsDrawnBlock`), so the measure is the product's: change the question or the
 * words and run it again.
 */

interface Case {
  id: string;
  request: string;
  ui: boolean;
}

// Labelled before measuring. true: the answer has data that a chart, a table, key numbers,
// a comparison or steps show better than prose. false: conversation, a text to write, a fact.
const CASES: Case[] = [
  {
    id: 'u1',
    request: 'Confronta i piani di Notion, Obsidian e Craft: prezzi e cosa offrono',
    ui: true,
  },
  {
    id: 'u2',
    request: 'Come sono andate le vendite negli ultimi sei mesi? I dati sono nel file vendite.csv',
    ui: true,
  },
  {
    id: 'u3',
    request: 'Fammi un riepilogo dei numeri principali del report trimestrale',
    ui: true,
  },
  { id: 'u4', request: 'Quali sono i passi per aprire una partita IVA forfettaria?', ui: true },
  {
    id: 'u5',
    request: 'Cerca i concorrenti di WitDesk e dimmi prezzi e punti di forza di ognuno',
    ui: true,
  },
  { id: 'u6', request: 'Mostrami quanto ho speso questo mese per categoria', ui: true },
  {
    id: 'u7',
    request: 'Quale portatile mi conviene tra MacBook Air M4, Dell XPS 13 e ThinkPad X1?',
    ui: true,
  },
  {
    id: 'u8',
    request: 'Organizzami la settimana: ho tre consegne, due call e la palestra',
    ui: true,
  },
  {
    id: 'u9',
    request:
      'Compare the three hosting offers I received and tell me which one is cheaper over two years',
    ui: true,
  },
  {
    id: 'u10',
    request: 'How did our newsletter open rate change month by month this year?',
    ui: true,
  },
  { id: 'u11', request: 'Give me a checklist to prepare the product launch', ui: true },
  {
    id: 'u12',
    request: 'Show the status of the open projects: who is on what and what is late',
    ui: true,
  },
  { id: 'n1', request: 'Ciao! Come va oggi?', ui: false },
  { id: 'n2', request: 'Scrivimi un post per LinkedIn sul lancio di Monsters', ui: false },
  { id: 'n3', request: 'Rispondi alla mail di Marco dicendo che ci vediamo giovedì', ui: false },
  { id: 'n4', request: 'Cos’è un CRM? Spiegamelo in parole semplici', ui: false },
  { id: 'n5', request: 'Traduci in inglese questo paragrafo', ui: false },
  { id: 'n6', request: 'Ricordami domani alle 9 di chiamare il commercialista', ui: false },
  { id: 'n7', request: 'Riassumi l’articolo che ti ho mandato', ui: false },
  { id: 'n8', request: 'Hai finito la ricerca di ieri?', ui: false },
  { id: 'n9', request: 'Write a short thank-you note for the client', ui: false },
  { id: 'n10', request: 'What time is it in Tokyo now?', ui: false },
  { id: 'n11', request: 'Rename the draft note to "Roadmap 2027"', ui: false },
  { id: 'n12', request: 'Tell me a fun fact about octopuses', ui: false },
  // Borderline cases, labelled before the first measure of them.
  { id: 'b1', request: 'Qual è meglio per iniziare a programmare, Python o JavaScript?', ui: true },
  { id: 'b2', request: 'Che tempo fa questa settimana a Milano?', ui: true },
  { id: 'b3', request: 'Prepara il piano editoriale di novembre per Instagram', ui: true },
  { id: 'b4', request: 'Spiegami le differenze tra SRL e SRLS', ui: true },
  { id: 'b5', request: 'Break down the costs of the trip to Lisbon', ui: true },
  { id: 'b6', request: 'Dove siamo con il lavoro per il cliente Rossi?', ui: true },
  { id: 'b7', request: 'Fammi la lista della spesa per la cena di sabato', ui: true },
  { id: 'b8', request: 'Quanto costa l’abbonamento a Netflix?', ui: false },
  { id: 'b9', request: 'Quanti iscritti ha la newsletter?', ui: false },
  { id: 'b10', request: 'Analizza il sito di WitDesk e dimmi cosa miglioreresti', ui: false },
  { id: 'b11', request: 'Dammi tre idee per il nome del podcast', ui: false },
  { id: 'b12', request: 'Scrivi un report sui concorrenti da mandare al cliente', ui: false },
  { id: 'b13', request: 'Fammi una ricerca su come funziona il regime forfettario', ui: false },
  { id: 'b14', request: 'What will the weather be in London tomorrow?', ui: false },
];

function key(): string {
  const env = process.env[TYPESAFE_KEY_ENV];
  if (env) return env;
  const file = new URL('../../../../.env', import.meta.url);
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${TYPESAFE_KEY_ENV}=`));
  if (!line) throw new Error(`${TYPESAFE_KEY_ENV} missing`);
  return line.slice(TYPESAFE_KEY_ENV.length + 1).trim();
}

const out = (line = ''): void => void process.stdout.write(`${line}\n`);

const times = Number(process.argv[process.argv.indexOf('--times') + 1]) || 1;
const port = new JevDecisionPort({ key: key() });
const rows: { c: Case; p: number[]; rule: boolean; ms: number[] }[] = [];

for (const c of CASES) {
  const p: number[] = [];
  const ms: number[] = [];
  for (let i = 0; i < times; i++) {
    // The request Monsters sends: the `needs_ui` question of the English family.
    const req = triageRequest({
      request: c.request,
      history: [],
      members: [],
      ask: { route: false, tier: false, web: false, rare: false, ui: true },
    });
    const t0 = Date.now();
    const res = await port.decide(req);
    ms.push(Date.now() - t0);
    p.push(Number(res.answers.find((a) => a.id === 'needs_ui')?.value));
  }
  rows.push({ c, p, rule: needsDrawnBlock(c.request), ms });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const r of rows) {
  const pm = mean(r.p);
  out(
    `${r.c.id.padEnd(4)} ${r.c.ui ? 'UI ' : '-- '} jev=${pm.toFixed(2)} ${pm >= 0.5 === r.c.ui ? 'ok ' : 'NO '} rule=${r.rule === r.c.ui ? 'ok ' : 'NO '} ${r.c.request}`,
  );
}

function score(pred: (r: (typeof rows)[number]) => boolean) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let ok = 0;
  for (const r of rows) {
    const y = pred(r);
    if (y === r.c.ui) ok++;
    if (y && r.c.ui) tp++;
    if (y && !r.c.ui) fp++;
    if (!y && r.c.ui) fn++;
  }
  return `${ok}/${rows.length} right, ${fp} drawn when not needed, ${fn} missed (precision ${(tp / Math.max(1, tp + fp)).toFixed(2)}, recall ${(tp / Math.max(1, tp + fn)).toFixed(2)})`;
}
out('');
for (const t of [0.3, 0.5, 0.7]) out(`jev >= ${t}: ${score((r) => mean(r.p) >= t)}`);
out(`rule:      ${score((r) => r.rule)}`);
out(`jev OR rule (0.5): ${score((r) => r.rule || mean(r.p) >= 0.5)}`);
const all = rows.flatMap((r) => r.ms);
out(
  `latency: median ${all.sort((a, b) => a - b)[Math.floor(all.length / 2)]} ms, max ${Math.max(...all)} ms`,
);
if (times > 1) {
  const spread = mean(rows.map((r) => Math.max(...r.p) - Math.min(...r.p)));
  out(`spread between runs: ${spread.toFixed(3)}`);
}
