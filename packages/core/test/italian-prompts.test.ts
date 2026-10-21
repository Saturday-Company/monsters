import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setAppLang, setVaultLayout, vaultLayoutOf } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';

/*
 * Every text of the Italian family the models read (D-153, review C21): each entry of every
 * `*.prompts.ts`, strings as they are and functions rendered with fixed sample arguments, has
 * its SHA-256 in `fixtures/italian-prompts.json`. Any change to the Italian family fails here;
 * a change made on purpose (with a new eval) updates the file with
 * `MONSTERS_UPDATE_ITALIAN_PROMPTS=1 pnpm --filter @monsters/core test italian-prompts`.
 * A new `*.prompts.ts` fails too until its hashes are recorded.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'italian-prompts.json');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Methods only lists have: the sample answers them as a list of two samples. */
const LIST_METHODS = new Set(
  'map flatMap filter forEach some every find findIndex reduce join sort toSorted reverse flat'.split(
    ' ',
  ),
);
/** Methods only texts have: the sample answers them as the text "‹x›". */
const TEXT_METHODS = new Set(
  'trim trimEnd trimStart replace replaceAll toLowerCase toUpperCase padStart padEnd split startsWith endsWith charAt normalize repeat localeCompare'.split(
    ' ',
  ),
);

/**
 * The sample argument of every function: the text "‹x›", 2 as a number, a list of two of
 * itself, itself for any other property or call. Fixed, so a rendering is always the same.
 */
const SAMPLE: unknown = new Proxy(function sample() {}, {
  get(_t, key) {
    if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? 2 : '‹x›');
    if (key === Symbol.iterator) {
      return function* () {
        yield SAMPLE;
        yield SAMPLE;
      };
    }
    if (typeof key === 'symbol' || key === 'then') return undefined;
    if (key === 'length') return 2;
    if (LIST_METHODS.has(key)) {
      const list = [SAMPLE, SAMPLE] as unknown as Record<string, (...a: unknown[]) => unknown>;
      return (...args: unknown[]) => list[key]!(...args);
    }
    if (TEXT_METHODS.has(key)) {
      const text = '‹x›' as unknown as Record<string, (...a: unknown[]) => unknown>;
      return (...args: unknown[]) => text[key]!.apply('‹x›', args);
    }
    return SAMPLE;
  },
  apply: () => SAMPLE,
});

/** Helpers that take a list and a language, not a dictionary: called as the code calls them. */
const HELPERS: Record<string, (fn: (...a: unknown[]) => unknown) => unknown> = {
  listIn: (fn) => [fn(['uno'], 'it'), fn(['uno', 'due'], 'it'), fn(['uno', 'due', 'tre'], 'it')],
  listWords: (fn) => [fn(['uno'], 'it'), fn(['uno', 'due'], 'it'), fn(['uno', 'due', 'tre'], 'it')],
  toolGroupName: (fn) => ['web', 'vault', 'team', 'files', 'other'].map((g) => fn(g, 'it')),
  // The vault tools' examples take the layout (D-154): the Italian one.
  toolPrompts: (fn) => fn(vaultLayoutOf('it')),
};

function promptFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.prompts.ts')) out.push(p);
    }
  };
  for (const pkg of readdirSync(PACKAGES)) {
    const src = join(PACKAGES, pkg, 'src');
    if (existsSync(src)) walk(src);
  }
  return out.sort();
}

function render(value: unknown, path: string, out: Record<string, string>, depth = 0): void {
  if (depth > 6) return;
  if (typeof value === 'string') {
    out[path] = sha(value);
  } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    out[path] = sha(String(value));
  } else if (typeof value === 'function') {
    let result: unknown;
    try {
      result = (value as (...a: unknown[]) => unknown)(SAMPLE, SAMPLE, SAMPLE, SAMPLE);
    } catch (err) {
      result = `throws ${(err as Error).name}`;
    }
    if (result === SAMPLE) result = 'sample';
    render(result, `${path}()`, out, depth + 1);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => render(v, `${path}[${i}]`, out, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      render((value as Record<string, unknown>)[key], `${path}.${key}`, out, depth + 1);
    }
  }
}

/** The Italian family of one module: its dictionaries in Italian, its `{ it, en }` records' `it`. */
function italianOf(file: string, mod: Record<string, unknown>, out: Record<string, string>) {
  const name = relative(PACKAGES, file).replaceAll('\\', '/');
  for (const key of Object.keys(mod).sort()) {
    const value = mod[key];
    const at = `${name}#${key}`;
    if (typeof value === 'function') {
      const helper = HELPERS[key];
      // The accessors take the language, or read the app's (set to Italian here).
      const dict = helper
        ? helper(value as (...a: unknown[]) => unknown)
        : (value as (l: string) => unknown)('it');
      render(dict, at, out);
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === 'en,it'
    ) {
      render((value as { it: unknown }).it, `${at}.it`, out);
    } else {
      render(value, at, out);
    }
  }
}

afterEach(() => {
  setAppLang('en');
  setVaultLayout('it');
});

describe('the Italian family of the prompts did not move (C21)', () => {
  it('every entry of every *.prompts.ts has the recorded hash', async () => {
    setAppLang('it');
    setVaultLayout('it');
    const actual: Record<string, string> = {};
    const files = promptFiles();
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      italianOf(file, mod, actual);
    }
    // Rendered twice: the same text (no clock, no randomness).
    const again: Record<string, string> = {};
    for (const file of files) {
      italianOf(file, (await import(pathToFileURL(file).href)) as Record<string, unknown>, again);
    }
    expect(again).toEqual(actual);
    if (process.env['MONSTERS_UPDATE_ITALIAN_PROMPTS'] === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(Object.keys(actual).length).toBeGreaterThan(500);
    expect(actual).toEqual(expected);
  });
});
