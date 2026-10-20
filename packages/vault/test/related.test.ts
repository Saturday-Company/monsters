import { describe, expect, it } from 'vitest';
import {
  RELATED_LIMIT,
  RELATED_MIN_Z,
  pickRelated,
  robustStats,
  relationBonus,
  type RelationSignals,
} from '../src/index.ts';
import { FakeEmbedder } from './fake-embedder.ts';
import { actor, newVault } from './helpers.ts';

/*
 * "Related notes" (D-030): a few clearly related notes, or none, instead of
 * the nearest N whatever they are.
 */

const a = () => actor('titan');
const paths = (hits: { path: string }[]) => hits.map((h) => h.path);

const COOKING: Record<string, string> = {
  'Risorse/Ricette/Carbonara.md': 'Guanciale croccante, uova, pecorino e pepe sulla pasta.',
  'Risorse/Ricette/Lasagne.md': 'Sfoglia, sugo di carne e besciamella: un piatto da forno.',
  'Risorse/Ricette/Pesto.md': 'Basilico, pinoli e pasta: la ricetta veloce per la cena.',
};

const OTHERS: Record<string, string> = {
  'Progetti/Budget Q4.md': 'Spesa per annunci social: 3000 euro, costo per contatto in calo.',
  'Aree/Allenamento.md': 'Corsa al parco e palestra il sabato.',
  'Risorse/Viaggio a Parigi.md': 'Volo il venerdì, hotel vicino al Louvre.',
};

/** Notes about nothing in particular: the background of the vault. */
const FILLER = [
  'Riunione breve con il team, rimandati due punti.',
  'Rispondere alle mail arretrate entro venerdì.',
  'Chiamare il tecnico per il rubinetto.',
  'Aggiornare il foglio delle presenze di ottobre.',
  'Comprare le lampadine e il nastro adesivo.',
  'Rivedere la presentazione per il consiglio.',
  'Sistemare le cartelle condivise del gruppo.',
  'Ritirare il pacco in posta prima delle sei.',
  'Prenotare la sala riunioni per giovedì.',
  'Pulire il giardino e potare la siepe.',
  'Fare il backup del portatile su disco.',
  'Scrivere il riepilogo della telefonata.',
];

async function vaultWith(extra: Record<string, string> = {}, embedder = true) {
  const vault = await newVault(
    embedder ? { embedder: () => Promise.resolve(new FakeEmbedder()) } : {},
  );
  const notes: Record<string, string> = { ...COOKING, ...OTHERS, ...extra };
  FILLER.forEach((text, i) => {
    notes[`Archivio/Nota ${String(i + 1).padStart(2, '0')}.md`] = text;
  });
  for (const [path, text] of Object.entries(notes)) {
    const title = path.split('/').at(-1)!.replace(/\.md$/, '');
    await vault.write(a(), { path, content: `# ${title}\n\n${text}\n` });
  }
  await vault.semanticIdle();
  return vault;
}

describe('related notes', () => {
  it('lists only the notes on the same subject, not the nearest whatever they are', async () => {
    const vault = await vaultWith();
    const related = paths(await vault.search(a(), { related_to: 'Carbonara', limit: 10 }));
    expect(related).toEqual(
      expect.arrayContaining(['Risorse/Ricette/Lasagne.md', 'Risorse/Ricette/Pesto.md']),
    );
    expect(related.every((p) => p.startsWith('Risorse/Ricette/'))).toBe(true);
  });

  it('lists nothing when no note stands out', async () => {
    const vault = await vaultWith();
    expect(await vault.search(a(), { related_to: 'Allenamento', limit: 10 })).toEqual([]);
    expect(await vault.search(a(), { related_to: 'Viaggio a Parigi', limit: 10 })).toEqual([]);
  });

  it('lists at most a few notes unless asked for more', async () => {
    const more: Record<string, string> = {};
    for (const dish of ['Amatriciana', 'Gricia', 'Cacio e pepe', 'Ragù', 'Parmigiana']) {
      more[`Risorse/Ricette/${dish}.md`] =
        `Ricetta della pasta per il pranzo: ${dish.toLowerCase()}.`;
    }
    const vault = await vaultWith(more);
    const hits = await vault.search(a(), { related_to: 'Carbonara' });
    expect(hits).toHaveLength(RELATED_LIMIT);
    expect(paths(hits).every((p) => p.startsWith('Risorse/Ricette/'))).toBe(true);
    expect(hits.every((h) => h.snippet.length > 0)).toBe(true);
  });

  it('counts a link to the note: a note on another subject that cites it is related', async () => {
    const link = { 'Archivio/Sabato.md': 'Sabato a casa di Marco, porto io la [[Carbonara]].' };
    const vault = await vaultWith(link);
    expect(paths(await vault.search(a(), { related_to: 'Carbonara', limit: 10 }))).toContain(
      'Archivio/Sabato.md',
    );
    // And the other way round: the cited note is related to the citing one.
    expect(paths(await vault.search(a(), { related_to: 'Sabato', limit: 10 }))).toContain(
      'Risorse/Ricette/Carbonara.md',
    );
  });

  it('respects filters and permissions', async () => {
    const vault = await vaultWith({ 'Privato/Cena segreta.md': 'Ricetta della pasta al forno.' });
    expect(
      paths(await vault.search(actor('rhea'), { related_to: 'Carbonara', limit: 10 })),
    ).not.toContain('Privato/Cena segreta.md');
    expect(
      paths(await vault.search(a(), { related_to: 'Carbonara', folder: 'Progetti', limit: 10 })),
    ).toEqual([]);
  });

  it('without vectors puts linked and tagged notes first', async () => {
    const vault = await newVault();
    await vault.write(a(), {
      path: 'Progetti/Sito.md',
      content: '# Sito\n\nIl sito nuovo.\n',
      frontmatter: { tags: ['web'] },
    });
    await vault.write(a(), { path: 'Inbox/Idee sito.md', content: '# Idee sito\n\nMenu.\n' });
    await vault.write(a(), {
      path: 'Inbox/Colori.md',
      content: '# Colori\n\nPalette scelta.\n',
      frontmatter: { tags: ['web'] },
    });
    await vault.write(a(), {
      path: 'Inbox/Riunione.md',
      content: '# Riunione\n\nVedi [[Sito]].\n',
    });
    await vault.write(a(), { path: 'Inbox/Spesa.md', content: '# Spesa\n\nLatte.\n' });
    expect(paths(await vault.search(a(), { related_to: 'Sito' }))).toEqual([
      'Inbox/Riunione.md',
      'Inbox/Colori.md',
      'Inbox/Idee sito.md',
    ]);
  });
});

