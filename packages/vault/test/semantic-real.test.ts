import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VaultService, WorkerEmbedder } from '../src/index.ts';
import { tempDir, track } from './helpers.ts';

/*
 * Real model, optional (downloads ~120 MB the first time):
 *   MONSTERS_TEST_NETWORK=1 pnpm test semantic-real
 * The model is kept in MONSTERS_TEST_MODEL_DIR (default: <tmp>/monsters-test-models)
 * so later runs do not download it again. Questions in Italian must find the
 * notes by meaning in a vault of ~200 notes.
 */

const enabled = process.env['MONSTERS_TEST_NETWORK'] === '1';
const MODEL_DIR = process.env['MONSTERS_TEST_MODEL_DIR'] ?? join(tmpdir(), 'monsters-test-models');

const TARGETS: { path: string; text: string; question: string }[] = [
  {
    path: 'Progetti/Budget marketing Q4.md',
    text: "Per l'ultimo trimestre mettiamo 3.000 € sulle campagne Instagram e Meta e 800 € su Google Ads. Il costo per contatto deve scendere sotto i 2 €.",
    question: 'quanto investiamo in pubblicità?',
  },
  {
    path: 'Risorse/Ricette/Carbonara.md',
    text: 'Guanciale tagliato a listarelle, tuorli, pecorino romano e pepe. Mai la panna. Spaghetti o rigatoni.',
    question: 'come si fa il primo piatto romano con le uova?',
  },
  {
    path: 'Aree/Montagna/Escursione Dolomiti.md',
    text: 'Zaino da 30 litri, scarponi, giacca antivento, borraccia, crema solare e la cartina del sentiero 9.',
    question: 'cosa mi serve per un trekking in alta quota?',
  },
  {
    path: 'Aree/Casa/Auto.md',
    text: 'La polizza RC scade il 14 marzo, il bollo si paga ad aprile, tagliando ogni 15.000 km dal meccanico di via Roma.',
    question: "quando devo rinnovare l'assicurazione della macchina?",
  },
  {
    path: 'Persone/Marco Bellini.md',
    text: 'Il nostro consulente fiscale: prepara la dichiarazione dei redditi e il 730. Studio in corso Italia.',
    question: 'chi è il commercialista?',
  },
  {
    path: 'Diario/Festa di Sofia.md',
    text: 'Otto anni! Torta al cioccolato, palloncini, venti invitati dalla scuola e il mago alle 17.',
    question: 'idee per il compleanno di mia figlia',
  },
  {
    path: 'Aree/Salute/Insonnia.md',
    text: 'Mi sveglio alle 4 e non riprendo più. Provare la melatonina, niente schermi dopo le 22, camomilla.',
    question: 'dormo male la notte, cosa posso fare?',
  },
  {
    path: 'Progetti/Restyling sito.md',
    text: 'Wireframe approvati, lo sviluppatore consegna la home entro fine mese; poi testi e SEO.',
    question: 'a che punto è il rifacimento del portale aziendale?',
  },
  {
    path: 'Progetti/Ferie estive.md',
    text: 'Agosto in Puglia: masseria vicino a Ostuni, spiagge di Polignano, prenotare entro maggio.',
    question: "dove andiamo in vacanza quest'estate?",
  },
  {
    path: 'Risorse/Ricette/Pane senza glutine.md',
    text: 'Farina di grano saraceno e di riso, lievito di birra, due ore di lievitazione. Adatto a chi è celiaco.',
    question: "cosa posso preparare per un'amica intollerante al frumento?",
  },
];

