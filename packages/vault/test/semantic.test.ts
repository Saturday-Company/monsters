import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, openDb } from '@monsters/db';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_MAX_CHARS,
  VaultService,
  chunkNote,
  defaultIndexPath,
  embedText,
  parseNote,
  rrfFuse,
  splitLong,
  stemWord,
  vaultMigrations,
  WorkerEmbedder,
  type Embedder,
} from '../src/index.ts';
import { FakeEmbedder } from './fake-embedder.ts';
import { actor, newVault, tempDir, track, waitFor } from './helpers.ts';

const titan = () => actor('titan');
const rhea = () => actor('rhea');

const NOTES: Record<string, string> = {
  'Risorse/Carbonara.md':
    '# Carbonara\n\nGuanciale croccante, uova, pecorino e pepe nero sulla pasta.\n',
  'Risorse/Lasagne della nonna.md':
    '# Lasagne della nonna\n\nSfoglia, sugo di carne e besciamella: un piatto da forno per il pranzo.\n',
  'Progetti/Budget Q4.md':
    '# Budget Q4\n\nSpesa per annunci social: 3000 euro. Costo per contatto in calo.\n',
  'Aree/Allenamento.md': '# Allenamento\n\nCorsa tre volte a settimana e palestra il sabato.\n',
  'Risorse/Viaggio a Parigi.md': '# Viaggio a Parigi\n\nVolo il venerdì, hotel vicino al Louvre.\n',
};

async function seeded(embedder: Embedder | null = new FakeEmbedder()) {
  const vault = await newVault(embedder ? { embedder: () => Promise.resolve(embedder) } : {});
  const a = titan();
  for (const [path, content] of Object.entries(NOTES)) {
    await vault.write(a, { path, content });
  }
  await vault.semanticIdle();
  return vault;
}

const paths = (hits: { path: string }[]) => hits.map((h) => h.path);