describe('related notes: signals', () => {
  it('reads links both ways, explicit tags, common targets and the same subfolder', async () => {
    const vault = await newVault();
    const w = (path: string, content: string, tags?: string[]) =>
      vault.write(a(), { path, content, ...(tags ? { frontmatter: { tags } } : {}) });
    await w('Risorse/Ricette/Carbonara.md', '# Carbonara\n\nVedi [[Roma]].\n', ['cucina/primi']);
    await w('Risorse/Ricette/Gricia.md', '# Gricia\n\nAnche lei da [[Roma]].\n');
    await w('Aree/Roma.md', '# Roma\n\nLa città.\n');
    await w('Inbox/Menu.md', '# Menu\n\nPrimo: [[Carbonara]].\n', ['cucina/primi']);
    await w('Inbox/Primi.md', '# Primi\n\nAltri primi.\n', ['cucina']);
    const nid = (path: string) => vault.index.get(path)!.nid;
    const signals = vault.index.relationSignals(nid('Risorse/Ricette/Carbonara.md'));
    const at = (path: string) => signals.get(nid(path));
    expect(at('Aree/Roma.md')).toMatchObject({ linked: true });
    expect(at('Inbox/Menu.md')).toMatchObject({ linked: true, sharedTags: 1 });
    expect(at('Risorse/Ricette/Gricia.md')).toMatchObject({
      linked: false,
      sharedTargets: 1,
      sameFolder: true,
    });
    // Only explicit tags count, not the expanded parent `cucina`.
    expect(at('Inbox/Primi.md')).toBeUndefined();
    // Top-level folders are categories: no signal for the other notes in Inbox.
    const menu = vault.index.relationSignals(nid('Inbox/Menu.md'));
    expect(menu.get(nid('Inbox/Primi.md'))).toBeUndefined();
  });

  it('adds the bonuses with caps', () => {
    const none: RelationSignals = {
      linked: false,
      sharedTags: 0,
      sharedTargets: 0,
      sameFolder: false,
    };
    expect(relationBonus(undefined)).toBe(0);
    expect(relationBonus(none)).toBe(0);
    expect(relationBonus({ ...none, linked: true })).toBe(1);
    expect(relationBonus({ ...none, sharedTags: 5 })).toBe(1);
    expect(relationBonus({ ...none, sharedTargets: 5 })).toBe(0.5);
    expect(relationBonus({ ...none, sameFolder: true })).toBe(0.25);
  });

  it('measures the background with median and MAD, not raised by the related notes', () => {
    // A subject covering a third of the notes still stands out.
    const sims = Float64Array.from([
      0.9, 0.9, 0.9, 0.9, 0.5, 0.52, 0.48, 0.51, 0.49, 0.5, 0.5, 0.47,
    ]);
    const { center, spread } = robustStats(sims);
    expect(center).toBeCloseTo(0.505, 3);
    expect((0.9 - center) / spread).toBeGreaterThan(RELATED_MIN_Z * 5);
    // More than half equal: the standard deviation instead of a zero MAD.
    expect(robustStats(Float64Array.from([0, 0, 0, 1])).spread).toBeGreaterThan(0);
  });

  it('picks by z plus bonus, best first, within the limit', () => {
    const scored = [
      { nid: 1, z: 3 },
      { nid: 2, z: 1.2 },
      { nid: 3, z: 1.9 },
      { nid: 4, z: 2.5 },
    ];
    const linked: RelationSignals = {
      linked: true,
      sharedTags: 0,
      sharedTargets: 0,
      sameFolder: false,
    };
    const picked = pickRelated(scored, new Map([[2, linked]]), { limit: 2 });
    expect(picked.map((p) => p.nid)).toEqual([1, 4]);
    const all = pickRelated(scored, new Map([[2, linked]]), { limit: 10 });
    expect(all.map((p) => p.nid)).toEqual([1, 4, 2]);
    expect(pickRelated([{ nid: 1, z: 1.5 }], new Map(), { limit: 5 })).toEqual([]);
  });
});
