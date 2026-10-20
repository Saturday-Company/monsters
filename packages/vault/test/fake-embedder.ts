import { createHash } from 'node:crypto';
import { stemWord, type Embedder } from '../src/index.ts';

/*
 * Deterministic embedder for tests: no model, no download. Words are mapped to
 * a few "concepts" by their Italian stem (cooking, money, health, travel), the
 * rest to hashed dimensions, so texts about the same subject are close even
 * without shared words.
 */

const CONCEPTS: Record<string, string[]> = {
  cucina: [
    'carbonar',
    'past',
    'guancial',
    'ricett',
    'cucin',
    'piatt',
    'cen',
    'mang',
    'sug',
    'forn',
    'lasagn',
    'pranz',
    'staser',
  ],
  soldi: [
    'budget',
    'spes',
    'spend',
    'cost',
    'eur',
    'prezz',
    'pubblic',
    'marketing',
    'sold',
    'annunc',
  ],
  salute: ['cors', 'allen', 'palestr', 'sport', 'salut', 'medic', 'dorm', 'sonn', 'forma'],
  viaggi: ['viagg', 'vol', 'hotel', 'vacanz', 'parig', 'tren', 'valig'],
};
const NAMES = Object.keys(CONCEPTS);
const HASHED = 16;
export const FAKE_DIM = NAMES.length + HASHED;

function concept(stem: string): number {
  return NAMES.findIndex((n) => CONCEPTS[n]?.some((p) => stem.startsWith(p)));
}

export function fakeVector(text: string): Float32Array {
  const v = new Float32Array(FAKE_DIM);
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const stem = stemWord(m[0]);
    const c = concept(stem);
    if (c >= 0) v[c] = (v[c] ?? 0) + 1;
    else {
      const h = createHash('sha1').update(stem).digest()[0] ?? 0;
      const i = NAMES.length + (h % HASHED);
      v[i] = (v[i] ?? 0) + 0.15;
    }
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export class FakeEmbedder implements Embedder {
  readonly model = 'fake/concepts';
  readonly dim = FAKE_DIM;
  /** Every text embedded, in order (to check what is embedded again). */
  readonly embedded: string[] = [];
  closed = false;

  embed(texts: readonly string[]): Promise<Float32Array[]> {
    this.embedded.push(...texts);
    return Promise.resolve(texts.map(fakeVector));
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