describe('chunking', () => {
  it('cuts on headings with the heading path, merges short sections, embeds the title', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Frase numero ${i} sul tema.`).join(' ');
    const text = [
      '---',
      'tags: [cucina]',
      '---',
      '# Ricette',
      '',
      'Intro breve.',
      '',
      '## Primi',
      '',
      'Pasta e fagioli.',
      '',
      '### Carbonara',
      '',
      `${long}\n\n${long}`,
      '',
      '## Dolci',
      '',
      `${long}`,
      '',
    ].join('\n');
    const chunks = chunkNote(parseNote('Ricette.md', text));
    // "Intro breve." is short: "Primi" is merged into it (path of the first section).
    expect(chunks[0]?.headingPath).toBe('');
    expect(chunks[0]?.text).toContain('Intro breve.');
    expect(chunks[0]?.text).toContain('Pasta e fagioli.');
    expect(chunks.some((c) => c.headingPath === 'Primi › Carbonara')).toBe(true);
    expect(chunks.at(-1)?.headingPath).toBe('Dolci');
    // The frontmatter is not text of the note.
    expect(chunks.every((c) => !c.text.includes('tags:'))).toBe(true);
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    expect(embedText('Ricette', 'Primi › Carbonara', 'testo')).toBe(
      'Ricette › Primi › Carbonara\n\ntesto',
    );
  });

  it('splits long sections on paragraphs with overlap, and keeps empty notes', () => {
    const para = (n: number) => `Paragrafo ${n}. ${'parola '.repeat(120).trim()}`;
    const text = Array.from({ length: 8 }, (_, i) => para(i)).join('\n\n');
    const parts = splitLong(text, 2400, 300);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2400);
    // The start of each part repeats the end of the previous one.
    const tail = parts[0]!.slice(-100);
    expect(parts[1]).toContain(tail.slice(tail.indexOf(' ') + 1));

    const empty = chunkNote(parseNote('Vuota.md', ''));
    expect(empty).toHaveLength(1);
    expect(empty[0]?.text).toBe('');
    // Same text and title, same hash; another title, another hash.
    expect(chunkNote(parseNote('A.md', 'ciao'))[0]?.hash).toBe(
      chunkNote(parseNote('Cartella/A.md', 'ciao'))[0]?.hash,
    );
    expect(chunkNote(parseNote('B.md', 'ciao'))[0]?.hash).not.toBe(
      chunkNote(parseNote('A.md', 'ciao'))[0]?.hash,
    );
  });
});

describe('reciprocal rank fusion', () => {
  it('sums 1/(k+rank) over the lists', () => {
    const fused = rrfFuse([
      ['a', 'b', 'c'],
      ['c', 'a'],
    ]);
    expect(fused.map((f) => f.key)).toEqual(['a', 'c', 'b']);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(fused[1]?.score).toBeCloseTo(1 / 63 + 1 / 61);
    expect(fused[2]?.score).toBeCloseTo(1 / 62);
    expect(rrfFuse([])).toEqual([]);
  });
});

describe('italian stemming', () => {
  it('gives plural and singular the same stem', () => {
    expect(stemWord('ricette')).toBe(stemWord('ricetta'));
    expect(stemWord('Progetti')).toBe(stemWord('progetto'));
    expect(stemWord('abitudini')).toBe(stemWord('abitudine'));
    expect(stemWord('2026')).toBe('2026');
  });

  it('full-text finds "ricetta" when searching "ricette", without a model', async () => {
    const vault = await newVault();
    const a = titan();
    await vault.write(a, {
      path: 'Risorse/Pane.md',
      content: '# Pane\n\nLa ricetta del pane di casa.\n',
    });
    await vault.write(a, { path: 'Risorse/Altro.md', content: '# Altro\n\nNiente da vedere.\n' });
    expect(paths(await vault.search(a, { query: 'ricette', mode: 'text' }))).toEqual([
      'Risorse/Pane.md',
    ]);
    // Prefixes and phrases still work as before.
    expect(paths(await vault.search(a, { query: 'ricet' }))).toEqual(['Risorse/Pane.md']);
    expect(paths(await vault.search(a, { query: '"ricetta del pane"' }))).toEqual([
      'Risorse/Pane.md',
    ]);
    expect(vault.semanticStatus().state).toBe('off');
  });
});

describe('semantic and hybrid search', () => {
  it('finds notes by meaning, which full-text alone cannot', async () => {
    const vault = await seeded();
    const a = titan();
    expect(vault.semanticStatus()).toMatchObject({ state: 'ready', model: 'fake/concepts' });
    // No note contains these words.
    expect(await vault.search(a, { query: 'cosa mangio a cena', mode: 'text' })).toHaveLength(0);
    const semantic = await vault.search(a, {
      query: 'cosa mangio a cena',
      mode: 'semantic',
      limit: 2,
    });
    expect(paths(semantic).sort()).toEqual([
      'Risorse/Carbonara.md',
      'Risorse/Lasagne della nonna.md',
    ]);
    expect(semantic[0]?.snippet).toBeTruthy();
    // Hybrid is the default.
    const hybrid = await vault.search(a, { query: 'quanto spendiamo in pubblicità', limit: 3 });
    expect(hybrid[0]?.path).toBe('Progetti/Budget Q4.md');
  });

  it('fuses full-text and vectors: a word match keeps its highlighted snippet', async () => {
    const vault = await seeded();
    const a = titan();
    const hits = await vault.search(a, { query: 'guanciale', limit: 3 });
    expect(hits[0]?.path).toBe('Risorse/Carbonara.md');
    expect(hits[0]?.snippet).toContain('**Guanciale**');
    // Both lists agree on the carbonara: it ranks above notes found by one list only.
    expect(hits[0]!.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it('applies filters and permissions to semantic hits', async () => {
    const vault = await seeded();
    const a = titan();
    await vault.write(a, {
      path: 'Risorse/Cena segreta.md',
      content: '# Cena segreta\n\nMenu di pasta al forno.\n',
      frontmatter: { private: true },
    });
    await vault.semanticIdle();
    const q = { query: 'cosa cucino per pranzo', mode: 'semantic' as const };
    expect(paths(await vault.search(a, q))).toContain('Risorse/Cena segreta.md');
    expect(paths(await vault.search(rhea(), q))).not.toContain('Risorse/Cena segreta.md');
    expect(paths(await vault.search(a, { ...q, folder: 'Progetti' }))).toEqual([
      'Progetti/Budget Q4.md',
    ]);
  });

  it('finds related notes, with and without vectors', async () => {
    const vault = await seeded();
    const a = titan();
    const related = await vault.search(a, { related_to: 'Carbonara', limit: 2 });
    expect(paths(related)[0]).toBe('Risorse/Lasagne della nonna.md');
    expect(paths(related)).not.toContain('Risorse/Carbonara.md');

    const plain = await newVault();
    await plain.write(a, {
      path: 'Progetti/Sito.md',
      content: '# Sito\n\nIl sito nuovo.\n',
      frontmatter: { tags: ['web'] },
    });
    await plain.write(a, {
      path: 'Inbox/Idee sito.md',
      content: '# Idee sito\n\nMenu e colori.\n',
    });
    await plain.write(a, { path: 'Inbox/Spesa.md', content: '# Spesa\n\nLatte.\n' });
    // Without vectors: notes sharing words of the title and tags.
    expect(paths(await plain.search(a, { related_to: 'Sito' }))).toEqual(['Inbox/Idee sito.md']);
  });

  it('embeds incrementally: only changed text, also after an external edit', async () => {
    const embedder = new FakeEmbedder();
    const vault = await seeded(embedder);
    const a = titan();
    await vault.watch();
    const before = embedder.embedded.length;

    // Moving a note keeps its text (and title): no new embedding.
    await vault.move(a, { from: 'Aree/Allenamento.md', to: 'Archivio/' });
    await vault.semanticIdle();
    expect(embedder.embedded.length).toBe(before);

    // An edit made in Obsidian: only that note is embedded again.
    writeFileSync(
      join(vault.root, 'Risorse/Viaggio a Parigi.md'),
      '# Viaggio a Parigi\n\nTreno notturno e valigia leggera per le vacanze.\n',
    );
    await waitFor(() => embedder.embedded.length > before);
    await vault.semanticIdle();
    expect(embedder.embedded.slice(before)).toEqual([
      'Viaggio a Parigi\n\nTreno notturno e valigia leggera per le vacanze.',
    ]);
    const hits = await vault.search(a, { query: 'treno', mode: 'semantic', limit: 1 });
    expect(hits[0]?.path).toBe('Risorse/Viaggio a Parigi.md');

    // A full reindex embeds nothing new: vectors are stored by text hash.
    const count = embedder.embedded.length;
    await vault.reindex();
    await vault.semanticIdle();
    expect(embedder.embedded.length).toBe(count);
    expect(vault.semanticStatus().embedded).toBe(vault.semanticStatus().chunks);
  });

  it('degrades to full-text when the model cannot be loaded', async () => {
    const errors: string[] = [];
    const vault = track(
      await VaultService.create({
        root: join(tempDir(), 'Vault'),
        embedder: () => Promise.reject(new Error('fetch failed: offline')),
        semanticOptions: { onError: (e) => errors.push(e.message) },
      }),
    );
    const a = actor('user');
    await vault.write(a, { path: 'Inbox/Pane.md', content: '# Pane\n\nLa ricetta del pane.\n' });
    await vault.semanticIdle();
    expect(vault.semanticStatus()).toMatchObject({
      state: 'unavailable',
      error: 'fetch failed: offline',
    });
    expect(errors).toEqual(['fetch failed: offline']);
    for (const mode of ['hybrid', 'semantic', 'text'] as const) {
      expect(paths(await vault.search(a, { query: 'ricette', mode }))).toEqual(['Inbox/Pane.md']);
    }
  });

  it('never makes opening wait for the model', async () => {
    let release!: (e: Embedder) => void;
    const pending = new Promise<Embedder>((r) => (release = r));
    const vault = track(
      await VaultService.create({ root: join(tempDir(), 'Vault'), embedder: () => pending }),
    );
    expect(vault.semanticStatus().state).toBe('loading');
    const a = actor('user');
    expect(paths(await vault.search(a, { query: 'leggimi' }))).toEqual(['LEGGIMI.md']);
    release(new FakeEmbedder());
    await waitFor(() => vault.semanticStatus().state === 'ready');
    await vault.semanticIdle();
    expect(vault.semanticStatus().embedded).toBeGreaterThan(0);
  });

  it('closes the embedder with the vault', async () => {
    const embedder = new FakeEmbedder();
    const vault = await VaultService.create({
      root: join(tempDir(), 'Vault'),
      embedder: () => Promise.resolve(embedder),
    });
    await vault.semanticIdle();
    await vault.close();
    expect(embedder.closed).toBe(true);
  });
});

describe('worker embedder', () => {
  it('reports a model that is not there (offline) instead of hanging', async () => {
    const started = Date.now();
    await expect(
      WorkerEmbedder.create({ cacheDir: join(tempDir(), 'models'), offline: true }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);
});

describe('migration', () => {
  it('upgrades an index of phase 1 and rebuilds it from the files', async () => {
    const dir = tempDir();
    const root = join(dir, 'Vault');
    mkdirSync(join(root, 'Inbox'), { recursive: true });
    writeFileSync(join(root, 'Inbox/Torte.md'), '# Torte\n\nLa ricetta della crostata.\n');
    const indexPath = defaultIndexPath(join(dir, 'home'), root);
    mkdirSync(join(dir, 'home', 'index'), { recursive: true });
    // An index created by the previous version: migrations 1 and 2 only, one stale note.
    const old = openDb(indexPath);
    migrate(old, 'vault', vaultMigrations.slice(0, 2));
    old.run(
      `INSERT INTO vault_notes (path, path_key, name_key, folder, title, updated, hash, mtime, size, is_md)
       VALUES ('Vecchia.md', 'vecchia', 'vecchia', '', 'Vecchia', '2026-01-01', 'x', 0, 0, 1)`,
    );
    old.run(`INSERT INTO vault_fts (rowid, title, body) VALUES (1, 'Vecchia', 'vecchia')`);
    old.close();

    const embedder = new FakeEmbedder();
    const vault = track(
      await VaultService.open({
        root,
        indexPath,
        git: false,
        embedder: () => Promise.resolve(embedder),
      }),
    );
    const a = actor('user');
    expect(paths(await vault.search(a, { query: 'ricette', mode: 'text' }))).toEqual([
      'Inbox/Torte.md',
    ]);
    expect(vault.index.get('Vecchia.md')).toBeUndefined();
    await vault.semanticIdle();
    expect(vault.semanticStatus()).toMatchObject({ chunks: 1, embedded: 1 });
    const tables = vault.index.db
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE name LIKE 'vault_%'`)
      .map((r) => r.name);
    expect(tables).toContain('vault_vectors');
    expect(tables).not.toContain('vault_embeddings');
  });
});