/** Notes close in subject to some targets, to make the ranking non trivial. */
const DISTRACTORS: Record<string, string> = {
  'Risorse/Ricette/Lasagne.md':
    'Sfoglia, ragù di carne e besciamella, forno a 180 gradi per 40 minuti.',
  'Aree/Casa/Bici.md': 'Cambiare la catena e gonfiare le gomme prima della primavera.',
  'Persone/Laura Conti.md': 'Avvocata, segue il contratto di affitto del magazzino.',
  'Progetti/Newsletter.md': 'Invio ogni martedì, 1.200 iscritti, tasso di apertura al 38%.',
  'Aree/Salute/Corsa.md': 'Tre uscite a settimana da 5 km, scarpe nuove a novembre.',
  'Diario/Cena con i suoceri.md': 'Abbiamo parlato del matrimonio di Giulia e della casa al mare.',
  'Progetti/App interna.md': 'Gestionale per gli ordini: login fatto, manca la parte dei report.',
  'Risorse/Libri/Sapiens.md': 'Appunti sul capitolo della rivoluzione agricola.',
  'Aree/Casa/Bollette.md': 'Luce e gas con addebito il giorno 5, internet fibra 29 € al mese.',
  'Diario/Weekend a Torino.md': 'Museo Egizio, gianduiotti, passeggiata lungo il Po.',
};

const SENTENCES = [
  'Riunione breve con il team, rimandati due punti alla prossima settimana.',
  'Rispondere alle mail arretrate entro venerdì.',
  'Letto un articolo interessante sulla produttività e sulle abitudini.',
  'Chiamare il fornitore per il preventivo delle sedie.',
  'Aggiornare il foglio delle presenze di ottobre.',
  'Il cliente ha chiesto una demo più corta, massimo venti minuti.',
  'Comprare le lampadine per lo studio e il nastro adesivo.',
  'Idea: raccogliere le domande frequenti in una pagina sola.',
  'Rivedere la presentazione per il consiglio di lunedì.',
  'Portare il cane dal veterinario per il richiamo del vaccino.',
  'Sistemare le cartelle condivise e archiviare i vecchi progetti.',
  'Parlato con Paolo del nuovo contratto di assistenza.',
  'Ascoltato un podcast sulla storia di Roma antica.',
  'Pianificare le attività del prossimo sprint con priorità chiare.',
  'Fare il backup del portatile su disco esterno.',
  'Ordinare i libri per il corso di inglese.',
  'Annotare le spese del viaggio di lavoro a Milano.',
  'Ritirare il pacco in posta prima delle 18.',
  'Il server di prova va riavviato dopo l’aggiornamento.',
  'Scrivere il riepilogo della call con i partner tedeschi.',
  'Prenotare la sala riunioni per giovedì mattina.',
  'Rinnovare l’abbonamento al software di contabilità.',
  'Pulire il giardino e potare la siepe.',
  'Preparare le domande per il colloquio del nuovo stagista.',
];

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function writeNote(root: string, path: string, text: string): void {
  const title = path.split('/').at(-1)!.replace(/\.md$/, '');
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `# ${title}\n\n${text}\n`);
}

function buildVault(root: string): number {
  let count = 0;
  for (const t of TARGETS) {
    writeNote(root, t.path, t.text);
    count++;
  }
  for (const [path, text] of Object.entries(DISTRACTORS)) {
    writeNote(root, path, text);
    count++;
  }
  const random = rng(42);
  const folders = ['Diario', 'Inbox', 'Riunioni', 'Archivio'];
  for (let i = 0; i < 180; i++) {
    const n = 2 + Math.floor(random() * 4);
    const lines = Array.from(
      { length: n },
      () => SENTENCES[Math.floor(random() * SENTENCES.length)],
    );
    const folder = folders[i % folders.length]!;
    writeNote(root, `${folder}/Nota ${String(i + 1).padStart(3, '0')}.md`, lines.join(' '));
    count++;
  }
  return count;
}

describe.skipIf(!enabled)('semantic search with the real model (network)', () => {
  it('finds Italian questions by meaning in a vault of ~200 notes', async () => {
    const root = join(tempDir(), 'Vault');
    const notes = buildVault(root);

    const loadStart = performance.now();
    let loadMs = 0;
    const vault = track(
      await VaultService.open({
        root,
        git: false,
        embedder: async () => {
          const e = await WorkerEmbedder.create({ cacheDir: MODEL_DIR });
          loadMs = performance.now() - loadStart;
          return e;
        },
      }),
    );
    await vault.semanticIdle();
    const indexMs = performance.now() - loadStart - loadMs;
    const status = vault.semanticStatus();
    expect(status.state).toBe('ready');
    expect(status.embedded).toBe(status.chunks);

    const a = { agentId: 'user' };
    const report: string[] = [];
    let hybridTop3 = 0;
    let semanticTop3 = 0;
    let textTop3 = 0;
    let queryMs = 0;
    for (const t of TARGETS) {
      const started = performance.now();
      const hybrid = (await vault.search(a, { query: t.question, limit: 3 })).map((h) => h.path);
      queryMs += performance.now() - started;
      const semantic = (
        await vault.search(a, { query: t.question, mode: 'semantic', limit: 3 })
      ).map((h) => h.path);
      const text = (await vault.search(a, { query: t.question, mode: 'text', limit: 3 })).map(
        (h) => h.path,
      );
      if (hybrid.includes(t.path)) hybridTop3++;
      if (semantic.includes(t.path)) semanticTop3++;
      if (text.includes(t.path)) textTop3++;
      report.push(
        `${semantic.indexOf(t.path) + 1 || '-'}/${hybrid.indexOf(t.path) + 1 || '-'}/${text.indexOf(t.path) + 1 || '-'}  ${t.question} → ${t.path}`,
      );
    }
    const relatedOf = async (note: string) =>
      (await vault.search(a, { related_to: note })).map((h) => h.path);
    const related = await relatedOf('Carbonara');
    // Before D-030's update every note listed its nearest 8, mostly filler notes.
    const relatedReport: string[] = [];
    for (const note of ['Escursione Dolomiti', 'Marco Bellini', 'Sapiens', 'Nota 001']) {
      relatedReport.push(`related to ${note}: ${(await relatedOf(note)).join(', ') || '-'}`);
    }

    // The measures of the run (download, indexing, quality) are the point of this test.
    console.warn(
      [
        `notes ${notes}, chunks ${status.chunks}, model ${status.model}`,
        `model load (download on first run) ${(loadMs / 1000).toFixed(1)} s`,
        `indexing ${(indexMs / 1000).toFixed(1)} s (${((status.chunks / indexMs) * 1000).toFixed(1)} chunks/s)`,
        `hybrid query avg ${(queryMs / TARGETS.length).toFixed(0)} ms`,
        `top-3 semantic ${semanticTop3}/10, hybrid ${hybridTop3}/10, text ${textTop3}/10`,
        'rank semantic/hybrid/text:',
        ...report,
        `related to Carbonara: ${related.join(', ')}`,
        ...relatedReport,
      ].join('\n'),
    );
    expect(semanticTop3).toBeGreaterThanOrEqual(8);
    expect(hybridTop3).toBeGreaterThanOrEqual(8);
    // Only the other recipes, not the whole vault.
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((p) => p.startsWith('Risorse/Ricette/'))).toBe(true);
    // A note with no subject in common with the others lists nothing.
    expect(await relatedOf('Marco Bellini')).toEqual([]);
  }, 600_000);
});

describe.skipIf(!enabled)('shutdown of the real embedding worker (network)', () => {
  // D-099: worker.terminate() during the model load or a batch aborted the process.
  it('closes during the model load and during a batch without aborting the process', async () => {
    // The model files first (downloaded once), so that the children only load them.
    await (await WorkerEmbedder.create({ cacheDir: MODEL_DIR })).close();
    const fixture = fileURLToPath(new URL('./embedder-shutdown.fixture.ts', import.meta.url));
    const runs = [
      ...[0, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((ms) => ['load', ms] as const),
      ...[0, 30, 100, 200, 300].map((ms) => ['batch', ms] as const),
    ];
    const failed: string[] = [];
    for (const [mode, ms] of runs) {
      const child = spawnSync(process.execPath, [fixture, MODEL_DIR, mode, String(ms)], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (child.status !== 0 || child.stdout.trim() !== 'ok')
        failed.push(`${mode} ${ms} ms: ${child.status ?? child.signal} ${child.stderr.trim()}`);
    }
    expect(failed).toEqual([]);
  }, 600_000);
});
